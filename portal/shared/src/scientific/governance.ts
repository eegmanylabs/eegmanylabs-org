// The methodological decision log and the incident registry (requirements R12.6 and R12.7).
// Both are append-only: an entry never changes, and a correction is a new entry that names the
// one it corrects. These functions read the current state from the entries, so every reader
// sees the same state and the history stays whole.
import type { DecisionDoc, IncidentActionDoc, IncidentDoc, IncidentStatus } from "../schemas/outputs";

type Stored<T> = T & { readonly id: string };

/** A decision as it reads now: its first entry, the latest correction of it, and what replaced it. */
export interface DecisionState {
  /** The identifier of the first entry, which names the decision. */
  readonly id: string;
  /** The entry whose content holds now: the latest correction, or the first entry. */
  readonly current: Stored<DecisionDoc>;
  /** Every entry of the decision, the first and its corrections, oldest first. */
  readonly history: readonly Stored<DecisionDoc>[];
  /** The decisions that name this one in `supersedesDecisionId`. */
  readonly supersededBy: readonly string[];
  /** The status as it reads now: superseded once a later decision replaces it. */
  readonly status: DecisionDoc["status"];
}

const instantOf = (entry: { readonly createdAt: { toMillis(): number } }) => entry.createdAt.toMillis();

/**
 * Folds the entries of a log into decisions. A correction belongs to the decision it corrects; a
 * correction that names no entry of the log is shown as a decision of its own, so nothing is lost.
 * Decisions are returned newest first by their first entry.
 */
export function decisionStates(entries: readonly Stored<DecisionDoc>[]): DecisionState[] {
  const sorted = [...entries].sort((a, b) => instantOf(a) - instantOf(b) || a.id.localeCompare(b.id));
  const firsts = new Map<string, Stored<DecisionDoc>[]>();
  for (const entry of sorted) {
    const target = entry.kind === "correction" ? entry.correctsDecisionId : undefined;
    if (target !== undefined && firsts.has(target)) firsts.get(target)?.push(entry);
    else firsts.set(entry.id, [entry]);
  }
  const supersededBy = new Map<string, string[]>();
  for (const [id, history] of firsts) {
    const replaced = (history.at(-1) as Stored<DecisionDoc>).supersedesDecisionId;
    if (replaced !== undefined) supersededBy.set(replaced, [...(supersededBy.get(replaced) ?? []), id]);
  }
  return [...firsts]
    .map(([id, history]) => {
      const current = history.at(-1) as Stored<DecisionDoc>;
      const replacements = supersededBy.get(id) ?? [];
      return {
        id,
        current,
        history,
        supersededBy: replacements,
        status: replacements.length > 0 ? ("superseded" as const) : current.status,
      };
    })
    .sort((a, b) => instantOf(b.history[0] as Stored<DecisionDoc>) - instantOf(a.history[0] as Stored<DecisionDoc>));
}

/** An incident as it reads now, from its report and the actions recorded on it. */
export interface IncidentState {
  readonly status: IncidentStatus;
  readonly title: string;
  readonly description: string;
  readonly severity: IncidentDoc["severity"];
  /** The corrective actions that a later correction has not withdrawn, oldest first. */
  readonly correctiveActions: readonly Stored<IncidentActionDoc>[];
  /** When the incident was last resolved, while it stays resolved. */
  readonly resolvedAt: Date | null;
  /** Every action, oldest first, for the history. */
  readonly history: readonly Stored<IncidentActionDoc>[];
  /** The actions that later corrections replaced, by identifier. */
  readonly corrected: ReadonlySet<string>;
}

/**
 * Folds the actions of an incident into its state. A status change sets the status. A correction
 * of the report replaces the title, the description or the severity it states. A correction that
 * names an action marks that action as corrected and, where it states text, stands in its place.
 */
export function incidentState(
  incident: Pick<IncidentDoc, "title" | "description" | "severity">,
  actions: readonly Stored<IncidentActionDoc>[],
): IncidentState {
  const history = [...actions].sort((a, b) => instantOf(a) - instantOf(b) || a.id.localeCompare(b.id));
  let status: IncidentStatus = "open";
  let resolvedAt: Date | null = null;
  let { title, description, severity } = incident;
  const corrected = new Set<string>();
  for (const action of history) {
    if (action.correctsActionId !== undefined) corrected.add(action.correctsActionId);
    if (action.kind === "statusChange" && action.status !== undefined) {
      status = action.status;
      resolvedAt = action.status === "resolved" ? new Date(instantOf(action)) : null;
    }
    if (action.kind === "correction" && action.correctedReport !== undefined) {
      title = action.correctedReport.title ?? title;
      description = action.correctedReport.description ?? description;
      severity = action.correctedReport.severity ?? severity;
    }
  }
  const correctiveActions = history.filter(
    (action) =>
      !corrected.has(action.id) &&
      (action.kind === "correctiveAction" ||
        (action.kind === "correction" && action.correctsActionId !== undefined && action.text !== undefined)),
  );
  return { status, title, description, severity, correctiveActions, resolvedAt, history, corrected };
}
