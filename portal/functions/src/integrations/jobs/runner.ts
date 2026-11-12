// The executor of queued runs, and the scheduled sweep that keeps the integrations going
// (docs/INTEGRATIONS.md, sections 3.2 and 9): retries that are due, the polling backstop of the
// Drive change feed, the renewal of push channels before they expire, and the nightly full
// comparison of every mapping.
import { randomBytes, randomUUID } from "node:crypto";
import {
  COLLECTIONS,
  driveChannelDocSchema,
  parseStoredDocument,
  sha256Hex,
  syncMappingDocSchema,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { createdFields } from "../../framework/documents";
import type { WorkspaceRuntime } from "../google/adapters";
import { MAX_CHANNEL_LIFETIME_MS } from "../google/types";
import { JOB_SYSTEM, type JobDependencies, JobFailure } from "./context";
import { markDocumentFailed, runDocumentUpdate } from "./documents";
import { runDriveChanges } from "./drive-changes";
import { connectionPaused, ensureConnections, recordHealth } from "./health";
import { claimRun, completeRun, enqueueRun, failRun, requeueDueRuns } from "./queue";
import { failureOf, runSheetSync } from "./sheet-sync";

const SWEEP_ACTOR = systemActor("integrationsSweep");

/** Runs one queued run to its end: claims it, runs its job, and records the outcome and the health of its connection. */
export async function executeRun(runId: string, dependencies: JobDependencies): Promise<string | null> {
  const { db, clock, logger } = dependencies;
  const run = await claimRun(db, runId, clock.now());
  if (run === null) return null;
  const system = JOB_SYSTEM[run.kind];
  try {
    if (await connectionPaused(db, system)) {
      await completeRun(db, run.id, { status: "skipped", stats: {}, note: "The connection is paused." }, clock.now());
      return "skipped";
    }
    const outcome =
      run.kind === "sheetSync"
        ? await runSheetSync(run, dependencies)
        : run.kind === "documentUpdate"
          ? await runDocumentUpdate(run, dependencies)
          : await runDriveChanges(dependencies);
    await completeRun(db, run.id, outcome, clock.now());
    await recordHealth(db, system, { kind: "success" }, clock.now());
    return outcome.status;
  } catch (error) {
    const failure = error instanceof JobFailure ? error : failureOf(error, dependencies.adapters?.kind ?? null);
    logger.warn("integration run failed", { runId, kind: run.kind, errorKind: failure.kind, attempts: run.attempts });
    const status = await failRun(db, run, failure, clock.now(), dependencies.random());
    if (status === "deadLetter" && run.generatedDocumentId !== undefined) {
      await markDocumentFailed(db, run.generatedDocumentId, failure.message, clock.now());
    }
    // A failure that is retried leaves the connection degraded. One that a retry cannot clear,
    // or a run whose attempts are spent, needs a person.
    await recordHealth(
      db,
      system,
      { kind: status === "retrying" ? "degraded" : "needsAttention", message: failure.message },
      clock.now(),
    );
    return status;
  }
}

export interface SweepOptions {
  /** The public address of the receiver of Drive notifications, or null where none may exist. */
  readonly receiverUrl: string | null;
}

/** Opens a new push channel on the change log, stores the hash of its token, and stops the channels it replaces. */
export async function renewDriveChannel(dependencies: JobDependencies, receiverUrl: string): Promise<string> {
  const { db, clock } = dependencies;
  if (dependencies.adapters === null) throw new JobFailure("guard", false, "Not connected: credentials not supplied.");
  const { drive } = dependencies.adapters;
  const at = clock.now();
  const connection = db.doc(COLLECTIONS.integrationConnections.docPath("googleDrive"));
  const stored: unknown = (await connection.get()).get("changesPageToken");
  const pageToken = typeof stored === "string" ? stored : await drive.getStartPageToken();
  if (typeof stored !== "string") await connection.update({ changesPageToken: pageToken });
  const channelId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const opened = await drive.watchChanges(pageToken, {
    id: channelId,
    token,
    address: receiverUrl,
    expiration: at.getTime() + MAX_CHANNEL_LIFETIME_MS,
  });
  await db.doc(COLLECTIONS.driveChannels.docPath(channelId)).create(
    driveChannelDocSchema.parse({
      ...createdFields("driveChannels", { at, actor: SWEEP_ACTOR, writeContext: systemWriteContext() }),
      channelId,
      resourceId: opened.resourceId,
      tokenHash: sha256Hex(token),
      expiresAt: Timestamp.fromMillis(opened.expiration),
      lastMessageNumber: 0,
      lastMessageAt: null,
      stoppedAt: null,
    }),
  );
  // The replacement is open, so the older channels can stop.
  const older = await db.collection(COLLECTIONS.driveChannels.collectionPath()).where("stoppedAt", "==", null).get();
  for (const document of older.docs) {
    if (document.id === channelId) continue;
    const channel = parseStoredDocument(driveChannelDocSchema, document.data());
    if (!channel.success) continue;
    try {
      await drive.stopChannel(channel.data.channelId, channel.data.resourceId);
    } catch {
      // A channel that has expired already cannot be stopped, and needs no stopping.
    }
    await document.ref.update({ stoppedAt: Timestamp.fromDate(at), updatedAt: Timestamp.fromDate(at) });
  }
  return channelId;
}

/**
 * The scheduled sweep. Each step is idempotent: a retry already queued is not queued again, a
 * poll and a nightly comparison take identifiers from their time, and a channel is renewed only
 * while none lives for more than a day.
 */
export async function sweepIntegrations(
  dependencies: JobDependencies,
  runtime: WorkspaceRuntime,
  options: SweepOptions,
): Promise<{ readonly requeued: number; readonly queued: number; readonly renewed: boolean }> {
  const { db, clock } = dependencies;
  const at = clock.now();
  await ensureConnections(db, runtime, at);
  const requeued = await requeueDueRuns(db, at);
  if (runtime.kind === "none") return { requeued, queued: 0, renewed: false };
  let queued = 0;
  const minute = at.toISOString().slice(0, 16);
  if (
    (
      await enqueueRun(db, {
        kind: "driveChanges",
        mode: "live",
        trigger: "schedule",
        eventKey: `poll:${minute}`,
        requestedBy: SWEEP_ACTOR,
        at,
      })
    ).created
  ) {
    queued += 1;
  }
  if (at.getUTCHours() === 2) {
    const day = at.toISOString().slice(0, 10);
    const mappings = await db
      .collection(COLLECTIONS.syncMappings.collectionPath())
      .where("status", "==", "active")
      .get();
    for (const document of mappings.docs) {
      const mapping = parseStoredDocument(syncMappingDocSchema, document.data());
      if (!mapping.success) continue;
      const result = await enqueueRun(db, {
        kind: "sheetSync",
        mappingId: document.id,
        mode: mapping.data.mode,
        trigger: "schedule",
        eventKey: `nightly:${day}`,
        requestedBy: SWEEP_ACTOR,
        at,
      });
      if (result.created) queued += 1;
    }
  }
  let renewed = false;
  if (options.receiverUrl !== null) {
    const live = await db.collection(COLLECTIONS.driveChannels.collectionPath()).where("stoppedAt", "==", null).get();
    const lasting = live.docs.some((document) => {
      const expiresAt: unknown = document.get("expiresAt");
      return expiresAt instanceof Timestamp && expiresAt.toMillis() > at.getTime() + 24 * 60 * 60 * 1000;
    });
    if (!lasting) {
      await renewDriveChannel(dependencies, options.receiverUrl);
      renewed = true;
    }
  }
  return { requeued, queued, renewed };
}
