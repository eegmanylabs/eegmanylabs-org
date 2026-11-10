// The contributor sheets (docs/MIGRATION_PLAN.md, section 4.7): one workbook for each list of
// contributors of a manuscript, with one row for each person and a checkbox for each of the
// fourteen CRediT roles. Each sheet is a source of its own, and one importer serves them all.
//
// Nothing inside a sheet names its study. The replication comes from the registration of the
// sheet in the private configuration, and a sheet that is not registered there is refused.
//
// | What the sheet holds                      | Where it goes                                              |
// |-------------------------------------------|------------------------------------------------------------|
// | The sheet itself                          | One contributor table, which names its source and no address |
// | A row with a first name and a surname     | One contributor, with the name cells, the order, the affiliation cells, the ORCID iD as written and the verbatim value of each role cell |
// | The address and the funding statement     | The restricted contact document of the contributor, and nowhere else |
// | An affiliation cell                       | One institution candidate for each distinct folded string  |
// | The role headers with their notes         | The vocabulary terms of the CRediT roles                   |
// | A word in the order column                | A vocabulary term of an order rule, and a question in the queue |
// | The corresponding-author flag, the conflict-of-interest statement and every unmapped cell | The source record only: the model has no field for them |
//
// A contributor row creates no person and grants no role, no membership and no access. It is
// linked to a person who exists already, by a valid ORCID iD, by an address that is exactly
// one address, or by a name with its affiliation where both equal those of exactly one person.
// Everything else waits in the queue: a link that would rest on a name, one name with two
// addresses in two sheets, a first name that differs between two sheets, and affiliation
// strings that may name one institution.
import {
  COLLECTIONS,
  CREDIT_ROLE_TERM_KIND,
  CREDIT_ROLES,
  type CreditRoleKey,
  contributorId,
  contributorNameHash,
  contributorSheetSourceKey,
  contributorTableId,
  type EntityRef,
  institutionCandidateId,
  keyedShortHash,
  LIMITS,
  lookupFold,
  normaliseEmail,
  shortHash,
  unitScopeKeys,
  vocabularyTermId,
} from "@eegml/shared";
import { ToolRefusal } from "../../environment";
import type { ColumnOverride, PrivateContributorSheet } from "../config";
import { readDocuments } from "../context";
import {
  CHECKBOX_FIELDS,
  type ColumnMap,
  type ContentKind,
  classifyRow,
  contentKindOf,
  type HeaderCell,
  holdsNonAscii,
  mapColumns,
  nearDuplicateAffiliations,
  normaliseHeader,
  readCheckbox,
  readOrder,
  verbatimText,
} from "../contributor-values";
import { type PersonEvidence, personEvidence, validOrcid } from "../identity";
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
  SourceSelection,
  StructureIssue,
} from "../model";
import { PlanBuilder } from "../plan";
import type { ItemClaim } from "../reconcile";
import { VocabularyCollector } from "../records";
import { storedValue } from "../recruitment-values";
import { canonicalJson } from "../values";
import { gridOf, openWorkbook } from "../workbook-rows";

const IMPORTER_KEY = "contributorSheets";
/** The key of the family of sources. Each sheet has a key of its own, derived from its file identifier. */
const FAMILY_KEY = "ctable";
/** The key of the one tab. Every sheet has one tab with the spreadsheet default title. */
const TAB_KEY = "t0";
const TAB_TITLE = "Sheet1";

/** The fills of the template of the sheets and of its banding, which carry no meaning. Any other fill of a whole row is a highlight. */
const TEMPLATE_FILLS = new Set(["FCE5CD", "C1E3D7", "EFF8F5", "FFFFFF"]);

/** The type under which the note of a header is stored as an annotation of the tab. */
const NOTE_TYPE = "note";
const ORDER_RULE_TERM_KIND = "authorOrderRule";

/** One registered sheet, as the private configuration states it. */
interface RegisteredSheet {
  readonly sourceKey: string;
  readonly tableId: string;
  readonly registration: PrivateContributorSheet;
}

const contributor = (id: string): EntityRef => ({ entityType: "contributor", entityId: id });
const person = (id: string): EntityRef => ({ entityType: "person", entityId: id });
const table = (id: string): EntityRef => ({ entityType: "contributorTable", entityId: id });

/** The record of a cell without the fills of the template, so that a shifted banding is no change of the row. */
function withoutTemplateFill(cell: RawCell): RawCell {
  if (cell === null || typeof cell !== "object" || typeof cell.fill !== "string") return cell;
  if (!TEMPLATE_FILLS.has(cell.fill.toUpperCase())) return cell;
  const { fill: _fill, fillSource: _fillSource, ...rest } = cell;
  return (rest.v ?? null) === null && rest.f === undefined && rest.l === undefined && Object.keys(rest).length <= 2
    ? null
    : rest;
}

function readSheet(input: ImportInput, context: ReadContext): SourceReading {
  const opened = openWorkbook(input);
  const { contentHash, inputFiles, workbook } = opened;
  if (workbook === null) return { contentHash, inputFiles, tabs: [], issues: opened.issues };
  const issues: StructureIssue[] = [];
  const issue = (check: string, tabKey: string | null, message: string, expected: string, found: string) =>
    issues.push({ check, tabKey, message, expected, found });
  const [sheet] = workbook.sheets;
  if (sheet === undefined || workbook.sheets.length !== 1) {
    issue(
      "tabs",
      null,
      "A contributor sheet has exactly one tab.",
      "1 tab",
      `${workbook.sheets.length} tabs: ${workbook.sheets.map((entry) => entry.name).join(", ")}`,
    );
    return { contentHash, inputFiles, tabs: [], issues };
  }
  if (sheet.name !== TAB_TITLE) {
    issue("tabName", TAB_KEY, "The tab of a contributor sheet has the default title.", TAB_TITLE, sheet.name);
  }

  const grid = gridOf(sheet);
  const headerCells = grid.cells(1);
  const headers: HeaderCell[] = grid.labels.map((label, index) => {
    const value = storedValue(headerCells[index]);
    return { label, text: typeof value === "string" ? value : value === null ? "" : String(value) };
  });
  const columns = mapColumns(headers);
  if (columns.missing.length > 0) {
    issue(
      "header",
      TAB_KEY,
      `Row 1 lacks ${columns.missing.length} of the headers that every contributor sheet has: the two name headers and the fourteen role headers.`,
      columns.missing.join(" | "),
      headers
        .map((header) => header.text)
        .filter((text) => text.trim() !== "")
        .join(" | "),
    );
  }
  if (columns.duplicated.length > 0) {
    issue(
      "duplicateHeader",
      TAB_KEY,
      `${columns.duplicated.length} headers of the mapping stand in row 1 more than once.`,
      "each header once",
      columns.duplicated.join(" | "),
    );
  }

  const rows: SourceRow[] = [];
  const ordinals = new Map<string, number>();
  const keyed = (stem: string): string => {
    const ordinal = (ordinals.get(stem) ?? 0) + 1;
    ordinals.set(stem, ordinal);
    return `${stem}__${ordinal}`;
  };
  const contentKey = (cells: readonly RawCell[]) => `raw-${keyedShortHash(canonicalJson(cells), context.secret)}`;
  rows.push({ rowClass: "header", rowNumber: 1, rowKey: "header", cells: headerCells, labels: grid.labels });
  // The note of a header explains its column. It is content of the tab and no row of it.
  for (const note of sheet.notes) {
    const match = /^([A-Z]{1,3})(\d+)$/.exec(note.ref);
    const header = headers.find((candidate) => candidate.label === match?.[1]);
    if (match === null || header === undefined) continue;
    const folded = lookupFold(header.text);
    rows.push({
      rowClass: "annotation",
      rowNumber: Number(match[2]),
      rowKey: keyed(`note__${folded === "" || Number(match[2]) !== 1 ? "other" : folded}`),
      cells: [{ v: note.text, t: NOTE_TYPE }],
      labels: [header.label],
      cellLevel: true,
    });
  }

  const at = (cells: readonly RawCell[], label: string | undefined): RawScalar =>
    label === undefined ? null : storedValue(cells[grid.labels.indexOf(label)]);
  const firstNameColumn = columns.fields.get("firstName");
  const surnameColumn = columns.fields.get("surname");
  const orderColumn = columns.fields.get("orderInPublication");
  let fillerRows = 0;
  let blankRows = 0;
  for (let row = 2; row <= grid.lastRow; row += 1) {
    const cells = grid.cells(row, { fill: true }).map(withoutTemplateFill);
    const [firstName, surname] = [at(cells, firstNameColumn), at(cells, surnameColumn)];
    const others = grid.labels
      .filter((label) => label !== firstNameColumn && label !== surnameColumn)
      .map((label) => at(cells, label));
    const rowClass = classifyRow(firstName, surname, others);
    if (rowClass === "filler") fillerRows += 1;
    else if (rowClass === "blank") blankRows += 1;
    if (rowClass === "filler" || rowClass === "blank") continue;
    const stored = { rowNumber: row, cells, labels: grid.labels };
    if (rowClass === "contributor") {
      // The key of a contributor row is the keyed hash of its folded name, with an ordinal among equal names.
      const nameHash = contributorNameHash(String(firstName), String(surname), context.secret);
      rows.push({ ...stored, rowClass: "data", rowKey: keyed(`c__${nameHash ?? contentKey(cells)}`) });
    } else if (rowClass === "halfNamed") {
      rows.push({ ...stored, rowClass: "data", rowKey: keyed(`half__${contentKey(cells)}`) });
    } else if (rowClass === "placeholder") {
      // A reserved position is keyed by its order value where that is all the row holds.
      const order = at(cells, orderColumn);
      const onlyOrder = grid.labels.every((label) => label === orderColumn || !readCheckbox(at(cells, label)).odd);
      const slot = onlyOrder && order !== null ? lookupFold(String(order)) : "";
      rows.push({
        ...stored,
        rowClass: "placeholder",
        rowKey: keyed(`slot__${slot === "" ? contentKey(cells) : slot}`),
      });
    } else {
      rows.push({ ...stored, rowClass: "annotation", rowKey: keyed(`tick__${contentKey(cells)}`) });
    }
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
        fillerRows,
        blankRows,
      },
    ],
    issues,
  };
}

/** One contributor row as the plan reads it. */
interface ContributorRow {
  readonly row: RecordedRow;
  readonly nameHash: string;
  readonly contributorId: string;
  readonly firstName: string;
  readonly surname: string;
  /** The first affiliation cell, verbatim, or null. */
  readonly affiliation: string | null;
  /** The address in canonical form where the cell is exactly one address in ASCII. Null otherwise. */
  readonly email: string | null;
  readonly orcid: string | null;
  readonly personId: string | null;
}

/** A contributor of another sheet, as the database holds it. */
interface OtherContributor {
  readonly id: string;
  readonly tableId: string;
  readonly nameHash: string | null;
  readonly foldedFirst: string;
  readonly foldedSurname: string;
  readonly affiliation: string | null;
  /** Every affiliation string of the row, whichever slot holds it. */
  readonly affiliations: readonly string[];
  readonly sourceRecordId: string | undefined;
}

class SheetPlan {
  readonly #sheet: RegisteredSheet;
  readonly #context: PlanContext;
  readonly #builder = new PlanBuilder();
  readonly #terms = new VocabularyCollector();
  readonly #rows: readonly RecordedRow[];
  readonly #header: RecordedRow | undefined;
  readonly #source: string;
  /** Every affiliation string of the sheet, with the first row that holds it. */
  readonly #affiliations = new Map<string, RecordedRow>();

  constructor(sheet: RegisteredSheet, context: PlanContext) {
    this.#sheet = sheet;
    this.#context = context;
    this.#rows = context.rows.get(TAB_KEY) ?? [];
    this.#header = this.#rows.find((row) => row.rowClass === "header");
    this.#source = `${sheet.sourceKey}/${TAB_KEY}`;
  }

  #value(row: RecordedRow, label: string | undefined): RawScalar {
    return label === undefined ? null : storedValue(row.cells[row.labels.indexOf(label)]);
  }

  #text(row: RecordedRow, label: string | undefined): string | null {
    const value = this.#value(row, label);
    const text = verbatimText(value);
    return text === null || text.trim() === "" ? null : text;
  }

  #link(row: RecordedRow, label: string | undefined): string | null {
    if (label === undefined) return null;
    const cell = row.cells[row.labels.indexOf(label)];
    const link = cell !== null && typeof cell === "object" ? cell.l : undefined;
    return typeof link === "string" && link !== "" ? link : null;
  }

  #claim(row: RecordedRow, value: string, shown = true, source = this.#sheet.sourceKey): ItemClaim {
    return {
      source,
      value,
      ...(shown && value.length <= LIMITS.shortText ? { valueSource: value } : {}),
      sourceRecordId: row.recordId,
    };
  }

  /** The headers of the sheet, by column, from the stored header row. */
  #headers(): HeaderCell[] {
    const header = this.#header;
    if (header === undefined) return [];
    return header.labels.map((label) => {
      const value = this.#value(header, label);
      return { label, text: typeof value === "string" ? value : value === null ? "" : String(value) };
    });
  }

  /**
   * Checks the registration against what the database holds: the replication exists, and a
   * contributor table that another source wrote names the same replication. A difference stops
   * the sheet, because the importer never chooses between two statements.
   */
  async #registrationIsBlocked(): Promise<boolean> {
    const { db, items, studies } = this.#context;
    const { registration, sourceKey, tableId } = this.#sheet;
    const header = this.#header;
    const resolution = await studies.resolve(registration.replicationId);
    if (resolution.status !== "resolved" || resolution.replicationId !== registration.replicationId) {
      this.#builder.block(
        "replication",
        "The replication that the registration of the sheet names does not exist. Import the sources that create the replications first.",
        items.unmatchedIdentifier({
          subject: `${sourceKey}/replication`,
          claims: [
            {
              source: "registration",
              value: registration.replicationId,
              valueSource: registration.replicationId,
              ...(header === undefined ? {} : { sourceRecordId: header.recordId }),
            },
          ],
          blocking: true,
        }),
      );
      return true;
    }
    const path = COLLECTIONS.contributorTables.docPath(tableId);
    const stored = (await readDocuments(db, [path])).get(path)?.data;
    const held = stored?.replicationId;
    if (stored !== undefined && held !== registration.replicationId) {
      const heldText = typeof held === "string" ? held : "none";
      this.#builder.block(
        "registry",
        "The registration of the sheet and the contributor table that the database holds name different replications.",
        items.valueConflict({
          subject: tableId,
          field: "replicationId",
          entityRefs: [table(tableId)],
          claims: [
            {
              source: "registration",
              value: registration.replicationId,
              valueSource: registration.replicationId,
              ...(header === undefined ? {} : { sourceRecordId: header.recordId }),
            },
            { source: "contributorTable", value: heldText, valueSource: heldText },
          ],
          blocking: true,
        }),
      );
      return true;
    }
    return false;
  }

  /**
   * Compares the headers with those of the last applied run of the sheet. A header that is
   * new, missing or renamed stops the sheet until a reviewer has resolved the item that says so.
   */
  async #headersAreBlocked(): Promise<boolean> {
    const { db, items } = this.#context;
    const header = this.#header;
    if (header === undefined) return false;
    const tablePath = COLLECTIONS.contributorTables.docPath(this.#sheet.tableId);
    const previousId = (await readDocuments(db, [tablePath])).get(tablePath)?.data.sourceRecordId;
    if (typeof previousId !== "string" || previousId === header.recordId) return false;
    const recordPath = COLLECTIONS.sourceRecords.docPath(previousId);
    const previous = (await readDocuments(db, [recordPath])).get(recordPath)?.data.raw as
      | Record<string, RawCell>
      | undefined;
    if (previous === undefined) return false;
    const texts = (cells: readonly RawCell[]) =>
      cells
        .map((cell) => storedValue(cell))
        .filter((value): value is string => typeof value === "string" && value.trim() !== "")
        .map((value) => value.normalize("NFC").replace(/\s+/g, " ").trim());
    const before = texts(Object.values(previous));
    const now = texts(header.cells);
    const gone = before.filter((text) => !now.includes(text)).sort();
    const added = now.filter((text) => !before.includes(text)).sort();
    if (gone.length === 0 && added.length === 0) return false;
    const item = items.structureChange({
      subject: `${this.#source}/headers`,
      claims: [
        ...gone.map((text) => ({ source: "lastRun", value: text, valueSource: text, sourceRecordId: previousId })),
        ...added.map((text) => ({
          source: "thisRun",
          value: text,
          valueSource: text,
          sourceRecordId: header.recordId,
        })),
      ],
      blocking: true,
    });
    const itemPath = COLLECTIONS.reconciliationItems.docPath(item.fingerprint);
    // A reviewer who has resolved the item has accepted the new headers, and the sheet goes ahead.
    if ((await readDocuments(db, [itemPath])).get(itemPath)?.data.status === "resolved") return false;
    this.#builder.block(
      "headers",
      `The headers have changed since the last run of the sheet: ${gone.length} are gone and ${added.length} are new.`,
      item,
    );
    return true;
  }

  /**
   * Applies the column overrides of the registration. An override is a decision of a
   * maintainer, and it is checked against the content of its column on every run: where the
   * content no longer fits, the override is not applied and an item says so.
   */
  #withOverrides(columns: ColumnMap, data: readonly RecordedRow[]): ColumnMap {
    const { items } = this.#context;
    const header = this.#header;
    const fields = new Map(columns.fields);
    let unknown = [...columns.unknown];
    let blank = [...columns.blank];
    const labels = header?.labels ?? [];
    for (const override of this.#sheet.registration.columnOverrides ?? []) {
      const label = this.#overriddenColumn(override, unknown, blank, labels);
      const kind = label === null ? "empty" : contentKindOf(data.map((row) => this.#value(row, label)));
      const fits = override.field === "orcid" ? kind === "orcid" : kind === "integers" || kind === "order";
      if (label !== null && fits && !fields.has(override.field)) {
        fields.set(override.field, label);
        unknown = unknown.filter((entry) => entry.label !== label);
        blank = blank.filter((entry) => entry !== label);
        continue;
      }
      const found = label === null ? "noSuchColumn" : fields.has(override.field) ? "fieldHasItsOwnHeader" : kind;
      this.#builder.item(
        items.structureChange({
          subject: `${this.#source}/override/${override.field}`,
          claims: [
            { source: "override", value: override.field, valueSource: override.field },
            {
              source: "found",
              value: found,
              valueSource: found,
              ...(header === undefined ? {} : { sourceRecordId: header.recordId }),
            },
          ],
        }),
      );
    }
    return { ...columns, fields, unknown, blank };
  }

  /** The column that an override names: one without a header at a stated position, or one under a stated header. */
  #overriddenColumn(
    override: ColumnOverride,
    unknown: readonly HeaderCell[],
    blank: readonly string[],
    labels: readonly string[],
  ): string | null {
    const positioned = override.position === undefined ? undefined : labels[override.position - 1];
    if (override.header.trim() === "") {
      return positioned !== undefined && blank.includes(positioned) ? positioned : null;
    }
    const wanted = normaliseHeader(override.header);
    const found = unknown.filter(
      (entry) => normaliseHeader(entry.text) === wanted && (positioned === undefined || entry.label === positioned),
    );
    const [only] = found;
    return found.length === 1 && only !== undefined ? only.label : null;
  }

  /** Reports every column that the mapping does not know, and every header that does not fit its content. */
  #columnItems(columns: ColumnMap, data: readonly RecordedRow[]): void {
    const { items } = this.#context;
    const header = this.#header;
    if (header === undefined) return;
    const kindOf = (label: string): ContentKind => contentKindOf(data.map((row) => this.#value(row, label)));
    for (const label of columns.blank) {
      const kind = kindOf(label);
      // A column without a header that holds nothing in any contributor row is a spacer.
      if (kind === "empty") continue;
      this.#builder.item(
        items.structureChange({
          subject: `${this.#source}/blankHeader/${label}`,
          claims: [
            { source: `${this.#source}/content`, value: kind, valueSource: kind, sourceRecordId: header.recordId },
          ],
        }),
      );
    }
    for (const entry of columns.unknown) {
      const kind = kindOf(entry.label);
      // A header that is new or renamed is reported, and so is one over identifiers that it does not name.
      this.#builder.item(
        items.structureChange({
          subject: `${this.#source}/header/${lookupFold(entry.text) || entry.label}`,
          claims: [
            {
              source: `${this.#source}/header`,
              value: entry.text,
              valueSource: entry.text,
              sourceRecordId: header.recordId,
            },
            ...(kind === "orcid" || kind === "email"
              ? [{ source: `${this.#source}/content`, value: kind, valueSource: kind, sourceRecordId: header.recordId }]
              : []),
          ],
        }),
      );
    }
    // A column of identifiers that holds something of another shape may not be what its header says.
    for (const [field, shape] of [
      ["orcid", "orcid"],
      ["email", "email"],
    ] as const) {
      const label = columns.fields.get(field);
      if (label === undefined) continue;
      const kind = kindOf(label);
      if (kind === "empty" || kind === shape) continue;
      const misfits = data.filter((row) => {
        const value = this.#value(row, label);
        return contentKindOf([value]) !== "empty" && contentKindOf([value]) !== shape;
      });
      // An address with a letter outside ASCII, or an iD with a wrong check digit, still has the shape.
      if (misfits.length === 0) continue;
      this.#builder.item(
        items.structureChange({
          subject: `${this.#source}/content/${field}`,
          claims: [
            { source: `${this.#source}/header`, value: field, valueSource: field, sourceRecordId: header.recordId },
            ...misfits.map((row) => ({
              source: `${this.#source}/content`,
              value: row.rowKey,
              sourceRecordId: row.recordId,
            })),
          ],
        }),
      );
    }
  }

  /** The vocabulary terms of the CRediT roles, with the header of each column and its note. */
  #roleTerms(columns: ColumnMap): void {
    const header = this.#header;
    if (header === undefined) return;
    const notes = new Map(
      this.#rows
        .filter((row) => row.cellLevel === true && row.rowKey.startsWith("note__"))
        .map((row) => [row.labels[0] ?? "", row] as const),
    );
    for (const role of CREDIT_ROLES) {
      const label = columns.roles.get(role.key);
      const text = this.#text(header, label);
      if (label === undefined || text === null) continue;
      const note = notes.get(label);
      const definition = note === undefined ? null : verbatimText(this.#value(note, label));
      this.#builder.document({
        collection: "vocabularyTerms",
        ids: [vocabularyTermId(CREDIT_ROLE_TERM_KIND, text)],
        fixed: { sourceId: role.key, name: text, kind: CREDIT_ROLE_TERM_KIND, sameAsSource: [], isDeprecated: false },
        // The first sheet that states a definition supplies it. A sheet whose note differs raises a conflict.
        ...(definition === null || definition === "" || definition.length > LIMITS.longText
          ? {}
          : { owned: { description: definition } }),
        union: { labelsSource: [text] },
        sourceRecordIds: [header.recordId, ...(note === undefined ? [] : [note.recordId])],
        ...(note === undefined ? {} : { fieldSources: { description: note.recordId } }),
      });
    }
  }

  /** The people whose display name folds like a name, for a link that only a reviewer may make. */
  async #peopleByName(): Promise<Map<string, string[]>> {
    const people = await this.#context.db.collection(COLLECTIONS.persons.collectionPath()).select("displayName").get();
    const byName = new Map<string, string[]>();
    for (const doc of people.docs) {
      const folded = lookupFold(String(doc.get("displayName") ?? ""));
      if (folded !== "") byName.set(folded, [...(byName.get(folded) ?? []), doc.id].sort());
    }
    return byName;
  }

  /** The contributors of the other sheets, as the database holds them. */
  async #otherContributors(): Promise<OtherContributor[]> {
    const { db, secret } = this.#context;
    const stored = await db
      .collection(COLLECTIONS.contributors.collectionPath())
      .select(
        "contributorTableId",
        "firstNameSource",
        "surnameSource",
        "affiliationSource",
        "affiliationSlotsSource",
        "sourceRecordId",
      )
      .get();
    return stored.docs
      .filter((doc) => doc.get("contributorTableId") !== this.#sheet.tableId)
      .map((doc) => {
        const first = String(doc.get("firstNameSource") ?? "");
        const surname = String(doc.get("surnameSource") ?? "");
        const affiliation: unknown = doc.get("affiliationSource");
        const slots = (doc.get("affiliationSlotsSource") as Record<string, unknown> | undefined) ?? {};
        const recordId: unknown = doc.get("sourceRecordId");
        return {
          id: doc.id,
          tableId: String(doc.get("contributorTableId")),
          nameHash: contributorNameHash(first, surname, secret),
          foldedFirst: lookupFold(first),
          foldedSurname: lookupFold(surname),
          affiliation: typeof affiliation === "string" ? affiliation : null,
          affiliations: Object.values(slots).filter((text): text is string => typeof text === "string"),
          sourceRecordId: typeof recordId === "string" ? recordId : undefined,
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Plans one contributor row: the contributor, its restricted contact document and the questions about its cells. */
  async #contributor(row: RecordedRow, columns: ColumnMap, nameHash: string): Promise<ContributorRow> {
    const { identities, items } = this.#context;
    const { registration, tableId, sourceKey } = this.#sheet;
    const ordinal = Number(row.rowKey.split("__").at(-1));
    const id = contributorId(registration.externalId, nameHash, ordinal);
    const subject = { subject: id, entityRefs: [contributor(id)] };
    const fits = (text: string | null): string | undefined =>
      text === null || text.length > LIMITS.longText ? undefined : text;

    // The order: a whole number, a word that states a rule, or a value that a person has to read.
    const orderColumn = columns.fields.get("orderInPublication");
    const order = readOrder(this.#value(row, orderColumn));
    const orderText = this.#text(row, orderColumn) ?? "";
    if (order.kind === "rule") this.#terms.add(ORDER_RULE_TERM_KIND, order.rule, row.recordId, orderText);
    if (order.kind === "rule" || order.kind === "unread") {
      this.#builder.item(
        items.unparsedValue({
          ...subject,
          field: "orderInPublication",
          claims: [this.#claim(row, orderText, order.kind === "rule")],
        }),
      );
    }

    // The roles: the verbatim value of each cell. A blank is unknown and never false.
    const creditRoles: Partial<Record<CreditRoleKey, string | number | boolean>> = {};
    let ticked = 0;
    /** Reads one checkbox cell and queues a blank one, or one that holds something else. Returns whether it is ticked. */
    const checkbox = (field: string, value: RawScalar): boolean => {
      const reading = readCheckbox(value);
      if (reading.blank || reading.odd) {
        this.#builder.item(
          items.unparsedValue({
            ...subject,
            field,
            claims: [this.#claim(row, reading.blank ? "blank" : (verbatimText(value) ?? ""), reading.blank)],
          }),
        );
      }
      return reading.tick === true;
    };
    for (const role of CREDIT_ROLES) {
      const value = this.#value(row, columns.roles.get(role.key));
      if (value !== null && !(typeof value === "string" && value.length > LIMITS.longText))
        creditRoles[role.key] = value;
      if (checkbox(role.key, value)) ticked += 1;
    }
    for (const field of CHECKBOX_FIELDS) {
      const label = columns.fields.get(field);
      if (label !== undefined) checkbox(field, this.#value(row, label));
    }
    if (ticked === 0) {
      // Nothing ticked says that the row is not filled in yet, and never that the person did nothing.
      this.#builder.item(
        items.unparsedValue({ ...subject, field: "creditRoles", claims: [this.#claim(row, "noRoleTicked")] }),
      );
    }

    // The affiliations: one verbatim string for each slot, never split.
    const slots: Record<string, string> = {};
    for (const [slot, label] of [...columns.affiliations].sort(([a], [b]) => a - b)) {
      const text = fits(this.#text(row, label));
      if (text === undefined) continue;
      slots[String(slot)] = text;
      if (!this.#affiliations.has(text)) this.#affiliations.set(text, row);
      const candidateId = institutionCandidateId(text);
      if (candidateId !== null) {
        this.#builder.document({
          collection: "institutionCandidates",
          ids: [candidateId],
          fixed: { affiliationFolded: lookupFold(text), institutionId: null },
          union: { affiliationsSource: [text] },
          sourceRecordIds: [row.recordId],
        });
      }
      if (text.includes(";")) {
        // A semicolon may separate two affiliations. The cell is one string until a person says otherwise.
        this.#builder.item(
          items.unparsedValue({
            ...subject,
            field: "affiliationSlotsSource",
            claims: [this.#claim(row, text, true, `${sourceKey}/affiliation${slot}`)],
          }),
        );
      }
    }

    // The identifiers. An iD that fails its check digit and an address that is not exactly one address match nothing.
    const orcidColumn = columns.fields.get("orcid");
    const orcidText = this.#text(row, orcidColumn);
    const orcidLink = this.#link(row, orcidColumn);
    const orcid = orcidText === null ? null : validOrcid(orcidText);
    const linked = orcidLink === null ? null : validOrcid(orcidLink);
    if (orcidText !== null && (orcid === null || (orcidLink !== null && linked !== orcid))) {
      this.#builder.item(
        items.identifierDefect({ ...subject, field: "orcid", claims: [this.#claim(row, orcidText.trim())] }),
      );
    }
    const emailText = this.#text(row, columns.fields.get("email"));
    const emailEvidence = emailText === null || holdsNonAscii(emailText) ? null : personEvidence.email(emailText);
    if (emailText !== null && emailEvidence === null) {
      this.#builder.item(
        items.identifierDefect({
          ...subject,
          field: "email",
          claims: [this.#claim(row, normaliseEmail(emailText), false)],
        }),
      );
    }
    const firstName = this.#text(row, columns.fields.get("firstName")) ?? "";
    const surname = this.#text(row, columns.fields.get("surname")) ?? "";
    const orcidEvidence =
      orcid !== null && (orcidLink === null || linked === orcid) ? personEvidence.orcid(orcid) : null;
    const evidence: PersonEvidence[] = [emailEvidence, orcidEvidence].flatMap((entry) =>
      entry === null ? [] : [entry],
    );
    if (evidence.length === 0) {
      // A name with its affiliation links to exactly one existing person, and never creates one.
      for (const text of Object.values(slots)) {
        const entry = personEvidence.nameAffiliation(`${firstName} ${surname}`, text);
        if (entry !== null) evidence.push(entry);
      }
    }
    const resolution = await identities.resolvePerson(evidence);
    if (resolution.status === "ambiguous") {
      // The identifiers of the row name several people. Nothing is attached, and a reviewer decides.
      this.#builder.item(
        items.ambiguousEmail({
          ...subject,
          field: "personId",
          entityRefs: [contributor(id), ...resolution.personIds.map(person)],
          claims: [this.#claim(row, resolution.personIds.join(" "), false)],
        }),
      );
    }
    const personId = resolution.status === "existing" ? resolution.personId : null;

    // The whole row in a fill that the template does not use is a highlight, whose meaning a person knows.
    const fills = row.cells.map((cell) => (cell !== null && typeof cell === "object" ? cell.fill : undefined));
    const [fill] = fills;
    if (typeof fill === "string" && fills.every((entry) => entry === fill)) {
      this.#builder.item(
        items.formattingSignal({ ...subject, field: "rowHighlight", claims: [this.#claim(row, fill)] }),
      );
    }

    this.#builder.document({
      collection: "contributors",
      ids: [id],
      fixed: {
        reviewStatus: "needsReview",
        replicationId: registration.replicationId,
        manuscriptId: null,
        contributorTableId: tableId,
        scopeKeys: unitScopeKeys(registration.replicationId, null),
      },
      owned: {
        firstNameSource: fits(this.#text(row, columns.fields.get("firstName"))),
        middleNameSource: fits(this.#text(row, columns.fields.get("middleName"))),
        surnameSource: fits(this.#text(row, columns.fields.get("surname"))),
        orderInPublication: order.kind === "number" ? order.order : undefined,
        affiliationSource: slots["1"],
        affiliationSlotsSource: Object.keys(slots).length === 0 ? undefined : slots,
        orcid: fits(orcidText),
        creditRoles,
        agreementSource: fits(this.#text(row, columns.fields.get("agreement"))),
        personId,
        sourceRecordId: row.recordId,
      },
      // A link that a reviewer has made is a decision. The revision of the row says nothing about the contributor.
      silent: ["personId", "sourceRecordId"],
      sourceRecordIds: [row.recordId],
    });

    // The address and the funding statement are restricted, and go to the contact document alone.
    const funding = this.#text(row, columns.fields.get("funding"));
    if (emailText !== null || funding !== null) {
      this.#builder.document({
        collection: "contributorContact",
        ids: [id],
        owned: { email: fits(emailText), fundingStatement: fits(funding) },
        sourceRecordIds: [row.recordId],
      });
    }
    return {
      row,
      nameHash,
      contributorId: id,
      firstName,
      surname,
      affiliation: slots["1"] ?? null,
      email: emailEvidence === null || emailText === null ? null : normaliseEmail(emailText),
      orcid: orcidEvidence === null ? null : orcid,
      personId,
    };
  }

  /** The questions about the sheet as a whole: the order, the corresponding author and what kind of table it is. */
  async #sheetItems(columns: ColumnMap, contributors: readonly ContributorRow[]): Promise<void> {
    const { db, items } = this.#context;
    const { sourceKey, tableId } = this.#sheet;
    const orderColumn = columns.fields.get("orderInPublication");
    if (orderColumn !== undefined) {
      const without = contributors.filter((entry) => readOrder(this.#value(entry.row, orderColumn)).kind === "absent");
      // Rows without an order are a question only where other rows of the sheet have one.
      if (without.length > 0 && without.length < contributors.length) {
        this.#builder.item(
          items.unparsedValue({
            subject: tableId,
            field: "orderInPublication",
            entityRefs: [table(tableId)],
            claims: without.map((entry) => this.#claim(entry.row, entry.contributorId, false)),
          }),
        );
      }
    }
    const flagColumn = columns.fields.get("correspondingAuthor");
    if (flagColumn !== undefined && contributors.length > 0) {
      const flagged = contributors.filter((entry) => readCheckbox(this.#value(entry.row, flagColumn)).tick === true);
      if (flagged.length !== 1) {
        this.#builder.item(
          items.valueConflict({
            subject: tableId,
            field: "correspondingAuthor",
            entityRefs: [table(tableId)],
            claims:
              flagged.length === 0
                ? [{ source: sourceKey, value: "noneFlagged", valueSource: "noneFlagged" }]
                : flagged.map((entry) => this.#claim(entry.row, entry.contributorId, false)),
          }),
        );
      }
    }
    // Whether the sheet is a sign-up table or a final list, whether it is published and which manuscript it
    // belongs to is never read from its completeness. The membership workbook or a maintainer says so.
    const path = COLLECTIONS.contributorTables.docPath(tableId);
    const stored = (await readDocuments(db, [path])).get(path)?.data ?? {};
    const open = [
      ...(typeof stored.isOnlySignupTable === "boolean" ? [] : ["isOnlySignupTable"]),
      ...(typeof stored.isPublished === "boolean" ? [] : ["isPublished"]),
      "manuscriptId",
    ];
    const header = this.#header;
    this.#builder.item(
      items.statusQuestion({
        subject: tableId,
        entityRefs: [table(tableId)],
        claims: open.map((field) => ({
          source: sourceKey,
          value: field,
          valueSource: field,
          ...(header === undefined ? {} : { sourceRecordId: header.recordId }),
        })),
      }),
    );
  }

  /** Compares the contributors of this sheet with those of the other sheets. Nothing is merged or linked. */
  async #crossFileItems(contributors: readonly ContributorRow[]): Promise<void> {
    const { db, items, secret } = this.#context;
    const { tableId } = this.#sheet;
    const others = await this.#otherContributors();
    const peopleByName = await this.#peopleByName();
    const sameName = (hash: string) => others.filter((other) => other.nameHash === hash);
    const contacts = await readDocuments(
      db,
      others
        .filter((other) => contributors.some((entry) => entry.nameHash === other.nameHash))
        .map((other) => COLLECTIONS.contributorContact.docPath(other.id)),
    );
    const claimOf = (other: OtherContributor, value: string, shown = false): ItemClaim => ({
      source: other.tableId,
      value,
      ...(shown && value.length <= LIMITS.shortText ? { valueSource: value } : {}),
      ...(other.sourceRecordId === undefined ? {} : { sourceRecordId: other.sourceRecordId }),
    });

    for (const entry of contributors) {
      const twins = sameName(entry.nameHash);
      const people = peopleByName.get(lookupFold(`${entry.firstName} ${entry.surname}`)) ?? [];
      const subject = `contributorName/${entry.nameHash}`;
      const refs = [contributor(entry.contributorId), ...twins.map((twin) => contributor(twin.id))];
      // A link from this row to a person would rest on its name: it has no identifier, or its name is all that
      // ties it to a row of another sheet or to a person. A reviewer makes such a link, and nobody else.
      const unidentified = entry.email === null && entry.orcid === null;
      if (entry.personId === null && (unidentified || twins.length > 0 || people.length > 0)) {
        this.#builder.item(
          items.duplicatePerson({
            subject,
            shared: true,
            entityRefs: [...refs, ...people.map(person)],
            claims: [
              this.#claim(entry.row, entry.contributorId, false, tableId),
              ...twins.map((twin) => claimOf(twin, twin.id)),
              ...people.map((id) => ({ source: "person", value: id })),
            ],
          }),
        );
      }
      // One name with different addresses in two sheets. Neither address is preferred.
      const addresses = twins.flatMap((twin) => {
        const email = contacts.get(COLLECTIONS.contributorContact.docPath(twin.id))?.data.email;
        const canonical = typeof email === "string" && !holdsNonAscii(email) ? personEvidence.email(email) : null;
        return canonical === null || typeof email !== "string" ? [] : [{ twin, email: normaliseEmail(email) }];
      });
      if (entry.email !== null && addresses.some((address) => address.email !== entry.email)) {
        this.#builder.item(
          items.ambiguousEmail({
            subject,
            shared: true,
            field: "email",
            entityRefs: refs,
            claims: [
              this.#claim(entry.row, entry.email, false, tableId),
              ...addresses.map((address) => claimOf(address.twin, address.email)),
            ],
          }),
        );
      }
      // One name with different first affiliations in two sheets: a move, or one place written in two ways.
      // Every sheet that holds the name states the same claims, so the question is one item whichever is read.
      const affiliated = twins.filter((twin) => twin.affiliation !== null);
      const entryFolded = entry.affiliation === null ? null : lookupFold(entry.affiliation);
      if (entry.affiliation !== null && affiliated.some((twin) => lookupFold(twin.affiliation ?? "") !== entryFolded)) {
        this.#builder.item(
          items.institutionMatch({
            subject,
            shared: true,
            field: "affiliation",
            entityRefs: refs,
            claims: [
              this.#claim(entry.row, entry.affiliation, true, tableId),
              ...affiliated.map((twin) => claimOf(twin, twin.affiliation ?? "", true)),
            ],
          }),
        );
      }
      // A first name that differs between two sheets, under one surname and one initial, where neither row
      // has a row of its own name in the other sheet. Whether the two are one person is for a reviewer.
      if (twins.length > 0) continue;
      const foldedFirst = lookupFold(entry.firstName);
      const foldedSurname = lookupFold(entry.surname);
      for (const other of others) {
        if (other.nameHash === null || other.foldedSurname !== foldedSurname) continue;
        if (other.foldedFirst === foldedFirst || other.foldedFirst[0] !== foldedFirst[0]) continue;
        if (contributors.some((candidate) => candidate.nameHash === other.nameHash)) continue;
        const pair = [entry.nameHash, other.nameHash].sort().join("-");
        this.#builder.item(
          items.duplicatePerson({
            subject: `contributorVariant/${keyedShortHash(pair, secret)}`,
            entityRefs: [contributor(entry.contributorId), contributor(other.id)],
            claims: [this.#claim(entry.row, entry.contributorId, false, tableId), claimOf(other, other.id)],
          }),
        );
      }
    }

    // Affiliation strings that may name one institution, within the sheet and against the other sheets.
    const own = this.#affiliations;
    // Every slot of the other sheets is compared, as every slot of this one is, so that a pair of strings is
    // found whichever of its two sheets is read last.
    const foreign = new Map<string, OtherContributor>();
    for (const other of others) for (const text of other.affiliations) foreign.set(text, other);
    const ownTexts = [...own.keys()].sort();
    // One pair of strings is one question, whichever sheets hold them, so the claims name no sheet.
    const pairItem = (first: readonly [string, string | undefined], second: readonly [string, string | undefined]) => {
      const key = [shortHash(lookupFold(first[0])), shortHash(lookupFold(second[0]))].sort().join("-");
      const claims = [first, second].map(([text, sourceRecordId]) => ({
        source: "affiliation",
        value: text,
        ...(text.length <= LIMITS.shortText ? { valueSource: text } : {}),
        ...(sourceRecordId === undefined ? {} : { sourceRecordId }),
      }));
      this.#builder.item(items.institutionMatch({ subject: `affiliationPair/${key}`, claims }));
    };
    for (const [index, first] of ownTexts.entries()) {
      const firstRow = own.get(first);
      if (firstRow === undefined) continue;
      for (const second of ownTexts.slice(index + 1)) {
        const secondRow = own.get(second);
        if (secondRow === undefined || !nearDuplicateAffiliations(first, second)) continue;
        pairItem([first, firstRow.recordId], [second, secondRow.recordId]);
      }
      for (const [second, other] of [...foreign].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (own.has(second) || !nearDuplicateAffiliations(first, second)) continue;
        pairItem([first, firstRow.recordId], [second, other.sourceRecordId]);
      }
    }
  }

  async run(): Promise<ImportPlan> {
    const { items } = this.#context;
    const { registration, sourceKey, tableId } = this.#sheet;
    const header = this.#header;
    if (header === undefined) return this.#builder.build();
    if ((await this.#registrationIsBlocked()) || (await this.#headersAreBlocked())) return this.#builder.build();

    const data = this.#rows.filter((row) => row.rowClass === "data");
    const named = data.filter((row) => row.rowKey.startsWith("c__") && !row.rowKey.startsWith("c__raw-"));
    const columns = this.#withOverrides(mapColumns(this.#headers()), named);
    this.#columnItems(columns, named);
    this.#roleTerms(columns);

    this.#builder.document({
      collection: "contributorTables",
      ids: [tableId],
      fixed: {
        replicationId: registration.replicationId,
        sourceKey,
        scopeKeys: unitScopeKeys(registration.replicationId, null),
      },
      owned: { sourceRecordId: header.recordId },
      silent: ["sourceRecordId"],
      sourceRecordIds: [header.recordId],
    });

    // A name that stands in the sheet twice has no stable ordinal. Neither row is imported.
    const perName = new Map<string, RecordedRow[]>();
    for (const row of named) {
      const hash = row.rowKey.split("__")[1] ?? "";
      perName.set(hash, [...(perName.get(hash) ?? []), row]);
    }
    const contributors: ContributorRow[] = [];
    for (const [hash, rows] of [...perName].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const [only] = rows;
      if (rows.length === 1 && only !== undefined) {
        contributors.push(await this.#contributor(only, columns, hash));
        continue;
      }
      const item = items.duplicatePerson({
        subject: `${this.#source}/name/${hash}`,
        claims: rows.map((row) => this.#claim(row, row.rowKey, false)),
      });
      for (const row of rows) this.#builder.hold(row.recordId, item);
    }
    for (const row of data.filter((candidate) => !named.includes(candidate))) {
      // A row with one of its two names, or with a name of which nothing is left after folding, waits for a person.
      this.#builder.hold(
        row.recordId,
        items.unparsedValue({
          subject: `${this.#source}/${row.rowKey}`,
          field: "name",
          claims: [this.#claim(row, row.rowKey, false)],
        }),
      );
    }
    for (const row of this.#rows.filter((candidate) => candidate.cellLevel !== true)) {
      if (row.rowClass !== "placeholder" && row.rowClass !== "annotation") continue;
      // A reserved position and a tick on a row without a name are kept, and a person says what they mean.
      this.#builder.item(
        items.annotationReview({
          subject: `${this.#source}/${row.rowKey}`,
          entityRefs: [table(tableId)],
          claims: [this.#claim(row, row.rowClass, true)],
        }),
      );
    }
    await this.#sheetItems(columns, contributors);
    await this.#crossFileItems(contributors);
    this.#terms.documents(this.#builder);
    return this.#builder.build();
  }
}

const SUMMARY =
  "Contributor sheets: the contributors of a manuscript with their CRediT roles, and their addresses in restricted documents.";
const INPUT = "the Excel export of one contributor sheet";

/** The importer of one registered contributor sheet. */
function importerOf(name: string, registration: PrivateContributorSheet): ImporterDefinition {
  const sheet: RegisteredSheet = {
    sourceKey: contributorSheetSourceKey(registration.externalId),
    tableId: contributorTableId(registration.externalId),
    registration,
  };
  return {
    key: IMPORTER_KEY,
    sourceKey: sheet.sourceKey,
    summary: SUMMARY,
    inputDescription: INPUT,
    source: {
      key: sheet.sourceKey,
      title: `Contributor sheet of ${registration.replicationId} (${name})`.slice(0, LIMITS.shortText),
      kind: "googleSheet",
      authority: "live",
      syncPolicy: "repeatable",
      accessStatus: "public",
    },
    location: {
      externalId: registration.externalId,
      ...(registration.url === undefined ? {} : { url: registration.url }),
      ...(registration.exportUrl === undefined ? {} : { exportUrl: registration.exportUrl }),
    },
    read: async (input, context) => readSheet(input, context),
    plan: (context) => new SheetPlan(sheet, context).run(),
  };
}

/** Binds the importer to the sheet that the operator names. A sheet that is not registered is refused. */
function select(selection: SourceSelection): ImporterDefinition {
  const sheets = selection.config.contributorSheets ?? {};
  const names = Object.keys(sheets).sort();
  if (selection.selector === undefined) {
    throw new ToolRefusal(
      "Refusing to run: name the contributor sheet with --sheet. " +
        (names.length === 0
          ? "The private configuration registers no contributor sheet."
          : `The private configuration registers: ${names.join(", ")}.`),
    );
  }
  const registration = sheets[selection.selector];
  if (registration === undefined) {
    throw new ToolRefusal(
      `Refusing to run: the private configuration registers no contributor sheet "${selection.selector}". ` +
        "A sheet is imported only if its file identifier and its replication are registered there.",
    );
  }
  return importerOf(selection.selector, registration);
}

const unbound = (): never => {
  throw new ToolRefusal("Refusing to run: name the contributor sheet with --sheet.");
};

export const importer: ImporterDefinition = {
  key: IMPORTER_KEY,
  sourceKey: FAMILY_KEY,
  summary: SUMMARY,
  inputDescription: INPUT,
  select,
  read: unbound,
  plan: unbound,
};
