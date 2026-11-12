// The canonical form of a synchronised value (docs/INTEGRATIONS.md, section 3.3). Every mapped
// cell is compared in this form, whichever side it comes from: text is normalised and its line
// endings unified, a number is compared as a number, a date taken from a sheet's serial number
// becomes an ISO date, and an empty string, a missing cell and an absent value are one value.
//
// A canonical value is a string, or null for "no value". Two values are equal exactly when
// their canonical strings are equal, so the planner compares with `===` and never with a rule
// of its own.

/**
 * | Type         | In the portal                    | In the sheet                                   |
 * |--------------|----------------------------------|------------------------------------------------|
 * | `text`       | A string                         | Any value, read as text                        |
 * | `number`     | A finite number                  | A number, or a text that holds one             |
 * | `boolean`    | `true` or `false`                | A checkbox, or the text TRUE or FALSE          |
 * | `date`       | An ISO date, `2026-11-11`        | A date serial number, or an ISO date as text   |
 * | `numberList` | An array of numbers              | Numbers separated by commas or semicolons      |
 * | `textList`   | An array of strings              | Items separated by commas, semicolons or lines |
 * | `link`       | An http or https address         | The address as text                            |
 * | `enum`       | One of the keys of `options`     | The label of that key, compared without case   |
 */
export const SYNC_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "numberList",
  "textList",
  "link",
  "enum",
] as const;
export type SyncFieldType = (typeof SYNC_FIELD_TYPES)[number];

export interface SyncFieldSpec {
  readonly type: SyncFieldType;
  /** For `enum`: the value stored in the portal, mapped to the label written in the sheet. */
  readonly options?: Readonly<Record<string, string>>;
}

/** A value as the Sheets interface returns it unformatted, or null for an empty cell. */
export type SheetScalar = string | number | boolean | null;

/** A value in canonical form. Null is "no value". */
export type Canonical = string | null;

export type Conversion =
  | { readonly ok: true; readonly value: Canonical }
  | { readonly ok: false; readonly reason: string };

const LIST_SEPARATOR = "\u001f";
const ok = (value: Canonical): Conversion => ({ ok: true, value });
const refuse = (reason: string): Conversion => ({ ok: false, reason });

/** Unicode NFC, Unix line endings and no surrounding white space. An empty result is no value. */
export function normaliseText(text: string): Canonical {
  const normalised = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  return normalised === "" ? null : normalised;
}

function canonicalNumber(value: number): string {
  // -0 and 0 are one value, and the shortest round-trip form is the canonical text.
  return Object.is(value, -0) ? "0" : String(value);
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The first day of the date serial numbers of a spreadsheet: 30 December 1899. */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIsoDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (match === null) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === text;
}

/** The ISO date of a date serial number. A time of day, the fraction of the serial, is dropped. */
export function serialToIsoDate(serial: number): string {
  return new Date(SERIAL_EPOCH_MS + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

/** The date serial number of an ISO date, which keeps the cell's own date format when written raw. */
export function isoDateToSerial(date: string): number {
  const match = ISO_DATE.exec(date);
  if (match === null || !validIsoDate(date)) throw new RangeError("Expected an ISO date.");
  return Math.round((Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - SERIAL_EPOCH_MS) / DAY_MS);
}

function splitItems(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((item) => item.normalize("NFC").trim())
    .filter((item) => item !== "");
}

function joinList(items: readonly string[]): Canonical {
  return items.length === 0 ? null : items.join(LIST_SEPARATOR);
}

/** An http or https address with a host and no white space. */
function isWebAddress(text: string): boolean {
  return /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(text);
}

/** The canonical form of a value as the portal stores it. Absent and null are no value. */
export function canonicalFromApp(spec: SyncFieldSpec, value: unknown): Conversion {
  if (value === undefined || value === null) return ok(null);
  switch (spec.type) {
    case "text":
      return typeof value === "string" ? ok(normaliseText(value)) : refuse("The portal holds no text here.");
    case "link":
      if (typeof value !== "string") return refuse("The portal holds no address here.");
      return ok(normaliseText(value));
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? ok(canonicalNumber(value))
        : refuse("The portal holds no number here.");
    case "boolean":
      return typeof value === "boolean" ? ok(String(value)) : refuse("The portal holds no yes or no here.");
    case "date":
      return typeof value === "string" && validIsoDate(value) ? ok(value) : refuse("The portal holds no date here.");
    case "numberList":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
        return refuse("The portal holds no list of numbers here.");
      }
      return ok(joinList(value.map((item: number) => canonicalNumber(item))));
    case "textList":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        return refuse("The portal holds no list here.");
      }
      return ok(joinList(value.flatMap((item: string) => normaliseText(item) ?? [])));
    case "enum":
      return typeof value === "string" && spec.options !== undefined && value in spec.options
        ? ok(value)
        : refuse("The portal holds a value that the mapping does not list.");
  }
}

/** The canonical form of an unformatted cell value, or the reason it cannot be read as the field's type. */
export function canonicalFromSheet(spec: SyncFieldSpec, value: SheetScalar): Conversion {
  if (value === null || value === "") return ok(null);
  switch (spec.type) {
    case "text":
      return ok(normaliseText(typeof value === "string" ? value : String(value)));
    case "link": {
      const text = normaliseText(String(value));
      return text === null || isWebAddress(text) ? ok(text) : refuse("The cell holds no web address.");
    }
    case "number": {
      if (typeof value === "number")
        return Number.isFinite(value) ? ok(canonicalNumber(value)) : refuse("Not a number.");
      if (typeof value === "boolean") return refuse("The cell holds a yes or no, not a number.");
      const parsed = parseNumber(value);
      return parsed === null ? refuse("The cell holds no number.") : ok(canonicalNumber(parsed));
    }
    case "boolean": {
      if (typeof value === "boolean") return ok(String(value));
      const text = String(value).trim().toLowerCase();
      return text === "true" || text === "false" ? ok(text) : refuse("The cell holds no yes or no.");
    }
    case "date": {
      if (typeof value === "number") return Number.isFinite(value) ? ok(serialToIsoDate(value)) : refuse("Not a date.");
      const text = String(value).trim();
      return validIsoDate(text) ? ok(text) : refuse("The cell holds no date.");
    }
    case "numberList": {
      if (typeof value === "number")
        return Number.isFinite(value) ? ok(canonicalNumber(value)) : refuse("Not a number.");
      if (typeof value === "boolean") return refuse("The cell holds a yes or no, not numbers.");
      const numbers = splitItems(value).map(parseNumber);
      if (numbers.some((item) => item === null)) return refuse("The cell holds something other than numbers.");
      return ok(joinList(numbers.map((item) => canonicalNumber(item ?? 0))));
    }
    case "textList":
      return ok(joinList(splitItems(String(value))));
    case "enum": {
      const text = String(value).trim().toLowerCase();
      const match = Object.entries(spec.options ?? {}).find(([, label]) => label.trim().toLowerCase() === text);
      return match === undefined ? refuse("The cell holds a label that the mapping does not list.") : ok(match[0]);
    }
  }
}

/** The value the portal stores for a canonical value, or undefined for no value. */
export function appValueOf(spec: SyncFieldSpec, value: Canonical): unknown {
  if (value === null) return undefined;
  switch (spec.type) {
    case "number":
      return Number(value);
    case "boolean":
      return value === "true";
    case "numberList":
      return value.split(LIST_SEPARATOR).map(Number);
    case "textList":
      return value.split(LIST_SEPARATOR);
    case "text":
    case "link":
    case "date":
    case "enum":
      return value;
  }
}

/**
 * The raw value the engine writes into a cell for a canonical value. An empty string clears the
 * cell, which is sent only when clearing is the plan. A date is written as its serial number so
 * the cell keeps its own date format, and nothing is ever written as a formula.
 */
export function sheetValueOf(spec: SyncFieldSpec, value: Canonical): string | number | boolean {
  if (value === null) return "";
  switch (spec.type) {
    case "number":
      return Number(value);
    case "boolean":
      return value === "true";
    case "date":
      return isoDateToSerial(value);
    case "numberList":
    case "textList":
      return value.split(LIST_SEPARATOR).join(", ");
    case "enum":
      return spec.options?.[value] ?? value;
    case "text":
    case "link":
      // A text that starts with "=" is written raw and stays text: the engine never writes a formula.
      return value;
  }
}

/** How a canonical value reads in the interface: list items separated by commas, no value as null. */
export function displayCanonical(value: Canonical | undefined): string | null {
  return value === null || value === undefined ? null : value.split(LIST_SEPARATOR).join(", ");
}
