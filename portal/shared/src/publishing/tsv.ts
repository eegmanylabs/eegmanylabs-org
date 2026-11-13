// The tab-separated files of the public website, read and written so that an unchanged file is
// written back byte for byte (docs/INTEGRATIONS.md, section 6). The four files mix their line
// endings and differ in whether they end with a newline, so each line keeps the ending it was
// read with, and a line that the generator adds takes the ending that most lines of its file use.
// A cell is kept exactly as the file holds it: nothing is trimmed and nothing is read as a number.

export type LineEnding = "\r\n" | "\n" | "\r";

export interface TsvLine {
  readonly cells: readonly string[];
  /** The ending the line was read with, or null for a line that has none or that the generator added. */
  readonly ending: LineEnding | null;
  /** Whether the line was the last of the file, whose ending is the file's last and need not be usual. */
  readonly wasLast?: boolean;
}

export interface TsvTable {
  readonly header: readonly string[];
  readonly headerEnding: LineEnding | null;
  readonly lines: readonly TsvLine[];
  /** The ending that most lines of the file use, which an added line takes. */
  readonly usualEnding: LineEnding;
  /** The ending of the last line as it was read, or null where the file did not end with a newline. */
  readonly finalEnding: LineEnding | null;
}

/** Reads the text of a file. An empty file has no header and no lines. */
export function parseTsv(text: string): TsvTable {
  const parts: { text: string; ending: LineEnding | null }[] = [];
  let start = 0;
  for (const match of text.matchAll(/\r\n|\n|\r/g)) {
    parts.push({ text: text.slice(start, match.index), ending: match[0] as LineEnding });
    start = match.index + match[0].length;
  }
  if (start < text.length) parts.push({ text: text.slice(start), ending: null });
  const counts = new Map<LineEnding, number>();
  for (const part of parts) if (part.ending !== null) counts.set(part.ending, (counts.get(part.ending) ?? 0) + 1);
  const usualEnding = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "\n";
  const [header, ...rest] = parts;
  const last = parts.at(-1);
  return {
    header: header === undefined ? [] : header.text.split("\t"),
    headerEnding: header?.ending ?? null,
    lines: rest.map((part, index) => ({
      cells: part.text.split("\t"),
      ending: part.ending,
      ...(index === rest.length - 1 ? { wasLast: true } : {}),
    })),
    usualEnding,
    finalEnding: last?.ending ?? null,
  };
}

/**
 * Writes a table. Every line but the last ends as it was read, or with the usual ending where it
 * was added or was the last line before; the last line ends as the last line of the file did.
 */
export function serialiseTsv(table: TsvTable): string {
  const rows = [{ cells: table.header, ending: table.headerEnding }, ...table.lines];
  const lastIndex = rows.length - 1;
  return rows
    .map((row, index) => {
      const ending =
        index === lastIndex
          ? table.finalEnding
          : "wasLast" in row && row.wasLast === true
            ? table.usualEnding
            : (row.ending ?? table.usualEnding);
      return `${row.cells.join("\t")}${ending ?? ""}`;
    })
    .join("");
}

/** The index of a column, or -1 where the file has no such column. */
export function columnIndex(table: Pick<TsvTable, "header">, name: string): number {
  return table.header.indexOf(name);
}

/** A cell of a line by its column name, or the empty text where the line is short of it. */
export function cellOf(table: Pick<TsvTable, "header">, line: TsvLine, name: string): string {
  const index = columnIndex(table, name);
  return index < 0 ? "" : (line.cells[index] ?? "");
}

/** Replaces characters that would break a cell: a tab or a line break becomes a space. */
export function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ");
}
