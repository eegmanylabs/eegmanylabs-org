// The plan of a recruitment and contact workbook (docs/MIGRATION_PLAN.md, section 4.6): what the
// rows that recruitment-workbook.ts has read become.
//
// | Rows                              | Become                                                                 |
// |-----------------------------------|------------------------------------------------------------------------|
// | Study rows of the counts tab      | Historical aggregates beneath one replication, one for each number     |
// | Lead cells, old leads, lead lines | Lead claims: a membership that needs review where the address names a known person, otherwise candidates of an item |
// | Contact rows of an outreach tab   | Restricted outreach contacts, one for each row                         |
// | Everything else                   | Source records, and an item where a person has to decide               |
//
// Nothing is decided between two values here. The numbers carry no date, so an aggregate has no
// snapshot date. A blank number is absent and an explicit zero is zero. The counts of the main
// experiment and of the resting state are two metrics and are never added. A row that names two
// studies gives its numbers, its lead and its address to neither.
import {
  COLLECTIONS,
  type EntityRef,
  historicalAggregateId,
  keyedShortHash,
  LIMITS,
  lookupFold,
  outreachContactId,
  outreachGroupKey,
  personEmailIndexId,
  replicationMembershipId,
  studyAliasId,
  unitScopeKeys,
} from "@eegml/shared";
import { readDocuments } from "./context";
import { personEvidence } from "./identity";
import type { DocumentSpec, ImportPlan, PlanContext, PlannedItem, RawCell, RecordedRow } from "./model";
import { PlanBuilder } from "./plan";
import type { ItemClaim } from "./reconcile";
import { aliasDocuments, VocabularyCollector } from "./records";
import {
  cellPart,
  doiIn,
  type FillBucket,
  fillBucket,
  isPlainColumnAggregate,
  linksIn,
  nameChecks,
  peopleIn,
  proposeResult,
  RESULT_STATUS_MAX_LENGTH,
  readAddress,
  readOutreachDate,
  recomputeAggregate,
  rowFillBucket,
  storedValue,
  textOf,
} from "./recruitment-values";
import {
  COUNT_HEADERS,
  type DetectedTabKind,
  LEAD_HEADERS,
  OUTREACH_HEADERS,
  OUTREACH_ROW_PREFIX,
  PREAMBLE_PREFIXES,
  type RecruitmentTabKind,
  TAB_RECORD_KEY,
} from "./recruitment-workbook";
import { canonicalJson } from "./values";
import { columnNumber, parseRef } from "./workbook";

/** One tab that the workbook is expected to hold, as a reviewer has confirmed it. */
export interface ReviewedTab {
  /** The title exactly as the workbook writes it. A title is a label and is never resolved by its spelling. */
  readonly title: string;
  readonly kind: RecruitmentTabKind;
  /** The study of an outreach tab, or null while no reviewer has confirmed one. */
  readonly studyId?: string | null;
}

export interface RecruitmentWorkbookDefinition {
  /** The key of the source in the registry. It is part of every identifier, so two workbooks of this layout stay apart. */
  readonly sourceKey: string;
  /** The reviewed table of tabs. The workbook must hold exactly these. */
  readonly tabs: readonly ReviewedTab[];
}

/** The five numbers of a study row, by the key of the metric that each feeds. Each is a metric of its own. */
const METRICS = ["nLabsSigned", "totalNToBeRun", "nLabsFinished", "totalNMainCollected", "totalNRest"] as const;
type Metric = (typeof METRICS)[number];

/** The reason for which a data row is kept as a source record only, where nothing else accounts for it. */
const RAW_ONLY_REASON: Readonly<Record<DetectedTabKind, string>> = {
  // A study row without a number, which nothing else speaks of.
  counts: "noFigures",
  // A lead claim whose person is not known yet. The name and the address stay in the source record.
  leads: "leadClaim",
  outreach: "tabBlocked",
  unknown: "tabBlocked",
};

/** A note that is longer than this, or that holds a line break, may quote correspondence and waits for a reviewer. */
const NOTE_REVIEW_LENGTH = 200;
const MAX_LINKS = 50;

/** The suffixes that a tab title is known to add to a study identifier, for a proposal about a new tab. */
const TITLE_SUFFIX = /^(?:| lead|_labs|_| replicating labs(?: s(?:e(?:a(?:r(?:c(?:h)?)?)?)?)?)?)$/;

interface TabView {
  readonly tabKey: string;
  readonly title: string;
  readonly kind: DetectedTabKind;
  readonly date1904: boolean;
  /** The record that describes the tab itself. */
  readonly record: RecordedRow;
  readonly rows: readonly RecordedRow[];
  /** The source of a claim from this tab, as an item names it. */
  readonly source: string;
}

interface Named {
  readonly name: string;
  readonly folded: string;
}

/** What a summary tab says about the lead of one study. */
interface LeadCell {
  readonly tab: TabView;
  readonly row: RecordedRow;
  readonly leaders: readonly Named[];
  readonly former: readonly Named[];
}

/** One study as the two summary tabs see it, by the key of its row. */
interface StudyView {
  readonly key: string;
  /** The one replication of the row, or null for a row that names two studies or none that is known. */
  replicationId: string | null;
  refs: readonly EntityRef[];
  counts?: LeadCell & { readonly struck: boolean; readonly leaderStruck: boolean };
  leads?: LeadCell;
}

type Purpose = "leadSearch" | "labSearch" | "unknown";

interface ContactView {
  readonly tab: TabView;
  readonly row: RecordedRow;
  readonly replicationId: string;
  readonly groupKey: string;
  readonly purpose: Purpose;
  /** A keyed hash of the six cells of the row, by which two copies are compared. */
  readonly content: string;
  /** Whether the row holds a date or a result, which describe one search and no other. */
  readonly hasOutcome: boolean;
}

const replication = (studyId: string): EntityRef => ({ entityType: "replication", entityId: studyId });
const person = (personId: string): EntityRef => ({ entityType: "person", entityId: personId });

/** The names of a lead cell: its parts between commas. Each part is one claim. */
function namesIn(cell: string | null): Named[] {
  return (cell ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((name) => ({ name, folded: lookupFold(name) }));
}

const sameNames = (a: readonly Named[], b: readonly Named[]): boolean =>
  canonicalJson(a.map((entry) => entry.folded).sort()) === canonicalJson(b.map((entry) => entry.folded).sort());

/** A text as a verbatim field stores it, or undefined for no text and for one that is too long for the field. */
const verbatim = (text: string | null): string | undefined =>
  text !== null && text.length <= LIMITS.longText ? text : undefined;

class RecruitmentPlan {
  readonly #definition: RecruitmentWorkbookDefinition;
  readonly #context: PlanContext;
  readonly #builder = new PlanBuilder();
  readonly #vocabulary = new VocabularyCollector();
  readonly #tabs: TabView[] = [];
  /** The source records that a document, an item or a reason accounts for. */
  readonly #accounted = new Set<string>();
  /** The replications that exist, each with the DOI of its original study in lower case. */
  readonly #replications = new Map<string, string | null>();
  readonly #studies = new Map<string, StudyView>();
  /** Identifiers that resolve to no study, by their lookup fold, with the cells that hold them. */
  readonly #unresolved = new Map<string, { readonly claims: ItemClaim[]; readonly held: string[] }>();
  /** Spellings in an identifier column that differ from the identifier of the study they resolve to. */
  readonly #spellings = new Map<
    string,
    { readonly replicationId: string; readonly spelling: string; readonly claims: ItemClaim[] }
  >();
  readonly #contacts: ContactView[] = [];
  /** Results that the importer cannot read as a status, by their trimmed and case-folded text. */
  readonly #unreadResults = new Map<string, { readonly label: string; readonly row: RecordedRow }>();
  readonly #leadLines: {
    readonly tab: TabView;
    readonly row: RecordedRow;
    readonly lead: Named;
    readonly replicationId: string | null;
  }[] = [];
  /** Tabs of which nothing is imported, because a check of the tab itself has failed. */
  readonly #blockedTabs = new Set<string>();
  /** The addresses that this plan adds to the contact document of a person, each as person and address. */
  readonly #statedAddresses = new Set<string>();

  constructor(definition: RecruitmentWorkbookDefinition, context: PlanContext) {
    this.#definition = definition;
    this.#context = context;
    for (const [tabKey, rows] of context.rows) {
      const record = rows.find((row) => row.rowKey === TAB_RECORD_KEY);
      if (record === undefined) continue;
      const [cell] = record.cells;
      const kind = cellPart(cell, "kind");
      this.#tabs.push({
        tabKey,
        title: String(storedValue(cell) ?? ""),
        kind: kind === "counts" || kind === "leads" || kind === "outreach" ? kind : "unknown",
        date1904: cellPart(cell, "date1904") === true,
        record,
        rows: rows.filter((row) => row !== record),
        source: `${definition.sourceKey}/${tabKey}`,
      });
    }
  }

  #document(spec: DocumentSpec): void {
    for (const id of spec.sourceRecordIds) this.#accounted.add(id);
    this.#builder.document(spec);
  }

  #item(item: PlannedItem): void {
    for (const candidate of item.candidates) {
      if (candidate.sourceRecordId !== undefined) this.#accounted.add(candidate.sourceRecordId);
    }
    this.#builder.item(item);
  }

  #hold(recordId: string, item: PlannedItem): void {
    this.#accounted.add(recordId);
    this.#builder.hold(recordId, item);
  }

  #cell(row: RecordedRow, label: string | undefined): RawCell | undefined {
    return label === undefined ? undefined : row.cells[row.labels.indexOf(label)];
  }

  /** The column of each header of a summary tab, by the text of the header. Columns are never located by letter. */
  #columns(tab: TabView): Map<string, string> {
    const header = tab.rows.find((row) => row.rowClass === "header");
    const columns = new Map<string, string>();
    if (header === undefined) return columns;
    for (const label of header.labels) {
      const text = textOf(this.#cell(header, label))?.trim() ?? "";
      if (text !== "") columns.set(text, label);
    }
    return columns;
  }

  /** The subject of an item about one study: the replication, or the folded identifier cell where the row names none. */
  #subject(view: StudyView): string {
    return view.replicationId ?? `${this.#definition.sourceKey}/study/${view.key}`;
  }

  #study(key: string): StudyView {
    let view = this.#studies.get(key);
    if (view === undefined) {
      view = { key, replicationId: null, refs: [] };
      this.#studies.set(key, view);
    }
    return view;
  }

  async run(): Promise<ImportPlan> {
    const { db } = this.#context;
    const stored = await db.collection(COLLECTIONS.replications.collectionPath()).select("originalDoi").get();
    for (const doc of stored.docs) {
      const doi = doc.get("originalDoi") as unknown;
      this.#replications.set(doc.id, typeof doi === "string" ? doi.trim().toLowerCase() : null);
    }
    if (this.#tabSetIsBlocked()) return this.#builder.build();

    const expected = new Map(this.#definition.tabs.map((tab) => [tab.title, tab]));
    const usable: TabView[] = [];
    for (const tab of this.#tabs) {
      const wanted = expected.get(tab.title)?.kind;
      if (wanted === tab.kind) {
        usable.push(tab);
        continue;
      }
      // The tab does not have the headers of its kind. It is kept raw, and nothing else is blocked by it.
      this.#item(
        this.#context.items.structureChange({
          subject: `${tab.source}/layout`,
          claims: [
            { source: "expected", value: wanted ?? "", valueSource: wanted ?? "" },
            { source: "found", value: tab.kind, valueSource: tab.kind, sourceRecordId: tab.record.recordId },
          ],
        }),
      );
    }
    for (const tab of usable.filter((candidate) => candidate.kind === "counts")) await this.#counts(tab);
    for (const tab of usable.filter((candidate) => candidate.kind === "leads")) await this.#leads(tab);
    for (const tab of usable.filter((candidate) => candidate.kind === "outreach")) {
      await this.#outreach(tab, expected.get(tab.title)?.studyId ?? null);
    }
    await this.#leadItems();
    this.#identifierItems();
    this.#copyItems();
    this.#resultItems();
    this.#vocabulary.documents(this.#builder);

    // Every data row is accounted for. One that nothing names is kept raw, for a stated reason.
    for (const tab of this.#tabs) {
      const reason =
        usable.includes(tab) && !this.#blockedTabs.has(tab.tabKey) ? RAW_ONLY_REASON[tab.kind] : "tabBlocked";
      for (const row of tab.rows) {
        if (row.rowClass === "data" && !this.#accounted.has(row.recordId)) this.#builder.rawOnly(row.recordId, reason);
      }
    }
    return this.#builder.build();
  }

  /** Checks that the workbook holds exactly the reviewed tabs. A missing, renamed or new tab stops the whole import. */
  #tabSetIsBlocked(): boolean {
    const { items } = this.#context;
    const expected = new Set(this.#definition.tabs.map((tab) => tab.title));
    const found = new Set(this.#tabs.map((tab) => tab.title));
    const missing = [...expected].filter((title) => !found.has(title)).sort();
    const added = this.#tabs.filter((tab) => !expected.has(tab.title));
    if (missing.length === 0 && added.length === 0) return false;
    const claims: ItemClaim[] = [
      ...missing.map((title) => ({ source: "expected", value: title, valueSource: title })),
      ...added.map((tab) => ({
        source: "found",
        value: tab.title,
        valueSource: tab.title.slice(0, LIMITS.shortText),
        sourceRecordId: tab.record.recordId,
      })),
    ];
    for (const tab of added) {
      // A title that is a study identifier with a known suffix is proposed, once the DOI of the study line confirms it.
      const line = tab.rows.find((row) => row.rowKey === "preamble__study");
      const doi = line === undefined ? null : doiIn(textOf(line.cells[0]), this.#link(line.cells[0]));
      for (const [studyId, studyDoi] of this.#replications) {
        const start = tab.title.normalize("NFC").slice(0, studyId.length);
        const rest = tab.title.normalize("NFC").slice(studyId.length);
        if (lookupFold(start) !== lookupFold(studyId) || !TITLE_SUFFIX.test(rest)) continue;
        if (doi === null || studyDoi === null || doi !== studyDoi) continue;
        claims.push({
          source: `proposal/${tab.tabKey}`,
          value: studyId,
          valueSource: studyId,
          sourceRecordId: tab.record.recordId,
        });
      }
    }
    this.#builder.block(
      "tabs",
      `The workbook does not hold exactly the reviewed tabs: ${missing.length} are missing and ${added.length} are new or renamed.`,
      items.structureChange({ subject: `${this.#definition.sourceKey}/tabs`, claims, blocking: true }),
    );
    return true;
  }

  #link(cell: RawCell | undefined): string | null {
    const link = cellPart(cell, "l");
    return typeof link === "string" ? link : null;
  }

  /**
   * Resolves the identifier cell of a study row. A cell that names several studies stays
   * combined, and a part that resolves to nothing is noted for the item about that identifier.
   */
  async #resolveStudy(
    view: StudyView,
    tab: TabView,
    row: RecordedRow,
    cell: string,
  ): Promise<"resolved" | "combined" | "unresolved"> {
    const { studies } = this.#context;
    const claim = (value: string): ItemClaim => ({
      source: `${tab.source}/${COUNT_HEADERS.study}`,
      value,
      valueSource: value.slice(0, LIMITS.shortText),
      sourceRecordId: row.recordId,
    });
    const note = (raw: string, held: boolean) => {
      const folded = lookupFold(raw) || `raw-${keyedShortHash(raw, this.#context.secret)}`;
      const entry = this.#unresolved.get(folded) ?? { claims: [], held: [] };
      entry.claims.push(claim(raw.trim()));
      if (held) entry.held.push(row.recordId);
      this.#unresolved.set(folded, entry);
    };
    const resolution = await studies.resolve(cell);
    if (resolution.status === "resolved") {
      view.replicationId = resolution.replicationId;
      view.refs = [replication(resolution.replicationId)];
      if (cell.trim() !== resolution.replicationId) {
        // A spelling of its own in an identifier column is an alias, which a person confirms.
        aliasDocuments(this.#builder, studies, {
          replicationId: resolution.replicationId,
          scheme: "programme",
          alias: cell.trim(),
          recordId: row.recordId,
        });
        // One spelling is one question, whichever tabs hold it.
        const key = `${resolution.replicationId}\n${cell.trim()}`;
        const entry = this.#spellings.get(key) ?? {
          replicationId: resolution.replicationId,
          spelling: cell.trim(),
          claims: [],
        };
        entry.claims.push(claim(cell.trim()));
        this.#spellings.set(key, entry);
        this.#accounted.add(row.recordId);
      }
      return "resolved";
    }
    if (resolution.status === "combined") {
      const resolved = resolution.parts.flatMap((part) =>
        part.resolution.status === "resolved" ? [part.resolution.replicationId] : [],
      );
      view.refs = [...new Set(resolved)].sort().map(replication);
      for (const part of resolution.parts) if (part.resolution.status !== "resolved") note(part.raw, false);
      return "combined";
    }
    if (resolution.status === "ambiguous") view.refs = resolution.replicationIds.map(replication);
    note(cell, true);
    return "unresolved";
  }

  async #counts(tab: TabView): Promise<void> {
    const { items } = this.#context;
    const columns = this.#columns(tab);
    const data = tab.rows.filter((row) => row.rowClass === "data");
    const current = new Set(data.map((row) => row.recordId));
    for (const row of data) {
      const studyCell = this.#cell(row, columns.get(COUNT_HEADERS.study));
      const leaderCell = this.#cell(row, columns.get(COUNT_HEADERS.leader));
      const view = this.#study(row.rowKey);
      const status = await this.#resolveStudy(view, tab, row, textOf(studyCell) ?? "");
      const struck = cellPart(studyCell, "strike") === true;
      view.counts = {
        tab,
        row,
        leaders: namesIn(textOf(leaderCell)),
        former: [],
        struck,
        leaderStruck: cellPart(leaderCell, "strike") === true,
      };
      const subject = this.#subject(view);
      const numbers = new Map<Metric, { readonly value: number; readonly raw: string }>();
      const figures: ItemClaim[] = [];
      for (const metric of METRICS) {
        const cell = this.#cell(row, columns.get(COUNT_HEADERS[metric]));
        const value = storedValue(cell);
        // A blank cell is absent. It is never read as zero, and nothing is written for it.
        if (value === null || (typeof value === "string" && value.trim() === "")) continue;
        const raw = textOf(cell) ?? "";
        const claim = {
          source: `${tab.source}/${metric}`,
          value: raw,
          valueSource: raw.slice(0, LIMITS.shortText),
          sourceRecordId: row.recordId,
        };
        const whole =
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 0 &&
          cellPart(cell, "f") === null &&
          cellPart(cell, "z") === null;
        if (!whole) {
          // Text, a fraction, a negative number or a formula is no count that the importer may read.
          this.#item(items.unparsedValue({ subject, field: metric, entityRefs: view.refs, claims: [claim] }));
          continue;
        }
        numbers.set(metric, { value, raw });
        figures.push(claim);
      }
      if (status === "resolved" && view.replicationId !== null) {
        for (const [metric, { value, raw }] of numbers) {
          this.#document({
            collection: "historicalAggregates",
            ids: [historicalAggregateId(metric, row.recordId)],
            fixed: {
              replicationIds: [view.replicationId],
              metricKey: metric,
              valueSource: raw,
              valueNumeric: value,
              sourceRecordId: row.recordId,
              dataOrigin: "importedHistorical",
            },
            owned: { isCurrent: true },
            sourceRecordIds: [row.recordId],
          });
        }
      } else if (status === "combined") {
        // The numbers of a row that names two studies are written beneath neither. They wait with the row.
        this.#hold(
          row.recordId,
          items.unmatchedIdentifier({
            subject: `${tab.source}/${row.rowKey}`,
            entityRefs: view.refs,
            claims: [
              {
                source: `${tab.source}/${COUNT_HEADERS.study}`,
                value: textOf(studyCell) ?? "",
                valueSource: (textOf(studyCell) ?? "").slice(0, LIMITS.shortText),
                sourceRecordId: row.recordId,
              },
              ...figures,
            ],
          }),
        );
      }

      const signed = numbers.get("nLabsSigned");
      const finished = numbers.get("nLabsFinished");
      const main = numbers.get("totalNMainCollected");
      const rest = numbers.get("totalNRest");
      const pair = (field: Metric, first: Metric, second: Metric) =>
        this.#item(
          items.valueConflict({
            subject,
            field,
            entityRefs: view.refs,
            claims: [first, second].map((metric) => ({
              source: `${tab.source}/${metric}`,
              value: numbers.get(metric)?.raw ?? "",
              valueSource: numbers.get(metric)?.raw ?? "",
              sourceRecordId: row.recordId,
            })),
          }),
        );
      if (signed !== undefined && finished !== undefined && finished.value > signed.value) {
        pair("nLabsFinished", "nLabsSigned", "nLabsFinished");
      }
      if (main !== undefined && rest !== undefined && rest.value > main.value) {
        pair("totalNRest", "totalNMainCollected", "totalNRest");
      }
      if (main !== undefined && rest === undefined && !numbers.has("totalNRest")) {
        // A blank beside a count of the main experiment is unknown or not applicable. It is not zero.
        this.#item(
          items.unparsedValue({
            subject,
            field: "totalNRest",
            entityRefs: view.refs,
            claims: [{ source: `${tab.source}/totalNRest/blank`, value: "blank", sourceRecordId: row.recordId }],
          }),
        );
      }
      const planned = numbers.has("nLabsSigned") || numbers.has("totalNToBeRun");
      if (struck === planned) {
        // The struck rows are the rows without sign-up numbers. A row that departs from that is a signal of its own.
        this.#item(
          items.formattingSignal({
            subject,
            field: "strike",
            entityRefs: view.refs,
            claims: [
              { source: `${tab.source}/strike`, value: String(struck), sourceRecordId: row.recordId },
              { source: `${tab.source}/signUpNumbers`, value: String(planned), sourceRecordId: row.recordId },
            ],
          }),
        );
      }
    }
    await this.#retireEarlierAggregates(current);
    this.#derivedRows(tab);

    // Cells under no header: a timeline and notes that belong to the programme and to no study.
    const side = new Map<string, RecordedRow>();
    for (const row of tab.rows.filter((candidate) => candidate.cellLevel === true)) {
      const [label = ""] = row.labels;
      const first = side.get(label);
      if (first === undefined || row.rowNumber < first.rowNumber) side.set(label, row);
    }
    for (const [label, first] of side) {
      // Such a cell may name a person. The block stays in the source records until a reviewer has read it.
      this.#item(
        items.privacyReview({
          subject: `${tab.source}/side/${label}`,
          claims: [{ source: `${tab.source}/side`, value: label, sourceRecordId: first.recordId }],
        }),
      );
    }
    for (const row of tab.rows.filter(
      (candidate) => candidate.rowClass === "annotation" && candidate.cellLevel !== true,
    )) {
      this.#annotation(tab, row, "below");
    }
  }

  /**
   * A changed row adds new figures, and the earlier ones stay. They are marked as no longer
   * current here, which is the one field of an aggregate that an import ever changes.
   */
  async #retireEarlierAggregates(current: ReadonlySet<string>): Promise<void> {
    const { db } = this.#context;
    const aggregates = await db.collection(COLLECTIONS.historicalAggregates.collectionPath()).get();
    const earlier = aggregates.docs.filter((doc) => !current.has(String(doc.get("sourceRecordId"))));
    const records = await readDocuments(
      db,
      earlier.map((doc) => COLLECTIONS.sourceRecords.docPath(String(doc.get("sourceRecordId")))),
    );
    for (const doc of earlier) {
      const recordId = String(doc.get("sourceRecordId"));
      const record = records.get(COLLECTIONS.sourceRecords.docPath(recordId))?.data;
      // Only a figure of this source whose row has a later revision gives way. A row that has gone keeps its figures.
      // The figure is stated on every run, so that it still counts as something the source stands behind.
      if (record?.sourceKey !== this.#definition.sourceKey || (record.supersededById ?? null) === null) continue;
      this.#document({
        collection: "historicalAggregates",
        ids: [doc.id],
        owned: { isCurrent: false },
        sourceRecordIds: [recordId],
      });
    }
  }

  /** Recomputes the totals below the study rows and reports a difference. Nothing of such a row is imported. */
  #derivedRows(tab: TabView): void {
    const { items } = this.#context;
    const numberAt = (rowNumber: number, column: number): number | null => {
      const row = tab.rows.find((candidate) => candidate.rowNumber === rowNumber && candidate.cellLevel !== true);
      const cell = row?.cells.find((_cell, index) => columnNumber(row.labels[index] ?? "A") === column);
      const value = storedValue(cell);
      return typeof value === "number" ? value : null;
    };
    for (const row of tab.rows.filter((candidate) => candidate.rowClass === "derived")) {
      for (const [index, cell] of row.cells.entries()) {
        const formula = cellPart(cell, "f");
        if (typeof formula !== "string") continue;
        const field = row.labels[index] ?? "";
        const cached = storedValue(cell);
        const report = (check: string, values: readonly [string, string][]) =>
          this.#item(
            items.annotationReview({
              subject: `${tab.source}/${row.rowKey}`,
              field,
              claims: values.map(([part, value]) => ({
                source: `${tab.source}/derived/${check}/${part}`,
                value,
                valueSource: value.slice(0, LIMITS.shortText),
                sourceRecordId: row.recordId,
              })),
            }),
          );
        const recomputed = recomputeAggregate(formula, numberAt);
        if (recomputed === null) report("unchecked", [["formula", formula]]);
        else if (typeof cached !== "number" || Math.abs(recomputed - cached) > 1e-9) {
          report("stale", [
            ["cached", String(cached)],
            ["recomputed", String(recomputed)],
          ]);
        }
        // A total that is put together by hand, from single cells or from two columns, is no figure of the tab.
        if (recomputed !== null && !isPlainColumnAggregate(formula)) report("handBuilt", [["formula", formula]]);
      }
    }
  }

  /** Sends a row that is no data row to review. Its content stays in its source record. */
  #annotation(tab: TabView, row: RecordedRow, kind: string, privacy = false, others: readonly ItemClaim[] = []): void {
    const { items } = this.#context;
    const input = {
      subject: `${tab.source}/${row.rowKey}`,
      personal: true,
      claims: [{ source: `${tab.source}/${kind}`, value: row.rawHash, sourceRecordId: row.recordId }, ...others],
    };
    this.#item(privacy ? items.privacyReview(input) : items.annotationReview(input));
  }

  async #leads(tab: TabView): Promise<void> {
    const { items, identities } = this.#context;
    const columns = this.#columns(tab);
    const headed = new Set(columns.values());
    for (const row of tab.rows.filter((candidate) => candidate.rowClass === "annotation")) {
      this.#annotation(tab, row, "row");
    }
    for (const row of tab.rows.filter((candidate) => candidate.rowClass === "data")) {
      const view = this.#study(row.rowKey);
      const studyCell = textOf(this.#cell(row, columns.get(LEAD_HEADERS.study))) ?? "";
      const status = await this.#resolveStudy(view, tab, row, studyCell);
      const leaders = namesIn(textOf(this.#cell(row, columns.get(LEAD_HEADERS.leader))));
      const former = namesIn(textOf(this.#cell(row, columns.get(LEAD_HEADERS.oldLeader))));
      view.leads = { tab, row, leaders, former };
      const subject = this.#subject(view);
      if (status === "combined") {
        this.#hold(
          row.recordId,
          items.unmatchedIdentifier({
            subject: `${tab.source}/${row.rowKey}`,
            entityRefs: view.refs,
            claims: [
              {
                source: `${tab.source}/${LEAD_HEADERS.study}`,
                value: studyCell,
                valueSource: studyCell.slice(0, LIMITS.shortText),
                sourceRecordId: row.recordId,
              },
            ],
          }),
        );
      }

      const address = readAddress(textOf(this.#cell(row, columns.get(LEAD_HEADERS.email))));
      // A value beside the address column, under no header, is an additional address.
      const additional = row.labels
        .filter((label) => !headed.has(label))
        .map((label) => textOf(this.#cell(row, label)))
        .filter((text): text is string => text !== null && text.trim() !== "");
      if (address.status === "reversed" || address.status === "invalid") {
        this.#item(
          items.identifierDefect({
            subject,
            field: "email",
            entityRefs: view.refs,
            claims: [
              address.status === "reversed"
                ? {
                    source: `${tab.source}/email/reversed`,
                    value: address.decoded,
                    valueSource: address.decoded,
                    sourceRecordId: row.recordId,
                  }
                : { source: `${tab.source}/email/invalid`, value: row.rawHash, sourceRecordId: row.recordId },
            ],
          }),
        );
      }
      if (leaders.length > 1 || additional.length > 0) {
        // Two names in one cell are two claims, and both are candidates. Which address belongs to whom is a suggestion.
        this.#item(
          items.candidateLink({
            subject,
            field: "coLead",
            entityRefs: view.refs,
            claims: [
              ...leaders.map((leader, index) => ({
                source: `${tab.source}/leader/${index + 1}`,
                value: leader.folded,
                valueSource: leader.name,
                sourceRecordId: row.recordId,
              })),
              ...additional.map((text, index) => ({
                source: `${tab.source}/additionalAddress/${index + 2}`,
                value: text.trim().toLowerCase(),
                sourceRecordId: row.recordId,
              })),
            ],
          }),
        );
      }

      // A lead is linked to a person only where one name stands beside one address that already names that person.
      const [only] = leaders;
      if (status !== "resolved" || view.replicationId === null || only === undefined || leaders.length !== 1) continue;
      if (address.status !== "valid" || additional.length > 0) continue;
      const evidence = personEvidence.email(address.canonical);
      const resolution = evidence === null ? null : await identities.resolvePerson([evidence]);
      if (resolution?.status === "ambiguous") {
        this.#item(
          items.ambiguousEmail({
            subject,
            field: "email",
            entityRefs: [...view.refs, ...resolution.personIds.map(person)],
            claims: [{ source: `${tab.source}/email`, value: address.canonical, sourceRecordId: row.recordId }],
          }),
        );
      }
      if (resolution?.status !== "existing") continue;
      const { personId } = resolution;
      this.#document({
        collection: "replicationMemberships",
        ids: [view.replicationId, replicationMembershipId(personId, "lead")],
        fixed: { replicationId: view.replicationId, personId, role: "lead", earlierPeriods: [] },
        owned: { isCurrent: true, reviewStatus: "needsReview" },
        // What a reviewer or the website has said about the membership is a decision, which this claim never changes.
        silent: ["isCurrent", "reviewStatus"],
        sourceRecordIds: [row.recordId],
      });
      // The address goes to the restricted contact document of the person and to the index that no client reads.
      const contactPath = COLLECTIONS.personContact.docPath(personId);
      const contact = (await readDocuments(this.#context.db, [contactPath])).get(contactPath)?.data;
      // One address is one entry, whether the contact document holds it already or an earlier row of this plan adds it.
      const stated = `${personId}\n${address.canonical}`;
      const listed =
        this.#statedAddresses.has(stated) ||
        ((contact?.emails ?? []) as { email?: string }[]).some((entry) => entry.email === address.canonical);
      this.#statedAddresses.add(stated);
      this.#document({
        collection: "personContact",
        ids: [personId],
        ...(listed
          ? {}
          : {
              union: {
                emails: [
                  {
                    email: address.canonical,
                    kind: "secondary",
                    sourceRecordId: row.recordId,
                    verifiedAt: null,
                    claimEligible: true,
                  },
                ],
              },
            }),
        sourceRecordIds: [row.recordId],
      });
      this.#document({
        collection: "personEmailIndex",
        ids: [personEmailIndexId(address.canonical, this.#context.secret)],
        union: { personIds: [personId], claimEligiblePersonIds: [personId] },
        sourceRecordIds: [row.recordId],
      });
    }
  }

  /** The current leads that another source or a person has recorded for a replication, by name. */
  async #heldLeads(replicationId: string): Promise<{ readonly personId: string; readonly lead: Named }[]> {
    const { db } = this.#context;
    const memberships = await db.collection(COLLECTIONS.replicationMemberships.collectionPath(replicationId)).get();
    const current = memberships.docs.filter(
      (doc) => ["lead", "coLead"].includes(String(doc.get("role"))) && doc.get("isCurrent") === true,
    );
    const recordIds = current.flatMap((doc) => (doc.get("sourceRecordIds") as string[] | undefined) ?? []);
    const records = await readDocuments(
      db,
      recordIds.map((id) => COLLECTIONS.sourceRecords.docPath(id)),
    );
    const own = (id: string) =>
      records.get(COLLECTIONS.sourceRecords.docPath(id))?.data.sourceKey === this.#definition.sourceKey;
    // A membership that only this workbook stands behind is its own claim, and no second opinion.
    const others = current.filter((doc) => {
      const ids = (doc.get("sourceRecordIds") as string[] | undefined) ?? [];
      return ids.length === 0 || ids.some((id) => !own(id));
    });
    const people = await readDocuments(
      db,
      others.map((doc) => COLLECTIONS.persons.docPath(String(doc.get("personId")))),
    );
    return others.flatMap((doc) => {
      const personId = String(doc.get("personId"));
      const name = people.get(COLLECTIONS.persons.docPath(personId))?.data.displayName;
      return typeof name === "string" && name.trim() !== ""
        ? [{ personId, lead: { name, folded: lookupFold(name) } }]
        : [];
    });
  }

  /** Compares the lead claims of the workbook with one another and with the leads held already. */
  async #leadItems(): Promise<void> {
    const { items } = this.#context;
    const claimsOf = (cell: LeadCell, names: readonly Named[], part: string): ItemClaim[] =>
      names.map((entry) => ({
        source: `${cell.tab.source}/${part}`,
        value: entry.folded,
        valueSource: entry.name.slice(0, LIMITS.shortText),
        sourceRecordId: cell.row.recordId,
      }));
    /** A cell that names nobody is a claim as well, where the other tab names somebody. */
    const blank = (cell: LeadCell): ItemClaim[] =>
      cell.leaders.length > 0
        ? []
        : [{ source: `${cell.tab.source}/leader`, value: "", sourceRecordId: cell.row.recordId }];

    for (const view of [...this.#studies.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      const { counts, leads } = view;
      const subject = this.#subject(view);
      if (leads !== undefined && leads.former.length > 0) {
        // A former lead is recorded. Whether and when the lead changed is for a person to say.
        this.#item(
          items.conflictingLead({
            subject,
            field: "formerLead",
            entityRefs: view.refs,
            claims: [...claimsOf(leads, leads.former, "oldLeader"), ...claimsOf(leads, leads.leaders, "leader")],
          }),
        );
      }
      const stated = [counts, leads].filter((cell): cell is NonNullable<typeof cell> => cell !== undefined);
      const named = stated.flatMap((cell) => cell.leaders);
      const held = view.replicationId === null || named.length === 0 ? [] : await this.#heldLeads(view.replicationId);
      const differ = counts !== undefined && leads !== undefined && !sameNames(counts.leaders, leads.leaders);
      const further =
        held.length > 0 && named.some((entry) => !held.some((other) => other.lead.folded === entry.folded));
      if (differ || further) {
        this.#item(
          items.conflictingLead({
            subject,
            field: "lead",
            entityRefs: [...view.refs, ...(further ? held.map((entry) => person(entry.personId)) : [])],
            claims: [
              ...stated.flatMap((cell) => [...claimsOf(cell, cell.leaders, "leader"), ...blank(cell)]),
              ...(further
                ? held.map((entry) => ({ source: "held/lead", value: entry.lead.folded, valueSource: entry.lead.name }))
                : []),
            ],
          }),
        );
      }
      if (counts?.struck === true || counts?.leaderStruck === true) {
        // Strike-through changes no status. It asks what has become of the study, also where a lead is still listed.
        this.#item(
          items.statusQuestion({
            subject,
            field: "status",
            entityRefs: view.refs,
            claims: [
              ...(counts.struck
                ? [
                    {
                      source: `${counts.tab.source}/strike/study`,
                      value: "struck",
                      sourceRecordId: counts.row.recordId,
                    },
                  ]
                : []),
              ...(counts.leaderStruck
                ? [
                    {
                      source: `${counts.tab.source}/strike/leader`,
                      value: "struck",
                      sourceRecordId: counts.row.recordId,
                    },
                  ]
                : []),
              ...(leads !== undefined && leads.leaders.length > 0
                ? [{ source: `${leads.tab.source}/leader/listed`, value: "listed", sourceRecordId: leads.row.recordId }]
                : []),
            ],
          }),
        );
      }
    }

    // The lead line of an outreach tab against the current leads of its study.
    const rows = [...this.#studies.values()].flatMap((view) =>
      view.leads === undefined ? [] : [{ view, cell: view.leads }],
    );
    for (const line of this.#leadLines) {
      const own = rows.filter(({ view }) => line.replicationId !== null && view.replicationId === line.replicationId);
      // A tab without a study is compared with the current leads of every study.
      const compared = line.replicationId === null ? rows : own;
      if (compared.length === 0) continue;
      if (compared.some(({ cell }) => cell.leaders.some((entry) => entry.folded === line.lead.folded))) continue;
      const formerOf = rows.filter(({ cell }) => cell.former.some((entry) => entry.folded === line.lead.folded));
      this.#item(
        items.conflictingLead({
          subject: line.replicationId ?? `${line.tab.source}`,
          field: "leadLine",
          entityRefs: line.replicationId === null ? [] : [replication(line.replicationId)],
          claims: [
            {
              source: `${line.tab.source}/leadLine`,
              value: line.lead.folded,
              valueSource: line.lead.name.slice(0, LIMITS.shortText),
              sourceRecordId: line.row.recordId,
            },
            ...own.flatMap(({ cell }) => claimsOf(cell, cell.leaders, "leader")),
            ...formerOf.flatMap(({ cell }) => claimsOf(cell, cell.former, "oldLeader")),
          ],
        }),
      );
    }
  }

  /** One item for each identifier that resolves to no study, with every cell that holds it. */
  #identifierItems(): void {
    for (const [, entry] of [...this.#spellings].sort(([a], [b]) => (a < b ? -1 : 1))) {
      this.#item(
        this.#context.items.aliasConfirmation({
          subject: `${this.#definition.sourceKey}/identifier/${lookupFold(entry.spelling)}`,
          entityRefs: [replication(entry.replicationId)],
          claims: entry.claims,
        }),
      );
    }
    for (const [folded, entry] of [...this.#unresolved].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const item = this.#context.items.unmatchedIdentifier({
        subject: `${this.#definition.sourceKey}/identifier/${folded}`,
        claims: entry.claims,
      });
      this.#item(item);
      for (const recordId of entry.held) this.#hold(recordId, item);
    }
  }

  /** The study that a reviewer has stored for a tab title, as an alias of the scheme of tab titles. */
  async #storedTabStudy(title: string): Promise<string | null> {
    const aliasId = studyAliasId("sourceTab", title);
    const found = await readDocuments(
      this.#context.db,
      [...this.#replications.keys()].map((studyId) => COLLECTIONS.replicationAliases.docPath(studyId, aliasId)),
    );
    const holders = [...found].flatMap(([path, doc]) => (doc?.data.alias === title ? [path.split("/")[1] ?? ""] : []));
    return holders.length === 1 ? (holders[0] ?? null) : null;
  }

  async #outreach(tab: TabView, reviewedStudy: string | null): Promise<void> {
    const { items, studies } = this.#context;
    let purpose: Purpose = "unknown";
    let lead: { readonly row: RecordedRow; readonly lead: Named } | null = null;
    let studyLine: RecordedRow | null = null;
    for (const row of tab.rows.filter((candidate) => candidate.rowClass === "banner")) {
      const text = (textOf(row.cells[0]) ?? "").trim();
      const kind = row.rowKey.split("__")[1] ?? "other";
      if (kind === "lead") {
        const name = text.slice(PREAMBLE_PREFIXES.lead.length).trim();
        if (name !== "" && lead === null) lead = { row, lead: { name, folded: lookupFold(name) } };
      } else if (kind === "leadSearch" || kind === "labSearch") {
        if (purpose === "unknown") purpose = kind;
        // The title line is one of two fixed phrases. Anything after it is a remark that stays in the source record.
        this.#vocabulary.add("outreachPurpose", PREAMBLE_PREFIXES[kind], row.recordId);
      } else if (kind === "study") {
        studyLine ??= row;
      } else {
        this.#annotation(tab, row, "preamble");
      }
    }
    if (purpose === "unknown") {
      // Without a title line the title of the tab may say the purpose. The colour of the tab decides nothing.
      if (/replicating labs/i.test(tab.title)) purpose = "labSearch";
      else if (/ lead$/.test(tab.title)) purpose = "leadSearch";
      else {
        this.#item(
          items.annotationReview({
            subject: `${tab.source}/purpose`,
            claims: [{ source: `${tab.source}/purpose`, value: "unknown", sourceRecordId: tab.record.recordId }],
          }),
        );
      }
    }

    // The study comes from the reviewed table, or from a decision that a reviewer has stored since.
    const titleClaim: ItemClaim = {
      source: `${tab.source}/title`,
      value: tab.title,
      valueSource: tab.title.slice(0, LIMITS.shortText),
      sourceRecordId: tab.record.recordId,
    };
    const lineText = studyLine === null ? "" : (textOf(studyLine.cells[0]) ?? "").trim();
    const firstWord = /^[\p{L}\p{M}'’-]+/u.exec(lineText.slice(PREAMBLE_PREFIXES.study.length).trim())?.[0] ?? "";
    const lineClaims: ItemClaim[] =
      studyLine === null || firstWord === ""
        ? []
        : [
            {
              source: `${tab.source}/studyLine`,
              value: lookupFold(firstWord),
              valueSource: firstWord,
              sourceRecordId: studyLine.recordId,
            },
          ];
    const reviewed = reviewedStudy ?? (await this.#storedTabStudy(tab.title));
    let replicationId: string | null = null;
    let blocked = false;
    if (reviewed === null || !this.#replications.has(reviewed)) {
      this.#item(
        items.unmatchedIdentifier({
          subject: `${tab.source}/study`,
          claims: [
            titleClaim,
            ...lineClaims,
            ...(reviewed === null ? [] : [{ source: "reviewed", value: reviewed, valueSource: reviewed }]),
          ],
        }),
      );
    } else {
      replicationId = reviewed;
      const doi = studyLine === null ? null : doiIn(lineText, this.#link(studyLine.cells[0]));
      const known = this.#replications.get(reviewed) ?? null;
      if (doi !== null && known !== null && doi !== known && studyLine !== null) {
        // The study line names the paper of another study. The tab is not imported until a person has looked.
        blocked = true;
        this.#item(
          items.unmatchedIdentifier({
            subject: `${tab.source}/doi`,
            entityRefs: [replication(reviewed)],
            claims: [
              {
                source: `${tab.source}/studyLine/doi`,
                value: doi,
                valueSource: doi,
                sourceRecordId: studyLine.recordId,
              },
              { source: "replication/originalDoi", value: known, valueSource: known },
            ],
          }),
        );
      } else {
        aliasDocuments(this.#builder, studies, {
          replicationId,
          scheme: "sourceTab",
          alias: tab.title,
          recordId: tab.record.recordId,
        });
        this.#accounted.add(tab.record.recordId);
        if (lineClaims.length > 0 && !lookupFold(reviewed).startsWith(lookupFold(firstWord))) {
          // The study line begins with another name than the study of the tab.
          this.#item(
            items.aliasConfirmation({
              subject: `${tab.source}/studyLine`,
              entityRefs: [replication(reviewed)],
              claims: [titleClaim, ...lineClaims],
            }),
          );
        }
      }
    }
    if (blocked) {
      this.#blockedTabs.add(tab.tabKey);
      return;
    }
    if (lead !== null) this.#leadLines.push({ tab, ...lead, replicationId });

    for (const row of tab.rows.filter((candidate) => candidate.rowClass === "annotation")) {
      const kind = Object.values(OUTREACH_ROW_PREFIX).find((prefix) => row.rowKey.startsWith(`${prefix}__`)) ?? "row";
      this.#annotation(tab, row, kind, kind === OUTREACH_ROW_PREFIX.recipientList, this.#mergedWith(tab, row));
    }
    for (const row of tab.rows.filter((candidate) => candidate.rowClass === "data")) {
      await this.#contact(tab, row, replicationId, purpose);
    }
  }

  /**
   * The rows above whose merged cells reach down into a row. The value of a merged range belongs
   * to its upper row alone, so the lower row depends on that row, which an item names.
   */
  #mergedWith(tab: TabView, row: RecordedRow): ItemClaim[] {
    const anchors = new Set<number>();
    for (const cell of row.cells) {
      const range = cellPart(cell, "merge");
      if (typeof range !== "string") continue;
      const top = parseRef(range.split(":")[0] ?? "").row;
      if (top !== row.rowNumber) anchors.add(top);
    }
    return tab.rows
      .filter((other) => anchors.has(other.rowNumber) && other.cellLevel !== true)
      .map((other) => ({ source: `${tab.source}/mergedWith`, value: other.rowKey, sourceRecordId: other.recordId }));
  }

  async #contact(tab: TabView, row: RecordedRow, replicationId: string | null, purpose: Purpose): Promise<void> {
    const { items, identities, secret } = this.#context;
    const { sourceKey } = this.#definition;
    const [nameCell, emailCell, firstCell, followCell, resultCell, notesCell] = row.cells;
    const name = textOf(nameCell) ?? "";
    const contactId = outreachContactId(sourceKey, tab.tabKey, name, Number(row.rowKey.split("__").at(-1)), secret);
    const refs = replicationId === null ? [] : [replication(replicationId)];
    const base = { subject: contactId, entityRefs: refs, personal: true };
    const at = (part: string) => `${tab.source}/${part}`;
    const recordId = row.recordId;

    const above = this.#mergedWith(tab, row);
    if (above.length > 0) {
      // The date or the result of the row above covers this row too. Nothing of it is copied down.
      this.#item(
        items.annotationReview({
          ...base,
          field: "merged",
          claims: [{ source: at("merged"), value: row.rowKey, sourceRecordId: recordId }, ...above],
        }),
      );
    }

    const checks = nameChecks(name);
    if (checks.length > 0) {
      // The name is kept as written. What else the cell holds is a question, and the name stays out of the item.
      this.#item(
        items.unparsedValue({
          ...base,
          field: "contactName",
          claims: checks.map((check) => ({
            source: at(`contactName/${check}`),
            value: check === "semicolon" ? String(peopleIn(name).length) : check,
            sourceRecordId: recordId,
          })),
        }),
      );
    }

    const emailText = textOf(emailCell);
    const address = readAddress(emailText);
    let personId: string | undefined;
    if (address.status === "valid") {
      // An outreach row creates no person. It is linked only where the address already names one.
      const evidence = personEvidence.email(address.canonical);
      const resolution = evidence === null ? null : await identities.resolvePerson([evidence]);
      if (resolution?.status === "existing") personId = resolution.personId;
      if (resolution?.status === "ambiguous") {
        this.#item(
          items.ambiguousEmail({
            ...base,
            field: "contactEmail",
            entityRefs: [...refs, ...resolution.personIds.map(person)],
            claims: [{ source: at("contactEmail"), value: address.canonical, sourceRecordId: recordId }],
          }),
        );
      }
    } else if (address.status === "reversed") {
      // The decoded address is a candidate. It is used for nothing until a reviewer has confirmed it.
      this.#item(
        items.identifierDefect({
          ...base,
          field: "contactEmail",
          claims: [
            {
              source: at("contactEmail/reversed"),
              value: address.decoded,
              valueSource: address.decoded,
              sourceRecordId: recordId,
            },
          ],
        }),
      );
    } else if (address.status === "invalid") {
      this.#item(
        items.identifierDefect({
          ...base,
          field: "contactEmail",
          claims: [{ source: at("contactEmail/invalid"), value: emailText ?? "", sourceRecordId: recordId }],
        }),
      );
    }

    const first = readOutreachDate(firstCell, tab.date1904);
    const follow = readOutreachDate(followCell, tab.date1904);
    for (const [field, part, reading, cell] of [
      ["firstContactDate", "firstContact", first, firstCell],
      ["followUpDate", "followUp", follow, followCell],
    ] as const) {
      if (reading.status !== "ambiguous" && reading.status !== "unreadable") continue;
      // A date that can be read in two ways, or in none, stays absent beside the cell as written.
      this.#item(
        items.unparsedValue({
          ...base,
          field,
          claims: [{ source: at(`${part}/${reading.status}`), value: textOf(cell) ?? "", sourceRecordId: recordId }],
        }),
      );
    }
    const dated = (reading: typeof first) =>
      reading.status === "parsed" || reading.status === "ambiguous" ? reading.iso : null;
    const firstIso = dated(first);
    const followIso = dated(follow);
    if (followIso !== null && (firstIso === null || followIso < firstIso)) {
      this.#item(
        items.unparsedValue({
          ...base,
          field: "followUpOrder",
          claims: [
            { source: at("firstContact"), value: firstIso ?? "", sourceRecordId: recordId },
            { source: at("followUp"), value: followIso, sourceRecordId: recordId },
          ],
        }),
      );
    }

    const resultText = textOf(resultCell);
    const result = (resultText ?? "").trim();
    const proposal = proposeResult(result);
    if (result !== "" && proposal === null) {
      const folded = result.toLowerCase();
      if (!this.#unreadResults.has(folded)) this.#unreadResults.set(folded, { label: result, row });
    }
    const bucketOf = (index: number): FillBucket => {
      const cell = row.cells[index];
      // A cell that a merged range of a row above covers shows the fill of that row, which is no fill of its own.
      const range = cellPart(cell, "merge");
      const covered = typeof range === "string" && range.split(":")[0] !== `${row.labels[index]}${row.rowNumber}`;
      if (covered || cellPart(cell, "fillSource") === null) return "none";
      const colour = cellPart(cell, "fill");
      return typeof colour === "string" ? fillBucket(colour) : "other";
    };
    const fill = rowFillBucket(bucketOf(0), bucketOf(4));
    const signal = (check: string, value: string) =>
      this.#item(
        items.formattingSignal({
          ...base,
          field: "fill",
          claims: [{ source: at(`fill/${check}`), value, sourceRecordId: recordId }],
        }),
      );
    if (fill === "other") signal("other", `${cellPart(nameCell, "fillSource")}|${cellPart(resultCell, "fillSource")}`);
    else if (fill !== "none" && result === "") signal("withoutResult", fill);
    else if (
      (fill === "red" && proposal === "accepted") ||
      (fill === "green" && proposal !== null && proposal !== "accepted")
    ) {
      signal("contradicts", `${fill}:${proposal}`);
    }
    if (proposal === "accepted" || (fill === "green" && result === "")) {
      // An accepting reply creates no participation, no membership and no invitation. A reviewer may.
      this.#item(
        items.candidateLink({
          ...base,
          field: purpose === "leadSearch" ? "lead" : "participation",
          claims: [
            proposal === "accepted"
              ? { source: at("result"), value: result.toLowerCase(), valueSource: result, sourceRecordId: recordId }
              : { source: at("fill"), value: fill, valueSource: fill, sourceRecordId: recordId },
          ],
        }),
      );
    }

    const notesText = textOf(notesCell);
    const withheld = notesText !== null && (notesText.length > NOTE_REVIEW_LENGTH || /[\r\n]/.test(notesText));
    if (withheld) {
      // A long note, or one with line breaks, may quote correspondence. It reaches no entity until a reviewer decides.
      this.#item(
        items.privacyReview({
          ...base,
          field: "notes",
          claims: [{ source: at("notes"), value: notesText, sourceRecordId: recordId }],
        }),
      );
    }
    const found = withheld ? [] : linksIn(notesText, this.#link(notesCell));
    for (const [index, cell] of row.cells.slice(OUTREACH_HEADERS.length).entries()) {
      const text = textOf(cell);
      if (text === null && this.#link(cell) === null) continue;
      const label = row.labels[OUTREACH_HEADERS.length + index] ?? "";
      const extra = linksIn(text, this.#link(cell));
      const bare = extra.length === 1 && /^https?:\/\/\S+$/i.test((text ?? "").trim());
      // A cell beyond the last header is no field of the row. An address is kept as a link, and a remark waits.
      if (bare) found.push(...extra);
      const input = {
        ...base,
        field: `extra${label}`,
        claims: [{ source: at(`extra/${label}`), value: text ?? "", sourceRecordId: recordId }],
      };
      this.#item(bare ? items.annotationReview(input) : items.privacyReview(input));
    }
    const links: { urlSource: string; url: string }[] = [];
    for (const link of found) {
      const defect = link.url === null ? "malformed" : link.carriedSession ? "session" : null;
      if (defect !== null) {
        this.#item(
          items.linkDefect({
            ...base,
            field: "links",
            claims: [{ source: at(`link/${defect}`), value: link.url ?? link.urlSource, sourceRecordId: recordId }],
          }),
        );
      }
      if (link.url !== null && link.urlSource.length <= LIMITS.longText && links.length < MAX_LINKS) {
        links.push({ urlSource: link.urlSource, url: link.url });
      }
    }

    const groupKey = replicationId === null ? null : outreachGroupKey(replicationId, name, secret);
    if (replicationId !== null && groupKey !== null) {
      this.#contacts.push({
        tab,
        row,
        replicationId,
        groupKey,
        purpose,
        content: keyedShortHash(canonicalJson(row.cells.slice(0, OUTREACH_HEADERS.length).map(storedValue)), secret),
        hasOutcome: first.status !== "absent" || follow.status !== "absent" || result !== "",
      });
    }
    this.#document({
      collection: "outreachContacts",
      ids: [contactId],
      // Every field follows the row: a tab that is resolved later gives the contact its replication then.
      owned: {
        replicationId,
        scopeKeys: unitScopeKeys(replicationId, null),
        groupKey: groupKey ?? undefined,
        personId,
        contactNameSource: verbatim(name),
        contactEmail: verbatim(emailText),
        firstContactSource: verbatim(textOf(firstCell)),
        firstContactDate: first.status === "parsed" ? first.iso : undefined,
        followUpSource: verbatim(textOf(followCell)),
        followUpDate: follow.status === "parsed" ? follow.iso : undefined,
        resultSource: verbatim(resultText),
        notes: withheld ? undefined : verbatim(notesText),
        formatting: {
          struckThrough: cellPart(nameCell, "strike") === true,
          ...(fill === "none" ? {} : { fillColour: fill }),
        },
        links: links.length === 0 ? undefined : links,
        sourceRecordId: recordId,
      },
      sourceRecordIds: [recordId],
    });
  }

  /** Compares the copies of one contact across the tabs of one study. Nothing is merged. */
  #copyItems(): void {
    const { items } = this.#context;
    const groups = new Map<string, ContactView[]>();
    for (const contact of this.#contacts)
      groups.set(contact.groupKey, [...(groups.get(contact.groupKey) ?? []), contact]);
    for (const [groupKey, copies] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const [firstCopy] = copies;
      if (firstCopy === undefined || copies.length < 2) continue;
      const differ = new Set(copies.map((copy) => copy.content)).size > 1;
      const purposes = new Set(copies.map((copy) => copy.purpose));
      // A row with a date or a result describes one search. Its copy in a tab of the other purpose says so of that search too.
      const misplaced = !differ && purposes.has("leadSearch") && purposes.has("labSearch") && firstCopy.hasOutcome;
      if (!differ && !misplaced) continue;
      this.#item(
        items.valueConflict({
          subject: `${this.#definition.sourceKey}/group/${groupKey}`,
          field: differ ? "content" : "purpose",
          entityRefs: [replication(firstCopy.replicationId)],
          personal: true,
          claims: copies.map((copy) => ({
            source: differ ? copy.tab.source : `${copy.tab.source}/${copy.purpose}`,
            value: copy.content,
            sourceRecordId: copy.row.recordId,
          })),
        }),
      );
    }
  }

  /** One item for each distinct result that the importer cannot read as a status. */
  #resultItems(): void {
    const { sourceKey } = this.#definition;
    for (const [folded, { label, row }] of [...this.#unreadResults].sort(([a], [b]) => (a < b ? -1 : 1))) {
      this.#item(
        this.#context.items.vocabularyReview({
          subject: `${sourceKey}/outreachResult/${keyedShortHash(folded, this.#context.secret)}`,
          field: "result",
          personal: true,
          claims: [
            {
              source: `${sourceKey}/result`,
              value: folded,
              // A narrative about a person stays in the source record. A short status is shown to the reviewer.
              ...(label.length <= RESULT_STATUS_MAX_LENGTH ? { valueSource: label } : {}),
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
    }
  }
}

/** Plans a workbook that `readRecruitmentWorkbook` has read. */
export function planRecruitmentWorkbook(
  definition: RecruitmentWorkbookDefinition,
  context: PlanContext,
): Promise<ImportPlan> {
  return new RecruitmentPlan(definition, context).run();
}
