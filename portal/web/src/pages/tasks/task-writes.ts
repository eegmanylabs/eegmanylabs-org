// The changes the interface makes to tasks, each through its callable function: the functions
// decide again who may make them, keep the tree, the status history and the dependencies, and
// write the audit entry. A refusal comes back as words that can be shown.
import {
  type CallableInput,
  createTaskContract,
  dateOnlyInstant,
  moveTaskContract,
  setReminderContract,
  setTaskStatusContract,
  type TaskPatch,
  updateTasksContract,
} from "@eegml/shared";
import { CallableError, callFunction } from "@/data";
import type { TaskRecord } from "@/registry/task-data";

/** The message of a refusal, or a general one where the server gave none that may be shown. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof CallableError ? error.message : fallback;
}

export async function changeTasks(
  changes: readonly { readonly taskId: string; readonly patch: TaskPatch }[],
): Promise<void> {
  if (changes.length === 0) return;
  await callFunction(updateTasksContract, { changes: [...changes] });
}

export async function changeTask(taskId: string, patch: TaskPatch): Promise<void> {
  await changeTasks([{ taskId, patch }]);
}

export async function setStatus(tasks: readonly TaskRecord[], toStatusKey: string): Promise<void> {
  const moving = tasks.filter((task) => task.statusKey !== toStatusKey);
  if (moving.length === 0) return;
  await callFunction(setTaskStatusContract, {
    tasks: moving.map((task) => ({ taskId: task.id, fromStatusKey: task.statusKey })),
    toStatusKey,
  });
}

export async function addTask(
  listId: string,
  parentId: string | null,
  fields: CallableInput<typeof createTaskContract>["fields"],
  index?: number,
): Promise<string> {
  const { taskId } = await callFunction(createTaskContract, {
    listId,
    parentId,
    fields,
    ...(index === undefined ? {} : { index }),
  });
  return taskId;
}

/** Sets a reminder of the signed-in account about a task, delivered among its notifications at a time. */
export async function addReminder(taskId: string, remindAt: Date): Promise<void> {
  await callFunction(setReminderContract, {
    entityType: "task",
    entityId: taskId,
    remindAt: remindAt.toISOString(),
    channel: "inApp",
  });
}

export async function moveTask(taskId: string, listId: string, parentId: string | null, index: number): Promise<void> {
  await callFunction(moveTaskContract, { taskId, listId, parentId, index: Math.max(0, index) });
}

/** The instant of a date that a date field gives, as a task stores a date without a time. */
export function instantOfDay(day: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? dateOnlyInstant(day) : null;
}
