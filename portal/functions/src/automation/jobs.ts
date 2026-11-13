// The job of an automation run, carried out by the queue of the integrations (requirement
// R16.10). The queue claims the job once, and the job carries out the actions of the rule in
// order, logging each. A failure that a retry may clear waits with backoff and is tried again;
// one that no retry can clear, such as a record that has gone, ends the run as failed at once.
// When the attempts are spent the job is dead-lettered, the run fails, the event is recorded in
// `eventFailures`, and whoever manages the integrations is told. An administrator retries a
// dead-lettered job from the integrations page, and the run carries on from its actions, each of
// which creates nothing twice.
import {
  AUTOMATION_RUN_LOG_MAX,
  automationRunDocSchema,
  COLLECTIONS,
  eventFailureDocSchema,
  eventFailureId,
  parseStoredDocument,
  systemWriteContext,
} from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createdFields } from "../framework/documents";
import type { JobDependencies } from "../integrations/jobs/context";
import { JobFailure } from "../integrations/jobs/context";
import { type ClaimedRun, completeRun, failRun } from "../integrations/jobs/queue";
import { alertIntegrationFailure } from "../notifications/alerts";
import { ActionRefusal, runAction } from "./actions";
import { AUTOMATION_ACTOR, rulesInForce } from "./dispatch";

function logLine(at: Date, text: string): string {
  return `${at.toISOString()} ${text}`.slice(0, 2_000);
}

/** Appends lines to the log of a run, keeping the last ones, and sets its status. */
async function recordOnRun(
  job: JobDependencies,
  runId: string,
  changes: Readonly<Record<string, unknown>>,
  lines: readonly string[],
): Promise<void> {
  const reference = job.db.doc(COLLECTIONS.automationRuns.docPath(runId));
  await job.db.runTransaction(async (transaction) => {
    const parsed = parseStoredDocument(automationRunDocSchema, (await transaction.get(reference)).data());
    if (!parsed.success) return;
    transaction.update(reference, {
      ...changes,
      log: [...parsed.data.log, ...lines].slice(-AUTOMATION_RUN_LOG_MAX),
      updatedAt: Timestamp.fromDate(job.clock.now()),
    });
  });
}

export async function executeAutomationJob(job: ClaimedRun, dependencies: JobDependencies): Promise<string> {
  const { db, clock } = dependencies;
  const runId = job.automationRunId;
  if (runId === undefined) {
    await completeRun(
      db,
      job.id,
      { status: "skipped", stats: {}, note: "The job names no automation run." },
      clock.now(),
    );
    return "skipped";
  }
  const parsed = parseStoredDocument(
    automationRunDocSchema,
    (await db.doc(COLLECTIONS.automationRuns.docPath(runId)).get()).data(),
  );
  if (!parsed.success) {
    await completeRun(
      db,
      job.id,
      { status: "skipped", stats: {}, note: "The automation run no longer exists." },
      clock.now(),
    );
    return "skipped";
  }
  const run = parsed.data;
  const rule = (await rulesInForce(db)).find((candidate) => candidate.id === run.ruleId)?.rule;
  const at = clock.now();
  if (rule === undefined || !rule.enabled) {
    await recordOnRun(dependencies, runId, { status: "skipped", finishedAt: Timestamp.fromDate(at) }, [
      logLine(at, "The rule was switched off or removed before its actions ran."),
    ]);
    await completeRun(db, job.id, { status: "skipped", stats: {}, note: "The rule was switched off." }, at);
    return "skipped";
  }
  await recordOnRun(dependencies, runId, { status: "running", attempts: job.attempts }, [
    logLine(at, `Attempt ${job.attempts} started.`),
  ]);
  const lines: string[] = [];
  try {
    for (const action of rule.actions) {
      const said = await runAction({ db, runId, run, at: clock.now() }, action);
      lines.push(logLine(clock.now(), `${action.kind}: ${said}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The action failed.";
    const refused = error instanceof ActionRefusal;
    const failure = refused ? new JobFailure("guard", false, message) : new JobFailure("internal", true, message);
    const status = await failRun(db, job, failure, clock.now(), dependencies.random());
    const ended = status !== "retrying";
    const now = clock.now();
    await recordOnRun(
      dependencies,
      runId,
      {
        status: ended ? "failed" : "queued",
        error: message.slice(0, 10_000),
        ...(ended ? { finishedAt: Timestamp.fromDate(now) } : {}),
      },
      [
        ...lines,
        logLine(
          now,
          ended ? `The run failed: ${message}` : `Attempt ${job.attempts} failed and will be retried: ${message}`,
        ),
      ],
    );
    if (status === "deadLetter" || status === "failed") {
      await db.doc(COLLECTIONS.eventFailures.docPath(eventFailureId("automation", run.eventId))).set(
        eventFailureDocSchema.parse({
          ...createdFields("eventFailures", { at: now, actor: AUTOMATION_ACTOR, writeContext: systemWriteContext() }),
          consumer: "automation",
          eventId: run.eventId,
          documentPath: COLLECTIONS.automationRuns.docPath(runId),
          attempts: job.attempts,
          error: message.slice(0, 10_000),
          failedAt: Timestamp.fromDate(now),
          resolvedAt: null,
        }),
      );
      await alertIntegrationFailure(db, "automation", now);
    }
    return status;
  }
  const now = clock.now();
  await recordOnRun(
    dependencies,
    runId,
    { status: "succeeded", finishedAt: Timestamp.fromDate(now), error: FieldValue.delete() },
    [...lines, logLine(now, "The run succeeded.")],
  );
  // A run that succeeds after a failure clears the failure that was recorded for its event.
  await db
    .doc(COLLECTIONS.eventFailures.docPath(eventFailureId("automation", run.eventId)))
    .update({ resolvedAt: Timestamp.fromDate(now) })
    .catch(() => undefined);
  await completeRun(db, job.id, { status: "succeeded", stats: { actions: rule.actions.length } }, now);
  return "succeeded";
}
