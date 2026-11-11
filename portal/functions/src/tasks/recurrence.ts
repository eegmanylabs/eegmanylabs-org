// The next occurrence of a recurring task (docs/DATA_MODEL.md, section 8). When a task with a
// recurrence rule is completed, a trigger creates the occurrence that follows it, once: its
// identifier is derived from the series and the number of the occurrence, and a delivery that
// arrives twice, or a task completed, reopened and completed again, finds it there already.
import {
  COLLECTIONS,
  dateOnlyInstant,
  type FirestoreTimestamp,
  nextOccurrence,
  orderBetween,
  parseRecurrenceRule,
  type RecurrenceRule,
  shiftIsoDate,
  type TaskDoc,
  taskDocSchema,
  type WriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "../framework/audit";
import { createdFields, reactionStamp } from "../framework/documents";
import { initialStatusKey, isFinished, readTask, recordHistory, statusHistoryEntry, taskStatuses } from "./model";

/** The separator between a series and the number of an occurrence in an identifier. */
const OCCURRENCE = "__occurrence__";

/** The series a task belongs to and its number in it: the first task of a series is number 1. */
export function occurrenceOf(
  taskId: string,
  data: Pick<TaskDoc, "recurrenceSourceTaskId">,
): {
  readonly seriesId: string;
  readonly number: number;
} {
  const match = /^(.+)__occurrence__(\d{6})$/.exec(taskId);
  if (match !== null) return { seriesId: match[1] as string, number: Number(match[2]) };
  return { seriesId: data.recurrenceSourceTaskId ?? taskId, number: 1 };
}

/** The identifier of an occurrence of a series. */
export function occurrenceId(seriesId: string, number: number): string {
  return `${seriesId}${OCCURRENCE}${String(number).padStart(6, "0")}`;
}

const isoDateOf = (value: FirestoreTimestamp) => value.toDate().toISOString().slice(0, 10);

/** The days of one interval of a rule, a month counted as its longest. */
function intervalDays(rule: RecurrenceRule): number {
  const unit = rule.frequency === "daily" ? 1 : rule.frequency === "weekly" ? 7 : 31;
  return unit * rule.interval;
}

/** An instant moved to another calendar day at the same time of day in UTC. */
function onDay(value: FirestoreTimestamp, isoDate: string): Timestamp {
  const time = value.toDate().toISOString().slice(10);
  return Timestamp.fromDate(new Date(`${isoDate}${time}`));
}

/**
 * Creates the occurrence that follows a completed task of a series, unless the rule has ended,
 * the occurrence exists, or its date lies more than two intervals after today. It keeps the list, the place in the tree, the participants, the links,
 * the tags and the estimate, reopens the checklist, starts in the first status of tasks, and
 * moves the due date to the next date of the rule and the start date by as many days. Returns
 * the identifier of the new occurrence, or null.
 */
export async function createNextOccurrence(
  db: Firestore,
  taskId: string,
  cause: { readonly eventId: string; readonly at: Date; readonly context: Partial<WriteContext> },
): Promise<string | null> {
  return db.runTransaction(async (transaction) => {
    const task = await readTask(db, transaction, taskId);
    if (task === null || task.data.archivedAt !== null || task.data.completedAt === null) return null;
    const rule = task.data.recurrenceRule === undefined ? null : parseRecurrenceRule(task.data.recurrenceRule);
    if (rule === null) return null;
    const statuses = await taskStatuses(db, transaction);
    const status = statuses.get(task.data.statusKey);
    if (!isFinished(status) || status?.category !== "done") return null;

    const { seriesId, number } = occurrenceOf(task.id, task.data);
    const nextId = occurrenceId(seriesId, number + 1);
    const nextReference = db.doc(COLLECTIONS.tasks.docPath(nextId));
    if ((await transaction.get(nextReference)).exists) return null;
    const anchor = task.data.dueAt ?? task.data.startAt ?? task.data.completedAt;
    const current = isoDateOf(anchor);
    const next = nextOccurrence(rule, current, number);
    if (next === null) return null;
    // An occurrence is completed ahead of time at most two intervals ahead of today, so that
    // completing occurrence after occurrence at once never runs the series, and the
    // notifications it sends, far into the future. Completed again once its date comes nearer,
    // the task brings its next occurrence then.
    if (next > shiftIsoDate(isoDateOf(Timestamp.fromDate(cause.at)), 2 * intervalDays(rule))) return null;
    const siblings = await transaction.get(
      db
        .collection(COLLECTIONS.tasks.collectionPath())
        .where("listId", "==", task.data.listId)
        .where("parentId", "==", task.data.parentId)
        .limit(1_000),
    );
    const after = siblings.docs
      .map((sibling) => String(sibling.get("order")))
      .filter((order) => order > task.data.order)
      .sort()[0];

    const auditEventId = writeAudit(
      transaction,
      {
        action: "task.created",
        actor: { kind: "automation" },
        entityType: "task",
        entityId: nextId,
        changes: [
          { field: "recurrenceSourceTaskId", after: seriesId },
          { field: "occurrence", after: number + 1 },
          { field: "dueAt", after: next },
        ],
        at: cause.at,
        context: {
          depth: (cause.context.depth ?? 0) + 1,
          correlationId: cause.context.correlationId ?? cause.eventId,
          causationId: cause.eventId,
        },
        idempotencyKey: `task.recurred:${nextId}`,
      },
      db,
    );
    const reaction = reactionStamp("taskRecurrence", cause.at, cause.eventId, cause.context);
    const stamp = {
      ...reaction,
      writeContext: { ...reaction.writeContext, origin: "automation" as const, auditEventId },
    };
    const statusKey = initialStatusKey(statuses);
    const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
    const shift = Date.parse(`${next}T00:00:00Z`) - Date.parse(`${current}T00:00:00Z`);
    const {
      startAt,
      dueAt,
      progressPercent: _progress,
      completedAt: _completed,
      statusKey: _status,
      statusHistoryId: _history,
      ...kept
    } = task.data;
    const data = taskDocSchema.parse({
      ...kept,
      ...createdFields("tasks", stamp),
      order: orderBetween(task.data.order, after ?? null),
      statusKey,
      statusHistoryId: historyReference.id,
      completedAt: null,
      ...(dueAt === undefined
        ? task.data.startAt === undefined
          ? { dueAt: Timestamp.fromDate(new Date(dateOnlyInstant(next))) }
          : {}
        : { dueAt: onDay(dueAt, next) }),
      ...(startAt === undefined ? {} : { startAt: Timestamp.fromMillis(startAt.toMillis() + shift) }),
      checklist: Object.fromEntries(
        Object.entries(task.data.checklist).map(([key, item]) => [key, { ...item, done: false }]),
      ),
      recurrenceSourceTaskId: seriesId,
      mentionUids: [],
    });
    transaction.create(nextReference, data);
    const created = { id: nextId, data };
    transaction.set(
      historyReference,
      statusHistoryEntry(created, null, statusKey, stamp.actor, stamp, undefined, "automation"),
    );
    recordHistory(db, transaction, auditEventId, null, "task.created", created, ["recurrenceSourceTaskId"], stamp);
    return nextId;
  });
}
