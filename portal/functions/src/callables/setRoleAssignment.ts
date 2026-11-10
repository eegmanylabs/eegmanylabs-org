import {
  COLLECTIONS,
  PROGRAMME_KEY,
  type RoleAssignmentDoc,
  type RoleScope,
  SCOPE_TYPES_OF_ROLE,
  setRoleAssignmentContract,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { commitAccess, draftAccess, withAssignment } from "../access/maintain";
import { AppError, callerStamp, defineCallable, readAccessDocument, requireCapability, writeAudit } from "../framework";
import { writeNotification } from "../notifications/notify";
import { LAST_ADMINISTRATOR_MESSAGE, otherAdministrators } from "../roles/administrators";
import { assignmentIdOf, inForce, nextAssignment, readAssignments, revokedAssignment } from "../roles/assignments";

const OWN_ADMINISTRATOR_ROLE_MESSAGE =
  "You cannot change your own programme administrator role. Ask another programme administrator.";

/** Whether the scope of a role exists: the programme itself, or the document that the scope names. */
async function scopeExists(db: Firestore, transaction: Transaction, scope: RoleScope): Promise<boolean> {
  if (scope.scopeType === "programme") return scope.scopeId === PROGRAMME_KEY;
  const path = {
    replication: COLLECTIONS.replications.docPath(scope.scopeId),
    laboratory: COLLECTIONS.laboratories.docPath(scope.scopeId),
    group: COLLECTIONS.groups.docPath(scope.scopeId),
  }[scope.scopeType];
  return (await transaction.get(db.doc(path))).exists;
}

/**
 * Grants, approves or revokes a role assignment. Capability: `roles.manage`, with the second
 * factor wherever the caller's access document requires one.
 *
 * The assignment, the access document of the account and the audit entry are written in one
 * transaction, so a revoked role stops working on the account's next request. Two rules hold
 * whatever the caller may otherwise do: nobody changes an assignment of `programme_admin` to
 * their own account, and the last active programme administrator is never revoked.
 *
 * A call that asks for what is already so changes nothing and answers with the stored status.
 */
export const setRoleAssignment = defineCallable(setRoleAssignmentContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const requested = input.action === "grant" ? input.expiresAt : undefined;
    const expiresAt = requested == null ? requested : new Date(requested);
    if (expiresAt != null && expiresAt.getTime() <= at.getTime()) {
      throw new AppError("invalid-argument", "The expiry time has passed already. Choose a later one, or none.");
    }

    return db.runTransaction(async (transaction) => {
      requireCapability(context, await readAccessDocument(db, actor, transaction), "roles.manage", "programme");
      const id = input.action === "grant" ? assignmentIdOf(input.uid, input) : input.assignmentId;
      const stored = (await readAssignments(db, transaction, [id])).get(id);
      if (stored === undefined || (stored.data === null && input.action !== "grant")) {
        throw new AppError("not-found", "This role assignment does not exist.");
      }
      const target: Pick<RoleAssignmentDoc, "uid" | "role" | "scopeType" | "scopeId"> =
        input.action === "grant" ? input : (stored.data as RoleAssignmentDoc);
      if (target.uid === actor && target.role === "programme_admin") {
        throw new AppError("permission-denied", OWN_ADMINISTRATOR_ROLE_MESSAGE);
      }

      let next: RoleAssignmentDoc | null;
      if (input.action === "grant") {
        if (!SCOPE_TYPES_OF_ROLE[input.role].includes(input.scopeType)) {
          throw new AppError("invalid-argument", "This role cannot be granted for a scope of this kind.");
        }
        if (!(await scopeExists(db, transaction, input))) {
          throw new AppError("not-found", "The replication, laboratory or group of this role does not exist.");
        }
      } else if (input.action === "approve" && stored.data?.status !== "pendingApproval") {
        if (inForce(stored.data, at)) return { assignmentId: id, status: "active" as const };
        throw new AppError("failed-precondition", "This role is not waiting for approval any more.");
      } else if (input.action === "revoke" && stored.data?.status === "revoked") {
        return { assignmentId: id, status: "revoked" as const };
      }
      const draft = await draftAccess(db, transaction, target.uid, at);
      if (draft === null) {
        throw new AppError("not-found", "This account does not exist, or it has never started the portal.");
      }
      if (
        input.action === "revoke" &&
        target.role === "programme_admin" &&
        inForce(stored.data, at) &&
        (await otherAdministrators(db, transaction, target.uid, at)).length === 0
      ) {
        throw new AppError("failed-precondition", LAST_ADMINISTRATOR_MESSAGE);
      }

      // The stamp needs the audit entry, and the entry needs to know what changes: plan first.
      const planned = callerStamp(actor, at, null);
      if (input.action === "revoke") {
        next = stored.data === null ? null : revokedAssignment(stored.data, input.reason, planned);
      } else {
        next = nextAssignment(
          stored.data,
          {
            ...target,
            status: "active",
            reason: input.action === "grant" ? input.reason : undefined,
            expiresAt,
          },
          planned,
        );
      }
      if (next === null) return { assignmentId: id, status: stored.data?.status ?? "expired" };

      const action = input.action === "revoke" ? "role.revoked" : "role.granted";
      const auditEventId = writeAudit(
        transaction,
        {
          action,
          actor: { kind: "user", uid: actor },
          entityType: "user",
          entityId: target.uid,
          changes: [
            { field: "role", after: target.role },
            { field: "scopeType", after: target.scopeType },
            { field: "scopeId", after: target.scopeId },
            { field: "status", before: stored.data?.status ?? null, after: next.status },
            ...(input.action === "revoke" ? [{ field: "reason", after: input.reason }] : []),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      const document = { ...next, writeContext: stamp.writeContext };
      transaction.set(stored.reference, document);
      draft.inputs = withAssignment(draft.inputs, document);
      commitAccess(db, transaction, draft, stamp);
      if (target.uid !== actor) {
        writeNotification(
          db,
          transaction,
          {
            uid: target.uid,
            type: "roleDecision",
            entityType: "user",
            entityId: target.uid,
            eventId: auditEventId,
            payload: {
              kind: input.action === "revoke" ? "roleRevoked" : "roleGranted",
              role: target.role,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
            },
          },
          stamp,
        );
      }
      return { assignmentId: id, status: next.status };
    });
  },
});
