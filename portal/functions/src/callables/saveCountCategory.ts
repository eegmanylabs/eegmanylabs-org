import {
  COLLECTIONS,
  countCategoryDocSchema,
  PROGRAMME_KEY,
  parseStoredDocument,
  saveCountCategoryContract,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

/**
 * Creates or changes a category of participant counts (docs/DATA_MODEL.md, section 7).
 *
 * | Category                      | Who may save it                                                      |
 * |-------------------------------|----------------------------------------------------------------------|
 * | Global                        | Holders of `lookups.manage`: administrators and the core team        |
 * | An extension of a replication | Holders of `replications.manage` there: its leads, the core team and administrators |
 *
 * A key names one category for good, so a new category takes a key that no category, of any
 * replication, holds yet, and is placed after the last. The replication of a category never
 * changes, and a seeded core category is never archived, because reports name it. The category
 * and its audit entry are written in one transaction.
 */
export const saveCountCategory = defineCallable(saveCountCategoryContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const reference = db.doc(COLLECTIONS.countCategories.docPath(input.key));
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (input.replicationId === null) {
        requireCapability(context, access, "lookups.manage", "programme");
      } else {
        requireCapability(context, access, "replications.manage", { replicationId: input.replicationId });
        const replication = await transaction.get(db.doc(COLLECTIONS.replications.docPath(input.replicationId)));
        if (!replication.exists) throw new AppError("not-found", "This replication does not exist.");
      }
      const snapshot = await transaction.get(reference);
      const stored = snapshot.exists ? parseStoredDocument(countCategoryDocSchema, snapshot.data()) : null;
      if (input.create && snapshot.exists) {
        throw new AppError("already-exists", "A category with this key exists already. Choose another key.");
      }
      if (!input.create && (stored === null || !stored.success)) {
        throw new AppError("not-found", "This category does not exist.");
      }
      const current = stored?.success === true ? stored.data : null;
      if (current !== null && (current.replicationId ?? null) !== input.replicationId) {
        throw new AppError("permission-denied", "This category belongs to another replication, or to the programme.");
      }
      if (current?.isCore === true && input.archived) {
        throw new AppError("failed-precondition", "A core category is part of every report and cannot be archived.");
      }
      let position = current?.position ?? 0;
      if (current === null) {
        const all = await transaction.get(db.collection(COLLECTIONS.countCategories.collectionPath()).limit(1_000));
        position = all.docs.reduce(
          (highest, document) => Math.max(highest, Number(document.get("position") ?? 0) + 1),
          0,
        );
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "countCategory.saved",
          actor: { kind: "user", uid },
          entityType: input.replicationId === null ? "programme" : "replication",
          entityId: input.replicationId ?? PROGRAMME_KEY,
          changes: [
            { field: "key", after: input.key },
            { field: "label", before: current?.label ?? null, after: input.label },
            { field: "definition", before: current?.definition ?? null, after: input.definition },
            { field: "archived", before: current === null ? null : current.archivedAt !== null, after: input.archived },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const archivedAt = input.archived ? (current?.archivedAt ?? touchedFields(stamp).updatedAt) : null;
      if (current === null) {
        transaction.create(
          reference,
          countCategoryDocSchema.parse({
            ...createdFields("countCategories", stamp),
            key: input.key,
            label: input.label,
            definition: input.definition,
            position,
            isCore: false,
            ...(input.replicationId === null ? {} : { replicationId: input.replicationId }),
          }),
        );
      } else {
        transaction.update(reference, {
          label: input.label,
          definition: input.definition,
          archivedAt,
          ...touchedFields(stamp),
        });
      }
      return { key: input.key };
    });
  },
});
