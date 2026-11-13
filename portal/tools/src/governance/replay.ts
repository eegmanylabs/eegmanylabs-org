// Applies the governance ledger again after a restore (docs/SECURITY.md, section 10, and
// ops/README.md, "Restoring the live project"). A restore to an earlier moment undoes every
// erasure, revocation and suspension made after it, because they lived in the same database.
// The ledger kept them outside it, and this applies each entry later than the restored moment:
//
// | Entry               | Applied again as |
// |---------------------|------------------|
// | `erasureApplied`    | The same erasure (functions/src/governance/erasure.ts), and its request marked applied where the restore holds it |
// | `roleRevoked`       | The assignment revoked, where it is active or pending again |
// | `capabilityRevoked` | The grant revoked, where it is in force again |
// | `accountSuspended`  | The profile suspended and the Authentication account disabled |
// | `sessionsEnded`     | Covered by the last step, which ends every session |
//
// Then every access document is resolved again, and every session of every account that began
// before the replay is ended, so that no token issued before the restore outlives it. Every
// step can run again: a second replay of the same ledger changes nothing but the session boundary.
import {
  COLLECTIONS,
  capabilityGrantDocSchema,
  type GovernanceLedgerEntry,
  parseStoredDocument,
  roleAssignmentDocSchema,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { touchedFields, type WriteStamp } from "../../../functions/src/framework/documents";
import { applyErasure } from "../../../functions/src/governance/erasure";
import { revokedAssignment } from "../../../functions/src/roles/assignments";
import type { AdminHandles } from "../admin";
import { rebuildAllAccess } from "../commands/access-rebuild";

export const GOVERNANCE_REPLAY_ACTOR = systemActor("governanceReplay");
const REASON = "Applied again from the governance ledger after a restore.";

export interface ReplaySummary {
  erasures: number;
  rolesRevoked: number;
  grantsRevoked: number;
  accountsSuspended: number;
  /** Entries that found nothing left to do, because the restore already held their effect. */
  alreadyApplied: number;
  accessUpdated: number;
  sessionsEnded: number;
}

const ignoreMissingAccount = (error: unknown) => {
  if ((error as { code?: unknown }).code !== "auth/user-not-found") throw error;
};

export async function replayLedger(
  handles: AdminHandles,
  entries: readonly GovernanceLedgerEntry[],
  now: Date,
): Promise<ReplaySummary> {
  const { db, auth } = handles;
  const stamp: WriteStamp = { at: now, actor: GOVERNANCE_REPLAY_ACTOR, writeContext: systemWriteContext() };
  const summary: ReplaySummary = {
    erasures: 0,
    rolesRevoked: 0,
    grantsRevoked: 0,
    accountsSuspended: 0,
    alreadyApplied: 0,
    accessUpdated: 0,
    sessionsEnded: 0,
  };
  for (const entry of entries) {
    switch (entry.kind) {
      case "erasureApplied": {
        await applyErasure(db, auth, entry.personId, stamp);
        const request = db.doc(COLLECTIONS.erasureRequests.docPath(entry.requestId));
        if ((await request.get()).exists) {
          await request.update({ ...touchedFields(stamp), status: "applied", appliedAt: Timestamp.fromDate(now) });
        }
        summary.erasures += 1;
        break;
      }
      case "roleRevoked": {
        const reference = db.doc(COLLECTIONS.roleAssignments.docPath(entry.assignmentId));
        const stored = parseStoredDocument(roleAssignmentDocSchema, (await reference.get()).data());
        const next = stored.success ? revokedAssignment(stored.data, REASON, stamp) : null;
        if (next === null) summary.alreadyApplied += 1;
        else {
          await reference.set(next);
          summary.rolesRevoked += 1;
        }
        break;
      }
      case "capabilityRevoked": {
        const reference = db.doc(COLLECTIONS.capabilityGrants.docPath(entry.grantId));
        const stored = parseStoredDocument(capabilityGrantDocSchema, (await reference.get()).data());
        if (!stored.success || stored.data.revokedAt !== null) summary.alreadyApplied += 1;
        else {
          await reference.update({
            ...touchedFields(stamp),
            revokedBy: GOVERNANCE_REPLAY_ACTOR,
            revokedAt: Timestamp.fromDate(new Date(entry.at)),
          });
          summary.grantsRevoked += 1;
        }
        break;
      }
      case "accountSuspended": {
        const reference = db.doc(COLLECTIONS.users.docPath(entry.uid));
        const user = await reference.get();
        if (!user.exists || user.get("status") === "suspended") summary.alreadyApplied += 1;
        else {
          await reference.update({ ...touchedFields(stamp), status: "suspended" });
          summary.accountsSuspended += 1;
        }
        await auth.updateUser(entry.uid, { disabled: true }).catch(ignoreMissingAccount);
        break;
      }
      case "sessionsEnded":
        summary.alreadyApplied += 1;
        break;
    }
  }

  const rebuilt = await rebuildAllAccess(db, now);
  summary.accessUpdated = rebuilt.created + rebuilt.updated;

  // Every session that began before the replay ends, in whole seconds as endAllSessions does.
  const boundary = Timestamp.fromMillis(Math.floor(now.getTime() / 1000) * 1000);
  const accessDocuments = await db.collection(COLLECTIONS.access.collectionPath()).select().get();
  for (const document of accessDocuments.docs) {
    await document.ref.update({ ...touchedFields(stamp), sessionsValidAfter: boundary });
    await auth.revokeRefreshTokens(document.id).catch(ignoreMissingAccount);
    summary.sessionsEnded += 1;
  }
  return summary;
}
