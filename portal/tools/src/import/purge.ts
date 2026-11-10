// Removal of the special-category copies that an import keeps beside its records
// (docs/MIGRATION_PLAN.md, section 10): the cells of a row that waits in the queue, beneath its
// source record, and the two states of a special-category document that the change log keeps for
// a rollback. Both sit where no client reads them. They are removed on the decision of an
// administrator, for a source as a whole or for one batch, and nothing else is touched: the
// source records, the change log and the demographics documents themselves stay.
//
// A batch whose kept states are gone can no longer be rolled back, and the rollback says so.
import { COLLECTIONS } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { chunked, readDocuments } from "./context";

export interface PurgeScope {
  /** Every record and every batch of this source. */
  readonly sourceKey?: string;
  /** One batch: the states it kept, and the cells it stored beneath source records. */
  readonly batchId?: string;
}

export interface PurgeResult {
  /** The documents `sourceRecords/{id}/special/raw` that were removed. */
  readonly cellsRemoved: number;
  /** The documents `importBatches/{batchId}/changes/{n}/special/state` that were removed. */
  readonly statesRemoved: number;
}

export async function purgeSpecial(db: Firestore, scope: PurgeScope): Promise<PurgeResult> {
  const batchIds: string[] = [];
  const cellPaths = new Set<string>();
  if (scope.batchId !== undefined) batchIds.push(scope.batchId);
  if (scope.sourceKey !== undefined) {
    const batches = await db
      .collection(COLLECTIONS.importBatches.collectionPath())
      .where("sourceKey", "==", scope.sourceKey)
      .select()
      .get();
    batchIds.push(...batches.docs.map((doc) => doc.id));
    const records = await db
      .collection(COLLECTIONS.sourceRecords.collectionPath())
      .where("sourceKey", "==", scope.sourceKey)
      .select()
      .get();
    for (const record of records.docs) cellPaths.add(COLLECTIONS.sourceRecordSpecial.docPath(record.id));
  }
  const statePaths: string[] = [];
  const cellsPrefix = `${COLLECTIONS.sourceRecords.collectionPath()}/`;
  for (const batchId of [...new Set(batchIds)].sort()) {
    const changes = await db.collection(COLLECTIONS.importBatchChanges.collectionPath(batchId)).select().get();
    const states = await readDocuments(
      db,
      changes.docs.map((change) => COLLECTIONS.importBatchChangeState.docPath(batchId, change.id)),
    );
    for (const [path, state] of states) {
      if (state === null) continue;
      statePaths.push(path);
      // The cells that this batch stored beneath a source record are named by the state it kept.
      const documentPath = state.data.documentPath as string | undefined;
      if (documentPath?.startsWith(cellsPrefix) && documentPath.endsWith("/special/raw")) cellPaths.add(documentPath);
    }
  }
  const existing = await readDocuments(db, [...cellPaths]);
  const cells = [...existing].filter(([, stored]) => stored !== null).map(([path]) => path);
  for (const piece of chunked([...cells, ...statePaths])) {
    const batch = db.batch();
    for (const path of piece) batch.delete(db.doc(path));
    await batch.commit();
  }
  return { cellsRemoved: cells.length, statesRemoved: statePaths.length };
}
