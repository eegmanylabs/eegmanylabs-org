import {
  COLLECTIONS,
  MEMBERS_SCOPE_KEY,
  parseStoredDocument,
  replicationScopeKey,
  setReplicationStatusContract,
  statusDefinitionDocSchema,
  statusDefinitionId,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

const CHANGED_MESSAGE =
  "The status of this replication has changed since you saw it, so nothing was changed. Reload the page and look at it again.";
const SAME_MESSAGE = "The replication already has this status. Choose another status to change it.";
const UNKNOWN_STATUS_MESSAGE =
  "This status is not one the programme uses for replications. Reload the page and choose again.";

/**
 * Changes the status of a replication. The security rules refuse every client write to the
 * status fields and to the status history, so this function is the only way a status changes
 * (decision D-019).
 *
 * | Caller                                                    | May change                       |
 * |-----------------------------------------------------------|----------------------------------|
 * | A holder of `replications.manage` for the replication     | Its status: the leads of the replication, the core team and programme administrators, with the second factor where the access document requires one |
 *
 * The call states the status the caller saw, and the stored status must still be that one. The
 * new status is a status of `statusDefinitions` for replications that is not archived, and it
 * differs from the current one. In one transaction the function sets `statusKey` and
 * `statusHistoryId` on the replication, creates the entry of the status history, which every
 * member reads as the replication, and writes the audit entry. An archived replication is
 * frozen and keeps its status.
 */
export const setReplicationStatus = defineCallable(setReplicationStatusContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const replicationReference = db.doc(COLLECTIONS.replications.docPath(input.replicationId));
    const definitionReference = db.doc(
      COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("replication", input.toStatusKey)),
    );
    const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, actor, transaction);
      requireCapability(context, access, "replications.manage", { replicationId: input.replicationId });
      const [replication, definition] = await transaction.getAll(replicationReference, definitionReference);
      if (replication === undefined || definition === undefined) {
        throw new Error("The transaction returned no snapshot.");
      }
      if (!replication.exists) throw new AppError("not-found", "This replication does not exist.");
      if (replication.get("archivedAt") != null) {
        throw new AppError("failed-precondition", "This replication is archived, so its status cannot change.");
      }
      const current = (replication.get("statusKey") as string | null | undefined) ?? null;
      if (current !== input.fromStatusKey) throw new AppError("failed-precondition", CHANGED_MESSAGE);
      if (current === input.toStatusKey) throw new AppError("failed-precondition", SAME_MESSAGE);
      const parsed = definition.exists ? parseStoredDocument(statusDefinitionDocSchema, definition.data()) : null;
      if (parsed === null || !parsed.success || parsed.data.archivedAt !== null) {
        throw new AppError("invalid-argument", UNKNOWN_STATUS_MESSAGE);
      }

      const auditEventId = writeAudit(
        transaction,
        {
          action: "replication.statusChanged",
          actor: { kind: "user", uid: actor },
          entityType: "replication",
          entityId: input.replicationId,
          changes: [
            { field: "statusKey", before: current, after: input.toStatusKey },
            {
              field: "statusHistoryId",
              before: replication.get("statusHistoryId") ?? null,
              after: historyReference.id,
            },
            { field: "reason", after: input.reason },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      const now = Timestamp.fromDate(at);
      const entry = COLLECTIONS.statusHistory.schema.parse({
        schemaVersion: COLLECTIONS.statusHistory.schemaVersion,
        createdAt: now,
        createdBy: actor,
        writeContext: stamp.writeContext,
        entityType: "replication",
        entityId: input.replicationId,
        fromStatusKey: current,
        toStatusKey: input.toStatusKey,
        effectiveAt: now,
        recordedAt: now,
        changedBy: actor,
        reason: input.reason,
        source: "manual",
        replicationId: input.replicationId,
        laboratoryId: null,
        // Every member reads a replication, and so its history.
        scopeKeys: [replicationScopeKey(input.replicationId), MEMBERS_SCOPE_KEY],
      });
      transaction.create(historyReference, entry);
      transaction.update(replicationReference, {
        statusKey: input.toStatusKey,
        statusHistoryId: historyReference.id,
        ...touchedFields(stamp),
      });
      return { replicationId: input.replicationId, statusKey: input.toStatusKey, statusHistoryId: historyReference.id };
    });
  },
});
