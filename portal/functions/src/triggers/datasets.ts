// The scheduled sweep of the dataset registry (docs/INTEGRATIONS.md, sections 7 and 9).
//
// | Function       | Runs                                | Does                                                    |
// |----------------|-------------------------------------|---------------------------------------------------------|
// | `storageSweep` | Every day, at night in London       | Checks every storage server that the portal scans, marks one that is down as unreachable with one notification, and marks one that has come back as active |
import { FUNCTIONS_REGION, FUNCTIONS_SERVICE_ACCOUNT } from "@eegml/shared";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { sweepEndpoints } from "../datasets/endpoints";
import { firestore } from "../framework/admin";

export const storageSweep = onSchedule(
  {
    schedule: "every day 02:17",
    timeZone: "Europe/London",
    region: FUNCTIONS_REGION,
    serviceAccount: FUNCTIONS_SERVICE_ACCOUNT,
    retryCount: 1,
  },
  async (event) => {
    const summary = await sweepEndpoints(firestore(), new Date(event.scheduleTime));
    logger.info("storage sweep finished", { ...summary });
  },
);
