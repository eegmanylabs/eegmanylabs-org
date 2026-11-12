import {
  type AuditChange,
  COLLECTIONS,
  datasetDetailDocSchema,
  datasetDocSchema,
  parseStoredDocument,
  updateDatasetContract,
} from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { readDataset, requireForDataset } from "../datasets/model";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";

/** The descriptive fields of the registry document that a call may set or clear. */
const DOCUMENT_FIELDS = [
  "title",
  "modality",
  "groupingLabel",
  "sourceInstitutionId",
  "storageOwnerPersonId",
  "protocolId",
  "expectedFileCount",
  "expectedParticipants",
  "bidsConversionStatus",
  "bidsVersion",
] as const;

/** The fields of the restricted detail, which can name files and participant labels. */
const DETAIL_FIELDS = ["metadata", "bidsMissingMetadata", "bidsNamingMap"] as const;

/**
 * Changes the descriptive fields of a dataset, its metadata, its BIDS conversion and its naming
 * mappings, or archives or restores it, for a holder of `datasets.manage` for the dataset's
 * replication or laboratory. Its key, replication, laboratory, state, BIDS validation, QC status
 * and copies change only through the functions made for them. The audit entry gives the values
 * of the registry document, which every member reads, and only the names of the restricted
 * fields that changed.
 */
export const updateDataset = defineCallable(updateDatasetContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      const archiving = input.archived;
      if (dataset.data.archivedAt !== null && archiving !== false) {
        throw new AppError("failed-precondition", "This dataset is archived. Restore it before changing it.");
      }
      const detailReference = db.doc(COLLECTIONS.datasetDetail.docPath(input.datasetKey));
      const detail = parseStoredDocument(datasetDetailDocSchema, (await transaction.get(detailReference)).data());
      for (const [id, collection, message] of [
        [input.sourceInstitutionId, COLLECTIONS.institutions, "The source institution is not in the portal."],
        [input.storageOwnerPersonId, COLLECTIONS.persons, "The storage owner is not in the portal."],
      ] as const) {
        if (typeof id === "string" && !(await transaction.get(db.doc(collection.docPath(id)))).exists) {
          throw new AppError("invalid-argument", message);
        }
      }
      if (
        typeof input.protocolId === "string" &&
        !(
          await transaction.get(
            db.doc(COLLECTIONS.replicationProtocols.docPath(dataset.data.replicationId, input.protocolId)),
          )
        ).exists
      ) {
        throw new AppError("invalid-argument", "The protocol is not one of this replication's protocols.");
      }

      const documentChanges: Record<string, unknown> = {};
      const auditChanges: AuditChange[] = [];
      for (const field of DOCUMENT_FIELDS) {
        const value = input[field];
        if (value === undefined) continue;
        const before = dataset.data[field] ?? null;
        if (before === value) continue;
        documentChanges[field] = value === null ? FieldValue.delete() : value;
        auditChanges.push({ field, before, after: value });
      }
      if (archiving !== undefined && archiving !== (dataset.data.archivedAt !== null)) {
        documentChanges.archivedAt = archiving ? Timestamp.fromDate(at) : null;
        auditChanges.push({ field: "archived", before: !archiving, after: archiving });
      }
      const detailChanges: Record<string, unknown> = {};
      for (const field of DETAIL_FIELDS) {
        const value = input[field];
        if (value === undefined) continue;
        detailChanges[field] = value;
      }
      const changedDetail = Object.keys(detailChanges);
      if (auditChanges.length === 0 && changedDetail.length === 0) {
        return { datasetKey: input.datasetKey, changedFields: [] };
      }
      // The document as it will be, checked against its schema before anything is written.
      const next: Record<string, unknown> = { ...dataset.data };
      for (const [field, value] of Object.entries(documentChanges)) {
        if (value instanceof FieldValue) delete next[field];
        else next[field] = value;
      }
      datasetDocSchema.parse(next);

      const auditEventId = writeAudit(
        transaction,
        {
          action: "dataset.updated",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [...auditChanges, ...withheldChanges(changedDetail.map((field) => `detail.${field}`))],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      if (Object.keys(documentChanges).length > 0) {
        transaction.update(dataset.reference, { ...documentChanges, ...touchedFields(stamp) });
      }
      if (changedDetail.length > 0) {
        const base = detail.success ? detail.data : createdFields("datasetDetail", stamp);
        transaction.set(
          detailReference,
          datasetDetailDocSchema.parse({ ...base, ...detailChanges, ...touchedFields(stamp) }),
        );
      }
      return {
        datasetKey: input.datasetKey,
        changedFields: [...auditChanges.map((change) => change.field), ...changedDetail],
      };
    });
  },
});
