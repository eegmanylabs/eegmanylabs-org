import {
  atLeast,
  COLLECTIONS,
  createPageContract,
  orderBetween,
  type PageDoc,
  pageContentChunkDocSchema,
  pageDocSchema,
  workspacePageAudience,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import * as Y from "yjs";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  writeAudit,
} from "../framework";
import { contentChunks, extractPageText, loadPageDocument, mentionedUids } from "../pages/content";
import { audienceOf, levelOn, PAGE_NOT_FOUND_MESSAGE, readPage } from "../pages/pages";

/** The deepest a page may sit. */
const MAX_DEPTH = 50;

/**
 * Creates a page. Capability: membership, and the level `edit` on the parent page where there is
 * one. A page at the top of the workspace takes the workspace's audience, in which its creator
 * holds full access, and a page beneath another inherits that page's audience. A page made from
 * a template starts with the template's content as its first generation, and its mentions are
 * recorded at once so that nobody is told again of a mention that the template already held.
 * The page, its content and the audit entry are written in one transaction.
 */
export const createPage = defineCallable(createPageContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const parent = input.parentPageId === null ? null : await readPage(db, transaction, input.parentPageId);
      if (input.parentPageId !== null) {
        if (parent === null || !atLeast(levelOn(access, context.secondFactorVerified, parent.data), "view")) {
          throw new AppError("not-found", PAGE_NOT_FOUND_MESSAGE);
        }
        if (!atLeast(levelOn(access, context.secondFactorVerified, parent.data), "edit")) {
          throw new AppError("permission-denied", "You may not add pages beneath this page.");
        }
        if (parent.data.archivedAt !== null) {
          throw new AppError(
            "failed-precondition",
            "This page is archived. Restore it before adding pages beneath it.",
          );
        }
        if (parent.data.ancestorPageIds.length + 1 >= MAX_DEPTH) {
          throw new AppError("invalid-argument", "Pages cannot be nested this deeply.");
        }
      }

      let template: { readonly id: string; readonly state: Uint8Array; readonly mentions: string[] } | null = null;
      if (input.templatePageId !== undefined) {
        const source = await readPage(db, transaction, input.templatePageId);
        if (
          source === null ||
          !source.data.isTemplate ||
          source.data.archivedAt !== null ||
          !atLeast(levelOn(access, context.secondFactorVerified, source.data), "view")
        ) {
          throw new AppError("not-found", "This template does not exist, or your account may not use it.");
        }
        const doc = await loadPageDocument(db, source.id, source.data, transaction);
        template = {
          id: source.id,
          state: Y.encodeStateAsUpdate(doc),
          mentions: mentionedUids(extractPageText(doc)),
        };
      }

      const siblings = await transaction.get(
        db.collection(COLLECTIONS.pages.collectionPath()).where("parentPageId", "==", input.parentPageId).limit(1_000),
      );
      const last = siblings.docs
        .map((sibling) => sibling.get("order") as unknown)
        .filter((order): order is string => typeof order === "string")
        .sort()
        .at(-1);

      const pageId = db.collection(COLLECTIONS.pages.collectionPath()).doc().id;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "page.created",
          actor: { kind: "user", uid },
          entityType: "page",
          entityId: pageId,
          changes: [
            { field: "title", after: input.title },
            { field: "parentPageId", after: input.parentPageId },
            ...(input.kind === undefined ? [] : [{ field: "kind", after: input.kind }]),
            ...(template === null ? [] : [{ field: "templateSourceId", after: template.id }]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const audience = parent === null ? workspacePageAudience(uid) : audienceOf(parent.data);
      const page: PageDoc = pageDocSchema.parse({
        ...createdFields("pages", stamp),
        parentPageId: input.parentPageId,
        ancestorPageIds: parent === null ? [] : [...parent.data.ancestorPageIds, parent.id],
        kind: input.kind ?? "custom",
        title: input.title,
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        order: orderBetween(last ?? null, null),
        isTemplate: false,
        ...(template === null ? {} : { templateSourceId: template.id }),
        accessMode: "inherit",
        ...audience,
        contentHead:
          template === null
            ? null
            : {
                generation: 0,
                chunkCount: contentChunks(pageId, 0, template.state).length,
                byteLength: template.state.length,
                stateVector: Y.encodeStateVectorFromUpdate(template.state),
                compactedAt: Timestamp.fromDate(at),
              },
        mentionUids: template?.mentions ?? [],
        tagIds: [],
        lastEditedBy: null,
      });
      if (template !== null) {
        const chunkStamp = createdFields("pageContent", stamp);
        for (const chunk of contentChunks(pageId, 0, template.state)) {
          transaction.set(
            db.doc(COLLECTIONS.pageContent.docPath(pageId, chunk.id)),
            pageContentChunkDocSchema.parse({
              schemaVersion: chunkStamp.schemaVersion,
              createdAt: chunkStamp.createdAt,
              createdBy: chunkStamp.createdBy,
              writeContext: chunkStamp.writeContext,
              ...chunk.fields,
            }),
          );
        }
      }
      transaction.set(db.doc(COLLECTIONS.pages.docPath(pageId)), page);
      return { pageId };
    });
  },
});
