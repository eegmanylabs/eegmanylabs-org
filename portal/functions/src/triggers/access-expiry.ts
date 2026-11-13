// The scheduled sweep that ends role assignments and named grants at their expiry time.
import { FUNCTIONS_REGION, FUNCTIONS_SERVICE_ACCOUNT } from "@eegml/shared";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { expireAccess } from "../access/expiry";
import { firestore } from "../framework/admin";

/**
 * Runs every fifteen minutes, so a role or a grant outlives its expiry time by that much at
 * most. The function that serves special-category data does not rely on the sweep: it reads
 * the expiry time of the grant itself on every call.
 */
export const accessExpirySweep = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Europe/London",
    region: FUNCTIONS_REGION,
    serviceAccount: FUNCTIONS_SERVICE_ACCOUNT,
    retryCount: 3,
  },
  async (event) => {
    const summary = await expireAccess(firestore(), new Date(event.scheduleTime), logger);
    logger.info("access expiry sweep finished", { ...summary });
  },
);
