import {
  COLLECTIONS,
  datasetDetailDocSchema,
  datasetDocSchema,
  participationId,
  registerDatasetContract,
  unitScopeKeys,
} from "@eegml/shared";
import { writeStatusHistory } from "../datasets/history";
import { readEndpoint, readWorkflow } from "../datasets/model";
import { createRef, placeCopy, requireOpenEndpoint } from "../datasets/refs";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  writeAudit,
} from "../framework";

/**
 * Registers a dataset in the registry (docs/DATA_MODEL.md, section 10, acceptance scenario 8).
 *
 * | Caller                                                                  | May register                       |
 * |-------------------------------------------------------------------------|------------------------------------|
 * | A holder of `datasets.manage` for the replication or for the laboratory | A dataset of that replication, at that laboratory: its leads, the laboratory's coordinators, programme administrators and the core team |
 *
 * The key is the dataset's permanent identifier and must be new. The dataset starts in the first
 * state of its replication's workflow, with the history entry, and holds no participant
 * identity: free metadata goes into its restricted detail. Where the call names a first copy, the
 * copy is registered on a server of the portal, in the caller's folder there (`placeCopy`), with its location in a document no client reads,
 * and nothing is transferred: data may stay on an institutional server for good.
 */
export const registerDataset = defineCallable(registerDatasetContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    const datasetReference = db.doc(COLLECTIONS.datasets.docPath(input.datasetKey));
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      requireCapability(
        context,
        access,
        "datasets.manage",
        input.laboratoryId === null
          ? { replicationId: input.replicationId }
          : { replicationId: input.replicationId, laboratoryId: input.laboratoryId },
      );
      const references = [
        datasetReference,
        db.doc(COLLECTIONS.replications.docPath(input.replicationId)),
        ...(input.laboratoryId === null
          ? []
          : [
              db.doc(COLLECTIONS.laboratories.docPath(input.laboratoryId)),
              db.doc(COLLECTIONS.participations.docPath(participationId(input.replicationId, input.laboratoryId))),
            ]),
      ];
      const [existing, replication, laboratory, participation] = await transaction.getAll(...references);
      if (existing?.exists === true) {
        throw new AppError("already-exists", "A dataset with this key is in the registry already. Choose another key.");
      }
      if (replication?.exists !== true) throw new AppError("not-found", "This replication does not exist.");
      if (input.laboratoryId !== null && laboratory?.exists !== true) {
        throw new AppError("not-found", "This laboratory does not exist.");
      }
      for (const [id, collection, message] of [
        [input.sourceInstitutionId, COLLECTIONS.institutions, "The source institution is not in the portal."],
        [input.storageOwnerPersonId, COLLECTIONS.persons, "The storage owner is not in the portal."],
      ] as const) {
        if (id !== null && !(await transaction.get(db.doc(collection.docPath(id)))).exists) {
          throw new AppError("invalid-argument", message);
        }
      }
      if (
        input.protocolId !== null &&
        !(
          await transaction.get(db.doc(COLLECTIONS.replicationProtocols.docPath(input.replicationId, input.protocolId)))
        ).exists
      ) {
        throw new AppError("invalid-argument", "The protocol is not one of this replication's protocols.");
      }
      const endpoint = input.storage === null ? null : await readEndpoint(db, transaction, input.storage.endpointKey);
      if (endpoint !== null) requireOpenEndpoint(endpoint.data);
      const path =
        input.storage === null || endpoint === null
          ? null
          : await placeCopy(
              db,
              transaction,
              access,
              { id: input.datasetKey, data: { replicationId: input.replicationId, laboratoryId: input.laboratoryId } },
              { key: input.storage.endpointKey, connection: endpoint.connection },
              input.storage.path,
              null,
            );
      const workflow = await readWorkflow(db, transaction, input.replicationId);

      const auditEventId = writeAudit(
        transaction,
        {
          action: "dataset.registered",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "replicationId", after: input.replicationId },
            { field: "laboratoryId", after: input.laboratoryId },
            { field: "title", after: input.title },
            { field: "workflowStatusKey", after: workflow.initialKey },
            { field: "storage", after: input.storage === null ? null : input.storage.endpointKey },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const data = {
        datasetKey: input.datasetKey,
        replicationId: input.replicationId,
        laboratoryId: input.laboratoryId,
        participationId: participation?.exists === true ? participation.id : null,
      };
      const historyId = writeStatusHistory(
        db,
        transaction,
        { id: input.datasetKey, data },
        { from: null, to: workflow.initialKey },
        stamp,
      );
      const document = datasetDocSchema.parse({
        ...createdFields("datasets", stamp),
        ...data,
        scopeKeys: unitScopeKeys(input.replicationId, input.laboratoryId),
        title: input.title,
        modality: input.modality,
        ...(input.groupingLabel === null ? {} : { groupingLabel: input.groupingLabel }),
        ...(input.sourceInstitutionId === null ? {} : { sourceInstitutionId: input.sourceInstitutionId }),
        ...(input.storageOwnerPersonId === null ? {} : { storageOwnerPersonId: input.storageOwnerPersonId }),
        ...(input.protocolId === null ? {} : { protocolId: input.protocolId }),
        ...(input.expectedFileCount === null ? {} : { expectedFileCount: input.expectedFileCount }),
        ...(input.expectedParticipants === null ? {} : { expectedParticipants: input.expectedParticipants }),
        expectedManifestId: null,
        availability: input.storage === null ? "noStorage" : "unknown",
        lastSeenAt: null,
        workflowStatusKey: workflow.initialKey,
        statusHistoryId: historyId,
        bidsConversionStatus: "notStarted",
        bidsStatus: "notStarted",
        qcStatus: "notStarted",
        analysisReady: false,
        custom: {},
        dataOrigin: "live",
      });
      transaction.create(datasetReference, document);
      transaction.create(
        db.doc(COLLECTIONS.datasetDetail.docPath(input.datasetKey)),
        datasetDetailDocSchema.parse({ ...createdFields("datasetDetail", stamp), metadata: input.metadata }),
      );
      const storageRefId =
        input.storage === null || endpoint === null || path === null
          ? null
          : createRef(
              db,
              transaction,
              { id: input.datasetKey, data: document },
              {
                endpointKey: input.storage.endpointKey,
                endpointReference: endpoint.reference,
                role: input.storage.role,
                uri: path,
                viewerSupport: input.storage.viewerSupport,
                note: null,
                relocatedFromRefId: null,
              },
              stamp,
            );
      return { datasetKey: input.datasetKey, storageRefId };
    });
  },
});
