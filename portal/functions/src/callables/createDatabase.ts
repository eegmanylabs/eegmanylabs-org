import { atLeast, COLLECTIONS, createDatabaseContract, databaseDocSchema } from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  writeAudit,
} from "../framework";
import { levelOn, PAGE_NOT_FOUND_MESSAGE, readPage } from "../pages/pages";

/** The status that a new database starts with, so that a board can be drawn at once. */
const STARTING_STATUS = {
  key: "status",
  name: "Status",
  type: "status",
  config: {
    options: [
      { id: "notStarted", name: "Not started", group: "toDo" },
      { id: "inProgress", name: "In progress", group: "inProgress" },
      { id: "done", name: "Done", group: "complete" },
    ],
  },
  order: "i",
  archivedAt: null,
} as const;

/**
 * Creates a database beneath a page. Capability: membership, and the level `edit` on the page,
 * which must not be archived. The database copies the audience of the page, which trusted code
 * keeps current, and starts with a status property. The database and its audit entry are
 * written in one transaction.
 */
export const createDatabase = defineCallable(createDatabaseContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const page = await readPage(db, transaction, input.parentPageId);
      const level = page === null ? "none" : levelOn(access, context.secondFactorVerified, page.data);
      if (page === null || !atLeast(level, "view")) throw new AppError("not-found", PAGE_NOT_FOUND_MESSAGE);
      if (!atLeast(level, "edit")) throw new AppError("permission-denied", "You may not add a database to this page.");
      if (page.data.archivedAt !== null) {
        throw new AppError("failed-precondition", "This page is archived. Restore it before adding a database.");
      }
      const databaseId = db.collection(COLLECTIONS.databases.collectionPath()).doc().id;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "database.created",
          actor: { kind: "user", uid },
          entityType: "database",
          entityId: databaseId,
          changes: [
            { field: "name", after: input.name },
            { field: "parentPageId", after: input.parentPageId },
          ],
          at,
        },
        db,
      );
      transaction.set(
        db.doc(COLLECTIONS.databases.docPath(databaseId)),
        databaseDocSchema.parse({
          ...createdFields("databases", callerStamp(uid, at, auditEventId)),
          name: input.name,
          ...(input.icon === undefined ? {} : { icon: input.icon }),
          parentPageId: input.parentPageId,
          isTemplate: false,
          properties: { status: STARTING_STATUS },
          scopeKeys: [...page.data.scopeKeys],
          levelKeys: {
            comment: [...page.data.levelKeys.comment],
            edit: [...page.data.levelKeys.edit],
            full: [...page.data.levelKeys.full],
          },
        }),
      );
      return { databaseId };
    });
  },
});
