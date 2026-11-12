import { COLLECTIONS, datasetViewerLinkDocSchema, saveViewerLinkContract } from "@eegml/shared";
import { FieldValue } from "firebase-admin/firestore";
import {
  isCurrent,
  REFERENCE_NOT_FOUND_MESSAGE,
  readDataset,
  readRefs,
  requireActive,
  requireForDataset,
} from "../datasets/model";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";

/**
 * Saves the link to a viewer such as ElectroTag for one copy of a dataset (docs/INTEGRATIONS.md,
 * section 7), for a holder of `datasets.manage` for the dataset's replication or laboratory. A
 * viewer is optional and nothing depends on it: a link is accepted only for a copy that declares
 * support for the viewer, and the portal calls no viewer. The address goes where no client reads
 * it and is served, and recorded, by `openViewerLink`. A second link for the same copy and viewer
 * replaces the first.
 */
export const saveViewerLink = defineCallable(saveViewerLinkContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      const ref = (await readRefs(db, transaction, input.datasetKey)).find(
        (candidate) => candidate.id === input.storageRefId,
      );
      if (ref === undefined || !isCurrent(ref.data)) throw new AppError("not-found", REFERENCE_NOT_FOUND_MESSAGE);
      if (!ref.data.viewerSupport.includes(input.tool)) {
        throw new AppError(
          "failed-precondition",
          "This copy does not declare support for this viewer, so no link can be saved for it.",
        );
      }
      const existing = await transaction.get(
        db
          .collection(COLLECTIONS.datasetViewerLinks.collectionPath(input.datasetKey))
          .where("storageRefId", "==", ref.id)
          .where("tool", "==", input.tool)
          .limit(1),
      );
      const auditEventId = writeAudit(
        transaction,
        {
          action: "viewerLink.saved",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "storageRefId", after: ref.id },
            { field: "tool", after: input.tool },
            ...withheldChanges(["url"]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const found = existing.docs[0];
      const reference =
        found?.ref ?? db.collection(COLLECTIONS.datasetViewerLinks.collectionPath(input.datasetKey)).doc();
      if (found === undefined) {
        transaction.create(
          reference,
          datasetViewerLinkDocSchema.parse({
            ...createdFields("datasetViewerLinks", stamp),
            datasetId: input.datasetKey,
            storageRefId: ref.id,
            tool: input.tool,
            url: input.url,
          }),
        );
      } else {
        transaction.update(reference, { url: input.url, ...touchedFields(stamp) });
      }
      transaction.update(ref.reference, {
        viewerLinkTools: FieldValue.arrayUnion(input.tool),
        ...touchedFields(stamp),
      });
      return { linkId: reference.id };
    });
  },
});
