// The triggers and the schedule of the mail outbox (docs/INTEGRATIONS.md, section 8).
//
// | Function                    | Runs on                       | Does |
// |-----------------------------|-------------------------------|------|
// | `mailOnNotificationCreated` | A notification created        | Queues its email where the member's preferences ask for one |
// | `mailOnQueued`              | An outbox message created     | Sends it where it is due and a sender exists |
// | `mailSweep`                 | Every fifteen minutes         | Sends the messages whose quiet hours or backoff have passed, and queues the digests that are due |
//
// In a real project no sender exists until a provider is chosen, so the outbox fills and nothing
// is sent. Logs carry identifiers and counts, never an address or the text of a message.
import { COLLECTIONS, FUNCTIONS_REGION } from "@eegml/shared";
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/firestore";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { runningInEmulator } from "../framework/callable";
import { identityHashKey, identityHashKeySecret } from "../framework/hash-key";
import { documentTrigger } from "../framework/trigger";
import { portalAddress } from "../integrations/jobs/live";
import { mailSender } from "../integrations/mail/adapters";
import { queueDueDigests, queueNotificationMail, sendDueMail, sendQueuedMail } from "../notifications/mail";

/** The secret of the keyed hashes, which names an outbox message by its recipient. The emulator binds none. */
const secrets = () => (runningInEmulator() ? [] : [identityHashKeySecret()]);

export const mailOnNotificationCreated = onDocumentCreated(
  { ...documentTrigger(COLLECTIONS.userNotifications.path), secrets: secrets() },
  async (event) => {
    const id = await queueNotificationMail(
      firestore(),
      {
        uid: event.params.uid,
        notificationId: event.params.id,
        portalUrl: portalAddress(),
        secret: identityHashKey(),
      },
      new Date(event.time),
    );
    if (id !== null) logger.info("notification email queued", { mailId: id });
  },
);

export const mailOnQueued = onDocumentCreated(documentTrigger(COLLECTIONS.mail.path), async (event) => {
  const sender = mailSender();
  if (sender === null) return;
  const status = await sendQueuedMail(firestore(), sender, event.params.id, new Date(event.time));
  logger.info("outbox message handled", { mailId: event.params.id, status });
});

export const mailSweep = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Europe/London",
    region: FUNCTIONS_REGION,
    retryCount: 1,
    secrets: secrets(),
  },
  async (event) => {
    const db = firestore();
    const at = new Date(event.scheduleTime);
    const digests = await queueDueDigests(db, at, portalAddress(), identityHashKey());
    const sender = mailSender();
    const sent = sender === null ? 0 : await sendDueMail(db, sender, at);
    logger.info("mail sweep finished", { digests, sent });
  },
);
