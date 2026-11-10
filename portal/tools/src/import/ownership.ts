// Ownership of fields (docs/MIGRATION_PLAN.md, section 6, and docs/DATA_MODEL.md, section 1).
//
// An importer may set a field only while the field is empty or still holds the value that the
// same source wrote last time. The document itself keeps what is needed to tell: `importedValues`
// holds the value last imported for each field, and `fieldSources` names the source record that
// supplied it. A field that a person has edited in the portal, or that another source supplied,
// is left alone, the new source value is recorded beside it, and a conflict is reported for
// review. Nothing here chooses between two values.
//
// What a person has taken away stays away. A field that an import had set and that is absent now
// was cleared in the portal: it is not filled again, and the source value is queued beside it. A
// member of a list that an import had added and that is gone now was removed in the portal: it
// is not added again. The caller says which members those are, because the memory of what an
// import added to a list is the change log and not the document.
import type { CollectionEntry } from "@eegml/shared";
import type { PlannedDocument } from "./model";
import { distinct, sameValue } from "./values";

/**
 * | State           | What the portal holds                                                    |
 * |-----------------|--------------------------------------------------------------------------|
 * | `differs`       | Another value than the source states                                     |
 * | `cleared`       | Nothing, although an import had set the field: a person has cleared it   |
 * | `memberRemoved` | The list without a member that an import had added: a person removed it  |
 */
export type LiveState = "differs" | "cleared" | "memberRemoved";

/** A field whose live value differs from what the source says, and which the import therefore leaves alone. */
export interface FieldConflict {
  readonly field: string;
  readonly liveState: LiveState;
  /** The live value. Undefined for a field that was cleared and for a member that was removed. */
  readonly liveValue: unknown;
  /** `portal` for a value that was edited there, `otherSource` for one that another source supplied. */
  readonly liveOrigin: "portal" | "otherSource";
  /** The source record behind the live value, where another source supplied it. */
  readonly liveSourceRecordId?: string;
  readonly sourceValue: unknown;
  readonly sourceRecordId: string;
}

export interface MergeResult {
  /** The complete document to write, or null when nothing changes. */
  readonly data: Record<string, unknown> | null;
  /** The fields of the document that the write changes, standard and provenance fields left out. */
  readonly changedFields: readonly string[];
  readonly conflicts: readonly FieldConflict[];
}

export interface MergeContext {
  /** Every source record of the importing source, earlier revisions included. */
  readonly ownRecordIds: ReadonlySet<string>;
  /** The standard fields of a new document. */
  readonly created: Readonly<Record<string, unknown>>;
  /** The standard fields that every update sets. */
  readonly updated: Readonly<Record<string, unknown>>;
}

const withoutUndefined = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

/** Whether the documents of a collection carry the provenance fields of an imported record. */
export function carriesProvenance(entry: CollectionEntry): boolean {
  return "sourceRecordIds" in entry.schema.shape && "importedValues" in entry.schema.shape;
}

/** The document that a plan creates where none exists. */
export function newDocument(
  spec: PlannedDocument,
  entry: CollectionEntry,
  context: MergeContext,
): Record<string, unknown> {
  const owned = withoutUndefined(spec.owned);
  const data: Record<string, unknown> = {
    ...context.created,
    schemaVersion: entry.schemaVersion,
    ...withoutUndefined(spec.fixed),
    ...owned,
  };
  for (const [field, members] of Object.entries(spec.union)) data[field] = [...members];
  if (carriesProvenance(entry)) {
    data.sourceRecordIds = [...spec.sourceRecordIds].sort();
    if (Object.keys(owned).length > 0) {
      data.importedValues = owned;
      data.fieldSources = Object.fromEntries(
        Object.keys(owned).map((field) => [field, spec.fieldSources[field] ?? ""]),
      );
    }
  }
  return data;
}

/** The members of the lists of one document that a person has removed in the portal, by field. */
export type RemovedMembers = Readonly<Record<string, readonly unknown[]>>;

/**
 * Compares a planned document with the stored one and says what an import may write. `removed`
 * names the members that an earlier import added to a list of the document and that a person
 * has taken out since. They are not added again.
 */
export function mergeDocument(
  spec: PlannedDocument,
  entry: CollectionEntry,
  current: Readonly<Record<string, unknown>>,
  context: MergeContext,
  removed: RemovedMembers = {},
): MergeResult {
  const next: Record<string, unknown> = { ...current };
  const tracked = carriesProvenance(entry);
  const importedValues: Record<string, unknown> = { ...((current.importedValues as Record<string, unknown>) ?? {}) };
  const fieldSources: Record<string, string> = { ...((current.fieldSources as Record<string, string>) ?? {}) };
  const changedFields: string[] = [];
  const conflicts: FieldConflict[] = [];
  let provenanceChanged = false;

  const record = (field: string, value: unknown, supplier: string) => {
    if (!tracked) return;
    if (!sameValue(importedValues[field], value) || fieldSources[field] !== supplier) provenanceChanged = true;
    importedValues[field] = value;
    fieldSources[field] = supplier;
  };

  for (const [field, desired] of Object.entries(spec.owned)) {
    const live = current[field];
    const supplier = spec.fieldSources[field] ?? "";
    const liveSupplier = fieldSources[field];
    const mine = liveSupplier !== undefined && context.ownRecordIds.has(liveSupplier);
    if (live === undefined && field in importedValues) {
      // An import had set the field and it is absent now: a person has cleared it. It stays cleared.
      if (desired === undefined) continue;
      if (!spec.silent.includes(field)) {
        conflicts.push({
          field,
          liveState: "cleared",
          liveValue: undefined,
          liveOrigin: "portal",
          sourceValue: desired,
          sourceRecordId: supplier,
        });
      }
      if (mine || liveSupplier === undefined) record(field, desired, supplier);
    } else if (live === undefined) {
      // Never set: the import may fill it.
      if (desired === undefined) continue;
      next[field] = desired;
      changedFields.push(field);
      record(field, desired, supplier);
    } else if (mine && sameValue(live, importedValues[field])) {
      // Still what this source wrote last time: the field follows the source.
      if (desired === undefined) {
        delete next[field];
        delete importedValues[field];
        delete fieldSources[field];
        changedFields.push(field);
        provenanceChanged = true;
      } else {
        if (!sameValue(desired, live)) {
          next[field] = desired;
          changedFields.push(field);
        }
        record(field, desired, supplier);
      }
    } else {
      // Edited in the portal since, or supplied by another source: the field is left alone.
      if (desired !== undefined && !sameValue(desired, live) && !spec.silent.includes(field)) {
        conflicts.push({
          field,
          liveState: "differs",
          liveValue: live,
          liveOrigin: mine || liveSupplier === undefined ? "portal" : "otherSource",
          ...(mine || liveSupplier === undefined ? {} : { liveSourceRecordId: liveSupplier }),
          sourceValue: desired,
          sourceRecordId: supplier,
        });
      }
      // The new source value is recorded beside the live one, unless another source owns the field.
      if (desired !== undefined && (mine || liveSupplier === undefined)) record(field, desired, supplier);
    }
  }

  for (const [field, members] of Object.entries(spec.union)) {
    const existing = Array.isArray(current[field]) ? (current[field] as unknown[]) : [];
    const taken = removed[field] ?? [];
    const gone = (member: unknown) => taken.some((other) => sameValue(other, member));
    for (const member of distinct(members.filter(gone))) {
      conflicts.push({
        field,
        liveState: "memberRemoved",
        liveValue: undefined,
        liveOrigin: "portal",
        sourceValue: member,
        sourceRecordId: spec.sourceRecordIds[0] ?? "",
      });
    }
    const joined = distinct([...existing, ...members.filter((member) => !gone(member))]);
    if (joined.length !== existing.length) {
      next[field] = joined;
      changedFields.push(field);
    }
  }

  if (tracked) {
    const existing = Array.isArray(current.sourceRecordIds) ? (current.sourceRecordIds as string[]) : [];
    // An earlier revision of a row of this source gives way to the current one. Other sources keep theirs.
    const kept = existing.filter((id) => !context.ownRecordIds.has(id) || spec.sourceRecordIds.includes(id));
    // The list is kept in one order, so that the order in which rows, tabs or sources are read changes nothing.
    const joined = distinct([...kept, ...spec.sourceRecordIds]).sort();
    if (!sameValue(joined, existing)) {
      next.sourceRecordIds = joined;
      provenanceChanged = true;
    }
    if (provenanceChanged) {
      if (Object.keys(importedValues).length > 0) next.importedValues = importedValues;
      else delete next.importedValues;
      if (Object.keys(fieldSources).length > 0) next.fieldSources = fieldSources;
      else delete next.fieldSources;
    }
  }

  if (changedFields.length === 0 && !provenanceChanged) return { data: null, changedFields, conflicts };
  return { data: { ...next, ...context.updated }, changedFields, conflicts };
}
