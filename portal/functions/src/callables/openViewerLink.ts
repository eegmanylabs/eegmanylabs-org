import { COLLECTIONS, datasetViewerLinkDocSchema, openViewerLinkContract, parseStoredDocument } from "@eegml/shared";
import { recordAccess } from "../datasets/access-events";
import { readDataset, readRefs, requireForDataset } from "../datasets/model";
import { AppError, callerStamp, defineCallable, readAccessDocument, writeAudit } from "../framework";

const NO_LINK_MESSAGE = "No link to this viewer has been saved for this copy.";

/**
 * Gives a holder of `datasets.paths.read` for the dataset's replication or laboratory the link to
 * a viewer for one copy, and records the request in the dataset's access events and the audit
 * trail in the same transaction. The link is offered only where the copy declares support for the
 * viewer; everything else in the registry works without it.
 */
export const openViewerLink = defineCallable(openViewerLinkContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.paths.read", dataset.data);
      const ref = (await readRefs(db, transaction, input.datasetKey)).find(
        (candidate) => candidate.id === input.storageRefId,
      );
      if (ref === undefined || !ref.data.viewerSupport.includes(input.tool))
        throw new AppError("not-found", NO_LINK_MESSAGE);
      const found = await transaction.get(
        db
          .collection(COLLECTIONS.datasetViewerLinks.collectionPath(input.datasetKey))
          .where("storageRefId", "==", ref.id)
          .where("tool", "==", input.tool)
          .limit(1),
      );
      const link = parseStoredDocument(datasetViewerLinkDocSchema, found.docs[0]?.data());
      if (!link.success) throw new AppError("not-found", NO_LINK_MESSAGE);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "viewerLink.opened",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "storageRefId", after: ref.id },
            { field: "tool", after: input.tool },
          ],
          at,
        },
        db,
      );
      recordAccess(
        db,
        transaction,
        dataset,
        context.uid,
        "requestViewerLink",
        found.docs[0]?.id ?? ref.id,
        callerStamp(context.uid, at, auditEventId),
      );
      return { url: link.data.url };
    });
  },
});
