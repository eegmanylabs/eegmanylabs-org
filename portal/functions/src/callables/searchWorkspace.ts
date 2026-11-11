import {
  COLLECTIONS,
  parseStoredDocument,
  programmePowersInEffect,
  searchIndexDocSchema,
  searchQueryTokens,
  searchWorkspaceContract,
  sessionScopeKeys,
  type WorkspaceSearchResult,
} from "@eegml/shared";
import { AppError, defineCallable, NOT_ALLOWED_MESSAGE, readAccessDocument } from "../framework";

/** The most entries one word of a query reads, and the most results the answer holds. */
const READ_PER_WORD = 300;
const RESULTS = 50;

/**
 * Searches the index of the workspace (docs/DATA_MODEL.md, section 13). Capability: membership.
 * No client reads the index: this function finds the entries that hold every word of the query,
 * by its first letters, and returns only those whose audience the caller holds in this session,
 * as the security rules decide for the record itself. Programme administrators and the core team
 * find every entry in a session with their second factor. A restricted page is found by its
 * principals alone, and the index holds nothing of `private` or `special` documents.
 */
export const searchWorkspace = defineCallable(searchWorkspaceContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const access = await readAccessDocument(db, uid);
    if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
    const tokens = searchQueryTokens(input.query);
    if (tokens === null) return { results: [] };
    const session = { secondFactorVerified: context.secondFactorVerified };
    const staff = access.programmeRoles.length > 0 && programmePowersInEffect(access, session);
    const held = new Set(sessionScopeKeys(access, session));

    // The entries of each record that hold a word, by record.
    let matching = new Map<string, WorkspaceSearchResult>();
    let first = true;
    for (const token of tokens) {
      const found = await db
        .collection(COLLECTIONS.searchIndex.collectionPath())
        .where("tokens", "array-contains", token)
        .limit(READ_PER_WORD)
        .get();
      const records = new Map<string, WorkspaceSearchResult>();
      for (const document of found.docs) {
        const parsed = parseStoredDocument(searchIndexDocSchema, document.data());
        if (!parsed.success) continue;
        const entry = parsed.data;
        if (!staff && !entry.scopeKeys.some((key) => held.has(key))) continue;
        records.set(`${entry.entityType}/${entry.entityId}`, {
          entityType: entry.entityType,
          entityId: entry.entityId,
          title: entry.title,
          kind: entry.kind,
        });
      }
      matching = first ? records : new Map([...matching].filter(([key]) => records.has(key)));
      first = false;
    }
    const results = [...matching.values()]
      .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }))
      .slice(0, RESULTS);
    return { results };
  },
});
