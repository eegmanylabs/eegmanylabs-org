import {
  COLLECTIONS,
  datasetDocSchema,
  datasetWorkflowDocSchema,
  parseStoredDocument,
  saveDatasetWorkflowContract,
  workflowProblems,
} from "@eegml/shared";
import { readWorkflow } from "../datasets/model";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

/**
 * Defines the workflow of the datasets of one replication (docs/DATA_MODEL.md, section 10), for a
 * holder of `replications.manage` for the replication: its leads, programme administrators and
 * the core team. The workflow must be sound: keys of its own, transitions between its states, no
 * state that follows itself and every state reachable from the first. A state that a dataset of
 * the replication is in cannot be removed, so no dataset is ever left in a state its workflow
 * does not know. A dataset already registered keeps its state; the first state applies to
 * datasets registered afterwards.
 */
export const saveDatasetWorkflow = defineCallable(saveDatasetWorkflowContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    const problems = workflowProblems(input);
    if (problems.length > 0) throw new AppError("invalid-argument", problems.join(" "));
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      requireCapability(context, access, "replications.manage", { replicationId: input.replicationId });
      const reference = db.doc(COLLECTIONS.datasetWorkflows.docPath(input.replicationId));
      const [replication, stored] = await transaction.getAll(
        db.doc(COLLECTIONS.replications.docPath(input.replicationId)),
        reference,
      );
      if (replication?.exists !== true) throw new AppError("not-found", "This replication does not exist.");
      const previous = await readWorkflow(db, transaction, input.replicationId);
      const datasets = await transaction.get(
        db
          .collection(COLLECTIONS.datasets.collectionPath())
          .where("replicationId", "==", input.replicationId)
          .limit(1_000),
      );
      const kept = new Set(input.states.map((state) => state.key));
      const stranded = new Set<string>();
      for (const snapshot of datasets.docs) {
        const dataset = parseStoredDocument(datasetDocSchema, snapshot.data());
        if (dataset.success && !kept.has(dataset.data.workflowStatusKey)) stranded.add(dataset.data.workflowStatusKey);
      }
      if (stranded.size > 0) {
        throw new AppError(
          "failed-precondition",
          `Datasets of this replication are in ${[...stranded].sort().join(", ")}, so the workflow must keep ${stranded.size === 1 ? "that state" : "those states"}.`,
        );
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "datasetWorkflow.saved",
          actor: { kind: "user", uid: context.uid },
          entityType: "replication",
          entityId: input.replicationId,
          changes: [
            {
              field: "datasetWorkflow.states",
              before: previous.states.map((state) => state.key).join(", "),
              after: input.states.map((state) => state.key).join(", "),
            },
            { field: "datasetWorkflow.initialKey", before: previous.initialKey, after: input.initialKey },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const created = stored?.exists !== true;
      const base = created
        ? createdFields("datasetWorkflows", stamp)
        : {
            schemaVersion: COLLECTIONS.datasetWorkflows.schemaVersion,
            createdAt: stored.get("createdAt"),
            createdBy: stored.get("createdBy"),
            archivedAt: null,
            ...touchedFields(stamp),
          };
      transaction.set(
        reference,
        datasetWorkflowDocSchema.parse({
          ...base,
          replicationId: input.replicationId,
          states: input.states,
          transitions: input.transitions,
          initialKey: input.initialKey,
        }),
      );
      return { replicationId: input.replicationId, created };
    });
  },
});
