// Source C: the community vocabulary (docs/MIGRATION_PLAN.md, section 4.5). One workbook with
// one tab, in the layout of a community vocabulary curation table: one term to a row.
//
// | Column header    | Required | Stored on the term as                                         |
// |------------------|----------|---------------------------------------------------------------|
// | `id`             | yes      | The identifier of the document, and `sourceId`                |
// | `name`           | yes      | `name`, verbatim, and one entry of `labelsSource`             |
// | `abbreviation`   | yes      | `abbreviation`, verbatim                                      |
// | `description`    | yes      | `description`, verbatim                                       |
// | `invalid_reason` | no       | `invalidReason`, verbatim. Any value marks the term deprecated |
// | `same_as`        | no       | `sameAsSource`, verbatim, when it is an accepted external code |
//
// A term is keyed by its `id` as written and never by its name, its abbreviation or its row.
// Nothing is corrected, no term is merged with another, and a `same_as` code is never resolved
// to a local term or looked up. The workbook is imported as a whole or not at all.
import { existsSync, readFileSync, statSync } from "node:fs";
import { COLLECTIONS, LIMITS, lookupFold, shortHash } from "@eegml/shared";
import { holdsContent, rawCellOf } from "../cells";
import { type ExternalCode, parseExternalCode } from "../codes";
import { readDocuments } from "../context";
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
import type { ItemClaim } from "../reconcile";
import { cellValue } from "../records";
import { contentRowKey, sha256OfBytes } from "../values";
import { cellsByRow, columnLetters, readWorkbook, type Workbook } from "../workbook";
import { inputFileOf } from "../workbook-rows";

/** The hidden state of a row is provenance of every workbook. That of a column is said once, on the header record. */
const HIDDEN_ROW = { hiddenRow: true } as const;
const HIDDEN_STATE = { hidden: true } as const;

const SOURCE_KEY = "c";
/** The key of the one tab. The tab is selected by position, as the tool chain that the sheet is curated for does. */
const TAB_KEY = "t0";
/** The `kind` of every term of the community vocabulary. */
export const COMMUNITY_VOCABULARY_KIND = "community";

const REQUIRED_HEADERS = ["id", "name", "abbreviation", "description"] as const;
const OPTIONAL_HEADERS = ["invalid_reason", "same_as"] as const;
type Field = (typeof REQUIRED_HEADERS)[number] | (typeof OPTIONAL_HEADERS)[number];
const FIELDS: readonly Field[] = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

/** The characters that the sheet's own validation rule allows in an identifier. */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/** The form that Firestore reserves, which no document identifier may take. */
const RESERVED_ID_PATTERN = /^__.*__$/;
/** The form that the identifiers of the sheet follow. Another valid form is imported and reported. */
const USUAL_ID_PATTERN = /^trm_\d{3}$/;
/** The categories that a name begins with, before the first ` - `. */
const CATEGORIES: readonly string[] = ["Participant", "Meta"];
/** A type that a name states in parentheses at its end. It is a hint for a reviewer and validates nothing. */
const VALUE_TYPE_HINT = /\((integer|number|boolean|text|date)\)\s*$/i;

/** The text of a header cell as it is compared: trimmed and in lower case. */
const headerText = (value: unknown): string => (typeof value === "string" ? value.trim().toLowerCase() : "");

/** Whether a cell value can be the identifier of a term. */
function isUsableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ID_PATTERN.test(value) &&
    !RESERVED_ID_PATTERN.test(value) &&
    value.length <= LIMITS.shortText
  );
}

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
    // With a second tab it is no longer certain which tab holds the vocabulary, so nothing is read.
    issue("tabs", "The workbook does not have exactly one tab.", "1", String(workbook.sheets.length));
    return { contentHash, inputFiles, tabs: [], issues };
  }

  const byRow = cellsByRow(sheet);
  // The used range, whatever grid the file declares: rows that were only formatted in advance hold no value.
  const columns = Array.from({ length: sheet.lastColumn }, (_unused, index) => index + 1);
  const headers = columns.map((column) => headerText(byRow.get(1)?.get(column)?.value));
  const named = headers.filter((header) => header !== "");
  const repeated = [...new Set(named.filter((header, index) => named.indexOf(header) !== index))];
  const missing = REQUIRED_HEADERS.filter((header) => !named.includes(header));
  if (repeated.length > 0 || missing.length > 0) {
    issue(
      "header",
      "Row 1 does not hold each of the four required headers once, or it holds a header twice.",
      REQUIRED_HEADERS.join(" | "),
      named.join(" | "),
    );
  }
  const idColumn = columns[headers.indexOf("id")];

  const rows: SourceRow[] = [];
  const exact = new Set<string>();
  const insensitive = new Set<string>();
  const unkeyed = new Map<string, number>();
  let blankRows = 0;
  let unusableIds = 0;
  let repeatedIds = 0;
  for (let row = 1; row <= sheet.lastRow; row += 1) {
    const cells = byRow.get(row);
    const record = columns.map((column) => rawCellOf(cells?.get(column), row === 1 ? HIDDEN_STATE : HIDDEN_ROW));
    const labels = columns.map(columnLetters);
    if (row === 1) {
      rows.push({ rowClass: "header", rowNumber: 1, rowKey: "header", cells: record, labels });
      continue;
    }
    if (!record.some(holdsContent)) {
      blankRows += 1;
      continue;
    }
    const id = idColumn === undefined ? null : (cells?.get(idColumn)?.value ?? null);
    const hasId = id !== null && String(id).trim() !== "";
    if (!hasId) {
      // Content without an identifier is no term. It is kept, and a reviewer places it.
      rows.push({
        rowClass: "annotation",
        rowNumber: row,
        rowKey: contentRowKey(record, row, unkeyed),
        cells: record,
        labels,
      });
      continue;
    }
    let rowKey: string;
    if (!isUsableId(id)) {
      unusableIds += 1;
      rowKey = contentRowKey(record, row, unkeyed);
    } else if (exact.has(id) || insensitive.has(id.toLowerCase())) {
      repeatedIds += 1;
      rowKey = contentRowKey(record, row, unkeyed);
    } else {
      exact.add(id);
      insensitive.add(id.toLowerCase());
      rowKey = id;
    }
    rows.push({ rowClass: "data", rowNumber: row, rowKey, cells: record, labels });
  }
  if (unusableIds > 0 || repeatedIds > 0) {
    // The sheet validates its identifiers itself. A failure here means that its rule was bypassed.
    issue(
      "id",
      `${unusableIds} identifiers hold a character outside letters, digits, hyphens and underscores, or take a reserved form, ` +
        `and ${repeatedIds} repeat an earlier identifier, with or without regard to case.`,
      "one usable, distinct identifier for each term",
      `${unusableIds} unusable and ${repeatedIds} repeated`,
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

interface TermRow {
  readonly row: RecordedRow;
  readonly id: string;
  /** The cells as written: null for a cell that is empty or holds no text. */
  readonly text: Readonly<Record<Field, string | null>>;
}

/** A cell as the term stores it: as written when it holds more than white space and fits the field, otherwise absent. */
const storable = (value: string | null, maximum: number): string | undefined =>
  value !== null && value.trim() !== "" && value.length <= maximum ? value : undefined;

/** The category of a name: what stands before the first ` - `, or null for a name without one. */
function categoryOf(name: string): string | null {
  const cut = name.indexOf(" - ");
  return cut < 0 ? null : name.slice(0, cut);
}

/** The family of an abbreviation: what stands before its first hyphen, or null for an abbreviation without one. */
function familyOf(abbreviation: string): string | null {
  const match = /^([A-Za-z0-9]+)-/.exec(abbreviation.trim());
  return match === null ? null : (match[1] ?? null);
}

/** Whether a text has white space at an end, a run of it inside, or a tab or a line break. */
const hasStrayWhitespace = (text: string): boolean => text !== text.trim() || /\s{2,}|[\t\n\r]/.test(text);

async function plan(context: PlanContext): Promise<ImportPlan> {
  const { items } = context;
  const builder = new PlanBuilder();
  const stored = context.rows.get(TAB_KEY) ?? [];
  const header = stored.find((row) => row.rowClass === "header");
  const source = `${SOURCE_KEY}/${TAB_KEY}`;

  // Columns are located by header text and never by letter.
  const columnOf = new Map<string, string>();
  const blankHeaded: string[] = [];
  for (const label of header?.labels ?? []) {
    const text = headerText(header === undefined ? null : cellValue(header, label));
    if (text === "") blankHeaded.push(label);
    else columnOf.set(text, label);
  }
  const known = new Set<string>(FIELDS);
  const data = stored.filter((row) => row.rowClass === "data");
  for (const [text, label] of columnOf) {
    if (known.has(text) || header === undefined) continue;
    // An unknown extra column is kept in the source records and reported. The tool chain that reads the sheet ignores it.
    builder.item(
      items.structureChange({
        subject: `${source}/header/${label}`,
        claims: [{ source, value: text, valueSource: text, sourceRecordId: header.recordId }],
      }),
    );
  }
  for (const label of blankHeaded) {
    const filled = data.filter((row) => cellValue(row, label) !== null);
    const [first] = filled;
    if (first === undefined) continue;
    // Data under a blank header belongs to no field, and is never mapped by guesswork.
    builder.item(
      items.structureChange({
        subject: `${source}/blankHeader/${label}`,
        claims: [
          { source: `${source}/blankHeader`, value: `${label}:${filled.length}`, sourceRecordId: first.recordId },
        ],
      }),
    );
  }
  for (const row of stored.filter((candidate) => candidate.rowClass === "annotation")) {
    builder.item(
      items.annotationReview({
        subject: `${source}/${row.rowKey}`,
        claims: [{ source, value: row.rawHash, sourceRecordId: row.recordId }],
      }),
    );
  }

  const terms: TermRow[] = data.map((row) => {
    const text = {} as Record<Field, string | null>;
    for (const field of FIELDS) {
      const value = cellValue(row, columnOf.get(field) ?? "");
      text[field] = typeof value === "string" ? value : null;
    }
    return { row, id: row.rowKey, text };
  });
  const ids = new Set(terms.map((term) => term.id.toLowerCase()));
  const termPath = (id: string) => COLLECTIONS.vocabularyTerms.docPath(id);
  const existing = await readDocuments(
    context.db,
    terms.map((term) => termPath(term.id)),
  );

  /** A reviewer's question about one cell of one term. */
  const review = (
    kind: "vocabularyReview" | "annotationReview",
    term: TermRow,
    field: string,
    check: string,
    value: string,
  ) =>
    builder.item(
      items[kind]({
        subject: `${source}/${term.id}`,
        field,
        claims: [{ source: `${source}/${check}`, value, valueSource: value, sourceRecordId: term.row.recordId }],
      }),
    );

  const reasons = new Map<string, TermRow>();
  const targets = new Map<string, { readonly term: TermRow; readonly raw: string }[]>();
  const families = new Map<string, { readonly term: TermRow; readonly family: string }[]>();
  for (const term of terms) {
    const { text, row } = term;
    const name = storable(text.name, LIMITS.shortText);
    const current = existing.get(termPath(term.id))?.data;
    if (name === undefined) {
      // A term needs a name to be shown. The row waits until the sheet gives it one.
      builder.hold(
        row.recordId,
        items.vocabularyReview({
          subject: `${source}/${term.id}`,
          field: "name",
          claims: [
            { source: `${source}/name/missing`, value: String(text.name?.length ?? 0), sourceRecordId: row.recordId },
          ],
        }),
      );
      // A term that exists keeps what it holds, and names the row that now stands behind it.
      if (current?.kind === COMMUNITY_VOCABULARY_KIND) {
        builder.document({ collection: "vocabularyTerms", ids: [term.id], sourceRecordIds: [row.recordId] });
      }
      continue;
    }
    if (current !== undefined && current.kind !== COMMUNITY_VOCABULARY_KIND) {
      // The identifier is taken by a term of another vocabulary. Nothing is overwritten.
      builder.hold(
        row.recordId,
        items.valueConflict({
          subject: `${source}/${term.id}`,
          field: "id",
          claims: [
            { source: "portal", value: String(current.kind), valueSource: String(current.kind) },
            {
              source,
              value: COMMUNITY_VOCABULARY_KIND,
              valueSource: COMMUNITY_VOCABULARY_KIND,
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
      continue;
    }

    const abbreviation = storable(text.abbreviation, LIMITS.shortText);
    const description = storable(text.description, LIMITS.longText);
    const invalidReason = storable(text.invalid_reason, LIMITS.longText);
    for (const [field, value, kept] of [
      ["abbreviation", text.abbreviation, abbreviation],
      ["description", text.description, description],
      ["invalid_reason", text.invalid_reason, invalidReason],
    ] as const) {
      // A cell that is too long for its field stays in the source record alone.
      if (value !== null && value.trim() !== "" && kept === undefined) {
        review("annotationReview", term, field, "tooLong", String(value.length));
      }
    }

    const category = categoryOf(name);
    if (category === null || !CATEGORIES.includes(category)) {
      review("vocabularyReview", term, "name", "category", category ?? "");
    }
    if (!USUAL_ID_PATTERN.test(term.id)) review("vocabularyReview", term, "id", "pattern", term.id);
    for (const [field, value] of [
      ["name", name],
      ["abbreviation", abbreviation],
      ["description", description],
    ] as const) {
      // Stray white space is reported to the owner of the sheet. The portal corrects nothing.
      if (value !== undefined && hasStrayWhitespace(value))
        review("annotationReview", term, field, "whitespace", value);
    }
    const hint = VALUE_TYPE_HINT.exec(name)?.[1]?.toLowerCase();
    if (hint !== undefined) review("vocabularyReview", term, "valueType", "name", hint);
    if (invalidReason !== undefined) {
      const reason = invalidReason.trim();
      if (!reasons.has(reason)) reasons.set(reason, term);
    }
    if (abbreviation !== undefined) {
      const family = familyOf(abbreviation);
      const key = family === null ? "" : lookupFold(family);
      if (family !== null && key !== "") families.set(key, [...(families.get(key) ?? []), { term, family }]);
    }

    let sameAs: string[] = [];
    const rawSameAs = text.same_as;
    if (rawSameAs !== null && rawSameAs.trim() !== "") {
      const reference: ExternalCode =
        rawSameAs.length > LIMITS.longText ? { status: "shape" } : parseExternalCode(rawSameAs);
      const local = ids.has(rawSameAs.trim().toLowerCase());
      if (reference.status === "accepted") {
        sameAs = [rawSameAs];
        const target = `${reference.system}:${reference.code}`;
        targets.set(target, [...(targets.get(target) ?? []), { term, raw: rawSameAs }]);
        // A code of an extension is kept. Whether the intended edition holds it is for a person to confirm.
        if (reference.extension) review("vocabularyReview", term, "same_as", "same_as/extension", rawSameAs);
      } else {
        // A value that is no accepted external code stays in the source record and goes to review.
        const check = local ? "localIdentifier" : reference.status;
        review("vocabularyReview", term, "same_as", `same_as/${check}`, rawSameAs.slice(0, LIMITS.longText));
      }
    }

    // A change that suggests that the identifier now stands for another concept is never applied by itself.
    const imported = (current?.importedValues as Record<string, unknown> | undefined) ?? {};
    const previousName = typeof imported.name === "string" ? imported.name : current?.name;
    const previousAbbreviation =
      typeof imported.abbreviation === "string" ? imported.abbreviation : current?.abbreviation;
    const reused =
      typeof previousName === "string" &&
      (categoryOf(previousName) !== category || (previousName !== name && previousAbbreviation !== abbreviation));
    const applied = current?.name === name && current?.abbreviation === abbreviation;
    if (current !== undefined && reused && !applied) {
      const claims: ItemClaim[] = [
        { source: `${SOURCE_KEY}/imported/name`, value: String(previousName), valueSource: String(previousName) },
        { source: `${source}/name`, value: name, valueSource: name, sourceRecordId: row.recordId },
      ];
      if (typeof previousAbbreviation === "string") {
        claims.push({
          source: `${SOURCE_KEY}/imported/abbreviation`,
          value: previousAbbreviation,
          valueSource: previousAbbreviation,
        });
      }
      if (abbreviation !== undefined) {
        claims.push({
          source: `${source}/abbreviation`,
          value: abbreviation,
          valueSource: abbreviation,
          sourceRecordId: row.recordId,
        });
      }
      builder.hold(row.recordId, items.valueConflict({ subject: `${source}/${term.id}`, field: "name", claims }));
      // The term keeps what it holds, and names the row that now stands behind it.
      builder.document({ collection: "vocabularyTerms", ids: [term.id], sourceRecordIds: [row.recordId] });
      continue;
    }

    builder.document({
      collection: "vocabularyTerms",
      ids: [term.id],
      fixed: { sourceId: term.id, kind: COMMUNITY_VOCABULARY_KIND },
      owned: {
        name,
        abbreviation,
        description,
        invalidReason,
        // An empty reason means that the term is valid. Any other value retires it, and the document stays.
        isDeprecated: invalidReason !== undefined,
        sameAsSource: sameAs,
      },
      union: { labelsSource: [name] },
      sourceRecordIds: [row.recordId],
    });
  }

  for (const [reason, term] of reasons) {
    // The first occurrence of each reason: what it means for the portal is for a person to say.
    builder.item(
      items.vocabularyReview({
        subject: `${source}/invalidReason/${shortHash(reason)}`,
        field: "invalid_reason",
        claims: [
          {
            source: `${source}/invalid_reason`,
            value: reason,
            valueSource: reason,
            sourceRecordId: term.row.recordId,
          },
        ],
      }),
    );
  }
  for (const [target, holders] of targets) {
    if (holders.length < 2) continue;
    // Two terms that share a target are no synonyms of each other, and are never merged.
    builder.item(
      items.vocabularyReview({
        subject: `${source}/sameAs/${shortHash(target)}`,
        field: "same_as",
        claims: holders.map(({ term, raw }) => ({
          source: `${source}/${term.id}`,
          value: target,
          valueSource: raw,
          sourceRecordId: term.row.recordId,
        })),
      }),
    );
  }
  for (const [key, members] of families) {
    if (members.length < 2) continue;
    // Terms whose abbreviations begin alike may be of one finer kind. The grouping is a suggestion.
    builder.item(
      items.vocabularyReview({
        subject: `${source}/family/${key}`,
        field: "abbreviation",
        claims: members.map(({ term, family }) => ({
          source: `${source}/${term.id}`,
          value: family,
          valueSource: family,
          sourceRecordId: term.row.recordId,
        })),
      }),
    );
  }
  return builder.build();
}

export const importer: ImporterDefinition = {
  key: "communityVocabulary",
  sourceKey: SOURCE_KEY,
  summary: "Community vocabulary: the terms for participant measures and dataset metadata, with their external codes.",
  inputDescription: "the Excel export of the workbook",
  read,
  plan,
};
