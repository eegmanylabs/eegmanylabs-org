import {
  type AuditChange,
  COLLECTIONS,
  CORE_SOURCES,
  checkPropertyValue,
  customValuesSchema,
  DATABASE_TITLE_PROPERTY,
  databaseIdOf,
  databaseRowDocSchema,
  definedProperties,
  type EntityType,
  nestedEntityId,
  orderBetween,
  type PropertyValue,
  parseStoredDocument,
  privateCustomDocSchema,
  saveRecordsContract,
  type ViewProperty,
  type z,
} from "@eegml/shared";
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import type { AuthenticatedContext } from "../framework/context";
import {
  CORE_ENTRIES,
  DATABASE_NOT_FOUND_MESSAGE,
  databaseProperties,
  type EditableCoreKey,
  isEditableCoreKey,
  RESTRICTED_ENTRIES,
  readCustomDefinitions,
  readDatabase,
  requireCoreEditor,
  requireDatabaseEditor,
} from "../views/collections";

type Input = z.output<typeof saveRecordsContract.input>;

const RECORD_NOT_FOUND_MESSAGE = "A record to change does not exist, or your account may not change it.";

/** Each value checked against its property, in its stored form. Refuses an unknown or computed property. */
function checkedValues(
  properties: ReadonlyMap<string, ViewProperty>,
  values: Readonly<Record<string, unknown>>,
): Map<string, PropertyValue> {
  const checked = new Map<string, PropertyValue>();
  for (const [id, raw] of Object.entries(values)) {
    const property = properties.get(id);
    if (property === undefined) throw new AppError("invalid-argument", "A value names a property that does not exist.");
    const result = checkPropertyValue(property, raw);
    if (!result.ok) throw new AppError("invalid-argument", result.error);
    checked.set(id, result.value);
  }
  return checked;
}

const stored = (value: PropertyValue) => (value === null ? FieldValue.delete() : value);

/** The changes an audit entry records: the values themselves, or only their names for a restricted audience. */
function auditChanges(values: ReadonlyMap<string, PropertyValue>, restricted: ReadonlySet<string>): AuditChange[] {
  const open = [...values].filter(([id]) => !restricted.has(id));
  const hidden = [...values.keys()].filter((id) => restricted.has(id));
  return [
    ...open.map(([field, after]) => ({ field, after: after as AuditChange["after"] })),
    ...withheldChanges(hidden),
  ];
}

async function saveRows(
  db: Firestore,
  transaction: Transaction,
  context: AuthenticatedContext,
  databaseId: string,
  input: Input,
): Promise<{ recordIds: string[] }> {
  const { uid } = context;
  const at = context.clock.now();
  const access = await readAccessDocument(db, uid, transaction);
  if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
  const database = await readDatabase(db, transaction, databaseId);
  if (database === null) throw new AppError("not-found", DATABASE_NOT_FOUND_MESSAGE);
  await requireDatabaseEditor(db, transaction, context, access, database);
  const properties = databaseProperties(database.data);
  const rows = COLLECTIONS.databaseRows;

  const existing = new Map<string, DocumentReference>();
  for (const recordId of [...input.changes.flatMap((change) => change.recordId ?? []), ...(input.archive ?? [])]) {
    if (existing.has(recordId)) continue;
    const reference = db.doc(rows.docPath(databaseId, recordId));
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.get("archivedAt") !== null)
      throw new AppError("not-found", RECORD_NOT_FOUND_MESSAGE);
    existing.set(recordId, reference);
  }
  const creates = input.changes.filter((change) => change.recordId === undefined).length;
  let last: string | null = null;
  if (creates > 0) {
    const tail = await transaction.get(
      db.collection(rows.collectionPath(databaseId)).orderBy("order", "desc").limit(1),
    );
    const order = tail.docs[0]?.get("order");
    last = typeof order === "string" ? order : null;
  }

  const recordIds: string[] = [];
  for (const change of input.changes) {
    if (change.title !== undefined && change.title === "") throw new AppError("invalid-argument", "A row has a name.");
    const values = checkedValues(properties, change.values);
    const recordId = change.recordId ?? db.collection(rows.collectionPath(databaseId)).doc().id;
    const auditEventId = writeAudit(
      transaction,
      {
        action: "record.saved",
        actor: { kind: "user", uid },
        entityType: "databaseRow",
        entityId: nestedEntityId(databaseId, recordId),
        changes: [
          ...(change.title === undefined ? [] : [{ field: DATABASE_TITLE_PROPERTY, after: change.title }]),
          ...auditChanges(values, new Set()),
        ],
        at,
      },
      db,
    );
    const stamp = callerStamp(uid, at, auditEventId);
    const reference = existing.get(recordId);
    if (reference === undefined) {
      last = orderBetween(last, null);
      transaction.set(
        db.doc(rows.docPath(databaseId, recordId)),
        databaseRowDocSchema.parse({
          ...createdFields("databaseRows", stamp),
          databaseId,
          title: change.title ?? "Untitled",
          values: Object.fromEntries([...values].filter(([, value]) => value !== null)),
          order: last,
          pageId: null,
          tagIds: [],
        }),
      );
    } else {
      transaction.update(reference, {
        ...(change.title === undefined ? {} : { title: change.title }),
        ...Object.fromEntries([...values].map(([id, value]) => [`values.${id}`, stored(value)])),
        ...touchedFields(stamp),
      });
    }
    recordIds.push(recordId);
  }
  for (const recordId of input.archive ?? []) {
    const auditEventId = writeAudit(
      transaction,
      {
        action: "record.saved",
        actor: { kind: "user", uid },
        entityType: "databaseRow",
        entityId: nestedEntityId(databaseId, recordId),
        changes: [{ field: "archivedAt", after: at.toISOString() }],
        at,
      },
      db,
    );
    const reference = existing.get(recordId);
    if (reference !== undefined) {
      transaction.update(reference, {
        archivedAt: Timestamp.fromDate(at),
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
    }
  }
  return { recordIds };
}

const ENTITY_TYPES: Readonly<Record<EditableCoreKey, EntityType>> = {
  "core:replications": "replication",
  "core:persons": "person",
  "core:laboratories": "laboratory",
  "core:participations": "participation",
};

async function saveCoreRecords(
  db: Firestore,
  transaction: Transaction,
  context: AuthenticatedContext,
  key: EditableCoreKey,
  input: Input,
): Promise<{ recordIds: string[] }> {
  const { uid } = context;
  const at = context.clock.now();
  if ((input.archive ?? []).length > 0) throw new AppError("invalid-argument", "A core record is not archived here.");
  const access = await readAccessDocument(db, uid, transaction);
  if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
  const source = CORE_SOURCES[key];
  const entry = COLLECTIONS[CORE_ENTRIES[key]];
  const restrictedEntry = COLLECTIONS[RESTRICTED_ENTRIES[key]];
  const definitions = await readCustomDefinitions(db, transaction, source.customKey ?? key);
  const custom = definedProperties(definitions, (definition) =>
    definition.audience === "restricted" ? "restricted" : "custom",
  );
  const editableCore = source
    .fields({ laboratoryName: () => null, replicationStatuses: [] })
    .filter((field) => field.source === "coreEditable")
    .map(({ read: _read, ...property }) => property);
  const properties = new Map<string, ViewProperty>(
    [...custom, ...editableCore].map((property) => [property.id, property]),
  );
  const restrictedIds = new Set(
    custom.filter((property) => property.source === "restricted").map((property) => property.id),
  );

  // Every read first: the records, and their restricted values where a change names one.
  const reads = [];
  for (const change of input.changes) {
    if (change.recordId === undefined || change.title !== undefined) {
      throw new AppError("invalid-argument", "A core record is created and named elsewhere.");
    }
    const reference = db.doc(entry.docPath(change.recordId));
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    if (!snapshot.exists || data === undefined || data.archivedAt !== null) {
      throw new AppError("not-found", RECORD_NOT_FOUND_MESSAGE);
    }
    requireCoreEditor(context, access, key, change.recordId, data);
    const values = checkedValues(properties, change.values);
    const touchesRestricted = [...values.keys()].some((id) => restrictedIds.has(id));
    const restrictedReference = db.doc(restrictedEntry.docPath(change.recordId));
    const restricted = touchesRestricted ? await transaction.get(restrictedReference) : null;
    reads.push({ recordId: change.recordId, reference, data, values, restrictedReference, restricted });
  }

  for (const { recordId, reference, data, values, restrictedReference, restricted } of reads) {
    const coreValues = [...values].filter(([id]) => properties.get(id)?.source === "coreEditable");
    const memberValues = [...values].filter(([id]) => properties.get(id)?.source === "custom");
    const restrictedValues = [...values].filter(([id]) => restrictedIds.has(id));

    // The record as it will be, which its strict schema must still accept.
    const nextCustom: Record<string, unknown> = { ...(data.custom as Record<string, unknown>) };
    for (const [id, value] of memberValues) {
      if (value === null) delete nextCustom[id];
      else nextCustom[id] = value;
    }
    const next: Record<string, unknown> = { ...data, custom: nextCustom };
    for (const [id, value] of coreValues) {
      if (value === null) delete next[id];
      else next[id] = value;
    }
    if (!entry.schema.safeParse(next).success) {
      throw new AppError("invalid-argument", "A value does not fit the record. Check the numbers and sizes given.");
    }

    const auditEventId = writeAudit(
      transaction,
      {
        action: "record.saved",
        actor: { kind: "user", uid },
        entityType: ENTITY_TYPES[key],
        entityId: recordId,
        changes: auditChanges(values, restrictedIds),
        at,
      },
      db,
    );
    const stamp = callerStamp(uid, at, auditEventId);
    if (coreValues.length > 0 || memberValues.length > 0) {
      transaction.update(reference, {
        ...Object.fromEntries(coreValues.map(([id, value]) => [id, stored(value)])),
        ...Object.fromEntries(memberValues.map(([id, value]) => [`custom.${id}`, stored(value)])),
        ...touchedFields(stamp),
      });
    }
    if (restrictedValues.length > 0) {
      const current =
        restricted?.exists === true ? parseStoredDocument(privateCustomDocSchema, restricted.data()) : null;
      if (current !== null && !current.success) throw current.error;
      const merged: Record<string, unknown> = { ...(current?.data.custom ?? {}) };
      for (const [id, value] of restrictedValues) {
        if (value === null) delete merged[id];
        else merged[id] = value;
      }
      if (!customValuesSchema.safeParse(merged).success) {
        throw new AppError("invalid-argument", "The restricted values of the record are too large.");
      }
      if (current === null) {
        transaction.set(
          restrictedReference,
          privateCustomDocSchema.parse({ ...createdFields(RESTRICTED_ENTRIES[key], stamp), custom: merged }),
        );
      } else {
        transaction.update(restrictedReference, {
          ...Object.fromEntries(restrictedValues.map(([id, value]) => [`custom.${id}`, stored(value)])),
          ...touchedFields(stamp),
        });
      }
    }
  }
  return { recordIds: reads.map((read) => read.recordId) };
}

/**
 * Changes records of a collection, creates rows of a database and archives them. For a row: the
 * level `edit` on the parent page of its database. For a core record: the capability that
 * changes the record, in its scope: replications.manage, labs.manage, participations.manage or
 * people.manage. Every value is checked against its property, the record must still fit its
 * strict schema afterwards, and each record gets an audit entry, all in one transaction. The
 * values of a restricted property are recorded in the audit trail by name alone.
 */
export const saveRecords = defineCallable(saveRecordsContract, {
  handler: async (input, context) => {
    const { db } = context;
    if (input.changes.length === 0 && (input.archive ?? []).length === 0) return { recordIds: [] };
    const databaseId = databaseIdOf(input.collectionKey);
    if (databaseId !== null) {
      return db.runTransaction((transaction) => saveRows(db, transaction, context, databaseId, input));
    }
    if (!isEditableCoreKey(input.collectionKey)) throw new AppError("not-found", "There is no such collection.");
    const key = input.collectionKey;
    return db.runTransaction((transaction) => saveCoreRecords(db, transaction, context, key, input));
  },
});
