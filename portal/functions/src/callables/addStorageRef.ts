import { addStorageRefContract } from "@eegml/shared";
import {
  availabilityOf,
  readDataset,
  readEndpoint,
  readRefs,
  requireActive,
  requireForDataset,
} from "../datasets/model";
import { createRef, placeCopy, requireOpenEndpoint } from "../datasets/refs";
import {
  callerStamp,
  defineCallable,
  readAccessDocument,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";

/**
 * Adds a copy of a dataset on a storage server of the portal (docs/DATA_MODEL.md, section 10),
 * for a holder of `datasets.manage` for the dataset's replication or laboratory: a primary copy,
 * a mirror, a backup or a processing copy. A dataset may have several, and none needs to be
 * central. The path must lie in the folder of the server that belongs to the caller's replication
 * or laboratory and clear every other dataset's copy (`placeCopy`). The copy's path goes where no client reads it; the audit entry names the server and
 * the role and withholds the path. Nothing is transferred: the copy is where people put it.
 */
export const addStorageRef = defineCallable(addStorageRefContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      const endpoint = await readEndpoint(db, transaction, input.endpointKey);
      requireOpenEndpoint(endpoint.data);
      const path = await placeCopy(
        db,
        transaction,
        access,
        dataset,
        { key: input.endpointKey, connection: endpoint.connection },
        input.path,
        null,
      );
      const refs = await readRefs(db, transaction, input.datasetKey);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "storageRef.added",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "endpointKey", after: input.endpointKey },
            { field: "role", after: input.role },
            ...withheldChanges(["location.uri"]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const storageRefId = createRef(
        db,
        transaction,
        dataset,
        {
          endpointKey: input.endpointKey,
          endpointReference: endpoint.reference,
          role: input.role,
          uri: path,
          viewerSupport: input.viewerSupport,
          note: input.note === "" ? null : input.note,
          relocatedFromRefId: null,
        },
        stamp,
      );
      const next = [
        ...refs.map((ref) => ref.data),
        { availability: "unknown" as const, lastSeenAt: null, validTo: null, archivedAt: null },
      ];
      transaction.update(dataset.reference, { ...availabilityOf(next), ...touchedFields(stamp) });
      return { storageRefId };
    });
  },
});
