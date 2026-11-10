// The reader of a recruitment and contact workbook (docs/MIGRATION_PLAN.md, section 4.6): two
// summary tabs with one row for each study, and outreach tabs with one row for each person who
// was contacted. A tab is recognised by its headers, and the source key is a parameter, so a
// second workbook of the same layout is read by the same code.
//
// | Kind       | Recognised by                                                        | Rows                                           |
// |------------|----------------------------------------------------------------------|------------------------------------------------|
// | `counts`   | Row 1 holds the seven headers of the counts, each once               | Study rows down to the first blank identifier, then derived rows. Cells under no header are annotations |
// | `leads`    | Row 1 holds `StudyID`, `Old leader`, `Leader` and `Email`, each once | Study rows                                     |
// | `outreach` | A row among the first ten whose first six cells are the six outreach headers | Preamble lines above the header, then contacts and annotations to the end of the used range |
// | `unknown`  | Nothing of the above                                                 | Every row with content, as an annotation       |
//
// Nearly everything in such a workbook is personal. A row key that is built from a name is a
// keyed hash, and nothing here writes a name, an address or the content of a cell to a message.
import { existsSync, readFileSync, statSync } from "node:fs";
import { keyedShortHash, LIMITS, lookupFold, outreachNameHash, sourceTabKey } from "@eegml/shared";
import { type FormattingAsData, holdsContent, rawCellOf } from "./cells";
import type { ImportInput, RawCell, ReadContext, SourceReading, SourceRow, SourceTab, StructureIssue } from "./model";
import { WorkbookFormatError } from "./ooxml";
import { classifyNameCell, type NameCellClass, textOf } from "./recruitment-values";
import { canonicalJson, positionFree, sha256OfBytes } from "./values";
import {
  cellsByRow,
  columnLetters,
  parseRef,
  readWorkbook,
  type Workbook,
  type WorkbookCell,
  type WorkbookSheet,
} from "./workbook";
import { inputFileOf } from "./workbook-rows";

export type RecruitmentTabKind = "counts" | "leads" | "outreach";
export type DetectedTabKind = RecruitmentTabKind | "unknown";

/** The headers of the counts tab, by the metric or the field that each feeds. */
export const COUNT_HEADERS = {
  study: "StudyID",
  leader: "Leader",
  nLabsSigned: "NLabsSigned",
  totalNToBeRun: "TotalNSubjectsToBeRun",
  nLabsFinished: "NLabsFinished",
  totalNMainCollected: "TotalNMainExpCollected",
  totalNRest: "TotalNRest",
} as const;

/** The headers of the tab that lists the leads with their addresses. */
export const LEAD_HEADERS = { study: "StudyID", oldLeader: "Old leader", leader: "Leader", email: "Email" } as const;

/** The six headers of an outreach tab, in their order, as they are compared: trimmed and in lower case. */
export const OUTREACH_HEADERS = [
  "contact name",
  "contact email",
  "date email sent first time",
  "date follow-up email sent",
  "result",
  "notes",
] as const;

/** The last row in which the header of an outreach tab is looked for, below a preamble of a few lines. */
const OUTREACH_HEADER_SEARCH_ROWS = 10;

/** The key of the record that describes a tab: its title, its visibility, its colour and its kind. */
export const TAB_RECORD_KEY = "tab";

/**
 * The key of a row below the header of an outreach tab. The prefix says what the row is, and
 * the rest is a keyed hash with an ordinal, so that neither a name nor a row number is part of it.
 */
export const OUTREACH_ROW_PREFIX: Readonly<Record<NameCellClass, string>> = {
  contact: "contact",
  sectionLabel: "label",
  recipientList: "list",
  severalPeople: "people",
  freeText: "note",
  empty: "stray",
};

/** The kinds of line that stand above the header of an outreach tab, by the prefix that each begins with. */
export const PREAMBLE_PREFIXES = {
  lead: "Lead Replicating Lab:",
  leadSearch: "A search of Lead Replicating Lab",
  labSearch: "A search of Replicating Labs",
  study: "Study:",
} as const;
export type PreambleKind = keyof typeof PREAMBLE_PREFIXES | "other";

/** What a preamble line is, by its fixed prefix. The longer prefix of the two searches is tested first. */
export function preambleKindOf(text: string): PreambleKind {
  const trimmed = text.trim();
  if (trimmed.startsWith(PREAMBLE_PREFIXES.lead)) return "lead";
  if (trimmed.startsWith(PREAMBLE_PREFIXES.leadSearch)) return "leadSearch";
  if (trimmed.startsWith(PREAMBLE_PREFIXES.labSearch)) return "labSearch";
  if (trimmed.startsWith(PREAMBLE_PREFIXES.study)) return "study";
  return "other";
}

const header = (cell: WorkbookCell | undefined): string => (typeof cell?.value === "string" ? cell.value.trim() : "");

/** Whether each of the wanted headers stands in the row exactly once. */
function holdsEachOnce(found: readonly string[], wanted: readonly string[]): boolean {
  return wanted.every((text) => found.filter((candidate) => candidate === text).length === 1);
}

interface Detected {
  readonly kind: DetectedTabKind;
  readonly headerRow?: number;
}

function detect(sheet: WorkbookSheet, byRow: Map<number, Map<number, WorkbookCell>>): Detected {
  const first = [...(byRow.get(1)?.values() ?? [])].map(header).filter((text) => text !== "");
  if (holdsEachOnce(first, Object.values(COUNT_HEADERS))) return { kind: "counts", headerRow: 1 };
  if (holdsEachOnce(first, Object.values(LEAD_HEADERS))) return { kind: "leads", headerRow: 1 };
  for (let row = 1; row <= Math.min(sheet.lastRow, OUTREACH_HEADER_SEARCH_ROWS); row += 1) {
    const cells = byRow.get(row);
    if (OUTREACH_HEADERS.every((text, index) => header(cells?.get(index + 1)).toLowerCase() === text)) {
      return { kind: "outreach", headerRow: row };
    }
  }
  return { kind: "unknown" };
}

/** The merged range that contains each cell of a sheet, by address. */
function mergedRangeOf(sheet: WorkbookSheet): Map<string, string> {
  const ranges = new Map<string, string>();
  for (const range of sheet.mergedRanges) {
    const [first = "", last = first] = range.split(":");
    const start = parseRef(first);
    const end = parseRef(last);
    for (let row = start.row; row <= end.row; row += 1) {
      for (let column = start.column; column <= end.column; column += 1) {
        ranges.set(`${columnLetters(column)}${row}`, range);
      }
    }
  }
  return ranges;
}

class TabReader {
  readonly #sheet: WorkbookSheet;
  readonly #secret: string;
  readonly #byRow: Map<number, Map<number, WorkbookCell>>;
  readonly #merges: Map<string, string>;
  readonly #rows: SourceRow[] = [];
  readonly #ordinals = new Map<string, number>();
  #blankRows = 0;

  constructor(sheet: WorkbookSheet, secret: string) {
    this.#sheet = sheet;
    this.#secret = secret;
    this.#byRow = cellsByRow(sheet);
    this.#merges = mergedRangeOf(sheet);
  }

  /** The record of one cell with the formatting that this kind of workbook uses as data. */
  #raw(row: number, column: number, formatting: FormattingAsData): RawCell {
    const cell = this.#byRow.get(row)?.get(column);
    const raw = rawCellOf(cell, formatting);
    const range = formatting.merge ? this.#merges.get(`${columnLetters(column)}${row}`) : undefined;
    // A cell that a merged range covers may not exist in the file. Its place in the range is still recorded.
    if (raw === null) return range === undefined ? null : { v: null, t: "empty", merge: range };
    if (typeof raw !== "object" || cell === undefined) return raw;
    // The file stores whole numbers with a fraction, as in `8.0`. The characters are kept beside the number.
    const characters =
      cell.type === "number" && cell.rawValue !== null && cell.rawValue !== String(cell.value) ? cell.rawValue : null;
    return characters === null ? raw : { ...raw, r: characters };
  }

  #cells(row: number, columns: readonly number[], formatting: FormattingAsData): RawCell[] {
    return columns.map((column) => this.#raw(row, column, formatting));
  }

  /** A key with an ordinal among the rows of the tab that share its stem, from 1. */
  #keyed(stem: string): string {
    const ordinal = (this.#ordinals.get(stem) ?? 0) + 1;
    this.#ordinals.set(stem, ordinal);
    return `${stem}__${ordinal}`;
  }

  /** The key of a row that has no natural key: a keyed hash of its content, since the content may be personal. */
  #contentKey(prefix: string, cells: readonly RawCell[], row: number): string {
    // The content is taken without the numbers of rows, so that a line inserted above gives the row no new key.
    return this.#keyed(`${prefix}__${keyedShortHash(canonicalJson(positionFree(cells, row)), this.#secret)}`);
  }

  #push(row: SourceRow): void {
    this.#rows.push(row);
  }

  #columns(): number[] {
    return Array.from({ length: this.#sheet.lastColumn }, (_unused, index) => index + 1);
  }

  /** The key of a study row: the lookup fold of its identifier cell, where that is usable and not taken. */
  #studyKey(cell: RawCell, record: readonly RawCell[], taken: Set<string>, row: number): string {
    const folded = lookupFold(textOf(cell) ?? "");
    if (folded === "" || folded.length > LIMITS.shortText || taken.has(folded))
      return this.#contentKey("row", record, row);
    taken.add(folded);
    return folded;
  }

  #counts(): void {
    const formatting = { strike: true, hiddenRow: true } as const;
    const all = this.#columns();
    const headers = new Map(all.map((column) => [column, header(this.#byRow.get(1)?.get(column))]));
    const headed = all.filter((column) => headers.get(column) !== "");
    const labels = headed.map(columnLetters);
    const studyColumn = headed.find((column) => headers.get(column) === COUNT_HEADERS.study) ?? 1;
    // The cell of the leader names a person. No identifier that the plan derives from the row may hold a word of it.
    const personal = headed.filter((column) => headers.get(column) === COUNT_HEADERS.leader).map(columnLetters);
    this.#push({
      rowClass: "header",
      rowNumber: 1,
      rowKey: "header",
      cells: this.#cells(1, all, { ...formatting, hidden: true }),
      labels: all.map(columnLetters),
    });
    const taken = new Set<string>();
    let inStudies = true;
    for (let row = 2; row <= this.#sheet.lastRow; row += 1) {
      // A cell under no header belongs to no study. It is captured by itself, as an annotation of the tab.
      let strays = 0;
      for (const column of all.filter((candidate) => !headed.includes(candidate))) {
        const stray = this.#raw(row, column, formatting);
        if (!holdsContent(stray)) continue;
        strays += 1;
        this.#push({
          rowClass: "annotation",
          rowNumber: row,
          rowKey: this.#contentKey(`side__${columnLetters(column)}`, [stray], row),
          cells: [stray],
          labels: [columnLetters(column)],
          cellLevel: true,
        });
      }
      const record = this.#cells(row, headed, formatting);
      const study = record[headed.indexOf(studyColumn)] ?? null;
      const hasStudy = (textOf(study) ?? "").trim() !== "";
      if (!record.some(holdsContent)) {
        // The study rows end at the first blank identifier, also where only a cell beside the table is filled.
        inStudies = false;
        if (strays === 0) this.#blankRows += 1;
        continue;
      }
      if (inStudies && hasStudy) {
        this.#push({
          rowClass: "data",
          rowNumber: row,
          rowKey: this.#studyKey(study, record, taken, row),
          cells: record,
          labels,
          personal,
        });
        continue;
      }
      inStudies = false;
      // Below the study rows stand the totals: rows that are computed and are never imported as data.
      const computed = record.some((cell) => typeof cell === "object" && cell !== null && cell.f !== undefined);
      // Such a row is keyed by its label, so that a total that changes is a new revision of the same row.
      const label = lookupFold(record.map(textOf).find((text) => text !== null && Number.isNaN(Number(text))) ?? "");
      this.#push({
        rowClass: computed && !hasStudy ? "derived" : "annotation",
        rowNumber: row,
        rowKey:
          label === ""
            ? this.#contentKey("below", record, row)
            : this.#keyed(`below__${keyedShortHash(label, this.#secret)}`),
        cells: record,
        labels,
      });
    }
  }

  #leads(): void {
    const formatting = { strike: true, hiddenRow: true } as const;
    const all = this.#columns();
    const labels = all.map(columnLetters);
    const headers = all.map((column) => header(this.#byRow.get(1)?.get(column)));
    const studyColumn = all[headers.indexOf(LEAD_HEADERS.study)] ?? 1;
    // Every cell of a row except its study names a person or holds an address, the cells under no header included.
    const personal = labels.filter((_label, index) => headers[index] !== LEAD_HEADERS.study);
    this.#push({
      rowClass: "header",
      rowNumber: 1,
      rowKey: "header",
      cells: this.#cells(1, all, { ...formatting, hidden: true }),
      labels,
    });
    const taken = new Set<string>();
    for (let row = 2; row <= this.#sheet.lastRow; row += 1) {
      // The cell beside the address column belongs to its row, so the whole width of the row is one record.
      const record = this.#cells(row, all, formatting);
      if (!record.some(holdsContent)) {
        this.#blankRows += 1;
        continue;
      }
      const study = record[all.indexOf(studyColumn)] ?? null;
      const hasStudy = (textOf(study) ?? "").trim() !== "";
      this.#push({
        rowClass: hasStudy ? "data" : "annotation",
        rowNumber: row,
        rowKey: hasStudy ? this.#studyKey(study, record, taken, row) : this.#contentKey("row", record, row),
        cells: record,
        labels,
        ...(hasStudy ? { personal } : {}),
      });
    }
  }

  #outreach(headerRow: number): void {
    const formatting = { strike: true, fill: true, merge: true, hiddenRow: true } as const;
    const width = Math.max(this.#sheet.lastColumn, OUTREACH_HEADERS.length);
    const all = Array.from({ length: width }, (_unused, index) => index + 1);
    const labels = all.map(columnLetters);
    for (let row = 1; row < headerRow; row += 1) {
      const record = this.#cells(row, all, formatting);
      if (!record.some(holdsContent)) {
        this.#blankRows += 1;
        continue;
      }
      // A line of the preamble is keyed by its kind, so that a corrected line is a new revision of the same row.
      const kind = preambleKindOf(textOf(record[0]) ?? "");
      const ordinal = (this.#ordinals.get(`preamble__${kind}`) ?? 0) + 1;
      this.#ordinals.set(`preamble__${kind}`, ordinal);
      this.#push({
        rowClass: "banner",
        rowNumber: row,
        rowKey: ordinal === 1 ? `preamble__${kind}` : `preamble__${kind}__${ordinal}`,
        cells: record,
        labels,
      });
    }
    this.#push({
      rowClass: "header",
      rowNumber: headerRow,
      rowKey: "header",
      cells: this.#cells(headerRow, all, { ...formatting, hidden: true }),
      labels,
    });
    // Blank rows occur inside the data, so every row is read down to the end of the used range.
    for (let row = headerRow + 1; row <= this.#sheet.lastRow; row += 1) {
      const record = this.#cells(row, all, formatting);
      if (!record.some(holdsContent)) {
        this.#blankRows += 1;
        continue;
      }
      const name = textOf(record[0]);
      const kind = classifyNameCell(name, record.slice(1).some(holdsContent));
      const prefix = OUTREACH_ROW_PREFIX[kind];
      this.#push({
        rowClass: kind === "contact" ? "data" : "annotation",
        rowNumber: row,
        rowKey:
          kind === "empty"
            ? this.#contentKey(prefix, record, row)
            : this.#keyed(`${prefix}__${outreachNameHash(name ?? "", this.#secret)}`),
        cells: record,
        labels,
        // The name and the address of a contact.
        ...(kind === "contact" ? { personal: labels.slice(0, 2) } : {}),
      });
    }
  }

  #unknown(): void {
    const all = this.#columns();
    const labels = all.map(columnLetters);
    for (let row = 1; row <= this.#sheet.lastRow; row += 1) {
      const record = this.#cells(row, all, {});
      if (!record.some(holdsContent)) this.#blankRows += 1;
      else
        this.#push({
          rowClass: "annotation",
          rowNumber: row,
          rowKey: this.#contentKey("row", record, row),
          cells: record,
          labels,
        });
    }
  }

  read(date1904: boolean): SourceTab {
    const sheet = this.#sheet;
    const { kind, headerRow } = detect(sheet, this.#byRow);
    // What describes the tab itself is one record: a tab that is renamed, hidden or recoloured is a new revision of it.
    this.#push({
      rowClass: "annotation",
      rowNumber: 1,
      rowKey: TAB_RECORD_KEY,
      cells: [
        {
          v: sheet.name,
          t: "tab",
          kind,
          visibility: sheet.visibility,
          ...(sheet.tabColour === null ? {} : { tabColour: sheet.tabColour }),
          ...(date1904 ? { date1904: true } : {}),
        },
      ],
      labels: [TAB_RECORD_KEY],
      cellLevel: true,
    });
    if (kind === "counts") this.#counts();
    else if (kind === "leads") this.#leads();
    else if (kind === "outreach" && headerRow !== undefined) this.#outreach(headerRow);
    else this.#unknown();
    return {
      tabKey: sourceTabKey(sheet.name),
      name: sheet.name,
      visibility: sheet.visibility,
      ...(headerRow === undefined ? {} : { headerRow }),
      rows: this.#rows,
      fillerRows: 0,
      blankRows: this.#blankRows,
    };
  }
}

/**
 * Reads every tab of the workbook, hidden ones included, and classifies every row. The secret
 * keys the hashes that stand for names in row keys.
 */
export async function readRecruitmentWorkbook(input: ImportInput, context: ReadContext): Promise<SourceReading> {
  const issues: StructureIssue[] = [];
  const issue = (check: string, message: string, expected: string, found: string) =>
    issues.push({ check, tabKey: null, message, expected, found });
  if (!existsSync(input.path) || !statSync(input.path).isFile()) {
    issue("input", "The input is not a file. Name the Excel export of the workbook.", "a file", "something else");
    return { contentHash: sha256OfBytes(new Uint8Array()), inputFiles: [], tabs: [], issues };
  }
  const bytes = readFileSync(input.path);
  const contentHash = sha256OfBytes(bytes);
  const inputFiles = [inputFileOf(input.path, contentHash)];
  let workbook: Workbook;
  try {
    workbook = readWorkbook(bytes);
  } catch (error) {
    if (!(error instanceof WorkbookFormatError)) throw error;
    issue("format", "The input is no Excel workbook that the reader can open.", "an Excel workbook", "another format");
    return { contentHash, inputFiles, tabs: [], issues };
  }
  const tabs = workbook.sheets.map((sheet) => new TabReader(sheet, context.secret).read(workbook.date1904));
  return { contentHash, inputFiles, tabs, issues };
}
