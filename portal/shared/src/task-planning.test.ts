import { describe, expect, it } from "vitest";
import {
  crossReplicationDependencies,
  type PlannedTask,
  roadmap,
  taskRisks,
  weekStart,
  weeksFrom,
  workload,
} from "./task-planning";

const task = (id: string, extra: Partial<PlannedTask> = {}): PlannedTask => ({
  id,
  title: `Task ${id}`,
  kind: "task",
  statusKey: "toDo",
  finished: false,
  startDate: null,
  dueDate: null,
  estimateMinutes: null,
  assigneeUids: [],
  unclaimedAssigneeIds: [],
  dependsOn: {},
  replicationId: null,
  listId: "list-1",
  ...extra,
});

describe("taskRisks", () => {
  it("names each reason a task is at risk, most overdue first, and leaves out finished tasks", () => {
    const tasks = [
      task("blocked", { statusKey: "blocked" }),
      task("late", { dueDate: "2026-11-01" }),
      task("later", { dueDate: "2026-11-09", dependsOn: { open: "finishToStart", closed: "finishToStart" } }),
      task("open"),
      task("closed", { finished: true, dueDate: "2026-01-01" }),
      task("fine", { dueDate: "2026-11-11" }),
    ];
    const risks = taskRisks(tasks, "2026-11-11");
    expect(risks.map((risk) => [risk.task.id, risk.reasons, risk.daysOverdue])).toEqual([
      ["late", ["overdue"], 10],
      ["later", ["overdue", "waitingOnUnfinished"], 2],
      ["blocked", ["blocked"], null],
    ]);
    expect(risks[1]?.waitingOn.map((other) => other.id)).toEqual(["open"]);
  });
});

describe("workload", () => {
  it("shares estimates among assignees by the week of the due date, and counts tasks without one", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    const weeks = weeksFrom("2026-11-11", 2);
    expect(weeks).toEqual(["2026-11-09", "2026-11-16"]);
    const rows = workload(
      [
        task("a", { assigneeUids: ["u1", "u2"], dueDate: "2026-11-12", estimateMinutes: 120 }),
        task("b", { assigneeUids: ["u1"], startDate: "2026-11-17" }),
        task("c", { assigneeUids: ["u1"], dueDate: "2026-12-30", estimateMinutes: 60 }),
        task("d", { assigneeUids: ["u2"], dueDate: "2026-11-10", estimateMinutes: 30, finished: true }),
        task("m", { assigneeUids: ["u2"], dueDate: "2026-11-10", kind: "milestone" }),
      ],
      weeks,
    );
    expect(rows).toEqual([
      {
        uid: "u1",
        personId: null,
        cells: [
          { taskIds: ["a"], minutes: 60, unestimated: 0 },
          { taskIds: ["b"], minutes: 0, unestimated: 1 },
        ],
      },
      {
        uid: "u2",
        personId: null,
        cells: [
          { taskIds: ["a"], minutes: 60, unestimated: 0 },
          { taskIds: [], minutes: 0, unestimated: 0 },
        ],
      },
    ]);
  });

  it("gives a person assigned without an account a row and a share of the estimate", () => {
    const weeks = weeksFrom("2026-11-11", 1);
    const rows = workload(
      [
        task("a", {
          assigneeUids: ["u1"],
          unclaimedAssigneeIds: ["person-ben"],
          dueDate: "2026-11-12",
          estimateMinutes: 120,
        }),
      ],
      weeks,
    );
    expect(rows.map((row) => [row.uid, row.personId, row.cells[0]?.minutes])).toEqual([
      ["u1", null, 60],
      [null, "person-ben", 60],
    ]);
  });
});

describe("crossReplicationDependencies and roadmap", () => {
  it("finds dependencies between replications and orders milestones by date", () => {
    const tasks = [
      task("a", { replicationId: "Rep1", dependsOn: { b: "finishToStart", c: "blocks" } }),
      task("b", { replicationId: "Rep2", kind: "milestone", dueDate: "2027-01-01" }),
      task("c", { replicationId: "Rep1" }),
      task("m", { kind: "milestone", dueDate: "2026-12-01" }),
      task("n", { kind: "milestone" }),
    ];
    expect(crossReplicationDependencies(tasks).map((found) => [found.task.id, found.dependsOn.id, found.kind])).toEqual(
      [["a", "b", "finishToStart"]],
    );
    expect(roadmap(tasks).map((milestone) => milestone.id)).toEqual(["m", "b", "n"]);
  });
});
