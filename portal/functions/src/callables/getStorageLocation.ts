import {
  COLLECTIONS,
  datasetStorageRefLocationDocSchema,
  getStorageLocationContract,
  parseStoredDocument,
} from "@eegml/shared";
import { recordAccess } from "../datasets/access-events";
import { REFERENCE_NOT_FOUND_MESSAGE, readDataset, readEndpoint, readRefs, requireForDataset } from "../datasets/model";
import { AppError, callerStamp, defineCallable, readAccessDocument, writeAudit } from "../framework";

/**
 * Gives the location of a copy of a dataset and how its server is reached (docs/DATA_MODEL.md,
 * section 10), to a holder of `datasets.paths.read` for the dataset's replication or laboratory:
 * its leads, the coordinators of the laboratory, programme administrators and the core team. A
 * closed copy can be read too, which is how the history of a relocation is followed.
 *
 * The location and the connection are restricted, and no client reads them directly. This
 * function writes two access events, one for the location and one for the connection of the
 * server, and the audit entry, in the transaction that serves them, so every read is on record.
 * The name of the secret that holds the credential is never served.
 */
export const getStorageLocation = defineCallable(getStorageLocationContract, {
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
      if (ref === undefined) throw new AppError("not-found", REFERENCE_NOT_FOUND_MESSAGE);
      const location = parseStoredDocument(
        datasetStorageRefLocationDocSchema,
        (await transaction.get(db.doc(COLLECTIONS.datasetStorageRefLocation.docPath(input.datasetKey, ref.id)))).data(),
      );
      if (!location.success) throw new AppError("not-found", "This copy has no recorded location.");
      const endpoint = await readEndpoint(db, transaction, ref.data.endpointKey);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "storageLocation.viewed",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "storageRefId", after: ref.id },
            { field: "endpointKey", after: ref.data.endpointKey },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      recordAccess(db, transaction, dataset, context.uid, "viewLocation", ref.id, stamp);
      recordAccess(db, transaction, dataset, context.uid, "viewConnection", ref.data.endpointKey, stamp);
      return {
        uri: location.data.uri,
        endpointName: endpoint.data.name,
        protocol: endpoint.data.protocol,
        host: endpoint.connection?.host ?? null,
        port: endpoint.connection?.port ?? null,
        basePath: endpoint.connection?.basePath ?? null,
      };
    });
  },
});
