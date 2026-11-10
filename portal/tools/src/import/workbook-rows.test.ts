// Unit tests of what the importers of workbooks share. Every workbook and value here is
// invented, and the one address is on example.org: the data is synthetic.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { awkwardWorkbook } from "./fixtures/workbooks";
import type { SourceRow } from "./model";
import { readWorkbook, type WorkbookSheet } from "./workbook";
import {
  collapsed,
  flagOf,
  formulaOf,
  gridOf,
  headerText,
  inputFileOf,
  isValidationRow,
  linkOf,
  nullLikeOf,
  numberOf,
  numbersIn,
  openWorkbook,
  rawOf,
  rowsInColumn,
  singleNumberOf,
  termsOf,
  tidied,
  uninterpretedTab,
  validatedLists,
  validationRows,
} from "./workbook-rows";

const directory = mkdtempSync(path.join(tmpdir(), "eegml-workbook-rows-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const input = (file: string) => ({ path: path.join(directory, file), observedOn: "2026-11-09" });

describe("openWorkbook", () => {
  it("opens an Excel export and identifies the file by its hash, under a neutral name", async () => {
    // An export is often named after the identifier of its document, which is private. The name is never recorded.
    const named = "an-invented-identifier-of-the-document - Sheet1.xlsx";
    writeFileSync(path.join(directory, named), await awkwardWorkbook());
    const opened = openWorkbook(input(named));
    expect(opened.issues).toEqual([]);
    expect(opened.workbook?.sheets).toHaveLength(3);
    expect(opened.inputFiles).toEqual([{ name: "input.xlsx", sha256: opened.contentHash }]);
    expect(opened.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inputFileOf("/exports/An Identifier.XLSX", "ab")).toEqual({ name: "input.xlsx", sha256: "ab" });
    expect(inputFileOf("/exports/identifier.with a strange ending", "ab").name).toBe("input");
    expect(inputFileOf("/exports/identifier", "ab").name).toBe("input");
  });

  it("reports a missing file and a file of another format as issues of the source, and throws nothing", () => {
    expect(openWorkbook(input("absent.xlsx"))).toMatchObject({ workbook: null, issues: [{ check: "input" }] });
    writeFileSync(path.join(directory, "page.xlsx"), "<html>Sign in to continue</html>");
    const page = openWorkbook(input("page.xlsx"));
    expect(page).toMatchObject({ workbook: null, issues: [{ check: "format", tabKey: null }] });
    // The file is still identified, so that the batch can say what was read.
    expect(page.inputFiles).toHaveLength(1);
  });
});

describe("gridOf and the readers of a stored cell", async () => {
  const [sheet] = readWorkbook(await awkwardWorkbook()).sheets;
  if (sheet === undefined) throw new Error("The fixture has no sheet.");
  const grid = gridOf(sheet);
  const row = (number: number, formatting = {}): SourceRow => ({
    rowClass: "data",
    rowNumber: number,
    rowKey: `row${number}`,
    cells: grid.cells(number, formatting),
    labels: grid.labels,
  });

  it("covers the used range, whatever the file declares, and names cells by column letter", () => {
    expect(grid.labels).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(grid.lastRow).toBe(8);
    expect(grid.holdsContent(3)).toBe(true);
    expect(grid.holdsContent(7)).toBe(false);
  });

  it("reads the target of a link and never its label, a formula beside its cached value, and a number only from a number", () => {
    expect(linkOf(row(3), "B")).toBe("mailto:ada@example.org");
    expect(linkOf(row(3), "A")).toBeNull();
    expect(formulaOf(row(6), "D")).toBe("SUM(D3:D5)");
    expect(numberOf(row(6), "D")).toBe(12);
    expect(formulaOf(row(4), "D")).toBeNull();
    // An explicit zero is a number, a blank is none, and a text that looks like a date is no number.
    expect(numberOf(row(3), "D")).toBe(0);
    expect(numberOf(row(3), "E")).toBeNull();
    expect(numberOf(row(3), "G")).toBeNull();
    expect(rawOf(row(3), "E")).toBeNull();
    expect(rawOf(row(3), "Z")).toBeNull();
  });

  it("captures a tab that an importer does not know row by row, and interprets nothing in it", () => {
    const captured = uninterpretedTab(sheet);
    expect(captured).toMatchObject({ name: "Outreach demo ", visibility: "visible", fillerRows: 0, blankRows: 1 });
    expect(captured.tabKey).toMatch(/^[0-9a-f]{20}$/);
    expect(captured.headerRow).toBeUndefined();
    // Seven rows hold content, the banner and the header among them: all are annotations, keyed by their content.
    expect(captured.rows.map((entry) => entry.rowClass)).toEqual(Array(7).fill("annotation"));
    expect(captured.rows.map((entry) => entry.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 8]);
    for (const entry of captured.rows) expect(entry.rowKey).toMatch(/^row__[0-9a-f]{12}__1$/);
  });

  it("always says that a row is hidden, and reads any other flag only where the importer asked for it", () => {
    expect(flagOf(row(5), "A", "hiddenRow")).toBe(true);
    expect(flagOf(row(5, { hidden: true }), "A", "hiddenRow")).toBe(true);
    expect(flagOf(row(4), "A", "hiddenRow")).toBe(false);
    expect(flagOf(row(6), "A", "bold")).toBe(false);
    // That a column is hidden is said where the importer asks for it: on the header record of a tab.
    expect(flagOf(row(3), "B", "hiddenColumn")).toBe(false);
    expect(flagOf(row(3, { hidden: true }), "B", "hiddenColumn")).toBe(true);
    expect(flagOf(row(6, { font: true }), "A", "bold")).toBe(true);
    expect(flagOf(row(5, { font: true }), "C", "italic")).toBe(true);
  });
});

describe("the readings of a value", () => {
  it("normalises a text for matching and tidies it for storing, without touching the raw value", () => {
    expect(collapsed("  first\n second\u00a0and  third ")).toBe("first second and third");
    expect(tidied("  first\n second ")).toBe("first\n second");
    // A letter with a combining accent becomes the one composed letter.
    expect(collapsed("e\u0301")).toBe("\u00e9");
    expect(headerText("Notes. Comments\n")).toBe("Notes. Comments");
    expect(headerText(" ")).toBe("");
    expect(headerText(12)).toBe("");
    expect(headerText(null)).toBe("");
  });

  it("offers a number only where a text states exactly one", () => {
    expect(singleNumberOf("~40 mins")).toBe(40);
    expect(singleNumberOf("N=84")).toBe(84);
    expect(singleNumberOf("r = .41")).toBe(0.41);
    expect(singleNumberOf("1 (Cz)")).toBe(1);
    // Several numbers, and a digit inside the name of a channel or a component: nothing is picked.
    expect(singleNumberOf("N=17 (+3 excluded)")).toBeNull();
    expect(singleNumberOf("2: P4-P3")).toBeNull();
    expect(singleNumberOf("1 (P300)")).toBeNull();
    expect(singleNumberOf("unknown")).toBeNull();
    expect(numbersIn("N=84 (one-tailed, with dz=.31, alpha level 0.02, power 90)")).toEqual([
      "84",
      ".31",
      "0.02",
      "90",
    ]);
  });

  it("tells an empty cell from one that says none and from one that says unknown", () => {
    expect([null, "", "  "].map(nullLikeOf)).toEqual(["empty", "empty", "empty"]);
    expect(["-", "no", "None", "N/A", "n/A", "not included"].map(nullLikeOf)).toEqual(Array(6).fill("noneStated"));
    expect(["Unknown", "?"].map(nullLikeOf)).toEqual(["unknownStated", "unknownStated"]);
    expect(["a response box is desirable", "0", "nothing but an EEG"].map(nullLikeOf)).toEqual([null, null, null]);
  });

  it("splits a keyword cell on commas only", () => {
    expect(termsOf("press/no-press task, invented  views ,")).toEqual(["press/no-press task", "invented views"]);
    expect(termsOf("N1x,P9z")).toEqual(["N1x", "P9z"]);
    expect(termsOf("error + pretend processing")).toEqual(["error + pretend processing"]);
    expect(termsOf(null)).toEqual([]);
  });
});

describe("validated lists", () => {
  const sheet: Pick<WorkbookSheet, "validations"> = {
    validations: [
      { ranges: ["F2:F9", "F11"], type: "list", options: ["sig", "null"] },
      // The same rule over the same cells is stated once.
      { ranges: ["F2:F9", "F11"], type: "list", options: ["sig", "null"] },
      { ranges: ["G2:G9"], type: "list", options: ["no", "yes ", "cancelled"] },
      { ranges: ["B2:B9"], type: "list", options: null },
      { ranges: ["C2"], type: "whole", options: null },
    ],
  };

  it("are stored as annotations of their tab and read back with every option verbatim", () => {
    const rows = validationRows(sheet);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ rowClass: "annotation", cellLevel: true });
      expect(row.rowKey).toMatch(/^validation__[0-9a-f]{20}$/);
      expect(isValidationRow(row)).toBe(true);
    }
    expect(validatedLists(rows).map(({ ranges, options }) => ({ ranges, options }))).toEqual([
      // The text `null` is an option like any other, and a trailing space is part of an option.
      { ranges: ["F2:F9", "F11"], options: ["sig", "null"] },
      { ranges: ["G2:G9"], options: ["no", "yes ", "cancelled"] },
    ]);
  });

  it("span rows of one column, which a range of another column or of several does not", () => {
    expect(rowsInColumn("F2:F39", "F")).toEqual({ top: 2, bottom: 39 });
    expect(rowsInColumn("W10", "W")).toEqual({ top: 10, bottom: 10 });
    expect(rowsInColumn("F2:G39", "F")).toBeNull();
    expect(rowsInColumn("G2:G39", "F")).toBeNull();
    expect(rowsInColumn("F:F", "F")).toBeNull();
  });

  it("are told apart from the cells of the sheet", () => {
    const stray: SourceRow = {
      rowClass: "annotation",
      rowNumber: 2,
      rowKey: "row__0123456789ab__1",
      cells: [{ v: "a stray note", t: "string" }],
      labels: ["J"],
      cellLevel: true,
    };
    expect(isValidationRow(stray)).toBe(false);
    expect(validatedLists([stray])).toEqual([]);
  });
});
