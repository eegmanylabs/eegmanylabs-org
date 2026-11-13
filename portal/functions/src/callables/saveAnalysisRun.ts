import {
  type AnalysisRunInput,
  COLLECTIONS,
  can,
  datasetDocSchema,
  datasetManifestDocSchema,
  datasetStorageRefDocSchema,
  parseStoredDocument,
  participationId,
  processingRunDocSchema,
  saveAnalysisRunContract,
  unitScopeKeys,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireSecondFactor,
  touchedFields,
  writeAudit,
} from "../framework";
import { requireReplication } from "../scientific/model";

const RUN_NOT_FOUND_MESSAGE = "This analysis run does not exist.";

/**
 * Records an analysis run or changes one (requirement R12.5): its code and pipeline, its
 * parameters and environment, the datasets it read and what it produced, its quality control and
 * whether it has been reproduced. Capability: `datasets.manage` or `replications.manage` for the
 * replication, or `datasets.manage` for the laboratory of the run.
 *
 * Every dataset read belongs to the run's replication, and to its laboratory where the run names
 * one; a copy named is a copy of that dataset, and the listing of each copy is copied as it
 * stands, so the run says which files it read even after the copy has been listed again. A
 * hypothesis tested is a hypothesis of the replication, and a run reproduced is an earlier run of
 * the same replication. The replication and the laboratory of a run never change, so the
 * permission checked against the unit named in the request is the permission over the stored run.
 */
export const saveAnalysisRun = defineCallable(saveAnalysisRunContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    if (input.startedAt !== null && input.finishedAt !== null && input.finishedAt < input.startedAt) {
      throw new AppError("invalid-argument", "A run cannot finish before it starts.");
    }
    if (new Set(input.inputs.map((item) => item.datasetId)).size !== input.inputs.length) {
      throw new AppError("invalid-argument", "Name each input dataset once.");
    }
    if (input.reproducibilityStatus !== "notAttempted" && input.reproducesRunId === null) {
      throw new AppError("invalid-argument", "Name the run that this one reproduces.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      requireSecondFactor(context, access);
      const forReplication = { replicationId: input.replicationId };
      const allowed =
        can(access, "datasets.manage", forReplication) ||
        can(access, "replications.manage", forReplication) ||
        (input.laboratoryId !== null && can(access, "datasets.manage", { laboratoryId: input.laboratoryId }));
      if (!allowed) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      await requireReplication(db, transaction, input.replicationId);

      const reference =
        input.runId === null
          ? db.collection(COLLECTIONS.processingRuns.collectionPath()).doc()
          : db.doc(COLLECTIONS.processingRuns.docPath(input.runId));
      const existing =
        input.runId === null
          ? null
          : parseStoredDocument(processingRunDocSchema, (await transaction.get(reference)).data());
      if (existing !== null) {
        if (!existing.success || existing.data.replicationId !== input.replicationId) {
          throw new AppError("not-found", RUN_NOT_FOUND_MESSAGE);
        }
        // The unit of a run never changes, and permission was checked against the unit named in
        // the request: a caller who names its own laboratory must not take over a run of the
        // replication as a whole or of another laboratory.
        if (existing.data.laboratoryId !== input.laboratoryId) {
          throw new AppError(
            "invalid-argument",
            "The laboratory of an analysis run does not change. Record a new run for another laboratory.",
          );
        }
        if (existing.data.archivedAt !== null) {
          throw new AppError("failed-precondition", "This analysis run is archived. Restore it before changing it.");
        }
      }
      if (input.laboratoryId !== null) {
        const taking = await transaction.get(
          db.doc(COLLECTIONS.participations.docPath(participationId(input.replicationId, input.laboratoryId))),
        );
        if (!taking.exists) {
          throw new AppError("invalid-argument", "The laboratory named does not take part in this replication.");
        }
      }

      const inputs: AnalysisRunInput[] = [];
      for (const item of input.inputs) {
        const dataset = parseStoredDocument(
          datasetDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.datasets.docPath(item.datasetId)))).data(),
        );
        if (
          !dataset.success ||
          dataset.data.replicationId !== input.replicationId ||
          (input.laboratoryId !== null && dataset.data.laboratoryId !== input.laboratoryId)
        ) {
          throw new AppError("invalid-argument", `The dataset ${item.datasetId} is not one of this replication.`);
        }
        if (item.storageRefId === null) {
          inputs.push({ datasetId: item.datasetId });
          continue;
        }
        const ref = parseStoredDocument(
          datasetStorageRefDocSchema,
          (
            await transaction.get(db.doc(COLLECTIONS.datasetStorageRefs.docPath(item.datasetId, item.storageRefId)))
          ).data(),
        );
        if (!ref.success) {
          throw new AppError("invalid-argument", `The copy named is not a copy of the dataset ${item.datasetId}.`);
        }
        const manifestId = ref.data.latestManifestId;
        const manifest =
          manifestId === null
            ? null
            : parseStoredDocument(
                datasetManifestDocSchema,
                (
                  await transaction.get(db.doc(COLLECTIONS.datasetManifests.docPath(item.datasetId, manifestId)))
                ).data(),
              );
        inputs.push({
          datasetId: item.datasetId,
          storageRefId: item.storageRefId,
          ...(manifest?.success === true && manifestId !== null
            ? {
                manifest: {
                  manifestId,
                  fileCount: manifest.data.fileCount,
                  totalSizeBytes: manifest.data.totalSizeBytes,
                  checksumCount: manifest.data.checksumCount,
                  listedAt: manifest.data.listedAt,
                },
              }
            : {}),
        });
      }
      for (const hypothesisId of input.hypothesisIds) {
        const found = await transaction.get(
          db.doc(COLLECTIONS.replicationHypotheses.docPath(input.replicationId, hypothesisId)),
        );
        if (!found.exists) throw new AppError("invalid-argument", "A hypothesis named is not one of this replication.");
      }
      if (input.reproducesRunId !== null) {
        if (input.reproducesRunId === input.runId) {
          throw new AppError("invalid-argument", "A run cannot reproduce itself.");
        }
        const original = parseStoredDocument(
          processingRunDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.processingRuns.docPath(input.reproducesRunId)))).data(),
        );
        if (!original.success || original.data.replicationId !== input.replicationId) {
          throw new AppError("invalid-argument", "The run reproduced is not a run of this replication.");
        }
      }

      const auditEventId = writeAudit(
        transaction,
        {
          action: "analysisRun.saved",
          actor: { kind: "user", uid: context.uid },
          entityType: "processingRun",
          entityId: reference.id,
          changes: [
            { field: "status", before: existing?.success === true ? existing.data.status : null, after: input.status },
            { field: "inputDatasetIds", after: inputs.map((item) => item.datasetId) },
            { field: "qcStatus", after: input.qcStatus },
            { field: "reproducibilityStatus", after: input.reproducibilityStatus },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const instant = (iso: string | null) => (iso === null ? {} : { value: Timestamp.fromDate(new Date(iso)) });
      const optional = <K extends string, V>(key: K, value: V | null) =>
        (value === null ? {} : { [key]: value }) as Partial<Record<K, V>>;
      const started = instant(input.startedAt);
      const finished = instant(input.finishedAt);
      const content = {
        kind: input.kind,
        ...optional("title", input.title),
        pipelineName: input.pipelineName,
        ...optional("codeUrl", input.codeUrl),
        ...optional("codeCommit", input.codeCommit === null ? null : input.codeCommit.toLowerCase()),
        ...optional("version", input.version),
        ...(Object.keys(input.parameters).length === 0 ? {} : { parameters: input.parameters }),
        ...(Object.keys(input.environment).length === 0 ? {} : { environment: input.environment }),
        status: input.status,
        ...("value" in started ? { startedAt: started.value } : {}),
        ...("value" in finished ? { finishedAt: finished.value } : {}),
        runBy: existing?.success === true ? (existing.data.runBy ?? context.uid) : context.uid,
        ...optional(
          "runByPersonId",
          existing?.success === true && existing.data.runBy !== undefined
            ? (existing.data.runByPersonId ?? null)
            : access.personId,
        ),
        inputs,
        inputDatasetIds: inputs.map((item) => item.datasetId),
        outputs: input.outputs,
        outputDatasetIds: existing?.success === true ? existing.data.outputDatasetIds : [],
        hypothesisIds: input.hypothesisIds,
        outputLinkIds: existing?.success === true ? existing.data.outputLinkIds : [],
        qcStatus: input.qcStatus,
        ...optional("qcNotes", input.qcNotes),
        reproducibilityStatus: input.reproducibilityStatus,
        ...optional("reproducesRunId", input.reproducesRunId),
        ...optional("reproducibilityNotes", input.reproducibilityNotes),
        replicationId: input.replicationId,
        laboratoryId: input.laboratoryId,
        scopeKeys: unitScopeKeys(input.replicationId, input.laboratoryId),
      };
      if (existing === null) {
        transaction.create(
          reference,
          processingRunDocSchema.parse({ ...createdFields("processingRuns", stamp), ...content }),
        );
      } else if (existing.success) {
        // A save states the whole run: what it leaves out is no longer part of it.
        transaction.set(
          reference,
          processingRunDocSchema.parse({
            ...createdFields("processingRuns", stamp),
            createdAt: existing.data.createdAt,
            createdBy: existing.data.createdBy,
            ...content,
            ...touchedFields(stamp),
          }),
        );
      }
      return { runId: reference.id };
    });
  },
});
