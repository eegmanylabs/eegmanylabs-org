import { COLLECTIONS, datasetTransferDocSchema, requestTransferContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  isCurrent,
  REFERENCE_NOT_FOUND_MESSAGE,
  readDataset,
  readRefs,
  requireActive,
  requireForDataset,
  scopeFieldsOf,
} from "../datasets/model";
import { sameFolder } from "../datasets/refs";
import { AppError, callerStamp, createdFields, defineCallable, readAccessDocument, writeAudit } from "../framework";

/**
 * Requests a transfer of a dataset from one of its copies to another (docs/INTEGRATIONS.md,
 * section 7), for a holder of `datasets.manage` for the dataset's replication or laboratory. The
 * portal moves no data. Raw research data moves only after approval, so the request waits for
 * someone else who manages the dataset to approve it (`advanceTransfer`); people then carry it
 * out with their institutions' own tools and record its progress. Both copies must be current
 * and in different places (another server, or another folder of the same server), and the destination copy is registered first, with its availability unknown
 * until a listing shows the data there.
 */
export const requestTransfer = defineCallable(requestTransferContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    if (input.fromRefId === input.toRefId)
      throw new AppError("invalid-argument", "A transfer goes from one copy to another.");
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      const refs = await readRefs(db, transaction, input.datasetKey);
      const [from, to] = [input.fromRefId, input.toRefId].map((id) => {
        const ref = refs.find((candidate) => candidate.id === id);
        if (ref === undefined || !isCurrent(ref.data)) throw new AppError("not-found", REFERENCE_NOT_FOUND_MESSAGE);
        return ref;
      });
      if (from !== undefined && to !== undefined && (await sameFolder(db, transaction, input.datasetKey, from, to))) {
        throw new AppError(
          "failed-precondition",
          "The two copies name the same folder of the same server, so nothing can move between them.",
        );
      }
      const reference = db.collection(COLLECTIONS.datasetTransfers.collectionPath(input.datasetKey)).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "transfer.requested",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "transferId", after: reference.id },
            { field: "fromRefId", after: input.fromRefId },
            { field: "toRefId", after: input.toRefId },
            { field: "reason", after: input.reason },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      transaction.create(
        reference,
        datasetTransferDocSchema.parse({
          ...createdFields("datasetTransfers", stamp),
          datasetId: input.datasetKey,
          fromRefId: input.fromRefId,
          toRefId: input.toRefId,
          status: "initiated",
          approval: "pending",
          reason: input.reason,
          initiatedBy: context.uid,
          initiatedAt: Timestamp.fromDate(at),
          decidedBy: null,
          decidedAt: null,
          ...scopeFieldsOf(dataset.data),
        }),
      );
      return { transferId: reference.id };
    });
  },
});
