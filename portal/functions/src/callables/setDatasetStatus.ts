import {
  canTransition,
  claimsChecksPassed,
  datasetContradictions,
  setDatasetStatusContract,
  workflowState,
} from "@eegml/shared";
import { writeStatusHistory } from "../datasets/history";
import { readDataset, readWorkflow, requireActive, requireForDataset } from "../datasets/model";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";

const CHANGED_MESSAGE =
  "The state of this dataset has changed since you saw it, so nothing was changed. Reload the page and look at it again.";

/**
 * Moves a dataset to another state of its replication's workflow (docs/DATA_MODEL.md, section
 * 10), for a holder of `datasets.manage` for the dataset's replication or laboratory. The call
 * states the state the caller saw, which must still be the stored one, and the workflow must let
 * the new state follow it. In one transaction the function sets the state, whether the dataset
 * is ready for analysis, which the state decides, and the history entry, and writes the audit
 * entry. A state that claims the dataset's checks have passed is refused while its record says
 * otherwise (an invalid BIDS report, a flagged or failed quality control, missing files, copies
 * not all available), unless the caller acknowledges the problems, which the history and the
 * audit entry then keep.
 */
export const setDatasetStatus = defineCallable(setDatasetStatusContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      if (dataset.data.workflowStatusKey !== input.fromStatusKey)
        throw new AppError("failed-precondition", CHANGED_MESSAGE);
      const workflow = await readWorkflow(db, transaction, dataset.data.replicationId);
      if (!canTransition(workflow, input.fromStatusKey, input.toStatusKey)) {
        throw new AppError(
          "failed-precondition",
          "The workflow of this replication does not let a dataset move to that state from this one.",
        );
      }
      const target = workflowState(workflow, input.toStatusKey);
      const analysisReady = target?.analysisReady === true;
      // A state that claims the checks have passed is refused while the record says otherwise,
      // unless the caller acknowledges the problems, which are then kept with the move.
      const contradictions =
        target !== undefined && claimsChecksPassed(target) ? datasetContradictions(dataset.data) : [];
      if (contradictions.length > 0 && input.acknowledgeContradictions !== true) {
        throw new AppError(
          "failed-precondition",
          `This dataset cannot move to ${target?.label ?? input.toStatusKey} unacknowledged: ${contradictions.join(", ")}.`,
        );
      }
      const reason =
        contradictions.length === 0
          ? input.reason
          : `${input.reason} (Moved despite: ${contradictions.join(", ")}.)`.slice(0, 2_000);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "dataset.statusChanged",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "workflowStatusKey", before: input.fromStatusKey, after: input.toStatusKey },
            { field: "analysisReady", before: dataset.data.analysisReady, after: analysisReady },
            { field: "reason", after: reason },
            ...(contradictions.length === 0
              ? []
              : [{ field: "overriddenContradictions", after: contradictions.join("; ") }]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const statusHistoryId = writeStatusHistory(
        db,
        transaction,
        dataset,
        { from: input.fromStatusKey, to: input.toStatusKey, reason },
        stamp,
      );
      transaction.update(dataset.reference, {
        workflowStatusKey: input.toStatusKey,
        statusHistoryId,
        analysisReady,
        ...touchedFields(stamp),
      });
      return { datasetKey: input.datasetKey, statusKey: input.toStatusKey, statusHistoryId, analysisReady };
    });
  },
});
