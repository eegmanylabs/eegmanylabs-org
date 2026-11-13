// Email of notifications and digests through the outbox (requirements R15.7, R16.6 and R16.7,
// docs/INTEGRATIONS.md, section 8). A notification is written in the portal first. The member's
// preferences then decide whether a message is due: none, a message of its own (held to the end
// of their quiet hours), or a line in their daily or weekly digest. A message is a `mail`
// document under an identifier derived from the recipient and the notification or the digest
// period, so a trigger delivered twice queues one message. The sender works through the outbox,
// retries a message that failed for a while with backoff, and marks one the provider rejected
// for good as failed, which alerts whoever manages the integrations.
//
// Logs carry identifiers and counts, never an address or the text of a message.
import {
  backoffDelayMs,
  buildDigest,
  buildNotificationMail,
  COLLECTIONS,
  type DigestItem,
  dueDigestPeriod,
  emailDecision,
  JOB_BACKOFF,
  mailDocSchema,
  mailId,
  parseStoredDocument,
  systemActor,
  systemWriteContext,
  type UserNotificationDoc,
  userDocSchema,
  userNotificationDocSchema,
  userPreferencesDocSchema,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { createdFields } from "../framework/documents";
import { MailError, type MailSender } from "../integrations/mail/types";
import { alertIntegrationFailure } from "./alerts";

const MAIL_ACTOR = systemActor("mail");

/** The most attempts a message gets before it is marked as failed. */
export const MAIL_MAX_ATTEMPTS = 5;

/** The address of the record a notification is about, in the portal. */
function linkOf(
  portalUrl: string,
  notification: Pick<UserNotificationDoc, "entityType" | "entityId" | "payload">,
): string {
  const base = portalUrl.endsWith("/") ? portalUrl : `${portalUrl}/`;
  const to = notification.payload.to;
  if (typeof to === "string" && to.startsWith("/")) return `${base}#${to}`;
  switch (notification.entityType) {
    case "replication":
      return `${base}#/replications/${encodeURIComponent(notification.entityId)}`;
    case "laboratory":
      return `${base}#/labs/${encodeURIComponent(notification.entityId)}`;
    case "task":
      return `${base}#/tasks?task=${encodeURIComponent(notification.entityId)}`;
    case "dataset":
      return `${base}#/datasets/${encodeURIComponent(notification.entityId)}`;
    case "page":
      return `${base}#/pages/${encodeURIComponent(notification.entityId)}`;
    default:
      return base;
  }
}

/** A notification as a line of a message: its type and the title it names, never anything else of its payload. */
function itemOf(portalUrl: string, notification: UserNotificationDoc): DigestItem {
  const title = notification.payload.title;
  return {
    type: notification.type,
    title: typeof title === "string" && title !== "" ? title.slice(0, 200) : null,
    link: linkOf(portalUrl, notification),
  };
}

async function addressOf(db: Firestore, uid: string): Promise<string | null> {
  const user = parseStoredDocument(userDocSchema, (await db.doc(COLLECTIONS.users.docPath(uid)).get()).data());
  return user.success && user.data.status === "active" ? user.data.emailLower : null;
}

async function preferencesOf(db: Firestore, uid: string) {
  const parsed = parseStoredDocument(
    userPreferencesDocSchema,
    (await db.doc(COLLECTIONS.userPreferences.docPath(uid)).get()).data(),
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Queues the email of a new notification where the member's preferences ask for one. Answers
 * the outbox message, or null where none is due now.
 */
export async function queueNotificationMail(
  db: Firestore,
  input: { readonly uid: string; readonly notificationId: string; readonly portalUrl: string; readonly secret: string },
  at: Date,
): Promise<string | null> {
  const notification = parseStoredDocument(
    userNotificationDocSchema,
    (await db.doc(COLLECTIONS.userNotifications.docPath(input.uid, input.notificationId)).get()).data(),
  );
  if (!notification.success || notification.data.emailedAt !== null) return null;
  const decision = emailDecision(await preferencesOf(db, input.uid), notification.data.type, at);
  if (decision.outcome !== "immediate") return null;
  const address = await addressOf(db, input.uid);
  if (address === null) return null;
  const id = mailId(
    address,
    `notification:${notification.data.type}`,
    `${input.uid}:${input.notificationId}`,
    input.secret,
  );
  const content = buildNotificationMail(itemOf(input.portalUrl, notification.data), input.portalUrl);
  try {
    await db.doc(COLLECTIONS.mail.docPath(id)).create(
      mailDocSchema.parse({
        ...createdFields("mail", { at, actor: MAIL_ACTOR, writeContext: systemWriteContext() }),
        toAddress: address,
        subject: content.subject,
        textBody: content.textBody,
        htmlBody: content.htmlBody,
        templateKey: "notification",
        eventId: input.notificationId,
        uid: input.uid,
        notBefore: Timestamp.fromDate(decision.notBefore),
        status: "queued",
        attempts: 0,
        sentAt: null,
      }),
    );
  } catch (error) {
    if ((error as { code?: unknown }).code === 6) return id;
    throw error;
  }
  return id;
}

/**
 * Sends one message of the outbox where it is queued and due. A transaction moves it to
 * `sending` first, so of two deliveries one sends. Answers the status it ends in.
 */
export async function sendQueuedMail(
  db: Firestore,
  sender: MailSender,
  id: string,
  at: Date,
  random: () => number = Math.random,
): Promise<"sent" | "queued" | "failed" | "notDue"> {
  const reference = db.doc(COLLECTIONS.mail.docPath(id));
  const claimed = await db.runTransaction(async (transaction) => {
    const parsed = parseStoredDocument(mailDocSchema, (await transaction.get(reference)).data());
    if (!parsed.success || parsed.data.status !== "queued") return null;
    if (parsed.data.notBefore !== undefined && parsed.data.notBefore.toMillis() > at.getTime()) return null;
    transaction.update(reference, {
      status: "sending",
      attempts: parsed.data.attempts + 1,
      updatedAt: Timestamp.fromDate(at),
    });
    return { ...parsed.data, attempts: parsed.data.attempts + 1 };
  });
  if (claimed === null) return "notDue";
  try {
    await sender.send({
      to: claimed.toAddress,
      subject: claimed.subject,
      textBody: claimed.textBody,
      htmlBody: claimed.htmlBody ?? null,
    });
  } catch (error) {
    const permanent = error instanceof MailError && error.kind === "rejected";
    const spent = claimed.attempts >= MAIL_MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message : "The message could not be sent.";
    if (permanent || spent) {
      await reference.update({ status: "failed", error: message, updatedAt: Timestamp.fromDate(at) });
      await alertIntegrationFailure(db, "mail", at);
      return "failed";
    }
    const wait = backoffDelayMs(JOB_BACKOFF, claimed.attempts, random());
    await reference.update({
      status: "queued",
      error: message,
      notBefore: Timestamp.fromMillis(at.getTime() + wait),
      updatedAt: Timestamp.fromDate(at),
    });
    return "queued";
  }
  const now = Timestamp.fromDate(at);
  await reference.update({ status: "sent", sentAt: now, updatedAt: now });
  if (claimed.uid !== undefined && claimed.eventId !== undefined && claimed.templateKey === "notification") {
    await db
      .doc(COLLECTIONS.userNotifications.docPath(claimed.uid, claimed.eventId))
      .update({ emailedAt: now })
      .catch(() => undefined);
  }
  return "sent";
}

/** Sends every queued message that is due. Answers how many were sent. */
export async function sendDueMail(db: Firestore, sender: MailSender, at: Date): Promise<number> {
  const queued = await db
    .collection(COLLECTIONS.mail.collectionPath())
    .where("status", "==", "queued")
    .limit(200)
    .get();
  let sent = 0;
  for (const document of queued.docs) {
    if ((await sendQueuedMail(db, sender, document.id, at)) === "sent") sent += 1;
  }
  return sent;
}

/** The days a digest looks back over. */
const DIGEST_WINDOW_DAYS = { daily: 1, weekly: 7 } as const;

/**
 * Queues the digest of every member whose digest is due: the notifications of the period that
 * they have neither read nor received by email, each marked as emailed once queued. A period
 * queues one digest. Answers how many were queued.
 */
export async function queueDueDigests(db: Firestore, at: Date, portalUrl: string, secret: string): Promise<number> {
  // Read whole and filtered here, so the query needs no collection-group index.
  const found = await db.collectionGroup(COLLECTIONS.userPreferences.collectionId).limit(5_000).get();
  let queued = 0;
  for (const document of found.docs) {
    if (document.id !== "preferences") continue;
    const uid = document.ref.parent.parent?.id;
    const preferences = parseStoredDocument(userPreferencesDocSchema, document.data());
    if (uid === undefined || !preferences.success || preferences.data.digestFrequency === "off") continue;
    const period = dueDigestPeriod(at, preferences.data);
    if (period === null) continue;
    const address = await addressOf(db, uid);
    if (address === null) continue;
    const frequency = preferences.data.digestFrequency;
    const id = mailId(address, `digest:${frequency}`, period, secret);
    const reference = db.doc(COLLECTIONS.mail.docPath(id));
    if ((await reference.get()).exists) continue;
    const since = Timestamp.fromMillis(at.getTime() - DIGEST_WINDOW_DAYS[frequency] * 86_400_000);
    const notifications = await db
      .collection(COLLECTIONS.userNotifications.collectionPath(uid))
      .where("createdAt", ">=", since)
      .limit(500)
      .get();
    const due = notifications.docs.flatMap((entry) => {
      const parsed = parseStoredDocument(userNotificationDocSchema, entry.data());
      return parsed.success &&
        parsed.data.readAt === null &&
        parsed.data.emailedAt === null &&
        preferences.data.typeSwitches[parsed.data.type] !== false
        ? [{ reference: entry.ref, data: parsed.data }]
        : [];
    });
    if (due.length === 0) continue;
    const content = buildDigest({
      period,
      frequency,
      items: due.map((entry) => itemOf(portalUrl, entry.data)),
      portalUrl,
    });
    const created = await db.runTransaction(async (transaction) => {
      if ((await transaction.get(reference)).exists) return false;
      transaction.create(
        reference,
        mailDocSchema.parse({
          ...createdFields("mail", { at, actor: MAIL_ACTOR, writeContext: systemWriteContext() }),
          toAddress: address,
          subject: content.subject,
          textBody: content.textBody,
          htmlBody: content.htmlBody,
          templateKey: `digest${frequency === "daily" ? "Daily" : "Weekly"}`,
          uid,
          status: "queued",
          attempts: 0,
          sentAt: null,
        }),
      );
      for (const entry of due) transaction.update(entry.reference, { emailedAt: Timestamp.fromDate(at) });
      return true;
    });
    if (created) queued += 1;
  }
  return queued;
}
