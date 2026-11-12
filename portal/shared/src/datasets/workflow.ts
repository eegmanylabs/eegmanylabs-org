// The workflow of datasets (docs/DATA_MODEL.md, section 10). Each replication may define the
// states through which its datasets move and which state may follow which, in
// `datasetWorkflows/{studyKey}`; a replication that defines none uses the default below, built
// from the seeded statuses: received, integrity checked, BIDS validated, QC pending, QC
// completed, accepted or flagged, preprocessing and analysis ready. A change of state goes
// through a callable function, which checks it here and writes the status history.
import type { DatasetDoc, DatasetWorkflowState } from "../schemas/datasets";
import { DATASET_WORKFLOW_STATUSES } from "../seed/lookups";

/** A workflow as the functions and the pages use it, whether stored or the default. */
export interface DatasetWorkflow {
  readonly states: readonly DatasetWorkflowState[];
  readonly transitions: Readonly<Record<string, readonly string[]>>;
  readonly initialKey: string;
}

/**
 * Which state may follow which in the default workflow. A flagged dataset returns to the state
 * from which the problem can be dealt with, and an analysis-ready dataset may go back to
 * preprocessing when the preprocessing is run again.
 */
const DEFAULT_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  received: ["integrityChecked", "flagged"],
  integrityChecked: ["bidsValidated", "received", "flagged"],
  bidsValidated: ["qcPending", "integrityChecked", "flagged"],
  qcPending: ["qcCompleted", "flagged"],
  qcCompleted: ["accepted", "flagged"],
  accepted: ["preprocessing", "analysisReady", "flagged"],
  flagged: ["received", "integrityChecked", "bidsValidated", "qcPending", "qcCompleted", "accepted"],
  preprocessing: ["analysisReady", "flagged"],
  analysisReady: ["preprocessing", "flagged"],
};

export const DEFAULT_DATASET_WORKFLOW: DatasetWorkflow = {
  states: DATASET_WORKFLOW_STATUSES.map((status) => ({
    key: status.key,
    label: status.label,
    category: status.category,
    analysisReady: status.key === "analysisReady",
  })),
  transitions: DEFAULT_TRANSITIONS,
  initialKey: "received",
};

/** The state of a key, or undefined where the workflow has none of that key. */
export function workflowState(workflow: DatasetWorkflow, key: string): DatasetWorkflowState | undefined {
  return workflow.states.find((state) => state.key === key);
}

/** The states that may follow a state, in the order the workflow lists its states. */
export function nextStates(workflow: DatasetWorkflow, fromKey: string): DatasetWorkflowState[] {
  const allowed = new Set(workflow.transitions[fromKey] ?? []);
  return workflow.states.filter((state) => allowed.has(state.key));
}

/** Whether a dataset in one state may move to another. A state never follows itself. */
export function canTransition(workflow: DatasetWorkflow, fromKey: string, toKey: string): boolean {
  return (
    fromKey !== toKey &&
    (workflow.transitions[fromKey] ?? []).includes(toKey) &&
    workflowState(workflow, toKey) !== undefined
  );
}

/**
 * The problems of a workflow, in words, or none: two states with one key, a first state or a
 * transition that names no state, a state that follows itself, and a state that cannot be
 * reached from the first one.
 */
export function workflowProblems(workflow: DatasetWorkflow): string[] {
  const problems: string[] = [];
  const keys = workflow.states.map((state) => state.key);
  const known = new Set(keys);
  if (known.size !== keys.length) problems.push("Two states have the same key.");
  if (!known.has(workflow.initialKey)) problems.push("The first state is not one of the states.");
  for (const [from, targets] of Object.entries(workflow.transitions)) {
    if (!known.has(from)) problems.push(`A transition starts from ${from}, which is not a state.`);
    for (const to of targets) {
      if (!known.has(to)) problems.push(`A transition from ${from} leads to ${to}, which is not a state.`);
      if (to === from) problems.push(`The state ${from} cannot follow itself.`);
    }
  }
  const reached = new Set<string>([workflow.initialKey]);
  const queue = [workflow.initialKey];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const next of workflow.transitions[current] ?? []) {
      if (known.has(next) && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  for (const key of keys)
    if (!reached.has(key)) problems.push(`The state ${key} cannot be reached from the first state.`);
  return problems;
}

/** The states of the default workflow that claim a check has passed. */
const CHECKED_STATES: ReadonlySet<string> = new Set(["bidsValidated", "qcCompleted", "accepted"]);

/** Whether moving to a state claims that the dataset's checks have passed: a checked state, or one ready for analysis. */
export function claimsChecksPassed(state: DatasetWorkflowState): boolean {
  return state.analysisReady || CHECKED_STATES.has(state.key);
}

/**
 * What the record of a dataset says against a state that claims its checks have passed, in
 * words: an invalid BIDS report, a quality control that flagged or failed it, expected files
 * that have not arrived, and copies that are not all available. A move to such a state needs
 * the problems acknowledged, and the acknowledgement is kept with the move.
 */
export function datasetContradictions(
  dataset: Pick<DatasetDoc, "bidsStatus" | "qcStatus" | "expectedFileCount" | "receivedFileCount" | "availability">,
): string[] {
  const problems: string[] = [];
  if (dataset.bidsStatus === "invalid") problems.push("the BIDS report is invalid");
  if (dataset.qcStatus === "flagged" || dataset.qcStatus === "failed") {
    problems.push(`quality control ${dataset.qcStatus === "flagged" ? "flagged" : "failed"} it`);
  }
  if (
    dataset.expectedFileCount !== undefined &&
    dataset.receivedFileCount !== undefined &&
    dataset.receivedFileCount < dataset.expectedFileCount
  ) {
    const missing = dataset.expectedFileCount - dataset.receivedFileCount;
    problems.push(`${missing} expected ${missing === 1 ? "file is" : "files are"} missing`);
  }
  if (dataset.availability === "partial" || dataset.availability === "unavailable") {
    problems.push(dataset.availability === "partial" ? "only some copies are available" : "no copy is available");
  }
  return problems;
}
