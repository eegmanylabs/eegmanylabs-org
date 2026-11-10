// The structure check of a workbook whose layout is known from a description only
// (docs/MIGRATION_PLAN.md, sections 4.8, 4.9 and 9). The header of a tab is looked for in its
// first rows and matched tolerantly, so that a difference of case, spacing or punctuation is no
// failure, and everything that was not recognised is named: a missing column, a column that
// stands twice, a header that the importer does not know and a column of data without a header.
// Nothing is mapped by guesswork, and the importer that uses the check stops where it fails.
import { lookupFold } from "@eegml/shared";
import type { RawScalar } from "./model";

/** One column that a tab is expected to hold. */
export interface ExpectedColumn {
  /** The key under which the importer reads the column. */
  readonly field: string;
  /** The header as the description of the workbook writes it. */
  readonly header: string;
  /** Other spellings that name the same column, beyond a difference of case, spacing or punctuation. */
  readonly alternatives?: readonly string[];
}

export interface FoundHeader {
  /** The name under which the cells of the column are stored: its column letter. */
  readonly label: string;
  /** The text of the header cell exactly as the tab writes it. */
  readonly text: string;
}

export interface HeaderMatch {
  /** The row that holds the header, or null where no row of the search holds enough of the expected headers. */
  readonly headerRow: number | null;
  /** The column of each expected field that was found once. */
  readonly columns: ReadonlyMap<string, string>;
  /** Fields that were found under a spelling other than the expected one, which is accepted and reported. */
  readonly variants: readonly { readonly field: string; readonly expected: string; readonly found: FoundHeader }[];
  /** The expected headers that the row lacks. */
  readonly missing: readonly string[];
  /** The expected headers that stand in the row more than once. */
  readonly duplicated: readonly string[];
  /** Headed columns that the importer does not recognise. */
  readonly unknown: readonly FoundHeader[];
  /** Columns of the used range whose header cell is empty. */
  readonly blank: readonly string[];
}

/** The number of rows from the top of a tab in which its header is looked for, below a title or a preamble. */
export const HEADER_SEARCH_ROWS = 10;

const headerTextOf = (value: RawScalar): string =>
  typeof value === "string" ? value : value === null ? "" : String(value);

/**
 * Finds the header of a tab and matches it against the expected columns. A header matches a
 * column when their lookup folds are equal, so `EEG_system`, `EEG system` and `eeg-System` are
 * one header. The header row is the row among the first ten that holds the most expected
 * headers, and at least `minimum` of them.
 */
export function matchHeader(
  labels: readonly string[],
  valuesOf: (row: number) => readonly RawScalar[],
  lastRow: number,
  expected: readonly ExpectedColumn[],
  minimum: number,
): HeaderMatch {
  const fieldOf = new Map<string, ExpectedColumn>();
  for (const column of expected) {
    for (const spelling of [column.header, ...(column.alternatives ?? [])]) fieldOf.set(lookupFold(spelling), column);
  }
  let best: { readonly row: number; readonly found: number } | null = null;
  for (let row = 1; row <= Math.min(lastRow, HEADER_SEARCH_ROWS); row += 1) {
    const fields = new Set(valuesOf(row).flatMap((value) => fieldOf.get(lookupFold(headerTextOf(value)))?.field ?? []));
    if (fields.size >= minimum && (best === null || fields.size > best.found)) best = { row, found: fields.size };
  }
  if (best === null) {
    return {
      headerRow: null,
      columns: new Map(),
      variants: [],
      missing: expected.map((column) => column.header),
      duplicated: [],
      unknown: [],
      blank: [],
    };
  }
  const values = valuesOf(best.row);
  const columns = new Map<string, string>();
  const variants: { field: string; expected: string; found: FoundHeader }[] = [];
  const duplicated = new Set<string>();
  const unknown: FoundHeader[] = [];
  const blank: string[] = [];
  for (const [index, label] of labels.entries()) {
    const text = headerTextOf(values[index] ?? null);
    if (text.trim() === "") {
      blank.push(label);
      continue;
    }
    const column = fieldOf.get(lookupFold(text));
    if (column === undefined) {
      unknown.push({ label, text });
    } else if (columns.has(column.field)) {
      duplicated.add(column.header);
    } else {
      columns.set(column.field, label);
      if (text !== column.header)
        variants.push({ field: column.field, expected: column.header, found: { label, text } });
    }
  }
  return {
    headerRow: best.row,
    columns,
    variants,
    missing: expected.filter((column) => !columns.has(column.field)).map((column) => column.header),
    duplicated: [...duplicated].sort(),
    unknown,
    blank,
  };
}

/**
 * The identifier that the host gives a spreadsheet, read out of an address of the forms
 * `…/spreadsheets/d/<identifier>/…` and `…?id=<identifier>`. Null for any other text: an
 * identifier is never guessed out of a title or a remark.
 */
export function spreadsheetIdentifierIn(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const inPath = /\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,})(?:\/|$)/.exec(url.pathname)?.[1];
  const inQuery = url.searchParams.get("id");
  return inPath ?? (inQuery !== null && /^[A-Za-z0-9_-]{10,}$/.test(inQuery) ? inQuery : null);
}

/** The entries of a cell that lists several values, split on commas, semicolons and line breaks, each trimmed. */
export function listedValues(text: string | null): string[] {
  return (text ?? "")
    .split(/[,;\n\r]+/)
    .map((entry) => entry.normalize("NFC").replace(/\s+/g, " ").trim())
    .filter((entry) => entry !== "");
}
