import { describe, expect, it } from "vitest";
import { DATASET_WORKFLOW_STATUSES } from "../seed/lookups";
import {
  canTransition,
  type DatasetWorkflow,
  DEFAULT_DATASET_WORKFLOW,
  nextStates,
  workflowProblems,
  workflowState,
} from "./workflow";

describe("the default workflow of datasets", () => {
  it("holds the seeded states in their order and starts at received", () => {
    expect(DEFAULT_DATASET_WORKFLOW.states.map((state) => state.key)).toEqual(
      DATASET_WORKFLOW_STATUSES.map((status) => status.key),
    );
    expect(DEFAULT_DATASET_WORKFLOW.initialKey).toBe("received");
    expect(workflowState(DEFAULT_DATASET_WORKFLOW, "analysisReady")?.analysisReady).toBe(true);
    expect(DEFAULT_DATASET_WORKFLOW.states.filter((state) => state.analysisReady)).toHaveLength(1);
  });

  it("is valid, with every state reachable", () => {
    expect(workflowProblems(DEFAULT_DATASET_WORKFLOW)).toEqual([]);
  });

  it("leads from received to analysis ready through the checks, and lets any check flag a dataset", () => {
    const path = [
      "received",
      "integrityChecked",
      "bidsValidated",
      "qcPending",
      "qcCompleted",
      "accepted",
      "preprocessing",
      "analysisReady",
    ];
    for (let index = 1; index < path.length; index += 1) {
      expect(canTransition(DEFAULT_DATASET_WORKFLOW, path[index - 1] ?? "", path[index] ?? "")).toBe(true);
    }
    for (const from of path.slice(0, -1)) expect(canTransition(DEFAULT_DATASET_WORKFLOW, from, "flagged")).toBe(true);
    expect(nextStates(DEFAULT_DATASET_WORKFLOW, "qcCompleted").map((state) => state.key)).toEqual([
      "accepted",
      "flagged",
    ]);
  });

  it("refuses a jump, a state that follows itself and a state it does not know", () => {
    expect(canTransition(DEFAULT_DATASET_WORKFLOW, "received", "analysisReady")).toBe(false);
    expect(canTransition(DEFAULT_DATASET_WORKFLOW, "received", "received")).toBe(false);
    expect(canTransition(DEFAULT_DATASET_WORKFLOW, "received", "archived")).toBe(false);
    expect(canTransition(DEFAULT_DATASET_WORKFLOW, "unknown", "received")).toBe(false);
  });
});

describe("workflowProblems", () => {
  const state = (key: string) => ({ key, label: key, category: "active" as const, analysisReady: false });

  it("finds duplicate keys, unknown states, self transitions and unreachable states", () => {
    const broken: DatasetWorkflow = {
      states: [state("a"), state("b"), state("b"), state("c")],
      transitions: { a: ["a", "x"], z: ["b"] },
      initialKey: "a",
    };
    expect(workflowProblems(broken)).toEqual([
      "Two states have the same key.",
      "The state a cannot follow itself.",
      "A transition from a leads to x, which is not a state.",
      "A transition starts from z, which is not a state.",
      "The state b cannot be reached from the first state.",
      "The state b cannot be reached from the first state.",
      "The state c cannot be reached from the first state.",
    ]);
  });

  it("finds a first state that is not a state", () => {
    expect(
      workflowProblems({ states: [state("a"), state("b")], transitions: { a: ["b"] }, initialKey: "q" }),
    ).toContain("The first state is not one of the states.");
  });
});
