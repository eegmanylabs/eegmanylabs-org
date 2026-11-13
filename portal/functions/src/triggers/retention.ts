// The nightly retention sweep (docs/DATA_MODEL.md, section 14). With no period configured it
// deletes nothing and records a run that says so.
import { FUNCTIONS_REGION } from "@eegml/shared";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { runAndRecordSweep } from "../governance/retention";

export const retentionSweep = onSchedule(
  { schedule: "every day 04:23", timeZone: "Europe/London", region: FUNCTIONS_REGION, retryCount: 1 },
  async () => {
    await runAndRecordSweep(firestore(), {
      trigger: "schedule",
      dryRun: false,
      actor: { kind: "system" },
      at: new Date(),
    });
  },
);
