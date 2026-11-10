// What portal/firestore.indexes.json must declare, derived from the catalogue of queries and
// from the collection registry. Firestore indexes every field of a collection by itself, so a
// declaration is needed in three cases only: a query on more than one field needs a composite
// index, a query across parents on one field needs that field indexed for the collection group,
// and a large or free-form field is exempted from indexing altogether (docs/DATA_MODEL.md,
// section 14).
import { COLLECTION_ENTRIES } from "@eegml/shared";
import type { CataloguedQuery, QueryShape } from "./queries";

type Order = "ASCENDING" | "DESCENDING";
type QueryScope = "COLLECTION" | "COLLECTION_GROUP";

export type IndexedField =
  | { readonly fieldPath: string; readonly order: Order }
  | { readonly fieldPath: string; readonly arrayConfig: "CONTAINS" };

export interface CompositeIndex {
  readonly collectionGroup: string;
  readonly queryScope: QueryScope;
  readonly fields: readonly IndexedField[];
}

export type FieldIndex =
  | { readonly order: Order; readonly queryScope: QueryScope }
  | { readonly arrayConfig: "CONTAINS"; readonly queryScope: QueryScope };

export interface FieldOverride {
  readonly collectionGroup: string;
  readonly fieldPath: string;
  readonly indexes: readonly FieldIndex[];
}

export interface IndexFile {
  readonly indexes: readonly CompositeIndex[];
  readonly fieldOverrides: readonly FieldOverride[];
}

/** The large and free-form fields that are never queried and are exempted from indexing. */
export const UNINDEXED_FIELDS: readonly string[] = [
  "raw",
  "before",
  "after",
  "changes",
  "snapshot",
  "update",
  "stateVector",
  "files",
  "values",
  "custom",
  "config",
  "evidence",
  "payload",
  "log",
  "parameters",
  "metrics",
  "bidsReport",
  "metadata",
  "citationMetadata",
  "managedSections",
  "description",
  "body",
  "textBody",
  "htmlBody",
];

const ARRAY_OPERATORS = ["array-contains", "array-contains-any"];
const EQUALITY_OPERATORS = ["==", "in"];

/** The fields a query touches, in the order an index lists them: equalities, the array field, then the sort. */
function indexedFieldsOf({ where, orderBy }: QueryShape): IndexedField[] {
  const fields: IndexedField[] = [];
  const add = (field: IndexedField) => {
    if (!fields.some((existing) => existing.fieldPath === field.fieldPath)) fields.push(field);
  };
  for (const [fieldPath, operator] of where) {
    if (EQUALITY_OPERATORS.includes(operator)) add({ fieldPath, order: "ASCENDING" });
  }
  for (const [fieldPath, operator] of where) {
    if (ARRAY_OPERATORS.includes(operator)) add({ fieldPath, arrayConfig: "CONTAINS" });
  }
  for (const [fieldPath, operator] of where) {
    if (!EQUALITY_OPERATORS.includes(operator) && !ARRAY_OPERATORS.includes(operator)) {
      add({ fieldPath, order: "ASCENDING" });
    }
  }
  for (const [fieldPath, direction] of orderBy) {
    add({ fieldPath, order: direction === "desc" ? "DESCENDING" : "ASCENDING" });
  }
  return fields;
}

const byText =
  <T>(textOf: (value: T) => string) =>
  (a: T, b: T) =>
    textOf(a).localeCompare(textOf(b), "en");

/** The composite indexes that the catalogued queries need: one for each query on more than one field. */
export function compositeIndexesFor(queries: readonly CataloguedQuery[]): CompositeIndex[] {
  const indexes = new Map<string, CompositeIndex>();
  for (const { shape } of queries) {
    const fields = indexedFieldsOf(shape);
    if (fields.length < 2) continue;
    const index: CompositeIndex = {
      collectionGroup: shape.collectionId,
      queryScope: shape.acrossParents ? "COLLECTION_GROUP" : "COLLECTION",
      fields,
    };
    indexes.set(JSON.stringify(index), index);
  }
  return [...indexes.values()].sort(byText((index) => JSON.stringify(index)));
}

/**
 * The fields that must be indexed for a collection group: those that a query across parents
 * constrains by themselves. An override replaces the automatic indexes of a field, so each one
 * repeats them and adds the index for the collection group.
 */
export function collectionGroupOverridesFor(queries: readonly CataloguedQuery[]): FieldOverride[] {
  const overrides = new Map<string, FieldOverride>();
  for (const { shape } of queries) {
    const fields = indexedFieldsOf(shape);
    const [only] = fields;
    if (!shape.acrossParents || fields.length !== 1 || only === undefined) continue;
    const automatic: FieldIndex[] = [
      { order: "ASCENDING", queryScope: "COLLECTION" },
      { order: "DESCENDING", queryScope: "COLLECTION" },
      { arrayConfig: "CONTAINS", queryScope: "COLLECTION" },
    ];
    const forGroup: FieldIndex =
      "arrayConfig" in only
        ? { arrayConfig: "CONTAINS", queryScope: "COLLECTION_GROUP" }
        : { order: "ASCENDING", queryScope: "COLLECTION_GROUP" };
    overrides.set(`${shape.collectionId} ${only.fieldPath}`, {
      collectionGroup: shape.collectionId,
      fieldPath: only.fieldPath,
      indexes: [...automatic, forGroup],
    });
  }
  return [...overrides.values()];
}

/** The exemptions: every large or free-form field of the entries whose rules are written. */
export function exemptionsFor(): FieldOverride[] {
  const exemptions = new Map<string, FieldOverride>();
  for (const entry of COLLECTION_ENTRIES) {
    if (entry.enforcement !== "enforced") continue;
    for (const fieldPath of Object.keys(entry.schema.shape)) {
      if (!UNINDEXED_FIELDS.includes(fieldPath)) continue;
      exemptions.set(`${entry.collectionId} ${fieldPath}`, {
        collectionGroup: entry.collectionId,
        fieldPath,
        indexes: [],
      });
    }
  }
  return [...exemptions.values()];
}

/** The whole index file that the catalogue and the registry call for. */
export function expectedIndexFile(queries: readonly CataloguedQuery[]): IndexFile {
  const overrides = [...collectionGroupOverridesFor(queries), ...exemptionsFor()];
  return {
    indexes: compositeIndexesFor(queries),
    fieldOverrides: overrides.sort(byText((override) => `${override.collectionGroup} ${override.fieldPath}`)),
  };
}
