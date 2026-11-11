// The triggers and the scheduled sweep of tasks (docs/DATA_MODEL.md, section 8).
//
// | Function              | Runs on                    | Does                                                         |
// |-----------------------|----------------------------|--------------------------------------------------------------|
// | `tasksOnTaskWritten`  | A task created or changed  | Creates the next occurrence of a recurring task that was completed, and brings the audience of the task's body page in line with the task |
// | `remindersSweep`      | Every five minutes         | Delivers the in-app reminders that are due                   |
//
// Delivery is at least once. The next occurrence takes an identifier derived from its series and
// number, and the body page is brought in line with the task as it is when the trigger runs, so a
// repeated or late delivery changes nothing.
import {
  COLLECTIONS,
  entityRefId,
  FUNCTIONS_REGION,
  parseStoredDocument,
  taskDocSchema,
  taskPageAudience,
  type WriteContext,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/firestore";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { reactionStamp } from "../framework/documents";
import { documentTrigger } from "../framework/trigger";
import { audienceOf, descendantsOf, readPage, rewriteTree, sameAudience } from "../pages/pages";
import { createNextOccurrence } from "../tasks/recurrence";
import { sendDueReminders } from "../tasks/reminders";

/** The fields of a task that decide who reads it and who edits its body page. */
const AUDIENCE_FIELDS = [
  "scopeKeys",
  "replicationId",
  "laboratoryId",
  "ownerUid",
  "assigneeUids",
  "collaboratorUids",
  "followerUids",
] as const;

/**
 * Gives the body page of a task, where it has one, the audience of the task as it is now, with
 * every page beneath it that inherits. A page that its holders have restricted keeps its own.
 */
export async function followTaskPage(
  db: Firestore,
  taskId: string,
  cause: { eventId: string; at: Date },
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const task = parseStoredDocument(
      taskDocSchema,
      (await transaction.get(db.doc(COLLECTIONS.tasks.docPath(taskId)))).data(),
    );
    if (!task.success) return false;
    const page = await readPage(db, transaction, entityRefId("task", taskId));
    if (page === null || page.data.accessMode !== "inherit") return false;
    const audience = taskPageAudience(task.data);
    if (sameAudience(audienceOf(page.data), audience)) return false;
    const descendants = await descendantsOf(db, transaction, page.id);
    rewriteTree(
      transaction,
      reactionStamp("taskPageFollow", cause.at, cause.eventId),
      page,
      { ancestorPageIds: page.data.ancestorPageIds, audience },
      descendants,
    );
    return true;
  });
}

export const tasksOnTaskWritten = onDocumentWritten(documentTrigger(COLLECTIONS.tasks.path), async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (after === undefined) return;
  const cause = { eventId: event.id, at: new Date(event.time) };
  const completed = after.completedAt != null && before?.completedAt == null;
  if (completed && typeof after.recurrenceRule === "string") {
    const context = (after.writeContext ?? {}) as Partial<WriteContext>;
    const created = await createNextOccurrence(firestore(), event.params.id, { ...cause, context });
    if (created !== null) logger.info("The next occurrence of a recurring task was created.", { taskId: created });
  }
  const audienceChanged =
    before !== undefined &&
    AUDIENCE_FIELDS.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  if (audienceChanged) await followTaskPage(firestore(), event.params.id, cause);
});

/** Runs every five minutes, so an in-app reminder arrives at most five minutes after its time. */
export const remindersSweep = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Europe/London", region: FUNCTIONS_REGION, retryCount: 3 },
  async (event) => {
    const summary = await sendDueReminders(firestore(), new Date(event.scheduleTime));
    logger.info("reminders sweep finished", { ...summary });
  },
);
