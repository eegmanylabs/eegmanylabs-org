// The portal collections that a sheet can be mapped to, and the fields of each that a mapping
// may name (docs/INTEGRATIONS.md, section 3.3). A field missing here cannot be mapped, which is
// how a special-category value, a restricted value or an identifier stays out of every sheet.
import type { EntityType } from "../entities";
import type { SyncDirection } from "./planner";
import type { SyncFieldSpec } from "./values";

export interface SyncTargetField {
  readonly label: string;
  readonly spec: SyncFieldSpec;
  /**
   * Whether a sheet may change the field. A field the portal computes, such as the name of the
   * laboratory of an equipment configuration, is written to the sheet and never read back.
   */
  readonly writableFromSheet: boolean;
}

export interface SyncTarget {
  readonly label: string;
  readonly entityType: EntityType;
  /** What the key column holds, in words. */
  readonly keyDescription: string;
  readonly fields: Readonly<Record<string, SyncTargetField>>;
}

const text: SyncFieldSpec = { type: "text" };

/**
 * | Collection key       | A row is                                   | Its key                                   |
 * |----------------------|--------------------------------------------|-------------------------------------------|
 * | `core:laboratories`  | A laboratory                               | The laboratory's slug                     |
 * | `core:equipment`     | A chain of equipment configurations        | The laboratory's slug and the identifier of the first configuration of the chain, joined by a colon |
 *
 * An equipment configuration is never edited in place: a change closes the current
 * configuration and opens its successor (docs/DATA_MODEL.md, section 4). A row therefore stands
 * for the chain, whose key never changes, and a change from the sheet goes through the same
 * replacement as a change made in the portal.
 */
export const SYNC_TARGETS = {
  "core:laboratories": {
    label: "Laboratories",
    entityType: "laboratory",
    keyDescription: "The laboratory's slug",
    fields: {
      name: { label: "Name", spec: text, writableFromSheet: true },
      department: { label: "Department", spec: text, writableFromSheet: true },
      city: { label: "City", spec: text, writableFromSheet: true },
      website: { label: "Website", spec: { type: "link" }, writableFromSheet: true },
      description: { label: "Description", spec: text, writableFromSheet: true },
    },
  },
  "core:equipment": {
    label: "Equipment configurations",
    entityType: "equipmentConfiguration",
    keyDescription: "The laboratory's slug and the first configuration of the chain",
    fields: {
      laboratoryName: { label: "Laboratory", spec: text, writableFromSheet: false },
      name: { label: "Configuration", spec: text, writableFromSheet: true },
      amplifierManufacturer: { label: "Amplifier manufacturer", spec: text, writableFromSheet: true },
      amplifierModel: { label: "Amplifier model", spec: text, writableFromSheet: true },
      capType: { label: "Cap", spec: text, writableFromSheet: true },
      electrodeType: { label: "Electrodes", spec: text, writableFromSheet: true },
      channelCount: { label: "EEG channels", spec: { type: "number" }, writableFromSheet: true },
      samplingRatesHz: { label: "Sampling rates in hertz", spec: { type: "numberList" }, writableFromSheet: true },
      referenceScheme: { label: "Reference", spec: text, writableFromSheet: true },
      notes: { label: "Notes", spec: text, writableFromSheet: true },
    },
  },
} as const satisfies Readonly<Record<string, SyncTarget>>;

export type SyncTargetKey = keyof typeof SYNC_TARGETS;
export const SYNC_TARGET_KEYS = Object.keys(SYNC_TARGETS) as readonly SyncTargetKey[];

/**
 * A field of a target by its name, or undefined for a name the target does not list. The lookup
 * is of the target's own fields alone, so a name that every object inherits, such as
 * `constructor` or `__proto__`, is never taken for a field.
 */
export function syncTargetField(key: SyncTargetKey, name: string): SyncTargetField | undefined {
  const fields: Readonly<Record<string, SyncTargetField>> = SYNC_TARGETS[key].fields;
  return Object.hasOwn(fields, name) ? fields[name] : undefined;
}

export function isSyncTargetKey(value: string): value is SyncTargetKey {
  return Object.hasOwn(SYNC_TARGETS, value);
}

/** The directions a field may take: one the sheet may not change is written to the sheet only. */
export function allowedDirections(field: Pick<SyncTargetField, "writableFromSheet">): readonly SyncDirection[] {
  return field.writableFromSheet
    ? ["appAuthoritative", "sheetAuthoritative", "bidirectional", "generated"]
    : ["appAuthoritative", "generated"];
}

/** The key of the row of an equipment chain. */
export function equipmentRowKey(laboratorySlug: string, chainRootId: string): string {
  return `${laboratorySlug}:${chainRootId}`;
}

export interface MappingColumnInput {
  readonly field: string;
  readonly column: string;
  readonly direction: SyncDirection;
}

/**
 * What is wrong with the columns of a mapping, in words, or an empty list. A field the target
 * does not list, a direction the field cannot take, a field or a header named twice, and a
 * header equal to the key column are each refused.
 */
export function mappingProblems(
  collectionKey: string,
  keyColumn: string,
  columns: readonly MappingColumnInput[],
): readonly string[] {
  if (!isSyncTargetKey(collectionKey)) return [`The portal cannot synchronise ${collectionKey}.`];
  const target: SyncTarget = SYNC_TARGETS[collectionKey];
  const problems: string[] = [];
  const fold = (header: string) => header.trim().toLowerCase();
  const fields = new Set<string>();
  const headers = new Set<string>([fold(keyColumn)]);
  if (columns.length === 0) problems.push("A mapping names at least one field.");
  for (const column of columns) {
    const field = syncTargetField(collectionKey, column.field);
    if (field === undefined) {
      problems.push(`${target.label} have no field ${column.field} that a sheet may hold.`);
      continue;
    }
    if (!allowedDirections(field).includes(column.direction)) {
      problems.push(`${field.label} is computed by the portal, so a sheet cannot change it.`);
    }
    if (fields.has(column.field)) problems.push(`${field.label} is mapped twice.`);
    fields.add(column.field);
    if (headers.has(fold(column.column))) problems.push(`The column "${column.column}" is named twice.`);
    headers.add(fold(column.column));
  }
  return problems;
}
