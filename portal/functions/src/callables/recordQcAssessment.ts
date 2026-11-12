import {
  COLLECTIONS,
  datasetQcAssessmentDocSchema,
  datasetQcTaskId,
  EXCLUSION_REASON_TERM_KIND,
  parseStoredDocument,
  type QcStatus,
  recordQcAssessmentContract,
  recruitmentReportDocSchema,
  vocabularyTermDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { readDataset, requireActive, requireForDataset, scopeFieldsOf } from "../datasets/model";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";
import { isFinished, readTask, recordHistory, statusHistoryEntry, taskStatuses } from "../tasks/model";

/** An outcome in words, for the history of the quality-control task. */
const OUTCOME_WORDS: Readonly<Record<"pass" | "flag" | "fail", string>> = { pass: "pass", flag: "flag", fail: "fail" };

/** The QC status that the outcome of an assessment of the dataset as a whole gives it. */
const STATUS_OF_OUTCOME: Readonly<Record<"pass" | "flag" | "fail", QcStatus>> = {
  pass: "passed",
  flag: "flagged",
  fail: "failed",
};

/**
 * Records a quality-control assessment of a dataset, or of one recording of it
 * (docs/DATA_MODEL.md, section 10), for a holder of `datasets.manage` for the dataset's
 * replication or laboratory. It names the pipeline or tool and its versions, the parameters and
 * metrics, the outcome, the recordings it excludes with their reasons and the deviations it takes
 * into account.
 *
 * Every reference is checked: a reason is a current term of the exclusion reasons that
 * recruitment reports use, a recruitment report and a deviation belong to the dataset's
 * participation, and an assessment that is replaced belongs to the dataset. Assessments never
 * change: a correction is a new assessment that names the one it replaces. The latest assessment
 * of the dataset as a whole sets the dataset's QC status in the same transaction, and moves the
 * dataset's quality-control task on with an entry in its history: in progress while the dataset
 * is flagged or failed, done once it passes.
 */
export const recordQcAssessment = defineCallable(recordQcAssessmentContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    if (input.level === "recording" && input.recordingLabel === null) {
      throw new AppError("invalid-argument", "Name the recording that the assessment is about.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      const participationId = dataset.data.participationId;

      const reasonIds = [
        ...new Set(
          input.exclusions.flatMap((exclusion) =>
            exclusion.reasonTermId === undefined ? [] : [exclusion.reasonTermId],
          ),
        ),
      ];
      const reportIds = [
        ...new Set(
          input.exclusions.flatMap((exclusion) =>
            exclusion.recruitmentReportId === undefined ? [] : [exclusion.recruitmentReportId],
          ),
        ),
      ];
      for (const id of reasonIds) {
        const term = parseStoredDocument(
          vocabularyTermDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.vocabularyTerms.docPath(id)))).data(),
        );
        if (
          !term.success ||
          term.data.kind !== EXCLUSION_REASON_TERM_KIND ||
          term.data.isDeprecated ||
          term.data.archivedAt !== null
        ) {
          throw new AppError(
            "invalid-argument",
            "A reason for exclusion is not one the programme uses. Choose another.",
          );
        }
      }
      for (const id of reportIds) {
        const report = parseStoredDocument(
          recruitmentReportDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.recruitmentReports.docPath(id)))).data(),
        );
        if (!report.success || participationId === null || report.data.participationId !== participationId) {
          throw new AppError(
            "invalid-argument",
            "A recruitment report named by an exclusion is not one of this dataset's participation.",
          );
        }
      }
      for (const id of input.deviationIds) {
        const found =
          participationId !== null &&
          (await transaction.get(db.doc(COLLECTIONS.participationDeviations.docPath(participationId, id)))).exists;
        if (!found) throw new AppError("invalid-argument", "A deviation is not one of this dataset's participation.");
      }
      if (input.supersedesAssessmentId !== null) {
        const replaced = parseStoredDocument(
          datasetQcAssessmentDocSchema,
          (
            await transaction.get(
              db.doc(COLLECTIONS.datasetQcAssessments.docPath(input.datasetKey, input.supersedesAssessmentId)),
            )
          ).data(),
        );
        if (!replaced.success)
          throw new AppError("invalid-argument", "The assessment to replace is not one of this dataset's.");
      }

      // The quality-control task of the dataset follows an assessment of the dataset as a whole:
      // in progress while it is flagged or failed, done once it passes, with its history.
      const qcTask =
        input.level === "dataset" ? await readTask(db, transaction, datasetQcTaskId(input.datasetKey)) : null;
      const statuses = qcTask === null ? null : await taskStatuses(db, transaction);
      const taskTarget = input.outcome === "pass" ? "done" : "inProgress";
      const moveTask =
        qcTask !== null &&
        statuses !== null &&
        qcTask.data.archivedAt === null &&
        !isFinished(statuses.get(qcTask.data.statusKey)) &&
        qcTask.data.statusKey !== taskTarget &&
        statuses.get(taskTarget)?.archivedAt === null;

      const reference = db.collection(COLLECTIONS.datasetQcAssessments.collectionPath(input.datasetKey)).doc();
      const qcStatus = input.level === "dataset" ? STATUS_OF_OUTCOME[input.outcome] : dataset.data.qcStatus;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "qcAssessment.recorded",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "assessmentId", after: reference.id },
            { field: "level", after: input.level },
            { field: "outcome", after: input.outcome },
            { field: "exclusionCount", after: input.exclusions.length },
            { field: "qcStatus", before: dataset.data.qcStatus, after: qcStatus },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      transaction.create(
        reference,
        datasetQcAssessmentDocSchema.parse({
          schemaVersion: COLLECTIONS.datasetQcAssessments.schemaVersion,
          createdAt: Timestamp.fromDate(at),
          createdBy: context.uid,
          writeContext: stamp.writeContext,
          datasetId: input.datasetKey,
          level: input.level,
          ...(input.recordingLabel === null ? {} : { recordingLabel: input.recordingLabel }),
          assessedBy: context.uid,
          ...(input.tool === null ? {} : { tool: input.tool }),
          ...(input.toolVersion === null ? {} : { toolVersion: input.toolVersion }),
          ...(input.pipelineVersion === null ? {} : { pipelineVersion: input.pipelineVersion }),
          ...(Object.keys(input.parameters).length === 0 ? {} : { parameters: input.parameters }),
          outcome: input.outcome,
          ...(Object.keys(input.metrics).length === 0 ? {} : { metrics: input.metrics }),
          ...(input.exclusions.length === 0 ? {} : { exclusions: input.exclusions }),
          ...(input.deviationIds.length === 0 ? {} : { deviationIds: input.deviationIds }),
          ...(input.notes === "" ? {} : { notes: input.notes }),
          assessedAt: Timestamp.fromDate(at),
          ...(input.supersedesAssessmentId === null ? {} : { supersedesAssessmentId: input.supersedesAssessmentId }),
          ...scopeFieldsOf(dataset.data),
        }),
      );
      if (qcStatus !== dataset.data.qcStatus) {
        transaction.update(dataset.reference, { qcStatus, ...touchedFields(stamp) });
      }
      if (qcTask !== null && qcTask.data.archivedAt === null) {
        if (moveTask) {
          const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
          transaction.set(
            historyReference,
            statusHistoryEntry(
              qcTask,
              qcTask.data.statusKey,
              taskTarget,
              context.uid,
              stamp,
              `Quality-control assessment recorded: ${OUTCOME_WORDS[input.outcome]}.`,
            ),
          );
          const done = taskTarget === "done";
          transaction.update(qcTask.reference, {
            statusKey: taskTarget,
            statusHistoryId: historyReference.id,
            completedAt: done ? Timestamp.fromDate(at) : null,
            ...(done ? { progressPercent: 100 } : {}),
            ...touchedFields(stamp),
          });
        }
        recordHistory(
          db,
          transaction,
          auditEventId,
          context.uid,
          "qcAssessment.recorded",
          qcTask,
          moveTask ? ["statusKey"] : [],
          stamp,
        );
      }
      return { assessmentId: reference.id, qcStatus };
    });
  },
});
