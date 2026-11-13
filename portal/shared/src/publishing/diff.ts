// The difference between a file of the public website as it stands and as a publication would
// leave it, row by row and field by field (requirement R14.3). Rows are matched by their key,
// which for the candidate files joins several columns, so a reordered file shows no change and a
// changed cell shows its column with the value before and after.
import { cellOf, parseTsv, type TsvLine, type TsvTable } from "./tsv";

export interface FieldChange {
  readonly column: string;
  readonly before: string;
  readonly after: string;
}

export type RowChangeKind = "added" | "removed" | "changed";

export interface RowChange {
  readonly key: string;
  readonly kind: RowChangeKind;
  /** For a changed row, the cells that differ. For an added or removed row, every cell that is not empty. */
  readonly fields: readonly FieldChange[];
}

export interface FileDiff {
  /** Whether the file is new: it does not exist on the main branch yet. */
  readonly created: boolean;
  /** Whether the bytes differ at all, which includes a change of line endings alone. */
  readonly bytesChanged: boolean;
  readonly columnsChanged: boolean;
  readonly rows: readonly RowChange[];
  readonly counts: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly unchanged: number;
  };
}

function rowKey(table: TsvTable, line: TsvLine, keyColumns: readonly string[]): string {
  return keyColumns.map((column) => cellOf(table, line, column)).join("|");
}

function keyed(table: TsvTable, keyColumns: readonly string[]): Map<string, TsvLine> {
  const rows = new Map<string, TsvLine>();
  for (const line of table.lines) {
    // A blank line holds nothing to publish or to compare.
    if (line.cells.every((cell) => cell === "")) continue;
    let key = rowKey(table, line, keyColumns);
    // Two rows with one key are both kept, the second under a key of its own.
    for (let ordinal = 2; rows.has(key); ordinal += 1) key = `${rowKey(table, line, keyColumns)}#${ordinal}`;
    rows.set(key, line);
  }
  return rows;
}

/**
 * Compares the text of a file before and after. `keySpec` names the key column, or several
 * joined with `|`. `before` is null for a file that does not exist yet.
 */
export function diffWebsiteFile(before: string | null, after: string, keySpec: string): FileDiff {
  const keyColumns = keySpec.split("|");
  const old = parseTsv(before ?? "");
  const next = parseTsv(after);
  const oldRows = keyed(old, keyColumns);
  const newRows = keyed(next, keyColumns);
  const columns = [...new Set([...old.header, ...next.header])];
  const rows: RowChange[] = [];
  let unchanged = 0;
  const cellsOf = (table: TsvTable, line: TsvLine, side: "before" | "after"): FieldChange[] =>
    table.header
      .map((column) => ({ column, value: cellOf(table, line, column) }))
      .filter((entry) => entry.value !== "")
      .map((entry) => ({
        column: entry.column,
        before: side === "before" ? entry.value : "",
        after: side === "after" ? entry.value : "",
      }));
  for (const [key, line] of newRows) {
    const previous = oldRows.get(key);
    if (previous === undefined) {
      rows.push({ key, kind: "added", fields: cellsOf(next, line, "after") });
      continue;
    }
    const fields = columns
      .map((column) => ({ column, before: cellOf(old, previous, column), after: cellOf(next, line, column) }))
      .filter((field) => field.before !== field.after);
    if (fields.length === 0) unchanged += 1;
    else rows.push({ key, kind: "changed", fields });
  }
  for (const [key, line] of oldRows) {
    if (!newRows.has(key)) rows.push({ key, kind: "removed", fields: cellsOf(old, line, "before") });
  }
  const count = (kind: RowChangeKind) => rows.filter((row) => row.kind === kind).length;
  return {
    created: before === null,
    bytesChanged: before !== after,
    columnsChanged: old.header.join("\t") !== next.header.join("\t"),
    rows,
    counts: { added: count("added"), removed: count("removed"), changed: count("changed"), unchanged },
  };
}

/** The most rows of a file's difference that a batch keeps for its preview. */
export const DIFF_ROWS_KEPT = 500;
