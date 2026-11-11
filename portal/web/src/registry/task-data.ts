// The live reads of tasks (docs/DATA_MODEL.md, sections 8 and 15). A member reads the lists and
// the tasks of the scopes they hold, their own personal lists, and every task that names them as
// a participant, whatever its list; programme staff read every list and task. The browser joins
// these reads into one set, which every view of tasks filters, sorts and groups for itself, so a
// task is one document wherever it appears.
import {
  CORE_SOURCES,
  type CollectionData,
  coreCollection,
  isFirestoreTimestamp,
  type PlannedTask,
  type SourceLookups,
  TASK_STATUSES,
} from "@eegml/shared";
import { useMemo } from "react";
import { type Live, type LiveQuery, type RecordOf, useLiveCollection, useLiveQueries, useLiveQuery } from "@/data";
import { combineLive, orEmpty } from "@/registry/combine";
import type { Viewer } from "@/registry/viewer";

/** The most documents one query asks for, the most the security rules allow. */
export const TASK_QUERY_LIMIT = 1_000;

export type TaskRecord = RecordOf<"tasks">;
export type TaskListRecord = RecordOf<"taskLists">;
export type StatusRecord = RecordOf<"statusDefinitions">;

export interface TaskData {
  readonly lists: readonly TaskListRecord[];
  readonly tasks: readonly TaskRecord[];
  readonly statuses: readonly StatusRecord[];
  readonly tags: readonly RecordOf<"tags">[];
  /** Whether a read stopped at its limit, so that the set is not complete. */
  readonly truncated: boolean;
}

export const TASK_STATUS_QUERY: LiveQuery<"statusDefinitions"> = {
  collection: "statusDefinitions",
  within: [],
  where: [["entityType", "==", "task"]],
  limit: 100,
};

export const ALL_TAGS: LiveQuery<"tags"> = { collection: "tags", within: [], limit: TASK_QUERY_LIMIT };

/** The queries that together read every list a viewer may read. */
export function listQueries(viewer: Viewer): LiveQuery<"taskLists">[] {
  if (viewer.staff) return [];
  return [
    {
      collection: "taskLists",
      within: [],
      where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]],
      limit: TASK_QUERY_LIMIT,
    },
    { collection: "taskLists", within: [], where: [["ownerUid", "==", viewer.uid]], limit: TASK_QUERY_LIMIT },
  ];
}

/** The queries that together read every task a viewer may read. */
export function taskQueries(viewer: Viewer): LiveQuery<"tasks">[] {
  const participant = (field: "assigneeUids" | "collaboratorUids" | "followerUids"): LiveQuery<"tasks"> => ({
    collection: "tasks",
    within: [],
    where: [[field, "array-contains", viewer.uid]],
    limit: TASK_QUERY_LIMIT,
  });
  if (viewer.staff) return [];
  return [
    {
      collection: "tasks",
      within: [],
      where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]],
      limit: TASK_QUERY_LIMIT,
    },
    { collection: "tasks", within: [], where: [["ownerUid", "==", viewer.uid]], limit: TASK_QUERY_LIMIT },
    participant("assigneeUids"),
    participant("collaboratorUids"),
    participant("followerUids"),
  ];
}

const unique = <T extends { readonly id: string }>(lists: readonly (readonly T[])[]): T[] => {
  const byId = new Map<string, T>();
  for (const list of lists) for (const item of list) byId.set(item.id, item);
  return [...byId.values()];
};

/** Every list and task the viewer may read, with the statuses of tasks and the tags, live. */
export function useTaskData(viewer: Viewer | null): Live<TaskData> {
  const staff = viewer?.staff === true;
  const allLists = useLiveCollection(
    viewer !== null && staff ? { collection: "taskLists", within: [], limit: TASK_QUERY_LIMIT } : null,
  );
  const allTasks = useLiveCollection(
    viewer !== null && staff ? { collection: "tasks", within: [], limit: TASK_QUERY_LIMIT } : null,
  );
  const scopedLists = orEmpty(useLiveQueries(viewer === null ? [] : listQueries(viewer)));
  const scopedTasks = orEmpty(useLiveQueries(viewer === null ? [] : taskQueries(viewer)));
  const statuses = useLiveQuery(viewer === null ? null : TASK_STATUS_QUERY);
  const tags = useLiveQuery(viewer === null ? null : ALL_TAGS);
  return useMemo(() => {
    if (viewer === null) return { status: "idle" };
    const lists: Live<{ items: readonly TaskListRecord[]; truncated: boolean }> = staff
      ? allLists
      : combineLive([scopedLists] as const, (found) => ({
          items: unique(found),
          truncated: found.some((page) => page.length >= TASK_QUERY_LIMIT),
        }));
    const tasks: Live<{ items: readonly TaskRecord[]; truncated: boolean }> = staff
      ? allTasks
      : combineLive([scopedTasks] as const, (found) => ({
          items: unique(found),
          truncated: found.some((page) => page.length >= TASK_QUERY_LIMIT),
        }));
    return combineLive([lists, tasks, statuses, tags] as const, (listData, taskData, statusData, tagData) => ({
      lists: listData.items,
      tasks: taskData.items,
      statuses: [...statusData].sort((a, b) => a.position - b.position),
      tags: tagData,
      truncated: listData.truncated || taskData.truncated,
    }));
  }, [viewer, staff, allLists, allTasks, scopedLists, scopedTasks, statuses, tags]);
}

/** The statuses of tasks, from the lookup data, or the seeded ones before it has loaded. */
export function statusesOf(
  data: Pick<TaskData, "statuses">,
): readonly { key: string; label: string; category: string }[] {
  const configured = data.statuses.filter((status) => status.archivedAt === null);
  return configured.length > 0
    ? configured.map((status) => ({ key: status.key, label: status.label, category: status.category }))
    : TASK_STATUSES.map((status) => ({ key: status.key, label: status.label, category: status.category }));
}

/** Whether a status counts as finished. */
export function finishedStatus(data: Pick<TaskData, "statuses">, key: string): boolean {
  const category = statusesOf(data).find((status) => status.key === key)?.category;
  return category === "done" || category === "cancelled";
}

/** The lookups that the view engine names the lists, statuses and tags of tasks with. */
export function taskLookups(data: TaskData): Pick<SourceLookups, "taskStatuses" | "taskLists" | "tags"> {
  return {
    taskStatuses: statusesOf(data),
    taskLists: data.lists.map((list) => ({ id: list.id, name: list.name })),
    tags: data.tags.map((tag) => ({ id: tag.id, name: tag.name })),
  };
}

/** The tasks as a collection of the view engine. */
export function taskCollection(data: TaskData, lookups: SourceLookups): CollectionData {
  return coreCollection(
    CORE_SOURCES["core:tasks"],
    data.tasks
      .filter((task) => task.archivedAt === null)
      .map((task) => ({ id: task.id, data: task as unknown as Readonly<Record<string, unknown>> })),
    {},
    lookups,
  );
}

/** The reader's calendar day of a stored instant, or null. */
export function dayOf(value: unknown): string | null {
  if (!isFirestoreTimestamp(value)) return null;
  const date = value.toDate();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A task as the planning summaries read it. */
export function plannedTask(task: TaskRecord, finished: boolean): PlannedTask {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    statusKey: task.statusKey,
    finished,
    startDate: dayOf(task.startAt),
    dueDate: dayOf(task.dueAt),
    estimateMinutes: task.estimateMinutes ?? null,
    assigneeUids: task.assigneeUids,
    unclaimedAssigneeIds: task.unclaimedParticipants
      .filter((participant) => participant.role === "assignee")
      .map((participant) => participant.personId),
    dependsOn: task.dependsOn,
    replicationId: task.replicationId,
    listId: task.listId,
  };
}

/** Whether the viewer manages the tasks of a list, as the functions decide it for this session. */
export function managesList(viewer: Viewer, list: Pick<TaskListRecord, "scopeType" | "scopeId" | "ownerUid">): boolean {
  if (!viewer.access.member) return false;
  switch (list.scopeType) {
    case "user":
      return list.ownerUid === viewer.uid;
    case "programme":
      return viewer.can("tasks.manage", "programme");
    case "replication":
      return viewer.can("tasks.manage", { replicationId: list.scopeId });
    case "laboratory":
      return viewer.can("tasks.manage", { laboratoryId: list.scopeId });
    case "group":
      return viewer.can("tasks.manage", { groupKey: list.scopeId });
  }
}

/** What the viewer may do with a task: manage it, work on it as a participant, or read it. */
export function roleOnTask(
  viewer: Viewer,
  list: TaskListRecord | undefined,
  task: Pick<TaskRecord, "assigneeUids" | "collaboratorUids">,
): "manager" | "participant" | "reader" {
  if (list !== undefined && managesList(viewer, list)) return "manager";
  return task.assigneeUids.includes(viewer.uid) || task.collaboratorUids.includes(viewer.uid)
    ? "participant"
    : "reader";
}
