// The record of a read that only a function can serve (docs/DATA_MODEL.md, section 10). Firestore
// records no read, so every location, connection or viewer link that a function gives out is
// written to the dataset's access events, in the transaction that serves it, beside its audit
// entry. The events are read by the same holders of `datasets.paths.read` who may ask.
import { COLLECTIONS, type DatasetAccessEventDoc } from "@eegml/shared";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { WriteStamp } from "../framework/documents";
import { type StoredDataset, scopeFieldsOf } from "./model";

export function recordAccess(
  db: Firestore,
  transaction: Transaction,
  dataset: StoredDataset,
  uid: string,
  action: DatasetAccessEventDoc["action"],
  targetId: string,
  stamp: WriteStamp,
): void {
  transaction.create(
    db.collection(COLLECTIONS.datasetAccessEvents.collectionPath(dataset.id)).doc(),
    COLLECTIONS.datasetAccessEvents.schema.parse({
      schemaVersion: COLLECTIONS.datasetAccessEvents.schemaVersion,
      createdAt: Timestamp.fromDate(stamp.at),
      createdBy: stamp.actor,
      writeContext: stamp.writeContext,
      datasetId: dataset.id,
      uid,
      action,
      targetId,
      ...scopeFieldsOf(dataset.data),
    }),
  );
}
