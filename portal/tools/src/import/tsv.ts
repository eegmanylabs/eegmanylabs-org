// The reader of tab-separated files, which the website data uses (docs/MIGRATION_PLAN.md,
// section 4.1). It returns every field exactly as the file holds it: nothing is trimmed, nothing
// is read as a number and no line is dropped. A double quote is no quoting character here, and
// the reader counts the quotes it meets so that an importer can stop and report them.

export interface TsvRow {
  /** The line of the file, from 1. Provenance only. */
  readonly lineNumber: number;
  readonly cells: readonly string[];
}

export interface TsvFile {
  /** The fields of line 1, or none for an empty file. */
  readonly header: readonly string[];
  /** Every line after the first, blank lines included. */
  readonly rows: readonly TsvRow[];
  /** How many lines end in each way. Two of the website files mix them. */
  readonly lineEndings: { readonly crlf: number; readonly lf: number; readonly cr: number };
  readonly endsWithNewline: boolean;
  /** True when the file starts with a byte order mark, which is then part of the first header. */
  readonly hasByteOrderMark: boolean;
  /** The number of double quotes in the file. */
  readonly quoteCount: number;
}

/** Raised when a file is not valid UTF-8 text. */
export class TsvFormatError extends Error {
  override readonly name = "TsvFormatError";
}

export function readTsv(bytes: Uint8Array): TsvFile {
  let text: string;
  try {
    // The byte order mark is kept, so that a file that gains one fails its header check loudly.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new TsvFormatError("The file is not valid UTF-8 text.");
  }
  const lineEndings = { crlf: 0, lf: 0, cr: 0 };
  const lines: string[] = [];
  let start = 0;
  // Universal newlines: a line ends with CR LF, with LF or with CR, and the ending is no part of the last field.
  for (const match of text.matchAll(/\r\n|\n|\r/g)) {
    lines.push(text.slice(start, match.index));
    start = match.index + match[0].length;
    if (match[0] === "\r\n") lineEndings.crlf += 1;
    else if (match[0] === "\n") lineEndings.lf += 1;
    else lineEndings.cr += 1;
  }
  const endsWithNewline = text.length > 0 && start === text.length;
  if (!endsWithNewline && text.length > 0) lines.push(text.slice(start));
  const [headerLine, ...rest] = lines;
  return {
    header: headerLine === undefined ? [] : headerLine.split("\t"),
    rows: rest.map((line, index) => ({ lineNumber: index + 2, cells: line.split("\t") })),
    lineEndings,
    endsWithNewline,
    hasByteOrderMark: text.startsWith("﻿"),
    quoteCount: text.split('"').length - 1,
  };
}
