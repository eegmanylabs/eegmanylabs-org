// Source B: the naming conventions (docs/MIGRATION_PLAN.md, section 4.2). One workbook with
// one tab that gives, for each study, its name in four schemes. It is the only source of the
// cloud-account, BIDS and EEGNet names.
//
// | Column header                        | Scheme of the alias | Kept beside the alias       |
// |--------------------------------------|---------------------|-----------------------------|
// | `Original Name`                      | `programme`         |                             |
// | `Standardized Name - cloud accounts` | `cloudAccount`      | `Explanation`, verbatim     |
// | `Standardized Name - BIDS`           | `bids`              | `Part 1` and `Part 2`       |
// | `EEGnet name`                        | `eegnet`            |                             |
//
// The stored value of a name is authoritative. No name is ever derived from a naming rule: the
// rules run as a lint that reports what departs from them and corrects nothing. The workbook
// is imported as a whole or not at all, and no replication is created from it.
import { existsSync, readFileSync, statSync } from "node:fs";
import { type AliasScheme, type EntityRef, LIMITS, lookupFold, shortHash } from "@eegml/shared";
import { holdsContent, rawCellOf } from "../cells";
import type {
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  PlanContext,
  RecordedRow,
  SourceReading,
  SourceRow,
  StructureIssue,
} from "../model";
import { WorkbookFormatError } from "../ooxml";
import { PlanBuilder } from "../plan";
import { aliasDocuments, cellValue } from "../records";
import { contentRowKey, sha256OfBytes } from "../values";
import { cellsByRow, columnLetters, readWorkbook, type Workbook } from "../workbook";
import { inputFileOf } from "../workbook-rows";

/** The hidden state of a row is provenance of every workbook. That of a column is said once, on the header record. */
const HIDDEN_ROW = { hiddenRow: true } as const;
const HIDDEN_STATE = { hidden: true } as const;

const SOURCE_KEY = "b";
/** The key of the one tab. The tab is selected by position, and its title is the spreadsheet default. */
const TAB_KEY = "t0";

const HEADERS = {
  name: "Original Name",
  cloud: "Standardized Name - cloud accounts",
  explanation: "Explanation",
  part1: "Part 1",
  part2: "Part 2",
  bids: "Standardized Name - BIDS",
  eegnet: "EEGnet name",
} as const;
type Field = keyof typeof HEADERS;
const FIELDS = Object.keys(HEADERS) as readonly Field[];

const SCHEMES: readonly { readonly field: Field; readonly scheme: AliasScheme }[] = [
  { field: "name", scheme: "programme" },
  { field: "cloud", scheme: "cloudAccount" },
  { field: "bids", scheme: "bids" },
  { field: "eegnet", scheme: "eegnet" },
];

/** The text of a header cell as it is compared: trimmed, with its case preserved. */
const headerText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

async function read(input: ImportInput): Promise<SourceReading> {
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
  const [sheet] = workbook.sheets;
  if (sheet === undefined || workbook.sheets.length !== 1) {
    // With a second tab it is no longer certain which tab holds the names, so nothing is read.
    issue("tabs", "The workbook does not have exactly one tab.", "1", String(workbook.sheets.length));
    return { contentHash, inputFiles, tabs: [], issues };
  }

  const byRow = cellsByRow(sheet);
  const columns = Array.from({ length: sheet.lastColumn }, (_unused, index) => index + 1);
  const headers = new Map(columns.map((column) => [column, headerText(byRow.get(1)?.get(column)?.value)]));
  const headed = columns.filter((column) => headers.get(column) !== "");
  const found = headed.map((column) => headers.get(column) ?? "");
  const required = FIELDS.map((field) => HEADERS[field]);
  if (required.some((header) => found.filter((candidate) => candidate === header).length !== 1)) {
    issue(
      "header",
      "Row 1 does not hold each of the seven expected headers exactly once.",
      required.join(" | "),
      found.join(" | "),
    );
  }
  const nameColumn = headed.find((column) => headers.get(column) === HEADERS.name);

  const rows: SourceRow[] = [];
  const keys = new Set<string>();
  const unkeyed = new Map<string, number>();
  let blankRows = 0;
  let badKeys = 0;
  for (let row = 1; row <= sheet.lastRow; row += 1) {
    const cells = byRow.get(row);
    if (row === 1) {
      rows.push({
        rowClass: "header",
        rowNumber: 1,
        rowKey: "header",
        cells: columns.map((column) => rawCellOf(cells?.get(column), HIDDEN_STATE)),
        labels: columns.map(columnLetters),
      });
      continue;
    }
    // A cell under a blank header belongs to no field. It is captured by itself, as an annotation.
    for (const column of columns.filter((candidate) => !headed.includes(candidate))) {
      const stray = rawCellOf(cells?.get(column), HIDDEN_ROW);
      if (!holdsContent(stray)) continue;
      rows.push({
        rowClass: "annotation",
        rowNumber: row,
        rowKey: contentRowKey([stray], row, unkeyed),
        cells: [stray],
        labels: [columnLetters(column)],
        cellLevel: true,
      });
    }
    const record = headed.map((column) => rawCellOf(cells?.get(column), HIDDEN_ROW));
    if (!record.some(holdsContent)) {
      blankRows += 1;
      continue;
    }
    const name = nameColumn === undefined ? null : (cells?.get(nameColumn)?.value ?? null);
    const folded = typeof name === "string" ? lookupFold(name) : "";
    const keyed = folded !== "" && folded.length <= LIMITS.shortText && !keys.has(folded);
    if (typeof name === "string" && name.trim() !== "" && !keyed) badKeys += 1;
    const rowKey = keyed ? folded : contentRowKey(record, row, unkeyed);
    keys.add(rowKey);
    rows.push({
      // A row with content and no name is no study. It is kept, and a reviewer places it.
      rowClass: typeof name === "string" && name.trim() !== "" ? "data" : "annotation",
      rowNumber: row,
      rowKey,
      cells: record,
      labels: headed.map(columnLetters),
    });
  }
  if (badKeys > 0) {
    issue(
      "key",
      `${badKeys} rows have a name of which nothing is left after folding, or one that another row has as well.`,
      "one distinct name for each row",
      `${badKeys} rows without one`,
    );
  }
  return {
    contentHash,
    inputFiles,
    tabs: [
      {
        tabKey: TAB_KEY,
        name: sheet.name,
        visibility: sheet.visibility,
        ...(sheet.sheetId === "" ? {} : { sheetId: sheet.sheetId }),
        headerRow: 1,
        rows,
        fillerRows: 0,
        blankRows,
      },
    ],
    issues,
  };
}

interface NameRow {
  readonly row: RecordedRow;
  /** The seven cells as written. */
  readonly text: Readonly<Record<Field, string>>;
  /** The formula text of a cell, relative to its own row, or null for a typed literal. */
  readonly formula: Readonly<Record<Field, string | null>>;
  readonly replicationId: string | null;
}

/** The value of an alias cell without its one footnote marker. The raw cell stays in the source record. */
const withoutMarker = (value: string): string => (value.endsWith("*") ? value.slice(0, -1) : value);

/**
 * Recomputes the three formula shapes that the workbook uses, from the cells of the same row.
 * Null for any other formula, which the lint then reports as one it cannot check.
 */
function recompute(formula: string, cell: (column: string) => string | null): string | null {
  const reference = String.raw`\s*([A-Z]{1,3})\{r\}\s*`;
  const left = new RegExp(String.raw`^LEFT\(${reference},\s*(\d+)\s*\)$`, "i").exec(formula);
  if (left) return cell(left[1] ?? "")?.slice(0, Number(left[2])) ?? null;
  const mid = new RegExp(String.raw`^MID\(${reference},\s*(\d+)\s*,\s*(\d+)\s*\)$`, "i").exec(formula);
  if (mid) return cell(mid[1] ?? "")?.slice(Number(mid[2]) - 1, Number(mid[2]) - 1 + Number(mid[3])) ?? null;
  const joined = new RegExp(String.raw`^CONCATENATE\(${reference},${reference}\)$`, "i").exec(formula);
  if (joined) {
    const [first, second] = [cell(joined[1] ?? ""), cell(joined[2] ?? "")];
    return first === null || second === null ? null : first + second;
  }
  return null;
}

/** The cloud-account name that the token rule gives, or null where the rule cannot produce one. */
function cloudNameByRule(name: string): string | null {
  const year = name.slice(-4);
  const tokens = name.slice(0, -4).match(/[A-Z][a-z]*/g) ?? [];
  const [first, second] = tokens;
  if (tokens.length === 1 && first !== undefined) return first.slice(0, 4) + year;
  if (tokens.length === 2 && first !== undefined && second !== undefined)
    return first.slice(0, 2) + second.slice(0, 2) + year;
  return null;
}

async function plan(context: PlanContext): Promise<ImportPlan> {
  const { items, studies } = context;
  const builder = new PlanBuilder();
  const stored = context.rows.get(TAB_KEY) ?? [];
  const header = stored.find((row) => row.rowClass === "header");
  const source = `${SOURCE_KEY}/${TAB_KEY}`;
  const replication = (studyId: string): EntityRef => ({ entityType: "replication", entityId: studyId });

  // Columns are located by header text, because the spacer columns may move.
  const columnOf = new Map<string, string>();
  for (const label of header?.labels ?? []) {
    const text = headerText(header === undefined ? null : cellValue(header, label));
    if (text !== "") columnOf.set(text, label);
  }
  const known = new Set<string>(FIELDS.map((field) => HEADERS[field]));
  for (const [text, label] of columnOf) {
    if (known.has(text) || header === undefined) continue;
    // A header that is new or renamed is reported. Its cells stay in the source records.
    builder.item(
      items.structureChange({
        subject: `${source}/header/${label}`,
        claims: [{ source, value: text, valueSource: text, sourceRecordId: header.recordId }],
      }),
    );
  }

  const structure = (
    check: string,
    message: string,
    subject: string,
    values: readonly string[],
    recordIds: readonly string[],
  ) =>
    builder.block(
      check,
      message,
      items.structureChange({
        subject,
        blocking: true,
        claims: values.map((value, index) => ({
          source: `${source}/${check}`,
          value,
          valueSource: value,
          ...(recordIds[index] === undefined ? {} : { sourceRecordId: recordIds[index] }),
        })),
      }),
    );

  const data = stored.filter((row) => row.rowClass === "data");
  const names: NameRow[] = [];
  for (const row of data) {
    const text = {} as Record<Field, string>;
    const formula = {} as Record<Field, string | null>;
    let complete = true;
    for (const field of FIELDS) {
      const label = columnOf.get(HEADERS[field]) ?? "";
      const cell = row.cells[row.labels.indexOf(label)];
      const value = cellValue(row, label);
      const isError = typeof cell === "object" && cell !== null && cell.t === "error";
      if (typeof value !== "string" || value === "" || value.length > LIMITS.shortText || isError) complete = false;
      text[field] = typeof value === "string" ? value : "";
      const written = typeof cell === "object" && cell !== null && typeof cell.f === "string" ? cell.f : null;
      // A reference to the cell's own row is written as `{r}`, so that the formulas of a column can be compared.
      formula[field] =
        written?.replace(
          new RegExp(String.raw`(?<![A-Za-z0-9$])(\$?[A-Z]{1,3})${row.rowNumber}(?!\d)`, "g"),
          "$1{r}",
        ) ?? null;
    }
    if (!complete) {
      // A stored value that is missing, empty or an error is never replaced by a recomputed one.
      structure(
        "value",
        "A name cell of a study row holds no text: it is empty, or an error value.",
        `${source}/${row.rowKey}`,
        [row.rowKey],
        [row.recordId],
      );
      continue;
    }
    // The name is resolved whatever its shape: a lower-case initial or a diacritic names the study it folds to.
    const resolution = await studies.resolve(text.name);
    const claim = { source, value: text.name, valueSource: text.name, sourceRecordId: row.recordId };
    if (resolution.status !== "resolved") {
      // No replication is created from this workbook. The row waits until its study exists.
      builder.item(
        items.unmatchedIdentifier({
          subject: `${source}/${row.rowKey}`,
          entityRefs: resolution.status === "ambiguous" ? resolution.replicationIds.map(replication) : [],
          claims: [claim],
        }),
      );
    } else if (text.name !== resolution.replicationId) {
      // The name resolves to its study through another spelling of the identifier, which a reviewer confirms.
      builder.item(
        items.aliasConfirmation({
          subject: resolution.replicationId,
          field: "programme",
          entityRefs: [replication(resolution.replicationId)],
          claims: [claim],
        }),
      );
    }
    names.push({
      row,
      text,
      formula,
      replicationId: resolution.status === "resolved" ? resolution.replicationId : null,
    });
  }

  // Footnotes: an annotation that begins with `*` applies to every cell whose value ends with `*`.
  const notes = stored.filter((row) => row.rowClass === "annotation" && row.cellLevel === true);
  const noteText = (row: RecordedRow) => String(cellValue(row, row.labels[0] ?? "") ?? "");
  const footnotes = notes.filter((row) => noteText(row).startsWith("*"));
  const marked = names.flatMap((entry) =>
    FIELDS.filter((field) => entry.text[field].endsWith("*")).map((field) => ({ entry, field })),
  );
  if ((footnotes.length === 0) !== (marked.length === 0) || footnotes.length > 1) {
    structure(
      "footnote",
      "The footnote and the cells that carry its marker do not go together: there are marked cells without one footnote, or a footnote without marked cells.",
      `${source}/footnote`,
      [`${footnotes.length} footnotes`, `${marked.length} marked cells`],
      [footnotes[0]?.recordId ?? marked[0]?.entry.row.recordId ?? ""].filter((id) => id !== ""),
    );
  }
  const footnote = footnotes[0] === undefined ? undefined : noteText(footnotes[0]);
  for (const row of stored.filter(
    (candidate) => candidate.rowClass === "annotation" && !footnotes.includes(candidate),
  )) {
    // A stray cell, or a row with content and no name: a reviewer says what it means and where it belongs.
    builder.item(
      items.annotationReview({
        subject: `${source}/${row.rowKey}`,
        claims: [{ source, value: row.rawHash, sourceRecordId: row.recordId }],
      }),
    );
  }

  // One scheme and alias on two rows is allowed only where the footnote explains it.
  const holders = new Map<
    string,
    { readonly scheme: AliasScheme; readonly alias: string; readonly rows: NameRow[]; marked: boolean }
  >();
  for (const entry of names) {
    for (const { field, scheme } of SCHEMES) {
      const alias = withoutMarker(entry.text[field]);
      const key = `${scheme}\n${alias}`;
      const holder = holders.get(key) ?? { scheme, alias, rows: [], marked: true };
      holder.rows.push(entry);
      holder.marked &&= entry.text[field].endsWith("*");
      holders.set(key, holder);
    }
  }
  const spellings = new Map<string, Set<string>>();
  const schemesOf = new Map<string, Set<AliasScheme>>();
  for (const holder of holders.values()) {
    const insensitive = `${holder.scheme}\n${holder.alias.toLowerCase()}`;
    spellings.set(insensitive, (spellings.get(insensitive) ?? new Set()).add(holder.alias));
    schemesOf.set(holder.alias, (schemesOf.get(holder.alias) ?? new Set()).add(holder.scheme));
    if (holder.rows.length < 2) continue;
    const recordIds = holder.rows.map((entry) => entry.row.recordId);
    if (!holder.marked || footnote === undefined) {
      structure(
        "duplicate",
        `One ${holder.scheme} name belongs to ${holder.rows.length} rows without the footnote marker.`,
        `${source}/${holder.scheme}/${shortHash(holder.alias)}`,
        holder.rows.map((entry) => entry.row.rowKey),
        recordIds,
      );
      continue;
    }
    builder.item(
      items.aliasConfirmation({
        subject: `${source}/${holder.scheme}/${shortHash(holder.alias)}`,
        entityRefs: holder.rows.flatMap((entry) => entry.replicationId ?? []).map(replication),
        claims: holder.rows.map((entry) => ({
          source: `${source}/${entry.row.rowKey}`,
          value: holder.alias,
          valueSource: holder.alias,
          sourceRecordId: entry.row.recordId,
        })),
      }),
    );
  }
  for (const [insensitive, written] of spellings) {
    if (written.size < 2) continue;
    structure(
      "case",
      "Two names of one scheme differ only by case.",
      `${source}/case/${shortHash(insensitive)}`,
      [...written].sort(),
      [],
    );
  }
  for (const [alias, schemes] of schemesOf) {
    if (schemes.size < 2) continue;
    // One string in two schemes: an alias names a study only together with its scheme.
    const carrying = [...holders.values()].filter((holder) => holder.alias === alias);
    builder.item(
      items.aliasConfirmation({
        subject: `${source}/schemes/${shortHash(alias)}`,
        entityRefs: [
          ...new Set(carrying.flatMap((holder) => holder.rows.flatMap((entry) => entry.replicationId ?? []))),
        ].map(replication),
        claims: carrying.map((holder) => ({
          source: `${source}/${holder.scheme}`,
          value: alias,
          valueSource: alias,
          ...(holder.rows[0] === undefined ? {} : { sourceRecordId: holder.rows[0].row.recordId }),
        })),
      }),
    );
  }

  for (const entry of names) {
    if (entry.replicationId === null) continue;
    for (const { field, scheme } of SCHEMES) {
      const isMarked = entry.text[field].endsWith("*");
      const owned: Record<string, unknown> = {};
      if (scheme === "cloudAccount") owned.explanation = entry.text.explanation;
      if (scheme === "bids") Object.assign(owned, { part1: entry.text.part1, part2: entry.text.part2 });
      // The footnote is kept with every alias whose cell carries its marker.
      if (isMarked && footnote !== undefined) owned.explanation = footnote;
      aliasDocuments(builder, studies, {
        replicationId: entry.replicationId,
        scheme,
        alias: withoutMarker(entry.text[field]),
        ...(Object.keys(owned).length === 0 ? {} : { owned }),
        recordId: entry.row.recordId,
      });
    }
  }

  // The lint. It reports and corrects nothing.
  const lint = (entry: NameRow, field: Field, check: string, storedValue: string, expected: string) =>
    builder.item(
      items.annotationReview({
        subject: `${source}/${entry.row.rowKey}`,
        field,
        entityRefs: entry.replicationId === null ? [] : [replication(entry.replicationId)],
        claims: [
          {
            source: `${source}/${check}/stored`,
            value: storedValue,
            valueSource: storedValue,
            sourceRecordId: entry.row.recordId,
          },
          { source: `${source}/${check}/expected`, value: expected, valueSource: expected },
        ],
      }),
    );
  const prefixes = new Map<string, number>();
  for (const entry of names)
    prefixes.set(entry.text.name.slice(0, 3), (prefixes.get(entry.text.name.slice(0, 3)) ?? 0) + 1);
  const usual = new Map<Field, string>();
  for (const field of ["part1", "part2", "bids"] as const) {
    const counts = new Map<string, number>();
    for (const entry of names) {
      const formula = entry.formula[field];
      if (formula !== null) counts.set(formula, (counts.get(formula) ?? 0) + 1);
    }
    const [most] = [...counts].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1));
    if (most !== undefined) usual.set(field, most[0]);
  }
  for (const entry of names) {
    const { text, formula } = entry;
    const shared = (prefixes.get(text.name.slice(0, 3)) ?? 0) > 1;
    const cell = (column: string) => {
      const value = cellValue(entry.row, column);
      return typeof value === "string" ? value : null;
    };
    for (const field of ["part1", "part2", "bids"] as const) {
      const written = formula[field];
      // Several studies that share their first three letters are told apart by a typed letter in `Part 2`.
      const literalExpected = field === "part2" && shared;
      if ((written === null) !== literalExpected) {
        lint(entry, field, "kind", written === null ? "literal" : "formula", literalExpected ? "literal" : "formula");
      }
      if (written === null) continue;
      if (written !== usual.get(field)) lint(entry, field, "pattern", written, usual.get(field) ?? "");
      const recomputed = recompute(written, cell);
      if (recomputed !== text[field])
        lint(entry, field, "recomputed", text[field], recomputed ?? "a formula the lint cannot check");
    }
    const cloud = cloudNameByRule(text.name);
    if (cloud !== text.cloud)
      lint(entry, "cloud", "tokenRule", text.cloud, cloud ?? "no name: the rule covers one or two name parts");
    if (!/^[A-Za-z]{4}\d{4}$/.test(text.cloud) || text.cloud.slice(-4) !== text.name.slice(-4)) {
      lint(entry, "cloud", "shape", text.cloud, `four letters and ${text.name.slice(-4)}`);
    }
    const tokens = text.explanation.split(" + ");
    if (tokens.length !== 3 || `${tokens[0]}${tokens[1]}` !== text.cloud.slice(0, 4)) {
      lint(entry, "explanation", "prefix", text.explanation, text.cloud.slice(0, 4));
    }
    if (tokens.length === 3 && !/^[A-Z]$/.test(tokens[2] ?? "")) {
      lint(entry, "explanation", "thirdToken", tokens[2] ?? "", "one capital letter");
    }
    const bids = withoutMarker(text.bids);
    const eegnet = withoutMarker(text.eegnet);
    if (!/^[A-Za-z0-9]+$/.test(bids)) lint(entry, "bids", "shape", text.bids, "letters and digits");
    if (!/^[A-Z]{3}$/.test(eegnet)) lint(entry, "eegnet", "shape", text.eegnet, "three capital letters");
    const byRule = (formula.part2 === null ? bids.slice(0, 2) + bids.slice(3, 4) : bids.slice(0, 3)).toUpperCase();
    if (eegnet !== byRule) lint(entry, "eegnet", "rule", text.eegnet, byRule);
  }
  return builder.build();
}

export const importer: ImporterDefinition = {
  key: "namingConventions",
  sourceKey: SOURCE_KEY,
  summary: "Naming conventions: the cloud-account, BIDS and EEGNet names of every study.",
  inputDescription: "the Excel export of the workbook",
  // The names are given to studies that exist. It runs after the website data, and once more after the list of studies.
  after: ["h"],
  read,
  plan,
};
