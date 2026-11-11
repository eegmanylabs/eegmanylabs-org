import {
  atLeast,
  COLLECTIONS,
  getPageSharingContract,
  pagePermissionDocSchema,
  parseStoredDocument,
} from "@eegml/shared";
import { AppError, defineCallable, NOT_ALLOWED_MESSAGE, readAccessDocument } from "../framework";
import { levelOn, PAGE_NOT_FOUND_MESSAGE, readPage } from "../pages/pages";

/** The most groups the dialog offers. */
const GROUPS_LISTED = 500;

/**
 * What the sharing dialog of a page shows. Capability: the level `full` on the page. It returns
 * the access mode, each listed principal with the name of the person or the group, and the
 * groups that may be added. The names are those of the directory, which every member reads.
 */
export const getPageSharing = defineCallable(getPageSharingContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    return db.runTransaction(
      async (transaction) => {
        const access = await readAccessDocument(db, uid, transaction);
        if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
        const page = await readPage(db, transaction, input.pageId);
        if (page === null || !atLeast(levelOn(access, context.secondFactorVerified, page.data), "view")) {
          throw new AppError("not-found", PAGE_NOT_FOUND_MESSAGE);
        }
        if (!atLeast(levelOn(access, context.secondFactorVerified, page.data), "full")) {
          throw new AppError("permission-denied", "Only those with full access to this page may share it.");
        }
        const stored = await transaction.get(db.collection(COLLECTIONS.pagePermissions.collectionPath(page.id)));
        const groups = await transaction.get(db.collection(COLLECTIONS.groups.collectionPath()).limit(GROUPS_LISTED));
        const groupNames = new Map(groups.docs.map((group) => [group.id, String(group.get("name"))]));
        const permissions = [];
        for (const document of stored.docs) {
          const parsed = parseStoredDocument(pagePermissionDocSchema, document.data());
          if (!parsed.success) continue;
          const { principalType, principalId, level } = parsed.data;
          let name: string | null = null;
          if (principalType === "group") name = groupNames.get(principalId) ?? null;
          if (principalType === "user") {
            const personId = (await transaction.get(db.doc(COLLECTIONS.users.docPath(principalId)))).get("personId");
            if (typeof personId === "string") {
              const displayName = (await transaction.get(db.doc(COLLECTIONS.persons.docPath(personId)))).get(
                "displayName",
              );
              name = typeof displayName === "string" ? displayName : null;
            }
          }
          permissions.push({ principalType, principalId, level, name });
        }
        return {
          accessMode: page.data.accessMode,
          permissions,
          groups: groups.docs
            .filter((group) => group.get("archivedAt") === null)
            .map((group) => ({ groupKey: group.id, name: String(group.get("name")) })),
        };
      },
      { readOnly: true },
    );
  },
});
