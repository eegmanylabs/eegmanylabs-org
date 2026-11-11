import { COLLECTIONS, entityRefId, openEntityPageContract, pageDocSchema } from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  writeAudit,
} from "../framework";
import { audienceOf, descendantsOf, entityAudience, readPage, rewriteTree, sameAudience } from "../pages/pages";

/**
 * The body page of a replication, a laboratory or a member: its notes. Capability: membership,
 * which reads every one of these records. The page is created on first use, under the
 * identifier `entityType__entityId`, with the audience of its record and an audit entry, and a
 * repeated call, or a call that loses a race to another, creates nothing. Where the audience of
 * the record has changed since, as when the person of a member page has claimed an account, the
 * page and the pages beneath it that inherit take the new one, with an audit entry.
 */
export const openEntityPage = defineCallable(openEntityPageContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const pageId = entityRefId(input.entityType, input.entityId);
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const existing = await readPage(db, transaction, pageId);
      const { audience, title } = await entityAudience(db, transaction, input.entityType, input.entityId);
      if (existing !== null) {
        if (existing.data.accessMode === "restricted" || sameAudience(audienceOf(existing.data), audience)) {
          return { pageId, created: false };
        }
        const descendants = await descendantsOf(db, transaction, pageId);
        const refreshed = writeAudit(
          transaction,
          {
            action: "page.sharingChanged",
            actor: { kind: "user", uid },
            entityType: "page",
            entityId: pageId,
            changes: [{ field: "levelKeys", before: existing.data.levelKeys, after: audience.levelKeys }],
            at,
          },
          db,
        );
        rewriteTree(
          transaction,
          callerStamp(uid, at, refreshed),
          existing,
          { ancestorPageIds: [], audience },
          descendants,
        );
        return { pageId, created: false };
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "page.created",
          actor: { kind: "user", uid },
          entityType: "page",
          entityId: pageId,
          changes: [
            { field: "entityType", after: input.entityType },
            { field: "entityId", after: input.entityId },
          ],
          at,
        },
        db,
      );
      transaction.set(
        db.doc(COLLECTIONS.pages.docPath(pageId)),
        pageDocSchema.parse({
          ...createdFields("pages", callerStamp(uid, at, auditEventId)),
          parentPageId: null,
          ancestorPageIds: [],
          entityType: input.entityType,
          entityId: input.entityId,
          kind: "entity",
          title,
          order: "i",
          isTemplate: false,
          accessMode: "inherit",
          ...audience,
          contentHead: null,
          mentionUids: [],
          tagIds: [],
          lastEditedBy: null,
        }),
      );
      return { pageId, created: true };
    });
  },
});
