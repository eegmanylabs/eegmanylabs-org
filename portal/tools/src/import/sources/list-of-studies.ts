// Source D: the list of studies (docs/MIGRATION_PLAN.md, section 4.3). One workbook with six
// tabs, two of them hidden, that holds the current extraction of every study and the frozen
// records of the nomination and shortlisting phases.
//
// | Tab                           | Header                 | Treated as                                           |
// |-------------------------------|------------------------|------------------------------------------------------|
// | `list of studies`             | Rows 1 and 2           | The current extraction: creates the replications that no other source holds and adds the extraction fields of all |
// | `shortlist_archived`          | Rows 1 and 2           | A historical observation: candidate studies with the status `shortlisted`, compared with the current tab |
// | `allranked_archived`          | Rows 1 and 2           | The nomination record: candidate studies with the status `rankedCandidate` |
// | `questionnaires` (hidden)     | Row 1 banner, row 2    | Raw, with a cross-reference where the text matches a study |
// | `AlphaAsymmetry_RSSubproject` | Rows 1 and 2           | Candidates of a separate subproject                  |
// | `Sheet5` (hidden)             | None                   | Raw only. Its purpose is unknown                     |
//
// The effective header of a column is its row-2 text where that is filled and its row-1 text
// otherwise. A row-1 text above a column that has its own row-2 header is a group banner.
// Columns are found by header text and never by letter, and hidden columns are read like any
// other. Stage and lead are observations: they never overwrite what another source says, and a
// stage text is never mapped to a status. Names of leads, extractors, reviewers and voters, the
// notes column and any value cell that carries a remark about a person stay in the restricted
// source records. Where two tabs or two sources disagree, both values are kept and a person
// decides.
import {
  COLLECTIONS,
  candidateStudyId,
  documentLinkSlotId,
  doiSchema,
  type EntityRef,
  entityRefId,
  LIMITS,
  lookupFold,
  PROGRAMME_KEY,
  replicationScopeKey,
  shortHash,
  sourceTabKey,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { readDocuments } from "../context";
import { addressesIn, doiOfAddress, doisIn, endsInStrayParenthesis, hyperlinkFormulaTarget, isDoi } from "../doi";
import type {
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  PlanContext,
  RawScalar,
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
  isEditorAddress,
  isStorableUrl,
  slotLinkDocument,
  VocabularyCollector,
} from "../records";
import { STUDY_ID_PATTERN } from "../studies";
import { contentRowKey } from "../values";
import type { WorkbookSheet } from "../workbook";
import {
  collapsed,
  formulaOf,
  gridOf,
  headerText,
  linkOf,
  nullLikeOf,
  numberOf,
  numbersIn,
  openWorkbook,
  rowsInColumn,
  singleNumberOf,
  termsOf,
  tidied,
  uninterpretedTab,
  validatedLists,
  validationRows,
} from "../workbook-rows";

const SOURCE_KEY = "d";

/** The six tabs of the workbook by their exact titles. The set is fixed: a missing, renamed or new tab stops the import. */
export const TAB_TITLES = {
  list: "list of studies",
  shortlist: "shortlist_archived",
  ranked: "allranked_archived",
  questionnaires: "questionnaires",
  subproject: "AlphaAsymmetry_RSSubproject",
  scratch: "Sheet5",
} as const;
type Tab = keyof typeof TAB_TITLES;
const TABS = Object.keys(TAB_TITLES) as readonly Tab[];
const tabKeyOf = (tab: Tab): string => sourceTabKey(TAB_TITLES[tab]);

/** The tabs whose rows are papers, each with a citation or with bibliographic columns. */
const PAPER_TABS = ["list", "shortlist", "ranked", "subproject"] as const satisfies readonly Tab[];
type PaperTab = (typeof PAPER_TABS)[number];

/**
 * The headers of the workbook, compared after collapsing white space and with case preserved.
 * A header that ends in `…` here is matched on that stable beginning, because the full texts
 * are long explanations that their authors may reword.
 */
const HEADERS = {
  studyId: "StudyID",
  lead: "Lead Replicating Lab",
  citation: "Study",
  abstract: "Abstract",
  extractor: "Data extractor",
  reviewer: "Coding reviewer",
  stage: "Progress stage",
  effect: "The effect of interest.…",
  plain: "The effect of interest in plain language",
  originalN: "original N",
  statistics: "Statistics from the original paper…",
  effectSize: "Standardized effect size…",
  convertedR: "Original effect sizes converted to r",
  bayesFactor: "BF10",
  duration: "Your estimation of the time…",
  sample: "Type of the sample…",
  channels: "minimal number of channels…",
  equipment: "additional requirements to the equipment…",
  powerN: "Required N to have 90% power…",
  questionnaires: "Questionnaires.…",
  notes: "Notes. Comments",
  studyType: "Correlational/experimental study",
  outcome: "Main outcome variable…",
  construct: "Psychological Construct",
  descriptors: "Other Descriptors",
  signup: "Link to the sign-up form",
  authors: "Authors",
  year: "Year",
  title: "Title",
  journal: "Journal",
  doi: "DOI",
  votes: "Votes count",
  questionnaireName: "Name",
  questionnaireDuration: "Duration, min",
  questionnaireStudy: "In which study from the list it was used",
} as const;
type Field = keyof typeof HEADERS;

const matchesHeader = (field: Field, header: string): boolean => {
  const expected: string = HEADERS[field];
  return expected.endsWith("…") ? header.startsWith(expected.slice(0, -1)) : header === expected;
};

/** The extraction columns that the two shortlist-style tabs share with the current tab. */
const EXTRACTION = [
  "effect",
  "plain",
  "originalN",
  "statistics",
  "effectSize",
  "bayesFactor",
  "duration",
  "sample",
  "channels",
  "equipment",
  "powerN",
  "questionnaires",
  "notes",
  "studyType",
] as const satisfies readonly Field[];
const KEYWORDS = ["outcome", "construct", "descriptors"] as const satisfies readonly Field[];

interface TabShape {
  /** The rows that hold headers. A row above them is a banner. */
  readonly headerRows: readonly number[];
  readonly firstDataRow: number;
  readonly required: readonly Field[];
  /** Whether the tab has the 24 columns in which people typed their names. */
  readonly groups: boolean;
  /** Whether the first column holds the citation under no header at all. */
  readonly unheadedCitation: boolean;
}

const SHAPES: Readonly<Record<Tab, TabShape>> = {
  list: {
    headerRows: [1, 2],
    firstDataRow: 3,
    required: ["studyId", "lead", "citation", "abstract", ...EXTRACTION, "convertedR", ...KEYWORDS, "stage", "signup"],
    groups: true,
    unheadedCitation: false,
  },
  shortlist: {
    headerRows: [1, 2],
    firstDataRow: 3,
    required: ["citation", "abstract", "extractor", "reviewer", "stage", ...EXTRACTION, ...KEYWORDS, "lead", "signup"],
    groups: true,
    unheadedCitation: true,
  },
  ranked: {
    headerRows: [1, 2],
    firstDataRow: 3,
    required: ["authors", "year", "title", "journal", "abstract", "doi", ...KEYWORDS, "votes"],
    groups: true,
    unheadedCitation: false,
  },
  questionnaires: {
    headerRows: [2],
    firstDataRow: 3,
    required: ["questionnaireName", "questionnaireDuration", "questionnaireStudy"],
    groups: false,
    unheadedCitation: false,
  },
  subproject: {
    headerRows: [1, 2],
    firstDataRow: 3,
    required: ["citation", "abstract", "extractor", ...EXTRACTION, ...KEYWORDS],
    groups: true,
    unheadedCitation: true,
  },
  scratch: { headerRows: [], firstDataRow: 1, required: [], groups: false, unheadedCitation: false },
};

const GROUP_HEADER = /^Group\d+$/;

/** Where the fields of a tab are, found by header text. */
export interface TabLayout {
  /** The column of each field that the tab has, by the name under which its cells are stored. */
  readonly columns: ReadonlyMap<Field, string>;
  /** The columns in which people typed their names, in the order of the sheet. */
  readonly groups: readonly string[];
  readonly groupsConsecutive: boolean;
  /** Headers that no field of the workbook knows. They are reported and their cells stay raw. */
  readonly unknown: readonly { readonly label: string; readonly header: string }[];
  /** Columns without a header in either row, the citation column left out. */
  readonly unheaded: readonly string[];
  readonly missing: readonly Field[];
  readonly duplicated: readonly Field[];
}

/**
 * Finds the columns of a tab. The effective header of a column is the text of the last header
 * row that is filled, so a row-1 text above a row-2 header is a banner and names no column.
 */
export function layoutOf(
  tab: Tab,
  labels: readonly string[],
  headerRows: readonly (readonly RawScalar[])[],
): TabLayout {
  const shape = SHAPES[tab];
  const columns = new Map<Field, string>();
  const duplicated = new Set<Field>();
  const groups: number[] = [];
  const unknown: { label: string; header: string }[] = [];
  const unheaded: string[] = [];
  labels.forEach((label, index) => {
    const header = headerRows.map((row) => headerText(row[index] ?? null)).findLast((text) => text !== "") ?? "";
    if (header === "") {
      if (shape.unheadedCitation && index === 0) columns.set("citation", label);
      else unheaded.push(label);
      return;
    }
    if (shape.groups && GROUP_HEADER.test(header)) {
      groups.push(index);
      return;
    }
    const field = (Object.keys(HEADERS) as Field[]).find((candidate) => matchesHeader(candidate, header));
    if (field === undefined || !shape.required.includes(field)) unknown.push({ label, header });
    else if (columns.has(field)) duplicated.add(field);
    else columns.set(field, label);
  });
  return {
    columns,
    groups: groups.map((index) => labels[index] ?? ""),
    groupsConsecutive: groups.every((index, position) => position === 0 || index === (groups[position - 1] ?? 0) + 1),
    unknown,
    unheaded,
    missing: shape.required.filter((field) => !columns.has(field)),
    duplicated: [...duplicated],
  };
}

/** The DOI of a citation cell, by the order of preference of the plan: the text, the link target, the formula. */
function citationDoi(row: SourceRow, label: string): string | null {
  const fromText = doisIn(cellText(row, label) ?? "")[0];
  if (fromText !== undefined) return fromText;
  const link = linkOf(row, label);
  const fromLink = link === null ? null : doiOfAddress(link);
  if (fromLink !== null) return fromLink;
  const target = hyperlinkFormulaTarget(formulaOf(row, label) ?? "");
  return target === null ? null : doiOfAddress(target);
}

/** The key of a paper row: the lookup key of its DOI, or a hash of its identifying text where it has none. */
function paperRowKey(doi: string | null, identifyingText: string): string | null {
  if (doi !== null) return `doi__${shortHash(doiKey(doi))}`;
  const folded = lookupFold(identifyingText);
  return folded === "" ? null : `text__${shortHash(folded)}`;
}

const YEAR_IN_PARENTHESES = /\((\d{4})[a-z]?\)/;

function readTab(tab: Tab, sheet: WorkbookSheet, issues: StructureIssue[]): SourceTab {
  const shape = SHAPES[tab];
  const tabKey = tabKeyOf(tab);
  const grid = gridOf(sheet);
  const issue = (check: string, message: string, expected: string, found: string) =>
    issues.push({ check, tabKey, message, expected, found });
  const rows: SourceRow[] = [];
  const unkeyed = new Map<string, number>();
  const keys = new Map<string, number>();
  let blankRows = 0;

  for (let row = 1; row < shape.firstDataRow; row += 1) {
    if (!grid.holdsContent(row)) {
      if (row <= grid.lastRow) blankRows += 1;
      continue;
    }
    const isHeader = shape.headerRows.includes(row);
    rows.push({
      rowClass: isHeader ? "header" : "banner",
      rowNumber: row,
      rowKey: `${isHeader ? "header" : "banner"}${row}`,
      // The header record says which columns are hidden. Their cells are read like any other.
      cells: grid.cells(row, { hidden: true }),
      labels: grid.labels,
    });
  }
  const layout = layoutOf(
    tab,
    grid.labels,
    shape.headerRows.map((row) =>
      grid.cells(row).map((cell) => (cell !== null && typeof cell === "object" ? (cell.v ?? null) : cell)),
    ),
  );
  if (layout.missing.length > 0 || layout.duplicated.length > 0) {
    issue(
      "header",
      "The tab does not hold each of its expected headers exactly once.",
      shape.required.map((field) => HEADERS[field]).join(" | "),
      `missing: ${layout.missing.map((field) => HEADERS[field]).join(" | ") || "none"}; twice: ${
        layout.duplicated.map((field) => HEADERS[field]).join(" | ") || "none"
      }`,
    );
  }
  if (shape.groups && (layout.groups.length === 0 || !layout.groupsConsecutive)) {
    issue(
      "groups",
      "The columns headed Group1, Group2 and so on are missing or do not stand side by side.",
      "consecutive group columns",
      `${layout.groups.length} group columns`,
    );
  }

  const citations: string[] = [];
  let repeatedKeys = 0;
  for (let row = shape.firstDataRow; row <= grid.lastRow; row += 1) {
    if (!grid.holdsContent(row)) {
      blankRows += 1;
      continue;
    }
    const draft: SourceRow = {
      rowClass: "data",
      rowNumber: row,
      rowKey: "",
      cells: grid.cells(row),
      labels: grid.labels,
    };
    const text = (field: Field) => {
      const label = layout.columns.get(field);
      return label === undefined ? null : cellText(draft, label);
    };
    let natural: string | null = null;
    if (tab === "list") {
      const folded = lookupFold(text("studyId") ?? "");
      natural = folded === "" || folded.length > LIMITS.shortText ? null : folded;
      if (natural !== null && keys.has(natural)) repeatedKeys += 1;
    } else if (tab === "shortlist" || tab === "subproject") {
      const label = layout.columns.get("citation");
      const citation = text("citation");
      if (citation !== null) citations.push(citation);
      natural = label === undefined ? null : paperRowKey(citationDoi(draft, label), citation ?? "");
    } else if (tab === "ranked") {
      const doi = collapsed(text("doi") ?? "");
      natural = paperRowKey(isDoi(doi) ? doi : null, text("title") ?? "");
    }
    // A repeated key gets an ordinal, so that both rows are kept. The plan stage reports the repeat.
    const repeat = natural === null ? 0 : (keys.get(natural) ?? 0) + 1;
    if (natural !== null) keys.set(natural, repeat);
    const keyless = natural === null && PAPER_TABS.some((candidate) => candidate === tab);
    rows.push({
      ...draft,
      // A row of a paper tab that names no paper is no record of the tab. It is kept for a reviewer to place.
      rowClass: keyless ? "annotation" : "data",
      rowKey:
        natural === null
          ? contentRowKey(draft.cells, draft.rowNumber, unkeyed)
          : repeat > 1
            ? `${natural}__${repeat}`
            : natural,
    });
  }
  if (repeatedKeys > 0) {
    issue(
      "key",
      `${repeatedKeys} rows carry a study identifier that another row carries as well.`,
      "one distinct identifier for each row",
      `${repeatedKeys} repeated`,
    );
  }
  if (shape.unheadedCitation && layout.columns.has("citation")) {
    // The column without a header is the citation column only if its content says so.
    const dated = citations.filter((citation) => YEAR_IN_PARENTHESES.test(citation)).length;
    const withDoi = citations.filter((citation) => doisIn(citation).length > 0).length;
    if (dated !== citations.length || (citations.length > 0 && withDoi === 0)) {
      issue(
        "citationColumn",
        "The first column has no header and does not hold citations: a year in parentheses on every row and a DOI on at least one.",
        `${citations.length} citations`,
        `${dated} with a year, ${withDoi} with a DOI`,
      );
    }
  }
  rows.push(...validationRows(sheet));
  const [lastHeaderRow] = shape.headerRows.slice(-1);
  return {
    tabKey,
    name: sheet.name,
    visibility: sheet.visibility,
    ...(sheet.sheetId === "" ? {} : { sheetId: sheet.sheetId }),
    ...(lastHeaderRow === undefined ? {} : { headerRow: lastHeaderRow }),
    rows,
    fillerRows: 0,
    blankRows,
  };
}

async function read(input: ImportInput): Promise<SourceReading> {
  const opened = openWorkbook(input);
  const { contentHash, inputFiles } = opened;
  if (opened.workbook === null) return { contentHash, inputFiles, tabs: [], issues: opened.issues };
  const issues: StructureIssue[] = [];
  const titles = opened.workbook.sheets.map((sheet) => sheet.name);
  const expected = TABS.map((tab) => TAB_TITLES[tab]);
  const missing = expected.filter((title) => !titles.includes(title));
  const unexpected = titles.filter((title) => !expected.some((known) => known === title));
  if (missing.length > 0 || unexpected.length > 0 || new Set(titles).size !== titles.length) {
    issues.push({
      check: "tabs",
      tabKey: null,
      message: "The workbook does not hold exactly its six known tabs: one is missing, renamed or new.",
      expected: expected.join(" | "),
      found: titles.join(" | "),
    });
  }
  const seen = new Set<string>();
  const tabs: SourceTab[] = [];
  for (const sheet of opened.workbook.sheets) {
    // Two sheets of one title cannot be told apart by their key, so only the first is read.
    if (seen.has(sheet.name)) continue;
    seen.add(sheet.name);
    const tab = TABS.find((candidate) => TAB_TITLES[candidate] === sheet.name);
    tabs.push(tab === undefined ? uninterpretedTab(sheet) : readTab(tab, sheet, issues));
  }
  return { contentHash, inputFiles, tabs, issues };
}

const replication = (studyId: string) => ({ entityType: "replication", entityId: studyId }) as const;
const candidate = (id: string) => ({ entityType: "candidateStudy", entityId: id }) as const;

/** The study types that the workbook lists. Any other value is for a reviewer. */
const STUDY_TYPES: readonly string[] = ["1_Experimental", "2_Correlational"];

/** The stage number of a stage text, read from the pattern `(stage N)` and from nothing else. */
export function stageNumberOf(stage: string): number | null {
  const match = /\(stage (\d{1,2})\)/i.exec(stage);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** The first line of a cell, and the lines that someone appended beneath it. */
function linesOf(cell: string): { readonly first: string; readonly appended: readonly string[] } {
  const [first = "", ...rest] = cell.split(/\r?\n/);
  return { first, appended: rest.map(collapsed).filter((line) => line !== "") };
}

const validYear = (year: number | null): number | null =>
  year !== null && Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null;

/** What marks several experiments or effects in one cell. Such a cell is never split into several records. */
const SEVERAL_EXPERIMENTS = /\bExp(?:t|eriment)?s?\.?\s*\d/i;

/**
 * The screen that keeps remarks about people out of what members read. A value cell is held
 * back when it names a person whom the workbook itself names as a lead, an extractor, a
 * reviewer or a voter, when it carries a date, or when it carries an address. Holding back too
 * much costs little: the cell stays in its source record and a reviewer releases it.
 */
export class RemarkScreen {
  readonly #names = new Set<string>();

  static #plain(text: string): string {
    return text.normalize("NFKD").replace(/\p{M}+/gu, "");
  }

  /** Notes the names of a cell that holds one person or several. A part that reads like a remark contributes nothing. */
  addNames(cell: string): void {
    for (const part of cell.split(/[;,&/\n]|\band\b/)) {
      const words = collapsed(RemarkScreen.#plain(part)).split(" ");
      const named = words.length <= 5 && words.every((word) => /^[\p{L}'’.-]+$/u.test(word));
      if (!named || !/^\p{Lu}/u.test(words[0] ?? "")) continue;
      for (const word of words.flatMap((entry) => entry.split(/[-.'’]/))) {
        if (word.length >= 2 && /^\p{Lu}/u.test(word)) this.#names.add(word);
      }
    }
  }

  /** Whether a value cell carries a remark that members should not read. */
  holdsRemark(text: string): boolean {
    if (text.includes("@")) return true;
    if (/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/.test(text)) return true;
    return RemarkScreen.#plain(text)
      .split(/[^\p{L}]+/u)
      .some((word) => this.#names.has(word));
  }
}

/** One row of a paper tab, with what identifies its paper. */
interface PaperRow {
  readonly tab: PaperTab;
  readonly row: RecordedRow;
  /** The DOI as the row writes it, or null. */
  readonly doi: string | null;
  /** The text that identifies the paper where no DOI does: the citation, or the title of a ranked row. */
  readonly text: string;
  readonly year: number | null;
}

/** One paper, with every row of every tab that is about it. */
interface Paper {
  /** The DOI in lower case, or `title:` and the folded title of a ranked row that has no DOI. */
  readonly key: string;
  readonly doi: string | null;
  readonly rows: PaperRow[];
  /** The replications whose rows of the current tab carry the DOI. One names the study that the paper became. */
  readonly replicationIds: string[];
  candidateId: string | null;
}

interface StudyRow {
  readonly entry: PaperRow;
  /** The identifier as the row writes it. */
  readonly studyId: string;
  readonly replicationId: string;
  /** Whether the replication exists already, as opposed to being created by this plan. */
  readonly exists: boolean;
}

interface StoredLead {
  readonly personId: string;
  readonly name: string;
  readonly recordId: string | undefined;
}

type Holder = { readonly collection: "replications" | "candidateStudies"; readonly id: string };

class ListOfStudiesPlan {
  readonly #context: PlanContext;
  readonly #db: Firestore;
  readonly #builder = new PlanBuilder();
  readonly #terms = new VocabularyCollector();
  readonly #screen = new RemarkScreen();
  readonly #layouts = new Map<Tab, TabLayout>();
  readonly #papers = new Map<string, Paper>();
  /** The paper of each row of a paper tab, by the source record of the row. */
  readonly #paperOfRow = new Map<string, { readonly paper: Paper; readonly entry: PaperRow }>();
  readonly #studies: StudyRow[] = [];
  /** The stage texts that the workbook itself lists, collapsed. Null when it states no list. */
  #stages: ReadonlySet<string> | null = null;

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

  #layout(tab: Tab): TabLayout {
    let layout = this.#layouts.get(tab);
    if (layout === undefined) {
      const stored = this.#stored(tab);
      const labels = stored.find((row) => row.cellLevel !== true)?.labels ?? [];
      const headers = SHAPES[tab].headerRows.flatMap((number) =>
        stored.filter((row) => row.rowClass === "header" && row.rowNumber === number),
      );
      layout = layoutOf(
        tab,
        labels,
        headers.map((row) => labels.map((label) => cellValue(row, label))),
      );
      this.#layouts.set(tab, layout);
    }
    return layout;
  }

  #text(tab: Tab, row: RecordedRow, field: Field): string | null {
    const label = this.#layout(tab).columns.get(field);
    return label === undefined ? null : cellText(row, label);
  }

  /** The content of a cell as text, whether it is stored as a text or as a number. */
  #written(tab: Tab, row: RecordedRow, field: Field): string | null {
    const label = this.#layout(tab).columns.get(field);
    const value = label === undefined ? null : cellValue(row, label);
    return value === null || value === "" ? null : String(value);
  }

  #number(tab: Tab, row: RecordedRow, field: Field): number | null {
    const label = this.#layout(tab).columns.get(field);
    return label === undefined ? null : numberOf(row, label);
  }

  /** The cells of a row in which people typed their names, blank ones left out. */
  #groupCells(tab: Tab, row: RecordedRow): string[] {
    return this.#layout(tab).groups.flatMap((label) => {
      const text = cellText(row, label);
      return text === null || text.trim() === "" ? [] : [text];
    });
  }

  async build(): Promise<ImportPlan> {
    const programme = await this.#db.doc(COLLECTIONS.programmes.docPath(PROGRAMME_KEY)).get();
    if (!programme.exists) {
      this.#builder.block(
        "lookups",
        "The programme document does not exist, so a replication would refer to nothing. Run seed:lookups first.",
      );
      return this.#builder.build();
    }
    this.#structure();
    this.#harvestNames();
    this.#collectPapers();
    await this.#resolveStudies();
    this.#matchPapers();
    this.#stageList();
    for (const study of this.#studies) await this.#study(study);
    this.#candidates();
    this.#archivedRows();
    this.#years();
    this.#rankedVotes();
    this.#questionnaires();
    for (const row of this.#data("scratch")) this.#builder.rawOnly(row.recordId, "purposeUnknown");
    this.#terms.documents(this.#builder);
    return this.#builder.build();
  }

  /** Reports a header that is new, data that sits under no header, and a row that names no record of its tab. */
  #structure(): void {
    const { items } = this.#context;
    for (const tab of TABS) {
      const layout = this.#layout(tab);
      const source = `${SOURCE_KEY}/${tab}`;
      const [header] = this.#stored(tab).filter((row) => row.rowClass === "header");
      for (const { header: text } of layout.unknown) {
        this.#builder.item(
          items.structureChange({
            subject: `${source}/header/${shortHash(text)}`,
            claims: [
              {
                source,
                value: text,
                valueSource: text,
                ...(header === undefined ? {} : { sourceRecordId: header.recordId }),
              },
            ],
          }),
        );
      }
      if (tab === "scratch") continue;
      for (const label of layout.unheaded) {
        // A column that holds data under a blank header is never mapped by guesswork.
        const holders = this.#data(tab).filter((row) => cellValue(row, label) !== null);
        const [first] = holders;
        if (first === undefined) continue;
        this.#builder.item(
          items.structureChange({
            subject: `${source}/unheaded/${label}`,
            claims: [{ source, value: `${holders.length} cells`, sourceRecordId: first.recordId }],
          }),
        );
      }
      for (const row of this.#stored(tab)) {
        if (row.rowClass !== "annotation" || row.cellLevel === true) continue;
        this.#builder.item(
          items.annotationReview({
            subject: `${source}/${row.rowKey}`,
            claims: [{ source, value: row.rawHash, sourceRecordId: row.recordId }],
          }),
        );
      }
    }
  }

  /** Collects the names that the workbook itself gives, for the screen that keeps remarks about people restricted. */
  #harvestNames(): void {
    for (const tab of PAPER_TABS) {
      for (const row of this.#data(tab)) {
        for (const field of ["lead", "extractor", "reviewer"] as const) {
          const cell = this.#text(tab, row, field);
          if (cell !== null) this.#screen.addNames(cell);
        }
        for (const cell of this.#groupCells(tab, row)) this.#screen.addNames(cell);
      }
    }
  }

  #attach(key: string, doi: string | null, entry: PaperRow): void {
    const paper = this.#papers.get(key) ?? { key, doi, rows: [], replicationIds: [], candidateId: null };
    paper.rows.push(entry);
    this.#papers.set(key, paper);
    this.#paperOfRow.set(entry.row.recordId, { paper, entry });
  }

  /** Reads what identifies the paper of each row, and joins the rows that state the same DOI. */
  #collectPapers(): void {
    for (const tab of PAPER_TABS) {
      const citationLabel = this.#layout(tab).columns.get("citation");
      for (const row of this.#data(tab)) {
        const citation = this.#text(tab, row, "citation");
        const stated = collapsed(this.#text(tab, row, "doi") ?? "");
        const citedYear = YEAR_IN_PARENTHESES.exec(citation ?? "")?.[1];
        const ranked = tab === "ranked";
        const doi = ranked
          ? isDoi(stated)
            ? stated
            : null
          : citationLabel === undefined
            ? null
            : citationDoi(row, citationLabel);
        const entry: PaperRow = {
          tab,
          row,
          doi,
          text: ranked ? (this.#text(tab, row, "title") ?? "") : (citation ?? ""),
          year: validYear(ranked ? this.#number(tab, row, "year") : citedYear === undefined ? null : Number(citedYear)),
        };
        if (doi !== null) this.#attach(doiKey(doi), doi, entry);
        else if (ranked) this.#attach(`title:${lookupFold(entry.text)}`, null, entry);
        // A citation without a DOI is placed by its title, in `#matchPapers`.
      }
    }
  }

  /**
   * Decides which replication each row of the current tab is. A spelling that the folded lookup
   * knows keeps the identifier it resolves to, because an existing identifier is never renamed.
   * Any other well-formed identifier is that of a replication which this tab creates.
   */
  async #resolveStudies(): Promise<void> {
    const { items, studies } = this.#context;
    const source = `${SOURCE_KEY}/list`;
    type Claim = { readonly row: RecordedRow; readonly studyId: string; readonly known: boolean };
    const claims = new Map<string, Claim[]>();
    const unmatched = (row: RecordedRow, studyId: string, replicationIds: readonly string[]) =>
      this.#builder.hold(
        row.recordId,
        items.unmatchedIdentifier({
          subject: `${source}/${row.rowKey}`,
          entityRefs: replicationIds.map(replication),
          claims: [{ source, value: studyId, valueSource: studyId, sourceRecordId: row.recordId }],
        }),
      );
    for (const row of this.#data("list")) {
      const studyId = tidied(this.#text("list", row, "studyId") ?? "");
      // The spelling is resolved first, whatever its shape: a lower-case initial or a diacritic names the study it
      // folds to. The shape is asked only of a spelling that resolves to nothing and would name a new replication.
      const resolution = await studies.resolve(studyId);
      if (resolution.status === "resolved" || (resolution.status === "unresolved" && STUDY_ID_PATTERN.test(studyId))) {
        const known = resolution.status === "resolved";
        const target = known ? resolution.replicationId : studyId;
        claims.set(target, [...(claims.get(target) ?? []), { row, studyId, known }]);
      } else {
        // Malformed, or a spelling that several replications carry: no replication is created.
        unmatched(row, studyId, resolution.status === "ambiguous" ? resolution.replicationIds : []);
      }
    }
    for (const [replicationId, rows] of claims) {
      // Of two rows that resolve to one replication, only the one that writes the identifier itself describes it.
      const own = rows.length === 1 ? rows[0] : rows.find((entry) => entry.studyId === replicationId);
      for (const entry of rows) if (entry !== own) unmatched(entry.row, entry.studyId, [replicationId]);
      if (own === undefined) continue;
      // An entry of the folded lookup may outlive its replication. Only a document that exists is updated.
      const exists = own.known && (await this.#db.doc(COLLECTIONS.replications.docPath(replicationId)).get()).exists;
      if (own.known && !exists) {
        unmatched(own.row, own.studyId, []);
        continue;
      }
      const entry = this.#paperOfRow.get(own.row.recordId)?.entry ?? {
        tab: "list",
        row: own.row,
        doi: null,
        text: this.#text("list", own.row, "citation") ?? "",
        year: null,
      };
      this.#studies.push({ entry, studyId: own.studyId, replicationId, exists });
      studies.declare(own.studyId, replicationId, "programme");
      const paper = this.#paperOfRow.get(own.row.recordId)?.paper;
      if (paper !== undefined && !paper.replicationIds.includes(replicationId))
        paper.replicationIds.push(replicationId);
    }
    this.#studies.sort((a, b) => (a.replicationId < b.replicationId ? -1 : 1));
  }

  /** The replication that a paper became: the one study of the current tab that carries its DOI. */
  static #studyOf(paper: Paper | undefined): string | null {
    const [only] = paper?.replicationIds ?? [];
    return paper?.replicationIds.length === 1 && only !== undefined ? only : null;
  }

  /**
   * Places the rows that the DOI does not place. A citation without a DOI is matched to the one
   * ranked row whose title it contains, and such a match is always put to a reviewer. A title
   * that matches while the DOIs differ links nothing. One DOI on two rows of a tab names no
   * single paper there, which is reported as well.
   */
  #matchPapers(): void {
    const { items } = this.#context;
    for (const paper of this.#papers.values()) {
      for (const tab of PAPER_TABS) {
        const sharing = paper.rows.filter((entry) => entry.tab === tab);
        if (sharing.length < 2) continue;
        this.#builder.item(
          items.unmatchedIdentifier({
            subject: `${SOURCE_KEY}/${tab}/paper/${shortHash(paper.key)}`,
            field: "originalDoi",
            entityRefs: paper.replicationIds.map(replication),
            claims: sharing.map((entry) => ({
              source: `${SOURCE_KEY}/${tab}`,
              value: entry.row.rowKey,
              valueSource: paper.doi ?? entry.text,
              sourceRecordId: entry.row.recordId,
            })),
          }),
        );
      }
    }

    const ranked = [...this.#papers.values()].flatMap((paper) =>
      paper.rows.filter((entry) => entry.tab === "ranked").map((entry) => ({ paper, entry })),
    );
    for (const { paper, entry } of ranked) {
      if (paper.doi !== null) continue;
      // The paper is keyed by its first author, its year and its title, which a reviewer confirms.
      this.#builder.item(
        items.unmatchedIdentifier({
          subject: `${SOURCE_KEY}/ranked/${entry.row.rowKey}`,
          field: "originalDoi",
          claims: [
            {
              source: `${SOURCE_KEY}/ranked/title`,
              value: lookupFold(entry.text),
              valueSource: entry.text,
              sourceRecordId: entry.row.recordId,
            },
          ],
        }),
      );
    }
    const byTitle = (citation: string) => {
      const folded = lookupFold(citation);
      const found = ranked.filter(({ entry }) => {
        const title = lookupFold(entry.text);
        // A short title would be found inside many citations, so it identifies nothing.
        return title.length >= 12 && folded.includes(title);
      });
      return found.length === 1 ? found[0] : undefined;
    };

    const mistyped = new Map<string, { readonly paper: Paper; readonly claims: ItemClaim[] }>();
    for (const tab of ["list", "shortlist", "subproject"] as const) {
      const source = `${SOURCE_KEY}/${tab}`;
      for (const row of this.#data(tab)) {
        const placed = this.#paperOfRow.get(row.recordId);
        if (placed?.paper.rows.some((other) => other.tab === "ranked")) continue;
        const citation = this.#text(tab, row, "citation") ?? "";
        const match = byTitle(citation);
        if (placed === undefined) {
          const claim: ItemClaim = {
            source: `${source}/citation`,
            value: lookupFold(citation),
            valueSource: citation,
            sourceRecordId: row.recordId,
          };
          const subject = `${source}/${row.rowKey}`;
          if (tab !== "list" && match !== undefined) {
            // The paper of the ranked row that the title finds is the last place the plan allows a DOI to come from.
            const year = YEAR_IN_PARENTHESES.exec(citation)?.[1];
            this.#attach(match.paper.key, match.paper.doi, {
              tab,
              row,
              doi: null,
              text: citation,
              year: validYear(year === undefined ? null : Number(year)),
            });
            this.#builder.item(
              items.unmatchedIdentifier({
                subject,
                field: "originalDoi",
                claims: [
                  claim,
                  {
                    source: `${SOURCE_KEY}/ranked/title`,
                    value: lookupFold(match.entry.text),
                    valueSource: match.paper.doi ?? match.entry.text,
                    sourceRecordId: match.entry.row.recordId,
                  },
                ],
              }),
            );
          } else if (tab === "list") {
            // The study has an identifier of its own. Only its DOI is missing, which a reviewer supplies.
            this.#builder.item(items.unmatchedIdentifier({ subject, field: "originalDoi", claims: [claim] }));
          } else {
            // Neither a DOI nor a title places the row, so its paper is not known. It waits for a reviewer.
            this.#builder.hold(
              row.recordId,
              items.unmatchedIdentifier({ subject, field: "originalDoi", claims: [claim] }),
            );
          }
        } else if (match !== undefined && match.paper.key !== placed.paper.key) {
          // The title is that of a ranked paper and the DOIs differ: one of them is mistyped. No link is written.
          const found = mistyped.get(placed.paper.key) ?? {
            paper: placed.paper,
            claims: [
              {
                source: `${SOURCE_KEY}/ranked/doi`,
                value: match.paper.key,
                valueSource: match.paper.doi ?? match.entry.text,
                sourceRecordId: match.entry.row.recordId,
              },
            ],
          };
          found.claims.push({
            source: `${source}/doi`,
            value: placed.paper.key,
            valueSource: placed.entry.doi ?? "",
            sourceRecordId: row.recordId,
          });
          mistyped.set(placed.paper.key, found);
        }
      }
    }
    for (const { paper, claims } of mistyped.values()) {
      this.#builder.item(
        items.unmatchedIdentifier({
          subject: `${SOURCE_KEY}/doi/${shortHash(paper.key)}`,
          field: "originalDoi",
          entityRefs: paper.replicationIds.map(replication),
          claims,
        }),
      );
    }
  }

  /** Reads the list against which the workbook itself validates its stage cells. Its options are vocabulary. */
  #stageList(): void {
    const label = this.#layout("list").columns.get("stage");
    if (label === undefined) return;
    for (const list of validatedLists(this.#stored("list"))) {
      if (!list.ranges.every((range) => rowsInColumn(range, label) !== null)) continue;
      this.#stages = new Set([...(this.#stages ?? []), ...list.options.map(collapsed)]);
      for (const option of list.options) {
        if (collapsed(option) !== "") this.#terms.add("progressStage", collapsed(option), list.row.recordId, option);
      }
    }
  }

  /**
   * Raises what a stage cell or a study-type cell asks: wording outside the list of the
   * workbook, a line that someone appended, and a study type other than the two listed ones.
   * No status is ever set from either cell.
   */
  #statusCells(tab: PaperTab, row: RecordedRow, subject: string, entityRefs: readonly EntityRef[]): void {
    const { items } = this.#context;
    const source = `${SOURCE_KEY}/${tab}`;
    const stage = this.#text(tab, row, "stage");
    if (stage !== null && collapsed(stage) !== "") {
      const { first, appended } = linesOf(stage);
      this.#terms.add("progressStage", collapsed(first), row.recordId, first);
      const unlisted = this.#stages !== null && !this.#stages.has(collapsed(first));
      if (unlisted || appended.length > 0) {
        this.#builder.item(
          items.statusQuestion({
            subject,
            field: "progressStage",
            entityRefs,
            claims: [
              { source: `${source}/stage`, value: collapsed(stage), valueSource: stage, sourceRecordId: row.recordId },
              ...(unlisted ? [{ source: `${source}/unlistedStage`, value: collapsed(first) }] : []),
              ...(appended.length > 0 ? [{ source: `${source}/appendedLine`, value: appended.join(" | ") }] : []),
            ],
          }),
        );
      }
    }
    const type = this.#text(tab, row, "studyType");
    if (type === null || collapsed(type) === "") return;
    const { first, appended } = linesOf(type);
    this.#terms.add("studyType", collapsed(first), row.recordId, first);
    const claim: ItemClaim = {
      source: `${source}/studyType`,
      value: collapsed(type),
      valueSource: type,
      sourceRecordId: row.recordId,
    };
    if (!STUDY_TYPES.includes(collapsed(first))) {
      this.#builder.item(items.vocabularyReview({ subject, field: "studyType", entityRefs, claims: [claim] }));
    }
    if (appended.length > 0) {
      this.#builder.item(
        items.statusQuestion({
          subject,
          field: "studyType",
          entityRefs,
          claims: [claim, { source: `${source}/appendedLine`, value: appended.join(" | ") }],
        }),
      );
    }
  }

  /** Notes the keyword terms of a row. Spellings that fold alike become one term that lists each. */
  #keywords(tab: PaperTab, row: RecordedRow): { readonly termId: string; readonly relation: string }[] {
    const relations = { outcome: "outcome", construct: "psychConstruct", descriptors: "descriptor" } as const;
    return KEYWORDS.flatMap((field) =>
      termsOf(this.#text(tab, row, field)).flatMap((term) => {
        const termId = this.#terms.add(relations[field], term, row.recordId);
        return termId === null ? [] : [{ termId, relation: relations[field] }];
      }),
    );
  }

  /** Reports the cells in which people typed their names, where the tab is no voting record. */
  #groupLeftovers(tab: PaperTab, row: RecordedRow, subject: string, entityRefs: readonly EntityRef[]): void {
    const cells = this.#groupCells(tab, row);
    if (cells.length === 0) return;
    this.#builder.item(
      this.#context.items.annotationReview({
        subject,
        field: "groupCells",
        entityRefs,
        // The cells hold names, so the item names the row and leaves the names where they are.
        personal: true,
        claims: [{ source: `${SOURCE_KEY}/${tab}/groups`, value: cells.join(" | "), sourceRecordId: row.recordId }],
      }),
    );
  }

  /** Reports the defects of the links of a row: an editor address, a stray parenthesis, an address that is text only. */
  #linkDefects(tab: PaperTab, row: RecordedRow, subject: string, entityRefs: readonly EntityRef[]): void {
    for (const [field, label] of this.#layout(tab).columns) {
      const target = linkOf(row, label);
      const defects: { readonly defect: string; readonly address: string }[] = [];
      if (target !== null && endsInStrayParenthesis(target))
        defects.push({ defect: "strayParenthesis", address: target });
      if (target !== null && field === "signup" && isStorableUrl(target) && isEditorAddress(target)) {
        defects.push({ defect: "editorAddress", address: target });
      }
      if (target === null && hyperlinkFormulaTarget(formulaOf(row, label) ?? "") === null) {
        for (const address of addressesIn(cellText(row, label) ?? "")) defects.push({ defect: "textOnly", address });
      }
      for (const { defect, address } of defects) {
        this.#builder.item(
          this.#context.items.linkDefect({
            subject,
            field,
            entityRefs,
            claims: [
              {
                source: `${SOURCE_KEY}/${tab}/${defect}`,
                value: address,
                valueSource: address,
                sourceRecordId: row.recordId,
              },
            ],
          }),
        );
      }
    }
  }

  /** Whether the public website data holds a study: it then carries an alias of the scheme `website`. */
  async #onWebsite(replicationId: string): Promise<boolean> {
    const aliases = await this.#db
      .collection(COLLECTIONS.replicationAliases.collectionPath(replicationId))
      .where("scheme", "==", "website")
      .limit(1)
      .get();
    return !aliases.empty;
  }

  /** The current leads that the portal holds for a replication, each with the name of the person. */
  async #storedLeads(replicationId: string): Promise<StoredLead[]> {
    const memberships = await this.#db
      .collection(COLLECTIONS.replicationMemberships.collectionPath(replicationId))
      .get();
    const leads = memberships.docs.filter(
      (doc) => ["lead", "coLead"].includes(String(doc.get("role"))) && doc.get("isCurrent") === true,
    );
    const persons = await readDocuments(
      this.#db,
      leads.map((doc) => COLLECTIONS.persons.docPath(String(doc.get("personId")))),
    );
    return leads
      .map((doc) => {
        const personId = String(doc.get("personId"));
        const name = persons.get(COLLECTIONS.persons.docPath(personId))?.data.displayName;
        const records = doc.get("sourceRecordIds") as string[] | undefined;
        return { personId, name: typeof name === "string" ? name : "", recordId: records?.[0] };
      })
      .sort((a, b) => (a.personId < b.personId ? -1 : 1));
  }

  async #study(study: StudyRow): Promise<void> {
    const { items, studies } = this.#context;
    const builder = this.#builder;
    const { replicationId, studyId } = study;
    const { row } = study.entry;
    const tab = "list";
    const source = `${SOURCE_KEY}/${tab}`;
    const refs = [replication(replicationId)];
    const owned: Record<string, unknown> = {};
    const text = (field: Field) => this.#text(tab, row, field);
    const filled = (cell: string | null): cell is string => cell !== null && collapsed(cell) !== "";

    aliasDocuments(builder, studies, { replicationId, scheme: "programme", alias: studyId, recordId: row.recordId });
    if (studyId !== replicationId) {
      // The row resolves to the replication through another spelling, which a reviewer confirms.
      builder.item(
        items.aliasConfirmation({
          subject: replicationId,
          field: "programme",
          entityRefs: refs,
          claims: [{ source, value: studyId, valueSource: studyId, sourceRecordId: row.recordId }],
        }),
      );
    }

    /** One item for a cell that cannot be read mechanically, with every reason it is raised for. */
    const unparsed = (field: Field, reasons: readonly string[]) => {
      const cell = this.#written(tab, row, field) ?? "";
      const shown = !this.#screen.holdsRemark(cell) && field !== "notes";
      builder.item(
        items.unparsedValue({
          subject: replicationId,
          field,
          entityRefs: refs,
          personal: !shown,
          claims: [
            { source, value: collapsed(cell), ...(shown ? { valueSource: cell } : {}), sourceRecordId: row.recordId },
            ...reasons.map((reason) => ({ source: `${source}/${reason}`, value: reason })),
          ],
        }),
      );
    };
    /**
     * Stores the text of a cell on the replication, unless it exceeds what the field holds or,
     * for a column in which people left remarks, names a person, a date or an address.
     */
    const store = (field: Field, target: string, mode: "verbatim" | "tidied", limit: number, screened: boolean) => {
      const cell = this.#written(tab, row, field);
      if (!filled(cell)) return;
      if (screened && this.#screen.holdsRemark(cell)) {
        builder.item(
          items.privacyReview({
            subject: replicationId,
            field,
            entityRefs: refs,
            claims: [{ source: `${source}/remark`, value: collapsed(cell), sourceRecordId: row.recordId }],
          }),
        );
        return;
      }
      const value = mode === "verbatim" ? cell : tidied(cell);
      if (value.length > limit) unparsed(field, ["tooLong"]);
      else owned[target] = value;
    };

    // The original paper.
    store("citation", "originalReference", "tidied", LIMITS.longText, false);
    store("abstract", "abstract", "tidied", LIMITS.longText, false);
    const { doi } = study.entry;
    const paper = this.#paperOfRow.get(row.recordId)?.paper;
    if (doi !== null && doiSchema.safeParse(doi).success) {
      owned.originalDoi = doi;
      // One DOI on two studies names no single study, so no lookup is written for it.
      if (ListOfStudiesPlan.#studyOf(paper) === replicationId) {
        doiLookupDocument(builder, replication(replicationId), doi, row.recordId);
      }
    }
    const citationLabel = this.#layout(tab).columns.get("citation");
    if (citationLabel !== undefined) {
      // The citation states its DOI up to three times: in its text, as its link and in its formula.
      const stated = [
        { place: "text", doi: doisIn(text("citation") ?? "")[0] ?? null },
        { place: "link", doi: doiOfAddress(linkOf(row, citationLabel) ?? "") },
        { place: "formula", doi: doiOfAddress(hyperlinkFormulaTarget(formulaOf(row, citationLabel) ?? "") ?? "") },
      ].flatMap((entry) => (entry.doi === null ? [] : [{ place: entry.place, doi: entry.doi }]));
      if (new Set(stated.map((entry) => doiKey(entry.doi))).size > 1) {
        builder.item(
          items.valueConflict({
            subject: replicationId,
            field: "originalDoi",
            entityRefs: refs,
            claims: stated.map((entry) => ({
              source: `${source}/citation/${entry.place}`,
              value: doiKey(entry.doi),
              valueSource: entry.doi,
              sourceRecordId: row.recordId,
            })),
          }),
        );
      }
    }

    // The extraction columns. Text is kept as text, and a number is offered only where the cell states exactly one.
    store("effect", "effectOfInterest", "tidied", LIMITS.longText, true);
    store("plain", "plainLanguageDescription", "tidied", LIMITS.longText, true);
    store("statistics", "originalStatistics", "tidied", LIMITS.longText, true);
    store("effectSize", "originalEffectSizeSource", "verbatim", LIMITS.longText, true);
    store("bayesFactor", "originalBayesFactorSource", "verbatim", LIMITS.longText, true);
    store("duration", "durationSource", "verbatim", LIMITS.longText, true);
    store("originalN", "originalNSource", "verbatim", LIMITS.longText, true);
    store("channels", "minEegChannelsSource", "verbatim", LIMITS.longText, true);
    store("powerN", "powerBasedNSource", "verbatim", LIMITS.longText, true);
    store("sample", "sampleType", "tidied", LIMITS.shortText, true);
    store("equipment", "extraEquipment", "tidied", LIMITS.longText, true);

    const reasons = new Map<Field, string[]>();
    const flag = (field: Field, reason: string) => reasons.set(field, [...(reasons.get(field) ?? []), reason]);
    const count = (field: Field, target: string) => {
      const number = this.#number(tab, row, field);
      const cell = text(field);
      const stated = number ?? (cell === null ? null : singleNumberOf(cell));
      const whole = stated !== null && Number.isInteger(stated) && stated >= 0 && stated <= 10_000_000;
      if (whole) owned[target] = stated;
      if (filled(cell)) flag(field, "freeText");
      else if (number !== null && !whole) flag(field, "notWhole");
    };
    count("originalN", "originalN");
    count("channels", "minEegChannels");
    count("powerN", "powerBasedN");
    const power = text("powerN");
    if (power !== null && owned.powerBasedNSource !== undefined && numbersIn(power).length > 1) {
      // The cell states the assumptions of the calculation in its own words, beside the number or in place of it.
      owned.powerAssumptions = tidied(power);
    }
    const convertedText = text("convertedR");
    const converted =
      this.#number(tab, row, "convertedR") ?? (convertedText === null ? null : singleNumberOf(convertedText));
    if (converted !== null) {
      owned.originalEffectSizeValue = converted;
      owned.originalEffectSizeMetric = "r";
    }
    for (const field of ["convertedR", "effectSize", "bayesFactor"] as const) {
      if (filled(text(field))) flag(field, "freeText");
    }
    if (/\bBF\s*01\b/i.test(text("bayesFactor") ?? "")) flag("bayesFactor", "labelledBF01");
    for (const field of EXTRACTION) {
      if (field !== "notes" && SEVERAL_EXPERIMENTS.test(text(field) ?? "")) flag(field, "severalExperiments");
    }
    for (const [field, found] of reasons) unparsed(field, found);

    // Study type and keywords.
    const type = collapsed(linesOf(text("studyType") ?? "").first);
    if (type !== "" && type.length <= LIMITS.shortText) owned.studyType = type;
    store("outcome", "outcome", "tidied", LIMITS.longText, false);
    store("construct", "psychConstruct", "tidied", LIMITS.shortText, false);

    builder.document({
      collection: "replications",
      ids: [replicationId],
      fixed: {
        programmeId: PROGRAMME_KEY,
        studyKey: replicationId,
        citationStatus: "unverified",
        statusKey: null,
        statusHistoryId: null,
        selectionStatus: "selected",
        leadPersonIds: [],
        custom: {},
        // The workbook is a historical source, so a replication that only it holds is labelled as such.
        dataOrigin: "importedHistorical",
      },
      owned,
      union: { vocabulary: this.#keywords(tab, row) },
      sourceRecordIds: [row.recordId],
    });

    this.#statusCells(tab, row, replicationId, refs);
    this.#groupLeftovers(tab, row, replicationId, refs);
    this.#linkDefects(tab, row, replicationId, refs);
    await this.#signup(study);
    await this.#lead(study);
    this.#compareWithArchive(study);

    if (!(await this.#onWebsite(replicationId))) {
      // No status follows from the absence. The stage that this tab states is put beside it for a reviewer.
      const stage = text("stage") ?? "";
      const number = stageNumberOf(stage);
      builder.item(
        items.statusQuestion({
          subject: replicationId,
          field: "status",
          entityRefs: refs,
          claims: [
            { source: `${source}/absentFromWebsite`, value: replicationId, sourceRecordId: row.recordId },
            { source: `${source}/stage`, value: collapsed(stage), valueSource: stage, sourceRecordId: row.recordId },
            ...(number === null ? [] : [{ source: `${source}/stageNumber`, value: String(number) }]),
          ],
        }),
      );
    }
  }

  /**
   * Compares the sign-up link with the links that the portal holds for the study. The link is
   * written only where the portal holds none: it never replaces what another source says, and it
   * is never written to the replication itself, whose sign-up fields belong to the website.
   */
  async #signup(study: StudyRow): Promise<void> {
    const { replicationId } = study;
    const { row } = study.entry;
    const label = this.#layout("list").columns.get("signup");
    if (label === undefined) return;
    // The address is the target of the link. The text of the cell is used only where the cell has no link.
    const target = linkOf(row, label) ?? collapsed(cellText(row, label) ?? "");
    if (target === "") return;
    if (!isStorableUrl(target)) {
      this.#builder.item(
        this.#context.items.unparsedValue({
          subject: replicationId,
          field: "signup",
          entityRefs: [replication(replicationId)],
          claims: [{ source: `${SOURCE_KEY}/list`, value: target, valueSource: target, sourceRecordId: row.recordId }],
        }),
      );
      return;
    }
    const archive = documentLinkSlotId(entityRefId("replication", replicationId), "signupArchive");
    const archivePath = COLLECTIONS.documentLinks.docPath(archive);
    const stored = await readDocuments(this.#db, [archivePath]);
    if (stored.get(archivePath)?.data.url === target) {
      // The portal holds the same address as the archived sign-up link of the study. The row is named beside it.
      this.#builder.document({ collection: "documentLinks", ids: [archive], sourceRecordIds: [row.recordId] });
      return;
    }
    slotLinkDocument(this.#builder, {
      owner: replication(replicationId),
      slot: "signup",
      url: target,
      replicationId,
      ownerScopeKeys: [replicationScopeKey(replicationId)],
      recordId: row.recordId,
    });
    // The kind of a link follows from its address, so another address is one disagreement and not two.
    this.#builder.document({
      collection: "documentLinks",
      ids: [documentLinkSlotId(entityRefId("replication", replicationId), "signup")],
      silent: ["kind"],
      sourceRecordIds: [row.recordId],
    });
  }

  /**
   * Treats the lead cell as a claim. The workbook holds a name and nothing else, so the claim
   * creates no person and no membership. It is compared, as a folded name, with the lead of the
   * archived tab and with the leads that the portal holds, and a difference goes to a reviewer.
   */
  async #lead(study: StudyRow): Promise<void> {
    const { items } = this.#context;
    const { replicationId } = study;
    const { row } = study.entry;
    const name = collapsed(this.#text("list", row, "lead") ?? "");
    if (name === "") return;
    const claims: ItemClaim[] = [
      { source: `${SOURCE_KEY}/list`, value: lookupFold(name), valueSource: name, sourceRecordId: row.recordId },
    ];
    const paper = this.#paperOfRow.get(row.recordId)?.paper;
    for (const entry of paper?.rows.filter((other) => other.tab === "shortlist") ?? []) {
      const archived = collapsed(this.#text("shortlist", entry.row, "lead") ?? "");
      // Names that fold alike count as agreement, so a trailing space raises nothing.
      if (archived === "" || lookupFold(archived) === lookupFold(name)) continue;
      claims.push({
        source: `${SOURCE_KEY}/shortlist`,
        value: lookupFold(archived),
        valueSource: archived,
        sourceRecordId: entry.row.recordId,
      });
    }
    const stored = study.exists ? await this.#storedLeads(replicationId) : [];
    const differing = stored.some((lead) => lookupFold(lead.name) === lookupFold(name)) ? [] : stored;
    for (const lead of differing) {
      claims.push({
        source: "portal/membership",
        value: lead.personId,
        valueSource: lead.name,
        ...(lead.recordId === undefined ? {} : { sourceRecordId: lead.recordId }),
      });
    }
    const entityRefs: EntityRef[] = [
      replication(replicationId),
      ...differing.map((lead): EntityRef => ({ entityType: "person", entityId: lead.personId })),
    ];
    if (claims.length > 1) {
      this.#builder.item(items.conflictingLead({ subject: replicationId, field: "lead", entityRefs, claims }));
    } else if (stored.length === 0) {
      // Nobody is held as the lead of the study. Only a reviewer may make one from a name.
      this.#builder.item(items.candidateLink({ subject: replicationId, field: "lead", entityRefs, claims }));
    }
  }

  /**
   * Compares the current row of a study with its row in the shortlist and in the ranked list.
   * The archived tabs hold earlier generations of the same extraction. One item for each study
   * lists the fields that differ, and nothing fills a gap of the current tab.
   */
  #compareWithArchive(study: StudyRow): void {
    const { items } = this.#context;
    const { replicationId } = study;
    const { row } = study.entry;
    const paper = this.#paperOfRow.get(row.recordId)?.paper;
    const refs = [replication(replicationId)];

    for (const archived of paper?.rows.filter((entry) => entry.tab === "shortlist") ?? []) {
      const claims: ItemClaim[] = [];
      for (const field of ["citation", "abstract", ...EXTRACTION, ...KEYWORDS] as const) {
        const current = this.#written("list", row, field);
        const earlier = this.#written("shortlist", archived.row, field);
        // A cell that one tab leaves empty is a gap and no second value.
        if (current === null || earlier === null || collapsed(current) === "" || collapsed(earlier) === "") continue;
        if (collapsed(current) === collapsed(earlier)) continue;
        // Notes and remarks may name individuals, so the item names the cells and leaves their text where it is.
        const shown = field !== "notes" && !this.#screen.holdsRemark(current) && !this.#screen.holdsRemark(earlier);
        claims.push(
          {
            source: `${SOURCE_KEY}/list/${field}`,
            value: collapsed(current),
            ...(shown ? { valueSource: current } : {}),
            sourceRecordId: row.recordId,
          },
          {
            source: `${SOURCE_KEY}/shortlist/${field}`,
            value: collapsed(earlier),
            ...(shown ? { valueSource: earlier } : {}),
            sourceRecordId: archived.row.recordId,
          },
        );
      }
      if (claims.length === 0) continue;
      this.#builder.item(
        items.valueConflict({ subject: replicationId, field: "extraction", entityRefs: refs, claims }),
      );
    }

    const folded = (cell: string | null) => [...new Set(termsOf(cell).map(lookupFold))].sort().join(",");
    for (const ranked of paper?.rows.filter((entry) => entry.tab === "ranked") ?? []) {
      const claims: ItemClaim[] = [];
      for (const field of KEYWORDS) {
        const current = this.#text("list", row, field);
        const earlier = this.#text("ranked", ranked.row, field);
        if (folded(current) === "" || folded(earlier) === "" || folded(current) === folded(earlier)) continue;
        claims.push(
          {
            source: `${SOURCE_KEY}/list/${field}`,
            value: folded(current),
            valueSource: current ?? "",
            sourceRecordId: row.recordId,
          },
          {
            source: `${SOURCE_KEY}/ranked/${field}`,
            value: folded(earlier),
            valueSource: earlier ?? "",
            sourceRecordId: ranked.row.recordId,
          },
        );
      }
      if (claims.length === 0) continue;
      this.#builder.item(items.valueConflict({ subject: replicationId, field: "keywords", entityRefs: refs, claims }));
    }
  }

  /** The surname of the first author of an author list: what stands before the first comma or semicolon. */
  static #firstSurname(authors: string): string {
    return collapsed(collapsed(authors).split(/[,;]/)[0] ?? "");
  }

  /**
   * Writes the candidate studies of the three archived tabs, where the run writes them at all,
   * each with the selection status that the tabs give it. A paper that became a study is `selected` and names its replication, a
   * paper of the shortlist or of the subproject is `shortlisted`, and any other is a
   * `rankedCandidate`. No status is ever read out of an on-hold or exclusion remark.
   */
  #candidates(): void {
    const { items } = this.#context;
    // Where a candidate paper lives is an open question (docs/MIGRATION_PLAN.md, section 11, question 9). Until it
    // is answered the rows of the three tabs stay source records, and a candidate is written only where the run
    // rehearses that withheld output.
    const written = this.#context.writes("candidateStudies");
    for (const paper of [...this.#papers.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      const archived = paper.rows.filter((entry) => entry.tab !== "list");
      if (archived.length === 0) continue;
      if (!written) {
        for (const entry of archived) this.#builder.rawOnly(entry.row.recordId, "candidateWithheld");
        continue;
      }
      const ranked = archived.filter((entry) => entry.tab === "ranked");
      const cited = archived.filter((entry) => entry.tab !== "ranked");
      const [first] = ranked;
      /** The one value that the rows state, or nothing where they state none or differ. */
      const one = (values: readonly (string | null)[]): string | undefined => {
        const stated = values.flatMap((value) => (value === null || collapsed(value) === "" ? [] : [value]));
        return new Set(stated.map(collapsed)).size === 1 ? stated[0] : undefined;
      };
      const authors = one(ranked.map((entry) => this.#text("ranked", entry.row, "authors")));
      const title = one(ranked.map((entry) => this.#text("ranked", entry.row, "title")));
      const years = new Set(paper.rows.flatMap((entry) => (entry.year === null ? [] : [entry.year])));
      const [year] = years;

      let id: string | null = null;
      if (paper.doi !== null) id = candidateStudyId({ doi: paper.doi });
      else if (first?.year != null && authors !== undefined && title !== undefined) {
        const surname = ListOfStudiesPlan.#firstSurname(authors);
        if (lookupFold(surname) !== "" && lookupFold(title) !== "") {
          id = candidateStudyId({ firstAuthorSurname: surname, year: first.year, title });
        }
      }
      if (id === null) {
        // Nothing identifies the paper, so no candidate is written. Its rows wait for a reviewer.
        for (const entry of archived) {
          const source = `${SOURCE_KEY}/${entry.tab}`;
          this.#builder.hold(
            entry.row.recordId,
            items.unmatchedIdentifier({
              subject: `${source}/${entry.row.rowKey}`,
              field: "candidate",
              claims: [{ source, value: entry.row.rowKey, sourceRecordId: entry.row.recordId }],
            }),
          );
        }
        continue;
      }
      paper.candidateId = id;

      const references = cited.map((entry) => this.#text(entry.tab, entry.row, "citation"));
      const reference = one(references);
      if (reference === undefined && references.filter((value) => value !== null).length > 1) {
        this.#builder.item(
          items.valueConflict({
            subject: id,
            field: "originalReference",
            entityRefs: [candidate(id)],
            claims: cited.map((entry) => ({
              source: `${SOURCE_KEY}/${entry.tab}`,
              value: collapsed(entry.text),
              valueSource: entry.text,
              sourceRecordId: entry.row.recordId,
            })),
          }),
        );
      }
      const doi = paper.doi !== null && doiSchema.safeParse(paper.doi).success ? paper.doi : undefined;
      const kept = (value: string | undefined) =>
        value !== undefined && tidied(value).length <= LIMITS.longText ? tidied(value) : undefined;
      const studyId = ListOfStudiesPlan.#studyOf(paper);
      const supplier = (first ?? cited[0])?.row.recordId ?? "";
      // The citation stands in a row of its own tab, which is named as its source where it is not the first row.
      const citedRow = cited[references.indexOf(reference ?? null)]?.row.recordId;
      this.#builder.document({
        collection: "candidateStudies",
        ids: [id],
        fixed: { programmeId: PROGRAMME_KEY, dataOrigin: "importedHistorical" },
        owned: {
          originalAuthors: kept(authors),
          // Where the tabs give the paper two years, neither is written and a reviewer decides.
          originalYear: years.size === 1 ? year : undefined,
          originalTitle: kept(title),
          originalReference: kept(reference),
          originalDoi: doi,
          selectionStatus: studyId !== null ? "selected" : cited.length > 0 ? "shortlisted" : "rankedCandidate",
          replicationId: studyId,
        },
        // What a reviewer decides about a candidate stands, and the open questions already ask for it.
        silent: ["selectionStatus", "replicationId"],
        sourceRecordIds: [supplier, ...archived.map((entry) => entry.row.recordId)],
        ...(reference === undefined || citedRow === undefined ? {} : { fieldSources: { originalReference: citedRow } }),
      });
      if (doi !== undefined) doiLookupDocument(this.#builder, candidate(id), doi, supplier);
    }
  }

  /** The vocabulary, the status questions and the leftovers of the rows of the archived tabs. */
  #archivedRows(): void {
    for (const tab of ["shortlist", "ranked", "subproject"] as const) {
      const source = `${SOURCE_KEY}/${tab}`;
      for (const row of this.#data(tab)) {
        const placed = this.#paperOfRow.get(row.recordId);
        const candidateId = placed?.paper.candidateId ?? null;
        const subject = candidateId ?? `${source}/${row.rowKey}`;
        const refs = candidateId === null ? [] : [candidate(candidateId)];
        // The keywords of a candidate paper become terms only together with the candidate.
        if (this.#context.writes("candidateStudies")) this.#keywords(tab, row);
        if (tab !== "ranked") {
          this.#statusCells(tab, row, subject, refs);
          this.#groupLeftovers(tab, row, subject, refs);
          this.#linkDefects(tab, row, subject, refs);
          continue;
        }
        const stated = this.#written(tab, row, "year");
        if (stated !== null && placed?.entry.year === null) {
          // A year that is no whole number of a plausible range is kept as it is written and offered to a reviewer.
          this.#builder.item(
            this.#context.items.unparsedValue({
              subject,
              field: "year",
              entityRefs: refs,
              claims: [{ source, value: stated, valueSource: stated, sourceRecordId: row.recordId }],
            }),
          );
        }
      }
    }
  }

  /** Reports a paper to which the tabs give different years. */
  #years(): void {
    const { items } = this.#context;
    const cited = this.#layout("questionnaires").columns.get("questionnaireStudy");
    for (const paper of this.#papers.values()) {
      const claims: ItemClaim[] = paper.rows.flatMap((entry) =>
        entry.year === null
          ? []
          : [
              {
                source: `${SOURCE_KEY}/${entry.tab}`,
                value: String(entry.year),
                valueSource: String(entry.year),
                sourceRecordId: entry.row.recordId,
              },
            ],
      );
      // The hidden planning list cites some of the same papers, and its citations are evidence of the year as well.
      for (const row of paper.doi === null ? [] : this.#data("questionnaires")) {
        const cell = cited === undefined ? "" : (cellText(row, cited) ?? "");
        const year = YEAR_IN_PARENTHESES.exec(cell)?.[1];
        if (year === undefined || !doisIn(cell).some((doi) => doiKey(doi) === paper.key)) continue;
        claims.push({
          source: `${SOURCE_KEY}/questionnaires`,
          value: year,
          valueSource: year,
          sourceRecordId: row.recordId,
        });
      }
      if (new Set(claims.map((claim) => claim.value)).size < 2) continue;
      const studyId = ListOfStudiesPlan.#studyOf(paper);
      this.#builder.item(
        items.valueConflict({
          subject: studyId ?? paper.candidateId ?? `${SOURCE_KEY}/paper/${shortHash(paper.key)}`,
          field: "originalYear",
          entityRefs:
            studyId !== null
              ? [replication(studyId)]
              : paper.candidateId !== null
                ? [candidate(paper.candidateId)]
                : [],
          claims,
        }),
      );
    }
  }

  /** Recounts the votes of each ranked row and reports a cached count that no longer agrees. Nothing is corrected. */
  #rankedVotes(): void {
    for (const row of this.#data("ranked")) {
      const cached = this.#number("ranked", row, "votes");
      const recount = this.#groupCells("ranked", row).length;
      if (cached === null || cached === recount) continue;
      const source = `${SOURCE_KEY}/ranked`;
      this.#builder.item(
        this.#context.items.annotationReview({
          subject: `${source}/${row.rowKey}`,
          field: "votesCount",
          claims: [
            {
              source: `${source}/cached`,
              value: String(cached),
              valueSource: String(cached),
              sourceRecordId: row.recordId,
            },
            { source: `${source}/recount`, value: String(recount), valueSource: String(recount) },
          ],
        }),
      );
    }
  }

  /**
   * Keeps the hidden planning list raw. A row whose text equals the questionnaire cell of a
   * study, or of a candidate of the subproject, is named beside that record as a cross-reference.
   */
  #questionnaires(): void {
    const label = this.#layout("questionnaires").columns.get("questionnaireName");
    const holders = new Map<string, Holder[]>();
    const note = (cell: string | null, holder: Holder) => {
      const key = collapsed(cell ?? "");
      // A cell that says `none` in its own words is no questionnaire to find again.
      if (key !== "" && nullLikeOf(cell) === null) holders.set(key, [...(holders.get(key) ?? []), holder]);
    };
    for (const study of this.#studies) {
      const cell = this.#text("list", study.entry.row, "questionnaires");
      note(cell, { collection: "replications", id: study.replicationId });
    }
    for (const row of this.#data("subproject")) {
      const candidateId = this.#paperOfRow.get(row.recordId)?.paper.candidateId ?? null;
      if (candidateId === null) continue;
      note(this.#text("subproject", row, "questionnaires"), { collection: "candidateStudies", id: candidateId });
    }
    for (const row of this.#data("questionnaires")) {
      const matches = label === undefined ? [] : (holders.get(collapsed(cellText(row, label) ?? "")) ?? []);
      for (const { collection, id } of matches) {
        this.#builder.document({ collection, ids: [id], sourceRecordIds: [row.recordId] });
      }
      if (matches.length === 0) this.#builder.rawOnly(row.recordId, "planningList");
    }
  }
}

export const importer: ImporterDefinition = {
  key: "listOfStudies",
  sourceKey: SOURCE_KEY,
  summary: "List of studies: the extraction data of every study, and the candidate papers of the earlier phases.",
  inputDescription: "the Excel export of the workbook",
  // The website data creates the studies that it lists, as live records. This workbook creates the others.
  after: ["h"],
  read,
  plan: (context) => new ListOfStudiesPlan(context).build(),
};
