// The workbook reader (docs/MIGRATION_PLAN.md, section 2).
//
// It returns every sheet of an Excel workbook, hidden and very hidden ones included, and for
// every cell what the file stores: the value and its stored type, the formula text, the
// hyperlink target and the formatting that the sources use to carry meaning. It trims nothing,
// converts nothing and drops nothing:
//
// | What a type-guessing reader does                      | What this reader does                          |
// |-------------------------------------------------------|------------------------------------------------|
// | Turns a number under a date format into a date        | Keeps the number and reports the format code   |
// | Loses the cached text of a formula under a date format | Keeps the cached text                          |
// | Skips hidden sheets, rows or columns                  | Reads them and reports that they are hidden    |
// | Returns a shared formula as an empty formula          | Expands it for every cell that depends on it   |
// | Reads the declared grid size                          | Reads the cells that exist                     |
// | Drops the part of a link after `#`                    | Joins it to the address again                  |
// | Ignores the lists that a sheet validates cells against | Returns each list with its options verbatim   |
// | Drops the notes of cells                              | Returns each note with the cell it stands on   |
//
// The reader parses the parts of the file itself (ooxml.ts) for that reason. The libraries that
// were assessed convert values while they read, which the plan rules out.
import { child, childrenOf, parseXml, readZip, WorkbookFormatError, type XmlElement } from "./ooxml";

export type SheetVisibility = "visible" | "hidden" | "veryHidden";

/**
 * How a cell stores its value.
 *
 * | Type            | Stored as                                                   |
 * |-----------------|-------------------------------------------------------------|
 * | `string`        | A text, shared or inline                                    |
 * | `number`        | A number. A date or a time is a number under a date format  |
 * | `boolean`       | A stored boolean, as a ticked or unticked checkbox is       |
 * | `error`         | An error token such as `#N/A`                               |
 * | `formulaString` | The cached text of a formula                                |
 * | `isoDate`       | A date written as ISO 8601 text, which few writers use      |
 * | `empty`         | A cell that exists, with a format, and holds no value       |
 */
export type StoredCellType = "string" | "number" | "boolean" | "error" | "formulaString" | "isoDate" | "empty";

export interface TextRun {
  readonly text: string;
  readonly strike: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface WorkbookCell {
  /** The address of the cell, for example `C12`. Provenance only. */
  readonly ref: string;
  readonly row: number;
  readonly column: number;
  readonly type: StoredCellType;
  /** The stored value: for a formula, its cached result. Null for an empty cell. */
  readonly value: string | number | boolean | null;
  /** The characters the file holds for the value, before any reading as a number or a boolean. */
  readonly rawValue: string | null;
  /** The formula text as stored, without a leading equals sign, with shared formulas expanded. Null for a typed value. */
  readonly formula: string | null;
  /** The target of the hyperlink on the cell, or null. */
  readonly hyperlink: string | null;
  /** The number format code of the cell, for example `General` or `dd.mm.yyyy`. */
  readonly numberFormat: string;
  readonly strike: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
  /** The fill colour as six hexadecimal digits, resolved through the workbook theme, or null for no fill. */
  readonly fill: string | null;
  /** The fill as the file states it, for example `rgb:FFFF0000`, `theme:4:0.6` or `indexed:10`. Null for no fill. */
  readonly fillSource: string | null;
  readonly hiddenRow: boolean;
  readonly hiddenColumn: boolean;
  /** The merged range that contains the cell, for example `A5:A7`, or null. */
  readonly merge: string | null;
  /** The runs of a text with mixed formatting, or null for a text in one format. */
  readonly richText: readonly TextRun[] | null;
}

/** One validation rule of a sheet. A source states its own vocabulary in such a list. */
export interface SheetValidation {
  /** The ranges the rule applies to, as the file writes them, for example `F2:F39`. */
  readonly ranges: readonly string[];
  /** The kind of rule as the file names it, for example `list`. */
  readonly type: string;
  /** The options of a list that the rule states itself, verbatim and in order. Null for any other rule. */
  readonly options: readonly string[] | null;
}

/** The note that a cell carries, as a header does that explains its column. */
export interface CellNote {
  /** The address of the cell, for example `E1`. */
  readonly ref: string;
  /** The text of the note exactly as the file holds it, with the runs of a formatted note joined. */
  readonly text: string;
}

export interface WorkbookSheet {
  /** The title exactly as the workbook writes it. */
  readonly name: string;
  /** The identifier the workbook itself gives the sheet, which survives a rename. */
  readonly sheetId: string;
  /** The position of the sheet among all sheets, from 0. */
  readonly position: number;
  readonly visibility: SheetVisibility;
  /** The colour of the tab, resolved through the theme, or null. */
  readonly tabColour: string | null;
  /** Every cell that exists in the file, by row and then by column. */
  readonly cells: readonly WorkbookCell[];
  readonly mergedRanges: readonly string[];
  readonly hiddenRows: readonly number[];
  readonly hiddenColumns: readonly number[];
  /** The validation rules of the sheet, in the order of the file. */
  readonly validations: readonly SheetValidation[];
  /** The notes of the cells of the sheet, by row and then by column. Threaded discussions are no notes. */
  readonly notes: readonly CellNote[];
  /** The last row and column that hold a value, whatever grid size the file declares. 0 for an empty sheet. */
  readonly lastRow: number;
  readonly lastColumn: number;
}

export interface Workbook {
  readonly sheets: readonly WorkbookSheet[];
  /** True when the workbook counts days from 1904, which shifts every date by four years and a day. */
  readonly date1904: boolean;
}

/** `1` gives `A`, `27` gives `AA`. */
export function columnLetters(column: number): string {
  if (!Number.isInteger(column) || column < 1) throw new RangeError("A column number is a whole number from 1.");
  let letters = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

/** `A` gives `1`, `AA` gives `27`. */
export function columnNumber(letters: string): number {
  if (!/^[A-Z]{1,3}$/.test(letters)) throw new RangeError("A column is named by one to three capital letters.");
  let column = 0;
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column;
}

/** The row and column of an address such as `C12`. */
export function parseRef(ref: string): { readonly row: number; readonly column: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/.exec(ref);
  if (!match) throw new WorkbookFormatError("A cell address in the workbook is malformed.");
  return { row: Number(match[2]), column: columnNumber(match[1] ?? "") };
}

/** The corners of a range such as `F2:F39`, or of one cell. */
export function rangeBounds(range: string): {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
} {
  const [first = "", last = first] = range.split(":");
  const start = parseRef(first);
  const end = parseRef(last);
  return { top: start.row, left: start.column, bottom: end.row, right: end.column };
}

/** Whether a number format shows a number as a date or a time, so that a consumer can read it as one. */
export function isDateFormat(formatCode: string): boolean {
  // Quoted text, escaped characters and bracketed sections say nothing about the kind of value.
  const bare = formatCode
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(bare) && !/general/i.test(bare);
}

/** The calendar date of a day number, as ISO 8601 text. A fraction of a day is left out. */
export function serialToIsoDate(serial: number, date1904 = false): string {
  if (!Number.isFinite(serial)) throw new RangeError("A day number is a finite number.");
  // Day 25569 of the 1900 system is 1 January 1970. The 1904 system starts 1462 days later.
  const days = Math.floor(serial) + (date1904 ? 1462 : 0) - 25569;
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

const BUILT_IN_FORMATS: Readonly<Record<number, string>> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm-dd-yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

const flag = (element: XmlElement | undefined): boolean =>
  element !== undefined && element.attributes.val !== "0" && element.attributes.val !== "false";

interface Colour {
  readonly rgb: string | null;
  readonly source: string;
}

/** Lightens or darkens a colour by a tint from -1 to 1, as the file format defines it: on the lightness of the colour. */
function applyTint(rgb: string, tint: number): string {
  const [red, green, blue] = [0, 2, 4].map((at) => Number.parseInt(rgb.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const spread = max - min;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (spread !== 0) {
    if (max === red) hue = ((green - blue) / spread) % 6;
    else if (max === green) hue = (blue - red) / spread + 2;
    else hue = (red - green) / spread + 4;
  }
  const tinted = tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint;
  const chroma = (1 - Math.abs(2 * tinted - 1)) * saturation;
  const sextant = ((hue % 6) + 6) % 6;
  const second = chroma * (1 - Math.abs((sextant % 2) - 1));
  const sector = Math.floor(sextant);
  const [r, g, b] = (
    [
      [chroma, second, 0],
      [second, chroma, 0],
      [0, chroma, second],
      [0, second, chroma],
      [second, 0, chroma],
      [chroma, 0, second],
    ] as const
  )[sector] ?? [0, 0, 0];
  const offset = tinted - chroma / 2;
  return [r, g, b]
    .map((part) =>
      Math.round(Math.min(1, Math.max(0, part + offset)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

/** The colours of the theme, in the order in which cells refer to them. */
function themeColours(theme: XmlElement | undefined): readonly (string | null)[] {
  const scheme = child(child(theme, "themeElements"), "clrScheme");
  const byName = new Map(
    (scheme?.children ?? []).map((entry) => {
      const colour = entry.children[0];
      // A system colour states the colour it last resolved to, and any other colour states itself.
      return [
        entry.name,
        (colour?.name === "sysClr" ? colour.attributes.lastClr : colour?.attributes.val) ?? null,
      ] as const;
    }),
  );
  // Cells count light before dark, which is the reverse of the order in the theme part.
  return [
    "lt1",
    "dk1",
    "lt2",
    "dk2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
  ].map((name) => byName.get(name)?.toUpperCase() ?? null);
}

function colourOf(element: XmlElement | undefined, theme: readonly (string | null)[]): Colour | null {
  if (element === undefined) return null;
  const { rgb, theme: themeIndex, tint, indexed } = element.attributes;
  if (rgb !== undefined) return { rgb: rgb.slice(-6).toUpperCase(), source: `rgb:${rgb}` };
  if (themeIndex !== undefined) {
    const base = theme[Number(themeIndex)] ?? null;
    const amount = tint === undefined ? 0 : Number(tint);
    return {
      rgb: base === null ? null : amount === 0 ? base : applyTint(base, amount),
      source: tint === undefined ? `theme:${themeIndex}` : `theme:${themeIndex}:${tint}`,
    };
  }
  if (indexed !== undefined) return { rgb: null, source: `indexed:${indexed}` };
  return null;
}

interface CellFormat {
  readonly numberFormat: string;
  readonly strike: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly fill: Colour | null;
}

const PLAIN: CellFormat = { numberFormat: "General", strike: false, bold: false, italic: false, fill: null };

function cellFormats(styles: XmlElement | undefined, theme: readonly (string | null)[]): readonly CellFormat[] {
  const fonts = childrenOf(child(styles, "fonts"), "font").map((font) => ({
    strike: flag(child(font, "strike")),
    bold: flag(child(font, "b")),
    italic: flag(child(font, "i")),
  }));
  const fills = childrenOf(child(styles, "fills"), "fill").map((fill) => {
    const pattern = child(fill, "patternFill");
    const type = pattern?.attributes.patternType;
    return type === undefined || type === "none" ? null : colourOf(child(pattern, "fgColor"), theme);
  });
  const custom = new Map(
    childrenOf(child(styles, "numFmts"), "numFmt").map((format) => [
      Number(format.attributes.numFmtId),
      format.attributes.formatCode ?? "General",
    ]),
  );
  return childrenOf(child(styles, "cellXfs"), "xf").map((xf) => {
    const formatId = Number(xf.attributes.numFmtId ?? 0);
    const font = fonts[Number(xf.attributes.fontId ?? 0)];
    return {
      numberFormat: custom.get(formatId) ?? BUILT_IN_FORMATS[formatId] ?? "General",
      strike: font?.strike ?? false,
      bold: font?.bold ?? false,
      italic: font?.italic ?? false,
      fill: fills[Number(xf.attributes.fillId ?? 0)] ?? null,
    };
  });
}

interface SharedString {
  readonly text: string;
  readonly runs: readonly TextRun[] | null;
}

/** The text of a string item: its runs joined, phonetic guides left out. */
function stringItem(item: XmlElement): SharedString {
  const runs = childrenOf(item, "r").map((run) => {
    const properties = child(run, "rPr");
    return {
      text: child(run, "t")?.text ?? "",
      strike: flag(child(properties, "strike")),
      bold: flag(child(properties, "b")),
      italic: flag(child(properties, "i")),
    };
  });
  if (runs.length === 0) return { text: child(item, "t")?.text ?? "", runs: null };
  return { text: runs.map((run) => run.text).join(""), runs };
}

/**
 * Moves the relative references of a formula by a number of rows and columns, which is how a
 * cell that depends on a shared formula gets its own text. Text in quotes is left alone, and so
 * is a reference that a dollar sign fixes.
 */
export function shiftFormula(formula: string, rows: number, columns: number): string {
  return formula.replace(
    /"(?:[^"]|"")*"|'(?:[^']|'')*'|(?<![A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)(?![A-Za-z0-9_(])/g,
    (match, fixedColumn: string | undefined, letters: string | undefined, fixedRow: string, digits: string) => {
      if (letters === undefined) return match;
      const column = fixedColumn === "$" ? letters : columnLetters(columnNumber(letters) + columns);
      const row = fixedRow === "$" ? digits : String(Number(digits) + rows);
      return `${fixedColumn}${column}${fixedRow}${row}`;
    },
  );
}

/**
 * The options of a list that a validation rule states itself: a text in double quotes with the
 * options separated by commas, in which two double quotes stand for one. A long list is written
 * as several quoted texts joined by `&`, because one quoted text of a formula holds 255
 * characters at most. Nothing is trimmed, because a source may end an option in a space. Null
 * for a rule that names a range instead.
 */
export function listOptions(formula: string): string[] | null {
  let rest = formula.trim();
  let list = "";
  for (;;) {
    const quoted = /^"((?:[^"]|"")*)"/.exec(rest);
    if (quoted?.[1] === undefined) return null;
    list += quoted[1].replaceAll('""', '"');
    rest = rest.slice(quoted[0].length).trim();
    if (rest === "") return list.split(",");
    if (!rest.startsWith("&")) return null;
    rest = rest.slice(1).trim();
  }
}

const VISIBILITIES: readonly SheetVisibility[] = ["visible", "hidden", "veryHidden"];

/** The target of each relationship of a part, by relationship identifier. */
function relationships(part: Uint8Array | undefined): Map<string, string> {
  if (part === undefined) return new Map();
  return new Map(
    childrenOf(parseXml(part), "Relationship").map((entry) => [
      entry.attributes.Id ?? "",
      entry.attributes.Target ?? "",
    ]),
  );
}

const resolveTarget = (target: string): string => (target.startsWith("/") ? target.slice(1) : `xl/${target}`);

/** The path of a part that another part names, where the target is relative to the directory of the naming part. */
function resolveRelative(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = from.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return segments.join("/");
}

/** The targets of the relationships of a part whose type ends in a name, such as `comments`. */
function relatedTargets(part: Uint8Array | undefined, typeName: string): string[] {
  if (part === undefined) return [];
  return childrenOf(parseXml(part), "Relationship")
    .filter((entry) => (entry.attributes.Type ?? "").endsWith(`/${typeName}`))
    .map((entry) => entry.attributes.Target ?? "");
}

/** The notes of a comments part: one for each cell, with its text as written. */
function readNotes(part: Uint8Array | undefined): CellNote[] {
  if (part === undefined) return [];
  return childrenOf(child(parseXml(part), "commentList"), "comment")
    .map((comment) => ({
      ref: comment.attributes.ref ?? "",
      text: stringItem(child(comment, "text") ?? { name: "text", attributes: {}, children: [], text: "" }).text,
    }))
    .filter((note) => /^[A-Z]{1,3}\d+$/.test(note.ref));
}

function readSheet(
  sheet: XmlElement,
  links: Map<string, string>,
  strings: readonly SharedString[],
  formats: readonly CellFormat[],
  theme: readonly (string | null)[],
): Pick<
  WorkbookSheet,
  "tabColour" | "cells" | "mergedRanges" | "hiddenRows" | "hiddenColumns" | "validations" | "lastRow" | "lastColumn"
> {
  const hiddenColumns = new Set<number>();
  for (const column of childrenOf(child(sheet, "cols"), "col")) {
    if (column.attributes.hidden !== "1" && column.attributes.hidden !== "true") continue;
    for (let at = Number(column.attributes.min); at <= Number(column.attributes.max); at += 1) hiddenColumns.add(at);
  }
  const mergedRanges = childrenOf(child(sheet, "mergeCells"), "mergeCell").map((merge) => merge.attributes.ref ?? "");
  const mergeOf = new Map<string, string>();
  for (const range of mergedRanges) {
    const { top, left, bottom, right } = rangeBounds(range);
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) mergeOf.set(`${columnLetters(column)}${row}`, range);
    }
  }
  const linkOf = new Map<string, string>();
  for (const link of childrenOf(child(sheet, "hyperlinks"), "hyperlink")) {
    const external = link.attributes.id === undefined ? undefined : links.get(link.attributes.id);
    // The file keeps the part of an address after `#` apart from the rest. The two are one target.
    const fragment =
      link.attributes.location === undefined || link.attributes.location === "" ? "" : `#${link.attributes.location}`;
    const target = external === undefined ? fragment : `${external}${fragment}`;
    if (target === "") continue;
    const { top, left, bottom, right } = rangeBounds(link.attributes.ref ?? "");
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) linkOf.set(`${columnLetters(column)}${row}`, target);
    }
  }

  const validations = childrenOf(child(sheet, "dataValidations"), "dataValidation").map(
    (rule): SheetValidation => ({
      ranges: (rule.attributes.sqref ?? "").split(/\s+/).filter((range) => range !== ""),
      type: rule.attributes.type ?? "none",
      options: rule.attributes.type === "list" ? listOptions(child(rule, "formula1")?.text ?? "") : null,
    }),
  );

  const sharedFormulas = new Map<string, { readonly text: string; readonly row: number; readonly column: number }>();
  const cells: WorkbookCell[] = [];
  const hiddenRows: number[] = [];
  let lastRow = 0;
  let lastColumn = 0;
  let rowCursor = 0;
  for (const rowElement of childrenOf(child(sheet, "sheetData"), "row")) {
    // A writer may leave the row number out, in which case rows follow one another.
    const row = rowElement.attributes.r === undefined ? rowCursor + 1 : Number(rowElement.attributes.r);
    rowCursor = row;
    const hiddenRow = rowElement.attributes.hidden === "1" || rowElement.attributes.hidden === "true";
    if (hiddenRow) hiddenRows.push(row);
    let columnCursor = 0;
    for (const cell of childrenOf(rowElement, "c")) {
      const column = cell.attributes.r === undefined ? columnCursor + 1 : parseRef(cell.attributes.r).column;
      columnCursor = column;
      const ref = `${columnLetters(column)}${row}`;
      const format = formats[Number(cell.attributes.s ?? 0)] ?? PLAIN;
      const stored = child(cell, "v")?.text ?? null;
      const kind = cell.attributes.t ?? "n";

      let type: StoredCellType = "empty";
      let value: WorkbookCell["value"] = null;
      let rawValue = stored;
      let richText: readonly TextRun[] | null = null;
      if (kind === "inlineStr") {
        const item = stringItem(child(cell, "is") ?? { name: "is", attributes: {}, children: [], text: "" });
        [type, value, rawValue, richText] = ["string", item.text, item.text, item.runs];
      } else if (stored !== null) {
        if (kind === "s") {
          const item = strings[Number(stored)];
          if (item === undefined)
            throw new WorkbookFormatError("A cell refers to a shared string that does not exist.");
          [type, value, rawValue, richText] = ["string", item.text, item.text, item.runs];
        } else if (kind === "str") [type, value] = ["formulaString", stored];
        else if (kind === "b") [type, value] = ["boolean", stored === "1" || stored === "true"];
        else if (kind === "e") [type, value] = ["error", stored];
        else if (kind === "d") [type, value] = ["isoDate", stored];
        else [type, value] = ["number", Number(stored)];
      }

      const formulaElement = child(cell, "f");
      let formula: string | null = null;
      if (formulaElement !== undefined) {
        const group = formulaElement.attributes.si;
        if (formulaElement.attributes.t === "shared" && group !== undefined) {
          const master = sharedFormulas.get(group);
          if (formulaElement.text !== "") {
            sharedFormulas.set(group, { text: formulaElement.text, row, column });
            formula = formulaElement.text;
          } else if (master !== undefined) {
            formula = shiftFormula(master.text, row - master.row, column - master.column);
          } else {
            throw new WorkbookFormatError("A cell depends on a shared formula that the sheet does not define.");
          }
        } else {
          formula = formulaElement.text;
        }
      }

      if (value !== null || formula !== null) {
        lastRow = Math.max(lastRow, row);
        lastColumn = Math.max(lastColumn, column);
      }
      cells.push({
        ref,
        row,
        column,
        type,
        value,
        rawValue,
        formula,
        hyperlink: linkOf.get(ref) ?? null,
        numberFormat: format.numberFormat,
        strike: format.strike,
        bold: format.bold,
        italic: format.italic,
        fill: format.fill?.rgb ?? null,
        fillSource: format.fill?.source ?? null,
        hiddenRow,
        hiddenColumn: hiddenColumns.has(column),
        merge: mergeOf.get(ref) ?? null,
        richText,
      });
    }
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column);
  return {
    tabColour: colourOf(child(child(sheet, "sheetPr"), "tabColor"), theme)?.rgb ?? null,
    cells,
    mergedRanges,
    hiddenRows,
    hiddenColumns: [...hiddenColumns].sort((a, b) => a - b),
    validations,
    lastRow,
    lastColumn,
  };
}

/** Reads a workbook from the bytes of an `.xlsx` file. */
export function readWorkbook(bytes: Uint8Array): Workbook {
  const parts = readZip(bytes);
  const part = (name: string) => parts.get(name);
  const workbookPart = part("xl/workbook.xml");
  if (workbookPart === undefined)
    throw new WorkbookFormatError("The archive holds no workbook, so it is no Excel file.");
  const workbook = parseXml(workbookPart);
  const targets = relationships(part("xl/_rels/workbook.xml.rels"));
  const themePart = [...parts.keys()].filter((name) => /^xl\/theme\/[^/]+\.xml$/.test(name)).sort()[0];
  const theme = themeColours(themePart === undefined ? undefined : parseXml(parts.get(themePart) as Uint8Array));
  const stylesPart = part("xl/styles.xml");
  const formats = cellFormats(stylesPart === undefined ? undefined : parseXml(stylesPart), theme);
  const stringsPart = part("xl/sharedStrings.xml");
  const strings = stringsPart === undefined ? [] : childrenOf(parseXml(stringsPart), "si").map(stringItem);

  const sheets = childrenOf(child(workbook, "sheets"), "sheet").map((entry, position): WorkbookSheet => {
    const target = targets.get(entry.attributes.id ?? "");
    const path = target === undefined ? undefined : resolveTarget(target);
    const sheetPart = path === undefined ? undefined : part(path);
    if (path === undefined || sheetPart === undefined) {
      throw new WorkbookFormatError("The workbook lists a sheet whose content is missing from the archive.");
    }
    const relationsPart = part(path.replace(/([^/]+)$/, "_rels/$1.rels"));
    const links = relationships(relationsPart);
    const notes = relatedTargets(relationsPart, "comments")
      .flatMap((target) => readNotes(part(resolveRelative(path, target))))
      .sort((a, b) => {
        const [first, second] = [parseRef(a.ref), parseRef(b.ref)];
        return first.row - second.row || first.column - second.column;
      });
    const state = entry.attributes.state ?? "visible";
    return {
      name: entry.attributes.name ?? "",
      sheetId: entry.attributes.sheetId ?? "",
      position,
      visibility: VISIBILITIES.find((visibility) => visibility === state) ?? "visible",
      ...readSheet(parseXml(sheetPart), links, strings, formats, theme),
      notes,
    };
  });
  const date1904 = child(workbook, "workbookPr")?.attributes.date1904;
  return { sheets, date1904: date1904 === "1" || date1904 === "true" };
}

/** The cells of a sheet by row number and then by column number. */
export function cellsByRow(sheet: WorkbookSheet): Map<number, Map<number, WorkbookCell>> {
  const rows = new Map<number, Map<number, WorkbookCell>>();
  for (const cell of sheet.cells) {
    let row = rows.get(cell.row);
    if (row === undefined) {
      row = new Map();
      rows.set(cell.row, row);
    }
    row.set(cell.column, cell);
  }
  return rows;
}
