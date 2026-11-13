// Removal of the special-category copies that an import keeps beside its records
// (docs/MIGRATION_PLAN.md, section 10): the cells of a row that waits in the queue, beneath its
// source record, and the two states of a special-category document that the change log keeps for
// a rollback. Both sit where no client reads them. They are removed on the decision of an
// administrator, for a source as a whole, for one batch, or across every batch for the copies that
// may not be held because the person has no consent in force (question 20), and nothing else is
// touched: the source records, the change log and the demographics documents themselves stay.
//
// A batch whose kept states are gone can no longer be rolled back, and the rollback says so.
import { COLLECTIONS, consentInForce, entryOfDocumentPath, isSealedEntry, specialSubjectOf } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { chunked, readDocuments } from "./context";

/** Whether a kept state belongs to a document that a decision of the programme seals. */
function isSealedState(documentPath: unknown): boolean {
  if (typeof documentPath !== "string") return false;
  const matched = entryOfDocumentPath(documentPath);
  return matched !== null && isSealedEntry(matched.entry);
}

export interface PurgeScope {
  /** Every record and every batch of this source. */
  readonly sourceKey?: string;
  /** One batch: the states it kept, and the cells it stored beneath source records. */
  readonly batchId?: string;
  /**
   * Every batch, but only the copies that may not be held (question 20): every kept state of cells
   * beneath a source record, which no rollback writes back any more, and every kept state of a
   * person's values whose consent is not in force.
   */
  readonly withoutConsent?: true;
}

/** Whether a kept state holds values that may not be held: cells beneath a record, or values of a person without consent. */
async function heldWithoutConsent(db: Firestore, documentPath: unknown): Promise<boolean> {
  if (typeof documentPath !== "string") return false;
  const subject = specialSubjectOf(documentPath);
  if (subject === null) return false;
  if (subject.kind === "sourceRecord") return true;
  const consent = await db.doc(COLLECTIONS.personDemographicsConsent.docPath(subject.personId)).get();
  return !consentInForce(consent.data());
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
  if (scope.withoutConsent === true) {
    batchIds.push(
      ...(await db.collection(COLLECTIONS.importBatches.collectionPath()).listDocuments()).map((doc) => doc.id),
    );
  }
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
      // The kept states of a sealed document are no special-category data, and its rollback needs them.
      if (isSealedState(state.data.documentPath)) continue;
      if (scope.withoutConsent === true && !(await heldWithoutConsent(db, state.data.documentPath))) continue;
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
