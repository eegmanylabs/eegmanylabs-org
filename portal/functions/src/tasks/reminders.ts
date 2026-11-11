// The delivery of reminders (docs/DATA_MODEL.md, section 8). A scheduled function finds the
// in-app reminders that are due and not yet sent, and for each writes a notification beneath its
// owner and sets `sentAt`, in one transaction, so that a reminder is delivered once however often
// the sweep meets it. A reminder about a task that its owner no longer reads, or that no longer
// exists, is marked as sent without a notification, so that it tells nobody anything. An email
// reminder stays as it is until the mail provider of decision 7 exists.
import {
  accessDocSchema,
  COLLECTIONS,
  parseStoredDocument,
  REMINDER_PAST_MINUTES,
  type ReminderDoc,
  readsTask,
  reminderDocSchema,
  taskDocSchema,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { reactionStamp, touchedFields } from "../framework/documents";
import { writeNotification } from "../notifications/notify";

/** The most reminders one page of the sweep reads. A run reads page after page until none is due. */
export const REMINDERS_PER_RUN = 200;

/** How many reminders of a page are delivered at once. */
const PARALLEL_DELIVERIES = 25;

/** How long one run may go on reading pages, so that it ends before the next run begins. */
const RUN_BUDGET_MILLIS = 4 * 60_000;

export interface ReminderSweep {
  readonly delivered: number;
  readonly withdrawn: number;
}

type Outcome = "delivered" | "withdrawn" | "skipped";

/**
 * Delivers the in-app reminders that are due at `now`, page after page, until none is due or the
 * time of a run is spent, so that no number of reminders holds back another user's.
 *
 * A reminder is withdrawn, which marks it as sent without a notification, where its owner is no
 * longer a member, the task does not exist or its owner no longer reads it, or it is of a kind
 * that the sweep cannot decide the readers of. A reminder dated long before it was set, which no
 * client can write, is withdrawn as well. The owner's reading is decided for a session without
 * the second factor, so that a reminder never gives powers of the programme that the owner's
 * session might not hold.
 */
export async function sendDueReminders(db: Firestore, now: Date): Promise<ReminderSweep> {
  const started = Date.now();
  let delivered = 0;
  let withdrawn = 0;
  const met = new Set<string>();
  for (;;) {
    const due = await db
      .collection(COLLECTIONS.reminders.collectionPath())
      .where("channel", "==", "inApp")
      .where("sentAt", "==", null)
      .where("remindAt", "<=", Timestamp.fromDate(now))
      .limit(REMINDERS_PER_RUN)
      .get();
    const fresh = due.docs.filter((found) => !met.has(found.id));
    for (const found of fresh) met.add(found.id);
    for (let index = 0; index < fresh.length; index += PARALLEL_DELIVERIES) {
      const outcomes = await Promise.all(
        fresh.slice(index, index + PARALLEL_DELIVERIES).map((found) => deliver(db, found.ref, now)),
      );
      delivered += outcomes.filter((outcome) => outcome === "delivered").length;
      withdrawn += outcomes.filter((outcome) => outcome === "withdrawn").length;
    }
    // A page that was not full, or that held nothing new, was the last.
    if (due.size < REMINDERS_PER_RUN || fresh.length === 0 || Date.now() - started > RUN_BUDGET_MILLIS) break;
  }
  return { delivered, withdrawn };
}

/** The title that a reminder may tell its owner, or null where it may tell them nothing. */
async function titleFor(db: Firestore, transaction: Transaction, reminder: ReminderDoc): Promise<string | null> {
  const { uid, entityId } = reminder;
  // A reminder dated long before it was set was not written by a client, which the rules refuse.
  const createdAt = reminder.createdAt.toMillis();
  if (reminder.remindAt.toMillis() < createdAt - REMINDER_PAST_MINUTES * 60_000) return null;
  const access = parseStoredDocument(
    accessDocSchema,
    (await transaction.get(db.doc(COLLECTIONS.access.docPath(uid)))).data(),
  );
  if (!access.success || !access.data.member || access.data.suspended) return null;
  const record = await transaction.get(db.doc(COLLECTIONS.tasks.docPath(entityId)));
  if (!record.exists) return null;
  const task = parseStoredDocument(taskDocSchema, record.data());
  if (!task.success || !readsTask(access.data, { secondFactorVerified: false }, uid, task.data)) return null;
  return task.data.title;
}

/** Delivers one reminder, or withdraws it, once however often the sweep meets it. */
async function deliver(db: Firestore, reference: DocumentReference, now: Date): Promise<Outcome> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.get("sentAt") !== null) return "skipped";
    const stamp = reactionStamp("reminderSweep", now, reference.id);
    // A reminder of a kind the sweep cannot read, about any record but a task, tells nobody anything.
    const reminder = parseStoredDocument(reminderDocSchema, snapshot.data());
    const title = reminder.success ? await titleFor(db, transaction, reminder.data) : null;
    if (reminder.success && title !== null) {
      writeNotification(
        db,
        transaction,
        {
          uid: reminder.data.uid,
          type: "reminder",
          entityType: reminder.data.entityType,
          entityId: reminder.data.entityId,
          eventId: reference.id,
          payload: { kind: "reminderDue", title, remindAt: reminder.data.remindAt.toDate().toISOString() },
        },
        stamp,
      );
    }
    transaction.update(reference, { sentAt: Timestamp.fromDate(now), ...touchedFields(stamp) });
    return title === null ? "withdrawn" : "delivered";
  });
}
