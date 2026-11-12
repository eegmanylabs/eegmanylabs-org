// The receiver of Drive push notifications (docs/INTEGRATIONS.md, section 3.2). Anyone on the
// internet can call it, so it treats a message as a hint and nothing more: it answers 404 to an
// unknown channel or a token whose hash differs, ignores the first message of a channel and any
// message number it has seen, and only enqueues a read of the change feed, which does the work.
import { COLLECTIONS, driveChannelDocSchema, parseStoredDocument, sha256Hex, systemActor } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { enqueueRun } from "./queue";

export interface NotificationHeaders {
  readonly channelId: string | undefined;
  readonly token: string | undefined;
  readonly messageNumber: string | undefined;
  readonly resourceState: string | undefined;
}

export type ReceiverAnswer = { readonly status: 200; readonly queued: boolean } | { readonly status: 404 };

export async function receiveDriveNotification(
  db: Firestore,
  headers: NotificationHeaders,
  at: Date,
): Promise<ReceiverAnswer> {
  const { channelId, token, resourceState } = headers;
  const messageNumber = Number(headers.messageNumber);
  if (
    channelId === undefined ||
    token === undefined ||
    !Number.isInteger(messageNumber) ||
    channelId.includes("/") ||
    channelId === ""
  ) {
    return { status: 404 };
  }
  const reference = db.doc(COLLECTIONS.driveChannels.docPath(channelId));
  const fresh = await db.runTransaction(async (transaction) => {
    const channel = parseStoredDocument(driveChannelDocSchema, (await transaction.get(reference)).data());
    if (!channel.success || channel.data.stoppedAt !== null || channel.data.tokenHash !== sha256Hex(token)) return null;
    if (messageNumber <= channel.data.lastMessageNumber) return false;
    transaction.update(reference, { lastMessageNumber: messageNumber, lastMessageAt: Timestamp.fromDate(at) });
    return true;
  });
  if (fresh === null) return { status: 404 };
  // The first message of a channel only says that it is open.
  if (!fresh || resourceState === "sync") return { status: 200, queued: false };
  const { created } = await enqueueRun(db, {
    kind: "driveChanges",
    mode: "live",
    trigger: "event",
    eventKey: `push:${channelId}:${messageNumber}`,
    requestedBy: systemActor("driveNotifications"),
    at,
  });
  return { status: 200, queued: created };
}
