// The portal side of a mapping: how the records of a synchronisation target are read, and how a
// value taken from a sheet is written to them. A write requires each field still to hold the
// value the plan read, writes the audit entry in the same transaction, and carries the origin
// `sync`, so the trigger that starts synchronisation passes over it.
import { isDeepStrictEqual } from "node:util";
import {
  type AppRecord,
  type AuditChange,
  appValueOf,
  type Canonical,
  COLLECTIONS,
  canonicalFromApp,
  type EntityType,
  equipmentRowKey,
  laboratoryDocSchema,
  laboratoryEquipmentDocSchema,
  nestedEntityId,
  parseStoredDocument,
  SYNC_TARGETS,
  type SyncTargetKey,
  syncTargetField,
} from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { writeAudit } from "../../framework";
import { createdFields, touchedFields } from "../../framework/documents";
import { syncStamp } from "./context";

/** A record as a mapping sees it, with what the resolution screen and the audit trail name it by. */
export interface TargetRecord extends AppRecord {
  readonly entityType: EntityType;
  /** The document as it is now. For an equipment chain, its current configuration. */
  readonly entityId: string;
  readonly label: string;
}

export interface FieldWrite {
  readonly field: string;
  readonly canonical: Canonical;
  /** The value the field must still hold for the write to go ahead. */
  readonly expected: Canonical;
}

/** `written`, or `stale` where a field changed since the plan read it, or `invalid` where the record refuses a value. */
export type WriteResult =
  | { readonly kind: "written" }
  | { readonly kind: "stale" }
  | { readonly kind: "invalid"; readonly reason: string };

export interface WriteCause {
  readonly mappingId: string;
  readonly runId: string;
  readonly at: Date;
}

export interface TargetAdapter {
  load(db: Firestore): Promise<readonly TargetRecord[]>;
  write(db: Firestore, record: TargetRecord, writes: readonly FieldWrite[], cause: WriteCause): Promise<WriteResult>;
}

function canonicalOf(key: SyncTargetKey, field: string, value: unknown): Canonical | undefined {
  const spec = syncTargetField(key, field)?.spec;
  if (spec === undefined) return undefined;
  const converted = canonicalFromApp(spec, value);
  return converted.ok ? converted.value : undefined;
}

function appValue(key: SyncTargetKey, field: string, canonical: Canonical): unknown {
  const spec = syncTargetField(key, field)?.spec;
  return spec === undefined ? undefined : appValueOf(spec, canonical);
}

const LABORATORY_FIELDS = Object.keys(SYNC_TARGETS["core:laboratories"].fields);

const laboratories: TargetAdapter = {
  async load(db) {
    const snapshot = await db.collection(COLLECTIONS.laboratories.collectionPath()).get();
    return snapshot.docs.flatMap((document): TargetRecord[] => {
      const parsed = parseStoredDocument(laboratoryDocSchema, document.data());
      if (!parsed.success) return [];
      const values: Record<string, unknown> = {};
      for (const field of LABORATORY_FIELDS) values[field] = (parsed.data as Record<string, unknown>)[field];
      return [
        {
          key: parsed.data.slug,
          recordId: document.id,
          values,
          archived: parsed.data.archivedAt !== null,
          entityType: "laboratory",
          entityId: document.id,
          label: parsed.data.name,
        },
      ];
    });
  },

  async write(db, record, writes, cause) {
    const reference = db.doc(COLLECTIONS.laboratories.docPath(record.recordId));
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const parsed = parseStoredDocument(laboratoryDocSchema, snapshot.data());
      if (!parsed.success || parsed.data.archivedAt !== null) return { kind: "stale" } as const;
      const stored = parsed.data as Record<string, unknown>;
      if (
        writes.some((write) => canonicalOf("core:laboratories", write.field, stored[write.field]) !== write.expected)
      ) {
        return { kind: "stale" } as const;
      }
      const next: Record<string, unknown> = { ...stored };
      const update: Record<string, unknown> = {};
      const changes: AuditChange[] = [];
      for (const write of writes) {
        const value = appValue("core:laboratories", write.field, write.canonical);
        if (value === undefined) delete next[write.field];
        else next[write.field] = value;
        update[write.field] = value === undefined ? FieldValue.delete() : value;
        changes.push({ field: write.field, before: stored[write.field] ?? null, after: value ?? null });
      }
      const checked = laboratoryDocSchema.safeParse(next);
      if (!checked.success) {
        return { kind: "invalid", reason: "The laboratory record does not accept the value of the sheet." } as const;
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "sync.recordUpdated",
          actor: { kind: "sync" },
          entityType: "laboratory",
          entityId: record.recordId,
          changes,
          at: cause.at,
          context: { correlationId: cause.mappingId, causationId: cause.runId, depth: 1 },
        },
        db,
      );
      transaction.update(reference, {
        ...update,
        ...touchedFields(syncStamp(cause.at, cause.mappingId, cause.runId, auditEventId)),
      });
      return { kind: "written" } as const;
    });
  },
};

const EQUIPMENT_FIELDS = Object.keys(SYNC_TARGETS["core:equipment"].fields).filter(
  (field) => field !== "laboratoryName",
);

/** The first configuration of the chain that a configuration belongs to. */
function chainRoot(configurationId: string, supersedes: ReadonlyMap<string, string | null>): string {
  let current = configurationId;
  for (let step = 0; step < 1_000; step += 1) {
    const previous = supersedes.get(current) ?? null;
    if (previous === null) return current;
    current = previous;
  }
  return current;
}

/**
 * A chain of equipment configurations. A change from the sheet replaces the current
 * configuration exactly as `saveEquipmentConfiguration` does: the current one is closed and a
 * successor that names it opens, in one transaction with the audit entry.
 */
const equipment: TargetAdapter = {
  async load(db) {
    const [labs, configurations] = await Promise.all([
      db.collection(COLLECTIONS.laboratories.collectionPath()).get(),
      db.collectionGroup(COLLECTIONS.laboratoryEquipment.collectionId).get(),
    ]);
    const laboratoryOf = new Map(
      labs.docs.flatMap((document) => {
        const parsed = parseStoredDocument(laboratoryDocSchema, document.data());
        return parsed.success ? [[document.id, parsed.data] as const] : [];
      }),
    );
    const parsed = configurations.docs.flatMap((document) => {
      const data = parseStoredDocument(laboratoryEquipmentDocSchema, document.data());
      return data.success ? [{ id: document.id, data: data.data }] : [];
    });
    const supersedes = new Map(parsed.map((item) => [item.id, item.data.supersedesId]));
    return parsed.flatMap(({ id, data }): TargetRecord[] => {
      const laboratory = laboratoryOf.get(data.laboratoryId);
      if (!data.isCurrent || laboratory === undefined) return [];
      const root = chainRoot(id, supersedes);
      const values: Record<string, unknown> = { laboratoryName: laboratory.name };
      for (const field of EQUIPMENT_FIELDS) values[field] = (data as Record<string, unknown>)[field];
      return [
        {
          key: equipmentRowKey(laboratory.slug, root),
          recordId: nestedEntityId(data.laboratoryId, root),
          values,
          archived: data.archivedAt !== null || laboratory.archivedAt !== null,
          entityType: "equipmentConfiguration",
          entityId: nestedEntityId(data.laboratoryId, id),
          label: `${laboratory.name}, ${data.name}`,
        },
      ];
    });
  },

  async write(db, record, writes, cause) {
    if (writes.some((write) => write.field === "laboratoryName")) {
      return { kind: "invalid", reason: "The name of a laboratory is never taken from the equipment register." };
    }
    const [laboratoryId, currentId] = record.entityId.split("__");
    if (laboratoryId === undefined || currentId === undefined) return { kind: "stale" };
    const currentReference = db.doc(COLLECTIONS.laboratoryEquipment.docPath(laboratoryId, currentId));
    const successor = db.collection(COLLECTIONS.laboratoryEquipment.collectionPath(laboratoryId)).doc();
    return db.runTransaction(async (transaction: Transaction): Promise<WriteResult> => {
      const snapshot = await transaction.get(currentReference);
      const parsed = parseStoredDocument(laboratoryEquipmentDocSchema, snapshot.data());
      if (!parsed.success || !parsed.data.isCurrent || parsed.data.archivedAt !== null) return { kind: "stale" };
      const stored = parsed.data as Record<string, unknown>;
      if (writes.some((write) => canonicalOf("core:equipment", write.field, stored[write.field]) !== write.expected)) {
        return { kind: "stale" };
      }
      const next: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(stored)) {
        if (
          !["schemaVersion", "createdAt", "updatedAt", "createdBy", "updatedBy", "archivedAt", "writeContext"].includes(
            field,
          )
        ) {
          next[field] = value;
        }
      }
      const changes: AuditChange[] = [];
      for (const write of writes) {
        const value = appValue("core:equipment", write.field, write.canonical);
        if (value === undefined) delete next[write.field];
        else next[write.field] = value;
        if (!isDeepStrictEqual(stored[write.field], value)) {
          changes.push({ field: write.field, before: stored[write.field] ?? null, after: value ?? null });
        }
      }
      const now = Timestamp.fromDate(cause.at);
      const successorOf = (auditEventId: string) =>
        laboratoryEquipmentDocSchema.safeParse({
          ...next,
          ...createdFields("laboratoryEquipment", syncStamp(cause.at, cause.mappingId, cause.runId, auditEventId)),
          isCurrent: true,
          validFrom: now,
          validTo: null,
          supersedesId: currentId,
        });
      // Checked before anything is added to the transaction, so a refused value leaves no audit entry.
      if (!successorOf(cause.runId).success) {
        return { kind: "invalid", reason: "The equipment configuration does not accept the value of the sheet." };
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "sync.recordUpdated",
          actor: { kind: "sync" },
          entityType: "equipmentConfiguration",
          entityId: nestedEntityId(laboratoryId, successor.id),
          changes: [...changes, { field: "supersedesId", after: currentId }],
          at: cause.at,
          context: { correlationId: cause.mappingId, causationId: cause.runId, depth: 1 },
        },
        db,
      );
      const stamp = syncStamp(cause.at, cause.mappingId, cause.runId, auditEventId);
      const opened = successorOf(auditEventId);
      if (!opened.success) throw opened.error;
      transaction.update(currentReference, { isCurrent: false, validTo: now, ...touchedFields(stamp) });
      transaction.create(successor, opened.data);
      return { kind: "written" };
    });
  },
};

export const TARGET_ADAPTERS: Readonly<Record<SyncTargetKey, TargetAdapter>> = {
  "core:laboratories": laboratories,
  "core:equipment": equipment,
};
