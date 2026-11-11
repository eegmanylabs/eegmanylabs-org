import { atLeast, movePageContract } from "@eegml/shared";
import {
  AppError,
  callerStamp,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  writeAudit,
} from "../framework";
import {
  audienceOf,
  descendantsOf,
  inheritedAudience,
  levelOn,
  PAGE_NOT_FOUND_MESSAGE,
  readPage,
  rewriteTree,
} from "../pages/pages";

/** The deepest a page may sit. */
const MAX_DEPTH = 50;

/**
 * Moves a page beneath another page, or to the top of the workspace, at the place `order` names.
 * Capability: the level `edit` on the page and on its new parent. The body page of a record
 * stays where it is, and a page never moves beneath itself. A page that inherits takes the
 * audience of its new place, and every page beneath it moves with it and takes its new audience
 * where it inherits, in one transaction with the audit entry.
 */
export const movePage = defineCallable(movePageContract, {
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
      if (!atLeast(levelOn(access, context.secondFactorVerified, page.data), "edit")) {
        throw new AppError("permission-denied", "You may not move this page.");
      }
      if (page.data.kind === "entity") {
        throw new AppError("failed-precondition", "The notes of a record stay with the record.");
      }
      const parent = input.parentPageId === null ? null : await readPage(db, transaction, input.parentPageId);
      if (input.parentPageId !== null) {
        if (parent === null || !atLeast(levelOn(access, context.secondFactorVerified, parent.data), "view")) {
          throw new AppError("not-found", PAGE_NOT_FOUND_MESSAGE);
        }
        if (!atLeast(levelOn(access, context.secondFactorVerified, parent.data), "edit")) {
          throw new AppError("permission-denied", "You may not add pages beneath that page.");
        }
        if (parent.id === page.id || parent.data.ancestorPageIds.includes(page.id)) {
          throw new AppError("invalid-argument", "A page cannot move beneath itself.");
        }
        if (parent.data.archivedAt !== null) {
          throw new AppError(
            "failed-precondition",
            "That page is archived. Restore it before moving pages beneath it.",
          );
        }
      }
      const descendants = await descendantsOf(db, transaction, page.id);
      const ancestorPageIds = parent === null ? [] : [...parent.data.ancestorPageIds, parent.id];
      const deepest = Math.max(0, ...descendants.map((descendant) => descendant.data.ancestorPageIds.length));
      if (ancestorPageIds.length + 1 + Math.max(0, deepest - page.data.ancestorPageIds.length - 1) >= MAX_DEPTH) {
        throw new AppError("invalid-argument", "Pages cannot be nested this deeply.");
      }
      const audience =
        page.data.accessMode === "inherit"
          ? await inheritedAudience(db, transaction, page.data, parent?.data ?? null)
          : audienceOf(page.data);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "page.moved",
          actor: { kind: "user", uid },
          entityType: "page",
          entityId: page.id,
          changes: [
            { field: "parentPageId", before: page.data.parentPageId, after: input.parentPageId },
            { field: "order", before: page.data.order, after: input.order },
          ],
          at,
        },
        db,
      );
      rewriteTree(
        transaction,
        callerStamp(uid, at, auditEventId),
        page,
        { ancestorPageIds, audience, fields: { parentPageId: input.parentPageId, order: input.order } },
        descendants,
      );
      return {};
    });
  },
});
