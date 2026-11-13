// The triggers and the schedule of automations and scheduled reports (requirements R15.7,
// R16.9 and R16.10).
//
// | Function                          | Runs on                                   | Does |
// |-----------------------------------|-------------------------------------------|------|
// | `automationsOnLaboratoryWritten`  | A laboratory created or changed           | Starts the rules of `laboratory.activated` when it becomes active |
// | `automationsOnDatasetWritten`     | A dataset created or changed              | Starts the rules of `dataset.dataArrived` when its data first arrives, beside the built-in rule that acts in the listing |
// | `automationsOnSummaryWritten`     | The recruitment summary of a replication  | Starts the rules of `recruitment.targetMet` when the usable participants reach the target |
// | `automationsSchedule`             | Every day, in the morning in London       | Starts the rules of `schedule.daily`, and on Monday those of `schedule.weekly`, which include the flagging of overdue recruitment updates; and runs the scheduled reports that are due |
//
// Every event takes an identifier that names what happened once, and a run takes its identifier
// from its rule and its event, so a delivery that arrives twice starts nothing twice.
import { COLLECTIONS, FUNCTIONS_REGION } from "@eegml/shared";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/firestore";
import { onSchedule as onScheduleTrigger } from "firebase-functions/scheduler";
import { onDatasetWritten, onLaboratoryWritten, onSchedule, onSummaryWritten } from "../automation/events";
import { firestore } from "../framework/admin";
import { documentTrigger } from "../framework/trigger";
import { runDueReports } from "../reports/scheduled";

export const automationsOnLaboratoryWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.laboratories.path),
  async (event) => {
    await onLaboratoryWritten(
      firestore(),
      event.params.laboratoryId,
      event.data?.before.data(),
      event.data?.after.data(),
      new Date(event.time),
    );
  },
);

export const automationsOnDatasetWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.datasets.path),
  async (event) => {
    await onDatasetWritten(
      firestore(),
      event.params.datasetKey,
      event.data?.before.data(),
      event.data?.after.data(),
      new Date(event.time),
    );
  },
);

export const automationsOnSummaryWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.replicationSummaries.path),
  async (event) => {
    await onSummaryWritten(
      firestore(),
      event.params.studyKey,
      event.data?.before.data(),
      event.data?.after.data(),
      new Date(event.time),
    );
  },
);

export const automationsSchedule = onScheduleTrigger(
  { schedule: "every day 07:43", timeZone: "Europe/London", region: FUNCTIONS_REGION, retryCount: 2 },
  async (event) => {
    const db = firestore();
    const at = new Date(event.scheduleTime);
    const queued = await onSchedule(db, at);
    const reports = await runDueReports(db, at);
    logger.info("automations schedule finished", { queued, reports });
  },
);
