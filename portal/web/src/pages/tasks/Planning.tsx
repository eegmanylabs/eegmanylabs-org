// The planning views of tasks: the workload of each assignee by week, the risks and blockers, the
// roadmap of milestones and the dependencies that cross from one replication to another. Each is
// computed from the tasks the viewer may read (task-planning.ts of the shared package).
import {
  crossReplicationDependencies,
  type PlannedTask,
  roadmap,
  type TaskRisk,
  taskRisks,
  type WorkloadCell,
  weeksFrom,
  workload,
} from "@eegml/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { DEPENDENCY_LABELS } from "./TaskFields";

export interface PlanningProps {
  readonly tasks: readonly PlannedTask[];
  readonly today: string;
  readonly nameOf: (uid: string) => string;
  /** The name of a person who has no account yet. */
  readonly personName: (personId: string) => string;
  readonly listName: (listId: string) => string;
  readonly onOpen: (taskId: string) => void;
}

const REASONS: Readonly<Record<TaskRisk["reasons"][number], string>> = {
  blocked: "Blocked",
  overdue: "Overdue",
  waitingOnUnfinished: "Waiting on unfinished work",
};

function TaskButton({ task, onOpen }: { readonly task: PlannedTask; readonly onOpen: (taskId: string) => void }) {
  return (
    <button type="button" className="text-left hover:underline" onClick={() => onOpen(task.id)}>
      {task.title}
    </button>
  );
}

/** The risks and blockers: what is blocked, overdue or waiting on an unfinished task. */
export function RisksView({ tasks, today, listName, onOpen }: PlanningProps) {
  const risks = taskRisks(tasks, today);
  if (risks.length === 0) {
    return (
      <EmptyState
        title="Nothing is at risk"
        description="No unfinished task is blocked, overdue or waiting on unfinished work."
      />
    );
  }
  return (
    <Table caption="Tasks at risk, the most overdue first">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Task</TableHeaderCell>
          <TableHeaderCell>Why</TableHeaderCell>
          <TableHeaderCell>Due</TableHeaderCell>
          <TableHeaderCell>Waiting on</TableHeaderCell>
          <TableHeaderCell>List</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {risks.map((risk) => (
          <TableRow key={risk.task.id}>
            <TableCell>
              <TaskButton task={risk.task} onOpen={onOpen} />
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap gap-1">
                {risk.reasons.map((reason) => (
                  <Badge key={reason} tone={reason === "overdue" ? "accent" : "outline"}>
                    {REASONS[reason]}
                    {reason === "overdue" && risk.daysOverdue !== null ? `, ${risk.daysOverdue} days` : ""}
                  </Badge>
                ))}
              </span>
            </TableCell>
            <TableCell>{risk.task.dueDate ?? "No date"}</TableCell>
            <TableCell>
              <ul className="grid gap-0.5">
                {risk.waitingOn.map((other) => (
                  <li key={other.id}>
                    <TaskButton task={other} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            </TableCell>
            <TableCell>{listName(risk.task.listId)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;

/** The time of a cell in words: never zero for tasks whose estimate nobody knows. */
function cellEstimate(cell: WorkloadCell): string {
  if (cell.unestimated === cell.taskIds.length) return "estimate unknown";
  if (cell.unestimated > 0) return `at least ${hours(cell.minutes)}, ${cell.unestimated} without an estimate`;
  return hours(cell.minutes);
}

/** The workload: the unfinished tasks and their estimates of each assignee, week by week. */
export function WorkloadView({ tasks, today, nameOf, personName, onOpen }: PlanningProps) {
  const [start, setStart] = useState(today);
  const weeks = weeksFrom(start, 6);
  const rows = workload(tasks, weeks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const shift = (by: number) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + by * 7);
    setStart(date.toISOString().slice(0, 10));
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shift(-6)}>
          Earlier weeks
        </Button>
        <Button size="sm" variant="outline" onClick={() => setStart(today)}>
          This week
        </Button>
        <Button size="sm" variant="outline" onClick={() => shift(6)}>
          Later weeks
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No assigned work in these weeks"
          description="Tasks appear here by the week of their due date, or of their start where they have no due date."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Unfinished tasks and their estimates by assignee and week">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Assignee</TableHeaderCell>
                {weeks.map((week) => (
                  <TableHeaderCell key={week}>Week of {week}</TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.uid ?? `person ${row.personId}`}>
                  <TableHeaderCell scope="row">
                    {row.uid === null ? `${personName(row.personId ?? "")} (no account yet)` : nameOf(row.uid)}
                  </TableHeaderCell>
                  {row.cells.map((cell, index) => (
                    <TableCell key={weeks[index]}>
                      {cell.taskIds.length === 0 ? (
                        <span className="text-fg-muted">None</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer">
                            {cell.taskIds.length} {cell.taskIds.length === 1 ? "task" : "tasks"}, {cellEstimate(cell)}
                          </summary>
                          <ul className="mt-1 grid gap-0.5">
                            {cell.taskIds.map((id) => {
                              const task = byId.get(id);
                              return task === undefined ? null : (
                                <li key={id}>
                                  <TaskButton task={task} onOpen={onOpen} />
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** The roadmap of the programme: every milestone the viewer may read, by its planned date. */
export function RoadmapView({ tasks, listName, onOpen }: PlanningProps) {
  const milestones = roadmap(tasks);
  if (milestones.length === 0) {
    return <EmptyState title="No milestones yet" description="Make a task a milestone to place it on the roadmap." />;
  }
  return (
    <ol className="grid gap-2" aria-label="Milestones by planned date">
      {milestones.map((milestone) => (
        <li key={milestone.id} className="flex flex-wrap items-center gap-3 rounded-control border border-border p-2">
          <span className="w-28 shrink-0 text-sm text-fg-muted">{milestone.dueDate ?? "No date"}</span>
          <span className="min-w-0 flex-1">
            <TaskButton task={milestone} onOpen={onOpen} />
          </span>
          {milestone.replicationId === null ? null : <Badge tone="outline">{milestone.replicationId}</Badge>}
          <span className="text-xs text-fg-muted">{listName(milestone.listId)}</span>
          {milestone.finished ? <Badge>Reached</Badge> : null}
        </li>
      ))}
    </ol>
  );
}

/** The dependencies whose two tasks belong to different replications. */
export function CrossDependenciesView({ tasks, onOpen }: PlanningProps) {
  const found = crossReplicationDependencies(tasks);
  if (found.length === 0) {
    return (
      <EmptyState
        title="No dependencies between replications"
        description="No task depends on a task of another replication."
      />
    );
  }
  return (
    <Table caption="Dependencies between replications">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Task</TableHeaderCell>
          <TableHeaderCell>Replication</TableHeaderCell>
          <TableHeaderCell>Depends on</TableHeaderCell>
          <TableHeaderCell>Of replication</TableHeaderCell>
          <TableHeaderCell>Kind</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {found.map((entry) => (
          <TableRow key={`${entry.task.id}>${entry.dependsOn.id}`}>
            <TableCell>
              <TaskButton task={entry.task} onOpen={onOpen} />
            </TableCell>
            <TableCell>{entry.task.replicationId ?? "None"}</TableCell>
            <TableCell>
              <TaskButton task={entry.dependsOn} onOpen={onOpen} />
            </TableCell>
            <TableCell>{entry.dependsOn.replicationId ?? "None"}</TableCell>
            <TableCell>{DEPENDENCY_LABELS[entry.kind] ?? entry.kind}</TableCell>
            <TableCell>{entry.dependsOn.finished ? "Finished" : "Unfinished"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
