// The scheduled sweep of recruitment (docs/DATA_MODEL.md, sections 7 and 13).
//
// | Function                       | Runs                    | Does                                                    |
// |--------------------------------|-------------------------|---------------------------------------------------------|
// | `recruitmentInactivitySweep`   | Every day, in the morning in London | Flags collecting participations without a report for `recruitmentInactivityDays` of `system/settings`, 30 where it is not set, with a notification and one follow-up task each |
import { COLLECTIONS, FUNCTIONS_REGION, parseStoredDocument, systemSettingsDocSchema } from "@eegml/shared";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { DEFAULT_INACTIVITY_DAYS, flagInactiveParticipations } from "../recruitment/inactivity";

export const recruitmentInactivitySweep = onSchedule(
  { schedule: "every day 07:43", timeZone: "Europe/London", region: FUNCTIONS_REGION, retryCount: 2 },
  async (event) => {
    const db = firestore();
    const settings = parseStoredDocument(
      systemSettingsDocSchema,
      (await db.doc(COLLECTIONS.systemSettings.docPath()).get()).data(),
    );
    const days = (settings.success ? settings.data.recruitmentInactivityDays : undefined) ?? DEFAULT_INACTIVITY_DAYS;
    const summary = await flagInactiveParticipations(db, new Date(event.scheduleTime), days);
    logger.info("recruitment inactivity sweep finished", { ...summary, days });
  },
);
