// The end of a role assignment or of a named grant at its expiry time (docs/DATA_MODEL.md,
// section 14: the access resolver "in a scheduled function that expires assignments and grants
// at `expiresAt`").
//
// The resolver lets an expired assignment and an expired grant confer nothing, whatever their
// documents say. The access document is only resolved again when something is written, so a
// scheduled sweep finds what has run out, marks an assignment as `expired` with an audit entry,
// and resolves the access document of each account concerned. A sweep that finds the same
// expired grant again writes nothing.
import {
  COLLECTIONS,
  capabilityGrantDocSchema,
  parseStoredDocument,
  roleAssignmentDocSchema,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "../framework/audit";
import type { Logger } from "../framework/context";
import { touchedFields } from "../framework/documents";
import { commitAccess, draftAccess, rebuildAccess, withAssignment } from "./maintain";

/** The actor recorded on an assignment that the sweep marks as expired. */
export const ACCESS_EXPIRY_ACTOR = systemActor("accessExpiry");

export interface ExpirySummary {
  /** Role assignments that were active and are now marked as expired. */
  expiredAssignments: number;
  /** Accounts whose access document was written because a named grant had run out. */
  accountsWithExpiredGrants: number;
}

/** Ends what has run out by an instant. Safe to run at any time and as often as wanted. */
export async function expireAccess(db: Firestore, at: Date, logger: Logger): Promise<ExpirySummary> {
  const summary: ExpirySummary = { expiredAssignments: 0, accountsWithExpiredGrants: 0 };
  const now = Timestamp.fromDate(at);

  const assignments = await db
    .collection(COLLECTIONS.roleAssignments.collectionPath())
    .where("expiresAt", "<=", now)
    .get();
  for (const found of assignments.docs) {
    if (found.get("status") !== "active") continue;
    const expired = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(found.ref);
      const parsed = parseStoredDocument(roleAssignmentDocSchema, snapshot.data());
      const stored = parsed.success ? parsed.data : null;
      if (stored === null || stored.status !== "active" || stored.expiresAt === null) return false;
      if (stored.expiresAt.toMillis() > at.getTime()) return false;
      const draft = await draftAccess(db, transaction, stored.uid, at);

      const auditEventId = writeAudit(
        transaction,
        {
          action: "role.expired",
          actor: { kind: "system" },
          entityType: "user",
          entityId: stored.uid,
          changes: [
            { field: "role", after: stored.role },
            { field: "scopeType", after: stored.scopeType },
            { field: "scopeId", after: stored.scopeId },
            { field: "status", before: "active", after: "expired" },
          ],
          at,
        },
        db,
      );
      const stamp = { at, actor: ACCESS_EXPIRY_ACTOR, writeContext: systemWriteContext("system", auditEventId) };
      const next = roleAssignmentDocSchema.parse({ ...stored, ...touchedFields(stamp), status: "expired" });
      transaction.set(found.ref, next);
      if (draft !== null) {
        draft.inputs = withAssignment(draft.inputs, next);
        commitAccess(db, transaction, draft, stamp);
      }
      return true;
    });
    if (expired) summary.expiredAssignments += 1;
  }

  const grants = await db.collection(COLLECTIONS.capabilityGrants.collectionPath()).where("expiresAt", "<=", now).get();
  const uids = new Set<string>();
  for (const found of grants.docs) {
    const parsed = parseStoredDocument(capabilityGrantDocSchema, found.data());
    if (parsed.success && parsed.data.revokedAt === null) uids.add(parsed.data.uid);
  }
  for (const uid of uids) {
    if ((await rebuildAccess(db, uid, { at, logger })) === "updated") summary.accountsWithExpiredGrants += 1;
  }
  return summary;
}
