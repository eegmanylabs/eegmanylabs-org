import { COLLECTIONS, parseStoredDocument, requestSyncRunContract, syncMappingDocSchema } from "@eegml/shared";
import { AppError, defineCallable, writeAudit } from "../framework";
import { connectionPaused } from "../integrations/jobs/health";
import { enqueueRun } from "../integrations/jobs/queue";
import { requireIntegrationsManager } from "../integrations/support";

/**
 * Enqueues a run of a mapping now, in the mapping's own mode, for holders of
 * `integrations.manage`: a dry run that shows its plan, or a live run of an approved mapping.
 * A run that already waits is answered instead of a second one. A mapping that needs attention
 * may be run by hand once its cause is dealt with: that run clears the state when it succeeds.
 */
export const requestSyncRun = defineCallable(requestSyncRunContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    await requireIntegrationsManager(db, context);
    const mapping = parseStoredDocument(
      syncMappingDocSchema,
      (await db.doc(COLLECTIONS.syncMappings.docPath(input.mappingId)).get()).data(),
    );
    if (!mapping.success) throw new AppError("not-found", "This mapping does not exist.");
    if (mapping.data.status === "paused")
      throw new AppError("failed-precondition", "This mapping is paused. Resume it first.");
    if (await connectionPaused(db, "googleSheets")) {
      throw new AppError(
        "failed-precondition",
        "Google Sheets is paused, so no run would go ahead. Resume the connection on the overview first.",
      );
    }
    const at = context.clock.now();
    const { runId, created } = await enqueueRun(db, {
      kind: "sheetSync",
      mappingId: input.mappingId,
      mode: mapping.data.mode,
      trigger: "manual",
      eventKey: `manual:${uid}:${at.getTime()}`,
      requestedBy: uid,
      at,
    });
    if (created) {
      const batch = db.batch();
      writeAudit(
        batch,
        {
          action: "syncRun.requested",
          actor: { kind: "user", uid },
          entityType: "syncRun",
          entityId: runId,
          changes: [{ field: "mode", after: mapping.data.mode }],
          at,
        },
        db,
      );
      await batch.commit();
    }
    return { runId, alreadyQueued: !created };
  },
});
