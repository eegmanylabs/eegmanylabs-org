// Unit tests of how the importer of the prediction-market hypotheses reads its workbook. The
// workbook is the synthetic fixture: every study, hypothesis, label, note and address in it is
// invented.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { predictionMarketItemId, sourceTabKey } from "@eegml/shared";
import { afterAll, describe, expect, it } from "vitest";
import {
  type PredictionMarketOptions,
  predictionMarketWorkbook,
  REVIEW_STATUS_LABEL,
} from "../fixtures/prediction-market";
import type { RawCell, SourceReading, SourceRow, SourceTab } from "../model";
import { importer, REVIEW_STATUS, TAB_TITLES } from "./prediction-market";

/** The secret of the keyed hash in these tests. This importer keys no row with it. */
const READ_CONTEXT = { secret: "a-synthetic-hash-key-for-the-import-tests" };

const directory = mkdtempSync(path.join(tmpdir(), "eegml-prediction-market-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

let files = 0;
async function reading(options: PredictionMarketOptions = {}): Promise<SourceReading> {
  files += 1;
  const file = path.join(directory, `market-${files}.xlsx`);
  writeFileSync(file, await predictionMarketWorkbook(options));
  return importer.read({ path: file, observedOn: "2026-11-09" }, READ_CONTEXT);
}

const tab = (read: SourceReading, title: string): SourceTab => {
  const found = read.tabs.find((candidate) => candidate.name === title);
  if (found === undefined) throw new Error(`The reading holds no tab ${title}.`);
  return found;
};
const rowsOf = (found: SourceTab, rowClass: string) =>
  found.rows.filter((row) => row.rowClass === rowClass && row.cellLevel !== true);
const cell = (row: SourceRow | undefined, label: string): RawCell | undefined => row?.cells[row.labels.indexOf(label)];
const checks = async (options: PredictionMarketOptions) => (await reading(options)).issues.map((issue) => issue.check);

describe("reading the hypotheses tab", () => {
  it("reads hidden rows as data and stores with every cell that its row is hidden", async () => {
    const read = await reading();
    expect(read.issues).toEqual([]);
    const hypotheses = tab(read, TAB_TITLES.hypotheses);
    expect(hypotheses).toMatchObject({ visibility: "visible", headerRow: 1, blankRows: 3 });
    const data = rowsOf(hypotheses, "data");
    expect(data).toHaveLength(12);
    const hidden = data.filter((row) => row.cells.some((entry) => typeof entry === "object" && entry?.hiddenRow));
    expect(hidden.map((row) => row.rowKey)).toEqual(["kappa2006__h01", "kappa2006__h02"]);
    expect(cell(hidden[0], "G")).toEqual({ v: "cancelled", t: "string", hiddenRow: true });
    // A visible row carries no such flag.
    expect(cell(data[0], "A")).toEqual({ v: "AlphaBeta2001", t: "string" });
  });

  it("keys a row by its folded study and its hypothesis number, never by its row number", async () => {
    const data = rowsOf(tab(await reading(), TAB_TITLES.hypotheses), "data");
    expect(data.map((row) => row.rowKey)).toEqual([
      "alphabeta2001__h01",
      "alphabeta2001__h02",
      "alphagamma2002__h01",
      "delta1999__h01",
      "delta1999__h02",
      "delta1999__h03",
      // The identifier with a diacritic folds to the usual spelling.
      "epsilonvanzeta2010__h01",
      "etatheta2005__h01",
      "iota2004__h01",
      "kappa2006__h01",
      "kappa2006__h02",
      "lambda2003__h01",
    ]);
  });

  it("keeps the text null, a blank beside a label, a number as a number, and the target of a link beside its label", async () => {
    const data = rowsOf(tab(await reading(), TAB_TITLES.hypotheses), "data");
    const second = data[1];
    expect(cell(second, "F")).toEqual({ v: "null", t: "string" });
    expect(cell(second, "D")).toEqual({ v: 2, t: "number" });
    expect(cell(second, "I")).toEqual({ v: 2001, t: "number" });
    // A blank `replicated` cell is no cell at all, which is another thing than the label `no`.
    expect(cell(data[2], "G")).toBeNull();
    expect(cell(data[0], "G")).toEqual({ v: "no", t: "string" });
    expect(cell(data[8], "C")).toEqual({
      v: "Itoa2004",
      t: "string",
      l: "https://docs.example.org/document/d/invented-infosheet-iota/edit?usp=sharing",
    });
    expect(cell(data[8], "E")).toMatchObject({ v: "Alpha  power decreases over  the attended side " });
    // The DOI of the last study is in the target of its citation only.
    const citation = cell(data[11], "K");
    expect(citation).toMatchObject({ l: "https://doi.org/10.1000/invented.2003.08" });
    expect(String(typeof citation === "object" ? citation?.v : "")).not.toContain("10.1000");
  });

  it("stores the footer cells as annotations, with the formula of the counter and its cached text, and parses none", async () => {
    const hypotheses = tab(await reading(), TAB_TITLES.hypotheses);
    const footer = rowsOf(hypotheses, "annotation");
    expect(footer.map((row) => row.rowNumber)).toEqual([14, 16, 19]);
    for (const row of footer) expect(row.rowKey).toMatch(/^row__[0-9a-f]{12}__1$/);
    expect(cell(footer[0], "F")).toEqual({ v: "3/12", t: "string" });
    // The counter stands under a date format. Its cached value is the text that the formula gave, and no date.
    expect(cell(footer[0], "G")).toEqual({
      v: "1/3",
      t: "formulaString",
      f: 'COUNTIF(G2:G13,"yes") & "/" & (COUNTIF(G2:G13,"no")+COUNTIF(G2:G13,"yes"))',
    });
    expect(cell(footer[1], "F")).toEqual({ v: "10 hypotheses left (08.2026)", t: "string" });
    expect(cell(footer[2], "C")).toMatchObject({
      v: "Invented general information",
      l: "https://docs.example.org/document/d/invented-general-information/edit?usp=sharing",
    });
  });

  it("ends the data at the first row that fails the test of a data row", async () => {
    const hypotheses = tab(
      await reading({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet) sheet.getCell("D8").value = "one";
        },
      }),
      TAB_TITLES.hypotheses,
    );
    // Row 8 has no numeric hypothesis number, so it and every row below it are no hypotheses.
    expect(rowsOf(hypotheses, "data").map((row) => row.rowNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(rowsOf(hypotheses, "annotation")).toHaveLength(6 + 3);
  });

  it("stores the two validated lists with their options verbatim", async () => {
    const hypotheses = tab(await reading(), TAB_TITLES.hypotheses);
    const lists = hypotheses.rows.filter((row) => row.cellLevel === true);
    const options = new Set(lists.map((row) => String(typeof row.cells[0] === "object" ? row.cells[0]?.v : "")));
    expect([...options].sort()).toEqual(['["no","yes","cancelled"]', '["sig","null"]']);
  });
});

describe("the structure checks of the prediction-market workbook", () => {
  it("stops when a tab is missing, renamed or new", async () => {
    expect(await checks({ change: (workbook) => workbook.removeWorksheet("review") })).toEqual(["tabs"]);
    expect(
      await checks({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("questions4MarketsNSurvey");
          if (sheet) sheet.name = "questions";
        },
      }),
    ).toEqual(["tabs"]);
    expect(
      await checks({
        change: (workbook) => {
          workbook.addWorksheet("a new tab").getCell("A1").value = "an invented cell";
        },
      }),
    ).toEqual(["tabs"]);
  });

  it("accepts the eleven headers in any order, and stops when one is missing", async () => {
    const reordered = await reading({
      change: (workbook) => {
        const sheet = workbook.getWorksheet("links_hypotheses");
        if (sheet === undefined) return;
        // The hypothesis text and the number change places, in every row.
        for (let row = 1; row <= 13; row += 1) {
          const [number, text] = [sheet.getCell(row, 4).value, sheet.getCell(row, 5).value];
          sheet.getCell(row, 4).value = text;
          sheet.getCell(row, 5).value = number;
        }
      },
    });
    expect(reordered.issues).toEqual([]);
    expect(rowsOf(tab(reordered, TAB_TITLES.hypotheses), "data")).toHaveLength(12);
    expect(
      await checks({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet) sheet.getCell("G1").value = "outcome";
        },
      }),
    ).toEqual(["header", "columns"]);
  });

  it("stops when one of the empty columns beyond the eleven gains a header or a value", async () => {
    const gained = await reading({
      change: (workbook) => {
        const sheet = workbook.getWorksheet("links_hypotheses");
        if (sheet) sheet.getCell("M5").value = "an invented remark";
      },
    });
    expect(gained.issues.map((issue) => issue.check)).toEqual(["columns"]);
    // The message names how many columns, and quotes nothing that stands in them.
    expect(JSON.stringify(gained.issues)).not.toContain("invented remark");
    expect(
      await checks({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet) sheet.getCell("L1").value = "a new field";
        },
      }),
    ).toEqual(["columns"]);
  });

  it("stops when the validated range of a status column is not the rows of the data", async () => {
    const read = await reading({
      change: (workbook) => {
        const sheet = workbook.getWorksheet("links_hypotheses");
        if (sheet === undefined) return;
        // A thirteenth hypothesis below the validated range: the two statements of the extent disagree.
        for (let column = 1; column <= 11; column += 1)
          sheet.getCell(14, column).value = sheet.getCell(13, column).value;
        sheet.getCell("D14").value = 2;
      },
    });
    expect(read.issues.map((issue) => issue.check)).toEqual(["extent", "extent"]);
    expect(read.issues[0]).toMatchObject({ expected: "rows 2 to 14", found: "rows 2 to 13" });
  });
});

describe("reading the review tab", () => {
  it("stores the status column, whose header is blank, under a name of its own and says that the header was blank", async () => {
    const review = tab(await reading(), TAB_TITLES.review);
    expect(review).toMatchObject({ visibility: "hidden", headerRow: 1 });
    const [header] = rowsOf(review, "header");
    expect(header?.labels).toEqual(["A", REVIEW_STATUS, "C"]);
    expect(cell(header, REVIEW_STATUS)).toEqual({ v: null, t: "empty", headerBlank: true });
    const data = rowsOf(review, "data");
    expect(data.map((row) => row.rowKey)).toEqual([
      "alphabeta2001",
      "alphagamma2002",
      "delta1999",
      "epsilonvanzeta2010",
      "etatheta2005",
      "iota2004",
      "kappa2006",
      "lambda2003",
    ]);
    expect(cell(data[0], REVIEW_STATUS)).toEqual({ v: REVIEW_STATUS_LABEL, t: "string" });
  });

  it("leaves the column under its letter when its content no longer fits the stored rule", async () => {
    const review = tab(
      await reading({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("review");
          if (sheet) sheet.getCell("B5").value = "to do";
        },
      }),
      TAB_TITLES.review,
    );
    expect(rowsOf(review, "header")[0]?.labels).toEqual(["A", "B", "C"]);
  });

  it("stops when a header of the review tab is missing", async () => {
    expect(
      await checks({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("review");
          if (sheet) sheet.getCell("C1").value = "remarks";
        },
      }),
    ).toEqual(["header"]);
  });
});

describe("reading the questions tab", () => {
  it("keys each row by its section and its text, with an ordinal for the question that stands twice", async () => {
    const questions = tab(await reading(), TAB_TITLES.questions);
    expect(questions.blankRows).toBe(6);
    const data = rowsOf(questions, "data");
    expect(data).toHaveLength(17);
    const first = "Question about the specific paper";
    expect(data[0]?.rowKey).toBe(predictionMarketItemId(first, "How well do you understand the hypothesis?", 1));
    // A row without bold type opens no section, whatever its wording.
    expect(data[5]?.rowKey).toBe(predictionMarketItemId(first, "Optional", 1));
    // The bold row opens a section, and the rows below it belong to that section.
    expect(data[10]?.rowKey).toBe(predictionMarketItemId("", "About you", 1));
    expect(data[11]?.rowKey).toBe(predictionMarketItemId("About you", "Age", 1));
    expect(data[14]?.rowKey).toBe(predictionMarketItemId("About you", "Shared an invented protocol", 1));
    expect(data[15]?.rowKey).toBe(predictionMarketItemId("About you", "Shared an invented protocol", 2));
    expect(new Set(data.map((row) => row.rowKey)).size).toBe(17);
  });

  it("stores the font that tells a heading from a question", async () => {
    const data = rowsOf(tab(await reading(), TAB_TITLES.questions), "data");
    expect(cell(data[10], "A")).toEqual({ v: "About you", t: "string", bold: true });
    expect(cell(data[6], "A")).toEqual({ v: "Why did you predict this?", t: "string", italic: true });
    expect(cell(data[0], "A")).toEqual({ v: "How well do you understand the hypothesis?", t: "string" });
    expect(cell(data[0], "B")).toEqual({ v: "extremely - not at all", t: "string" });
  });

  it("gives every tab the hash of its exact title as its key", async () => {
    const read = await reading();
    expect(read.tabs.map((found) => found.tabKey)).toEqual(Object.values(TAB_TITLES).map(sourceTabKey));
  });
});
