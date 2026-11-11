// Values of properties: how one is checked before it is stored, how it reads as text, and how a
// date is understood. Shared by the browser, which edits values, and the functions, which store them.
import { entityTypeSchema } from "../entities";
import { LIMITS } from "../schemas/base";
import type { PropertyType } from "../schemas/workspace";
import {
  COMPUTED_TYPES,
  type CollectionData,
  type DateRangeValue,
  type FileLink,
  fileLinkSchema,
  isDateRange,
  type PropertyValue,
  type RecordReference,
  type ViewProperty,
  type ViewRecord,
} from "./model";

/** What the engine needs to know beyond the records: the time, the names of people and related collections. */
export interface EngineContext {
  /** Today's date for the reader, as an ISO date. */
  readonly today: string;
  readonly now: Date;
  /** The reader's calendar day of an instant, as an ISO date. */
  readonly dayOf: (instant: string) => string;
  /** The display name of an account, or null where it is not known. */
  readonly personName: (uid: string) => string | null;
  /** Collections that relations and backlinks point at, by collection key. */
  readonly collections: ReadonlyMap<string, CollectionData>;
}

/** The day of an instant in UTC, for a context that knows no time zone. */
export const utcDayOf = (instant: string): string => instant.slice(0, 10);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const monthName = (month: number): string => MONTHS[month - 1] ?? "";

/** The calendar day of a stored date or instant. */
export function dayOfValue(value: string, context: Pick<EngineContext, "dayOf">): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return context.dayOf(value);
  return null;
}

/** A date as the portal writes it in UK English: 11 November 2026, with the time for an instant. */
export function formatDate(value: string, context: Pick<EngineContext, "dayOf">, withTime = false): string {
  const day = dayOfValue(value, context);
  if (day === null) return value;
  const [year, month, date] = day.split("-").map(Number);
  const text = `${date ?? ""} ${monthName(month ?? 0)} ${year ?? ""}`;
  if (!withTime || value.length === 10) return text;
  const instant = new Date(value);
  const local = new Date(instant.getTime());
  const hours = String(local.getHours()).padStart(2, "0");
  const minutes = String(local.getMinutes()).padStart(2, "0");
  return `${text}, ${hours}:${minutes}`;
}

/** Adds whole days to an ISO date. */
export function addDays(day: string, days: number): string {
  const time = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** Adds whole months to an ISO date, keeping the day where the month has it. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + months, 1));
  const last = new Date(Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0)).getUTCDate();
  moved.setUTCDate(Math.min(date ?? 1, last));
  return moved.toISOString().slice(0, 10);
}

/** Text folded for search: no accents, lower case, single spaces. */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The key under which a reference is indexed. */
export const referenceKey = (reference: RecordReference): string => `${reference.entityType}:${reference.entityId}`;

const titleIndexes = new WeakMap<CollectionData, ReadonlyMap<string, ViewRecord>>();

/** The records of a collection by reference key. */
export function recordsByReference(collection: CollectionData): ReadonlyMap<string, ViewRecord> {
  const cached = titleIndexes.get(collection);
  if (cached !== undefined) return cached;
  const index = new Map(collection.records.map((record) => [referenceKey(record.reference), record]));
  titleIndexes.set(collection, index);
  return index;
}

/** The title of a related record, or its identifier where the record is not loaded. */
export function referenceTitle(reference: RecordReference, target: string | undefined, context: EngineContext): string {
  const collection = target === undefined ? undefined : context.collections.get(target);
  const record = collection === undefined ? undefined : recordsByReference(collection).get(referenceKey(reference));
  const title = record?.values[collection?.titleProperty ?? ""];
  return typeof title === "string" && title !== "" ? title : reference.entityId;
}

export function optionName(property: ViewProperty, id: string): string {
  return property.config.options?.find((option) => option.id === id)?.name ?? id;
}

function formatNumber(property: ViewProperty, value: number): string {
  switch (property.config.numberFormat) {
    case "integer":
      return Math.round(value).toLocaleString("en-GB");
    case "decimal":
      return value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "percent":
      return `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
    default:
      return value.toLocaleString("en-GB", { maximumFractionDigits: 6 });
  }
}

function rangeText(range: DateRangeValue, context: EngineContext, withTime: boolean): string {
  const start = range.start === null ? "" : formatDate(range.start, context, withTime);
  const end = range.end === null ? "" : formatDate(range.end, context, withTime);
  if (start === "") return end === "" ? "" : `Until ${end}`;
  return end === "" ? `From ${start}` : `${start} to ${end}`;
}

/** A value as plain text: what search matches, what a chart labels and what a screen reader hears. */
export function displayText(property: ViewProperty, value: PropertyValue | undefined, context: EngineContext): string {
  if (value === null || value === undefined) return "";
  const withTime =
    property.config.includeTime === true || property.type === "createdTime" || property.type === "editedTime";
  switch (property.type) {
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "select":
    case "status":
      return typeof value === "string" ? optionName(property, value) : "";
    case "multiSelect":
      return Array.isArray(value) ? value.map((id) => optionName(property, String(id))).join(", ") : "";
    case "person":
    case "createdBy":
    case "editedBy": {
      const uids = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
      return uids.map((uid) => context.personName(uid) ?? "Unknown member").join(", ");
    }
    case "relation":
      return Array.isArray(value)
        ? (value as readonly RecordReference[])
            .map((reference) => referenceTitle(reference, property.config.relation?.target, context))
            .join(", ")
        : "";
    case "file":
      return Array.isArray(value) ? (value as readonly FileLink[]).map((file) => file.name).join(", ") : "";
    case "date":
    case "createdTime":
    case "editedTime":
      return typeof value === "string" ? formatDate(value, context, withTime) : "";
    case "dateRange":
      return isDateRange(value) ? rangeText(value, context, withTime) : "";
    case "number":
      return typeof value === "number" ? formatNumber(property, value) : "";
    default:
      break;
  }
  if (typeof value === "number") return formatNumber(property, value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) && (property.type === "formula" || property.type === "rollup")
      ? formatDate(value, context, value.length > 10)
      : value;
  }
  if (Array.isArray(value)) return value.map((element) => String(element)).join(", ");
  return isDateRange(value) ? rangeText(value, context, withTime) : "";
}

// ===== Checking a value before it is stored =====

export type ValueCheck =
  | { readonly ok: true; readonly value: PropertyValue }
  | { readonly ok: false; readonly error: string };

const ok = (value: PropertyValue): ValueCheck => ({ ok: true, value });
const fail = (error: string): ValueCheck => ({ ok: false, error });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validDay(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text;
}

function dateValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (validDay(raw)) return raw;
  return ISO_INSTANT.test(raw) && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

function texts(raw: unknown, maximum: number): string[] | null {
  if (!Array.isArray(raw) || raw.length > maximum) return null;
  if (
    !raw.every((element) => typeof element === "string" && element.length > 0 && element.length <= LIMITS.shortText)
  ) {
    return null;
  }
  return [...new Set(raw as string[])];
}

/**
 * Checks a value that a person gives a property, and returns it in its stored form. Null clears
 * the value. Computed properties and the title take no value here.
 */
export function checkPropertyValue(property: ViewProperty, raw: unknown): ValueCheck {
  if (COMPUTED_TYPES.includes(property.type)) return fail(`${property.name} is computed and cannot be changed.`);
  if (raw === null) return ok(null);
  const name = property.name;
  switch (property.type) {
    case "text":
    case "richText": {
      if (typeof raw !== "string") return fail(`${name} takes a text.`);
      const limit = property.type === "text" ? LIMITS.longText : LIMITS.richTextBytes;
      if (raw.length > limit) return fail(`${name} holds at most ${limit} characters.`);
      return ok(raw === "" ? null : raw);
    }
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? ok(raw) : fail(`${name} takes a number.`);
    case "checkbox":
      return typeof raw === "boolean" ? ok(raw) : fail(`${name} is either ticked or not.`);
    case "email":
      return typeof raw === "string" && raw.length <= 320 && EMAIL.test(raw)
        ? ok(raw.trim())
        : fail(`${name} takes an email address such as someone@example.org.`);
    case "url":
      return typeof raw === "string" && raw.length <= LIMITS.url && /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(raw)
        ? ok(raw)
        : fail(`${name} takes a web address that starts with https://.`);
    case "date": {
      const value = dateValue(raw);
      return value === null ? fail(`${name} takes a date such as 2026-11-11.`) : ok(value);
    }
    case "dateRange": {
      if (typeof raw !== "object" || Array.isArray(raw)) return fail(`${name} takes a start and an end date.`);
      const range = raw as { start?: unknown; end?: unknown };
      const keys = Object.keys(range);
      if (!keys.every((key) => key === "start" || key === "end")) return fail(`${name} takes a start and an end date.`);
      const start = range.start === null || range.start === undefined ? null : dateValue(range.start);
      const end = range.end === null || range.end === undefined ? null : dateValue(range.end);
      if ((range.start != null && start === null) || (range.end != null && end === null)) {
        return fail(`${name} takes dates such as 2026-11-11.`);
      }
      if (start !== null && end !== null && Date.parse(end) < Date.parse(start)) {
        return fail(`The end of ${name} comes before its start.`);
      }
      return start === null && end === null ? ok(null) : ok({ start, end });
    }
    case "select":
    case "status": {
      if (typeof raw !== "string") return fail(`${name} takes one of its options.`);
      return property.config.options?.some((option) => option.id === raw)
        ? ok(raw)
        : fail(`${name} has no such option.`);
    }
    case "multiSelect": {
      const ids = texts(raw, 100);
      if (ids === null) return fail(`${name} takes a list of its options.`);
      const known = new Set(property.config.options?.map((option) => option.id) ?? []);
      return ids.every((id) => known.has(id)) ? ok(ids.length === 0 ? null : ids) : fail(`${name} has no such option.`);
    }
    case "person": {
      const uids = texts(raw, 50);
      if (uids === null || !uids.every((uid) => /^[A-Za-z0-9_-]{1,128}$/.test(uid))) {
        return fail(`${name} takes a list of members.`);
      }
      return ok(uids.length === 0 ? null : uids);
    }
    case "relation": {
      if (!Array.isArray(raw) || raw.length > 100) return fail(`${name} links to at most 100 records.`);
      const references: RecordReference[] = [];
      const seen = new Set<string>();
      for (const element of raw) {
        if (typeof element !== "object" || element === null) return fail(`${name} takes links to records.`);
        const { entityType, entityId, ...rest } = element as Record<string, unknown>;
        const type = entityTypeSchema.safeParse(entityType);
        if (
          Object.keys(rest).length > 0 ||
          !type.success ||
          typeof entityId !== "string" ||
          !/^[^/]{1,500}$/.test(entityId)
        ) {
          return fail(`${name} takes links to records.`);
        }
        const reference = { entityType: type.data, entityId };
        if (!seen.has(referenceKey(reference))) references.push(reference);
        seen.add(referenceKey(reference));
      }
      return ok(references.length === 0 ? null : references);
    }
    case "file": {
      if (!Array.isArray(raw) || raw.length > 20) return fail(`${name} holds at most 20 files.`);
      const files: FileLink[] = [];
      for (const element of raw) {
        const parsed = fileLinkSchema.safeParse(element);
        if (!parsed.success) return fail(`${name} takes files with a name and a web address.`);
        files.push(parsed.data);
      }
      return ok(files.length === 0 ? null : files);
    }
    default:
      return fail(`${name} cannot be changed here.`);
  }
}

/** The types a person can choose for a new property, in the order a menu offers them. */
export const PROPERTY_TYPE_LABELS: Readonly<Record<PropertyType, string>> = {
  text: "Text",
  richText: "Long text",
  number: "Number",
  date: "Date",
  dateRange: "Date range",
  email: "Email",
  url: "Web address",
  checkbox: "Checkbox",
  person: "Person",
  status: "Status",
  select: "Select",
  multiSelect: "Multi-select",
  file: "Files",
  relation: "Relation",
  rollup: "Rollup",
  formula: "Formula",
  createdTime: "Created time",
  editedTime: "Edited time",
  createdBy: "Created by",
  editedBy: "Edited by",
};
