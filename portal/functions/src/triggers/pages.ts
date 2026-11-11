// The triggers of the workspace (D-010).
//
// | Trigger                     | Fires on                       | Does                                                        |
// |-----------------------------|--------------------------------|-------------------------------------------------------------|
// | `pagesOnUpdateCreated`      | An editor's update of a page   | Notifies newly mentioned members, refreshes the search index and records a spell of editing |
// | `pagesOnPageWritten`        | A page created or changed      | Refreshes the search index and the audience that threads, comments and databases copy |
// | `threadsOnCommentWritten`   | A comment created or edited    | Notifies newly mentioned members and, for a new comment, those who took part in the thread |
//
// Delivery is at least once. A notification takes its identifier from the event, a mention is
// notified once because the page records the uids it has notified in the transaction that writes
// the notifications, and the index and the copies of the audience are brought in line with the
// page as it is when the trigger runs, so a repeated or late delivery changes nothing.
import {
  accessDocSchema,
  atLeast,
  COLLECTIONS,
  commentMentionUids,
  type EntityType,
  type FirestoreBytes,
  pageDocSchema,
  pageLevelFor,
  parseStoredDocument,
  threadCommentDocSchema,
  threadDocSchema,
} from "@eegml/shared";
import { type Firestore, type QuerySnapshot, Timestamp, type Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/firestore";
import { firestore } from "../framework/admin";
import { writeAudit } from "../framework/audit";
import { reactionStamp, touchedFields, type WriteStamp } from "../framework/documents";
import { documentTrigger } from "../framework/trigger";
import { notifyAll } from "../notifications/notify";
import { bytesOf, decodesAsUpdate, extractPageText, loadPageDocument, mentionedUids } from "../pages/content";
import { indexPage, removePageIndex } from "../pages/search-index";

/** How long one spell of editing lasts: an edit within this time of the last one adds no activity. */
export const EDITING_SPELL_MS = 15 * 60 * 1000;

interface Cause {
  readonly eventId: string;
  readonly at: Date;
}

/** Of a list of accounts, those that may read a page now, as the rules decide it with the second factor presented. */
async function readersAmong(
  db: Firestore,
  transaction: Transaction,
  uids: readonly string[],
  page: Parameters<typeof pageLevelFor>[2],
): Promise<string[]> {
  const readers: string[] = [];
  for (const uid of uids) {
    const stored = await transaction.get(db.doc(COLLECTIONS.access.docPath(uid)));
    const access = parseStoredDocument(accessDocSchema, stored.data());
    if (
      stored.exists &&
      access.success &&
      atLeast(pageLevelFor(access.data, { secondFactorVerified: true }, page), "view")
    ) {
      readers.push(uid);
    }
  }
  return readers;
}

/** The name of the member behind an account, as the directory shows it, or null. */
async function nameOf(db: Firestore, transaction: Transaction, uid: string): Promise<string | null> {
  const personId = (await transaction.get(db.doc(COLLECTIONS.users.docPath(uid)))).get("personId");
  if (typeof personId !== "string") return null;
  const name = (await transaction.get(db.doc(COLLECTIONS.persons.docPath(personId)))).get("displayName");
  return typeof name === "string" ? name : null;
}

/**
 * What an editor's update means beyond the content: the members it newly mentions are notified,
 * once each, and the page records whom its text mentions; the search index takes the text of the
 * page; and a spell of editing by the author is recorded in the activity of the page, without
 * the content, unless one was recorded within the last quarter of an hour.
 */
export async function recordPageEdit(
  db: Firestore,
  edit: Cause & { readonly pageId: string; readonly authorUid: string },
): Promise<void> {
  const stamp = reactionStamp("pageEdit", edit.at, edit.eventId);
  const outcome = await db.runTransaction(async (transaction) => {
    const reference = db.doc(COLLECTIONS.pages.docPath(edit.pageId));
    const snapshot = await transaction.get(reference);
    const parsed = parseStoredDocument(pageDocSchema, snapshot.data());
    if (!snapshot.exists || !parsed.success) return null;
    const page = parsed.data;
    const text = extractPageText(await loadPageDocument(db, edit.pageId, page, transaction));
    const mentioned = mentionedUids(text);
    const added = mentioned.filter((uid) => !page.mentionUids.includes(uid) && uid !== edit.authorUid);
    const recipients = await readersAmong(db, transaction, added, page);
    const authorName = recipients.length === 0 ? null : await nameOf(db, transaction, edit.authorUid);
    notifyAll(
      db,
      transaction,
      recipients,
      {
        type: "mention",
        entityType: "page",
        entityId: edit.pageId,
        eventId: edit.eventId,
        payload: { kind: "pageMention", pageId: edit.pageId, title: page.title, authorUid: edit.authorUid, authorName },
      },
      stamp,
    );
    if (mentioned.join("\n") !== [...page.mentionUids].sort().join("\n")) {
      transaction.update(reference, { mentionUids: mentioned, ...touchedFields(stamp) });
    }
    return { page, text };
  });
  if (outcome === null) return;
  await indexPage(db, edit.pageId, outcome.text, stamp);
  await recordEditingSpell(db, edit);
}

/**
 * Adds an entry to the activity of a page for a spell of editing, unless the author's last one is
 * recent. The entry takes the audience of the page as it stands in the transaction that writes it.
 */
async function recordEditingSpell(
  db: Firestore,
  edit: Cause & { readonly pageId: string; readonly authorUid: string },
): Promise<void> {
  const recent = await db
    .collection(COLLECTIONS.activity.collectionPath())
    .where("entityId", "==", edit.pageId)
    .where("actorUid", "==", edit.authorUid)
    .where("createdAt", ">=", Timestamp.fromMillis(edit.at.getTime() - EDITING_SPELL_MS))
    .limit(1)
    .get();
  if (!recent.empty && recent.docs[0]?.id !== edit.eventId) return;
  const stamp = reactionStamp("pageEdit", edit.at, edit.eventId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(db.doc(COLLECTIONS.pages.docPath(edit.pageId)));
    const parsed = parseStoredDocument(pageDocSchema, snapshot.data());
    if (!snapshot.exists || !parsed.success) return;
    const page = parsed.data;
    transaction.set(
      db.doc(COLLECTIONS.activity.docPath(edit.eventId)),
      COLLECTIONS.activity.schema.parse({
        schemaVersion: COLLECTIONS.activity.schemaVersion,
        createdAt: Timestamp.fromDate(edit.at),
        createdBy: stamp.actor,
        writeContext: stamp.writeContext,
        actorUid: edit.authorUid,
        action: "page.edited",
        entityType: "page" satisfies EntityType,
        entityId: edit.pageId,
        changedFields: ["content"],
        replicationId: page.replicationId,
        laboratoryId: page.laboratoryId,
        scopeKeys: page.scopeKeys,
      }),
    );
  });
}

/**
 * Removes an update of one part that does not decode as a Yjs update, with an audit entry that
 * names its author. The rules cannot check the bytes, and every reader skips such an update, so
 * removing it only keeps the log clean. Returns whether it was removed.
 */
export async function discardUndecodableUpdate(
  db: Firestore,
  update: Cause & { readonly pageId: string; readonly updateDocId: string },
): Promise<boolean> {
  const reference = db.doc(COLLECTIONS.pageUpdates.docPath(update.pageId, update.updateDocId));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const bytes = snapshot.get("update") as FirestoreBytes | undefined;
    if (!snapshot.exists || snapshot.get("count") !== 1 || bytes === undefined) return false;
    if (decodesAsUpdate(bytesOf(bytes))) return false;
    writeAudit(
      transaction,
      {
        action: "page.updateDiscarded",
        actor: { kind: "system" },
        entityType: "page",
        entityId: update.pageId,
        changes: [
          { field: "updateId", before: update.updateDocId },
          { field: "uid", before: snapshot.get("uid") as unknown },
        ],
        context: { depth: 1, correlationId: update.eventId, causationId: update.eventId },
        idempotencyKey: `page.updateDiscarded:${update.eventId}`,
        at: update.at,
      },
      db,
    );
    transaction.delete(reference);
    return true;
  });
}

export const pagesOnUpdateCreated = onDocumentCreated(documentTrigger(COLLECTIONS.pageUpdates.path), async (event) => {
  const authorUid = event.data?.get("uid");
  if (typeof authorUid !== "string") return;
  const cause = { eventId: event.id, at: new Date(event.time) };
  if (
    await discardUndecodableUpdate(firestore(), { ...cause, pageId: event.params.pageId, updateDocId: event.params.id })
  ) {
    logger.warn("An update of a page that does not decode was removed.", { pageId: event.params.pageId });
    return;
  }
  await recordPageEdit(firestore(), { ...cause, pageId: event.params.pageId, authorUid });
});

/** The fields of a page whose change reaches its index entries or the copies of its audience. */
const INDEXED_FIELDS = ["title", "kind", "archivedAt", "replicationId", "laboratoryId", "scopeKeys"] as const;
const AUDIENCE_FIELDS = ["replicationId", "laboratoryId", "scopeKeys"] as const;

const differs = (
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  fields: readonly string[],
) => before === undefined || fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));

/**
 * Brings what follows a page in line with it: its entries in the search index, which an archived
 * page does not have, and the audience that its threads and their comments copy.
 */
export async function followPage(db: Firestore, pageId: string, cause: Cause): Promise<void> {
  const snapshot = await db.doc(COLLECTIONS.pages.docPath(pageId)).get();
  const parsed = parseStoredDocument(pageDocSchema, snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    await removePageIndex(db, pageId);
    return;
  }
  const page = parsed.data;
  const stamp: WriteStamp = reactionStamp("pageFollow", cause.at, cause.eventId);
  if (page.archivedAt !== null) await removePageIndex(db, pageId);
  else await indexPage(db, pageId, extractPageText(await loadPageDocument(db, pageId, page)), stamp);

  const audience = { replicationId: page.replicationId, laboratoryId: page.laboratoryId, scopeKeys: page.scopeKeys };
  const threads = await db.collection(COLLECTIONS.threads.collectionPath()).where("targetId", "==", pageId).get();
  for (const thread of threads.docs) {
    if (thread.get("targetType") !== "page") continue;
    const batch = db.batch();
    let writes = 0;
    if (differs(thread.data(), audience, AUDIENCE_FIELDS)) {
      batch.update(thread.ref, { ...audience, ...touchedFields(stamp) });
      writes += 1;
    }
    const comments = await thread.ref.collection(COLLECTIONS.threadComments.collectionId).get();
    for (const comment of comments.docs) {
      if (!differs(comment.data(), audience, AUDIENCE_FIELDS)) continue;
      batch.update(comment.ref, { ...audience, ...touchedFields(stamp) });
      writes += 1;
    }
    if (writes > 0) await batch.commit();
  }
  await followActivity(db, pageId, audience);
}

/** How many entries of activity one batch of followActivity rewrites. */
const ACTIVITY_PAGE = 400;

/**
 * Brings the audience that the activity of a page copies in line with the page, a batch at a
 * time, so that those whom a change of sharing shuts out no longer read who edited it and when.
 */
async function followActivity(
  db: Firestore,
  pageId: string,
  audience: {
    readonly replicationId: string | null;
    readonly laboratoryId: string | null;
    readonly scopeKeys: string[];
  },
): Promise<void> {
  const base = db
    .collection(COLLECTIONS.activity.collectionPath())
    .where("entityId", "==", pageId)
    .orderBy("__name__")
    .limit(ACTIVITY_PAGE);
  let cursor: string | null = null;
  for (;;) {
    const found: QuerySnapshot = await (cursor === null ? base : base.startAfter(cursor)).get();
    const batch = db.batch();
    let writes = 0;
    for (const entry of found.docs) {
      if (entry.get("entityType") !== "page" || !differs(entry.data(), audience, AUDIENCE_FIELDS)) continue;
      // An entry of activity is append-only and has no fields of change: only its copy of the
      // audience, which is access maintenance, follows the page.
      batch.update(entry.ref, { ...audience });
      writes += 1;
    }
    if (writes > 0) await batch.commit();
    if (found.size < ACTIVITY_PAGE) return;
    cursor = found.docs[found.size - 1]?.id ?? null;
    if (cursor === null) return;
  }
}

/** The fields of a page that the databases beneath it copy. */
const DATABASE_AUDIENCE_FIELDS = ["scopeKeys", "levelKeys"] as const;

/** Brings the audience that the databases beneath a page copy in line with the page. */
export async function followDatabases(db: Firestore, pageId: string, cause: Cause): Promise<void> {
  const snapshot = await db.doc(COLLECTIONS.pages.docPath(pageId)).get();
  const parsed = parseStoredDocument(pageDocSchema, snapshot.data());
  if (!snapshot.exists || !parsed.success) return;
  const audience = { scopeKeys: parsed.data.scopeKeys, levelKeys: parsed.data.levelKeys };
  const stamp: WriteStamp = reactionStamp("pageFollow", cause.at, cause.eventId);
  const databases = await db
    .collection(COLLECTIONS.databases.collectionPath())
    .where("parentPageId", "==", pageId)
    .get();
  const batch = db.batch();
  let writes = 0;
  for (const database of databases.docs) {
    if (!differs(database.data(), audience, DATABASE_AUDIENCE_FIELDS)) continue;
    batch.update(database.ref, { ...audience, ...touchedFields(stamp) });
    writes += 1;
  }
  if (writes > 0) await batch.commit();
}

export const pagesOnPageWritten = onDocumentWritten(documentTrigger(COLLECTIONS.pages.path), async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const cause = { eventId: event.id, at: new Date(event.time) };
  if (after !== undefined && before !== undefined && differs(before, after, DATABASE_AUDIENCE_FIELDS)) {
    await followDatabases(firestore(), event.params.pageId, cause);
  }
  if (after !== undefined && !differs(before, after, INDEXED_FIELDS)) return;
  await followPage(firestore(), event.params.pageId, cause);
});

/**
 * Notifies those whom a comment concerns: the members it newly mentions, and, for a new comment,
 * everyone who wrote in the thread before it. Only those who may read the page are notified.
 */
export async function notifyComment(
  db: Firestore,
  threadId: string,
  before: unknown,
  after: unknown,
  cause: Cause,
): Promise<void> {
  const comment = parseStoredDocument(threadCommentDocSchema, after);
  if (!comment.success || comment.data.deletedAt !== null || comment.data.authorUid === undefined) return;
  const previous = parseStoredDocument(threadCommentDocSchema, before);
  const authorUid = comment.data.authorUid;
  const written = comment.data.createdAt.toMillis();
  const known = previous.success ? commentMentionUids(previous.data.body) : [];
  const mentioned = commentMentionUids(comment.data.body).filter((uid) => !known.includes(uid) && uid !== authorUid);
  const stamp = reactionStamp("commentNotify", cause.at, cause.eventId);
  await db.runTransaction(async (transaction) => {
    const thread = parseStoredDocument(
      threadDocSchema,
      (await transaction.get(db.doc(COLLECTIONS.threads.docPath(threadId)))).data(),
    );
    if (!thread.success || thread.data.targetType !== "page") return;
    const pageSnapshot = await transaction.get(db.doc(COLLECTIONS.pages.docPath(thread.data.targetId)));
    const page = parseStoredDocument(pageDocSchema, pageSnapshot.data());
    if (!pageSnapshot.exists || !page.success) return;
    let participants: string[] = [];
    if (!previous.success) {
      const comments = await transaction.get(
        db.collection(COLLECTIONS.threadComments.collectionPath(threadId)).limit(200),
      );
      participants = [
        ...new Set(
          comments.docs
            // Those who wrote before this comment: a later comment has a notification of its own.
            .filter((document) => (document.get("createdAt") as Timestamp).toMillis() < written)
            .map((document) => document.get("authorUid") as unknown)
            .filter((uid): uid is string => typeof uid === "string" && uid !== authorUid && !mentioned.includes(uid)),
        ),
      ];
    }
    const mentionReaders = await readersAmong(db, transaction, mentioned, page.data);
    const participantReaders = await readersAmong(db, transaction, participants, page.data);
    if (mentionReaders.length + participantReaders.length === 0) return;
    const authorName = await nameOf(db, transaction, authorUid);
    const payload = {
      pageId: thread.data.targetId,
      threadId,
      title: page.data.title,
      authorUid,
      authorName,
    };
    notifyAll(
      db,
      transaction,
      mentionReaders,
      {
        type: "mention",
        entityType: "page",
        entityId: thread.data.targetId,
        eventId: cause.eventId,
        payload: { kind: "commentMention", ...payload },
      },
      stamp,
    );
    notifyAll(
      db,
      transaction,
      participantReaders,
      {
        type: "comment",
        entityType: "page",
        entityId: thread.data.targetId,
        eventId: cause.eventId,
        payload: { kind: "commentReply", ...payload },
      },
      stamp,
    );
  });
}

export const threadsOnCommentWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.threadComments.path),
  async (event) => {
    const after = event.data?.after.data();
    if (after === undefined) return;
    await notifyComment(firestore(), event.params.threadId, event.data?.before.data(), after, {
      eventId: event.id,
      at: new Date(event.time),
    });
  },
);
