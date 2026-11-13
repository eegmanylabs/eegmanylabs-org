// The nightly retention sweep (docs/DATA_MODEL.md, section 14). With no period configured it
// deletes nothing and records a run that says so.
import { FUNCTIONS_REGION, FUNCTIONS_SERVICE_ACCOUNT } from "@eegml/shared";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { runningInEmulator } from "../framework/callable";
import { identityHashKeySecret } from "../framework/hash-key";
import { runAndRecordSweep } from "../governance/retention";

export const retentionSweep = onSchedule(
  {
    schedule: "every day 04:23",
    timeZone: "Europe/London",
    region: FUNCTIONS_REGION,
    serviceAccount: FUNCTIONS_SERVICE_ACCOUNT,
    retryCount: 1,
    // The sweep resolves the address of an outreach contact through the keyed email index. The emulator binds none.
    secrets: runningInEmulator() ? [] : [identityHashKeySecret()],
  },
  async () => {
    await runAndRecordSweep(firestore(), {
      trigger: "schedule",
      dryRun: false,
      actor: { kind: "system" },
      at: new Date(),
    });
  },
);
