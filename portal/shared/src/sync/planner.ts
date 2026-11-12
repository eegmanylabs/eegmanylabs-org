// The synchronisation planner (docs/INTEGRATIONS.md, section 3.3): a pure function of the
// current portal values (A), the current sheet values (S), the base each cell last agreed on (B)
// and the mapping. It decides every write of a run and performs none, so a dry run and a live
// run share one plan, and a repeated run over unchanged state plans nothing.
//
// Rows are identified by their key and never by their position. A write to the sheet names the
// row by the key the engine anchors on it as developer metadata, so a row that a person inserts
// or deletes between the read and the write cannot move the write onto a neighbour. No row is
// ever deleted on either side: a row or record that disappears becomes a review item.
import {
  type Canonical,
  canonicalFromApp,
  canonicalFromSheet,
  normaliseText,
  type SheetScalar,
  type SyncFieldSpec,
  sheetValueOf,
} from "./values";

/**
 * Who owns the value of a mapped field.
 *
 * | Direction            | Portal to sheet | Sheet to portal | When both sides changed |
 * |----------------------|-----------------|-----------------|-------------------------|
 * | `appAuthoritative`   | Written         | Never           | The portal value stands |
 * | `sheetAuthoritative` | Never           | Written         | The sheet value stands  |
 * | `bidirectional`      | Written         | Written         | A conflict for review   |
 * | `generated`          | Written         | Never read back | The computed value stands |
 */
export const SYNC_DIRECTIONS = ["appAuthoritative", "sheetAuthoritative", "bidirectional", "generated"] as const;
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

/** What the planner decides for one cell from A, S, B and the direction. */
export type CellDecision =
  | { readonly kind: "none" }
  | { readonly kind: "agree" }
  | { readonly kind: "writeExternal"; readonly overwroteExternalEdit: boolean }
  | { readonly kind: "writeApp"; readonly overwroteAppEdit: boolean }
  | { readonly kind: "conflict" };

/**
 * The three-way comparison of one cell. `base` is undefined while the cell has never agreed.
 * The same decision serves a sheet cell and a managed section of a document that is bound to
 * one designated field, so both reach the same conflict machinery.
 */
export function decideCell(
  direction: SyncDirection,
  app: Canonical,
  external: Canonical,
  base: Canonical | undefined,
): CellDecision {
  if (app === external) return base === app ? { kind: "none" } : { kind: "agree" };
  switch (direction) {
    case "appAuthoritative":
    case "generated":
      return { kind: "writeExternal", overwroteExternalEdit: base !== undefined && external !== base };
    case "sheetAuthoritative":
      return { kind: "writeApp", overwroteAppEdit: base !== undefined && app !== base };
    case "bidirectional": {
      if (base === undefined) {
        // First link: one empty side is filled from the other, two different values go to review.
        if (app === null) return { kind: "writeApp", overwroteAppEdit: false };
        if (external === null) return { kind: "writeExternal", overwroteExternalEdit: false };
        return { kind: "conflict" };
      }
      const appChanged = app !== base;
      const externalChanged = external !== base;
      if (appChanged && !externalChanged) return { kind: "writeExternal", overwroteExternalEdit: false };
      if (!appChanged && externalChanged) return { kind: "writeApp", overwroteAppEdit: false };
      return { kind: "conflict" };
    }
  }
}

/** One mapped field and the column that holds it. */
export interface MappedColumn {
  readonly field: string;
  /** The header text of the column, as written in the sheet. */
  readonly column: string;
  readonly direction: SyncDirection;
  readonly spec: SyncFieldSpec;
}

export const ROW_POLICIES = {
  /** A key in the sheet with no portal record: raise a review item, or leave the row alone. */
  sheetOnly: ["propose", "ignore"],
  /** A portal record with no row: append one, or leave the sheet alone. */
  appOnly: ["append", "ignore"],
} as const;

export interface PlannerMapping {
  /** The header text of the key column. */
  readonly keyColumn: string;
  readonly columns: readonly MappedColumn[];
  readonly sheetOnly: (typeof ROW_POLICIES.sheetOnly)[number];
  readonly appOnly: (typeof ROW_POLICIES.appOnly)[number];
  /** The most cells one run may write. A plan above it writes nothing and pauses the mapping. */
  readonly cellCeiling: number;
}

/** One cell as the Sheets interface returns it: the unformatted computed value, and the formula where one was entered. */
export interface SheetCell {
  readonly value: SheetScalar;
  readonly formula?: string;
}

export interface SheetHeaderCell {
  readonly index: number;
  readonly text: string;
  /** The field named by the column's developer metadata, where the column carries one. */
  readonly tag: string | null;
}

export interface SheetRow {
  /** The row number in the sheet, from 1. Used only where a row cannot be addressed by its anchor. */
  readonly position: number;
  /** The row key held in the row's developer metadata, or null where the row carries none. */
  readonly anchor: string | null;
  readonly cells: readonly (SheetCell | undefined)[];
}

export interface SheetSnapshot {
  readonly header: readonly SheetHeaderCell[];
  readonly rows: readonly SheetRow[];
  /** Whether the tab's metadata budget is spent, so that rows are addressed by position. */
  readonly anchorBudgetExceeded: boolean;
}

/** One portal record in scope, under the key that identifies its row. */
export interface AppRecord {
  readonly key: string;
  readonly recordId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly archived: boolean;
}

/** The base of one cell: the value both sides held when it last agreed. */
export interface CellBase {
  readonly value: Canonical;
  /** A cell whose written value read back differently. It is written no more until a person clears the mark. */
  readonly unstable: boolean;
}

export interface PlannerInput {
  readonly mapping: PlannerMapping;
  readonly sheet: SheetSnapshot;
  readonly records: readonly AppRecord[];
  /** Keyed by `cellKey(rowKey, field)`. */
  readonly bases: ReadonlyMap<string, CellBase>;
  /** The cells that have an open conflict, by `cellKey`. */
  readonly openConflicts: ReadonlySet<string>;
}

/** The key of one mapped cell: its row key and its field. */
export function cellKey(rowKey: string, field: string): string {
  return `${rowKey}\u0000${field}`;
}

export interface AnchorRepair {
  readonly position: number;
  readonly rowKey: string;
  readonly previous: string | null;
}

export interface SheetCellWrite {
  readonly rowKey: string;
  readonly recordId: string;
  readonly position: number;
  /** Whether the write names the row by its anchor, or by its position where the metadata budget is spent. */
  readonly byAnchor: boolean;
  readonly columnIndex: number;
  readonly field: string;
  readonly value: string | number | boolean;
  readonly canonical: Canonical;
  /** The sheet value the write replaces. */
  readonly replaced: Canonical;
  /** Whether a person had changed the sheet since the cell last agreed, so that the replaced value is logged. */
  readonly overwroteExternalEdit: boolean;
}

export interface AppFieldWrite {
  readonly rowKey: string;
  readonly recordId: string;
  readonly field: string;
  readonly canonical: Canonical;
  /** The portal value the write requires the field still to hold. */
  readonly expected: Canonical;
  readonly overwroteAppEdit: boolean;
}

export interface BaseUpdate {
  readonly rowKey: string;
  readonly recordId: string;
  readonly field: string;
  readonly value: Canonical;
}

export interface PlannedConflict {
  readonly rowKey: string;
  readonly recordId: string;
  readonly field: string;
  /** Absent when the cell is linked for the first time and both sides already differ. */
  readonly base: Canonical | undefined;
  readonly app: Canonical;
  readonly external: Canonical;
}

export interface RowAppend {
  readonly rowKey: string;
  readonly recordId: string;
  /** One value for each column index up to the last mapped one. Null leaves the cell untouched. */
  readonly cells: readonly (string | number | boolean | null)[];
  readonly bases: readonly BaseUpdate[];
}

/**
 * | Kind                  | Meaning                                                                  |
 * |-----------------------|--------------------------------------------------------------------------|
 * | `missingKeyColumn`    | The key column cannot be found. The run stops and the mapping is paused  |
 * | `missingColumn`       | A mapped column cannot be found. Its field is switched off for the run   |
 * | `duplicateKey`        | Several rows share a key. Every one of them is left out                  |
 * | `unknownRow`          | A key in the sheet has no portal record and no stored state              |
 * | `missingRow`          | A record that was synchronised has lost its row. Nothing is deleted      |
 * | `archivedRecord`      | A row's record is archived or gone. The row is left as it is             |
 * | `formulaCell`         | A cell the plan would write holds a formula. It is never written         |
 * | `unstableCell`        | A cell read back differently from what was written. It is not written    |
 * | `invalidValue`        | A value cannot be read as the field's type. The cell is left alone       |
 * | `ceilingExceeded`     | The plan writes more cells than the mapping allows. Nothing is written   |
 * | `anchorBudgetExceeded`| The metadata budget is spent, so rows are addressed by position          |
 */
export const SYNC_ISSUE_KINDS = [
  "missingKeyColumn",
  "missingColumn",
  "duplicateKey",
  "unknownRow",
  "missingRow",
  "archivedRecord",
  "formulaCell",
  "unstableCell",
  "invalidValue",
  "ceilingExceeded",
  "anchorBudgetExceeded",
] as const;
export type SyncIssueKind = (typeof SYNC_ISSUE_KINDS)[number];

export interface PlanIssue {
  readonly kind: SyncIssueKind;
  readonly rowKey?: string;
  readonly field?: string;
  readonly detail: string;
}

export interface SyncPlanStats {
  readonly rowsRead: number;
  readonly rowsMatched: number;
  readonly blankKeys: number;
  readonly anchorsRepaired: number;
  readonly cellsToSheet: number;
  readonly rowsAppended: number;
  readonly fieldsToApp: number;
  readonly conflicts: number;
  readonly issues: number;
}

export interface SyncPlan {
  /** Set when the run must stop without writing: the key column is gone, or the ceiling is exceeded. */
  readonly halted: SyncIssueKind | null;
  readonly keyColumnIndex: number | null;
  readonly columns: readonly { readonly field: string; readonly index: number }[];
  readonly anchorRepairs: readonly AnchorRepair[];
  readonly sheetWrites: readonly SheetCellWrite[];
  readonly appends: readonly RowAppend[];
  readonly appWrites: readonly AppFieldWrite[];
  readonly baseUpdates: readonly BaseUpdate[];
  readonly conflicts: readonly PlannedConflict[];
  /** Open conflicts whose two sides now agree, which the run closes. */
  readonly settledConflicts: readonly BaseUpdate[];
  readonly issues: readonly PlanIssue[];
  readonly stats: SyncPlanStats;
}

/** Header text compared as the design says: trimmed and without case. */
function headerFold(text: string): string {
  return (normaliseText(text) ?? "").toLowerCase();
}

/**
 * The index of the column of a mapped field: by its metadata tag first, then by its header,
 * trimmed and without case. Null where none matches, or where two headers match and the engine
 * would have to guess.
 */
export function findColumn(
  header: readonly SheetHeaderCell[],
  column: Pick<MappedColumn, "field" | "column">,
): number | null {
  const tagged = header.find((cell) => cell.tag === column.field);
  if (tagged !== undefined) return tagged.index;
  const wanted = headerFold(column.column);
  const matches = header.filter((cell) => headerFold(cell.text) === wanted);
  // Two columns with one header are ambiguous, and the engine never guesses.
  return matches.length === 1 ? (matches[0]?.index ?? null) : null;
}

/** The key of a row: its key cell as normalised text, or null for a blank key. */
export function keyOf(row: SheetRow, keyIndex: number): string | null {
  const value = row.cells[keyIndex]?.value ?? null;
  if (value === null) return null;
  return normaliseText(String(value));
}

const writesToSheet = (direction: SyncDirection) => direction !== "sheetAuthoritative";

/** Plans one run of a mapping. Pure: the same input always gives the same plan. */
export function planSync(input: PlannerInput): SyncPlan {
  const { mapping, sheet, records, bases, openConflicts } = input;
  const issues: PlanIssue[] = [];
  const keyHeader = headerFold(mapping.keyColumn);
  const keyMatches = sheet.header.filter((cell) => headerFold(cell.text) === keyHeader);
  const keyColumnIndex = keyMatches.length === 1 ? (keyMatches[0]?.index ?? null) : null;
  const empty = {
    anchorRepairs: [],
    sheetWrites: [],
    appends: [],
    appWrites: [],
    baseUpdates: [],
    conflicts: [],
    settledConflicts: [],
  };
  if (keyColumnIndex === null) {
    issues.push({
      kind: "missingKeyColumn",
      detail: `The key column "${mapping.keyColumn}" cannot be found, or two columns carry its header.`,
    });
    return {
      halted: "missingKeyColumn",
      keyColumnIndex: null,
      columns: [],
      ...empty,
      issues,
      stats: statsOf({ rowsRead: sheet.rows.length, rowsMatched: 0, blankKeys: 0, ...empty, issues }),
    };
  }

  const columns: { readonly column: MappedColumn; readonly index: number }[] = [];
  for (const column of mapping.columns) {
    const index = findColumn(sheet.header, column);
    if (index === null || index === keyColumnIndex) {
      issues.push({
        kind: "missingColumn",
        field: column.field,
        detail: `The column "${column.column}" cannot be found, so its field is left out of this run.`,
      });
    } else {
      columns.push({ column, index });
    }
  }

  // Rows by key. A blank key is ignored, and every row of a duplicated key is left out.
  let blankKeys = 0;
  const rowsByKey = new Map<string, SheetRow[]>();
  for (const row of sheet.rows) {
    const key = keyOf(row, keyColumnIndex);
    if (key === null) {
      blankKeys += 1;
      continue;
    }
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }
  const uniqueRows: { readonly key: string; readonly row: SheetRow }[] = [];
  for (const [key, rows] of rowsByKey) {
    const first = rows[0];
    if (rows.length > 1 || first === undefined) {
      issues.push({
        kind: "duplicateKey",
        rowKey: key,
        detail: `${rows.length} rows carry the key "${key}", so none of them is synchronised.`,
      });
    } else {
      uniqueRows.push({ key, row: first });
    }
  }
  uniqueRows.sort((a, b) => a.row.position - b.row.position);

  const anchorRepairs: AnchorRepair[] = [];
  if (sheet.anchorBudgetExceeded) {
    issues.push({
      kind: "anchorBudgetExceeded",
      detail:
        "The tab has no metadata budget left, so rows are addressed by position and their keys read again before each write.",
    });
  } else {
    for (const { key, row } of uniqueRows) {
      if (row.anchor !== key) anchorRepairs.push({ position: row.position, rowKey: key, previous: row.anchor });
    }
  }

  const keysWithState = new Set<string>();
  for (const id of bases.keys()) keysWithState.add(id.slice(0, id.indexOf("\u0000")));
  const recordsByKey = new Map(records.map((record) => [record.key, record]));

  const sheetWrites: SheetCellWrite[] = [];
  const appWrites: AppFieldWrite[] = [];
  const baseUpdates: BaseUpdate[] = [];
  const conflicts: PlannedConflict[] = [];
  const settledConflicts: BaseUpdate[] = [];
  let rowsMatched = 0;

  for (const { key, row } of uniqueRows) {
    const record = recordsByKey.get(key);
    if (record === undefined || record.archived) {
      if (record !== undefined || keysWithState.has(key)) {
        issues.push({
          kind: "archivedRecord",
          rowKey: key,
          detail: `The record of the row "${key}" is archived or no longer exists. The row is left as it is.`,
        });
      } else if (mapping.sheetOnly === "propose") {
        issues.push({
          kind: "unknownRow",
          rowKey: key,
          detail: `The row "${key}" names no record in the portal. Nothing is created without a review.`,
        });
      }
      continue;
    }
    rowsMatched += 1;
    for (const { column, index } of columns) {
      const id = cellKey(key, column.field);
      const cell = row.cells[index];
      const external = canonicalFromSheet(column.spec, cell?.value ?? null);
      const app = canonicalFromApp(column.spec, record.values[column.field]);
      if (!external.ok || !app.ok) {
        issues.push({
          kind: "invalidValue",
          rowKey: key,
          field: column.field,
          detail: !external.ok ? `The sheet: ${external.reason}` : !app.ok ? `The portal: ${app.reason}` : "",
        });
        continue;
      }
      const base = bases.get(id);
      if (base?.unstable === true) {
        if (app.value !== external.value) {
          issues.push({
            kind: "unstableCell",
            rowKey: key,
            field: column.field,
            detail:
              "The cell read back differently after an earlier write, so it is not written until a person clears the mark.",
          });
        }
        continue;
      }
      if (openConflicts.has(id)) {
        if (app.value === external.value) {
          settledConflicts.push({ rowKey: key, recordId: record.recordId, field: column.field, value: app.value });
        } else {
          conflicts.push({
            rowKey: key,
            recordId: record.recordId,
            field: column.field,
            base: base?.value,
            app: app.value,
            external: external.value,
          });
        }
        continue;
      }
      const decision = decideCell(column.direction, app.value, external.value, base?.value);
      switch (decision.kind) {
        case "none":
          break;
        case "agree":
          baseUpdates.push({ rowKey: key, recordId: record.recordId, field: column.field, value: app.value });
          break;
        case "conflict":
          conflicts.push({
            rowKey: key,
            recordId: record.recordId,
            field: column.field,
            base: base?.value,
            app: app.value,
            external: external.value,
          });
          break;
        case "writeApp":
          appWrites.push({
            rowKey: key,
            recordId: record.recordId,
            field: column.field,
            canonical: external.value,
            expected: app.value,
            overwroteAppEdit: decision.overwroteAppEdit,
          });
          break;
        case "writeExternal":
          if (cell?.formula !== undefined) {
            issues.push({
              kind: "formulaCell",
              rowKey: key,
              field: column.field,
              detail: "The cell holds a formula, which belongs to the sheet's authors, so it is never written.",
            });
            break;
          }
          sheetWrites.push({
            rowKey: key,
            recordId: record.recordId,
            position: row.position,
            byAnchor: !sheet.anchorBudgetExceeded,
            columnIndex: index,
            field: column.field,
            value: sheetValueOf(column.spec, app.value),
            canonical: app.value,
            replaced: external.value,
            overwroteExternalEdit: decision.overwroteExternalEdit,
          });
          break;
      }
    }
  }

  // Records in scope without a row.
  const appends: RowAppend[] = [];
  const width = Math.max(keyColumnIndex, ...columns.map(({ index }) => index)) + 1;
  const appendable = columns.some(({ column }) => writesToSheet(column.direction));
  for (const record of [...records].sort((a, b) => a.key.localeCompare(b.key))) {
    if (record.archived || rowsByKey.has(record.key)) continue;
    if (keysWithState.has(record.key)) {
      issues.push({
        kind: "missingRow",
        rowKey: record.key,
        detail: `The row of "${record.key}" has gone from the sheet. The record is kept, and the row is not written again without a review.`,
      });
      continue;
    }
    if (mapping.appOnly !== "append" || !appendable) continue;
    const cells: (string | number | boolean | null)[] = Array.from({ length: width }, () => null);
    cells[keyColumnIndex] = record.key;
    const rowBases: BaseUpdate[] = [];
    for (const { column, index } of columns) {
      const app = canonicalFromApp(column.spec, record.values[column.field]);
      if (!app.ok) continue;
      // A new row takes every mapped value, so that no sheet-owned column starts empty and
      // then empties the portal on the next run.
      cells[index] = app.value === null ? null : sheetValueOf(column.spec, app.value);
      rowBases.push({ rowKey: record.key, recordId: record.recordId, field: column.field, value: app.value });
    }
    appends.push({ rowKey: record.key, recordId: record.recordId, cells, bases: rowBases });
  }

  const cellsPlanned =
    sheetWrites.length +
    appWrites.length +
    appends.reduce((total, append) => total + append.cells.filter((cell) => cell !== null).length, 0);
  if (cellsPlanned > mapping.cellCeiling) {
    issues.push({
      kind: "ceilingExceeded",
      detail: `The run would write ${cellsPlanned} cells, more than the ceiling of ${mapping.cellCeiling}. Nothing was written and the mapping is paused for review.`,
    });
    return {
      halted: "ceilingExceeded",
      keyColumnIndex,
      columns: columns.map(({ column, index }) => ({ field: column.field, index })),
      ...empty,
      baseUpdates,
      conflicts,
      issues,
      stats: statsOf({
        rowsRead: sheet.rows.length,
        rowsMatched,
        blankKeys,
        ...empty,
        conflicts,
        issues,
      }),
    };
  }

  const parts = { anchorRepairs, sheetWrites, appends, appWrites, baseUpdates, conflicts, settledConflicts };
  return {
    halted: null,
    keyColumnIndex,
    columns: columns.map(({ column, index }) => ({ field: column.field, index })),
    ...parts,
    issues,
    stats: statsOf({ rowsRead: sheet.rows.length, rowsMatched, blankKeys, ...parts, issues }),
  };
}

function statsOf(parts: {
  readonly rowsRead: number;
  readonly rowsMatched: number;
  readonly blankKeys: number;
  readonly anchorRepairs: readonly unknown[];
  readonly sheetWrites: readonly unknown[];
  readonly appends: readonly unknown[];
  readonly appWrites: readonly unknown[];
  readonly conflicts: readonly unknown[];
  readonly issues: readonly unknown[];
}): SyncPlanStats {
  return {
    rowsRead: parts.rowsRead,
    rowsMatched: parts.rowsMatched,
    blankKeys: parts.blankKeys,
    anchorsRepaired: parts.anchorRepairs.length,
    cellsToSheet: parts.sheetWrites.length,
    rowsAppended: parts.appends.length,
    fieldsToApp: parts.appWrites.length,
    conflicts: parts.conflicts.length,
    issues: parts.issues.length,
  };
}

/** Whether a plan writes anything to either side. A run over converged state plans nothing. */
export function planWrites(plan: SyncPlan): boolean {
  return plan.anchorRepairs.length + plan.sheetWrites.length + plan.appends.length + plan.appWrites.length > 0;
}
