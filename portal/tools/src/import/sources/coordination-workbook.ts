// Source A: the historical replication coordination workbook (docs/MIGRATION_PLAN.md,
// section 4.9).
//
// THE LAYOUT OF THIS WORKBOOK IS UNVERIFIED. The workbook could not be opened when this
// importer was written. The project brief describes an Excel file about study leads, laboratory
// outreach and historical recruitment, and states the seven fields of its summary: `StudyID`,
// `Leader`, `NLabsSigned`, `TotalNSubjectsToBeRun`, `NLabsFinished`, `TotalNMainExpCollected`
// and `TotalNRest`. Those are the seven headers of the summary tab of the recruitment and
// contact workbook (source F), so this importer reads the workbook with the reader and the
// planner of that layout, under its own source key. Tab titles, further tabs and every value
// are unknown, so the importer checks the structure first and stops with a report where the
// workbook is not what the brief describes.
//
// | What the structure check finds                                      | What happens                              |
// |---------------------------------------------------------------------|-------------------------------------------|
// | One summary tab with the seven headers in row 1, each once, and no other headed column | The tab is imported      |
// | A tab with the layout of the leads tab or of an outreach tab        | The tab is imported as in source F        |
// | No summary tab, or more than one, or more than one leads tab        | The import stops                          |
// | A tab whose headers are the summary headers under another spelling, or in another row | The import stops, and the report names each header as found |
// | A tab with none of the three layouts                                | The import stops, and the report names the tab |
// | A further headed column in a summary tab                            | The import stops, and the report names the column |
// | A set of tabs other than the reviewed one, once a maintainer has entered it below | The import stops           |
//
// The figures of this workbook are a historical snapshot of their own. They are bound to the
// source records of this workbook and are never merged with those of source F: where the two
// workbooks state different numbers for one study, both are kept and the difference is queued.
import { COLLECTIONS, type EntityRef, LIMITS } from "@eegml/shared";
import { readDocuments } from "../context";
import type {
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  PlanContext,
  PlannedItem,
  RawScalar,
  ReadContext,
  SourceReading,
  SourceRow,
  StructureIssue,
} from "../model";
import { planRecruitmentWorkbook, type ReviewedTab } from "../recruitment-plan";
import { cellPart, storedValue } from "../recruitment-values";
import { COUNT_HEADERS, type DetectedTabKind, readRecruitmentWorkbook, TAB_RECORD_KEY } from "../recruitment-workbook";
import { type ExpectedColumn, matchHeader } from "../workbook-structure";

const SOURCE_KEY = "a";
/** The source whose summary has the same seven fields, and with which the figures of this workbook are compared. */
const COMPARED_SOURCE_KEY = "f";

/** The seven fields of the summary, as the brief states them. */
export const SUMMARY_COLUMNS: readonly ExpectedColumn[] = (Object.entries(COUNT_HEADERS) as [string, string][]).map(
  ([field, header]) => ({ field, header }),
);

/**
 * The reviewed table of tabs: the exact title of each tab with its kind and, for an outreach
 * tab, its study, as a maintainer has confirmed them after the first preview of the real
 * workbook. It is empty, because no title of this workbook is known. While it is empty the tabs
 * are recognised by their headers alone, exactly one summary tab is accepted, and the rows of an
 * outreach tab wait in the queue, because a title is a label that is never resolved by its
 * spelling. Once it holds entries the workbook must hold exactly these tabs.
 */
export const REVIEWED_TABS: readonly ReviewedTab[] = [];

/** The fewest summary headers, under tolerant matching, that make a row a candidate for the summary header. */
const NEAR_MISS_HEADERS = 3;

interface TabOfReading {
  readonly tabKey: string;
  readonly title: string;
  readonly kind: DetectedTabKind;
  readonly rows: readonly SourceRow[];
}

/** The tabs of a reading with the kind that the shared reader has recognised each as. */
function tabsOf(tabs: Iterable<readonly [string, readonly SourceRow[]]>): TabOfReading[] {
  const found: TabOfReading[] = [];
  for (const [tabKey, rows] of tabs) {
    const record = rows.find((row) => row.rowKey === TAB_RECORD_KEY);
    const [cell] = record?.cells ?? [];
    const kind = cellPart(cell, "kind");
    found.push({
      tabKey,
      title: String(storedValue(cell) ?? ""),
      kind: kind === "counts" || kind === "leads" || kind === "outreach" ? kind : "unknown",
      rows: rows.filter((row) => row !== record),
    });
  }
  return found;
}

/**
 * Checks that the workbook is what the brief describes, and says precisely what is not. The
 * summary headers are matched tolerantly here, so that a tab whose headers differ in case,
 * spacing or punctuation, or stand below a title line, is reported as such and not as unknown.
 * A message quotes no cell: what was found is in the report of the item.
 */
function structureIssues(tabs: readonly TabOfReading[]): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const wanted = SUMMARY_COLUMNS.map((column) => column.header).join(" | ");
  const counted = (kind: DetectedTabKind) => tabs.filter((tab) => tab.kind === kind).length;
  if (counted("counts") !== 1) {
    // Two summaries would give one study two current figures for one metric. Which one counts is for a maintainer.
    issues.push({
      check: "summary",
      tabKey: null,
      message:
        `The workbook holds ${counted("counts")} tabs with the seven summary headers in row 1, each once, where exactly one is expected. ` +
        `${tabs.length} tabs were read: ${counted("leads")} with the layout of a leads tab, ${counted("outreach")} with the layout of an ` +
        `outreach tab and ${counted("unknown")} with none of the layouts that the importer reads.`,
      expected: wanted,
      found: counted("counts") === 0 ? "no summary tab" : `${counted("counts")} summary tabs`,
    });
  }
  if (counted("leads") > 1) {
    issues.push({
      check: "leads",
      tabKey: null,
      message: `The workbook holds ${counted("leads")} tabs with the layout of a leads tab, where one at most is expected.`,
      expected: "one leads tab at most",
      found: `${counted("leads")} leads tabs`,
    });
  }
  const known = new Set(SUMMARY_COLUMNS.map((column) => column.header));
  for (const tab of tabs.filter((candidate) => candidate.kind === "counts")) {
    const header = tab.rows.find((row) => row.rowClass === "header");
    const further = (header?.labels ?? []).flatMap((label, index) => {
      const value = storedValue(header?.cells[index]);
      const text = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value);
      return text === "" || known.has(text) ? [] : [`${label}: ${text.slice(0, LIMITS.shortText)}`];
    });
    if (further.length > 0) {
      // A column that the brief does not name may hold anything. Nothing of the tab is imported before it is known.
      issues.push({
        check: "unknownColumn",
        tabKey: tab.tabKey,
        message:
          `The summary tab holds ${further.length} headed columns that the brief does not name. ` +
          "The import stops until a maintainer has looked at each and entered it in the importer.",
        expected: wanted,
        found: further.join(" | "),
      });
    }
  }
  for (const tab of tabs.filter((candidate) => candidate.kind === "unknown")) {
    const width = Math.max(0, ...tab.rows.map((row) => row.cells.length));
    const labels = tab.rows.find((row) => row.labels.length === width)?.labels ?? [];
    const byNumber = new Map(tab.rows.map((row) => [row.rowNumber, row]));
    const valuesOf = (rowNumber: number): RawScalar[] => (byNumber.get(rowNumber)?.cells ?? []).map(storedValue);
    const lastRow = Math.max(0, ...tab.rows.map((row) => row.rowNumber));
    const match = matchHeader(labels, valuesOf, lastRow, SUMMARY_COLUMNS, NEAR_MISS_HEADERS);
    if (match.headerRow === null) {
      issues.push({
        check: "unknownTab",
        tabKey: tab.tabKey,
        message:
          "A tab has none of the three layouts that the importer reads: the summary, the leads and the outreach layout. " +
          "Nothing of the workbook is imported until the tab has been looked at.",
        expected: "summary | leads | outreach",
        found: tab.title.slice(0, LIMITS.shortText),
      });
      continue;
    }
    const found = [
      ...match.variants.map((variant) => `${variant.found.label}: ${variant.found.text} (read as ${variant.expected})`),
      ...match.missing.map((header) => `missing: ${header}`),
      ...match.unknown.map((header) => `${header.label}: ${header.text} (not recognised)`),
    ];
    issues.push({
      check: "summaryLayout",
      tabKey: tab.tabKey,
      message:
        `Row ${match.headerRow} of a tab holds ${match.columns.size} of the seven summary headers under tolerant matching: ` +
        `${match.variants.length} are spelt otherwise than the brief states, ${match.missing.length} are missing and ` +
        `${match.unknown.length} columns are not recognised. The importer reads a summary whose header stands in row 1 ` +
        "with the spelling of the brief, so the tab is not imported until a maintainer has confirmed its layout.",
      expected: wanted,
      found: (found.length === 0 ? [`header in row ${match.headerRow}`] : found).join(" | "),
    });
  }
  return issues;
}

async function read(input: ImportInput, context: ReadContext): Promise<SourceReading> {
  const reading = await readRecruitmentWorkbook(input, context);
  if (reading.issues.length > 0) return reading;
  return { ...reading, issues: structureIssues(tabsOf(reading.tabs.map((tab) => [tab.tabKey, tab.rows] as const))) };
}

const replication = (id: string): EntityRef => ({ entityType: "replication", entityId: id });

/**
 * Compares the figures that the plan states with the current figures of source F, study by
 * study and metric by metric. A difference is queued with both values. Neither is preferred,
 * nothing is merged, and a figure that only one of the two workbooks states is no difference.
 */
async function comparisonItems(context: PlanContext, plan: ImportPlan): Promise<PlannedItem[]> {
  const { db } = context;
  const current = await db
    .collection(COLLECTIONS.historicalAggregates.collectionPath())
    .where("isCurrent", "==", true)
    .get();
  const records = await readDocuments(
    db,
    current.docs.map((doc) => COLLECTIONS.sourceRecords.docPath(String(doc.get("sourceRecordId")))),
  );
  const keyOf = (replicationIds: unknown, metricKey: unknown) =>
    `${Array.isArray(replicationIds) ? [...replicationIds].sort().join("+") : ""}\n${String(metricKey)}`;
  const compared = new Map<string, { readonly value: unknown; readonly recordId: string }>();
  for (const doc of current.docs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const recordId = String(doc.get("sourceRecordId"));
    if (records.get(COLLECTIONS.sourceRecords.docPath(recordId))?.data.sourceKey !== COMPARED_SOURCE_KEY) continue;
    compared.set(keyOf(doc.get("replicationIds"), doc.get("metricKey")), { value: doc.get("valueNumeric"), recordId });
  }
  const items: PlannedItem[] = [];
  for (const document of plan.documents) {
    if (document.collection !== "historicalAggregates" || document.fixed.metricKey === undefined) continue;
    const { replicationIds, metricKey, valueNumeric } = document.fixed;
    const other = compared.get(keyOf(replicationIds, metricKey));
    if (other === undefined || other.value === valueNumeric) continue;
    const [studyId] = Array.isArray(replicationIds) ? (replicationIds as string[]) : [];
    if (studyId === undefined) continue;
    items.push(
      context.items.valueConflict({
        subject: studyId,
        field: String(metricKey),
        entityRefs: [replication(studyId)],
        claims: [
          {
            source: SOURCE_KEY,
            value: String(valueNumeric),
            valueSource: String(valueNumeric),
            sourceRecordId: document.sourceRecordIds[0] ?? "",
          },
          {
            source: COMPARED_SOURCE_KEY,
            value: String(other.value),
            valueSource: String(other.value),
            sourceRecordId: other.recordId,
          },
        ],
      }),
    );
  }
  return items;
}

/** Plans the workbook against a reviewed table of tabs, or by the layouts of its tabs alone where the table is empty. */
async function plan(context: PlanContext, reviewedTabs: readonly ReviewedTab[]): Promise<ImportPlan> {
  const tabs = tabsOf(context.rows);
  // While no title is reviewed, the tabs are recognised by their headers and an outreach tab has no study.
  const reviewed: readonly ReviewedTab[] =
    reviewedTabs.length > 0
      ? reviewedTabs
      : tabs.flatMap((tab) =>
          tab.kind === "unknown"
            ? []
            : [tab.kind === "outreach" ? { title: tab.title, kind: tab.kind, studyId: null } : { title: tab.title, kind: tab.kind }],
        );
  const drafted = await planRecruitmentWorkbook({ sourceKey: SOURCE_KEY, tabs: reviewed }, context);
  if (drafted.blocking.length > 0) return drafted;
  const stated = new Set(drafted.items.map((item) => item.fingerprint));
  const added = (await comparisonItems(context, drafted)).filter((item) => !stated.has(item.fingerprint));
  return { ...drafted, items: [...drafted.items, ...added] };
}

/**
 * The importer for a reviewed table of tabs. The committed importer uses the committed table,
 * and a test states the table of its synthetic workbook.
 */
export function coordinationImporter(reviewedTabs: readonly ReviewedTab[]): ImporterDefinition {
  return {
    key: "coordinationWorkbook",
    sourceKey: SOURCE_KEY,
    summary:
      "Historical replication coordination workbook, built against synthetic fixtures only: study-level figures as a historical snapshot of its own, compared with the recruitment and contact workbook.",
    inputDescription: "the Excel workbook, as downloaded from the drive",
    // Its figures are compared with those of the recruitment and contact workbook, which must be present (section 5, step 9).
    after: [COMPARED_SOURCE_KEY],
    read,
    plan: (context) => plan(context, reviewedTabs),
  };
}

export const importer: ImporterDefinition = coordinationImporter(REVIEWED_TABS);
