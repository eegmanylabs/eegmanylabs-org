// The preview stage (docs/MIGRATION_PLAN.md, section 6): compares a plan with the database and
// says what an apply would write. Nothing is written here. For every planned document the diff
// holds the complete state before and after, and for every item what would happen to it.
import {
  COLLECTIONS,
  type CollectionKey,
  ENTITY_COLLECTIONS,
  type EntityRef,
  type EntityType,
  nestedEntityId,
} from "@eegml/shared";
import type { Timestamp } from "firebase-admin/firestore";
import { createdFields, entryOf, type RunContext, readDocuments, updatedFields, validated } from "./context";
import type { ImportPlan, PlannedItem } from "./model";
import { type FieldConflict, mergeDocument, newDocument } from "./ownership";
import type { ItemBuilders } from "./reconcile";
import { canonicalJson, contentHash, sameValue } from "./values";

export interface DocumentChange {
  readonly path: string;
  readonly collection: CollectionKey;
  readonly operation: "create" | "update";
  /** `matched` for a document whose values stay and whose source records are brought up to date. */
  readonly relation: "created" | "updated" | "matched";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown>;
  /** The fields whose values change. Their values are never printed. */
  readonly changedFields: readonly string[];
  readonly sourceRecordIds: readonly string[];
  /** When the stored document was last written, which the apply names as its precondition. */
  readonly updateTime: Timestamp | null;
}

/**
 * | Action      | What happens to the item                                                    |
 * |-------------|-----------------------------------------------------------------------------|
 * | `raise`     | It is created, open                                                         |
 * | `reopen`    | The importer had closed it, the condition holds again, and it is opened     |
 * | `supersede` | It is open and its values have changed in the source: a new item replaces it |
 * | `clear`     | It is open and its condition has disappeared from the source                |
 *
 * An item that a reviewer has resolved or dismissed is never touched.
 */
export type ItemAction = "raise" | "reopen" | "supersede" | "clear";

export interface ItemChange {
  readonly path: string;
  readonly fingerprint: string;
  readonly kind: string;
  readonly action: ItemAction;
  readonly blocking: boolean;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown>;
  readonly sourceRecordIds: readonly string[];
  readonly updateTime: Timestamp | null;
}

export interface PlanDiff {
  readonly changes: readonly DocumentChange[];
  /** The number of planned documents that exist and need no write, by collection. */
  readonly unchanged: ReadonlyMap<CollectionKey, number>;
  readonly itemChanges: readonly ItemChange[];
  /** Planned items that exist already, whatever their status. */
  readonly itemsStanding: number;
  /** Fields that the import leaves alone because the live value differs from the source. */
  readonly conflicts: number;
  /** A hash of what would be written, by which an apply is matched to a preview. */
  readonly planHash: string;
}

const ENTITY_TYPE_OF = new Map<string, EntityType>(
  (Object.entries(ENTITY_COLLECTIONS) as [EntityType, CollectionKey][]).map(([type, collection]) => [collection, type]),
);

/** The entity that a document is, or the nearest entity above it. Null for a document that belongs to none. */
export function entityRefOf(collection: CollectionKey, ids: readonly string[]): EntityRef | null {
  let entry = entryOf(collection);
  let own = [...ids];
  for (;;) {
    const entityType = ENTITY_TYPE_OF.get(entry.key);
    const [first, second] = own;
    if (entityType !== undefined && first !== undefined) {
      return {
        entityType,
        entityId: second === undefined ? first : nestedEntityId(own.slice(0, -1).join("__"), own.at(-1) ?? ""),
      };
    }
    if (entry.parent === null) return null;
    entry = entryOf(entry.parent as CollectionKey);
    own = own.slice(0, entry.path.split("/").filter((part) => part.startsWith("{")).length);
  }
}

/** The text of a value as a reviewer reads it. */
const display = (value: unknown): string => (typeof value === "string" ? value : canonicalJson(value));

function conflictItem(
  items: ItemBuilders,
  sourceKey: string,
  collection: CollectionKey,
  ids: readonly string[],
  path: string,
  conflict: FieldConflict,
): PlannedItem {
  const entry = entryOf(collection);
  const entityRef = entityRefOf(collection, ids);
  // A conflict in a special-category field names the field and the source records only.
  const shown = entry.dataClass !== "special";
  return items.valueConflict({
    subject: path,
    field: conflict.field,
    entityRefs: entityRef === null ? [] : [entityRef],
    personal: entry.dataClass === "restricted" || entry.dataClass === "special",
    claims: [
      {
        source: conflict.liveOrigin,
        value: canonicalJson(conflict.liveValue),
        ...(shown ? { valueSource: display(conflict.liveValue) } : {}),
        ...(conflict.liveSourceRecordId === undefined ? {} : { sourceRecordId: conflict.liveSourceRecordId }),
      },
      {
        source: sourceKey,
        value: canonicalJson(conflict.sourceValue),
        ...(shown ? { valueSource: display(conflict.sourceValue) } : {}),
        sourceRecordId: conflict.sourceRecordId,
      },
    ],
  });
}

/** The statuses with which the importer itself closes an item, and from which it may open one again. */
const CLOSED_BY_IMPORTER = new Set(["superseded", "cleared", "withdrawn"]);

export interface DiffOptions {
  readonly ownRecordIds: ReadonlySet<string>;
  readonly items: ItemBuilders;
  /** Whether the plan is complete. Only a complete plan closes items whose condition has gone. */
  readonly complete: boolean;
}

export async function comparePlan(context: RunContext, plan: ImportPlan, options: DiffOptions): Promise<PlanDiff> {
  const { db, sourceKey, batchId, now } = context;
  const merge = { ownRecordIds: options.ownRecordIds, created: createdFields(now), updated: updatedFields(now) };
  const stored = await readDocuments(
    db,
    plan.documents.map((document) => document.path),
  );
  const changes: DocumentChange[] = [];
  const unchanged = new Map<CollectionKey, number>();
  const plannedItems = new Map(plan.items.map((item) => [item.fingerprint, item]));
  let conflicts = 0;

  for (const document of plan.documents) {
    const entry = entryOf(document.collection);
    const current = stored.get(document.path) ?? null;
    if (current === null) {
      const after = validated(entry, document.path, newDocument(document, entry, merge));
      changes.push({
        path: document.path,
        collection: document.collection,
        operation: "create",
        relation: "created",
        before: null,
        after,
        changedFields: Object.keys(after).filter(
          (field) => field in document.owned || field in document.union || field in document.fixed,
        ),
        sourceRecordIds: document.sourceRecordIds,
        updateTime: null,
      });
      continue;
    }
    const merged = entry.flags.appendOnly
      ? { data: null, changedFields: [], conflicts: [] }
      : mergeDocument(document, entry, current.data, merge);
    for (const conflict of merged.conflicts) {
      const item = conflictItem(options.items, sourceKey, document.collection, document.ids, document.path, conflict);
      plannedItems.set(item.fingerprint, item);
      conflicts += 1;
    }
    if (merged.data === null) {
      unchanged.set(document.collection, (unchanged.get(document.collection) ?? 0) + 1);
      continue;
    }
    changes.push({
      path: document.path,
      collection: document.collection,
      operation: "update",
      relation: merged.changedFields.length > 0 ? "updated" : "matched",
      before: current.data,
      after: validated(entry, document.path, merged.data),
      changedFields: merged.changedFields,
      sourceRecordIds: document.sourceRecordIds,
      updateTime: current.updateTime,
    });
  }

  // Items: raise what is new, open again what the importer had closed, and close what no longer holds.
  const itemEntry = entryOf("reconciliationItems");
  const itemPath = (fingerprint: string) => COLLECTIONS.reconciliationItems.docPath(fingerprint);
  const existing = await readDocuments(db, [...plannedItems.keys()].map(itemPath));
  const itemChanges: ItemChange[] = [];
  let itemsStanding = 0;
  for (const item of [...plannedItems.values()].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1))) {
    const path = itemPath(item.fingerprint);
    const current = existing.get(path) ?? null;
    const recordIds = item.candidates.flatMap((candidate) =>
      candidate.sourceRecordId === undefined ? [] : [candidate.sourceRecordId],
    );
    if (current === null) {
      const after = validated(itemEntry, path, {
        ...createdFields(now),
        schemaVersion: itemEntry.schemaVersion,
        kind: item.kind,
        entityRefs: item.entityRefs,
        sourceKey,
        ...(item.field === undefined ? {} : { field: item.field }),
        candidates: item.candidates,
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
        batchId,
      });
      itemChanges.push({
        path,
        fingerprint: item.fingerprint,
        kind: item.kind,
        action: "raise",
        blocking: item.blocking,
        before: null,
        after,
        sourceRecordIds: recordIds,
        updateTime: null,
      });
    } else if (CLOSED_BY_IMPORTER.has(String(current.data.status))) {
      const after = validated(itemEntry, path, {
        ...current.data,
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
        batchId,
        ...updatedFields(now),
      });
      itemChanges.push({
        path,
        fingerprint: item.fingerprint,
        kind: item.kind,
        action: "reopen",
        blocking: item.blocking,
        before: current.data,
        after,
        sourceRecordIds: recordIds,
        updateTime: current.updateTime,
      });
    } else {
      itemsStanding += 1;
    }
  }
  if (options.complete) {
    const open = await db
      .collection(COLLECTIONS.reconciliationItems.collectionPath())
      .where("sourceKey", "==", sourceKey)
      .where("status", "==", "open")
      .get();
    const about = (item: { kind: unknown; entityRefs: unknown; field?: unknown }) =>
      canonicalJson([item.kind, item.entityRefs, item.field ?? null]);
    const plannedSubjects = new Set([...plannedItems.values()].map(about));
    for (const doc of open.docs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (plannedItems.has(doc.id)) continue;
      const data = doc.data();
      // A new item about the same thing means that the value has changed. Otherwise the condition has gone.
      const action: ItemAction = plannedSubjects.has(
        about(data as { kind: unknown; entityRefs: unknown; field?: unknown }),
      )
        ? "supersede"
        : "clear";
      const after = validated(itemEntry, doc.ref.path, {
        ...data,
        status: action === "supersede" ? "superseded" : "cleared",
        resolvedBy: updatedFields(now).updatedBy,
        resolvedAt: now,
        ...updatedFields(now),
      });
      itemChanges.push({
        path: doc.ref.path,
        fingerprint: doc.id,
        kind: String(data.kind),
        action,
        blocking: false,
        before: data,
        after,
        sourceRecordIds: [],
        updateTime: doc.updateTime,
      });
    }
  }

  const planHash = contentHash({
    documents: changes.map((change) => [change.path, change.operation, [...change.changedFields].sort()]),
    items: itemChanges.map((change) => [change.fingerprint, change.action]),
  });
  return { changes, unchanged, itemChanges, itemsStanding, conflicts, planHash };
}

/** The top-level fields that differ between two states of a document, with null for a field that is removed. */
export function changedTopLevelFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Map<string, unknown> {
  const patch = new Map<string, unknown>();
  for (const [field, value] of Object.entries(after)) if (!sameValue(before[field], value)) patch.set(field, value);
  for (const field of Object.keys(before)) if (!(field in after)) patch.set(field, undefined);
  return patch;
}
