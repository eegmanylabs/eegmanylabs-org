// What happens to an export after its pull request is open: the portal learns of a merge or a
// closing by reading the pull request, since nothing in the portal receives notifications from
// GitHub (docs/INTEGRATIONS.md, section 6). A person asks with `refreshPublication`, and the
// scheduled `publicationsSweep` asks every hour for every export that waits.
import { COLLECTIONS, type PublicationBatchStatus, systemActor } from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { type AuditActor, writeAudit } from "../framework";
import { callerStamp, touchedFields, type WriteStamp } from "../framework/documents";
import type { WebsiteRepository } from "../integrations/github/types";
import { readBatch } from "./model";

/** The states in which an export still waits on GitHub. */
export function waitsOnGitHub(status: PublicationBatchStatus, rollbackOpen: boolean): boolean {
  return status === "staged" || (status === "published" && rollbackOpen);
}

/**
 * Reads the pull request of an export, or of its rollback, and records what a maintainer did
 * with it. Answers the status the export ends in. An export that waits on nothing is left as it is.
 */
export async function refreshBatch(
  db: Firestore,
  repository: WebsiteRepository,
  batchId: string,
  actor: AuditActor,
  at: Date,
): Promise<PublicationBatchStatus> {
  const before = await readBatch(db, batchId);
  const rollbackNumber = before.data.rollbackPullRequestNumber;
  const watching =
    before.data.status === "staged"
      ? before.data.pullRequestNumber
      : before.data.status === "published" && before.data.rolledBackAt === null
        ? rollbackNumber
        : undefined;
  if (watching === undefined) return before.data.status;
  const pull = await repository.pullRequest(watching);
  return db.runTransaction(async (transaction) => {
    const batch = await readBatch(db, batchId, transaction);
    if (batch.data.status !== before.data.status) return batch.data.status;
    let next: PublicationBatchStatus = batch.data.status;
    let changes: Record<string, unknown> = {};
    if (batch.data.status === "staged" && pull.state === "merged") {
      next = "published";
      changes = {
        publishedAt: Timestamp.fromDate(at),
        ...(pull.mergeCommitSha === null ? {} : { commitRef: pull.mergeCommitSha }),
      };
    } else if (batch.data.status === "staged" && pull.state === "closed") {
      next = "withdrawn";
      changes = { statusReason: "The pull request was closed without being merged." };
    } else if (batch.data.status === "published" && pull.state === "merged") {
      next = "rolledBack";
      changes = { rolledBackAt: Timestamp.fromDate(at), rolledBackBy: systemActor("websiteMaintainer") };
    } else if (batch.data.status === "published" && pull.state === "closed") {
      // A rollback that a maintainer declined leaves the publication in place, and a new one may be proposed.
      changes = { rollbackPullRequestNumber: null, rollbackPullRequestUrl: null };
    } else {
      return batch.data.status;
    }
    const auditEventId = writeAudit(
      transaction,
      {
        action: "publication.refreshed",
        actor,
        entityType: "publicationBatch",
        entityId: batchId,
        changes: [{ field: "status", before: batch.data.status, after: next }],
        at,
      },
      db,
    );
    const stamp: WriteStamp =
      actor.kind === "user"
        ? callerStamp(actor.uid, at, auditEventId)
        : {
            at,
            actor: systemActor("publicationsSweep"),
            writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId },
          };
    const cleared = Object.fromEntries(
      Object.entries(changes).map(([field, value]) => [field, value === null ? FieldValue.delete() : value]),
    );
    transaction.update(batch.reference, { status: next, ...cleared, ...touchedFields(stamp) });
    return next;
  });
}

/** Refreshes every export that waits on GitHub. Answers how many changed. */
export async function sweepPublications(db: Firestore, repository: WebsiteRepository, at: Date): Promise<number> {
  const waiting = await db
    .collection(COLLECTIONS.publicationBatches.collectionPath())
    .where("status", "in", ["staged", "published"])
    .limit(200)
    .get();
  let changed = 0;
  for (const document of waiting.docs) {
    const status = document.get("status") as PublicationBatchStatus;
    if (!waitsOnGitHub(status, typeof document.get("rollbackPullRequestNumber") === "number")) continue;
    const next = await refreshBatch(db, repository, document.id, { kind: "system" }, at);
    if (next !== status) changed += 1;
  }
  return changed;
}
