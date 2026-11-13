// The dispatch of automations (requirements R16.9 and R16.10, docs/DATA_MODEL.md, section 13).
// An event, from a trigger, a schedule or a person, is put to every rule in force by the engine
// of the shared package. For each rule that acts, a run is recorded and a job of the existing
// queue carries out its actions, which gives it the retries, the backoff, the dead letter and
// the recovery of every other job. A rule that is passed over for a reason a person may need is
// logged as a skipped run, so the page of a rule shows why it did not act.
//
// Every write follows from the event's identifier: a run takes the hash of its rule and its event
// as its identifier and is created only once, so an event that is delivered twice starts nothing
// twice. The chain of rules that led to an event is read from the run that caused it, which the
// write context of the event names, and the engine refuses a rule that is already in the chain.
import {
  AUTOMATION_SKIP_TEXT,
  type AutomationDecision,
  type AutomationEvent,
  type AutomationEventKey,
  type AutomationRuleSpec,
  automationRuleDocSchema,
  automationRunDocSchema,
  automationRunId,
  COLLECTIONS,
  chainOfRun,
  decideAutomations,
  type EntityType,
  effectiveRules,
  parseStoredDocument,
  systemActor,
  systemWriteContext,
  type WriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { createdFields } from "../framework/documents";
import { enqueueRun } from "../integrations/jobs/queue";

export const AUTOMATION_ACTOR = systemActor("automation");

/** The rules in force: the built-in rules with the stored overrides, and every stored rule. */
export async function rulesInForce(
  db: Firestore,
): Promise<{ readonly id: string; readonly rule: AutomationRuleSpec }[]> {
  const found = await db.collection(COLLECTIONS.automationRules.collectionPath()).limit(500).get();
  const stored = found.docs.flatMap((document) => {
    const parsed = parseStoredDocument(automationRuleDocSchema, document.data());
    return parsed.success ? [{ id: document.id, data: parsed.data }] : [];
  });
  return effectiveRules(stored);
}

/**
 * The chain of the event of a write: the chain of the automation run that caused it, where an
 * automation made the write, and none otherwise.
 */
export async function chainOf(db: Firestore, context: Partial<WriteContext> | undefined): Promise<string[]> {
  if (context?.origin !== "automation" || typeof context.causationId !== "string") return [];
  const parsed = parseStoredDocument(
    automationRunDocSchema,
    (await db.doc(COLLECTIONS.automationRuns.docPath(context.causationId)).get()).data(),
  );
  return parsed.success ? [...parsed.data.chain] : [];
}

/** The record an event is about, which the run names and the actions act on. */
export interface EventSubject {
  readonly entityType: EntityType | null;
  readonly entityId: string | null;
}

/** The decisions that are worth a run record: every one but a rule about another event. */
function logged(decision: AutomationDecision): boolean {
  return decision.outcome === "act" || decision.reason !== "otherEvent";
}

export interface DispatchOptions {
  /** Rules that act on this event elsewhere, in the transaction of the change, and are left out here. */
  readonly handledElsewhere?: readonly string[];
  /** Limits the dispatch to one rule, for a rule that a person runs by hand. */
  readonly onlyRule?: string;
  readonly correlationId?: string;
}

/**
 * Puts an event to the rules in force, records a run for each rule that acts or is passed over
 * for a reason, and enqueues the job of each run that acts. Answers the runs that were queued.
 */
export async function dispatchEvent(
  db: Firestore,
  event: AutomationEvent,
  subject: EventSubject,
  at: Date,
  options: DispatchOptions = {},
): Promise<{ readonly queued: readonly string[]; readonly skipped: readonly string[] }> {
  const rules = (await rulesInForce(db)).filter(
    ({ id }) =>
      !(options.handledElsewhere ?? []).includes(id) && (options.onlyRule === undefined || options.onlyRule === id),
  );
  const decisions = decideAutomations(rules, event).filter(logged);
  const queued: string[] = [];
  const skipped: string[] = [];
  for (const decision of decisions) {
    const runId = automationRunId(decision.ruleId, event.id);
    const reference = db.doc(COLLECTIONS.automationRuns.docPath(runId));
    const acts = decision.outcome === "act";
    const now = Timestamp.fromDate(at);
    const data = automationRunDocSchema.parse({
      ...createdFields("automationRuns", { at, actor: AUTOMATION_ACTOR, writeContext: systemWriteContext() }),
      ruleId: decision.ruleId,
      eventId: event.id,
      idempotencyKey: runId,
      event: event.event,
      entityType: subject.entityType,
      entityId: subject.entityId,
      status: acts ? "queued" : "skipped",
      attempts: 0,
      depth: event.depth,
      correlationId: options.correlationId ?? event.id,
      chain: chainOfRun(event, decision.ruleId),
      log: [
        acts
          ? `${at.toISOString()} The event ${event.event} met the rule; its actions are queued.`
          : `${at.toISOString()} ${AUTOMATION_SKIP_TEXT[decision.reason]}`,
      ],
      startedAt: now,
      finishedAt: acts ? null : now,
    });
    try {
      await reference.create(data);
    } catch (error) {
      // ALREADY_EXISTS: the event was delivered before, and the rule has answered it.
      if ((error as { code?: unknown }).code === 6) continue;
      throw error;
    }
    if (!acts) {
      skipped.push(runId);
      continue;
    }
    const { runId: jobId } = await enqueueRun(db, {
      kind: "automation",
      automationRunId: runId,
      mode: "live",
      trigger: event.event === "manual" ? "manual" : event.event.startsWith("schedule.") ? "schedule" : "event",
      eventKey: `automation:${runId}`,
      requestedBy: AUTOMATION_ACTOR,
      at,
    });
    await reference.update({ syncRunId: jobId });
    queued.push(runId);
  }
  return { queued, skipped };
}

/** The event of a schedule or of a manual run: the facts are empty and nothing caused it. */
export function plainEvent(event: AutomationEventKey, id: string): AutomationEvent {
  return { id, event, facts: {}, depth: 0, chain: [] };
}
