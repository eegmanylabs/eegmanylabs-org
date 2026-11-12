import {
  COLLECTIONS,
  mappingProblems,
  parseStoredDocument,
  saveSyncMappingContract,
  sourceDocSchema,
  syncMappingDocSchema,
  syncMappingId,
} from "@eegml/shared";

import { AppError, callerStamp, createdFields, defineCallable, touchedFields, writeAudit } from "../framework";
import { requireIntegrationsManager } from "../integrations/support";

/**
 * Creates or changes a mapping of a sheet tab to a portal collection (docs/INTEGRATIONS.md,
 * section 3.3), for holders of `integrations.manage`.
 *
 * The source must be a registered Google Sheet with the tab registered beneath it, so a mapping
 * names a source and a tab and never an address. Its fields are checked against the
 * synchronisation targets, so only listed fields can be mapped and never a special-category or
 * restricted one. A new mapping starts as a dry run, and a changed one returns to a dry run,
 * because an approval of live writes covers the mapping as it was approved.
 */
export const saveSyncMapping = defineCallable(saveSyncMappingContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const problems = mappingProblems(input.collectionKey, input.keyColumn, input.columns);
    if (problems.length > 0) throw new AppError("invalid-argument", problems.join(" "));
    const derived = syncMappingId(input.sourceKey, input.tabKey, input.collectionKey);
    if (input.mappingId !== undefined && input.mappingId !== derived) {
      throw new AppError(
        "invalid-argument",
        "The source, the tab and the collection of a mapping never change. Create another mapping.",
      );
    }
    const reference = db.doc(COLLECTIONS.syncMappings.docPath(derived));
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      await requireIntegrationsManager(db, context, transaction);
      const [source, tab, existing] = await Promise.all([
        transaction.get(db.doc(COLLECTIONS.sources.docPath(input.sourceKey))),
        transaction.get(db.doc(COLLECTIONS.sourceTabs.docPath(input.sourceKey, input.tabKey))),
        transaction.get(reference),
      ]);
      const parsedSource = parseStoredDocument(sourceDocSchema, source.data());
      if (!parsedSource.success || parsedSource.data.kind !== "googleSheet") {
        throw new AppError("failed-precondition", "The source is not a registered Google Sheet.");
      }
      if (!tab.exists) throw new AppError("failed-precondition", "The tab is not registered for this source.");
      if (input.mappingId === undefined && existing.exists) {
        throw new AppError(
          "already-exists",
          "This tab is mapped to this collection already. Change that mapping instead.",
        );
      }
      if (input.mappingId !== undefined && !existing.exists)
        throw new AppError("not-found", "This mapping does not exist.");
      const settings = {
        name: input.name,
        keyColumn: input.keyColumn,
        columnMap: input.columns,
        sheetOnlyRows: input.sheetOnlyRows,
        appOnlyRecords: input.appOnlyRecords,
        cellCeiling: input.cellCeiling,
      };
      const auditEventId = writeAudit(
        transaction,
        {
          action: "syncMapping.saved",
          actor: { kind: "user", uid },
          entityType: "syncMapping",
          entityId: derived,
          changes: [
            { field: "columnMap", after: input.columns.map((column) => `${column.field}: ${column.direction}`) },
            { field: "mode", after: "dryRun" },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      if (existing.exists) {
        transaction.update(reference, {
          ...settings,
          mode: "dryRun",
          approvedBy: null,
          approvedAt: null,
          ...touchedFields(stamp),
        });
      } else {
        transaction.create(
          reference,
          syncMappingDocSchema.parse({
            ...createdFields("syncMappings", stamp),
            ...settings,
            connectionId: "googleSheets",
            sourceKey: input.sourceKey,
            tabKey: input.tabKey,
            collectionKey: input.collectionKey,
            keyStrategy: "keyColumn",
            mode: "dryRun",
            status: "active",
            approvedBy: null,
            approvedAt: null,
            lastRunId: null,
            lastRunAt: null,
            lastSuccessAt: null,
          }),
        );
      }
      return { mappingId: derived, created: !existing.exists };
    });
  },
});
