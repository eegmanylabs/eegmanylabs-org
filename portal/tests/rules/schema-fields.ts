// What the schema of a registry entry says about its fields, for the tests that compare the
// rules with the schemas.
import {
  APPEND_ONLY_BASE_FIELDS,
  type CollectionEntry,
  DOCUMENT_BASE_FIELDS,
  PROVENANCE_FIELDS,
  type z,
} from "@eegml/shared";

/** The standard fields of the documents of an entry: the shorter set for an append-only collection. */
export function standardFieldsOf(entry: CollectionEntry): readonly string[] {
  return entry.flags.appendOnly ? APPEND_ONLY_BASE_FIELDS : DOCUMENT_BASE_FIELDS;
}

/** The fields that only an importer sets: the provenance of a record, and the one source record of an entity. */
export const IMPORT_ONLY_FIELDS: readonly string[] = [...PROVENANCE_FIELDS, "sourceRecordId"];

function mayBeAbsent(field: z.ZodType): boolean {
  // A field that may be absent, even where it refuses an explicit undefined.
  return field.safeParse(undefined).success || (field as { def?: { type?: string } }).def?.type === "optional";
}

export interface FieldSets {
  /** Every field of the schema that is no standard field. */
  readonly own: readonly string[];
  /** The fields a client may set when it creates a document: its own fields without those of the importers. */
  readonly settable: readonly string[];
  /** Those of the settable fields that every document must hold. */
  readonly required: readonly string[];
  /** The fields of the importers that the schema declares. */
  readonly importOnly: readonly string[];
}

export function fieldSetsOf(entry: CollectionEntry): FieldSets {
  const shape = entry.schema.shape as Record<string, z.ZodType>;
  const standard = new Set(standardFieldsOf(entry));
  const own = Object.keys(shape).filter((field) => !standard.has(field));
  const settable = own.filter((field) => !IMPORT_ONLY_FIELDS.includes(field));
  return {
    own,
    settable,
    required: settable.filter((field) => {
      const declared = shape[field];
      return declared !== undefined && !mayBeAbsent(declared);
    }),
    importOnly: own.filter((field) => IMPORT_ONLY_FIELDS.includes(field)),
  };
}
