import { COLLECTIONS, controlSyncRunContract, parseStoredDocument, syncRunDocSchema } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, defineCallable, writeAudit } from "../framework";
import { requireIntegrationsManager } from "../integrations/support";

/**
 * Retries a run that failed, was dead-lettered or waits for its next attempt, or cancels one
 * that has not started, for holders of `integrations.manage`. A retry by hand puts the run back
 * in the queue at once with one more attempt allowed, once the person has dealt with the cause.
 */
export const controlSyncRun = defineCallable(controlSyncRunContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const reference = db.doc(COLLECTIONS.syncRuns.docPath(input.runId));
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      await requireIntegrationsManager(db, context, transaction);
      const run = parseStoredDocument(syncRunDocSchema, (await transaction.get(reference)).data());
      if (!run.success) throw new AppError("not-found", "This run does not exist.");
      const retry = input.action === "retry";
      const allowed = retry ? ["failed", "deadLetter", "retrying"] : ["queued", "retrying"];
      if (!allowed.includes(run.data.status)) {
        throw new AppError(
          "failed-precondition",
          retry
            ? "Only a run that failed or waits for a retry can be retried."
            : "Only a run that has not started can be cancelled.",
        );
      }
      const status = retry ? "queued" : "cancelled";
      writeAudit(
        transaction,
        {
          action: retry ? "syncRun.retried" : "syncRun.cancelled",
          actor: { kind: "user", uid },
          entityType: "syncRun",
          entityId: input.runId,
          changes: [{ field: "status", before: run.data.status, after: status }],
          at,
        },
        db,
      );
      const now = Timestamp.fromDate(at);
      transaction.update(reference, {
        status,
        nextAttemptAt: null,
        ...(retry
          ? { maxAttempts: Math.min(20, Math.max(run.data.maxAttempts, run.data.attempts + 1)) }
          : { finishedAt: now }),
        updatedAt: now,
        updatedBy: uid,
      });
      return { status } as const;
    });
  },
});
