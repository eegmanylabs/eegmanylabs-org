// Alerts of integration failures (requirement R16.4) for the integrations that have no
// connection record of their own: the website repository, through which exports are published,
// and the mail outbox. The Google connections and the storage servers alert from their own
// health records (integrations/jobs/health.ts and datasets/endpoints.ts).
//
// An alert goes to every holder of `integrations.manage` in the portal, once a day for each
// system however often the failure repeats, so a long outage is one message and not hundreds.
import { PROGRAMME_KEY, systemActor, systemWriteContext } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { holdersOf, notifyAll } from "./notify";

export type AlertedSystem = "github" | "mail" | "automation";

const SYSTEM_TEXT: Readonly<Record<AlertedSystem, string>> = {
  github: "The website repository could not be reached or refused the portal",
  mail: "A message of the mail outbox could not be sent",
  automation: "An automation failed after its retries",
};

export async function alertIntegrationFailure(db: Firestore, system: AlertedSystem, at: Date): Promise<void> {
  const day = at.toISOString().slice(0, 10);
  const actor = systemActor("integrationAlerts");
  await db.runTransaction(async (transaction) => {
    const holders = await holdersOf(db, transaction, "integrations.manage");
    notifyAll(
      db,
      transaction,
      holders,
      {
        type: "integrationFailure",
        entityType: "programme",
        entityId: PROGRAMME_KEY,
        eventId: `integrationFailure:${system}:${day}`,
        payload: { kind: "integrationFailed", system, message: SYSTEM_TEXT[system] },
      },
      { at, actor, writeContext: systemWriteContext() },
    );
  });
}
