// The entry of the status history that a change of the status of a participation writes, in the
// transaction of the change (decision D-019). A participation is read by every member, so its
// history carries the key `members` beside the keys of its replication and its laboratory.
import {
  COLLECTIONS,
  MEMBERS_SCOPE_KEY,
  type ParticipationStatus,
  statusHistoryDocSchema,
  unitScopeKeys,
} from "@eegml/shared";
import { type DocumentReference, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { WriteStamp } from "../framework";

export interface ParticipationStatusChange {
  readonly participationId: string;
  readonly replicationId: string;
  readonly laboratoryId: string;
  readonly from: ParticipationStatus | null;
  readonly to: ParticipationStatus;
  readonly reason: string | undefined;
}

/** Creates the history entry of a change of status at a reference the caller chose beforehand. */
export function writeParticipationHistory(
  transaction: Transaction,
  reference: DocumentReference,
  change: ParticipationStatusChange,
  stamp: WriteStamp,
): void {
  const now = Timestamp.fromDate(stamp.at);
  transaction.create(
    reference,
    statusHistoryDocSchema.parse({
      schemaVersion: COLLECTIONS.statusHistory.schemaVersion,
      createdAt: now,
      createdBy: stamp.actor,
      writeContext: stamp.writeContext,
      entityType: "participation",
      entityId: change.participationId,
      fromStatusKey: change.from,
      toStatusKey: change.to,
      effectiveAt: now,
      recordedAt: now,
      changedBy: stamp.actor,
      ...(change.reason === undefined ? {} : { reason: change.reason }),
      source: "manual",
      replicationId: change.replicationId,
      laboratoryId: change.laboratoryId,
      scopeKeys: [...unitScopeKeys(change.replicationId, change.laboratoryId), MEMBERS_SCOPE_KEY],
    }),
  );
}
