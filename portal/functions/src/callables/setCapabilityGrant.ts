import {
  type CapabilityGrantDoc,
  COLLECTIONS,
  capabilityGrantDocSchema,
  capabilityGrantId,
  LIMITS,
  parseStoredDocument,
  SENSITIVE_CAPABILITIES,
  setCapabilityGrantContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { commitAccess, draftAccess } from "../access/maintain";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  touchedFields,
  writeAudit,
} from "../framework";
import { writeNotification } from "../notifications/notify";

const OWN_GRANT_MESSAGE = "You cannot grant a capability to your own account. Ask a programme administrator.";
const SENSITIVE_GRANT_MESSAGE =
  "Only a programme administrator can grant or revoke role management, suspension, special-category data, import rollback, integration credentials or publishing approval.";

/** Whether a grant confers its capability at an instant: neither revoked nor past its expiry time. */
function confers(grant: CapabilityGrantDoc | null, at: Date): boolean {
  return (
    grant !== null &&
    grant.revokedAt === null &&
    (grant.expiresAt === null || grant.expiresAt.toMillis() > at.getTime())
  );
}

function earlierPeriod(grant: CapabilityGrantDoc): CapabilityGrantDoc["history"][number] {
  return {
    grantedBy: grant.grantedBy,
    grantedAt: grant.grantedAt,
    reason: grant.reason,
    expiresAt: grant.expiresAt,
    revokedBy: grant.revokedBy,
    revokedAt: grant.revokedAt,
  };
}

/**
 * Grants a named capability to one account, or revokes the grant. Capability: `roles.manage`,
 * with the second factor wherever the caller's access document requires one.
 *
 * A grant names its account, carries a reason and may carry an expiry time. A grant of
 * `demographics.read` must carry one, because special-category data is opened for a limited
 * time only (docs/SECURITY.md, section 2). A new grant for an account that held one before
 * moves the earlier period to `history`. A revocation records its own reason on the grant and
 * keeps the reason of the grant in `history`.
 *
 * Nobody grants a capability to their own account, so that every named grant, the grant of
 * special-category data above all, involves two people. A sensitive capability
 * (`SENSITIVE_CAPABILITIES`) is granted and revoked by programme administrators alone, as the
 * overrides of the capability matrix are, because a member of the core team who holds
 * `roles.manage` through an override must not hand out the other sensitive powers. Revoking a
 * grant of one's own is allowed: it only gives something up.
 *
 * The grant, the access document of the account and the audit entry are written in one
 * transaction, so a revoked grant stops working on the account's next request.
 */
export const setCapabilityGrant = defineCallable(setCapabilityGrantContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const now = Timestamp.fromDate(at);
    const requested = input.action === "grant" ? (input.expiresAt ?? null) : null;
    const expiresAt = requested === null ? null : Timestamp.fromDate(new Date(requested));
    if (input.action === "grant") {
      if (expiresAt !== null && expiresAt.toMillis() <= at.getTime()) {
        throw new AppError("invalid-argument", "The expiry time has passed already. Choose a later one.");
      }
      if (input.capability === "demographics.read" && expiresAt === null) {
        throw new AppError("invalid-argument", "A grant to read special-category data needs an expiry time.");
      }
    }
    const id = capabilityGrantId(input.uid, input.capability);
    const reference = db.doc(COLLECTIONS.capabilityGrants.docPath(id));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, actor, transaction);
      requireCapability(context, access, "roles.manage", "programme");
      if (input.action === "grant" && input.uid === actor) throw new AppError("permission-denied", OWN_GRANT_MESSAGE);
      if ((SENSITIVE_CAPABILITIES as readonly string[]).includes(input.capability)) {
        requireProgrammeAdministrator(access, SENSITIVE_GRANT_MESSAGE);
      }
      const snapshot = await transaction.get(reference);
      let stored: CapabilityGrantDoc | null = null;
      if (snapshot.exists) {
        const parsed = parseStoredDocument(capabilityGrantDocSchema, snapshot.data());
        if (!parsed.success) throw parsed.error;
        stored = parsed.data;
      }
      if (input.action === "revoke") {
        if (stored === null) throw new AppError("not-found", "This account holds no such grant.");
        if (stored.revokedAt !== null) return { grantId: id, active: false };
      } else if (
        stored !== null &&
        confers(stored, at) &&
        stored.reason === input.reason &&
        (stored.expiresAt?.toMillis() ?? null) === (expiresAt?.toMillis() ?? null)
      ) {
        return { grantId: id, active: true };
      }
      const draft = await draftAccess(db, transaction, input.uid, at);
      if (draft === null) {
        throw new AppError("not-found", "This account does not exist, or it has never started the portal.");
      }

      const granting = input.action === "grant";
      const auditEventId = writeAudit(
        transaction,
        {
          action: granting ? "capability.granted" : "capability.revoked",
          actor: { kind: "user", uid: actor },
          entityType: "user",
          entityId: input.uid,
          changes: [
            { field: "capability", after: input.capability },
            { field: "active", before: confers(stored, at), after: granting },
            { field: "reason", after: input.reason },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      const history = stored === null ? [] : [...stored.history, earlierPeriod(stored)].slice(-LIMITS.list);
      const next = capabilityGrantDocSchema.parse(
        granting || stored === null
          ? {
              ...createdFields("capabilityGrants", stamp),
              ...(stored === null ? {} : { createdAt: stored.createdAt, createdBy: stored.createdBy }),
              uid: input.uid,
              capability: input.capability,
              grantedBy: actor,
              grantedAt: now,
              reason: input.reason,
              expiresAt,
              revokedBy: null,
              revokedAt: null,
              history,
            }
          : { ...stored, ...touchedFields(stamp), reason: input.reason, revokedBy: actor, revokedAt: now, history },
      );
      transaction.set(reference, next);
      draft.inputs = {
        ...draft.inputs,
        capabilityGrants: [
          ...draft.inputs.capabilityGrants.filter((grant) => grant.capability !== input.capability),
          next,
        ],
      };
      commitAccess(db, transaction, draft, stamp);
      if (input.uid !== actor) {
        writeNotification(
          db,
          transaction,
          {
            uid: input.uid,
            type: "roleDecision",
            entityType: "user",
            entityId: input.uid,
            eventId: auditEventId,
            payload: { kind: granting ? "capabilityGranted" : "capabilityRevoked", capability: input.capability },
          },
          stamp,
        );
      }
      return { grantId: id, active: granting };
    });
  },
});
