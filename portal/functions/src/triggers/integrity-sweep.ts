// The scheduled referential-integrity checker (docs/DATA_MODEL.md, section 14).
import { FUNCTIONS_REGION, FUNCTIONS_SERVICE_ACCOUNT } from "@eegml/shared";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { runIntegrityCheck } from "../integrity/run";

/**
 * Runs once a day, at night in London, and writes one `integrityReports` document with its
 * findings. It only reads and reports: a person decides what to correct.
 */
export const integritySweep = onSchedule(
  {
    schedule: "every day 03:17",
    timeZone: "Europe/London",
    region: FUNCTIONS_REGION,
    serviceAccount: FUNCTIONS_SERVICE_ACCOUNT,
    retryCount: 1,
  },
  async (event) => {
    const summary = await runIntegrityCheck(firestore(), new Date(event.scheduleTime));
    logger.info("integrity check finished", { ...summary });
  },
);
