// Hashes and parsed copies of source values (docs/MIGRATION_PLAN.md, sections 2 and 3.1).
// A parsed value is stored beside the raw one and never in its place, so nothing here is
// applied to a value before it has been captured in a source record.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

/** The number of hexadecimal characters of the hash of a row. */
export const ROW_HASH_LENGTH = 12;

/** SHA-256 of bytes, in lower-case hexadecimal. */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * JSON with the keys of every object in code-point order and no white space, so that two equal
 * values always give the same text whatever order their keys were written in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (value === undefined) throw new RangeError("An undefined value has no canonical form.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return JSON.stringify({ timestamp: (value as { toMillis(): number }).toMillis() });
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

/** SHA-256 of the canonical JSON of a value, in hexadecimal. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** A cell reference inside a formula or a range: an optional sheet, a column and a row. */
const CELL_REFERENCE = /(?<![A-Za-z0-9_.])(\$?[A-Z]{1,3}\$?)(\d{1,7})(?![A-Za-z0-9_(])/g;

/** A text with the row of every cell reference written as its distance from a row. */
const relativeTo = (text: string, rowNumber: number): string =>
  text.replace(CELL_REFERENCE, (_all, column: string, row: string) => `${column}{${Number(row) - rowNumber}}`);

/**
 * The form in which a cell enters the hash of its row. The formula text and the merged range of
 * a cell name rows of the sheet, so a line inserted above would change them although nothing of
 * the row has changed. In the hashed form each such row is written as its distance from the row
 * of the cell. The stored record keeps both exactly as the file holds them.
 */
function hashedForm(cell: unknown, rowNumber: number): unknown {
  if (cell === null || typeof cell !== "object" || Array.isArray(cell)) return cell;
  const record = cell as Record<string, unknown>;
  if (typeof record.f !== "string" && typeof record.merge !== "string") return cell;
  return {
    ...record,
    ...(typeof record.f === "string" ? { f: relativeTo(record.f, rowNumber) } : {}),
    ...(typeof record.merge === "string" ? { merge: relativeTo(record.merge, rowNumber) } : {}),
  };
}

/**
 * The hash of a row: the first 12 hexadecimal characters of SHA-256 over the compact JSON of its
 * raw cell records in column order, with `null` for an empty cell. Row numbers are part of no
 * key, so the references to rows inside a formula or a merged range are taken relative to the
 * row itself.
 */
export function rowHash(cells: readonly unknown[], rowNumber: number): string {
  return contentHash(positionFree(cells, rowNumber)).slice(0, ROW_HASH_LENGTH);
}

/** The cells of a row in the form in which they are hashed, where no row of the sheet is named by its number. */
export function positionFree(cells: readonly unknown[], rowNumber: number): unknown[] {
  return cells.map((cell) => hashedForm(cell, rowNumber));
}

/**
 * The key of a row that has no natural key: the hash of its content with its ordinal among the
 * rows of equal content, so that the row number is no part of it. `seen` counts the rows of one tab.
 */
export function contentRowKey(cells: readonly unknown[], rowNumber: number, seen: Map<string, number>): string {
  const hash = rowHash(cells, rowNumber);
  const ordinal = (seen.get(hash) ?? 0) + 1;
  seen.set(hash, ordinal);
  return `row__${hash}__${ordinal}`;
}

/** The whole number that a text states, or null. `2007` and ` 7 ` qualify, and `2005a`, `7.5` and an empty text do not. */
export function wholeNumberOf(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,15}$/.test(trimmed) ? Number(trimmed) : null;
}

/** The order of two texts by code point, which no locale changes: for a list that has to come out the same everywhere. */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whether two stored values are equal in every part. */
export function sameValue(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

/** The members of a list that no earlier member equals, in their first order. */
export function distinct<T>(values: readonly T[]): T[] {
  const kept: T[] = [];
  for (const value of values) if (!kept.some((other) => sameValue(other, value))) kept.push(value);
  return kept;
}
