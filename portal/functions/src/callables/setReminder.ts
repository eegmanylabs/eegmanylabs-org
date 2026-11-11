import {
  COLLECTIONS,
  REMINDER_HORIZON_DAYS,
  REMINDER_PAST_MINUTES,
  REMINDERS_PER_USER_MAX,
  readsTask,
  reminderDocSchema,
  setReminderContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, createdFields, defineCallable, readAccessDocument, writeAudit } from "../framework";
import { readTask, TASK_NOT_FOUND_MESSAGE } from "../tasks/model";

/**
 * Sets a reminder of the caller about a task, delivered among their notifications at its time
 * (docs/DATA_MODEL.md, section 8). Capability: any member who reads the task, as the security
 * rules decide it, with the second factor of the session counted as it is. A task the caller may
 * not open is refused as one that does not exist. The time lies between an hour ago and two years
 * ahead, so that no reminder is dated long ago to stand before everyone else's in the sweep, and a
 * user holds at most `REMINDERS_PER_USER_MAX` reminders that are not sent yet. The reminder and
 * its audit entry are written in one transaction. Its owner moves or removes it directly.
 */
export const setReminder = defineCallable(setReminderContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const remindAt = new Date(input.remindAt);
    if (remindAt.getTime() < at.getTime() - REMINDER_PAST_MINUTES * 60_000) {
      throw new AppError("invalid-argument", "A reminder is set for a time to come. Choose a later time.");
    }
    if (remindAt.getTime() > at.getTime() + REMINDER_HORIZON_DAYS * 86_400_000) {
      throw new AppError("invalid-argument", "A reminder is set at most two years ahead. Choose an earlier time.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const task = await readTask(db, transaction, input.entityId);
      if (task === null || !readsTask(access, { secondFactorVerified: context.secondFactorVerified }, uid, task.data)) {
        throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
      }
      const unsent = await transaction.get(
        db
          .collection(COLLECTIONS.reminders.collectionPath())
          .where("uid", "==", uid)
          .where("sentAt", "==", null)
          .count(),
      );
      if (unsent.data().count >= REMINDERS_PER_USER_MAX) {
        throw new AppError(
          "resource-exhausted",
          `You have ${REMINDERS_PER_USER_MAX} reminders still to come. Remove one before you set another.`,
        );
      }
      const reference = db.collection(COLLECTIONS.reminders.collectionPath()).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "reminder.set",
          actor: { kind: "user", uid },
          entityType: input.entityType,
          entityId: input.entityId,
          changes: [
            { field: "reminderId", after: reference.id },
            { field: "remindAt", after: remindAt.toISOString() },
            { field: "channel", after: input.channel },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      transaction.create(
        reference,
        reminderDocSchema.parse({
          ...createdFields("reminders", stamp),
          uid,
          entityType: input.entityType,
          entityId: input.entityId,
          remindAt: Timestamp.fromDate(remindAt),
          sentAt: null,
          channel: input.channel,
        }),
      );
      return { reminderId: reference.id };
    });
  },
});
