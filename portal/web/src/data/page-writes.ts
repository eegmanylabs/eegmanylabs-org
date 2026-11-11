// The writes of the workspace that a browser makes directly, under the security rules (D-010):
// the title, icon, place and template mark of a page, its archive and restoration, threads and
// comments, and the reading of a version. Creating, moving and sharing a page, and saving a
// version, go through callable functions, because each resolves the audience of the page.
import { COLLECTIONS, type FirestoreBytes, userWriteContext } from "@eegml/shared";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { LIVE_QUERY_MAX_LIMIT } from "./query-spec";

const touched = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid, writeContext: userWriteContext() });

/** What an editor changes of a page directly. An icon of null removes the icon. */
export interface PageFieldsChange {
  readonly title?: string;
  readonly icon?: string | null;
  readonly order?: string;
  readonly isTemplate?: boolean;
}

/** Changes the title, the icon, the place among its siblings or the template mark of a page. The rules let its editors. */
export async function updatePageFields(uid: string, pageId: string, change: PageFieldsChange): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (change.title !== undefined) fields.title = change.title;
  if (change.icon !== undefined) fields.icon = change.icon === null ? deleteField() : change.icon;
  if (change.order !== undefined) fields.order = change.order;
  if (change.isTemplate !== undefined) fields.isTemplate = change.isTemplate;
  await updateDoc(doc(db, COLLECTIONS.pages.docPath(pageId)), { ...fields, ...touched(uid) });
}

/**
 * Archives a page, or restores it. An archived page is frozen: the rules accept only its
 * restoration, by whoever archived it or by the programme.
 */
export async function setPageArchived(uid: string, pageId: string, archived: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.pages.docPath(pageId)), {
    archivedAt: archived ? serverTimestamp() : null,
    ...touched(uid),
  });
}

/** The audience a thread and its comments copy from their page. */
export interface ThreadScope {
  readonly replicationId: string | null;
  readonly laboratoryId: string | null;
  readonly scopeKeys: readonly string[];
}

/** Where a thread is anchored: a selection of text, as Yjs relative positions with the block and the quote. */
export interface ThreadAnchor {
  readonly blockId: string;
  readonly from: string;
  readonly to: string;
  readonly quote: string;
}

const created = (uid: string) => ({
  schemaVersion: 1,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: uid,
  updatedBy: uid,
  archivedAt: null,
  writeContext: userWriteContext(),
});

function commentFields(
  uid: string,
  threadId: string,
  scope: ThreadScope,
  body: string,
  mentionUids: readonly string[],
) {
  return {
    ...created(uid),
    threadId,
    authorUid: uid,
    body,
    mentionUids: [...mentionUids],
    editedAt: null,
    deletedAt: null,
    replicationId: scope.replicationId,
    laboratoryId: scope.laboratoryId,
    scopeKeys: [...scope.scopeKeys],
  };
}

/**
 * Opens a thread on a page with its first comment, in one commit. The rules let those who may
 * comment on the page. Returns the identifier of the thread.
 */
export async function createThread(
  uid: string,
  page: { readonly id: string } & ThreadScope,
  anchor: ThreadAnchor | null,
  body: string,
  mentionUids: readonly string[],
): Promise<string> {
  const threads = collection(db, COLLECTIONS.threads.collectionPath());
  const thread = doc(threads);
  const comment = doc(collection(db, COLLECTIONS.threadComments.collectionPath(thread.id)));
  const scope = { replicationId: page.replicationId, laboratoryId: page.laboratoryId, scopeKeys: page.scopeKeys };
  const batch = writeBatch(db);
  batch.set(thread, {
    ...created(uid),
    targetType: "page",
    targetId: page.id,
    ...(anchor === null ? {} : { anchor: { ...anchor } }),
    restricted: false,
    ...scope,
    scopeKeys: [...scope.scopeKeys],
    resolvedAt: null,
    resolvedBy: null,
  });
  batch.set(comment, commentFields(uid, thread.id, scope, body, mentionUids));
  await batch.commit();
  return thread.id;
}

/** Adds a comment to a thread, in the caller's name. */
export async function addComment(
  uid: string,
  thread: { readonly id: string } & ThreadScope,
  body: string,
  mentionUids: readonly string[],
): Promise<void> {
  const reference = doc(collection(db, COLLECTIONS.threadComments.collectionPath(thread.id)));
  const batch = writeBatch(db);
  batch.set(reference, commentFields(uid, thread.id, thread, body, mentionUids));
  await batch.commit();
}

/** Changes the text of the caller's own comment. */
export async function editComment(
  uid: string,
  threadId: string,
  commentId: string,
  body: string,
  mentionUids: readonly string[],
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.threadComments.docPath(threadId, commentId)), {
    body,
    mentionUids: [...mentionUids],
    editedAt: serverTimestamp(),
    ...touched(uid),
  });
}

/** The text that stands in a removed comment, so that what was written is no longer stored. */
export const REMOVED_COMMENT_TEXT = "This comment was removed by its author.";

/** Removes the caller's own comment: its text is replaced and the comment is marked as removed. */
export async function removeComment(uid: string, threadId: string, commentId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.threadComments.docPath(threadId, commentId)), {
    body: REMOVED_COMMENT_TEXT,
    mentionUids: [],
    editedAt: serverTimestamp(),
    deletedAt: serverTimestamp(),
    ...touched(uid),
  });
}

/** Resolves a thread in the caller's name, or reopens it. */
export async function setThreadResolved(uid: string, threadId: string, resolved: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.threads.docPath(threadId)), {
    resolvedAt: resolved ? serverTimestamp() : null,
    resolvedBy: resolved ? uid : null,
    ...touched(uid),
  });
}

/** The Yjs state of a saved version of a page, read from its chunks. */
export async function readPageVersion(pageId: string, versionId: string): Promise<Uint8Array> {
  const chunks = await getDocs(
    query(
      collection(db, COLLECTIONS.pageVersionChunks.collectionPath(pageId, versionId)),
      orderBy("index"),
      limit(LIVE_QUERY_MAX_LIMIT),
    ),
  );
  const parts = chunks.docs.map((chunk) => {
    const snapshot = chunk.get("snapshot") as FirestoreBytes;
    return snapshot instanceof Uint8Array ? snapshot : snapshot.toUint8Array();
  });
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
