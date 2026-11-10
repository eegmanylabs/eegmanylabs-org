// What the importers of workbooks share when they turn the sheets of a file into rows
// (docs/MIGRATION_PLAN.md, section 2): opening the file, capturing a row cell by cell, reading a
// stored cell again, and the few readings of a value that several sources need. Nothing here
// changes a raw value: every reading is a copy beside it.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { shortHash, sourceTabKey } from "@eegml/shared";
import { type FormattingAsData, holdsContent, rawCellOf } from "./cells";
import type { ImportInput, InputFile, RawCell, RawScalar, SourceRow, SourceTab, StructureIssue } from "./model";
import { WorkbookFormatError } from "./ooxml";
import { cellValue } from "./records";
import { contentRowKey, sha256OfBytes } from "./values";
import { cellsByRow, columnLetters, readWorkbook, type Workbook, type WorkbookSheet } from "./workbook";

export interface OpenedWorkbook {
  readonly contentHash: string;
  readonly inputFiles: readonly InputFile[];
  /** Null when the input could not be opened, in which case `issues` says why. */
  readonly workbook: Workbook | null;
  readonly issues: readonly StructureIssue[];
}

/**
 * The record of a file that was read, under a neutral name. The name under which the operator
 * keeps a file is never stored: an export is often named after the identifier of its document,
 * and the batch record can be read by everyone who may run an import. The SHA-256 identifies
 * the file.
 */
export function inputFileOf(inputPath: string, sha256: string): InputFile {
  const extension = path.extname(inputPath).toLowerCase();
  return { name: /^\.[a-z0-9]{1,8}$/.test(extension) ? `input${extension}` : "input", sha256 };
}

/** Opens the Excel export that an input names. A failure is a structural issue of the source and never an exception. */
export function openWorkbook(input: ImportInput): OpenedWorkbook {
  const issue = (check: string, message: string, expected: string, found: string): StructureIssue => ({
    check,
    tabKey: null,
    message,
    expected,
    found,
  });
  if (!existsSync(input.path) || !statSync(input.path).isFile()) {
    return {
      contentHash: sha256OfBytes(new Uint8Array()),
      inputFiles: [],
      workbook: null,
      issues: [
        issue("input", "The input is not a file. Name the Excel export of the workbook.", "a file", "something else"),
      ],
    };
  }
  const bytes = readFileSync(input.path);
  const contentHash = sha256OfBytes(bytes);
  const inputFiles = [inputFileOf(input.path, contentHash)];
  try {
    return { contentHash, inputFiles, workbook: readWorkbook(bytes), issues: [] };
  } catch (error) {
    if (!(error instanceof WorkbookFormatError)) throw error;
    return {
      contentHash,
      inputFiles,
      workbook: null,
      issues: [
        issue(
          "format",
          "The input is no Excel workbook that the reader can open.",
          "an Excel workbook",
          "another format",
        ),
      ],
    };
  }
}

/** The rows of a sheet as raw cell records, for every row and column of the used range. */
export interface SheetGrid {
  /** The column letters of the used range, which are the names under which the cells are stored. */
  readonly labels: readonly string[];
  /** The raw cells of a row in the order of `labels`. */
  cells(row: number, formatting?: FormattingAsData): RawCell[];
  /** Whether a row holds a value, a formula or a link in any cell. */
  holdsContent(row: number): boolean;
  readonly lastRow: number;
}

export function gridOf(sheet: WorkbookSheet): SheetGrid {
  const byRow = cellsByRow(sheet);
  const columns = Array.from({ length: sheet.lastColumn }, (_unused, index) => index + 1);
  // The hidden state of a row is provenance of every workbook, so it is always captured. That of a column is
  // captured where the importer asks for it, which it does for the header record of a tab.
  const cells = (row: number, formatting: FormattingAsData = {}) =>
    columns.map((column) => rawCellOf(byRow.get(row)?.get(column), { hiddenRow: true, ...formatting }));
  return {
    labels: columns.map(columnLetters),
    cells,
    holdsContent: (row) => cells(row).some(holdsContent),
    lastRow: sheet.lastRow,
  };
}

/**
 * A tab that an importer does not know. Every row is captured as an annotation, keyed by its
 * content, and nothing in it is interpreted.
 */
export function uninterpretedTab(sheet: WorkbookSheet): SourceTab {
  const grid = gridOf(sheet);
  const unkeyed = new Map<string, number>();
  const rows: SourceRow[] = [];
  let blankRows = 0;
  for (let row = 1; row <= grid.lastRow; row += 1) {
    if (!grid.holdsContent(row)) {
      blankRows += 1;
      continue;
    }
    const cells = grid.cells(row);
    rows.push({
      rowClass: "annotation",
      rowNumber: row,
      rowKey: contentRowKey(cells, row, unkeyed),
      cells,
      labels: grid.labels,
    });
  }
  return {
    tabKey: sourceTabKey(sheet.name),
    name: sheet.name,
    visibility: sheet.visibility,
    ...(sheet.sheetId === "" ? {} : { sheetId: sheet.sheetId }),
    rows,
    fillerRows: 0,
    blankRows,
  };
}

/**
 * The rows that a validated range spans, when every cell of the range lies in one column.
 * Null for a range of another column, or of several.
 */
export function rowsInColumn(range: string, label: string): { readonly top: number; readonly bottom: number } | null {
  const match = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/.exec(range);
  if (match === null || match[1] !== label || (match[3] ?? label) !== label) return null;
  return { top: Number(match[2]), bottom: Number(match[4] ?? match[2]) };
}

/** The record of a cell of a row, by the name the row gives it. Null for an empty or absent cell. */
export function rawOf(row: SourceRow, label: string): RawCell {
  return row.cells[row.labels.indexOf(label)] ?? null;
}

const part = (cell: RawCell, key: string): RawScalar =>
  cell !== null && typeof cell === "object" ? (cell[key] ?? null) : null;

/** The hyperlink target of a cell, or null. */
export function linkOf(row: SourceRow, label: string): string | null {
  const target = part(rawOf(row, label), "l");
  return typeof target === "string" && target !== "" ? target : null;
}

/** The formula text of a cell, or null for a typed value. */
export function formulaOf(row: SourceRow, label: string): string | null {
  const formula = part(rawOf(row, label), "f");
  return typeof formula === "string" ? formula : null;
}

/** Whether a cell carries a formatting flag that the importer asked to be captured, such as `bold` or `hiddenRow`. */
export function flagOf(row: SourceRow, label: string, key: string): boolean {
  return part(rawOf(row, label), key) === true;
}

/** The number of a numeric cell, or null. A text that looks like a number is no number. */
export function numberOf(row: SourceRow, label: string): number | null {
  const value = cellValue(row, label);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The normalised copy of a text, for matching and change detection: NFC, runs of white space as one space, trimmed. */
export function collapsed(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** A text as an entity stores it: NFC, without the white space around it. Line breaks inside it are kept. */
export function tidied(text: string): string {
  return text.normalize("NFC").trim();
}

/** The text of a header cell as headers are compared: collapsed, with its case preserved. Empty for no header. */
export function headerText(value: RawScalar): string {
  return typeof value === "string" ? collapsed(value) : "";
}

/** Every number that a text contains: a run of digits with an optional decimal part, or a decimal part alone. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?|\.\d+/g)].map((match) => match[0]);
}

/**
 * The number that a text states, when it contains exactly one. `~40 mins` gives 40, and
 * `17 (+3 excluded)`, `2: P4-P3` and a text without a digit give null: no number is ever picked
 * out of several.
 */
export function singleNumberOf(text: string): number | null {
  const found = numbersIn(text);
  const [only] = found;
  return found.length === 1 && only !== undefined ? Number(only) : null;
}

/**
 * What a cell says where a value was expected and none is given.
 *
 * | Reading         | Cells                                                    |
 * |-----------------|----------------------------------------------------------|
 * | `empty`         | A blank cell, or one that holds white space alone        |
 * | `noneStated`    | `-`, `no`, `none`, `n/a` and `not included`, in any case |
 * | `unknownStated` | `unknown` and `?`                                        |
 *
 * Null for a cell that states something else. An empty cell is never read as `noneStated`.
 */
export type NullLike = "empty" | "noneStated" | "unknownStated";

/** A hyphen, an en dash or an em dash alone, and the words that say that there is nothing. */
const NONE_TOKENS = new Set(["-", "\u2013", "\u2014", "no", "none", "n/a", "na", "not included"]);
const UNKNOWN_TOKENS = new Set(["unknown", "?", "not known", "not reported"]);

export function nullLikeOf(text: string | null): NullLike | null {
  const token = collapsed(text ?? "").toLowerCase();
  if (token === "") return "empty";
  if (NONE_TOKENS.has(token)) return "noneStated";
  if (UNKNOWN_TOKENS.has(token)) return "unknownStated";
  return null;
}

/** The terms of a keyword cell. It is split on commas only, because `/`, `+` and `-` occur inside terms. */
export function termsOf(text: string | null): string[] {
  return (text ?? "")
    .split(",")
    .map(collapsed)
    .filter((term) => term !== "");
}

/** The type under which the options of a validated list are stored as an annotation of their tab. */
const LIST_VALIDATION = "listValidation";

/**
 * The lists that a sheet validates its cells against, each as an annotation of the tab: the
 * ranges are the name of the cell and the options, verbatim, its value. A source states its
 * vocabulary in such a list, which the plan stage reads back with `validatedLists`.
 */
export function validationRows(sheet: Pick<WorkbookSheet, "validations">): SourceRow[] {
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  for (const rule of sheet.validations) {
    if (rule.options === null || rule.ranges.length === 0) continue;
    const ranges = rule.ranges.join(" ");
    const options = JSON.stringify(rule.options);
    const rowKey = `validation__${shortHash(`${ranges}\n${options}`)}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    rows.push({
      rowClass: "annotation",
      rowNumber: 1,
      rowKey,
      cells: [{ v: options, t: LIST_VALIDATION }],
      labels: [ranges],
      cellLevel: true,
    });
  }
  return rows;
}

export interface ValidatedList {
  /** The ranges the list applies to, for example `F2:F39`. */
  readonly ranges: readonly string[];
  /** The options, verbatim and in the order of the source. */
  readonly options: readonly string[];
  readonly row: SourceRow;
}

/** The validated lists among the stored rows of a tab. */
export function validatedLists<Row extends SourceRow>(rows: readonly Row[]): (ValidatedList & { readonly row: Row })[] {
  const lists: (ValidatedList & { readonly row: Row })[] = [];
  for (const row of rows) {
    const [cell] = row.cells;
    const [label] = row.labels;
    if (row.cellLevel !== true || label === undefined || part(cell ?? null, "t") !== LIST_VALIDATION) continue;
    const options: unknown = JSON.parse(String(part(cell ?? null, "v")));
    if (!Array.isArray(options)) continue;
    lists.push({ ranges: label.split(" "), options: options.map(String), row });
  }
  return lists;
}

/** Whether a row is the annotation of a validated list, as opposed to a cell of the sheet. */
export function isValidationRow(row: SourceRow): boolean {
  return row.cellLevel === true && part(row.cells[0] ?? null, "t") === LIST_VALIDATION;
}
