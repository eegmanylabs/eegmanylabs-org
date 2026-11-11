// Summaries over tasks that the planning views draw (docs/DATA_MODEL.md, section 15): the risks
// and blockers of a set of tasks, the workload of each assignee by week, and the dependencies
// that cross from one replication to another. Each is computed in the browser from the tasks
// the reader may load, so a reader sees a summary of what they may read and of nothing else.
import { shiftIsoDate } from "./recurrence";

/** What the summaries read of a task. Dates are ISO dates in the reader's calendar. */
export interface PlannedTask {
  readonly id: string;
  readonly title: string;
  readonly kind: "task" | "milestone";
  readonly statusKey: string;
  /** Whether the status counts as finished: done or cancelled. */
  readonly finished: boolean;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly estimateMinutes: number | null;
  readonly assigneeUids: readonly string[];
  /** The people assigned who have no account yet, by their person. */
  readonly unclaimedAssigneeIds: readonly string[];
  readonly dependsOn: Readonly<Record<string, string>>;
  readonly replicationId: string | null;
  readonly listId: string;
}

/** The status of a task that is blocked, as the programme seeds it. */
export const BLOCKED_STATUS_KEY = "blocked";

export type RiskReason = "blocked" | "overdue" | "waitingOnUnfinished";

export interface TaskRisk {
  readonly task: PlannedTask;
  readonly reasons: readonly RiskReason[];
  /** The unfinished tasks it depends on, where those are among the tasks given. */
  readonly waitingOn: readonly PlannedTask[];
  /** Whole days past the due date, for an overdue task. */
  readonly daysOverdue: number | null;
}

function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The unfinished tasks that are at risk: in the blocked status, past their due date, or
 * depending on a task that is not finished. Most overdue first, then by due date and title.
 */
export function taskRisks(tasks: readonly PlannedTask[], today: string): TaskRisk[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const risks: TaskRisk[] = [];
  for (const task of tasks) {
    if (task.finished) continue;
    const reasons: RiskReason[] = [];
    if (task.statusKey === BLOCKED_STATUS_KEY) reasons.push("blocked");
    const overdue = task.dueDate !== null && task.dueDate < today;
    if (overdue) reasons.push("overdue");
    const waitingOn = Object.keys(task.dependsOn)
      .map((id) => byId.get(id))
      .filter((other): other is PlannedTask => other !== undefined && !other.finished);
    if (waitingOn.length > 0) reasons.push("waitingOnUnfinished");
    if (reasons.length === 0) continue;
    risks.push({
      task,
      reasons,
      waitingOn,
      daysOverdue: overdue && task.dueDate !== null ? daysFrom(task.dueDate, today) : null,
    });
  }
  return risks.sort(
    (a, b) =>
      (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) ||
      (a.task.dueDate ?? "9999").localeCompare(b.task.dueDate ?? "9999") ||
      a.task.title.localeCompare(b.task.title, "en-GB"),
  );
}

/** The Monday that begins the week of an ISO date. */
export function weekStart(isoDate: string): string {
  const weekday = (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  return shiftIsoDate(isoDate, -weekday);
}

/** The Mondays of `count` weeks from the week of `from`. */
export function weeksFrom(from: string, count: number): string[] {
  const first = weekStart(from);
  return Array.from({ length: count }, (_, index) => shiftIsoDate(first, index * 7));
}

export interface WorkloadCell {
  readonly taskIds: readonly string[];
  /** The estimates of those tasks that have one, in minutes, shared equally among their assignees. */
  readonly minutes: number;
  /** How many of those tasks have no estimate. */
  readonly unestimated: number;
}

export interface WorkloadRow {
  /** The assignee's account, or null for a person who has none yet. */
  readonly uid: string | null;
  /** The person of an assignee who has no account yet, or null. */
  readonly personId: string | null;
  /** One cell for each week, in the order of the weeks given. */
  readonly cells: readonly WorkloadCell[];
}

/**
 * The unfinished tasks of each assignee in each week, by due date, or by start date where a
 * task has no due date, with the estimates shared equally among the assignees of a task. A task
 * without either date, or outside the weeks given, is left out. A task without an estimate is
 * counted and never treated as taking no time. A person assigned who has no account yet has a
 * row of their own, and takes a share of the estimates like everyone else.
 */
export function workload(tasks: readonly PlannedTask[], weeks: readonly string[]): WorkloadRow[] {
  const rows = new Map<string, { taskIds: string[]; minutes: number; unestimated: number }[]>();
  // An account and a person without one never share a key.
  const ACCOUNT = "account ";
  const PERSON = "person ";
  const weekIndex = new Map(weeks.map((week, index) => [week, index]));
  for (const task of tasks) {
    if (task.finished || task.kind === "milestone") continue;
    const date = task.dueDate ?? task.startDate;
    if (date === null) continue;
    const index = weekIndex.get(weekStart(date));
    if (index === undefined) continue;
    const assignees = [
      ...task.assigneeUids.map((uid) => ACCOUNT + uid),
      ...task.unclaimedAssigneeIds.map((personId) => PERSON + personId),
    ];
    for (const key of assignees) {
      const cells = rows.get(key) ?? weeks.map(() => ({ taskIds: [] as string[], minutes: 0, unestimated: 0 }));
      rows.set(key, cells);
      const cell = cells[index] as { taskIds: string[]; minutes: number; unestimated: number };
      cell.taskIds.push(task.id);
      if (task.estimateMinutes === null) cell.unestimated += 1;
      else cell.minutes += task.estimateMinutes / assignees.length;
    }
  }
  return [...rows]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cells]) => ({
      uid: key.startsWith(ACCOUNT) ? key.slice(ACCOUNT.length) : null,
      personId: key.startsWith(PERSON) ? key.slice(PERSON.length) : null,
      cells: cells.map((cell) => ({ ...cell, minutes: Math.round(cell.minutes) })),
    }));
}

export interface CrossDependency {
  readonly task: PlannedTask;
  readonly dependsOn: PlannedTask;
  readonly kind: string;
}

/** The dependencies whose two tasks belong to different replications, or to a replication and none. */
export function crossReplicationDependencies(tasks: readonly PlannedTask[]): CrossDependency[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const found: CrossDependency[] = [];
  for (const task of tasks) {
    for (const [id, kind] of Object.entries(task.dependsOn)) {
      const other = byId.get(id);
      if (other === undefined || other.replicationId === task.replicationId) continue;
      found.push({ task, dependsOn: other, kind });
    }
  }
  return found.sort(
    (a, b) =>
      (a.task.replicationId ?? "").localeCompare(b.task.replicationId ?? "") ||
      a.task.title.localeCompare(b.task.title, "en-GB"),
  );
}

/** The milestones among tasks, by planned date, then title; those without a date last. */
export function roadmap(tasks: readonly PlannedTask[]): PlannedTask[] {
  return tasks
    .filter((task) => task.kind === "milestone")
    .sort(
      (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title, "en-GB"),
    );
}
