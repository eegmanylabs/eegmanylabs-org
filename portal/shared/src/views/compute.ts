// The view engine: from the records of a collection and the configuration of a view to what the
// view shows (D-011, docs/DATA_MODEL.md, section 15). It derives the computed properties
// (rollups over relations and backlinks, formulas, and the record of creation and change),
// then searches, filters, sorts and groups, all in the browser over what the reader may load.

import { matchesFilter } from "./filter";
import {
  type CompiledFormula,
  compileFormula,
  evaluateFormula,
  FormulaError,
  type FormulaValue,
  formatFormulaDate,
  isFormulaDate,
  parseFormulaDate,
} from "./formula";
import {
  type CollectionData,
  isDateRange,
  isEmptyValue,
  type PropertyValue,
  type RecordReference,
  type RollupFunction,
  type ViewConfig,
  type ViewGrouping,
  type ViewProperty,
  type ViewRecord,
  type ViewScope,
  type ViewSort,
} from "./model";
import {
  addDays,
  dayOfValue,
  displayText,
  type EngineContext,
  foldText,
  formatDate,
  monthName,
  optionName,
  recordsByReference,
  referenceKey,
  referenceTitle,
} from "./values";

/** A record with its computed values, and the error of each computed value that failed. */
export interface DerivedRecord extends ViewRecord {
  readonly errors: Readonly<Record<string, string>>;
}

// ===== Rollups =====

const backlinkIndexes = new WeakMap<CollectionData, Map<string, ReadonlyMap<string, readonly ViewRecord[]>>>();

/** The records of a collection by the references that one of their relation properties holds. */
function backlinkIndex(collection: CollectionData, property: string): ReadonlyMap<string, readonly ViewRecord[]> {
  let byProperty = backlinkIndexes.get(collection);
  if (byProperty === undefined) {
    byProperty = new Map();
    backlinkIndexes.set(collection, byProperty);
  }
  const cached = byProperty.get(property);
  if (cached !== undefined) return cached;
  const index = new Map<string, ViewRecord[]>();
  for (const record of collection.records) {
    const value = record.values[property];
    if (!Array.isArray(value)) continue;
    for (const reference of value as readonly RecordReference[]) {
      if (typeof reference !== "object" || reference === null) continue;
      const key = referenceKey(reference);
      const list = index.get(key) ?? [];
      list.push(record);
      index.set(key, list);
    }
  }
  byProperty.set(property, index);
  return index;
}

/** The value a rollup reads from a related record: a stored value, or the record of its creation and change. */
function storedValue(record: ViewRecord, property: ViewProperty | undefined): PropertyValue {
  if (property === undefined) return null;
  switch (property.type) {
    case "createdTime":
      return record.createdAt;
    case "editedTime":
      return record.updatedAt;
    case "createdBy":
      return record.createdBy;
    case "editedBy":
      return record.updatedBy;
    default:
      return record.values[property.id] ?? null;
  }
}

/** The single values of a list of values: the elements of a list count one by one. */
function flatten(values: readonly PropertyValue[]): PropertyValue[] {
  return values.flatMap((value) => (Array.isArray(value) ? (value as PropertyValue[]) : [value]));
}

function timeOf(value: PropertyValue): { readonly time: number; readonly text: string } | null {
  if (typeof value === "string") {
    const parsed = parseFormulaDate(value);
    return parsed === null ? null : { time: parsed.time, text: value };
  }
  return null;
}

/**
 * Applies a rollup function to the values of the related records. `count` counts the records
 * themselves. A function over numbers, booleans or dates gives null, which is unknown, where
 * none of the values is of its kind: no value is ever counted as zero.
 */
export function applyRollup(fn: RollupFunction, values: readonly PropertyValue[], recordCount: number): PropertyValue {
  const singles = flatten(values).filter((value) => !isEmptyValue(value));
  switch (fn) {
    case "count":
      return recordCount;
    case "countValues":
      return singles.length;
    case "sum":
    case "average":
    case "min":
    case "max": {
      const numbers = singles.filter((value): value is number => typeof value === "number");
      if (numbers.length === 0) return null;
      if (fn === "sum") return numbers.reduce((total, value) => total + value, 0);
      if (fn === "average") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
      return fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
    }
    case "percentChecked": {
      const booleans = flatten(values).filter((value): value is boolean => typeof value === "boolean");
      if (booleans.length === 0) return null;
      return (booleans.filter(Boolean).length / booleans.length) * 100;
    }
    case "earliest":
    case "latest": {
      const dates = singles
        .flatMap((value) => (isDateRange(value) ? [value.start, value.end] : [value]))
        .map((value) => timeOf(value as PropertyValue))
        .filter((value): value is { time: number; text: string } => value !== null);
      if (dates.length === 0) return null;
      const chosen = dates.reduce((best, value) =>
        fn === "earliest" ? (value.time < best.time ? value : best) : value.time > best.time ? value : best,
      );
      return chosen.text;
    }
    case "showValues":
      return singles.length === 0
        ? null
        : (singles.map((value) => (typeof value === "object" && value !== null ? JSON.stringify(value) : value)) as (
            | string
            | number
            | boolean
          )[]);
  }
}

/** The related records of a rollup and the collection they belong to. */
function rollupTargets(
  property: ViewProperty,
  record: ViewRecord,
  propertiesById: ReadonlyMap<string, ViewProperty>,
  context: EngineContext,
): { readonly collection: CollectionData; readonly records: readonly ViewRecord[] } | null {
  const rollup = property.config.rollup;
  if (rollup === undefined) return null;
  if ("relation" in rollup.source) {
    const relation = propertiesById.get(rollup.source.relation);
    const target = relation?.config.relation?.target;
    const collection = target === undefined ? undefined : context.collections.get(target);
    if (collection === undefined) return null;
    const references = record.values[rollup.source.relation];
    const index = recordsByReference(collection);
    const records = Array.isArray(references)
      ? (references as readonly RecordReference[])
          .map((reference) => index.get(referenceKey(reference)))
          .filter((related): related is ViewRecord => related !== undefined)
      : [];
    return { collection, records };
  }
  const collection = context.collections.get(rollup.source.backlink.collection);
  if (collection === undefined) return null;
  return {
    collection,
    records: backlinkIndex(collection, rollup.source.backlink.property).get(referenceKey(record.reference)) ?? [],
  };
}

function computeRollup(
  property: ViewProperty,
  record: ViewRecord,
  propertiesById: ReadonlyMap<string, ViewProperty>,
  context: EngineContext,
): PropertyValue {
  const rollup = property.config.rollup;
  const targets = rollupTargets(property, record, propertiesById, context);
  if (rollup === undefined || targets === null) return null;
  const targetProperty = targets.collection.properties.find((candidate) => candidate.id === rollup.property);
  const values = targets.records.map((related) => storedValue(related, targetProperty));
  if (rollup.function === "showValues" && targetProperty !== undefined) {
    const texts = values
      .filter((value) => !isEmptyValue(value))
      .map((value) => displayText(targetProperty, value, context));
    return texts.length === 0 ? null : texts;
  }
  return applyRollup(rollup.function, values, targets.records.length);
}

// ===== Formulas =====

/** A value of a property as a formula sees it. */
export function toFormulaValue(property: ViewProperty, value: PropertyValue, context: EngineContext): FormulaValue {
  if (value === null) return null;
  switch (property.type) {
    case "select":
    case "status":
      return typeof value === "string" ? optionName(property, value) : null;
    case "multiSelect":
      return Array.isArray(value) ? value.map((id) => optionName(property, String(id))) : null;
    case "person":
    case "createdBy":
    case "editedBy": {
      const uids = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
      const names = uids.map((uid) => context.personName(uid) ?? uid);
      return property.type === "person" ? names : (names[0] ?? null);
    }
    case "relation":
      return Array.isArray(value)
        ? (value as readonly RecordReference[]).map((reference) =>
            referenceTitle(reference, property.config.relation?.target, context),
          )
        : null;
    case "file":
      return displayText(property, value, context)
        .split(", ")
        .filter((name) => name !== "");
    case "date":
    case "createdTime":
    case "editedTime":
      return typeof value === "string" ? parseFormulaDate(value) : null;
    case "dateRange":
      return isDateRange(value) && value.start !== null ? parseFormulaDate(value.start) : null;
    default:
      break;
  }
  if (typeof value === "string") {
    if (property.type === "formula" || property.type === "rollup") return parseFormulaDate(value) ?? value;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value.map((element) => (typeof element === "object" ? JSON.stringify(element) : element));
  return null;
}

/** The stored form of what a formula gives. */
export function fromFormulaValue(value: FormulaValue): PropertyValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (isFormulaDate(value)) return formatFormulaDate(value);
  return (value as readonly FormulaValue[]).map((element) =>
    element === null
      ? ""
      : typeof element === "object"
        ? isFormulaDate(element)
          ? formatFormulaDate(element)
          : JSON.stringify(element)
        : element,
  );
}

const compiledFormulas = new Map<string, CompiledFormula | FormulaError>();

/** A formula, parsed once for every record and every view that uses it. */
export function compiledFormula(expression: string): CompiledFormula | FormulaError {
  const cached = compiledFormulas.get(expression);
  if (cached !== undefined) return cached;
  let compiled: CompiledFormula | FormulaError;
  try {
    compiled = compileFormula(expression);
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    compiled = error;
  }
  if (compiledFormulas.size > 500) compiledFormulas.clear();
  compiledFormulas.set(expression, compiled);
  return compiled;
}

// ===== Deriving the computed values =====

/**
 * Computes the rollups, formulas and the record of creation and change of every record. A
 * formula may use another formula and a rollup; a formula that comes back to itself is an error
 * of each record, and so is one that fails on a record.
 */
export function deriveRecords(collection: CollectionData, context: EngineContext): DerivedRecord[] {
  const properties = collection.properties;
  const byId = new Map(properties.map((property) => [property.id, property]));
  const byName = new Map(properties.map((property) => [property.name, property]));
  const computed = properties.filter((property) =>
    ["rollup", "formula", "createdTime", "editedTime", "createdBy", "editedBy"].includes(property.type),
  );
  if (computed.length === 0) return collection.records.map((record) => ({ ...record, errors: {} }));
  const formulas = new Map(
    computed
      .filter((property) => property.type === "formula")
      .map((property) => [property.id, compiledFormula(property.config.formula?.expression ?? "")] as const),
  );

  return collection.records.map((record) => {
    const values: Record<string, PropertyValue> = { ...record.values };
    const errors: Record<string, string> = {};
    const done = new Set<string>();
    const active = new Set<string>();

    const resolve = (property: ViewProperty): PropertyValue => {
      if (done.has(property.id)) return values[property.id] ?? null;
      if (active.has(property.id)) throw new FormulaError(`The formula ${property.name} refers to itself.`);
      active.add(property.id);
      try {
        let value: PropertyValue = values[property.id] ?? null;
        switch (property.type) {
          case "createdTime":
          case "editedTime":
          case "createdBy":
          case "editedBy":
            value = storedValue(record, property);
            break;
          case "rollup":
            value = computeRollup(property, record, byId, context);
            break;
          case "formula": {
            const formula = formulas.get(property.id);
            if (formula === undefined || formula instanceof FormulaError) {
              errors[property.id] = formula?.message ?? "The formula is empty.";
              value = null;
              break;
            }
            const result = evaluateFormula(formula, {
              now: context.now,
              today: context.today,
              prop: (name) => {
                const referenced = byName.get(name) ?? byId.get(name);
                if (referenced === undefined) return undefined;
                const referencedValue = resolve(referenced);
                if (errors[referenced.id] !== undefined) {
                  throw new FormulaError(`${referenced.name} has an error.`);
                }
                return toFormulaValue(referenced, referencedValue, context);
              },
            });
            if (result.ok) value = fromFormulaValue(result.value);
            else {
              errors[property.id] = result.error;
              value = null;
            }
            break;
          }
          default:
            break;
        }
        values[property.id] = value;
        return value;
      } finally {
        active.delete(property.id);
        done.add(property.id);
      }
    };

    for (const property of computed) {
      try {
        resolve(property);
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        errors[property.id] = error.message;
        values[property.id] = null;
      }
    }
    return { ...record, values, errors };
  });
}

// ===== Search, sort and group =====

/** Whether every word of a search appears in the text of the record's properties. */
export function recordMatchesSearch(
  record: ViewRecord,
  properties: readonly ViewProperty[],
  search: string,
  context: EngineContext,
): boolean {
  const words = foldText(search)
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) return true;
  const text = foldText(
    properties.map((property) => displayText(property, record.values[property.id] ?? null, context)).join(" "),
  );
  return words.every((word) => text.includes(word));
}

/** A value that sorts: a number or a text. Null sorts after every value in either direction. */
function sortKey(property: ViewProperty, value: PropertyValue, context: EngineContext): number | string | null {
  if (isEmptyValue(value)) return null;
  switch (property.type) {
    case "select":
    case "status": {
      const index = property.config.options?.findIndex((option) => option.id === value) ?? -1;
      return index >= 0 ? index : foldText(String(value));
    }
    case "checkbox":
      return value === true ? 1 : 0;
    case "date":
    case "createdTime":
    case "editedTime":
    case "dateRange": {
      const text = isDateRange(value) ? (value.start ?? value.end) : value;
      return typeof text === "string" ? (parseFormulaDate(text)?.time ?? null) : null;
    }
    default:
      break;
  }
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && (property.type === "formula" || property.type === "rollup")) {
    const date = parseFormulaDate(value);
    if (date !== null) return date.time;
  }
  return foldText(displayText(property, value, context));
}

const COLLATOR = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

/** Sorts records by several keys in turn. Empty values go last whatever the direction. */
export function sortRecords<T extends ViewRecord>(
  records: readonly T[],
  sorts: readonly ViewSort[],
  properties: ReadonlyMap<string, ViewProperty>,
  context: EngineContext,
): T[] {
  const active = sorts
    .map((sort) => ({ sort, property: properties.get(sort.property) }))
    .filter((entry): entry is { sort: ViewSort; property: ViewProperty } => entry.property !== undefined);
  if (active.length === 0) return [...records];
  const keyed = records.map((record) => ({
    record,
    keys: active.map(({ property }) => sortKey(property, record.values[property.id] ?? null, context)),
  }));
  keyed.sort((a, b) => {
    for (const [index, { sort }] of active.entries()) {
      const left = a.keys[index] ?? null;
      const right = b.keys[index] ?? null;
      if (left === null && right === null) continue;
      if (left === null) return 1;
      if (right === null) return -1;
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : COLLATOR.compare(String(left), String(right));
      if (order !== 0) return sort.direction === "ascending" ? order : -order;
    }
    return 0;
  });
  return keyed.map((entry) => entry.record);
}

export interface ViewGroup<T extends ViewRecord = DerivedRecord> {
  /** Stable within the property: an option, `true` or `false`, a period, a value, or `""` for none. */
  readonly key: string;
  readonly label: string;
  readonly records: readonly T[];
  readonly collapsed: boolean;
}

/** The first day of the ISO week of a date. */
function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** The group key and label of one single value. */
function groupOf(
  property: ViewProperty,
  value: PropertyValue,
  grouping: ViewGrouping,
  context: EngineContext,
): { readonly key: string; readonly label: string; readonly order: number | string } {
  if (property.type === "checkbox") {
    return value === true
      ? { key: "true", label: "Ticked", order: 0 }
      : { key: "false", label: "Not ticked", order: 1 };
  }
  if (property.type === "select" || property.type === "status" || property.type === "multiSelect") {
    const id = String(value);
    const index = property.config.options?.findIndex((option) => option.id === id) ?? -1;
    return { key: id, label: optionName(property, id), order: index >= 0 ? index : 1_000 };
  }
  const dateText = isDateRange(value) ? (value.start ?? value.end) : typeof value === "string" ? value : null;
  const day = dateText === null ? null : dayOfValue(dateText, context);
  if (
    day !== null &&
    (property.type === "date" ||
      property.type === "dateRange" ||
      property.type === "createdTime" ||
      property.type === "editedTime")
  ) {
    switch (grouping.granularity ?? "month") {
      case "day":
        return { key: day, label: formatDate(day, context), order: day };
      case "week": {
        const start = weekStart(day);
        return { key: start, label: `Week of ${formatDate(start, context)}`, order: start };
      }
      case "year":
        return { key: day.slice(0, 4), label: day.slice(0, 4), order: day.slice(0, 4) };
      case "month":
        return {
          key: day.slice(0, 7),
          label: `${monthName(Number(day.slice(5, 7)))} ${day.slice(0, 4)}`,
          order: day.slice(0, 7),
        };
    }
  }
  if (property.type === "relation" && typeof value === "object" && value !== null) {
    const reference = value as unknown as RecordReference;
    const label = referenceTitle(reference, property.config.relation?.target, context);
    return { key: referenceKey(reference), label, order: foldText(label) };
  }
  if (property.type === "person" || property.type === "createdBy" || property.type === "editedBy") {
    const uid = String(value);
    const label = context.personName(uid) ?? "Unknown member";
    return { key: uid, label, order: foldText(label) };
  }
  if (typeof value === "number")
    return { key: String(value), label: displayText(property, value, context), order: value };
  const label = displayText(property, value, context);
  return { key: label, label, order: foldText(label) };
}

/**
 * Groups records by a property. A record whose value is a list joins the group of each of its
 * elements. A select, a multi-select and a status list every option in their order when
 * `allOptions` is set, as the columns of a board do, and the group of records with no value
 * comes last.
 */
export function groupRecords<T extends ViewRecord>(
  records: readonly T[],
  grouping: ViewGrouping,
  property: ViewProperty,
  context: EngineContext,
  allOptions = false,
): ViewGroup<T>[] {
  const groups = new Map<string, { key: string; label: string; order: number | string; records: T[] }>();
  if (allOptions || property.type === "checkbox") {
    const seeded: PropertyValue[] =
      property.type === "checkbox" ? [true, false] : (property.config.options ?? []).map((option) => option.id);
    for (const value of seeded) {
      const group = groupOf(property, value, grouping, context);
      groups.set(group.key, { ...group, records: [] });
    }
  }
  const empty: T[] = [];
  for (const record of records) {
    const value = record.values[property.id] ?? null;
    if (property.type !== "checkbox" && isEmptyValue(value)) {
      empty.push(record);
      continue;
    }
    const singles = Array.isArray(value) ? (value as PropertyValue[]) : [value];
    for (const single of singles) {
      const group = groupOf(property, single, grouping, context);
      const existing = groups.get(group.key) ?? { ...group, records: [] };
      existing.records.push(record);
      groups.set(group.key, existing);
    }
  }
  const ordered = [...groups.values()].sort((a, b) =>
    typeof a.order === "number" && typeof b.order === "number"
      ? a.order - b.order
      : COLLATOR.compare(String(a.order), String(b.order)),
  );
  const collapsed = new Set(grouping.collapsed);
  const result: ViewGroup<T>[] = ordered.map((group) => ({
    key: group.key,
    label: group.label,
    records: group.records,
    collapsed: collapsed.has(group.key),
  }));
  if (property.type !== "checkbox" && (empty.length > 0 || allOptions)) {
    result.push({ key: "", label: `No ${property.name.toLowerCase()}`, records: empty, collapsed: collapsed.has("") });
  }
  return grouping.hideEmpty === true ? result.filter((group) => group.records.length > 0) : result;
}

// ===== The whole view =====

/** The properties a view shows, in its order: those it lists first, then the others in their own order. */
export function orderedProperties(properties: readonly ViewProperty[], config: ViewConfig): readonly ViewProperty[] {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const listed = (config.order ?? [])
    .map((id) => byId.get(id))
    .filter((property): property is ViewProperty => property !== undefined);
  const listedIds = new Set(listed.map((property) => property.id));
  return [...listed, ...properties.filter((property) => !listedIds.has(property.id))];
}

/** The properties a view shows: the ordered properties that it does not hide. The title is always shown. */
export function visibleProperties(collection: CollectionData, config: ViewConfig): readonly ViewProperty[] {
  const hidden = new Set(config.hidden ?? []);
  return orderedProperties(collection.properties, config).filter(
    (property) => property.id === collection.titleProperty || !hidden.has(property.id),
  );
}

export interface ViewResult {
  /** The records that pass the scope, the search and the filter, sorted. */
  readonly records: readonly DerivedRecord[];
  /** The groups of those records, or null where the view is not grouped. */
  readonly groups: readonly ViewGroup[] | null;
  /** How many records the scope holds before the search and the filter. */
  readonly total: number;
}

/** Whether a record falls within the fixed scope of a view, such as one replication. */
export function withinScope(record: ViewRecord, scope: ViewScope | null): boolean {
  if (scope === null) return true;
  const value = record.values[scope.property];
  if (typeof value === "string") return value === scope.value;
  if (Array.isArray(value)) {
    return value.some((element) =>
      typeof element === "object" && element !== null
        ? (element as RecordReference).entityId === scope.value
        : element === scope.value,
    );
  }
  return false;
}

/** Applies a view to a collection: derive, scope, search, filter, sort and group. */
export function computeView(
  collection: CollectionData,
  config: ViewConfig,
  scope: ViewScope | null,
  context: EngineContext,
): ViewResult {
  const derived = deriveRecords(collection, context);
  const scoped = derived.filter((record) => withinScope(record, scope));
  const propertiesById = new Map(collection.properties.map((property) => [property.id, property]));
  const searchable = visibleProperties(collection, config);
  const search = config.search ?? "";
  const filter = config.filter ?? null;
  const kept = scoped.filter(
    (record) =>
      (search === "" || recordMatchesSearch(record, searchable, search, context)) &&
      (filter === null || matchesFilter(filter, record, propertiesById, context)),
  );
  const sorted = sortRecords(kept, config.sorts ?? [], propertiesById, context);
  const grouping = config.group ?? null;
  const groupProperty = grouping === null ? undefined : propertiesById.get(grouping.property);
  return {
    records: sorted,
    groups:
      grouping === null || groupProperty === undefined ? null : groupRecords(sorted, grouping, groupProperty, context),
    total: scoped.length,
  };
}

// ===== Aggregates for dashboards =====

export type Measure =
  | { readonly kind: "count" }
  | { readonly kind: "sum"; readonly property: string }
  | { readonly kind: "rollup"; readonly property: string; readonly function: RollupFunction };

export interface Bucket {
  readonly key: string;
  readonly label: string;
  /** Null where the value is unknown, which a chart shows as such and never as zero. */
  readonly value: number | null;
  readonly count: number;
}

function measureOf(
  records: readonly ViewRecord[],
  measure: Measure,
  properties: ReadonlyMap<string, ViewProperty>,
): number | null {
  if (measure.kind === "count") return records.length;
  const property = properties.get(measure.property);
  const values = records.map((record) => storedValue(record, property));
  const result = applyRollup(measure.kind === "sum" ? "sum" : measure.function, values, records.length);
  return typeof result === "number" ? result : null;
}

/** A figure over the records of a view: a count, a sum or any rollup function of a property. */
export function aggregate(
  records: readonly ViewRecord[],
  measure: Measure,
  properties: readonly ViewProperty[],
): number | null {
  return measureOf(records, measure, new Map(properties.map((property) => [property.id, property])));
}

/** The records of a view grouped by a property, with a count or a sum for each group: the data of a chart. */
export function groupedAggregate(
  records: readonly ViewRecord[],
  groupBy: ViewProperty,
  measure: Measure,
  properties: readonly ViewProperty[],
  context: EngineContext,
): Bucket[] {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const allOptions = groupBy.type === "select" || groupBy.type === "status";
  return groupRecords(records, { property: groupBy.id, collapsed: [] }, groupBy, context, allOptions).map((group) => ({
    key: group.key,
    label: group.label,
    value: measureOf(group.records, measure, byId),
    count: group.records.length,
  }));
}
