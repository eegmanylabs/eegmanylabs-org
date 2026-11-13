// Source E: the prediction-market hypotheses (docs/MIGRATION_PLAN.md, section 4.4). One
// workbook with three tabs, addressed by their exact titles.
//
// | Tab                        | Rows                                   | Feeds                                             |
// |----------------------------|----------------------------------------|---------------------------------------------------|
// | `links_hypotheses`         | One hypothesis each, hidden rows included, and footer cells below them | Hypotheses, three links for each study and one for the programme, aliases, candidate values for the original study |
// | `review` (hidden)          | One study each                         | Source records, and the spellings of its identifiers as aliases |
// | `questions4MarketsNSurvey` | Headings, questions and answer options | Prediction-market items, with no link to a hypothesis |
//
// What the importer never does:
//
// | Never                                                          | Instead                                                        |
// |----------------------------------------------------------------|----------------------------------------------------------------|
// | Skip a hidden row                                              | Reads it as data and stores that it is hidden                  |
// | Read the text `null` as a missing value                        | Stores `null-sig` verbatim                                     |
// | Turn `replicated` into a boolean, a result or a status         | Keeps the label verbatim in the source record and in the sealed document of the replication, which programme administrators alone read (question 7), and queues it as an unverified label whose value the item does not show |
// | Take the address of a link from its label                      | Reads the hyperlink target of the cell                         |
// | Create a replication                                           | Resolves the identifier through the folded lookup, or queues the row |
// | Parse a footer counter                                         | Recounts from the data and reports a counter that disagrees    |
// | Show the status label that embeds a given name, or a review note | Leaves both in the source records and asks a reviewer        |
import {
  COLLECTIONS,
  documentLinkSlotId,
  doiSchema,
  type EntityRef,
  entityRefId,
  hypothesisId,
  LIMITS,
  lookupFold,
  nestedEntityId,
  PROGRAMME_KEY,
  PROGRAMME_SCOPE_KEY,
  predictionMarketItemId,
  replicationScopeKey,
  SEALED_OUTCOMES_DECISION,
  shortHash,
  sourceTabKey,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { readDocuments } from "../context";
import { addressesIn, doiOfAddress, doisIn } from "../doi";
import type {
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  PlanContext,
  RecordedRow,
  SourceReading,
  SourceRow,
  SourceTab,
  StructureIssue,
} from "../model";
import { PlanBuilder } from "../plan";
import type { ItemClaim } from "../reconcile";
import {
  aliasDocuments,
  cellText,
  cellValue,
  doiKey,
  doiLookupDocument,
  isStorableUrl,
  slotLinkDocument,
  VocabularyCollector,
} from "../records";
import { contentRowKey, sameValue } from "../values";
import type { WorkbookSheet } from "../workbook";
import {
  collapsed,
  flagOf,
  gridOf,
  headerText,
  linkOf,
  numberOf,
  openWorkbook,
  rawOf,
  rowsInColumn,
  tidied,
  uninterpretedTab,
  validatedLists,
  validationRows,
} from "../workbook-rows";

const SOURCE_KEY = "e";

/** The three tabs of the workbook by their exact titles. A missing, renamed or new tab stops the import. */
export const TAB_TITLES = {
  hypotheses: "links_hypotheses",
  review: "review",
  questions: "questions4MarketsNSurvey",
} as const;
type Tab = keyof typeof TAB_TITLES;
const TABS = Object.keys(TAB_TITLES) as readonly Tab[];
const tabKeyOf = (tab: Tab): string => sourceTabKey(TAB_TITLES[tab]);

/** The eleven headers of the hypotheses tab, which may stand in any order. */
const HYPOTHESIS_HEADERS = [
  "study_id",
  "studyDescr_pdf",
  "infosheet_link",
  "hypothesis_number",
  "hypothesis_text",
  "null-sig",
  "replicated",
  "authors",
  "year",
  "title",
  "citation",
] as const;
type HypothesisHeader = (typeof HYPOTHESIS_HEADERS)[number];

const REVIEW_HEADERS = ["study_id", "notes"] as const;
const QUESTION_HEADERS = ["Question about the specific paper", "Choices"] as const;

/**
 * The name under which the status column of the review tab is stored. Its header is blank, so
 * it is found by a stored rule that is checked again on every run: it is the one column between
 * `study_id` and `notes`, and every value in it begins with `checked_`.
 */
export const REVIEW_STATUS = "review_status";
const REVIEW_STATUS_PREFIX = "checked_";
/** The status values that name a pass and no person. Any other value is treated as naming somebody. */
const IMPERSONAL_STATUS = /^checked_pass\d+$/;

/** The shape of a study identifier after folding: letters, a year, and at most one letter. */
const FOLDED_STUDY_ID = /^[a-z]+[0-9]{4}[a-z]?$/;

/**
 * The labels of the two status columns as the workbook lists them today. A value outside the
 * list of the file, and an option of the file that is new here, are put to a reviewer.
 */
const KNOWN_OPTIONS: Readonly<Record<"null-sig" | "replicated", readonly string[]>> = {
  "null-sig": ["sig", "null"],
  replicated: ["no", "yes", "cancelled"],
};
/** The label that states no outcome: it says that something was called off. */
const CANCELLED = "cancelled";
/** The labels that state an outcome. */
const OUTCOME_LABELS: readonly string[] = ["yes", "no"];
/** The label of `null-sig` on which an outcome label has no defined meaning. */
const NULL_LABEL = "null";
/** The names of the public stage at which an outcome may be known. */
const FINISHED_STAGES: readonly string[] = ["finished"];

/** The column of each header of a header row, and the headers that stand there more than once. */
function columnsOf(header: SourceRow | undefined) {
  const columns = new Map<string, string>();
  const repeated = new Set<string>();
  for (const label of header?.labels ?? []) {
    const text = header === undefined ? "" : headerText(cellValue(header, label));
    if (text === "") continue;
    if (columns.has(text)) repeated.add(text);
    else columns.set(text, label);
  }
  return { columns, repeated };
}

function requireHeaders(
  tabKey: string,
  required: readonly string[],
  found: ReturnType<typeof columnsOf>,
  issues: StructureIssue[],
): void {
  const missing = required.filter((header) => !found.columns.has(header));
  const twice = required.filter((header) => found.repeated.has(header));
  if (missing.length === 0 && twice.length === 0) return;
  issues.push({
    check: "header",
    tabKey,
    message: "Row 1 does not hold each of the expected headers exactly once.",
    expected: required.join(" | "),
    found: `missing: ${missing.join(" | ") || "none"}; twice: ${twice.join(" | ") || "none"}`,
  });
}

function tabOf(sheet: WorkbookSheet, tab: Tab, headerRow: number, rows: SourceRow[], blankRows: number): SourceTab {
  return {
    tabKey: tabKeyOf(tab),
    name: sheet.name,
    visibility: sheet.visibility,
    ...(sheet.sheetId === "" ? {} : { sheetId: sheet.sheetId }),
    headerRow,
    rows: [...rows, ...validationRows(sheet)],
    fillerRows: 0,
    blankRows,
  };
}

function readHypotheses(sheet: WorkbookSheet, issues: StructureIssue[]): SourceTab {
  const tabKey = tabKeyOf("hypotheses");
  const grid = gridOf(sheet);
  const { labels } = grid;
  // The hidden state of every row is stored with its cells, because hidden rows are data here.
  const record = (row: number) => grid.cells(row, { hidden: true });
  const header: SourceRow = { rowClass: "header", rowNumber: 1, rowKey: "header", cells: record(1), labels };
  const found = columnsOf(header);
  requireHeaders(tabKey, HYPOTHESIS_HEADERS, found, issues);
  const mapped = new Set(HYPOTHESIS_HEADERS.flatMap((name) => found.columns.get(name) ?? []));
  const stray = new Set<string>();
  for (let row = 1; row <= grid.lastRow; row += 1) {
    grid.cells(row).forEach((cell, index) => {
      const label = labels[index];
      if (cell !== null && label !== undefined && !mapped.has(label)) stray.add(label);
    });
  }
  if (stray.size > 0) {
    // A column beyond the eleven has gained a header or a value, so a field has appeared that nothing here reads.
    issues.push({
      check: "columns",
      tabKey,
      message: "A column other than the eleven expected ones holds a header or a value.",
      expected: `${HYPOTHESIS_HEADERS.length} columns`,
      found: `${stray.size} further columns with content`,
    });
  }

  const rows: SourceRow[] = [header];
  const idColumn = found.columns.get("study_id");
  const numberColumn = found.columns.get("hypothesis_number");
  const keys = new Map<string, number>();
  const unkeyed = new Map<string, number>();
  let blankRows = 0;
  let lastDataRow = 1;
  let inData = true;
  for (let row = 2; row <= grid.lastRow; row += 1) {
    const draft: SourceRow = { rowClass: "data", rowNumber: row, rowKey: "", cells: record(row), labels };
    const folded = idColumn === undefined ? "" : lookupFold(cellText(draft, idColumn) ?? "");
    const number = numberColumn === undefined ? null : numberOf(draft, numberColumn);
    // Data rows end at the first row that fails the test. Whatever stands below is a footer.
    inData &&= FOLDED_STUDY_ID.test(folded) && number !== null;
    if (inData && number !== null) {
      // A number that is no whole number still keys its row. The plan stage then stops the import.
      const whole = Number.isInteger(number) && number >= 1 && number <= 99;
      const natural = `${folded}__${whole ? hypothesisId(number) : `h${number}`}`;
      const repeat = (keys.get(natural) ?? 0) + 1;
      keys.set(natural, repeat);
      rows.push({ ...draft, rowKey: repeat > 1 ? `${natural}__${repeat}` : natural });
      lastDataRow = row;
    } else if (grid.holdsContent(row)) {
      rows.push({ ...draft, rowClass: "annotation", rowKey: contentRowKey(draft.cells, draft.rowNumber, unkeyed) });
    } else blankRows += 1;
  }

  // The ranges over which the two status columns are validated are a second statement of where the data ends.
  for (const name of ["null-sig", "replicated"] as const) {
    const label = found.columns.get(name) ?? "";
    // One list may be written as several rules, each over a part of the column.
    const spans = sheet.validations.flatMap((rule) => {
      const within = rule.ranges.flatMap((range) => rowsInColumn(range, label) ?? []);
      return rule.options !== null && within.length === rule.ranges.length ? within : [];
    });
    if (spans.length === 0) continue;
    const top = Math.min(...spans.map((span) => span.top));
    const bottom = Math.max(...spans.map((span) => span.bottom));
    if (top === 2 && bottom === lastDataRow) continue;
    issues.push({
      check: "extent",
      tabKey,
      message: `The rows over which the column ${name} is validated are not the rows that hold hypotheses.`,
      expected: `rows 2 to ${lastDataRow}`,
      found: `rows ${top} to ${bottom}`,
    });
  }
  return tabOf(sheet, "hypotheses", 1, rows, blankRows);
}

function readReview(sheet: WorkbookSheet, issues: StructureIssue[]): SourceTab {
  const tabKey = tabKeyOf("review");
  const grid = gridOf(sheet);
  const letters = grid.labels;
  const first: SourceRow = {
    rowClass: "header",
    rowNumber: 1,
    rowKey: "header",
    cells: grid.cells(1, { hidden: true }),
    labels: letters,
  };
  const found = columnsOf(first);
  requireHeaders(tabKey, REVIEW_HEADERS, found, issues);

  // The stored rule for the column without a header, checked against what the column holds today.
  const from = letters.indexOf(found.columns.get("study_id") ?? "");
  const to = letters.indexOf(found.columns.get("notes") ?? "");
  const between = from >= 0 && to > from ? letters.slice(from + 1, to) : [];
  const [only] = between;
  const held: unknown[] = [];
  for (let row = 2; row <= grid.lastRow && only !== undefined; row += 1) {
    const cell = grid.cells(row)[letters.indexOf(only)] ?? null;
    if (cell !== null) held.push(typeof cell === "object" ? cell.v : cell);
  }
  const status =
    between.length === 1 &&
    only !== undefined &&
    headerText(cellValue(first, only)) === "" &&
    held.length > 0 &&
    held.every((value) => typeof value === "string" && value.startsWith(REVIEW_STATUS_PREFIX))
      ? only
      : null;
  const labels = letters.map((label) => (label === status ? REVIEW_STATUS : label));
  const header: SourceRow = {
    ...first,
    labels,
    // The header of the status column is blank in the source, which its record says.
    cells: first.cells.map((cell, index) =>
      labels[index] === REVIEW_STATUS ? { v: null, t: "empty", headerBlank: true } : cell,
    ),
  };

  const rows: SourceRow[] = [header];
  const idColumn = found.columns.get("study_id");
  const keys = new Map<string, number>();
  const unkeyed = new Map<string, number>();
  let blankRows = 0;
  for (let row = 2; row <= grid.lastRow; row += 1) {
    if (!grid.holdsContent(row)) {
      blankRows += 1;
      continue;
    }
    const draft: SourceRow = { rowClass: "data", rowNumber: row, rowKey: "", cells: grid.cells(row), labels };
    const folded = idColumn === undefined ? "" : lookupFold(cellText(draft, idColumn) ?? "");
    if (folded === "" || folded.length > LIMITS.shortText) {
      // A row that names no study is no record of the tab. It is kept for a reviewer to place.
      rows.push({ ...draft, rowClass: "annotation", rowKey: contentRowKey(draft.cells, draft.rowNumber, unkeyed) });
      continue;
    }
    const repeat = (keys.get(folded) ?? 0) + 1;
    keys.set(folded, repeat);
    rows.push({ ...draft, rowKey: repeat > 1 ? `${folded}__${repeat}` : folded });
  }
  return tabOf(sheet, "review", 1, rows, blankRows);
}

function readQuestions(sheet: WorkbookSheet, issues: StructureIssue[]): SourceTab {
  const tabKey = tabKeyOf("questions");
  const grid = gridOf(sheet);
  const { labels } = grid;
  // Headings, questions and options share one column and are told apart by font, so the font is stored.
  const record = (row: number) => grid.cells(row, { font: true });
  const header: SourceRow = { rowClass: "header", rowNumber: 1, rowKey: "header", cells: record(1), labels };
  const found = columnsOf(header);
  requireHeaders(tabKey, QUESTION_HEADERS, found, issues);
  const questionColumn = found.columns.get(QUESTION_HEADERS[0]);
  const choicesColumn = found.columns.get(QUESTION_HEADERS[1]);

  const rows: SourceRow[] = [header];
  const repeats = new Map<string, number>();
  const unkeyed = new Map<string, number>();
  // The header of the question column doubles as the title of the first section.
  let section = questionColumn === undefined ? "" : headerText(cellValue(header, questionColumn));
  let blankRows = 0;
  for (let row = 2; row <= grid.lastRow; row += 1) {
    if (!grid.holdsContent(row)) {
      blankRows += 1;
      continue;
    }
    const draft: SourceRow = { rowClass: "data", rowNumber: row, rowKey: "", cells: record(row), labels };
    const question = collapsed(questionColumn === undefined ? "" : (cellText(draft, questionColumn) ?? ""));
    if (question === "") {
      rows.push({ ...draft, rowClass: "annotation", rowKey: contentRowKey(draft.cells, draft.rowNumber, unkeyed) });
      continue;
    }
    const choices = choicesColumn === undefined ? "" : collapsed(cellText(draft, choicesColumn) ?? "");
    // A row in bold with no choices opens a section. Nothing else about a row is guessed.
    const heading = choices === "" && questionColumn !== undefined && flagOf(draft, questionColumn, "bold");
    const within = heading ? "" : section;
    const pair = `${within}\n${question}`;
    const ordinal = (repeats.get(pair) ?? 0) + 1;
    repeats.set(pair, ordinal);
    rows.push({ ...draft, rowKey: predictionMarketItemId(within, question, ordinal) });
    if (heading) section = question;
  }
  return tabOf(sheet, "questions", 1, rows, blankRows);
}

async function read(input: ImportInput): Promise<SourceReading> {
  const opened = openWorkbook(input);
  const { contentHash, inputFiles } = opened;
  if (opened.workbook === null) return { contentHash, inputFiles, tabs: [], issues: opened.issues };
  const issues: StructureIssue[] = [];
  const titles = opened.workbook.sheets.map((sheet) => sheet.name);
  const expected = TABS.map((tab) => TAB_TITLES[tab]);
  const unknown = titles.filter((title) => !expected.some((known) => known === title));
  if (
    expected.some((title) => !titles.includes(title)) ||
    unknown.length > 0 ||
    new Set(titles).size !== titles.length
  ) {
    issues.push({
      check: "tabs",
      tabKey: null,
      message: "The workbook does not hold exactly its three known tabs: one is missing, renamed or new.",
      expected: expected.join(" | "),
      found: titles.join(" | "),
    });
  }
  const readers = { hypotheses: readHypotheses, review: readReview, questions: readQuestions };
  const seen = new Set<string>();
  const tabs: SourceTab[] = [];
  for (const sheet of opened.workbook.sheets) {
    // Two sheets of one title cannot be told apart by their key, so only the first is read.
    if (seen.has(sheet.name)) continue;
    seen.add(sheet.name);
    const tab = TABS.find((candidate) => TAB_TITLES[candidate] === sheet.name);
    tabs.push(tab === undefined ? uninterpretedTab(sheet) : readers[tab](sheet, issues));
  }
  return { contentHash, inputFiles, tabs, issues };
}

const replication = (studyId: string) => ({ entityType: "replication", entityId: studyId }) as const;

/** One row of the hypotheses tab, read under the rules of the plan. */
interface HypothesisRow {
  readonly row: RecordedRow;
  /** The identifier as the row writes it. */
  readonly study: string;
  readonly number: number;
  readonly hidden: boolean;
  /** The label of `replicated`, verbatim. Null for a blank cell, which is never read as `no`. */
  readonly replicated: string | null;
}

interface Study {
  readonly replicationId: string;
  readonly rows: HypothesisRow[];
  /** The stored replication, which this source updates and never creates. */
  readonly stored: Readonly<Record<string, unknown>>;
}

class PredictionMarketPlan {
  readonly #context: PlanContext;
  readonly #db: Firestore;
  readonly #builder = new PlanBuilder();
  readonly #terms = new VocabularyCollector();
  readonly #source = `${SOURCE_KEY}/hypotheses`;
  #columns = new Map<string, string>();

  constructor(context: PlanContext) {
    this.#context = context;
    this.#db = context.db;
  }

  #stored(tab: Tab): readonly RecordedRow[] {
    return this.#context.rows.get(tabKeyOf(tab)) ?? [];
  }

  #data(tab: Tab): readonly RecordedRow[] {
    return this.#stored(tab).filter((row) => row.rowClass === "data");
  }

  #header(tab: Tab): RecordedRow | undefined {
    return this.#stored(tab).find((row) => row.rowClass === "header");
  }

  /** The column of a header of the hypotheses tab. */
  #column(name: HypothesisHeader): string {
    return this.#columns.get(name) ?? "";
  }

  #text(row: RecordedRow, name: HypothesisHeader): string | null {
    return cellText(row, this.#column(name));
  }

  async build(): Promise<ImportPlan> {
    const programme = await this.#db.doc(COLLECTIONS.programmes.docPath(PROGRAMME_KEY)).get();
    if (!programme.exists) {
      this.#builder.block(
        "lookups",
        "The programme document does not exist, so the link of the programme would refer to nothing. Run seed:lookups first.",
      );
      return this.#builder.build();
    }
    const header = this.#header("hypotheses");
    this.#columns = columnsOf(header).columns;
    const rows = this.#hypothesisRows();
    const studies = rows === null ? null : await this.#studies(rows);
    if (rows === null || studies === null) return this.#builder.build();

    for (const study of studies) await this.#study(study);
    this.#vocabulary(rows);
    this.#footer(rows);
    await this.#review();
    this.#questions();
    this.#terms.documents(this.#builder);
    return this.#builder.build();
  }

  /** States that a check of the source has failed, with the rows concerned. No content of a cell is quoted. */
  #block(check: string, message: string, rows: readonly RecordedRow[]): void {
    this.#builder.block(
      check,
      message,
      this.#context.items.structureChange({
        subject: `${this.#source}/${check}`,
        blocking: true,
        claims: rows.slice(0, 100).map((row) => ({
          source: `${this.#source}/${check}`,
          value: row.rowKey,
          sourceRecordId: row.recordId,
        })),
      }),
    );
  }

  /**
   * Reads the data rows and runs the checks that an apply depends on: numbers that are whole,
   * values of a study that are the same on each of its rows, and a year that agrees with the
   * identifier. Returns null where a check has failed.
   */
  #hypothesisRows(): HypothesisRow[] | null {
    const data = this.#data("hypotheses");
    const parsed: HypothesisRow[] = [];
    const fractional: RecordedRow[] = [];
    for (const row of data) {
      const number = numberOf(row, this.#column("hypothesis_number"));
      if (number === null || !Number.isInteger(number) || number < 1 || number > 99) {
        fractional.push(row);
        continue;
      }
      const label = this.#text(row, "replicated");
      parsed.push({
        row,
        study: tidied(this.#text(row, "study_id") ?? ""),
        number,
        hidden: row.labels.some((name) => flagOf(row, name, "hiddenRow")),
        replicated: label === null || collapsed(label) === "" ? null : label,
      });
    }
    if (fractional.length > 0) {
      this.#block("number", "A hypothesis number is no whole number from 1 to 99.", fractional);
    }

    const byStudy = new Map<string, HypothesisRow[]>();
    for (const entry of parsed) {
      const key = lookupFold(entry.study);
      byStudy.set(key, [...(byStudy.get(key) ?? []), entry]);
    }
    const repeated: RecordedRow[] = [];
    const gapped: RecordedRow[] = [];
    const differing: RecordedRow[] = [];
    const misdated: RecordedRow[] = [];
    const studyLevel = ["studyDescr_pdf", "infosheet_link", "authors", "year", "title", "citation"] as const;
    const stated = (entry: HypothesisRow) =>
      studyLevel.map((name) => [cellValue(entry.row, this.#column(name)), linkOf(entry.row, this.#column(name))]);
    for (const [key, entries] of byStudy) {
      const numbers = entries.map((entry) => entry.number).sort((a, b) => a - b);
      if (new Set(numbers).size !== numbers.length) repeated.push(...entries.map((entry) => entry.row));
      else if (numbers.some((number, index) => number !== index + 1)) gapped.push(...entries.map((entry) => entry.row));
      const [first] = entries;
      if (first !== undefined && entries.some((entry) => !sameValue(stated(entry), stated(first)))) {
        differing.push(...entries.map((entry) => entry.row));
      }
      const suffix = /(\d{4})[a-z]?$/.exec(key)?.[1];
      for (const entry of entries) {
        const year = numberOf(entry.row, this.#column("year"));
        if (year === null || !Number.isInteger(year) || String(year) !== suffix) misdated.push(entry.row);
      }
    }
    if (repeated.length > 0) this.#block("unique", "A study has two rows with one hypothesis number.", repeated);
    if (gapped.length > 0) {
      this.#block("numbering", "The hypothesis numbers of a study do not run from 1 without a gap.", gapped);
    }
    if (differing.length > 0) {
      this.#block(
        "studyValues",
        "The rows of a study state different links or different details of its paper.",
        differing,
      );
    }
    if (misdated.length > 0) {
      this.#block("year", "A year is no whole number, or differs from the year in the study identifier.", misdated);
    }
    const failed = fractional.length + repeated.length + gapped.length + differing.length + misdated.length;
    return failed > 0 ? null : parsed;
  }

  /**
   * Resolves the identifier of every row through the folded lookup. A row whose study does not
   * exist waits in the queue, because this source never creates a replication.
   */
  async #studies(rows: readonly HypothesisRow[]): Promise<Study[] | null> {
    const { items, studies } = this.#context;
    const spellings = new Map<string, HypothesisRow[]>();
    for (const entry of rows) spellings.set(entry.study, [...(spellings.get(entry.study) ?? []), entry]);
    const resolved = new Map<string, HypothesisRow[]>();
    const unmatched = (entries: readonly HypothesisRow[], spelling: string, known: readonly string[]) => {
      const item = items.unmatchedIdentifier({
        subject: `${this.#source}/${lookupFold(spelling)}`,
        entityRefs: known.map(replication),
        claims: entries.map((entry) => ({
          source: this.#source,
          value: spelling,
          valueSource: spelling,
          sourceRecordId: entry.row.recordId,
        })),
      });
      for (const entry of entries) this.#builder.hold(entry.row.recordId, item);
    };
    for (const [spelling, entries] of spellings) {
      const resolution = await studies.resolve(spelling);
      if (resolution.status === "resolved") {
        resolved.set(resolution.replicationId, [...(resolved.get(resolution.replicationId) ?? []), ...entries]);
      } else unmatched(entries, spelling, resolution.status === "ambiguous" ? resolution.replicationIds : []);
    }
    const stored = await readDocuments(
      this.#db,
      [...resolved.keys()].map((id) => COLLECTIONS.replications.docPath(id)),
    );
    const found: Study[] = [];
    const colliding: RecordedRow[] = [];
    for (const [replicationId, entries] of [...resolved].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const document = stored.get(COLLECTIONS.replications.docPath(replicationId));
      if (!document) {
        // An entry of the folded lookup may outlive its replication. Nothing is written beneath a study that is gone.
        for (const spelling of new Set(entries.map((entry) => entry.study))) {
          unmatched(
            entries.filter((entry) => entry.study === spelling),
            spelling,
            [],
          );
        }
        continue;
      }
      // Two spellings may resolve to one replication. Their numbers then have to stay apart as well.
      if (new Set(entries.map((entry) => entry.number)).size !== entries.length) {
        colliding.push(...entries.map((entry) => entry.row));
      }
      found.push({ replicationId, rows: entries, stored: document.data });
    }
    if (colliding.length > 0) {
      this.#block("unique", "Two spellings of one study carry the same hypothesis number.", colliding);
      return null;
    }
    return found;
  }

  async #study(study: Study): Promise<void> {
    const { items, studies } = this.#context;
    const builder = this.#builder;
    const { replicationId, rows } = study;
    const refs = [replication(replicationId)];
    const source = this.#source;
    const [first] = rows;
    if (first === undefined) return;
    const supplier = first.row.recordId;
    const recordIds = rows.map((entry) => entry.row.recordId);
    const scope = [replicationScopeKey(replicationId)];

    // Spellings: the identifier column, and the label of the infosheet link, which names the study as well.
    for (const spelling of new Set(rows.map((entry) => entry.study))) {
      const writing = rows.filter((entry) => entry.study === spelling);
      for (const entry of writing) {
        aliasDocuments(builder, studies, {
          replicationId,
          scheme: "programme",
          alias: spelling,
          recordId: entry.row.recordId,
        });
      }
      if (spelling === replicationId) continue;
      builder.item(
        items.aliasConfirmation({
          subject: replicationId,
          field: "programme",
          entityRefs: refs,
          claims: [
            { source, value: spelling, valueSource: spelling, sourceRecordId: writing[0]?.row.recordId ?? supplier },
          ],
        }),
      );
    }
    const labels = new Map<string, HypothesisRow[]>();
    for (const entry of rows) {
      const label = tidied(this.#text(entry.row, "infosheet_link") ?? "");
      // A label that is an address names no study.
      if (label === "" || label.length > LIMITS.shortText || isStorableUrl(label)) continue;
      labels.set(label, [...(labels.get(label) ?? []), entry]);
    }
    for (const [label, carrying] of labels) {
      for (const entry of carrying) {
        aliasDocuments(builder, studies, {
          replicationId,
          scheme: "sourceLabel",
          alias: label,
          recordId: entry.row.recordId,
        });
      }
      const differing = carrying.filter((entry) => entry.study !== label);
      const [example] = differing;
      if (example === undefined) continue;
      // The label is display text. It resolves through the identifier of its own row, and a reviewer confirms it.
      builder.item(
        items.aliasConfirmation({
          subject: replicationId,
          field: "sourceLabel",
          entityRefs: refs,
          claims: [
            {
              source: `${source}/infosheet_link`,
              value: label,
              valueSource: label,
              sourceRecordId: example.row.recordId,
            },
            { source: `${source}/study_id`, value: example.study, valueSource: example.study },
          ],
        }),
      );
    }

    // Hypotheses. The labels of `null-sig` are kept verbatim, and nothing here states a result. Whether the labels and
    // the links to the market's own documents are prediction-market data, which no one may see (question 7), is asked
    // of the programme lead: until the answer, a real project receives none of them, and they stay in the source rows.
    const material = this.#context.writes("predictionMarketMaterial");
    const description = material ? this.#address(first, "studyDescr_pdf", refs, true) : null;
    const infosheet = material ? this.#address(first, "infosheet_link", refs, false) : null;
    for (const entry of rows) {
      const text = collapsed(this.#text(entry.row, "hypothesis_text") ?? "");
      const nullSig = material ? this.#text(entry.row, "null-sig") : null;
      builder.document({
        collection: "replicationHypotheses",
        ids: [replicationId, hypothesisId(entry.number)],
        fixed: {
          replicationId,
          scientificReviewStatus: "unverified",
          analysisStatus: "notStarted",
          resultReviewedBy: null,
          resultReviewedAt: null,
        },
        owned: {
          hypothesisNumber: String(entry.number),
          text,
          nullSigSource: nullSig ?? undefined,
          studyDescriptionUrl: description ?? undefined,
          infosheetUrl: infosheet ?? undefined,
        },
        sourceRecordIds: [entry.row.recordId],
      });
    }

    // The original study: candidate values, which never replace what another source has stated.
    const citation = this.#text(first.row, "citation");
    const citationLink = linkOf(first.row, this.#column("citation"));
    const linked = citationLink === null ? null : doiOfAddress(citationLink);
    const written = doisIn(citation ?? "")[0] ?? null;
    const doi = linked ?? written;
    if (linked !== null && written !== null && doiKey(linked) !== doiKey(written)) {
      builder.item(
        items.valueConflict({
          subject: replicationId,
          field: "originalDoi",
          entityRefs: refs,
          claims: [
            { source: `${source}/citation/link`, value: doiKey(linked), valueSource: linked, sourceRecordId: supplier },
            {
              source: `${source}/citation/text`,
              value: doiKey(written),
              valueSource: written,
              sourceRecordId: supplier,
            },
          ],
        }),
      );
    }
    const year = numberOf(first.row, this.#column("year"));
    const kept = (name: HypothesisHeader) => {
      const cell = this.#text(first.row, name);
      return cell !== null && collapsed(cell) !== "" && tidied(cell).length <= LIMITS.longText
        ? tidied(cell)
        : undefined;
    };
    const usableDoi = doi !== null && doiSchema.safeParse(doi).success ? doi : undefined;
    builder.document({
      collection: "replications",
      ids: [replicationId],
      owned: {
        originalAuthors: kept("authors"),
        originalYear: year !== null && year >= 1800 && year <= 2200 ? year : undefined,
        originalTitle: kept("title"),
        originalReference: kept("citation"),
        originalDoi: usableDoi,
      },
      // The sources write the authors of a paper in different styles, which is no disagreement about who they are.
      silent: ["originalAuthors"],
      sourceRecordIds: [supplier, ...recordIds],
    });
    if (usableDoi !== undefined) doiLookupDocument(builder, replication(replicationId), usableDoi, supplier);
    if (year !== null) await this.#yearAsWritten(study, year, supplier);

    // Links, each in a named place of its study, so that a corrected address updates the same document.
    const paper = citationLink ?? addressesIn(citation ?? "").find((address) => doiOfAddress(address) !== null) ?? null;
    const links: readonly (readonly [slot: string, address: string | null, title: string | undefined])[] = [
      ["pmStudyDescription", description, undefined],
      ["pmInfosheet", infosheet, [...labels.keys()][0]],
      ["originalPaper", paper !== null && isStorableUrl(paper) ? paper : null, undefined],
    ];
    for (const [slot, address, title] of links) {
      if (address === null) continue;
      slotLinkDocument(builder, {
        owner: replication(replicationId),
        slot,
        url: address,
        replicationId,
        ownerScopeKeys: scope,
        recordId: supplier,
      });
      builder.document({
        collection: "documentLinks",
        ids: [documentLinkSlotId(entityRefId("replication", replicationId), slot)],
        ...(title === undefined ? {} : { owned: { title } }),
        sourceRecordIds: recordIds,
      });
    }

    await this.#labels(study);
  }

  /**
   * The address of a link cell: the target of its hyperlink. The text of the cell is a label and
   * is taken as the address only where it is one and the cell has no link.
   */
  #address(entry: HypothesisRow, name: HypothesisHeader, refs: readonly EntityRef[], textIsAddress: boolean) {
    const { items } = this.#context;
    const column = this.#column(name);
    const target = linkOf(entry.row, column);
    const text = collapsed(this.#text(entry.row, name) ?? "");
    const subject = refs[0]?.entityId ?? "";
    const claim = (defect: string, value: string): ItemClaim => ({
      source: `${this.#source}/${name}/${defect}`,
      value,
      valueSource: value,
      sourceRecordId: entry.row.recordId,
    });
    if (target !== null && textIsAddress && isStorableUrl(text) && text !== target) {
      // The cell shows one address and links to another. The link is what a reader follows.
      this.#builder.item(
        items.linkDefect({
          subject,
          field: name,
          entityRefs: refs,
          claims: [claim("target", target), claim("text", text)],
        }),
      );
    }
    const address = target ?? (isStorableUrl(text) ? text : null);
    if (address === null || !isStorableUrl(address)) {
      if (address !== null || text !== "") {
        this.#builder.item(
          items.linkDefect({
            subject,
            field: name,
            entityRefs: refs,
            claims: [claim("noAddress", address ?? text)],
          }),
        );
      }
      return null;
    }
    return address;
  }

  /**
   * Compares the year with the year as the public website writes it. The replication holds a
   * whole number, so a letter that the website adds to the year shows only in its source record.
   */
  async #yearAsWritten(study: Study, year: number, recordId: string): Promise<void> {
    const supplierId = (study.stored.fieldSources as Record<string, string> | undefined)?.originalYear;
    if (supplierId === undefined || study.stored.originalYear !== year) return;
    const supplier = await this.#db.doc(COLLECTIONS.sourceRecords.docPath(supplierId)).get();
    const written = (supplier.get("raw") as Record<string, unknown> | undefined)?.PublicationYear;
    if (supplier.get("sourceKey") !== "h" || typeof written !== "string" || written.trim() === String(year)) return;
    this.#builder.item(
      this.#context.items.valueConflict({
        subject: study.replicationId,
        field: "originalYear",
        entityRefs: [replication(study.replicationId)],
        claims: [
          { source: "h/replications", value: written, valueSource: written, sourceRecordId: supplierId },
          { source: this.#source, value: String(year), valueSource: String(year), sourceRecordId: recordId },
        ],
      }),
    );
  }

  /**
   * Stores the labels of `replicated` verbatim in the sealed document of the replication, and
   * raises what they ask. A label is an unverified source value: it sets no result, no review
   * status and no status of a replication, and a blank stays absent. The labels are sealed by a
   * decision of the programme (question 7): programme administrators alone read them, so no item
   * shows one and the key of each claim about one is a keyed hash, which nobody can confirm a
   * guess against.
   */
  async #labels(study: Study): Promise<void> {
    const { items } = this.#context;
    const builder = this.#builder;
    const { replicationId, rows } = study;
    const refs = [replication(replicationId)];
    const source = this.#source;
    const labelled = rows.filter((entry) => entry.replicated !== null);

    // A study whose labels have all gone from the source keeps a document with an empty map. One that never had a
    // label gets no document.
    const sealedPath = COLLECTIONS.predictionMarketOutcomes.docPath(replicationId);
    const held = labelled.length > 0 || (await readDocuments(this.#db, [sealedPath])).get(sealedPath) !== null;
    if (held && this.#context.writes("replicatedLabels")) {
      builder.document({
        collection: "predictionMarketOutcomes",
        ids: [replicationId],
        fixed: { replicationId, sealedBy: SEALED_OUTCOMES_DECISION },
        owned: {
          labelsSource: Object.fromEntries(
            labelled.map((entry) => [hypothesisId(entry.number), entry.replicated ?? ""]),
          ),
        },
        sourceRecordIds: (labelled.length > 0 ? labelled : rows).map((entry) => entry.row.recordId),
      });
    }

    for (const entry of labelled) {
      const label = entry.replicated ?? "";
      const hypothesis: EntityRef = {
        entityType: "hypothesis",
        entityId: nestedEntityId(replicationId, hypothesisId(entry.number)),
      };
      // The label is sealed: the claim names its source record, its key is a keyed hash, and the item is sealed.
      const claim: ItemClaim = {
        source: `${source}/replicated`,
        value: label,
        sourceRecordId: entry.row.recordId,
        sealed: true,
      };
      builder.item(
        items.unverifiedLabel({
          subject: hypothesis.entityId,
          field: "labelsSource",
          entityRefs: [hypothesis],
          personal: true,
          claims: [claim],
        }),
      );
      const nullSig = this.#text(entry.row, "null-sig") ?? "";
      if (OUTCOME_LABELS.includes(collapsed(label)) && collapsed(nullSig) === NULL_LABEL) {
        // An outcome on a hypothesis that states a null finding: the source does not say what it means.
        builder.item(
          items.unverifiedLabel({
            subject: hypothesis.entityId,
            field: "nullSigSource",
            entityRefs: [hypothesis],
            personal: true,
            claims: [
              claim,
              {
                source: `${source}/null-sig`,
                value: nullSig,
                valueSource: nullSig,
                sourceRecordId: entry.row.recordId,
              },
            ],
          }),
        );
      }
    }

    const outcomes = labelled.filter((entry) => OUTCOME_LABELS.includes(collapsed(entry.replicated ?? "")));
    const stage = study.stored.publicStageName;
    if (outcomes.length > 0 && typeof stage === "string" && !FINISHED_STAGES.includes(collapsed(stage).toLowerCase())) {
      const stageRecord = (study.stored.fieldSources as Record<string, string> | undefined)?.publicStageName;
      builder.item(
        items.valueConflict({
          subject: replicationId,
          field: "publicStageName",
          entityRefs: refs,
          // The labels are sealed, so every claim of the item is keyed and none shows a label.
          personal: true,
          claims: [
            {
              source: "portal/publicStageName",
              value: stage,
              valueSource: stage,
              ...(stageRecord === undefined ? {} : { sourceRecordId: stageRecord }),
            },
            ...outcomes.map((entry) => ({
              source: `${source}/replicated`,
              value: `${hypothesisId(entry.number)}:${entry.replicated}`,
              sourceRecordId: entry.row.recordId,
              sealed: true as const,
            })),
          ],
        }),
      );
    }

    // Hidden rows and the label `cancelled` are signals about the study. No status follows from them.
    const signalling = rows.filter((entry) => entry.hidden || collapsed(entry.replicated ?? "") === CANCELLED);
    if (signalling.length > 0) {
      const aliases = await this.#db
        .collection(COLLECTIONS.replicationAliases.collectionPath(replicationId))
        .where("scheme", "==", "website")
        .limit(1)
        .get();
      builder.item(
        items.statusQuestion({
          subject: replicationId,
          field: "status",
          entityRefs: refs,
          // A label of `replicated` is sealed, so the claims are keyed and none shows the label.
          personal: true,
          claims: [
            ...signalling.flatMap((entry) => [
              ...(entry.hidden
                ? [{ source: `${source}/hiddenRow`, value: entry.row.rowKey, sourceRecordId: entry.row.recordId }]
                : []),
              ...(collapsed(entry.replicated ?? "") === CANCELLED
                ? [
                    {
                      source: `${source}/replicated`,
                      value: `${hypothesisId(entry.number)}:${entry.replicated}`,
                      sourceRecordId: entry.row.recordId,
                      sealed: true as const,
                    },
                  ]
                : []),
            ]),
            ...(aliases.empty ? [{ source: `${source}/absentFromWebsite`, value: replicationId }] : []),
          ],
        }),
      );
    }
    for (const entry of rows) {
      const cancelled = collapsed(entry.replicated ?? "") === CANCELLED;
      if (entry.hidden === cancelled) continue;
      // The two signals no longer go together: a hidden row without the label, or the label on a visible row.
      builder.item(
        items.formattingSignal({
          subject: nestedEntityId(replicationId, hypothesisId(entry.number)),
          field: "hiddenRow",
          entityRefs: refs,
          claims: [
            {
              source: `${source}/${entry.hidden ? "hiddenWithoutLabel" : "labelOnVisibleRow"}`,
              value: entry.row.rowKey,
              sourceRecordId: entry.row.recordId,
            },
          ],
        }),
      );
    }
  }

  /**
   * Collects the lists that the workbook validates its two status columns against, and the
   * labels of `null-sig` that its rows use. The lists are vocabulary whether a row uses an
   * option or not. A value outside its list, and an option that is new, go to a reviewer.
   */
  #vocabulary(rows: readonly HypothesisRow[]): void {
    const { items } = this.#context;
    const kinds = { "null-sig": "pmNullSig", replicated: "pmReplicated" } as const;
    for (const name of ["null-sig", "replicated"] as const) {
      const column = this.#column(name);
      const lists = validatedLists(this.#stored("hypotheses")).filter((list) =>
        list.ranges.every((range) => rowsInColumn(range, column) !== null),
      );
      const listed = new Set(lists.flatMap((list) => list.options));
      for (const list of lists) {
        for (const option of list.options) {
          if (collapsed(option) !== "") this.#terms.add(kinds[name], collapsed(option), list.row.recordId, option);
          if (KNOWN_OPTIONS[name].includes(option)) continue;
          this.#builder.item(
            items.vocabularyReview({
              subject: `${this.#source}/${name}/option/${shortHash(option)}`,
              field: name,
              claims: [
                {
                  source: `${this.#source}/list`,
                  value: option,
                  valueSource: option,
                  sourceRecordId: list.row.recordId,
                },
              ],
            }),
          );
        }
      }
      const allowed = lists.length > 0 ? listed : new Set(KNOWN_OPTIONS[name]);
      const outside = new Map<string, RecordedRow>();
      for (const entry of rows) {
        const value = this.#text(entry.row, name);
        if (value === null || collapsed(value) === "") continue;
        // A term names the record it was read from, and members read terms. A label of `replicated`
        // therefore becomes a term from the list of the workbook alone, and never from a row, which
        // would tell a member which hypothesis carries it.
        if (name === "null-sig") this.#terms.add(kinds[name], collapsed(value), entry.row.recordId, value);
        if (!allowed.has(value) && !outside.has(value)) outside.set(value, entry.row);
      }
      for (const [value, row] of outside) {
        this.#builder.item(
          items.vocabularyReview({
            subject: `${this.#source}/${name}/value/${shortHash(value)}`,
            field: name,
            claims: [{ source: this.#source, value, valueSource: value, sourceRecordId: row.recordId }],
          }),
        );
      }
    }
  }

  /**
   * Reads the footer of the hypotheses tab: the link of the programme, and the counters, which
   * are never parsed. Each counter is compared, as text, with a count taken from the data.
   */
  #footer(rows: readonly HypothesisRow[]): void {
    const { items } = this.#context;
    const count = (name: HypothesisHeader, value: string) =>
      rows.filter((entry) => collapsed(this.#text(entry.row, name) ?? "") === value).length;
    const total = rows.length;
    const yes = count("replicated", "yes");
    const expected: Readonly<Record<string, string>> = {
      [this.#column("null-sig")]: `${count("null-sig", NULL_LABEL)}/${total}`,
      [this.#column("replicated")]: `${yes}/${yes + count("replicated", "no")}`,
    };
    const remaining = `${total - count("replicated", CANCELLED)} hypotheses left`;
    for (const row of this.#stored("hypotheses")) {
      if (row.rowClass !== "annotation" || row.cellLevel === true) continue;
      const linkColumn = this.#column("infosheet_link");
      const target = this.#context.writes("predictionMarketMaterial") ? linkOf(row, linkColumn) : null;
      if (target !== null && isStorableUrl(target)) {
        const owner = { entityType: "programme", entityId: PROGRAMME_KEY } as const;
        const title = tidied(cellText(row, linkColumn) ?? "");
        slotLinkDocument(this.#builder, {
          owner,
          slot: "pmGeneralInfo",
          url: target,
          replicationId: null,
          ownerScopeKeys: [PROGRAMME_SCOPE_KEY],
          recordId: row.recordId,
        });
        if (title !== "" && title.length <= LIMITS.shortText) {
          this.#builder.document({
            collection: "documentLinks",
            ids: [documentLinkSlotId(entityRefId(owner.entityType, owner.entityId), "pmGeneralInfo")],
            owned: { title },
            sourceRecordIds: [row.recordId],
          });
        }
      }
      for (const label of row.labels) {
        const text = collapsed(cellText(row, label) ?? "");
        const counter = /^\d+\/\d+$/.test(text) ? expected[label] : undefined;
        const left = /^\d+ hypotheses left\b/.exec(text)?.[0];
        const recount = counter ?? (left === undefined ? undefined : remaining);
        const stated = counter === undefined ? left : text;
        if (recount === undefined || stated === undefined || stated === recount) continue;
        // A counter counts the sealed outcome labels, so the item names the cell and shows neither count.
        this.#builder.item(
          items.annotationReview({
            subject: `${this.#source}/${row.rowKey}`,
            field: "footer",
            personal: true,
            claims: [
              { source: `${this.#source}/footer`, value: text, sourceRecordId: row.recordId, sealed: true },
              { source: `${this.#source}/recount`, value: recount, sealed: true },
            ],
          }),
        );
      }
    }
  }

  /**
   * The hidden review tab stays in its source records. Its identifiers are spellings of studies
   * and become aliases. A status that names a person and every note go to a reviewer, without
   * their text.
   */
  async #review(): Promise<void> {
    const { items, studies } = this.#context;
    const builder = this.#builder;
    const source = `${SOURCE_KEY}/review`;
    const header = this.#header("review");
    const { columns } = columnsOf(header);
    const idColumn = columns.get("study_id") ?? "";
    const notesColumn = columns.get("notes") ?? "";
    const labels = header?.labels ?? [];
    const hasStatus = labels.includes(REVIEW_STATUS);
    const statuses = new Set<string>();

    for (const row of this.#data("review")) {
      builder.rawOnly(row.recordId, "reviewLog");
      const spelling = tidied(cellText(row, idColumn) ?? "");
      const resolution = await studies.resolve(spelling);
      const replicationId = resolution.status === "resolved" ? resolution.replicationId : null;
      const refs = replicationId === null ? [] : [replication(replicationId)];
      if (replicationId === null) {
        builder.item(
          items.unmatchedIdentifier({
            subject: `${source}/${row.rowKey}`,
            entityRefs: resolution.status === "ambiguous" ? resolution.replicationIds.map(replication) : [],
            claims: [{ source, value: spelling, valueSource: spelling, sourceRecordId: row.recordId }],
          }),
        );
      } else {
        aliasDocuments(builder, studies, {
          replicationId,
          scheme: "programme",
          alias: spelling,
          recordId: row.recordId,
        });
        if (spelling !== replicationId) {
          builder.item(
            items.aliasConfirmation({
              subject: replicationId,
              field: "programme",
              entityRefs: refs,
              claims: [{ source, value: spelling, valueSource: spelling, sourceRecordId: row.recordId }],
            }),
          );
        }
      }
      const status = hasStatus ? cellText(row, REVIEW_STATUS) : null;
      if (status !== null) statuses.add(status);
      const note = cellText(row, notesColumn);
      if (note !== null && collapsed(note) !== "") {
        // Whether a note is about its study or about the tab as a whole is for a reviewer to say.
        builder.item(
          items.annotationReview({
            subject: `${source}/${row.rowKey}`,
            field: "notes",
            entityRefs: refs,
            personal: true,
            claims: [{ source: `${source}/notes`, value: collapsed(note), sourceRecordId: row.recordId }],
          }),
        );
      }
    }

    for (const status of [...statuses].sort()) {
      if (IMPERSONAL_STATUS.test(status)) {
        this.#terms.add("pmReviewStatus", status, header?.recordId ?? "");
        continue;
      }
      // The label identifies a person. It stays in the source records, and the item holds a keyed hash of it.
      builder.item(
        items.privacyReview({
          subject: `${source}/${REVIEW_STATUS}`,
          field: REVIEW_STATUS,
          claims: [
            {
              source: `${source}/${REVIEW_STATUS}`,
              value: status,
              ...(header === undefined ? {} : { sourceRecordId: header.recordId }),
            },
          ],
        }),
      );
    }
    for (const list of validatedLists(this.#stored("review"))) {
      // The options of the list that name no person are vocabulary. The others stay where they are.
      for (const option of list.options.filter((candidate) => IMPERSONAL_STATUS.test(candidate))) {
        this.#terms.add("pmReviewStatus", option, list.row.recordId);
      }
    }

    for (const label of labels) {
      if (label === REVIEW_STATUS || (header !== undefined && headerText(cellValue(header, label)) !== "")) continue;
      // Data under a blank header that the stored rule does not cover is never mapped by guesswork.
      const holders = this.#data("review").filter((row) => rawOf(row, label) !== null);
      const [firstHolder] = holders;
      if (firstHolder === undefined) continue;
      builder.item(
        items.structureChange({
          subject: `${source}/unheaded/${label}`,
          claims: [{ source, value: `${holders.length} cells`, sourceRecordId: firstHolder.recordId }],
        }),
      );
    }
  }

  /** One prediction-market item for each content row of the questions tab, with no link to a hypothesis. */
  #questions(): void {
    const { items } = this.#context;
    const source = `${SOURCE_KEY}/questions`;
    const header = this.#header("questions");
    const { columns } = columnsOf(header);
    const questionColumn = columns.get(QUESTION_HEADERS[0]) ?? "";
    const choicesColumn = columns.get(QUESTION_HEADERS[1]) ?? "";
    const repeats = new Map<string, RecordedRow[]>();
    for (const row of this.#data("questions")) {
      const question = tidied(cellText(row, questionColumn) ?? "");
      const choices = tidied(cellText(row, choicesColumn) ?? "");
      const unreadable = question.length > LIMITS.longText || choices.length > LIMITS.shortText;
      if (unreadable) {
        this.#builder.hold(
          row.recordId,
          items.unparsedValue({
            subject: `${source}/${row.rowKey}`,
            claims: [{ source: `${source}/tooLong`, value: row.rawHash, sourceRecordId: row.recordId }],
          }),
        );
        continue;
      }
      this.#builder.document({
        collection: "predictionMarketItems",
        ids: [row.rowKey],
        // The cell of the choices is kept whole: it names a format or lists options, and nothing splits it.
        owned: { questionText: question, choices: choices === "" ? [] : [choices] },
        sourceRecordIds: [row.recordId],
      });
      if (choices !== "") this.#terms.add("pmChoiceFormat", collapsed(choices), row.recordId, choices);
      const pair = row.rowKey.replace(/__\d+$/, "");
      repeats.set(pair, [...(repeats.get(pair) ?? []), row]);
    }
    for (const [pair, rows] of repeats) {
      if (rows.length < 2) continue;
      this.#builder.item(
        items.annotationReview({
          subject: `${source}/${pair}`,
          field: "questionText",
          claims: rows.map((row) => ({
            source,
            value: row.rowKey,
            valueSource: collapsed(cellText(row, questionColumn) ?? ""),
            sourceRecordId: row.recordId,
          })),
        }),
      );
    }
  }
}

export const importer: ImporterDefinition = {
  key: "predictionMarket",
  sourceKey: SOURCE_KEY,
  summary: "Prediction-market hypotheses: the hypotheses of every study, their links and the survey questions.",
  inputDescription: "the Excel export of the workbook",
  // Its hypotheses belong to studies, all of which exist once the list of studies has been applied.
  after: ["h", "d"],
  read,
  plan: (context) => new PredictionMarketPlan(context).build(),
};
