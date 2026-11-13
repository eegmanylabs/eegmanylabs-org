// Synthetic decisions and incidents of an invented replication.
import { describe, expect, it } from "vitest";
import type { DecisionDoc, IncidentActionDoc } from "../schemas/outputs";
import { decisionStates, incidentState } from "./governance";
import { appended } from "./test-support";

const scope = { replicationId: "SyntheticStudy2001", laboratoryId: null, scopeKeys: ["members"] };

function decision(id: string, iso: string, overrides: Partial<DecisionDoc> = {}): DecisionDoc & { id: string } {
  return {
    id,
    ...appended(iso),
    scopeType: "replication",
    scopeId: "SyntheticStudy2001",
    kind: "decision",
    title: `Decision ${id}`,
    summary: "A synthetic summary.",
    status: "accepted",
    deviations: [],
    recordedBy: "uid-synthetic",
    ...scope,
    ...overrides,
  };
}

describe("decisionStates", () => {
  it("shows a corrected decision with its latest content and keeps every entry in its history", () => {
    const states = decisionStates([
      decision("d1", "2026-01-01T00:00:00Z", { title: "Exclude noisy channels" }),
      decision("d2", "2026-01-02T00:00:00Z", {
        kind: "correction",
        correctsDecisionId: "d1",
        title: "Exclude noisy channels above 100 µV",
      }),
    ]);
    expect(states).toHaveLength(1);
    expect(states[0]?.current.title).toBe("Exclude noisy channels above 100 µV");
    expect(states[0]?.history.map((entry) => entry.id)).toEqual(["d1", "d2"]);
  });

  it("marks a decision that a later one replaces as superseded, newest first", () => {
    const states = decisionStates([
      decision("d1", "2026-01-01T00:00:00Z"),
      decision("d3", "2026-01-03T00:00:00Z", { supersedesDecisionId: "d1" }),
    ]);
    expect(states.map((state) => [state.id, state.status])).toEqual([
      ["d3", "accepted"],
      ["d1", "superseded"],
    ]);
    expect(states[1]?.supersededBy).toEqual(["d3"]);
  });

  it("keeps a correction of an unknown entry as a decision of its own", () => {
    const states = decisionStates([
      decision("d9", "2026-01-01T00:00:00Z", { kind: "correction", correctsDecisionId: "gone" }),
    ]);
    expect(states.map((state) => state.id)).toEqual(["d9"]);
  });
});

function action(id: string, iso: string, overrides: Partial<IncidentActionDoc>): IncidentActionDoc & { id: string } {
  return { id, ...appended(iso), incidentId: "i1", kind: "note", recordedBy: "uid-synthetic", ...scope, ...overrides };
}

describe("incidentState", () => {
  const report = { title: "Amplifier failure", description: "The amplifier stopped.", severity: "medium" as const };

  it("starts open and follows the changes of status", () => {
    expect(incidentState(report, []).status).toBe("open");
    const state = incidentState(report, [
      action("a1", "2026-01-01T00:00:00Z", { kind: "statusChange", status: "investigating" }),
      action("a2", "2026-01-02T00:00:00Z", { kind: "correctiveAction", text: "Replace the amplifier." }),
      action("a3", "2026-01-03T00:00:00Z", { kind: "statusChange", status: "resolved" }),
    ]);
    expect(state.status).toBe("resolved");
    expect(state.resolvedAt?.toISOString()).toBe("2026-01-03T00:00:00.000Z");
    expect(state.correctiveActions.map((item) => item.id)).toEqual(["a2"]);
  });

  it("applies corrections of the report and of an action, keeping the history whole", () => {
    const state = incidentState(report, [
      action("a1", "2026-01-01T00:00:00Z", { kind: "correctiveAction", text: "Replace the cable." }),
      action("a2", "2026-01-02T00:00:00Z", {
        kind: "correction",
        correctsActionId: "a1",
        text: "Replace the amplifier.",
      }),
      action("a3", "2026-01-03T00:00:00Z", { kind: "correction", correctedReport: { severity: "high" } }),
    ]);
    expect(state.severity).toBe("high");
    expect(state.title).toBe("Amplifier failure");
    expect(state.correctiveActions.map((item) => item.text)).toEqual(["Replace the amplifier."]);
    expect(state.corrected.has("a1")).toBe(true);
    expect(state.history).toHaveLength(3);
  });
});
