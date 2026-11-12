// The job queue of the integrations (docs/INTEGRATIONS.md, sections 1 and 9). A run record is
// written when a job is enqueued, because the depth of a queue cannot be read from Firestore, and
// the record is the job: a trigger runs it when it becomes `queued`, the scheduled sweep puts a
// run that waits for a retry back in the queue, and an administrator retries or cancels one.
//
// | Step      | Guarantee                                                                     |
// |-----------|-------------------------------------------------------------------------------|
// | Enqueue   | The identifier is derived from the mapping and the event, so a repeated event enqueues one run |
// | Claim     | A transaction moves the run from `queued` to `running`, so of two deliveries one runs |
// | Fail      | A failure that passes waits with backoff, and after its last attempt is dead-lettered. Any other failure ends the run |
//
// Inside a run, each request to Google is retried with its own backoff (`google/retry.ts`).
import {
  backoffDelayMs,
  COLLECTIONS,
  hasAttemptLeft,
  type IntegrationMode,
  JOB_BACKOFF,
  MAX_PLAN_ENTRIES,
  parseStoredDocument,
  type SyncJobKind,
  type SyncRunDoc,
  syncRunDocSchema,
  syncRunId,
  systemWriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { createdFields } from "../../framework/documents";
import type { JobFailure, JobOutcome } from "./context";

/** A run as the queue hands it to its job, with its identifier. */
export type ClaimedRun = SyncRunDoc & { readonly id: string };

export interface EnqueueRequest {
  readonly kind: SyncJobKind;
  readonly mappingId?: string;
  readonly generatedDocumentId?: string;
  readonly mode: IntegrationMode;
  readonly trigger: SyncRunDoc["trigger"];
  /** The event, the scheduled time or the request that starts the run. With the subject, it names the run. */
  readonly eventKey: string;
  readonly requestedBy: string;
  readonly at: Date;
}

/** The subject of a run: the mapping, the generated document, or the Drive change feed. */
export function runSubject(request: Pick<EnqueueRequest, "kind" | "mappingId" | "generatedDocumentId">): string {
  return request.mappingId ?? request.generatedDocumentId ?? request.kind;
}

/**
 * A run of the same subject that waits to start, if any: a second one would do the same work.
 * Few runs wait at any time, so the queued ones are read and filtered here, and the query needs
 * no composite index.
 */
export async function queuedRunOf(db: Firestore, kind: SyncJobKind, subject: string): Promise<string | null> {
  const queued = await db
    .collection(COLLECTIONS.syncRuns.collectionPath())
    .where("status", "==", "queued")
    .limit(500)
    .get();
  const match = queued.docs.find((document) => {
    const run = parseStoredDocument(syncRunDocSchema, document.data());
    return run.success && run.data.kind === kind && runSubject(run.data) === subject;
  });
  return match?.id ?? null;
}

/**
 * Enqueues a run, or finds the one that waits already. Answers the run and whether it is new.
 * A run of an event that was enqueued before is never enqueued again.
 */
export async function enqueueRun(db: Firestore, request: EnqueueRequest): Promise<{ runId: string; created: boolean }> {
  const subject = runSubject(request);
  const waiting = await queuedRunOf(db, request.kind, subject);
  if (waiting !== null) return { runId: waiting, created: false };
  const runId = syncRunId(subject, request.eventKey);
  const reference = db.doc(COLLECTIONS.syncRuns.docPath(runId));
  const at = Timestamp.fromDate(request.at);
  const data = syncRunDocSchema.parse({
    ...createdFields("syncRuns", {
      at: request.at,
      actor: request.requestedBy,
      writeContext: systemWriteContext(),
    }),
    kind: request.kind,
    ...(request.mappingId === undefined ? {} : { mappingId: request.mappingId }),
    ...(request.generatedDocumentId === undefined ? {} : { generatedDocumentId: request.generatedDocumentId }),
    mode: request.mode,
    trigger: request.trigger,
    status: "queued",
    attempts: 0,
    maxAttempts: JOB_BACKOFF.maxAttempts,
    nextAttemptAt: null,
    requestedBy: request.requestedBy,
    queuedAt: at,
    startedAt: null,
    finishedAt: null,
    stats: {},
  });
  try {
    await reference.create(data);
    return { runId, created: true };
  } catch (error) {
    // ALREADY_EXISTS: the same event was delivered twice.
    if ((error as { code?: unknown }).code === 6) return { runId, created: false };
    throw error;
  }
}

/** Moves a queued run to `running`. Answers the run, or null where another delivery took it or it is no longer queued. */
export async function claimRun(db: Firestore, runId: string, at: Date): Promise<ClaimedRun | null> {
  const reference = db.doc(COLLECTIONS.syncRuns.docPath(runId));
  return db.runTransaction(async (transaction) => {
    const parsed = parseStoredDocument(syncRunDocSchema, (await transaction.get(reference)).data());
    if (!parsed.success || parsed.data.status !== "queued") return null;
    const now = Timestamp.fromDate(at);
    transaction.update(reference, {
      status: "running",
      attempts: parsed.data.attempts + 1,
      startedAt: now,
      finishedAt: null,
      nextAttemptAt: null,
      updatedAt: now,
    });
    return { id: runId, ...parsed.data, attempts: parsed.data.attempts + 1 };
  });
}

/** Records the end of a run that did not fail. */
export async function completeRun(db: Firestore, runId: string, outcome: JobOutcome, at: Date): Promise<void> {
  const now = Timestamp.fromDate(at);
  const plan = outcome.plan ?? [];
  await db.doc(COLLECTIONS.syncRuns.docPath(runId)).update({
    status: outcome.status,
    finishedAt: now,
    updatedAt: now,
    stats: outcome.stats,
    plan: plan.slice(0, MAX_PLAN_ENTRIES),
    planOmitted: Math.max(0, plan.length - MAX_PLAN_ENTRIES) + (outcome.planOmitted ?? 0),
    ...(outcome.driveVersion === undefined ? {} : { driveVersion: outcome.driveVersion }),
    ...(outcome.note === undefined ? {} : { error: outcome.note }),
  });
}

/**
 * Records a failed attempt. Answers the status the run ends in: `retrying` while attempts are
 * left for a failure that passes, `deadLetter` when they are spent, `failed` otherwise.
 */
export async function failRun(
  db: Firestore,
  run: ClaimedRun,
  failure: JobFailure,
  at: Date,
  random: number,
): Promise<"retrying" | "deadLetter" | "failed"> {
  const retry = failure.retryable && hasAttemptLeft({ ...JOB_BACKOFF, maxAttempts: run.maxAttempts }, run.attempts);
  const status = retry ? "retrying" : failure.retryable ? "deadLetter" : "failed";
  const wait = backoffDelayMs(JOB_BACKOFF, run.attempts, random);
  const next = new Date(Math.max(at.getTime() + wait, failure.notBefore?.getTime() ?? 0));
  const now = Timestamp.fromDate(at);
  await db.doc(COLLECTIONS.syncRuns.docPath(run.id)).update({
    status,
    finishedAt: now,
    updatedAt: now,
    error: failure.message,
    errorKind: failure.kind,
    nextAttemptAt: retry ? Timestamp.fromDate(next) : null,
  });
  return status;
}

/** Puts back in the queue every run whose next attempt is due. Answers how many. */
export async function requeueDueRuns(db: Firestore, at: Date): Promise<number> {
  const waiting = await db
    .collection(COLLECTIONS.syncRuns.collectionPath())
    .where("status", "==", "retrying")
    .limit(500)
    .get();
  let count = 0;
  for (const document of waiting.docs) {
    const next: unknown = document.get("nextAttemptAt");
    if (!(next instanceof Timestamp) || next.toMillis() > at.getTime()) continue;
    const moved = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (current.get("status") !== "retrying") return false;
      transaction.update(document.ref, { status: "queued", updatedAt: Timestamp.fromDate(at) });
      return true;
    });
    if (moved) count += 1;
  }
  return count;
}
