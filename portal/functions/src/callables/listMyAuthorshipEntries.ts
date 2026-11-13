import {
  authorshipEntryDocSchema,
  authorshipListDocSchema,
  COLLECTIONS,
  listMyAuthorshipEntriesContract,
  type MyAuthorshipEntry,
  manuscriptDocSchema,
  parseStoredDocument,
} from "@eegml/shared";
import { defineCallable, readAccessDocument } from "../framework";

/**
 * The caller's own entries on the authorship lists of manuscripts (requirement R12.9), so that a
 * contributor answers their entry whether or not they read the rest of the list. Nothing about
 * the other people on a list is returned. A list that is still a draft is not shown: the leads
 * have not asked for answers yet.
 */
export const listMyAuthorshipEntries = defineCallable(listMyAuthorshipEntriesContract, {
  handler: async (_input, context) => {
    const { db } = context;
    const access = await readAccessDocument(db, context.uid);
    if (!access.member || access.suspended || access.personId === null) return { entries: [] };
    const found = await db
      .collectionGroup(COLLECTIONS.authorshipEntries.collectionId)
      .where("personId", "==", access.personId)
      .limit(500)
      .get();
    const entries: MyAuthorshipEntry[] = [];
    for (const snapshot of found.docs) {
      const entry = parseStoredDocument(authorshipEntryDocSchema, snapshot.data());
      if (!entry.success) continue;
      const [list, manuscript] = await Promise.all([
        db.doc(COLLECTIONS.authorshipLists.docPath(entry.data.manuscriptId)).get(),
        db.doc(COLLECTIONS.manuscripts.docPath(entry.data.manuscriptId)).get(),
      ]);
      const listData = parseStoredDocument(authorshipListDocSchema, list.data());
      const manuscriptData = parseStoredDocument(manuscriptDocSchema, manuscript.data());
      if (!listData.success || !manuscriptData.success || listData.data.status === "draft") continue;
      const { confirmation } = entry.data;
      entries.push({
        manuscriptId: entry.data.manuscriptId,
        manuscriptTitle: manuscriptData.data.title,
        replicationId: manuscriptData.data.replicationId ?? null,
        listStatus: listData.data.status,
        kind: entry.data.kind,
        position: entry.data.position,
        displayName: entry.data.displayName,
        affiliations: entry.data.affiliations,
        orcid: entry.data.orcid ?? null,
        creditRoles: entry.data.creditRoles,
        contributionRoles: entry.data.contributionRoles,
        isCorresponding: entry.data.isCorresponding,
        entryRevision: entry.data.entryRevision,
        confirmation: {
          status: confirmation.status,
          revision: confirmation.revision,
          respondedAt: confirmation.respondedAt === null ? null : confirmation.respondedAt.toDate().toISOString(),
          note: confirmation.note ?? null,
        },
      });
    }
    entries.sort((a, b) => a.manuscriptTitle.localeCompare(b.manuscriptTitle, "en-GB"));
    return { entries };
  },
});
