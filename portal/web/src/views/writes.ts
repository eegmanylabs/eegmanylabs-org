// The writes of a view, all through the callable function that checks every value: in groups of
// the most records one call takes, so that a bulk edit of many rows still goes through.
import {
  type CallableInput,
  dateOnlyInstant,
  type PropertyValue,
  SAVE_RECORDS_MAX,
  saveRecordsContract,
  setTaskStatusContract,
  TASK_BATCH_MAX,
  type TaskPatch,
  updateTasksContract,
} from "@eegml/shared";
import { callFunction } from "@/data";

type StoredValues = CallableInput<typeof saveRecordsContract>["changes"][number]["values"];

export interface RecordChange {
  /** The record to change, or none for a new row of a database. */
  readonly recordId?: string;
  readonly title?: string;
  readonly values: Readonly<Record<string, PropertyValue>>;
}

/** Saves changes to records, and returns the identifiers of the records, new ones included. */
export async function saveRecordChanges(
  collectionKey: string,
  changes: readonly RecordChange[],
  archive: readonly string[] = [],
): Promise<string[]> {
  const recordIds: string[] = [];
  for (let start = 0; start < Math.max(changes.length, archive.length); start += SAVE_RECORDS_MAX) {
    const result = await callFunction(saveRecordsContract, {
      collectionKey,
      changes: changes.slice(start, start + SAVE_RECORDS_MAX).map((change) => ({
        ...(change.recordId === undefined ? {} : { recordId: change.recordId }),
        ...(change.title === undefined ? {} : { title: change.title }),
        values: change.values as StoredValues,
      })),
      archive: archive.slice(start, start + SAVE_RECORDS_MAX),
    });
    recordIds.push(...result.recordIds);
  }
  return recordIds;
}

/** The patch of a task that a value of one of its view properties stands for. */
function taskPatchOf(propertyId: string, value: PropertyValue): TaskPatch | null {
  const text = typeof value === "string" && value !== "" ? value : null;
  const texts = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const day = (raw: string | null) =>
    raw === null ? null : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dateOnlyInstant(raw) : new Date(raw).toISOString();
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
  switch (propertyId) {
    case "title":
      return text === null ? null : { title: text };
    case "priority":
      return { priority: (text ?? "none") as TaskPatch["priority"] };
    case "assignees":
      return { assigneeUids: texts };
    case "tags":
      return { tagIds: texts };
    case "startAt":
      return { startAt: day(text) };
    case "dueAt":
      return { dueAt: day(text) };
    case "estimateMinutes":
      // The view shows the estimate in hours; the task stores minutes.
      return { estimateMinutes: number === null ? null : Math.max(0, Math.round(number * 60)) };
    case "progressPercent":
      return { progressPercent: number === null ? null : Math.max(0, Math.min(100, number)) };
    default:
      return null;
  }
}

/**
 * Saves values of tasks from a view, through the functions of tasks: a status through the one
 * that keeps its history, everything else through the one that changes tasks, a hundred at a time.
 */
export async function saveTaskValues(
  records: readonly { readonly id: string; readonly values: Readonly<Record<string, PropertyValue>> }[],
  propertyId: string,
  value: PropertyValue,
): Promise<void> {
  if (propertyId === "status") {
    if (typeof value !== "string" || value === "") throw new Error("Choose a status.");
    const moving = records.filter((record) => record.values.status !== value);
    for (let start = 0; start < moving.length; start += TASK_BATCH_MAX) {
      await callFunction(setTaskStatusContract, {
        tasks: moving
          .slice(start, start + TASK_BATCH_MAX)
          .map((record) => ({ taskId: record.id, fromStatusKey: String(record.values.status ?? "") })),
        toStatusKey: value,
      });
    }
    return;
  }
  const patch = taskPatchOf(propertyId, value);
  if (patch === null) throw new Error("This property of a task is not changed here.");
  for (let start = 0; start < records.length; start += TASK_BATCH_MAX) {
    await callFunction(updateTasksContract, {
      changes: records.slice(start, start + TASK_BATCH_MAX).map((record) => ({ taskId: record.id, patch })),
    });
  }
}
