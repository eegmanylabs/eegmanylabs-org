import {
  atLeast,
  COLLECTIONS,
  type PageAudience,
  type PagePrincipal,
  pagePermissionDocSchema,
  pagePermissionId,
  restrictedPageAudience,
  setPageSharingContract,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  writeAudit,
} from "../framework";
import {
  descendantsOf,
  inheritedAudience,
  levelOn,
  PAGE_NOT_FOUND_MESSAGE,
  readPage,
  rewriteTree,
} from "../pages/pages";

/**
 * Sets who may read and change a page. Capability: the level `full` on it. `inherit` follows the
 * page above it, its record or the workspace, and removes the permissions of the page.
 * `restricted` opens the page to the listed users and groups alone, at their levels, with the
 * caller at `full` whatever the list says, so that nobody shuts themselves out. Every group must
 * exist. The permissions, the audience of the page and of every page beneath it that inherits,
 * and the audit entry are written in one transaction; the copies of the audience on threads,
 * comments, activity and the search index follow through a trigger.
 */
export const setPageSharing = defineCallable(setPageSharingContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const page = await readPage(db, transaction, input.pageId);
      if (page === null || !atLeast(levelOn(access, context.secondFactorVerified, page.data), "view")) {
        throw new AppError("not-found", PAGE_NOT_FOUND_MESSAGE);
      }
      if (!atLeast(levelOn(access, context.secondFactorVerified, page.data), "full")) {
        throw new AppError("permission-denied", "Only those with full access to this page may share it.");
      }

      const principals = new Map<string, PagePrincipal>();
      if (input.accessMode === "restricted") {
        for (const entry of input.permissions) {
          principals.set(pagePermissionId(entry.principalType, entry.principalId), entry);
        }
        principals.set(pagePermissionId("user", uid), { principalType: "user", principalId: uid, level: "full" });
        const groups = [...principals.values()].filter((principal) => principal.principalType === "group");
        for (const group of groups) {
          const stored = await transaction.get(db.doc(COLLECTIONS.groups.docPath(group.principalId)));
          if (!stored.exists) throw new AppError("invalid-argument", "One of the groups does not exist any more.");
        }
      }

      const stored = await transaction.get(db.collection(COLLECTIONS.pagePermissions.collectionPath(page.id)));
      const parent = page.data.parentPageId === null ? null : await readPage(db, transaction, page.data.parentPageId);
      const descendants = await descendantsOf(db, transaction, page.id);
      const audience: PageAudience =
        input.accessMode === "restricted"
          ? restrictedPageAudience(page.data, [...principals.values()])
          : await inheritedAudience(db, transaction, page.data, parent?.data ?? null);

      const auditEventId = writeAudit(
        transaction,
        {
          action: "page.sharingChanged",
          actor: { kind: "user", uid },
          entityType: "page",
          entityId: page.id,
          changes: [
            { field: "accessMode", before: page.data.accessMode, after: input.accessMode },
            {
              field: "permissions",
              before: stored.docs.map((permission) => `${permission.id}:${String(permission.get("level"))}`),
              after: [...principals].map(([id, principal]) => `${id}:${principal.level}`),
            },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      for (const permission of stored.docs) {
        if (!principals.has(permission.id)) transaction.delete(permission.ref);
      }
      for (const [id, principal] of principals) {
        transaction.set(
          db.doc(COLLECTIONS.pagePermissions.docPath(page.id, id)),
          pagePermissionDocSchema.parse({ ...createdFields("pagePermissions", stamp), pageId: page.id, ...principal }),
        );
      }
      rewriteTree(
        transaction,
        stamp,
        page,
        { ancestorPageIds: page.data.ancestorPageIds, audience, fields: { accessMode: input.accessMode } },
        descendants,
      );
      return {};
    });
  },
});
