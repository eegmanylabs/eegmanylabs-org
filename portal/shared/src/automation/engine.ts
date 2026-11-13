// The rule engine of the automations (requirements R16.9 and R16.10, docs/DATA_MODEL.md,
// section 13). It is small on purpose: a rule names one event from a fixed list, a few
// conditions on the facts of that event, and actions from a fixed list, and the engine decides,
// for one event, which rules act and which are passed over and why. Carrying out an action is the
// work of the functions, which log every run and retry it through the job queue.
//
// Loops are prevented twice. Every write that an automation makes carries a write context one
// deeper than the event it answered, and the engine acts on no event at or beyond
// `AUTOMATION_MAX_DEPTH`. Every run also records the chain of rules that led to it, and a rule
// never acts again on an event of a chain it is already part of, so two rules whose actions start
// each other stop after one round, however shallow.

import {
  AUTOMATION_ACTIONS,
  AUTOMATION_EVENTS,
  type AutomationAction,
  type AutomationCondition,
  type AutomationEventKey,
  type AutomationRuleDoc,
} from "../schemas/system";
import { PROGRAMME_KEY } from "../seed/lookups";

/** The deepest write context an automation acts on. A write at this depth starts nothing. */
export const AUTOMATION_MAX_DEPTH = 3;

/** What a rule is, without the standard fields of its document. */
export type AutomationRuleSpec = Pick<
  AutomationRuleDoc,
  "name" | "enabled" | "builtIn" | "triggerType" | "triggerConfig" | "conditions" | "actions" | "scopeType" | "scopeId"
>;

const builtIn = (
  name: string,
  event: AutomationEventKey,
  actions: readonly AutomationAction[],
  enabled = true,
): AutomationRuleSpec => ({
  name,
  enabled,
  builtIn: true,
  triggerType: AUTOMATION_EVENTS[event],
  triggerConfig: { event },
  conditions: [],
  actions: [...actions],
  scopeType: "programme",
  scopeId: PROGRAMME_KEY,
});

/**
 * The rules that ship with the portal, by their fixed key. Each is in force until an
 * administrator stores a document under its key, which may switch it off or narrow it with
 * conditions; its event and actions stay as they are.
 *
 * | Key                       | Does                                                                         | On by default |
 * |---------------------------|------------------------------------------------------------------------------|---------------|
 * | `qcTaskOnArrival`         | Opens the quality-control task of a dataset when its data first arrives      | Yes |
 * | `onboardingOnActivation`  | Creates the onboarding checklist of a laboratory when it becomes active      | Yes |
 * | `leadsOnTargetMet`        | Tells the leads of a replication when its usable participants reach the target | Yes |
 * | `overdueUpdatesDaily`     | Flags collecting participations without a recent report, every day          | Yes |
 * | `progressReportsWeekly`   | Updates the generated progress reports of every replication, every week     | No: it needs a template that is approved for live writes |
 */
export const BUILT_IN_AUTOMATION_RULES: Readonly<Record<string, AutomationRuleSpec>> = {
  qcTaskOnArrival: builtIn("Open a quality-control task when data arrives", "dataset.dataArrived", [
    { kind: "createQcTask" },
  ]),
  onboardingOnActivation: builtIn(
    "Create the onboarding checklist when a laboratory is approved",
    "laboratory.activated",
    [{ kind: "createOnboardingChecklist" }],
  ),
  leadsOnTargetMet: builtIn("Tell the leads when the recruitment target is met", "recruitment.targetMet", [
    { kind: "notifyLeads" },
  ]),
  overdueUpdatesDaily: builtIn("Flag overdue recruitment updates every day", "schedule.daily", [
    { kind: "flagOverdueUpdates" },
  ]),
  progressReportsWeekly: builtIn(
    "Update the progress reports every week",
    "schedule.weekly",
    [{ kind: "generateProgressReport", templateKey: "replicationProgress" }],
    false,
  ),
};

/** The rules in force: the built-in rules as stored documents override them, and every other stored rule. */
export function effectiveRules(
  stored: readonly { readonly id: string; readonly data: AutomationRuleSpec & { readonly archivedAt?: unknown } }[],
): { readonly id: string; readonly rule: AutomationRuleSpec }[] {
  const byId = new Map<string, AutomationRuleSpec>(Object.entries(BUILT_IN_AUTOMATION_RULES));
  for (const { id, data } of stored) {
    const base = BUILT_IN_AUTOMATION_RULES[id];
    const archived = data.archivedAt !== null && data.archivedAt !== undefined;
    if (base !== undefined) {
      // A stored built-in rule changes only whether it is on and what it is limited to.
      byId.set(id, {
        ...base,
        enabled: data.enabled && !archived,
        conditions: data.conditions,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
      });
    } else if (!archived) {
      byId.set(id, data);
    }
  }
  return [...byId.entries()].map(([id, rule]) => ({ id, rule })).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Whether an action may follow an event. The functions refuse a rule that pairs them otherwise. */
export function actionFitsEvent(action: AutomationAction, event: AutomationEventKey): boolean {
  return (AUTOMATION_ACTIONS[action.kind] as readonly AutomationEventKey[]).includes(event);
}

/** The problems of a rule as a person would read them, or none. */
export function ruleProblems(rule: Pick<AutomationRuleSpec, "triggerConfig" | "actions" | "conditions">): string[] {
  const problems: string[] = [];
  for (const action of rule.actions) {
    if (!actionFitsEvent(action, rule.triggerConfig.event)) {
      problems.push(`The action ${action.kind} cannot follow the event ${rule.triggerConfig.event}.`);
    }
    if (action.kind === "generateProgressReport" && action.templateKey === undefined) {
      problems.push("A progress report names the template it is generated from.");
    }
  }
  for (const condition of rule.conditions) {
    if (condition.operator !== "in" && condition.values.length !== 1) {
      problems.push(`The condition on ${condition.field} compares with exactly one value.`);
    }
  }
  return problems;
}

/** One event as the engine sees it. */
export interface AutomationEvent {
  /** The identifier of the event that every delivery of it shares. */
  readonly id: string;
  readonly event: AutomationEventKey;
  /** The facts that conditions test: the replication, the laboratory and so on. A missing fact is null. */
  readonly facts: Readonly<Partial<Record<AutomationCondition["field"], string | null>>>;
  /** The depth of the write context of the write that is the event, or 0 for a schedule or a manual run. */
  readonly depth: number;
  /** The rules whose runs led to the write, earliest first, from the run that caused it. */
  readonly chain: readonly string[];
}

export type AutomationSkip = "disabled" | "otherEvent" | "outOfScope" | "conditions" | "depth" | "loop" | "invalid";

export type AutomationDecision =
  | { readonly ruleId: string; readonly outcome: "act"; readonly actions: readonly AutomationAction[] }
  | { readonly ruleId: string; readonly outcome: "skip"; readonly reason: AutomationSkip };

function conditionHolds(condition: AutomationCondition, facts: AutomationEvent["facts"]): boolean {
  const value = facts[condition.field] ?? null;
  switch (condition.operator) {
    case "equals":
      return value === condition.values[0];
    case "notEquals":
      return value !== condition.values[0];
    case "in":
      return value !== null && condition.values.includes(value);
  }
}

function inScope(rule: AutomationRuleSpec, facts: AutomationEvent["facts"]): boolean {
  switch (rule.scopeType) {
    case "programme":
      return true;
    case "replication":
      return facts.replicationId === rule.scopeId;
    case "laboratory":
      return facts.laboratoryId === rule.scopeId;
    case "group":
      return false;
  }
}

/**
 * Decides, for one event, what each rule does. A rule that is about another event is passed
 * over quietly; every other decision is logged by the functions, so a person can see why a rule
 * did not act.
 */
export function decideAutomations(
  rules: readonly { readonly id: string; readonly rule: AutomationRuleSpec }[],
  event: AutomationEvent,
): AutomationDecision[] {
  return rules.map(({ id, rule }): AutomationDecision => {
    if (rule.triggerConfig.event !== event.event) return { ruleId: id, outcome: "skip", reason: "otherEvent" };
    if (!rule.enabled) return { ruleId: id, outcome: "skip", reason: "disabled" };
    if (ruleProblems(rule).length > 0) return { ruleId: id, outcome: "skip", reason: "invalid" };
    if (event.depth >= AUTOMATION_MAX_DEPTH) return { ruleId: id, outcome: "skip", reason: "depth" };
    if (event.chain.includes(id)) return { ruleId: id, outcome: "skip", reason: "loop" };
    if (!inScope(rule, event.facts)) return { ruleId: id, outcome: "skip", reason: "outOfScope" };
    if (!rule.conditions.every((condition) => conditionHolds(condition, event.facts))) {
      return { ruleId: id, outcome: "skip", reason: "conditions" };
    }
    return { ruleId: id, outcome: "act", actions: rule.actions };
  });
}

/** The chain of a run: the chain of the event it answers, and its own rule. */
export function chainOfRun(event: Pick<AutomationEvent, "chain">, ruleId: string): string[] {
  return [...event.chain, ruleId].slice(-20);
}

/** Why a rule did not act, in words for its log and its page. */
export const AUTOMATION_SKIP_TEXT: Readonly<Record<AutomationSkip, string>> = {
  disabled: "The rule is switched off.",
  otherEvent: "The rule is about another event.",
  outOfScope: "The event is outside the replication or laboratory the rule is limited to.",
  conditions: "The conditions of the rule do not hold for this event.",
  depth: `The event was written ${AUTOMATION_MAX_DEPTH} steps deep in a chain of automations, so nothing more is started.`,
  loop: "The rule already acted earlier in this chain of automations, so it does not act again.",
  invalid: "The rule pairs an action with an event it cannot follow.",
};
