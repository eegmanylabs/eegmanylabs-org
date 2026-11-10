// Source G: the membership and contributor workbook (docs/MIGRATION_PLAN.md, section 4.8).
//
// THE LAYOUT OF THIS WORKBOOK IS UNVERIFIED. The workbook could not be opened when this
// importer was written, so it is built against synthetic fixtures that encode only what the
// project brief states: three tab titles and the names of the fields below. Whether the header
// stands in row 1, which other tabs and columns exist and what the cells hold is unknown. The
// importer therefore checks the structure first and stops with a report where the workbook
// differs from the brief, so that the first run against the real file reveals its structure
// before any personal value is stored.
//
// | Tab                 | Field of the brief          | Where it goes                                                    |
// |---------------------|-----------------------------|------------------------------------------------------------------|
// | `list_members`      | `name`, `surname`           | The directory document of the person                             |
// |                     | `email`, `secondary_email`  | The restricted contact document, the identity keys and the email index, which no client reads |
// |                     | `affiliation`               | An affiliation of the person, verbatim, and an institution candidate |
// |                     | `country`                   | The directory document, as written                               |
// |                     | `EEG_system`                | The source record only: equipment belongs to a laboratory, and no importer creates one |
// |                     | `gender`, `ethnicity`       | The special-category demographics document, verbatim, and nowhere else |
// |                     | `whichReplication (Tags)`   | Membership candidates in the queue. No membership is written     |
// |                     | `isCoauthor`                | The source record only: the model has no field for it            |
// | `contibutor_tables` | `ReplicationID`, `TableLink` | The contributor table of the sheet that the link names          |
// |                     | `IsOnlySignUpTable`, `IsPublished`, `PubLink`, `PDFLink` | Fields of that contributor table      |
// | `study_description` | (none stated)               | Source records only                                              |
//
// The tab title `contibutor_tables` is the spelling of the workbook and is kept.
//
// A member row creates a person only where it carries an address that is exactly one address.
// Gender and ethnicity are stored as the workbook writes them, without any standardisation or
// inference. In the source record of a row a marker with a keyed hash stands in their place, and
// the cells themselves sit beneath the record where no client can read them.
import {
  COLLECTIONS,
  contributorSheetSourceKey,
  contributorTableId,
  type EntityRef,
  keyedShortHash,
  LIMITS,
  lookupFold,
  normaliseEmail,
  opaquePersonSlug,
  personEmailIndexId,
  sourceTabKey,
  unitScopeKeys,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { holdsContent, rawCellOf } from "../cells";
import { readDocuments } from "../context";
import { holdsNonAscii, readCheckbox, verbatimText } from "../contributor-values";
import { type PersonEvidence, personEvidence } from "../identity";
import type {
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  PlanContext,
  RawCell,
  RawScalar,
  ReadContext,
  RecordedRow,
  SourceReading,
  SourceRow,
  SourceTab,
  StructureIssue,
} from "../model";
import { PlanBuilder } from "../plan";
import type { ItemClaim } from "../reconcile";
import { affiliationDocuments, isStorableUrl } from "../records";
import { storedValue } from "../recruitment-values";
import { canonicalJson } from "../values";
import { cellsByRow, columnLetters, type WorkbookSheet } from "../workbook";
import { collapsed, openWorkbook, tidied } from "../workbook-rows";
import {
  type ExpectedColumn,
  type HeaderMatch,
  listedValues,
  matchHeader,
  spreadsheetIdentifierIn,
} from "../workbook-structure";

const SOURCE_KEY = "g";

/** The three tabs that the brief names, by the key under which the importer reads each. */
export const TAB_TITLES = {
  members: "list_members",
  studies: "study_description",
  tables: "contibutor_tables",
} as const;
type TabKind = keyof typeof TAB_TITLES;

/** The member fields of the brief. A header matches under any case, spacing and punctuation. */
export const MEMBER_COLUMNS: readonly ExpectedColumn[] = [
  { field: "name", header: "name" },
  { field: "surname", header: "surname" },
  { field: "email", header: "email" },
  { field: "secondaryEmail", header: "secondary_email" },
  { field: "affiliation", header: "affiliation" },
  { field: "country", header: "country" },
  { field: "eegSystem", header: "EEG_system" },
  { field: "gender", header: "gender" },
  { field: "ethnicity", header: "ethnicity" },
  { field: "replications", header: "whichReplication (Tags)", alternatives: ["whichReplication"] },
  { field: "isCoauthor", header: "isCoauthor" },
];

/** The fields of the tab that lists the contributor tables. */
export const TABLE_COLUMNS: readonly ExpectedColumn[] = [
  { field: "replication", header: "ReplicationID" },
  { field: "link", header: "TableLink" },
  { field: "signUpOnly", header: "IsOnlySignUpTable" },
  { field: "published", header: "IsPublished" },
  { field: "publication", header: "PubLink" },
  { field: "pdf", header: "PDFLink" },
];

/** The member fields whose cells are special-category data. */
const SPECIAL_FIELDS = ["gender", "ethnicity"] as const;
/** The type of the marker that stands for a special-category cell in a source record. */
const SPECIAL_MARKER = "specialCategory";
/** The fewest expected headers that make a row the header of its tab. */
const MINIMUM_HEADERS = 3;

const person = (id: string): EntityRef => ({ entityType: "person", entityId: id });
const replication = (id: string): EntityRef => ({ entityType: "replication", entityId: id });
const table = (id: string): EntityRef => ({ entityType: "contributorTable", entityId: id });

interface TabCheck {
  readonly match: HeaderMatch;
  readonly issues: StructureIssue[];
}

/** Checks one tab against its expected columns, and says precisely what differs. The messages quote no cell. */
function checkTab(
  sheet: WorkbookSheet,
  title: string,
  expected: readonly ExpectedColumn[],
  valuesOf: (row: number) => RawScalar[],
  labels: readonly string[],
): TabCheck {
  const tabKey = sourceTabKey(sheet.name);
  const match = matchHeader(labels, valuesOf, sheet.lastRow, expected, MINIMUM_HEADERS);
  const issues: StructureIssue[] = [];
  const issue = (check: string, message: string, wanted: string, found: string) =>
    issues.push({ check, tabKey, message, expected: wanted, found });
  const wanted = expected.map((column) => column.header).join(" | ");
  if (match.headerRow === null) {
    issue(
      "headerRow",
      `No row among the first ten of the tab ${title} holds ${MINIMUM_HEADERS} or more of its ${expected.length} expected headers.`,
      wanted,
      "no header row",
    );
    return { match, issues };
  }
  if (match.missing.length > 0) {
    issue(
      "missingHeader",
      `The header of the tab ${title}, in row ${match.headerRow}, lacks ${match.missing.length} of its ${expected.length} expected columns.`,
      match.missing.join(" | "),
      "absent",
    );
  }
  if (match.duplicated.length > 0) {
    issue(
      "duplicateHeader",
      `${match.duplicated.length} expected columns of the tab ${title} stand in row ${match.headerRow} more than once.`,
      "each header once",
      match.duplicated.join(" | "),
    );
  }
  if (match.unknown.length > 0) {
    // A column that the brief does not name may hold anything, special-category data included.
    issue(
      "unknownHeader",
      `The tab ${title} holds ${match.unknown.length} columns that the importer does not recognise: ` +
        `${match.unknown.map((header) => header.label).join(", ")}. Nothing of the tab is stored until each is mapped or set aside.`,
      wanted,
      match.unknown.map((header) => `${header.label}: ${header.text}`).join(" | "),
    );
  }
  const headerRow = match.headerRow;
  const filled = match.blank.filter((label) => {
    const column = labels.indexOf(label);
    for (let row = headerRow + 1; row <= sheet.lastRow; row += 1) {
      const value = valuesOf(row)[column] ?? null;
      if (value !== null && !(typeof value === "string" && value.trim() === "")) return true;
    }
    return false;
  });
  if (filled.length > 0) {
    issue(
      "blankHeader",
      `The tab ${title} holds data in ${filled.length} columns without a header: ${filled.join(", ")}. A column is never mapped by guesswork.`,
      "a header over every column of data",
      filled.join(" | "),
    );
  }
  return { match, issues };
}

class WorkbookReader {
  readonly #secret: string;
  readonly #issues: StructureIssue[] = [];
  readonly #tabs: SourceTab[] = [];

  constructor(secret: string) {
    this.#secret = secret;
  }

  /** A key with an ordinal among the rows of one tab that share its stem, from 1. */
  #keyed(ordinals: Map<string, number>, stem: string): string {
    const ordinal = (ordinals.get(stem) ?? 0) + 1;
    ordinals.set(stem, ordinal);
    return `${stem}__${ordinal}`;
  }

  #hash(text: string): string {
    return keyedShortHash(text, this.#secret);
  }

  /** The key of a member row: the keyed hash of its address, else of its folded name, else of its content. */
  #memberKey(cells: readonly RawCell[], labels: readonly string[], match: HeaderMatch): string {
    const text = (field: string): string => {
      const value = storedValue(cells[labels.indexOf(match.columns.get(field) ?? "")]);
      return typeof value === "string" ? value : "";
    };
    for (const field of ["email", "secondaryEmail"]) {
      const evidence = holdsNonAscii(text(field)) ? null : personEvidence.email(text(field));
      if (evidence !== null) return `m__${this.#hash(evidence.key)}`;
    }
    const [name, surname] = [lookupFold(text("name")), lookupFold(text("surname"))];
    if (name !== "" || surname !== "") return `n__${this.#hash(`${name}\n${surname}`)}`;
    return `raw__${this.#hash(canonicalJson(cells))}`;
  }

  /** The key of a row of the tab of contributor tables: the hash of the sheet it links to, else of its link or its study. */
  #tableKey(cells: readonly RawCell[], labels: readonly string[], match: HeaderMatch): string {
    const cell = cells[labels.indexOf(match.columns.get("link") ?? "")];
    const target = cell !== null && typeof cell === "object" && typeof cell.l === "string" ? cell.l : null;
    const text = typeof storedValue(cell) === "string" ? String(storedValue(cell)) : "";
    const identifier = spreadsheetIdentifierIn(target ?? text) ?? spreadsheetIdentifierIn(text);
    if (identifier !== null) return `t__${contributorTableId(identifier).slice("ctable__".length)}`;
    if (text.trim() !== "") return `link__${this.#hash(text.trim())}`;
    const study = lookupFold(String(storedValue(cells[labels.indexOf(match.columns.get("replication") ?? "")]) ?? ""));
    return study === "" ? `raw__${this.#hash(canonicalJson(cells))}` : `study__${study}`;
  }

  #tab(sheet: WorkbookSheet, kind: TabKind | null): void {
    const tabKey = sourceTabKey(sheet.name);
    const byRow = cellsByRow(sheet);
    const columns = Array.from({ length: sheet.lastColumn }, (_unused, index) => index + 1);
    const labels = columns.map(columnLetters);
    const formatting = { strike: true, hidden: true } as const;
    const cellsOf = (row: number): RawCell[] =>
      columns.map((column) => rawCellOf(byRow.get(row)?.get(column), formatting));
    const valuesOf = (row: number): RawScalar[] => columns.map((column) => byRow.get(row)?.get(column)?.value ?? null);
    const base = {
      tabKey,
      name: sheet.name,
      visibility: sheet.visibility,
      ...(sheet.sheetId === "" ? {} : { sheetId: sheet.sheetId }),
    };
    const rows: SourceRow[] = [];
    const ordinals = new Map<string, number>();
    let blankRows = 0;

    if (kind === null) {
      // A tab that the brief does not name stops the import. None of its cells is stored.
      this.#issues.push({
        check: "unknownTab",
        tabKey,
        message:
          "The workbook holds a tab that the importer does not know. Nothing of it is stored until it has been looked at.",
        expected: Object.values(TAB_TITLES).join(" | "),
        found: sheet.name,
      });
      this.#tabs.push({ ...base, rows, fillerRows: 0, blankRows });
      return;
    }

    if (kind === "studies") {
      // The brief states no field of this tab. Its first row with content is taken as its header, and every
      // later row is kept as a source record and interpreted by nothing.
      let headerRow: number | undefined;
      for (let row = 1; row <= sheet.lastRow; row += 1) {
        const cells = cellsOf(row);
        if (!cells.some(holdsContent)) {
          blankRows += 1;
        } else if (headerRow === undefined) {
          headerRow = row;
          rows.push({ rowClass: "header", rowNumber: row, rowKey: "header", cells, labels });
        } else {
          const rowKey = this.#keyed(ordinals, `row__${this.#hash(canonicalJson(cells))}`);
          rows.push({ rowClass: "data", rowNumber: row, rowKey, cells, labels });
        }
      }
      this.#tabs.push({ ...base, ...(headerRow === undefined ? {} : { headerRow }), rows, fillerRows: 0, blankRows });
      return;
    }

    const expected = kind === "members" ? MEMBER_COLUMNS : TABLE_COLUMNS;
    const { match, issues } = checkTab(sheet, TAB_TITLES[kind], expected, valuesOf, labels);
    this.#issues.push(...issues);
    if (match.headerRow === null || issues.length > 0) {
      // The structure is not what the brief states. Only the header is kept, so that no cell of a column that
      // the importer has not recognised, a special-category one included, reaches a source record.
      if (match.headerRow !== null) {
        rows.push({
          rowClass: "header",
          rowNumber: match.headerRow,
          rowKey: "header",
          cells: cellsOf(match.headerRow),
          labels,
        });
      }
      this.#tabs.push({
        ...base,
        ...(match.headerRow === null ? {} : { headerRow: match.headerRow }),
        rows,
        fillerRows: 0,
        blankRows,
      });
      return;
    }

    const special = kind === "members" ? SPECIAL_FIELDS.map((field) => match.columns.get(field) ?? "") : [];
    for (let row = 1; row <= sheet.lastRow; row += 1) {
      const cells = cellsOf(row);
      if (!cells.some(holdsContent)) {
        blankRows += 1;
        continue;
      }
      if (row < match.headerRow) {
        rows.push({ rowClass: "banner", rowNumber: row, rowKey: this.#keyed(ordinals, "banner"), cells, labels });
        continue;
      }
      if (row === match.headerRow) {
        rows.push({ rowClass: "header", rowNumber: row, rowKey: "header", cells, labels });
        continue;
      }
      if (kind === "tables") {
        const rowKey = this.#keyed(ordinals, this.#tableKey(cells, labels, match));
        rows.push({ rowClass: "data", rowNumber: row, rowKey, cells, labels });
        continue;
      }
      // The special-category cells leave the row. A marker with a keyed hash stands in the place of each, so
      // that a changed value is a new revision of the row. The hash covers the key of the row, so that two
      // rows with one value carry different markers and nobody can count how often a value occurs.
      const rowKey = this.#keyed(ordinals, this.#memberKey(cells, labels, match));
      const apart: Record<string, RawCell> = {};
      const kept = cells.map((cell, index) => {
        const label = labels[index] ?? "";
        if (!special.includes(label) || !holdsContent(cell)) return cell;
        apart[label] = cell;
        return { t: SPECIAL_MARKER, k: this.#hash(`${rowKey}\n${label}\n${canonicalJson(cell)}`) };
      });
      rows.push({
        rowClass: "data",
        rowNumber: row,
        rowKey,
        cells: kept,
        labels,
        ...(Object.keys(apart).length === 0 ? {} : { special: apart }),
      });
    }
    this.#tabs.push({ ...base, headerRow: match.headerRow, rows, fillerRows: 0, blankRows });
  }

  read(sheets: readonly WorkbookSheet[]): { readonly tabs: SourceTab[]; readonly issues: StructureIssue[] } {
    const kinds = Object.keys(TAB_TITLES) as TabKind[];
    const kindOf = (sheet: WorkbookSheet) => kinds.find((kind) => TAB_TITLES[kind] === sheet.name.trim()) ?? null;
    const missing = kinds.filter((kind) => sheets.filter((sheet) => kindOf(sheet) === kind).length !== 1);
    if (missing.length > 0) {
      this.#issues.push({
        check: "tabs",
        tabKey: null,
        message: `The workbook does not hold each of its three expected tabs once: ${missing.length} are missing or stand twice.`,
        expected: missing.map((kind) => TAB_TITLES[kind]).join(" | "),
        found: sheets.map((sheet) => sheet.name).join(" | "),
      });
    }
    for (const sheet of sheets) this.#tab(sheet, kindOf(sheet));
    return { tabs: this.#tabs, issues: this.#issues };
  }
}

async function read(input: ImportInput, context: ReadContext): Promise<SourceReading> {
  const opened = openWorkbook(input);
  const { contentHash, inputFiles, workbook } = opened;
  if (workbook === null) return { contentHash, inputFiles, tabs: [], issues: opened.issues };
  const { tabs, issues } = new WorkbookReader(context.secret).read(workbook.sheets);
  return { contentHash, inputFiles, tabs, issues };
}

/** One member row with what the plan has read of it. */
interface MemberRow {
  readonly row: RecordedRow;
  readonly name: string | null;
  readonly surname: string | null;
  /** The usable addresses of the row in canonical form, the primary one first where it is usable. */
  readonly addresses: readonly { readonly email: string; readonly kind: "primary" | "secondary" }[];
  readonly evidence: readonly PersonEvidence[];
  readonly affiliation: string | null;
}

class MembershipPlan {
  readonly #context: PlanContext;
  readonly #builder = new PlanBuilder();
  /** The addresses that this plan adds to the contact document of a person, each as person and address. */
  readonly #stated = new Set<string>();

  constructor(context: PlanContext) {
    this.#context = context;
  }

  #tab(kind: TabKind): { readonly tabKey: string; readonly rows: readonly RecordedRow[]; readonly source: string } {
    const tabKey = sourceTabKey(TAB_TITLES[kind]);
    return { tabKey, rows: this.#context.rows.get(tabKey) ?? [], source: `${SOURCE_KEY}/${tabKey}` };
  }

  /** The column of each field, from the stored header row. The check of the read stage has passed, so each stands once. */
  #columns(rows: readonly RecordedRow[], expected: readonly ExpectedColumn[]): ReadonlyMap<string, string> {
    const header = rows.find((row) => row.rowClass === "header");
    if (header === undefined) return new Map();
    const values = header.cells.map((cell) => storedValue(cell));
    return matchHeader(header.labels, () => values, 1, expected, 1).columns;
  }

  #cell(row: RecordedRow, label: string | undefined): RawCell {
    return label === undefined ? null : (row.cells[row.labels.indexOf(label)] ?? null);
  }

  /** The text of a cell as written, or null for a cell that holds nothing after trimming. */
  #text(row: RecordedRow, label: string | undefined): string | null {
    const text = verbatimText(storedValue(this.#cell(row, label)));
    return text === null || text.trim() === "" ? null : text;
  }

  #claim(source: string, row: RecordedRow, value: string, shown = true): ItemClaim {
    return {
      source,
      value,
      ...(shown && value.length <= LIMITS.shortText ? { valueSource: value } : {}),
      sourceRecordId: row.recordId,
    };
  }

  /** The people whose display name folds like a name, for a question that only a reviewer may answer. */
  async #peopleByName(): Promise<Map<string, string[]>> {
    const people = await this.#context.db.collection(COLLECTIONS.persons.collectionPath()).select("displayName").get();
    const byName = new Map<string, string[]>();
    for (const doc of people.docs) {
      const folded = lookupFold(String(doc.get("displayName") ?? ""));
      if (folded !== "") byName.set(folded, [...(byName.get(folded) ?? []), doc.id].sort());
    }
    return byName;
  }

  async #members(): Promise<void> {
    const { items, identities } = this.#context;
    const { rows, source } = this.#tab("members");
    const columns = this.#columns(rows, MEMBER_COLUMNS);
    const peopleByName = await this.#peopleByName();
    const members: MemberRow[] = [];
    for (const row of rows.filter((candidate) => candidate.rowClass === "data")) {
      const addresses: { email: string; kind: "primary" | "secondary" }[] = [];
      const evidence: PersonEvidence[] = [];
      for (const [field, kind] of [
        ["email", "primary"],
        ["secondaryEmail", "secondary"],
      ] as const) {
        const text = this.#text(row, columns.get(field));
        if (text === null) continue;
        const entry = holdsNonAscii(text) ? null : personEvidence.email(text);
        if (entry === null) {
          // A cell that is not exactly one address is used for no matching. The cell stays in the source record.
          this.#builder.item(
            items.identifierDefect({
              subject: `${source}/${row.rowKey}`,
              field,
              claims: [this.#claim(source, row, normaliseEmail(text), false)],
            }),
          );
        } else if (!evidence.some((other) => other.key === entry.key)) {
          evidence.push(entry);
          addresses.push({ email: normaliseEmail(text), kind });
        }
      }
      members.push({
        row,
        name: this.#text(row, columns.get("name")),
        surname: this.#text(row, columns.get("surname")),
        addresses,
        evidence,
        affiliation: this.#text(row, columns.get("affiliation")),
      });
    }

    // Two rows that share an address are one person twice, or two people with one address. Neither is imported.
    const rowsOfKey = new Map<string, MemberRow[]>();
    for (const member of members) {
      for (const entry of member.evidence) rowsOfKey.set(entry.key, [...(rowsOfKey.get(entry.key) ?? []), member]);
    }
    const shared = new Set<MemberRow>();
    for (const [key, sharing] of [...rowsOfKey].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (sharing.length < 2) continue;
      const item = items.duplicatePerson({
        subject: `${source}/address/${keyedShortHash(key, this.#context.secret)}`,
        claims: sharing.map((member) => this.#claim(source, member.row, member.row.rowKey, false)),
      });
      for (const member of sharing) {
        shared.add(member);
        this.#builder.hold(member.row.recordId, item);
      }
    }

    for (const member of members.filter((candidate) => !shared.has(candidate))) {
      const { row } = member;
      const fullName = collapsed([member.name, member.surname].filter((part) => part !== null).join(" "));
      const namesake = personEvidence.nameAffiliation(fullName, member.affiliation ?? "");
      // A row without a usable address is linked by its name with its affiliation, where both equal those
      // of exactly one person. It creates no person on that basis.
      const resolution = await identities.resolvePerson(
        member.evidence.length > 0 ? member.evidence : namesake === null ? [] : [namesake],
      );
      const subject = `${source}/${row.rowKey}`;
      if (resolution.status === "erased") {
        this.#builder.rawOnly(row.recordId, "erasedPerson");
        continue;
      }
      if (resolution.status === "ambiguous") {
        this.#builder.hold(
          row.recordId,
          items.ambiguousEmail({
            subject,
            field: "email",
            entityRefs: resolution.personIds.map(person),
            claims: [this.#claim(source, row, resolution.personIds.join(" "), false)],
          }),
        );
        continue;
      }
      const namesakes = peopleByName.get(lookupFold(fullName)) ?? [];
      if (resolution.status === "unresolved") {
        // A name is no identity. The row waits, and its special-category cells stay where no client reads them.
        this.#builder.hold(
          row.recordId,
          items.duplicatePerson({
            subject,
            entityRefs: namesakes.map(person),
            claims: [
              this.#claim(source, row, row.rowKey, false),
              ...namesakes.map((id) => ({ source: "person", value: id })),
            ],
          }),
        );
        continue;
      }
      const { personId } = resolution;
      const others = namesakes.filter((id) => id !== personId);
      if (others.length > 0) {
        // Another source knows a person of this name. The two records are never merged here: a reviewer decides.
        this.#builder.item(
          items.duplicatePerson({
            subject: personId,
            entityRefs: [person(personId), ...others.map(person)],
            claims: [
              this.#claim(source, row, personId, false),
              ...others.map((id) => ({ source: "person", value: id })),
            ],
          }),
        );
      }
      await this.#person(member, personId, resolution.status === "new", columns, source);
    }
  }

  /** Plans the documents of one person: the directory entry, the contact document, the demographics and the affiliation. */
  async #person(
    member: MemberRow,
    personId: string,
    created: boolean,
    columns: ReadonlyMap<string, string>,
    source: string,
  ): Promise<void> {
    const { db, identities, items, input, secret, studies } = this.#context;
    const { row } = member;
    const short = (text: string | null): string | undefined => {
      const tidy = text === null ? "" : tidied(text);
      return tidy === "" || tidy.length > LIMITS.shortText ? undefined : tidy;
    };
    const fullName = short(collapsed([member.name, member.surname].filter((part) => part !== null).join(" ")));
    const country = this.#text(row, columns.get("country"));
    this.#builder.document({
      collection: "persons",
      ids: [personId],
      // The fields that a new person starts with. A person whom another source created keeps what it holds.
      fixed: {
        // A slug is a public page anchor, so it is never derived from the name of a person of a restricted source.
        slug: opaquePersonSlug(personId),
        laboratoryIds: [],
        replicationIds: [],
        isCoreTeam: false,
        publicListing: "none",
        coreRoles: [],
        userId: null,
        claimedAt: null,
        custom: {},
        dataOrigin: "live",
      },
      owned: {
        givenName: short(member.name),
        familyName: short(member.surname),
        displayName: fullName,
        countrySource: country === null || country.length > LIMITS.longText ? undefined : country,
      },
      sourceRecordIds: [row.recordId],
    });
    const namesake = fullName === undefined ? null : personEvidence.nameAffiliation(fullName, member.affiliation ?? "");
    const keys = [...member.evidence, ...(namesake === null ? [] : [namesake])];
    for (const key of identities.keyDocuments(personId, keys, row.recordId)) this.#builder.document(key);
    // The slug is reserved for a person whom this workbook created, on the first run and on every later one.
    const personPath = COLLECTIONS.persons.docPath(personId);
    const slug = opaquePersonSlug(personId);
    if (created || (await readDocuments(db, [personPath])).get(personPath)?.data.slug === slug) {
      this.#builder.document(identities.slugDocument(personId, slug, row.recordId));
    }

    // The addresses go to the restricted contact document and to the index that no client reads.
    const contactPath = COLLECTIONS.personContact.docPath(personId);
    const stored = ((await readDocuments(db, [contactPath])).get(contactPath)?.data.emails ?? []) as {
      email?: string;
      kind?: string;
    }[];
    let hasPrimary = stored.some((entry) => entry.kind === "primary");
    const added = member.addresses
      .filter(
        ({ email }) => !stored.some((entry) => entry.email === email) && !this.#stated.has(`${personId}\n${email}`),
      )
      .map(({ email, kind }) => {
        this.#stated.add(`${personId}\n${email}`);
        // A person has one primary address at most. A second one is kept as a secondary address.
        const primary = kind === "primary" && !hasPrimary;
        if (primary) hasPrimary = true;
        return {
          email,
          kind: primary ? "primary" : "secondary",
          sourceRecordId: row.recordId,
          verifiedAt: null,
          claimEligible: true,
        };
      });
    if (member.addresses.length > 0) {
      this.#builder.document({
        collection: "personContact",
        ids: [personId],
        ...(added.length === 0 ? {} : { union: { emails: added } }),
        sourceRecordIds: [row.recordId],
      });
    }
    for (const { email } of member.addresses) {
      this.#builder.document({
        collection: "personEmailIndex",
        ids: [personEmailIndexId(email, secret)],
        union: { personIds: [personId], claimEligiblePersonIds: [personId] },
        sourceRecordIds: [row.recordId],
      });
    }

    // Gender and ethnicity: the terms of the workbook, verbatim, in the document that no client can read.
    const term = (field: (typeof SPECIAL_FIELDS)[number]): string | undefined => {
      const text = verbatimText(storedValue(row.special?.[columns.get(field) ?? ""]));
      return text === null || text.trim() === "" || text.length > LIMITS.longText ? undefined : text;
    };
    const [genderSource, ethnicitySource] = [term("gender"), term("ethnicity")];
    if (genderSource !== undefined || ethnicitySource !== undefined) {
      this.#builder.document({
        collection: "personDemographics",
        ids: [personId],
        // The day of the export is the day on which the terms were recorded, as far as the importer knows.
        fixed: { recordedAt: Timestamp.fromDate(new Date(`${input.observedOn}T00:00:00.000Z`)) },
        owned: { genderSource, ethnicitySource, sourceRecordId: row.recordId },
        silent: ["sourceRecordId"],
        sourceRecordIds: [row.recordId],
      });
    }

    if (member.affiliation !== null && member.affiliation.length <= LIMITS.longText) {
      affiliationDocuments(this.#builder, {
        personId,
        sourceKey: SOURCE_KEY,
        tabKey: this.#tab("members").tabKey,
        slot: 1,
        affiliation: member.affiliation,
        recordId: row.recordId,
      });
    }

    // The replications that the row names are candidates for a membership. Only a reviewer writes one.
    const tags = listedValues(this.#text(row, columns.get("replications")));
    const candidates: ItemClaim[] = [];
    const refs: EntityRef[] = [person(personId)];
    for (const tag of tags) {
      const resolution = await studies.resolve(tag);
      if (resolution.status === "resolved") {
        refs.push(replication(resolution.replicationId));
        candidates.push({
          source: `${source}/replication`,
          value: resolution.replicationId,
          valueSource: tag.slice(0, LIMITS.shortText),
          sourceRecordId: row.recordId,
        });
      } else {
        this.#builder.item(
          items.unmatchedIdentifier({
            subject: `${SOURCE_KEY}/tag/${lookupFold(tag) || keyedShortHash(tag, secret)}`,
            claims: [this.#claim(`${source}/replication`, row, tag)],
          }),
        );
      }
    }
    if (candidates.length > 0) {
      this.#builder.item(
        items.candidateLink({ subject: personId, field: "replicationIds", entityRefs: refs, claims: candidates }),
      );
    }

    // What the model has no field for stays in the source record. A flag that is no flag is a question.
    const coauthor = storedValue(this.#cell(row, columns.get("isCoauthor")));
    if (readCheckbox(coauthor).odd) {
      this.#builder.item(
        items.unparsedValue({
          subject: personId,
          field: "isCoauthor",
          entityRefs: [person(personId)],
          claims: [this.#claim(source, row, verbatimText(coauthor) ?? "")],
        }),
      );
    }
    const flags = (key: string) =>
      row.cells.some((cell) => cell !== null && typeof cell === "object" && cell[key] === true);
    for (const signal of ["hiddenRow", "strike"].filter(flags)) {
      // A hidden row and a struck name say something that only their formatting holds.
      this.#builder.item(
        items.formattingSignal({
          subject: personId,
          field: signal,
          entityRefs: [person(personId)],
          claims: [this.#claim(source, row, signal)],
        }),
      );
    }
  }

  /** Reads a flag of the tab of contributor tables. Undefined for a blank cell and for a value that is no flag. */
  #flag(
    row: RecordedRow,
    label: string | undefined,
    field: string,
    subject: string,
    source: string,
  ): boolean | undefined {
    const value = storedValue(this.#cell(row, label));
    const reading = readCheckbox(value);
    if (reading.odd) {
      this.#builder.item(
        this.#context.items.unparsedValue({
          subject,
          field,
          claims: [this.#claim(source, row, verbatimText(value) ?? "")],
        }),
      );
    }
    return reading.tick ?? undefined;
  }

  /** Reads an address of the tab of contributor tables. Undefined for a blank cell and for a text that is no address. */
  #address(
    row: RecordedRow,
    label: string | undefined,
    field: string,
    subject: string,
    source: string,
  ): string | undefined {
    const cell = this.#cell(row, label);
    const target = cell !== null && typeof cell === "object" && typeof cell.l === "string" ? cell.l : null;
    const text = target ?? this.#text(row, label);
    if (text === null) return undefined;
    const address = text.trim();
    if (isStorableUrl(address) && address.length <= LIMITS.url) return address;
    this.#builder.item(this.#context.items.linkDefect({ subject, field, claims: [this.#claim(source, row, address)] }));
    return undefined;
  }

  async #tables(): Promise<void> {
    const { db, items, studies } = this.#context;
    const { rows, source } = this.#tab("tables");
    const columns = this.#columns(rows, TABLE_COLUMNS);
    const data = rows.filter((row) => row.rowClass === "data");
    const perKey = new Map<string, RecordedRow[]>();
    for (const row of data) {
      const stem = row.rowKey.replace(/__\d+$/, "");
      perKey.set(stem, [...(perKey.get(stem) ?? []), row]);
    }
    for (const row of data) {
      const subject = `${source}/${row.rowKey}`;
      const study = this.#text(row, columns.get("replication")) ?? "";
      const resolution = await studies.resolve(study);
      if (resolution.status !== "resolved") {
        this.#builder.hold(
          row.recordId,
          items.unmatchedIdentifier({
            subject,
            field: "replicationId",
            claims: [this.#claim(source, row, study.trim())],
          }),
        );
        continue;
      }
      const { replicationId } = resolution;
      const linkCell = this.#cell(row, columns.get("link"));
      const target =
        linkCell !== null && typeof linkCell === "object" && typeof linkCell.l === "string" ? linkCell.l : null;
      const linkText = this.#text(row, columns.get("link"));
      const identifier = spreadsheetIdentifierIn(target ?? linkText ?? "") ?? spreadsheetIdentifierIn(linkText ?? "");
      if (identifier === null) {
        // Without the identifier of a sheet the row names no table. The cell is not shown: it may hold an address.
        this.#builder.hold(
          row.recordId,
          items.linkDefect({
            subject,
            field: "tableLink",
            entityRefs: [replication(replicationId)],
            claims: [this.#claim(source, row, linkText === null ? "blank" : "noSheetIdentifier")],
          }),
        );
        continue;
      }
      const tableId = contributorTableId(identifier);
      if ((perKey.get(row.rowKey.replace(/__\d+$/, "")) ?? []).length > 1) {
        // Two rows that link to one sheet may state different things about it. Neither is chosen.
        this.#builder.hold(
          row.recordId,
          items.valueConflict({
            subject: tableId,
            field: "row",
            entityRefs: [table(tableId)],
            claims: (perKey.get(row.rowKey.replace(/__\d+$/, "")) ?? []).map((entry) =>
              this.#claim(source, entry, entry.rowKey, false),
            ),
          }),
        );
        continue;
      }
      const path = COLLECTIONS.contributorTables.docPath(tableId);
      const stored = (await readDocuments(db, [path])).get(path)?.data;
      if (stored !== undefined && stored.replicationId !== replicationId) {
        // The registration of the sheet and this workbook name different replications. Both statements are kept.
        const held = typeof stored.replicationId === "string" ? stored.replicationId : "none";
        this.#builder.hold(
          row.recordId,
          items.valueConflict({
            subject: tableId,
            field: "replicationId",
            entityRefs: [table(tableId)],
            claims: [
              this.#claim(source, row, replicationId),
              { source: "contributorTable", value: held, valueSource: held },
            ],
          }),
        );
        continue;
      }
      if (typeof stored?.sourceRecordId !== "string") {
        // A table that no import of a contributor sheet has read yet: a further sheet, for a maintainer to register.
        this.#builder.item(
          items.statusQuestion({
            subject: tableId,
            field: "registration",
            entityRefs: [table(tableId), replication(replicationId)],
            claims: [this.#claim(source, row, "notImported")],
          }),
        );
      }
      this.#builder.document({
        collection: "contributorTables",
        ids: [tableId],
        fixed: {
          replicationId,
          sourceKey: contributorSheetSourceKey(identifier),
          scopeKeys: unitScopeKeys(replicationId, null),
        },
        owned: {
          isOnlySignupTable: this.#flag(row, columns.get("signUpOnly"), "isOnlySignupTable", tableId, source),
          isPublished: this.#flag(row, columns.get("published"), "isPublished", tableId, source),
          publicationUrl: this.#address(row, columns.get("publication"), "publicationUrl", tableId, source),
          pdfUrl: this.#address(row, columns.get("pdf"), "pdfUrl", tableId, source),
        },
        sourceRecordIds: [row.recordId],
      });
    }
  }

  async run(): Promise<ImportPlan> {
    await this.#members();
    await this.#tables();
    // The brief states no field of the study descriptions. Its rows are kept, and nothing reads them.
    for (const row of this.#tab("studies").rows) {
      if (row.rowClass === "data") this.#builder.rawOnly(row.recordId, "fieldsNotStated");
    }
    return this.#builder.build();
  }
}

export const importer: ImporterDefinition = {
  key: "membershipWorkbook",
  sourceKey: SOURCE_KEY,
  summary:
    "Membership and contributor workbook, built against synthetic fixtures only: members with their restricted and special-category data, and the registry of contributor tables.",
  inputDescription: "the Excel export of the workbook",
  read,
  plan: (context) => new MembershipPlan(context).run(),
};
