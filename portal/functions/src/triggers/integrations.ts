// The triggers, the schedule and the public receiver of the Google integrations
// (docs/INTEGRATIONS.md, sections 1, 3.2 and 3.3).
//
// | Function                   | Runs on                              | Does                                                  |
// |----------------------------|--------------------------------------|-------------------------------------------------------|
// | `integrationsOnRunWritten` | A run record that becomes `queued`   | Runs the job. Of two deliveries, the claim lets one run |
// | `syncOnLaboratoryWritten`  | A laboratory created or changed      | Enqueues a run of each active mapping of laboratories, unless the write came from synchronisation |
// | `syncOnEquipmentWritten`   | An equipment configuration written   | The same for the mappings of equipment               |
// | `integrationsSweep`        | Every ten minutes                    | Requeues due retries, polls the Drive change feed, renews push channels, and at night compares every mapping in full |
// | `driveNotifications`       | A push message from Drive, over HTTPS | Enqueues a read of the change feed after checking the channel and its token |
//
// Delivery is at least once. A run takes its identifier from the event that started it, so a
// repeated delivery enqueues nothing new, and a write whose origin is `sync` never starts a run,
// which keeps the engine's own writes from coming back as changes.
import {
  COLLECTIONS,
  FUNCTIONS_REGION,
  parseStoredDocument,
  type SyncTargetKey,
  syncMappingDocSchema,
  systemActor,
  type WriteContext,
} from "@eegml/shared";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/firestore";
import { onRequest } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { documentTrigger } from "../framework/trigger";
import { workspaceRuntime } from "../integrations/google/adapters";
import { liveDependencies, receiverUrl } from "../integrations/jobs/live";
import { enqueueRun } from "../integrations/jobs/queue";
import { receiveDriveNotification } from "../integrations/jobs/receiver";
import { executeRun, sweepIntegrations } from "../integrations/jobs/runner";

export const integrationsOnRunWritten = onDocumentWritten(
  // A run may take minutes: one attempt of the trigger is enough, because a failed run waits in
  // the queue for its retry rather than in the trigger.
  { ...documentTrigger(COLLECTIONS.syncRuns.path), retry: false, timeoutSeconds: 540 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (after === undefined || after.status !== "queued" || before?.status === "queued") return;
    const status = await executeRun(event.params.id, liveDependencies());
    logger.info("integration run ended", { runId: event.params.id, status });
  },
);

/** Enqueues a run of every active mapping of a collection, for a write that did not come from synchronisation. */
export async function enqueueForCollection(
  collectionKey: SyncTargetKey,
  context: Partial<WriteContext> | undefined,
  eventId: string,
  at: Date,
): Promise<number> {
  if (context?.origin === "sync") return 0;
  const db = firestore();
  const mappings = await db
    .collection(COLLECTIONS.syncMappings.collectionPath())
    .where("collectionKey", "==", collectionKey)
    .get();
  let queued = 0;
  for (const document of mappings.docs) {
    const mapping = parseStoredDocument(syncMappingDocSchema, document.data());
    if (!mapping.success || mapping.data.status !== "active") continue;
    const result = await enqueueRun(db, {
      kind: "sheetSync",
      mappingId: document.id,
      mode: mapping.data.mode,
      trigger: "event",
      eventKey: `event:${eventId}`,
      requestedBy: systemActor("syncTrigger"),
      at,
    });
    if (result.created) queued += 1;
  }
  return queued;
}

export const syncOnLaboratoryWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.laboratories.path),
  async (event) => {
    const after = event.data?.after.data();
    if (after === undefined) return;
    await enqueueForCollection(
      "core:laboratories",
      after.writeContext as Partial<WriteContext> | undefined,
      event.id,
      new Date(event.time),
    );
  },
);

export const syncOnEquipmentWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.laboratoryEquipment.path),
  async (event) => {
    const after = event.data?.after.data();
    if (after === undefined) return;
    await enqueueForCollection(
      "core:equipment",
      after.writeContext as Partial<WriteContext> | undefined,
      event.id,
      new Date(event.time),
    );
  },
);

export const integrationsSweep = onSchedule(
  { schedule: "every 10 minutes", timeZone: "Europe/London", region: FUNCTIONS_REGION, retryCount: 1 },
  async () => {
    const runtime = workspaceRuntime();
    const summary = await sweepIntegrations(liveDependencies(runtime), runtime, { receiverUrl: receiverUrl() });
    logger.info("integrations sweep finished", summary);
  },
);

/** Header values of a request, as one text each. */
function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const driveNotifications = onRequest(
  { region: FUNCTIONS_REGION, invoker: "public", maxInstances: 5 },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).end();
      return;
    }
    const answer = await receiveDriveNotification(
      firestore(),
      {
        channelId: header(request.headers["x-goog-channel-id"]),
        token: header(request.headers["x-goog-channel-token"]),
        messageNumber: header(request.headers["x-goog-message-number"]),
        resourceState: header(request.headers["x-goog-resource-state"]),
      },
      new Date(),
    );
    response.status(answer.status).end();
  },
);
