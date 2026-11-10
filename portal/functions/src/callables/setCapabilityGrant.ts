import {
  type CapabilityGrantDoc,
  COLLECTIONS,
  capabilityGrantDocSchema,
  capabilityGrantId,
  LIMITS,
  parseStoredDocument,
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
  touchedFields,
  writeAudit,
} from "../framework";
import { writeNotification } from "../notifications/notify";

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
      requireCapability(context, await readAccessDocument(db, actor, transaction), "roles.manage", "programme");
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
