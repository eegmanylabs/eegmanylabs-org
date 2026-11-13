// Synthetic rules and events: the identifiers name invented studies and laboratories.
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_MAX_DEPTH,
  type AutomationEvent,
  type AutomationRuleSpec,
  BUILT_IN_AUTOMATION_RULES,
  chainOfRun,
  decideAutomations,
  effectiveRules,
  ruleProblems,
} from "./engine";

function event(overrides: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    id: "event-1",
    event: "dataset.dataArrived",
    facts: { replicationId: "Synthetic2001", laboratoryId: "lab-one" },
    depth: 0,
    chain: [],
    ...overrides,
  };
}

const notifyRule: AutomationRuleSpec = {
  name: "Tell the leads of Synthetic2001 when data arrives",
  enabled: true,
  builtIn: false,
  triggerType: "recordUpdated",
  triggerConfig: { event: "dataset.dataArrived" },
  conditions: [{ field: "replicationId", operator: "equals", values: ["Synthetic2001"] }],
  actions: [{ kind: "notifyLeads" }],
  scopeType: "programme",
  scopeId: "eegmanylabs",
};

describe("the rules in force", () => {
  it("are the built-in rules until a stored document switches one off or narrows it", () => {
    const builtIn = BUILT_IN_AUTOMATION_RULES.qcTaskOnArrival;
    if (builtIn === undefined) throw new Error("The built-in rule is missing.");
    const rules = effectiveRules([
      {
        id: "qcTaskOnArrival",
        data: {
          ...builtIn,
          enabled: false,
          // A stored built-in rule cannot change its actions.
          actions: [{ kind: "notifyLeads" }],
        },
      },
    ]);
    const qc = rules.find((rule) => rule.id === "qcTaskOnArrival");
    expect(qc?.rule.enabled).toBe(false);
    expect(qc?.rule.actions).toEqual([{ kind: "createQcTask" }]);
    expect(rules.map((rule) => rule.id)).toEqual(Object.keys(BUILT_IN_AUTOMATION_RULES).sort());
  });

  it("include a stored rule of an administrator's own, and leave out an archived one", () => {
    const rules = effectiveRules([
      { id: "ownRule", data: notifyRule },
      { id: "oldRule", data: { ...notifyRule, archivedAt: { seconds: 1 } } },
    ]);
    expect(rules.some((rule) => rule.id === "ownRule")).toBe(true);
    expect(rules.some((rule) => rule.id === "oldRule")).toBe(false);
  });
});

describe("the decisions of the engine", () => {
  it("acts on the rules of the event whose conditions hold", () => {
    const decisions = decideAutomations(effectiveRules([{ id: "ownRule", data: notifyRule }]), event());
    expect(decisions.filter((decision) => decision.outcome === "act").map((decision) => decision.ruleId)).toEqual([
      "ownRule",
      "qcTaskOnArrival",
    ]);
  });

  it("passes over a rule whose conditions fail, which is out of scope, or which is off", () => {
    const rules = [
      { id: "conditions", rule: notifyRule },
      { id: "scope", rule: { ...notifyRule, conditions: [], scopeType: "laboratory" as const, scopeId: "lab-two" } },
      { id: "off", rule: { ...notifyRule, enabled: false } },
    ];
    const decisions = decideAutomations(
      rules,
      event({ facts: { replicationId: "Other2002", laboratoryId: "lab-one" } }),
    );
    expect(decisions).toEqual([
      { ruleId: "conditions", outcome: "skip", reason: "conditions" },
      { ruleId: "scope", outcome: "skip", reason: "outOfScope" },
      { ruleId: "off", outcome: "skip", reason: "disabled" },
    ]);
  });

  it("refuses a rule that pairs an action with an event it cannot follow", () => {
    const invalid = { ...notifyRule, actions: [{ kind: "createOnboardingChecklist" as const }] };
    expect(ruleProblems(invalid)).toEqual([
      "The action createOnboardingChecklist cannot follow the event dataset.dataArrived.",
    ]);
    expect(decideAutomations([{ id: "invalid", rule: invalid }], event())[0]).toEqual({
      ruleId: "invalid",
      outcome: "skip",
      reason: "invalid",
    });
  });
});

describe("loop prevention", () => {
  it("acts on nothing at the depth limit", () => {
    const decisions = decideAutomations([{ id: "ownRule", rule: notifyRule }], event({ depth: AUTOMATION_MAX_DEPTH }));
    expect(decisions[0]).toEqual({ ruleId: "ownRule", outcome: "skip", reason: "depth" });
  });

  it("stops two rules that start each other after one round, however shallow the chain", () => {
    // Rule A acts on an event and its write is the event of rule B, whose write is again the
    // event of rule A. The chain each run records stops A the second time round.
    const ruleA = { ...notifyRule, conditions: [] };
    const ruleB = { ...notifyRule, conditions: [] };
    const rules = [
      { id: "ruleA", rule: ruleA },
      { id: "ruleB", rule: ruleB },
    ];
    let chain: string[] = [];
    const acted: string[] = [];
    for (const [depth, actor] of [
      [0, "ruleA"],
      [1, "ruleB"],
      [2, "ruleA"],
    ] as const) {
      const decision = decideAutomations(
        rules.filter((rule) => rule.id === actor),
        event({ depth: Math.min(depth, 1), chain }),
      )[0];
      if (decision?.outcome !== "act") break;
      acted.push(actor);
      chain = chainOfRun({ chain }, actor);
    }
    expect(acted).toEqual(["ruleA", "ruleB"]);
  });

  it("lets a rule act on separate chains of separate events", () => {
    const first = decideAutomations([{ id: "ownRule", rule: notifyRule }], event({ chain: ["otherRule"] }));
    expect(first[0]?.outcome).toBe("act");
  });
});
