import {
  COLLECTIONS,
  parseStoredDocument,
  resolveSyncReviewItemContract,
  syncReviewItemDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, defineCallable, writeAudit } from "../framework";
import { requireIntegrationsManager } from "../integrations/support";

/**
 * Settles a review item of a mapping, for holders of `integrations.manage`, with a note.
 *
 * | Action      | For             | Effect                                                         |
 * |-------------|-----------------|----------------------------------------------------------------|
 * | `dismiss`   | Any item        | The item is closed and is not raised again                     |
 * | `forgetRow` | `missingRow`    | The stored state of the row is forgotten, so the next run appends the row again from the portal |
 * | `clearMark` | `unstableCell`  | The cell may be written again                                  |
 *
 * Nothing in the sheet or in the portal is deleted.
 */
export const resolveSyncReviewItem = defineCallable(resolveSyncReviewItemContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const reference = db.doc(COLLECTIONS.syncReviewItems.docPath(input.itemId));
    const at = context.clock.now();
    await requireIntegrationsManager(db, context);
    const item = parseStoredDocument(syncReviewItemDocSchema, (await reference.get()).data());
    if (!item.success) throw new AppError("not-found", "This review item does not exist.");
    if (item.data.status !== "open")
      throw new AppError("failed-precondition", "This review item has been settled already.");
    if (input.action === "forgetRow" && (item.data.kind !== "missingRow" || item.data.rowKey === undefined)) {
      throw new AppError("invalid-argument", "Only the state of a row that has gone can be forgotten.");
    }
    if (input.action === "clearMark" && (item.data.kind !== "unstableCell" || item.data.rowKey === undefined)) {
      throw new AppError("invalid-argument", "Only the mark of an unstable cell can be cleared.");
    }
    const states =
      input.action === "dismiss"
        ? []
        : (
            await db
              .collection(COLLECTIONS.syncMappingCellState.collectionPath(item.data.mappingId))
              .where("rowKey", "==", item.data.rowKey ?? "")
              .get()
          ).docs.filter((state) => input.action === "forgetRow" || state.get("field") === item.data.field);
    const now = Timestamp.fromDate(at);
    const batch = db.batch();
    for (const state of states) {
      if (input.action === "forgetRow") batch.delete(state.ref);
      else batch.update(state.ref, { unstable: false, updatedAt: now, updatedBy: uid });
    }
    const resolution =
      input.action === "dismiss" ? "dismissed" : input.action === "forgetRow" ? "rowForgotten" : "markCleared";
    const status = input.action === "dismiss" ? "dismissed" : "resolved";
    writeAudit(
      batch,
      {
        action: "syncReviewItem.resolved",
        actor: { kind: "user", uid },
        entityType: "syncReviewItem",
        entityId: input.itemId,
        changes: [
          { field: "status", before: "open", after: status },
          { field: "note", after: input.note },
        ],
        at,
      },
      db,
    );
    batch.update(reference, {
      status,
      resolution,
      resolvedBy: uid,
      resolvedAt: now,
      note: input.note,
      updatedAt: now,
      updatedBy: uid,
    });
    await batch.commit();
    return { status } as const;
  },
});
