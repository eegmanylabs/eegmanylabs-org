// The status history of a dataset: one entry for each change of its workflow state, read by
// every member as the dataset is, and written in the transaction of the change.
import { COLLECTIONS, type DatasetDoc, MEMBERS_SCOPE_KEY, unitScopeKeys } from "@eegml/shared";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { WriteStamp } from "../framework/documents";

export function writeStatusHistory(
  db: Firestore,
  transaction: Transaction,
  dataset: { readonly id: string; readonly data: Pick<DatasetDoc, "replicationId" | "laboratoryId"> },
  change: { readonly from: string | null; readonly to: string; readonly reason?: string },
  stamp: WriteStamp,
): string {
  const reference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
  const now = Timestamp.fromDate(stamp.at);
  transaction.create(
    reference,
    COLLECTIONS.statusHistory.schema.parse({
      schemaVersion: COLLECTIONS.statusHistory.schemaVersion,
      createdAt: now,
      createdBy: stamp.actor,
      writeContext: stamp.writeContext,
      entityType: "dataset",
      entityId: dataset.id,
      fromStatusKey: change.from,
      toStatusKey: change.to,
      effectiveAt: now,
      recordedAt: now,
      changedBy: stamp.actor,
      ...(change.reason === undefined ? {} : { reason: change.reason }),
      source: "manual",
      replicationId: dataset.data.replicationId,
      laboratoryId: dataset.data.laboratoryId,
      // Every member reads a dataset, and so its history.
      scopeKeys: [...unitScopeKeys(dataset.data.replicationId, dataset.data.laboratoryId), MEMBERS_SCOPE_KEY],
    }),
  );
  return reference.id;
}
