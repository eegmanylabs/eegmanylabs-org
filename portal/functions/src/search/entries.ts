// The entries of comments and of linked documents in the search index (requirement R15.8,
// docs/DATA_MODEL.md, section 13). Pages index themselves (pages/search-index.ts). A comment is
// found by the words of its text and opens the page or record it was made on; a linked document
// is found by its title, its kind and the host of its address, which is the metadata the portal
// holds of it, and opens the record it is linked to. Each entry carries the audience of its
// document, so the search function returns it to that audience alone. A deleted comment, an
// archived link and a link that no longer exists have no entries.
import {
  COLLECTIONS,
  documentLinkDocSchema,
  type EntityType,
  nestedEntityId,
  parseStoredDocument,
  searchIndexDocSchema,
  searchIndexId,
  searchTokenParts,
  searchTokensOf,
  threadCommentDocSchema,
  threadDocSchema,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { createdFields, type WriteStamp } from "../framework/documents";

interface Entry {
  readonly title: string;
  readonly texts: readonly string[];
  readonly kind: "comment" | "document";
  readonly target: { readonly entityType: EntityType; readonly entityId: string };
  readonly scope: {
    readonly replicationId: string | null;
    readonly laboratoryId: string | null;
    readonly scopeKeys: readonly string[];
  };
}

/** Writes the entries of a record, or removes them where `entry` is null. Answers the number of entries. */
async function writeEntries(
  db: Firestore,
  entityType: EntityType,
  entityId: string,
  entry: Entry | null,
  stamp: WriteStamp,
): Promise<number> {
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(
      db.collection(COLLECTIONS.searchIndex.collectionPath()).where("entityId", "==", entityId),
    );
    const own = existing.docs.filter((document) => document.get("entityType") === entityType);
    const parts = entry === null ? [] : searchTokenParts(searchTokensOf([entry.title, ...entry.texts]));
    parts.forEach((tokens, part) => {
      if (entry === null) return;
      transaction.set(
        db.doc(COLLECTIONS.searchIndex.docPath(searchIndexId(entityType, entityId, part))),
        searchIndexDocSchema.parse({
          ...createdFields("searchIndex", stamp),
          entityType,
          entityId,
          part,
          title: entry.title.slice(0, 1_000),
          tokens,
          kind: entry.kind,
          targetEntityType: entry.target.entityType,
          targetEntityId: entry.target.entityId,
          replicationId: entry.scope.replicationId,
          laboratoryId: entry.scope.laboratoryId,
          scopeKeys: [...entry.scope.scopeKeys],
        }),
      );
    });
    for (const document of own) if ((document.get("part") as number) >= parts.length) transaction.delete(document.ref);
    return parts.length;
  });
}

/** The words of a comment's text: its markup and its mentions left out. */
function plainText(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/@\[[^\]]*\]\([^)]*\)/g, " ");
}

export async function indexComment(
  db: Firestore,
  threadId: string,
  commentId: string,
  stamp: WriteStamp,
): Promise<number> {
  const entityId = nestedEntityId(threadId, commentId);
  const [commentSnapshot, threadSnapshot] = await db.getAll(
    db.doc(COLLECTIONS.threadComments.docPath(threadId, commentId)),
    db.doc(COLLECTIONS.threads.docPath(threadId)),
  );
  const comment = parseStoredDocument(threadCommentDocSchema, commentSnapshot?.data());
  const thread = parseStoredDocument(threadDocSchema, threadSnapshot?.data());
  const live = comment.success && thread.success && comment.data.deletedAt === null && comment.data.archivedAt === null;
  if (!live) return writeEntries(db, "comment", entityId, null, stamp);
  const text = plainText(comment.data.body);
  return writeEntries(
    db,
    "comment",
    entityId,
    {
      title: `Comment: ${text.trim().replace(/\s+/g, " ").slice(0, 80)}`,
      texts: [text, thread.data.anchor?.quote ?? ""],
      kind: "comment",
      target: { entityType: thread.data.targetType, entityId: thread.data.targetId },
      scope: {
        replicationId: comment.data.replicationId,
        laboratoryId: comment.data.laboratoryId,
        scopeKeys: comment.data.scopeKeys,
      },
    },
    stamp,
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export async function indexDocumentLink(db: Firestore, linkId: string, stamp: WriteStamp): Promise<number> {
  const link = parseStoredDocument(
    documentLinkDocSchema,
    (await db.doc(COLLECTIONS.documentLinks.docPath(linkId)).get()).data(),
  );
  if (!link.success || link.data.archivedAt !== null) return writeEntries(db, "documentLink", linkId, null, stamp);
  const host = hostOf(link.data.url);
  return writeEntries(
    db,
    "documentLink",
    linkId,
    {
      title: link.data.title ?? (host === "" ? "Linked document" : `Document on ${host}`),
      texts: [link.data.kind, host, link.data.ownerName ?? ""],
      kind: "document",
      target: { entityType: link.data.entityType, entityId: link.data.entityId },
      scope: {
        replicationId: link.data.replicationId,
        laboratoryId: link.data.laboratoryId,
        scopeKeys: link.data.scopeKeys,
      },
    },
    stamp,
  );
}
