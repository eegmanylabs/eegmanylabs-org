// The entries of a page in the search index (docs/DATA_MODEL.md, section 13). An entry carries
// the folded words of the title and of the text of the page with their beginnings, and the
// audience of the page, so that the search function returns it to the page's readers alone. A
// page that is archived has no entries. Entries are written by triggers, which keep them in step
// with the content and the audience of the page.
import {
  COLLECTIONS,
  type PageDoc,
  searchIndexDocSchema,
  searchIndexId,
  searchTokenParts,
  searchTokensOf,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { createdFields, type WriteStamp } from "../framework/documents";
import type { PageText } from "./content";

/** The stored entries of a page, by part. */
async function entriesOf(db: Firestore, pageId: string) {
  const found = await db.collection(COLLECTIONS.searchIndex.collectionPath()).where("entityId", "==", pageId).get();
  return found.docs.filter((entry) => entry.get("entityType") === "page");
}

/** Writes the entries of a page from its title and text, and removes the parts it no longer needs. */
export async function indexPage(
  db: Firestore,
  pageId: string,
  page: PageDoc,
  text: PageText,
  stamp: WriteStamp,
): Promise<number> {
  const parts = searchTokenParts(searchTokensOf([page.title, ...text.lines]));
  const stale = (await entriesOf(db, pageId)).filter((entry) => (entry.get("part") as number) >= parts.length);
  const batch = db.batch();
  parts.forEach((tokens, part) => {
    batch.set(
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
  for (const entry of stale) batch.delete(entry.ref);
  await batch.commit();
  return parts.length;
}

/** Removes every entry of a page. */
export async function removePageIndex(db: Firestore, pageId: string): Promise<void> {
  const entries = await entriesOf(db, pageId);
  if (entries.length === 0) return;
  const batch = db.batch();
  for (const entry of entries) batch.delete(entry.ref);
  await batch.commit();
}
