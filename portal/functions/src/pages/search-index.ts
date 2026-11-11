// The entries of a page in the search index (docs/DATA_MODEL.md, section 13). An entry carries
// the folded words of the title and of the text of the page with their beginnings, and the
// audience of the page, so that the search function returns it to the page's readers alone. A
// page that is archived has no entries. Entries are written by triggers, which keep them in step
// with the content and the audience of the page.
import {
  COLLECTIONS,
  pageDocSchema,
  parseStoredDocument,
  searchIndexDocSchema,
  searchIndexId,
  searchTokenParts,
  searchTokensOf,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { createdFields, type WriteStamp } from "../framework/documents";
import type { PageText } from "./content";

/** The stored entries of a page, by part, read in a transaction where one is given. */
async function entriesOf(db: Firestore, pageId: string, transaction?: Transaction) {
  const query = db.collection(COLLECTIONS.searchIndex.collectionPath()).where("entityId", "==", pageId);
  const found = await (transaction === undefined ? query.get() : transaction.get(query));
  return found.docs.filter((entry) => entry.get("entityType") === "page");
}

/**
 * Writes the entries of a page from its title and text, and removes the parts it no longer needs.
 * The page is read again in the transaction that writes the entries, so that the entries carry
 * its audience and title as they stand when they are written: a change of sharing that commits
 * after the text was read is never overwritten with the older, wider audience. A page that no
 * longer exists or is archived loses its entries. Returns the number of entries.
 */
export async function indexPage(db: Firestore, pageId: string, text: PageText, stamp: WriteStamp): Promise<number> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(db.doc(COLLECTIONS.pages.docPath(pageId)));
    const parsed = parseStoredDocument(pageDocSchema, snapshot.data());
    const entries = await entriesOf(db, pageId, transaction);
    if (!snapshot.exists || !parsed.success || parsed.data.archivedAt !== null) {
      for (const entry of entries) transaction.delete(entry.ref);
      return 0;
    }
    const page = parsed.data;
    const parts = searchTokenParts(searchTokensOf([page.title, ...text.lines]));
    parts.forEach((tokens, part) => {
      transaction.set(
        db.doc(COLLECTIONS.searchIndex.docPath(searchIndexId("page", pageId, part))),
        searchIndexDocSchema.parse({
          ...createdFields("searchIndex", stamp),
          entityType: "page",
          entityId: pageId,
          part,
          title: page.title,
          tokens,
          kind: page.kind,
          replicationId: page.replicationId,
          laboratoryId: page.laboratoryId,
          scopeKeys: page.scopeKeys,
        }),
      );
    });
    for (const entry of entries) if ((entry.get("part") as number) >= parts.length) transaction.delete(entry.ref);
    return parts.length;
  });
}

/** Removes every entry of a page. */
export async function removePageIndex(db: Firestore, pageId: string): Promise<void> {
  const entries = await entriesOf(db, pageId);
  if (entries.length === 0) return;
  const batch = db.batch();
  for (const entry of entries) batch.delete(entry.ref);
  await batch.commit();
}
