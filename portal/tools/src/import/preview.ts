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
import { chunked, createdFields, entryOf, type RunContext, readDocuments, updatedFields, validated } from "./context";
import type { ImportPlan, PlannedItem, RecordedRow } from "./model";
import { type FieldConflict, mergeDocument, newDocument, type RemovedMembers } from "./ownership";
import type { ItemBuilders } from "./reconcile";
import { canonicalJson, contentHash, sameValue } from "./values";

export interface DocumentChange {
  readonly path: string;
  readonly collection: CollectionKey;
  /** `delete` only for the special-category cells of a row, once they stand in their own document. */
  readonly operation: "create" | "update" | "delete";
  /** `matched` for a document whose values stay and whose source records are brought up to date. */
  readonly relation: "created" | "updated" | "matched";
  readonly before: Record<string, unknown> | null;
  /** Null for a document that the change removes. */
  readonly after: Record<string, unknown> | null;
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
  // Only a value that every member may read is shown in the queue. A restricted or special-category value is
  // named by its field and its source record, and whoever may read the record reads it there.
  const guarded = entry.dataClass === "restricted" || entry.dataClass === "special";
  // The key of a guarded value covers the document and the field, so that two people with one value never
  // share a key and nobody can sort people by an equal value that the queue does not show.
  const keyed = (value: string) => (guarded ? `${path}\n${conflict.field}\n${value}` : value);
  const live =
    conflict.liveState === "differs" ? canonicalJson(conflict.liveValue) : `(${conflict.liveState})`;
  return items.valueConflict({
    subject: path,
    field: conflict.field,
    entityRefs: entityRef === null ? [] : [entityRef],
    personal: guarded,
    claims: [
      {
        source: conflict.liveOrigin,
        value: keyed(live),
        ...(guarded ? {} : { valueSource: conflict.liveState === "differs" ? display(conflict.liveValue) : live }),
        ...(conflict.liveSourceRecordId === undefined ? {} : { sourceRecordId: conflict.liveSourceRecordId }),
      },
      {
        source: sourceKey,
        value: keyed(canonicalJson(conflict.sourceValue)),
        ...(guarded ? {} : { valueSource: display(conflict.sourceValue) }),
        sourceRecordId: conflict.sourceRecordId,
      },
    ],
  });
}

/**
 * The members that an earlier import added to a list of a document and that the list no longer
 * holds: a person has removed them in the portal. The change log is the memory of what an import
 * added, so it is asked only for a document whose list lacks a planned member. A batch that was
 * rolled back added nothing that counts, and the log of a special-category document holds no value.
 */
async function removedMembers(
  context: RunContext,
  path: string,
  current: Readonly<Record<string, unknown>>,
  union: Readonly<Record<string, readonly unknown[]>>,
): Promise<RemovedMembers> {
  const missing = Object.entries(union).flatMap(([field, members]) => {
    const existing = Array.isArray(current[field]) ? (current[field] as unknown[]) : [];
    const absent = members.filter((member) => !existing.some((other) => sameValue(other, member)));
    return absent.length === 0 ? [] : [[field, absent] as const];
  });
  if (missing.length === 0) return {};
  const entries = await context.db.collectionGroup("changes").where("documentPath", "==", path).get();
  const batches = await readDocuments(
    context.db,
    [...new Set(entries.docs.map((entry) => COLLECTIONS.importBatches.docPath(String(entry.get("batchId")))))],
  );
  const counted = entries.docs.filter(
    (entry) =>
      batches.get(COLLECTIONS.importBatches.docPath(String(entry.get("batchId"))))?.data.status !== "rolledBack",
  );
  const removed: Record<string, unknown[]> = {};
  for (const [field, absent] of missing) {
    const added = absent.filter((member) =>
      counted.some((entry) => {
        const after = (entry.get("after") as Record<string, unknown> | null)?.[field];
        return Array.isArray(after) && after.some((other) => sameValue(other, member));
      }),
    );
    if (added.length > 0) removed[field] = added;
  }
  return removed;
}

/** The statuses with which the importer itself closes an item, and from which it may open one again. */
const CLOSED_BY_IMPORTER = new Set(["superseded", "cleared", "withdrawn"]);

/**
 * The earlier statements of a question that a planned item states more fully. Where every source
 * of a family states one question as far as it knows it, the first sources state it with fewer
 * candidates than the last. An open item with the key of a planned item, whose candidates are all
 * among those of the planned item, is such an earlier statement and is superseded, whichever
 * source raised it. An item with a candidate that the planned item lacks is left alone, so two
 * sources that state a question differently never close each other's items.
 */
async function containedStatements(
  context: RunContext,
  plannedItems: ReadonlyMap<string, PlannedItem>,
  itemChanges: readonly ItemChange[],
): Promise<ItemChange[]> {
  const fuller = new Map<string, PlannedItem[]>();
  for (const item of plannedItems.values()) {
    if (item.subjectKey === undefined) continue;
    fuller.set(item.subjectKey, [...(fuller.get(item.subjectKey) ?? []), item]);
  }
  const handled = new Set(itemChanges.map((change) => change.fingerprint));
  const itemEntry = entryOf("reconciliationItems");
  const superseded: ItemChange[] = [];
  for (const keys of chunked([...fuller.keys()].sort(), 30)) {
    const stored = await context.db
      .collection(COLLECTIONS.reconciliationItems.collectionPath())
      .where("subjectKey", "in", keys)
      .get();
    for (const doc of stored.docs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const data = doc.data();
      if (data.status !== "open" || plannedItems.has(doc.id) || handled.has(doc.id)) continue;
      const stated = new Set((data.candidates as { key: string }[]).map((candidate) => candidate.key));
      const contained = (fuller.get(String(data.subjectKey)) ?? []).some((item) => {
        const keys = new Set(item.candidates.map((candidate) => candidate.key));
        return keys.size > stated.size && [...stated].every((key) => keys.has(key));
      });
      if (!contained) continue;
      superseded.push({
        path: doc.ref.path,
        fingerprint: doc.id,
        kind: String(data.kind),
        action: "supersede",
        blocking: false,
        before: data,
        after: validated(itemEntry, doc.ref.path, {
          ...data,
          status: "superseded",
          resolvedBy: updatedFields(context.now).updatedBy,
          resolvedAt: context.now,
          ...updatedFields(context.now),
        }),
        sourceRecordIds: [],
        updateTime: doc.updateTime,
      });
    }
  }
  return superseded;
}

/**
 * The source of a claim that only proposes something to a reviewer, such as the study that an
 * unresolved identifier may mean. Nothing is ever written to a stored record on such a claim.
 */
export const PROPOSAL_PREFIX = "proposal/";

/**
 * The source of a claim that marks a study as one of several that a combined cell names. What
 * such a cell says of its row is never apportioned between the studies, so nothing is written to
 * one of them on its strength either.
 */
export const COMBINED_PREFIX = "combined/";

/** The roles of a membership that lead a replication. */
const LEAD_ROLES = new Set(["lead", "coLead"]);

/**
 * Lowers the confirmed leads of a replication to `needsReview` while a question about its lead is
 * open (docs/MIGRATION_PLAN.md, section 4.1): when claims for one study name different people or
 * a further person, every membership concerned is marked for review. Only a membership whose
 * confirmation an import wrote is lowered. One that a person has set since, and one whose
 * question a reviewer has decided, stands. No lead is chosen and none is removed.
 */
async function lowerQuestionedLeads(
  context: RunContext,
  plannedItems: ReadonlyMap<string, PlannedItem>,
  itemChanges: readonly ItemChange[],
  changes: DocumentChange[],
  ownRecordIds: ReadonlySet<string>,
): Promise<void> {
  const { db, now } = context;
  const closed = new Set(
    itemChanges.filter((change) => change.action === "supersede" || change.action === "clear").map((c) => c.path),
  );
  const opened = new Set(
    itemChanges.filter((change) => change.action === "raise" || change.action === "reopen").map((c) => c.path),
  );
  // A write to a stored membership needs a resolved identifier. A question that names its study by a proposal, that
  // rests on a cell which names several studies, or that concerns more than one replication lowers nothing.
  const questions = [...plannedItems.values()].filter(
    (item) =>
      item.kind === "conflictingLead" &&
      item.entityRefs.filter((ref) => ref.entityType === "replication").length === 1 &&
      !item.candidates.some(
        (candidate) => candidate.key.startsWith(PROPOSAL_PREFIX) || candidate.key.startsWith(COMBINED_PREFIX),
      ),
  );
  const standing = await readDocuments(
    db,
    questions.map((item) => COLLECTIONS.reconciliationItems.docPath(item.fingerprint)),
  );
  /** The record of this source behind the question of each replication, which is named as the supplier of the lowering. */
  const supplierOf = new Map<string, string>();
  for (const item of questions.sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1))) {
    const path = COLLECTIONS.reconciliationItems.docPath(item.fingerprint);
    const open = !closed.has(path) && (opened.has(path) || standing.get(path)?.data.status === "open");
    const supplier = item.candidates.find(
      (candidate) => candidate.sourceRecordId !== undefined && ownRecordIds.has(candidate.sourceRecordId),
    )?.sourceRecordId;
    if (!open || supplier === undefined) continue;
    for (const ref of item.entityRefs) {
      if (ref.entityType === "replication" && !supplierOf.has(ref.entityId)) supplierOf.set(ref.entityId, supplier);
    }
  }
  const entry = entryOf("replicationMemberships");
  /** The state of a membership with its confirmation lowered, or null where it is not one that an import confirmed. */
  const lower = (path: string, data: Record<string, unknown>, supplier: string): Record<string, unknown> | null => {
    const imported = (data.importedValues as Record<string, unknown> | undefined)?.reviewStatus;
    if (!LEAD_ROLES.has(String(data.role)) || data.reviewStatus !== "confirmed" || imported !== "confirmed")
      return null;
    return validated(entry, path, {
      ...data,
      reviewStatus: "needsReview",
      importedValues: { ...(data.importedValues as Record<string, unknown>), reviewStatus: "needsReview" },
      // The record behind the question is named for this one field. The membership itself comes from other rows.
      fieldSources: { ...(data.fieldSources as Record<string, string> | undefined), reviewStatus: supplier },
      ...updatedFields(now),
    });
  };
  for (const [replicationId, supplier] of [...supplierOf].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const memberships = await db.collection(COLLECTIONS.replicationMemberships.collectionPath(replicationId)).get();
    for (const doc of memberships.docs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const planned = changes.findIndex((change) => change.path === doc.ref.path);
      const change = changes[planned];
      if (change !== undefined) {
        // The plan writes the membership for another reason. Its confirmation is lowered in the same write.
        const after = change.after === null ? null : lower(change.path, change.after, supplier);
        if (after === null) continue;
        changes[planned] = {
          ...change,
          relation: "updated",
          after,
          changedFields: [...new Set([...change.changedFields, "reviewStatus"])],
        };
        continue;
      }
      const after = lower(doc.ref.path, doc.data(), supplier);
      if (after === null) continue;
      changes.push({
        path: doc.ref.path,
        collection: "replicationMemberships",
        operation: "update",
        relation: "updated",
        before: doc.data(),
        after,
        changedFields: ["reviewStatus"],
        // No row of the source stands behind the membership, so no row that goes takes the membership with it.
        sourceRecordIds: [],
        updateTime: doc.updateTime ?? null,
      });
    }
  }
}

export interface DiffOptions {
  readonly ownRecordIds: ReadonlySet<string>;
  readonly items: ItemBuilders;
  /** Whether the plan is complete. Only a complete plan closes items whose condition has gone. */
  readonly complete: boolean;
  /** The rows of the reading that carry special-category cells. */
  readonly specialRows?: readonly RecordedRow[];
}

/**
 * The changes to the special-category cells of rows (docs/MIGRATION_PLAN.md, section 10). The
 * cells of a row are kept beneath its source record, where no client reads them, only while the
 * row has no special-category document of its own: a row that waits in the queue. Once the plan
 * states such a document from the row, the cells stand there and the copy beneath the record is
 * removed in the same batch. Both are changes with a log entry, so a rollback reverses them, and
 * a preview writes neither.
 */
async function specialCellChanges(
  context: RunContext,
  plan: ImportPlan,
  rows: readonly RecordedRow[],
): Promise<DocumentChange[]> {
  const entry = entryOf("sourceRecordSpecial");
  const placed = new Set(
    plan.documents
      .filter((document) => entryOf(document.collection).dataClass === "special")
      .flatMap((document) => document.sourceRecordIds),
  );
  const stored = await readDocuments(
    context.db,
    rows.map((row) => entry.docPath(row.recordId)),
  );
  const changes: DocumentChange[] = [];
  for (const row of [...rows].sort((a, b) => (a.recordId < b.recordId ? -1 : 1))) {
    const path = entry.docPath(row.recordId);
    const current = stored.get(path) ?? null;
    const base = { path, collection: "sourceRecordSpecial" as const, changedFields: [], sourceRecordIds: [row.recordId] };
    if (placed.has(row.recordId)) {
      if (current === null) continue;
      changes.push({
        ...base,
        operation: "delete",
        relation: "updated",
        before: current.data,
        after: null,
        updateTime: current.updateTime,
      });
    } else if (current === null) {
      changes.push({
        ...base,
        operation: "create",
        relation: "created",
        before: null,
        after: validated(entry, path, {
          ...createdFields(context.now),
          schemaVersion: entry.schemaVersion,
          sourceRecordId: row.recordId,
          raw: { ...row.special },
        }),
        updateTime: null,
      });
    }
  }
  return changes;
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
      : mergeDocument(
          document,
          entry,
          current.data,
          merge,
          await removedMembers(context, document.path, current.data, document.union),
        );
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
        ...(item.subjectKey === undefined ? {} : { subjectKey: item.subjectKey }),
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

  if (options.complete) {
    for (const change of await containedStatements(context, plannedItems, itemChanges)) itemChanges.push(change);
    await lowerQuestionedLeads(context, plannedItems, itemChanges, changes, options.ownRecordIds);
    changes.push(...(await specialCellChanges(context, plan, options.specialRows ?? [])));
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
