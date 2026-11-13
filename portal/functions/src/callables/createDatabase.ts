import {
  atLeast,
  COLLECTIONS,
  createDatabaseContract,
  DATABASE_TEMPLATE_ROWS_MAX,
  DATABASE_TEMPLATE_VIEWS_MAX,
  type DatabaseDoc,
  databaseDocSchema,
  databaseRowDocSchema,
  parseStoredDocument,
  viewDocSchema,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
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
import { DATABASE_NOT_FOUND_MESSAGE, readDatabase, readsDatabaseNow } from "../views/collections";

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

/** What a database made from a template copies: its properties, its rows and its shared views. */
interface TemplateCopy {
  readonly templateId: string;
  readonly properties: DatabaseDoc["properties"];
  readonly rows: readonly {
    readonly title: string;
    readonly values: Record<string, unknown>;
    readonly order: string;
  }[];
  readonly views: readonly {
    readonly name: string;
    readonly type: string;
    readonly config: Record<string, unknown>;
    readonly order: string;
  }[];
}

/**
 * Reads a template within the transaction, before anything is written. The caller must read it
 * now, it must be marked as a template and not archived, and it must be small enough to copy in
 * one transaction.
 */
async function readTemplate(
  db: Firestore,
  transaction: Transaction,
  secondFactorVerified: boolean,
  access: Awaited<ReturnType<typeof readAccessDocument>>,
  templateId: string,
): Promise<TemplateCopy> {
  const template = await readDatabase(db, transaction, templateId);
  if (template === null || !(await readsDatabaseNow(db, transaction, secondFactorVerified, access, template))) {
    throw new AppError("not-found", DATABASE_NOT_FOUND_MESSAGE);
  }
  if (!template.data.isTemplate || template.data.archivedAt !== null) {
    throw new AppError("failed-precondition", "That database is not a template in use.");
  }
  const rowSnapshot = await transaction.get(
    db.collection(COLLECTIONS.databaseRows.collectionPath(templateId)).limit(DATABASE_TEMPLATE_ROWS_MAX + 1),
  );
  if (rowSnapshot.size > DATABASE_TEMPLATE_ROWS_MAX) {
    throw new AppError(
      "failed-precondition",
      `A template copies ${DATABASE_TEMPLATE_ROWS_MAX} rows at most. Remove rows from the template first.`,
    );
  }
  const rows = rowSnapshot.docs.flatMap((snapshot) => {
    const parsed = parseStoredDocument(databaseRowDocSchema, snapshot.data());
    if (!parsed.success) throw parsed.error;
    const row = parsed.data;
    return row.archivedAt === null ? [{ title: row.title, values: { ...row.values }, order: row.order }] : [];
  });
  const viewSnapshot = await transaction.get(
    db
      .collection(COLLECTIONS.views.collectionPath())
      .where("collectionKey", "==", `db:${templateId}`)
      .where("isShared", "==", true)
      .limit(DATABASE_TEMPLATE_VIEWS_MAX),
  );
  const views = viewSnapshot.docs.flatMap((snapshot) => {
    const parsed = parseStoredDocument(viewDocSchema, snapshot.data());
    if (!parsed.success) throw parsed.error;
    const view = parsed.data;
    return view.archivedAt === null
      ? [{ name: view.name, type: view.type, config: { ...view.config }, order: view.order }]
      : [];
  });
  const properties = Object.fromEntries(
    Object.entries(template.data.properties).filter(([, property]) => property.archivedAt === null),
  );
  return { templateId, properties, rows, views };
}

/**
 * Creates a database beneath a page. Capability: membership, and the level `edit` on the page,
 * which must not be archived. The database copies the audience of the page, which trusted code
 * keeps current. An empty database starts with a status property. A database made from a
 * template copies the template's properties, its rows and its shared views, which become views
 * of the caller shared with the readers of the new database, and names the template in
 * `templateSourceId`. Everything and the audit entry are written in one transaction.
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
      const template =
        input.templateDatabaseId === undefined
          ? null
          : await readTemplate(db, transaction, context.secondFactorVerified, access, input.templateDatabaseId);
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
            ...(template === null
              ? []
              : [
                  { field: "templateSourceId", after: template.templateId },
                  { field: "rowsCopied", after: template.rows.length },
                  { field: "viewsCopied", after: template.views.length },
                ]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      transaction.set(
        db.doc(COLLECTIONS.databases.docPath(databaseId)),
        databaseDocSchema.parse({
          ...createdFields("databases", stamp),
          name: input.name,
          ...(input.icon === undefined ? {} : { icon: input.icon }),
          parentPageId: input.parentPageId,
          isTemplate: false,
          ...(template === null ? {} : { templateSourceId: template.templateId }),
          properties: template === null ? { status: STARTING_STATUS } : template.properties,
          scopeKeys: [...page.data.scopeKeys],
          levelKeys: {
            comment: [...page.data.levelKeys.comment],
            edit: [...page.data.levelKeys.edit],
            full: [...page.data.levelKeys.full],
          },
        }),
      );
      for (const row of template?.rows ?? []) {
        const rows = db.collection(COLLECTIONS.databaseRows.collectionPath(databaseId));
        transaction.set(
          rows.doc(),
          databaseRowDocSchema.parse({
            ...createdFields("databaseRows", stamp),
            databaseId,
            title: row.title,
            values: row.values,
            order: row.order,
            pageId: null,
            tagIds: [],
          }),
        );
      }
      for (const view of template?.views ?? []) {
        transaction.set(
          db.collection(COLLECTIONS.views.collectionPath()).doc(),
          viewDocSchema.parse({
            ...createdFields("views", stamp),
            collectionKey: `db:${databaseId}`,
            name: view.name,
            type: view.type,
            config: view.config,
            ownerUid: uid,
            isShared: true,
            pageId: null,
            order: view.order,
          }),
        );
      }
      return { databaseId };
    });
  },
});
