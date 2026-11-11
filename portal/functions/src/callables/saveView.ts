import {
  COLLECTIONS,
  CORE_SOURCES,
  databaseIdOf,
  isCoreSourceKey,
  parseStoredDocument,
  saveViewContract,
  viewDocSchema,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  secondFactorSatisfied,
  touchedFields,
  writeAudit,
} from "../framework";
import { levelOn, readPage } from "../pages/pages";
import { readDatabase, readsDatabaseNow } from "../views/collections";

const VIEW_NOT_FOUND_MESSAGE = "This view does not exist, or your account may not open it.";

/**
 * Saves a view. Capability: membership. A new view belongs to the caller, who alone sees it
 * until it is shared. An existing view is changed by its owner, and a shared one also by
 * programme administrators and the core team with their second factor; nobody changes whose it
 * is or which collection it shows. The collection must be one the caller reads, and the page it
 * is placed on one the caller opens. A shared view of a database is read by the readers of the
 * database alone, which the rules decide. The view and its audit entry are written in one
 * transaction.
 */
export const saveView = defineCallable(saveViewContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const views = COLLECTIONS.views;
      const viewId = input.viewId ?? db.collection(views.collectionPath()).doc().id;
      const reference = db.doc(views.docPath(viewId));
      let existing: ReturnType<typeof viewDocSchema.parse> | null = null;
      if (input.viewId !== undefined) {
        const snapshot = await transaction.get(reference);
        const parsed = snapshot.exists ? parseStoredDocument(viewDocSchema, snapshot.data()) : null;
        if (parsed !== null && !parsed.success) throw parsed.error;
        existing = parsed?.data ?? null;
        const owner = existing?.ownerUid === uid;
        if (existing === null || (!owner && !existing.isShared))
          throw new AppError("not-found", VIEW_NOT_FOUND_MESSAGE);
        const staff = access.programmeRoles.length > 0 && secondFactorSatisfied(context, access);
        if (!owner && !staff) throw new AppError("permission-denied", "Only its owner changes this view.");
        if (existing.collectionKey !== input.collectionKey) {
          throw new AppError("invalid-argument", "A view keeps the collection it was made for.");
        }
      }
      const databaseId = databaseIdOf(input.collectionKey);
      if (databaseId === null) {
        if (!isCoreSourceKey(input.collectionKey) || !CORE_SOURCES[input.collectionKey].selectable) {
          throw new AppError("not-found", "There is no such collection.");
        }
      } else {
        const database = await readDatabase(db, transaction, databaseId);
        if (
          database === null ||
          !(await readsDatabaseNow(db, transaction, context.secondFactorVerified, access, database))
        ) {
          throw new AppError("not-found", "There is no such collection.");
        }
      }
      // A view placed on a page names a page that the caller reads.
      if (input.pageId !== null) {
        const page = await readPage(db, transaction, input.pageId);
        if (page === null || levelOn(access, context.secondFactorVerified, page.data) === "none") {
          throw new AppError("not-found", "This page does not exist, or your account may not open it.");
        }
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "view.saved",
          actor: { kind: "user", uid },
          entityType: "view",
          entityId: viewId,
          changes: [
            { field: "name", after: input.name },
            { field: "type", after: input.type },
            { field: "isShared", after: input.isShared },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const fields = {
        collectionKey: input.collectionKey,
        name: input.name,
        type: input.type,
        config: JSON.parse(JSON.stringify(input.config)) as Record<string, unknown>,
        ...(input.scope === null ? {} : { scope: { ...input.scope } }),
        isShared: input.isShared,
        pageId: input.pageId,
      };
      if (existing === null) {
        transaction.set(
          reference,
          viewDocSchema.parse({ ...createdFields("views", stamp), ...fields, ownerUid: uid, order: "i" }),
        );
      } else {
        const { scope: _scope, ...withoutScope } = existing;
        transaction.set(reference, viewDocSchema.parse({ ...withoutScope, ...fields, ...touchedFields(stamp) }));
      }
      return { viewId };
    });
  },
});
