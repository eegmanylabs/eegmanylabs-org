// Unit tests of how the importer of the list of studies reads its workbook. The workbook is
// the synthetic fixture: every study, person, note and address in it is invented.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { shortHash, sourceTabKey } from "@eegml/shared";
import { afterAll, describe, expect, it } from "vitest";
import { type ListOfStudiesOptions, listOfStudiesWorkbook } from "../fixtures/list-of-studies";
import type { SourceReading, SourceTab } from "../model";
import { importer, layoutOf, RemarkScreen, stageNumberOf, TAB_TITLES } from "./list-of-studies";

/** The secret of the keyed hash in these tests. This importer keys no row with it. */
const READ_CONTEXT = { secret: "a-synthetic-hash-key-for-the-import-tests" };

const directory = mkdtempSync(path.join(tmpdir(), "eegml-list-of-studies-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

let files = 0;
async function reading(options: ListOfStudiesOptions = {}): Promise<SourceReading> {
  files += 1;
  const file = path.join(directory, `list-${files}.xlsx`);
  writeFileSync(file, await listOfStudiesWorkbook(options));
  return importer.read({ path: file, observedOn: "2026-11-09" }, READ_CONTEXT);
}

const tab = (read: SourceReading, title: string): SourceTab => {
  const found = read.tabs.find((candidate) => candidate.name === title);
  if (found === undefined) throw new Error(`The reading holds no tab ${title}.`);
  return found;
};
const dataKeys = (found: SourceTab) => found.rows.filter((row) => row.rowClass === "data").map((row) => row.rowKey);
const doiRowKey = (doi: string) => `doi__${shortHash(doi.toLowerCase())}`;

describe("layoutOf", () => {
  const labels = ["A", "B", "C", "D", "E"];

  it("takes the row-2 text of a column as its header, and the row-1 text only where row 2 is blank", () => {
    const layout = layoutOf(
      "ranked",
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
      [
        // `KEYWORDS` stands above a column that has a header of its own, so it is a banner and names nothing.
        [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          "INVENTED KEYWORD BANNER",
          null,
          "Votes count",
          null,
          "AN INVENTED BANNER",
        ],
        [
          "Authors",
          "Year",
          " Title ",
          "Journal",
          "Abstract",
          "DOI",
          "Main outcome variable (ERP component, EEG phenomenon)",
          "Psychological Construct",
          "Other Descriptors",
          null,
          "Group1",
          "Group2",
        ],
      ],
    );
    expect(Object.fromEntries(layout.columns)).toEqual({
      authors: "A",
      year: "B",
      title: "C",
      journal: "D",
      abstract: "E",
      doi: "F",
      outcome: "G",
      construct: "H",
      descriptors: "I",
      votes: "J",
    });
    expect(layout.groups).toEqual(["K", "L"]);
    expect(layout).toMatchObject({ missing: [], duplicated: [], unknown: [], unheaded: [], groupsConsecutive: true });
  });

  it("matches a long header on its stable beginning, with white space collapsed and the micro sign taken literally", () => {
    const layout = layoutOf("questionnaires", labels, [
      ["Name ", "Duration,  min", "In which study from the list it was used"],
    ]);
    expect([...layout.columns.keys()]).toEqual(["questionnaireName", "questionnaireDuration", "questionnaireStudy"]);
    const extraction = layoutOf("subproject", labels, [
      [" ", "Abstract", "Data extractor", null, null],
      [
        null,
        null,
        null,
        "Statistics from the original paper (t, F, p values, effect sizes including µV effect size where available)",
        "Notes. Comments\n",
      ],
    ]);
    // The first column has a header of one space, which is none: it is the citation column by position.
    expect(extraction.columns.get("citation")).toBe("A");
    expect(extraction.columns.get("statistics")).toBe("D");
    expect(extraction.columns.get("notes")).toBe("E");
    // A Greek mu is another letter than the micro sign, and no beginning of a header at all.
    const greek = layoutOf("subproject", labels, [[null, null, null, "Statistics in μV", null]]);
    expect(greek.columns.has("statistics")).toBe(false);
    expect(greek.unknown).toEqual([{ label: "D", header: "Statistics in μV" }]);
  });

  it("reports a header that is missing, one that stands twice, one it does not know and a column without any", () => {
    const layout = layoutOf("questionnaires", labels, [
      ["Name", "Name", "A new column", null, "In which study from the list it was used"],
    ]);
    expect(layout.missing).toEqual(["questionnaireDuration"]);
    expect(layout.duplicated).toEqual(["questionnaireName"]);
    expect(layout.unknown).toEqual([{ label: "C", header: "A new column" }]);
    expect(layout.unheaded).toEqual(["D"]);
    // A header of another tab is no header of this one.
    expect(layoutOf("questionnaires", labels, [["StudyID"]]).unknown).toEqual([{ label: "A", header: "StudyID" }]);
  });

  it("notices group columns that do not stand side by side", () => {
    const layout = layoutOf("ranked", labels, [
      [null, null, null, null, null],
      ["Group1", "Group2", "Title", "Group3", null],
    ]);
    expect(layout.groups).toEqual(["A", "B", "D"]);
    expect(layout.groupsConsecutive).toBe(false);
  });
});

describe("reading the synthetic list of studies", () => {
  it("reads all six tabs, the hidden ones included, each under the hash of its exact title", async () => {
    const read = await reading();
    expect(read.issues).toEqual([]);
    expect(read.tabs.map((found) => [found.name, found.visibility, found.headerRow])).toEqual([
      ["list of studies", "visible", 2],
      ["shortlist_archived", "visible", 2],
      ["allranked_archived", "visible", 2],
      ["questionnaires", "hidden", 2],
      ["AlphaAsymmetry_RSSubproject", "visible", 2],
      ["Sheet5", "hidden", undefined],
    ]);
    for (const found of read.tabs) expect(found.tabKey).toBe(sourceTabKey(found.name));
    expect(read.inputFiles[0]?.sha256).toBe(read.contentHash);
  });

  it("classes both header rows as headers, a banner above a single header row as a banner, and every row below as data", async () => {
    const read = await reading();
    const classes = (title: string) => {
      const counts: Record<string, number> = {};
      for (const row of tab(read, title).rows) {
        const key = row.cellLevel === true ? "validation" : row.rowClass;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    };
    expect(classes(TAB_TITLES.list)).toEqual({ header: 2, data: 8, validation: 2 });
    expect(classes(TAB_TITLES.shortlist)).toEqual({ header: 2, data: 10 });
    expect(classes(TAB_TITLES.ranked)).toEqual({ header: 2, data: 14 });
    expect(classes(TAB_TITLES.questionnaires)).toEqual({ banner: 1, header: 1, data: 4 });
    expect(classes(TAB_TITLES.subproject)).toEqual({ header: 2, data: 3 });
    expect(classes(TAB_TITLES.scratch)).toEqual({ data: 3 });
  });

  it("keys a study by its folded identifier and a paper by its DOI, never by a row number", async () => {
    const read = await reading();
    expect(dataKeys(tab(read, TAB_TITLES.list))).toEqual([
      "alphabeta2001",
      "alphagamma2002",
      "delta1999",
      "epsilonvanzeta2010",
      "etatheta2005",
      "iota2004",
      "kappa2006",
      "lambda2003",
    ]);
    const shortlist = dataKeys(tab(read, TAB_TITLES.shortlist));
    const ranked = dataKeys(tab(read, TAB_TITLES.ranked));
    // One paper has one key in both tabs, whether its DOI comes from a citation, a formula or a column.
    expect(shortlist[0]).toBe(doiRowKey("10.1000/invented.2001.01"));
    expect(ranked[0]).toBe(shortlist[0]);
    // The DOI with capitals and parentheses is put in lower case for the key, and kept whole.
    expect(shortlist[1]).toBe(doiRowKey("10.1000/INVENTED(2002)02"));
    expect(ranked[1]).toBe(shortlist[1]);
    // The citation that is a HYPERLINK formula gives its DOI like any other.
    expect(shortlist[2]).toBe(doiRowKey("10.1000/invented.1999.03"));
    // The mistyped DOI of the ranked list is another key: nothing is matched on similarity.
    expect(shortlist[7]).toBe(doiRowKey("10.1000/invented.2003.08"));
    expect(ranked[7]).toBe(doiRowKey("10.1000/invented.2003.80"));
    // Rows without a DOI are keyed by a hash of their title or citation, and the raw tabs by their content.
    expect(ranked[12]).toMatch(/^text__[0-9a-f]{20}$/);
    expect(dataKeys(tab(read, TAB_TITLES.subproject)).slice(1)).toEqual([
      expect.stringMatching(/^text__[0-9a-f]{20}$/),
      expect.stringMatching(/^text__[0-9a-f]{20}$/),
    ]);
    for (const key of [...dataKeys(tab(read, TAB_TITLES.questionnaires)), ...dataKeys(tab(read, TAB_TITLES.scratch))]) {
      expect(key).toMatch(/^row__[0-9a-f]{12}__1$/);
    }
  });

  it("reads hidden columns as data and says on the header record that they are hidden", async () => {
    const list = tab(await reading(), TAB_TITLES.list);
    const header = list.rows.find((row) => row.rowKey === "header2");
    const cell = (label: string) => header?.cells[header.labels.indexOf(label)];
    expect(cell("U")).toEqual({ v: "Psychological Construct", t: "string", hiddenColumn: true });
    expect(cell("S")).toEqual({ v: "Correlational/experimental study", t: "string" });
    expect(cell("Y")).toMatchObject({ v: "Group1", hiddenColumn: true });
    const alpha = list.rows.find((row) => row.rowKey === "alphabeta2001");
    const value = (label: string) => alpha?.cells[alpha.labels.indexOf(label)];
    // The keyword cells and the names left in the group columns are in the record of the row.
    expect(value("T")).toEqual({ v: "N1x,P9z", t: "string" });
    expect(value("AP")).toEqual({ v: "Ann Voter", t: "string" });
  });

  it("keeps every cell as it is stored: a number, a text in a numeric column, white space, a formula and a link target", async () => {
    const list = tab(await reading(), TAB_TITLES.list);
    const cell = (rowKey: string, label: string) => {
      const row = list.rows.find((candidate) => candidate.rowKey === rowKey);
      return row?.cells[row.labels.indexOf(label)];
    };
    expect(cell("alphabeta2001", "G")).toEqual({ v: 19, t: "number" });
    expect(cell("alphagamma2002", "G")).toEqual({ v: "N=17 (+3 excluded)", t: "string" });
    expect(cell("delta1999", "O")).toEqual({ v: "  ", t: "string" });
    expect(cell("epsilonvanzeta2010", "Q")).toBeNull();
    expect(cell("alphabeta2001", "E")).toMatchObject({
      v: " Larger invented negativity after errors than after correct responses ",
    });
    expect(cell("delta1999", "C")).toMatchObject({
      t: "formulaString",
      f: expect.stringMatching(/^HYPERLINK\("https:\/\/doi\.org\/10\.1000\/invented\.1999\.03",/),
      v: expect.stringContaining("(1999)"),
    });
    expect(cell("epsilonvanzeta2010", "P")).toEqual({
      v: "see the invented power document for 2 analyses",
      t: "string",
      l: "https://docs.example.org/document/d/invented-power-doc)",
    });
    // The stage ends in a space, as the validated list writes it.
    expect(cell("alphabeta2001", "W")).toEqual({ v: "IPA acquired. Data collection (stage 6) ", t: "string" });
  });

  it("stores the list that validates the stage cells, read across the ampersand that splits it", async () => {
    const list = tab(await reading(), TAB_TITLES.list);
    const lists = list.rows.filter((row) => row.cellLevel === true);
    expect(lists.map((row) => row.labels[0]).sort()).toEqual(["W10", "W3:W8"]);
    for (const row of lists) {
      const [cell] = row.cells;
      const options = JSON.parse(String(cell !== null && typeof cell === "object" ? cell.v : "[]")) as string[];
      expect(options).toHaveLength(8);
      expect(options).toContain("IPA acquired. Data collection (stage 6) ");
    }
  });
});

describe("the structure checks of the list of studies", () => {
  const checks = async (options: ListOfStudiesOptions) => (await reading(options)).issues.map((issue) => issue.check);

  it("stops when a tab is missing, renamed or new, and still captures the rows of the tabs it finds", async () => {
    const renamed = await reading({
      change: (workbook) => {
        const sheet = workbook.getWorksheet("Sheet5");
        if (sheet) sheet.name = "Sheet6";
      },
    });
    expect(renamed.issues.map((issue) => issue.check)).toEqual(["tabs"]);
    expect(renamed.issues[0]?.tabKey).toBeNull();
    const unknown = tab(renamed, "Sheet6");
    expect(unknown.rows.map((row) => row.rowClass)).toEqual(["annotation", "annotation", "annotation"]);
    expect(await checks({ change: (workbook) => workbook.removeWorksheet("questionnaires") })).toEqual(["tabs"]);
    expect(
      await checks({
        change: (workbook) => {
          workbook.addWorksheet("a new tab").getCell("A1").value = "an invented cell";
        },
      }),
    ).toEqual(["tabs"]);
  });

  it("stops when an expected header is missing or stands twice", async () => {
    const renamed = await reading({
      change: (workbook) => {
        const sheet = workbook.getWorksheet("list of studies");
        if (sheet) sheet.getCell("G2").value = "sample size";
      },
    });
    expect(renamed.issues).toHaveLength(1);
    expect(renamed.issues[0]).toMatchObject({ check: "header", tabKey: sourceTabKey("list of studies") });
    expect(renamed.issues[0]?.found).toBe("missing: original N; twice: none");
    expect(
      await checks({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("allranked_archived");
          if (sheet) sheet.getCell("D2").value = "Title";
        },
      }),
    ).toEqual(["header"]);
  });

  it("stops when the column without a header does not hold citations, and when the group columns are broken up", async () => {
    expect(
      await checks({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("shortlist_archived");
          for (let row = 3; row <= 12; row += 1) if (sheet) sheet.getCell(row, 1).value = "an invented remark";
        },
      }),
    ).toEqual(["citationColumn"]);
    expect(
      await checks({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("allranked_archived");
          if (sheet) sheet.getCell("M2").value = "Comments";
        },
      }),
    ).toEqual(["groups"]);
  });

  it("stops when two rows carry one study identifier, and keeps both rows", async () => {
    const read = await reading({
      change: (workbook) => {
        const sheet = workbook.getWorksheet("list of studies");
        if (sheet) sheet.getCell("A4").value = "alphabeta2001";
      },
    });
    expect(read.issues.map((issue) => issue.check)).toEqual(["key"]);
    expect(dataKeys(tab(read, TAB_TITLES.list)).slice(0, 2)).toEqual(["alphabeta2001", "alphabeta2001__2"]);
  });

  it("keeps a row that names no study as an annotation, and reports a file that is no workbook", async () => {
    const read = await reading({
      change: (workbook) => {
        const sheet = workbook.getWorksheet("list of studies");
        if (sheet) sheet.getCell("B12").value = "an invented remark below the table";
      },
    });
    expect(read.issues).toEqual([]);
    const last = tab(read, TAB_TITLES.list)
      .rows.filter((row) => row.cellLevel !== true)
      .at(-1);
    expect(last).toMatchObject({ rowClass: "annotation", rowNumber: 12 });
    expect(tab(read, TAB_TITLES.list).blankRows).toBe(1);
    const file = path.join(directory, "page.xlsx");
    writeFileSync(file, "<html>Sign in to continue</html>");
    const page = await importer.read({ path: file, observedOn: "2026-11-09" }, READ_CONTEXT);
    expect(page.issues.map((issue) => issue.check)).toEqual(["format"]);
    expect(page.tabs).toEqual([]);
  });
});

describe("the readings of the list of studies", () => {
  it("reads a stage number from the pattern in parentheses and from nothing else", () => {
    expect(stageNumberOf("Looking for replicating labs (stage 3)")).toBe(3);
    expect(stageNumberOf("IPA acquired. Data collection (stage 6) ")).toBe(6);
    expect(stageNumberOf("Data collection completed. Stage 2 RR submitted.")).toBeNull();
    expect(stageNumberOf("Completed")).toBeNull();
    expect(stageNumberOf("Currently put on hold")).toBeNull();
  });

  it("holds back a value cell that names a person of the workbook, a date or an address", () => {
    const screen = new RemarkScreen();
    screen.addNames("Lin Extractor; Moe Checker");
    screen.addNames("Zoë Exemple-Mockup");
    // A cell with a remark in it is no list of names, so nothing is taken from it.
    screen.addNames("Cal Voter (see the invented page, Maybe later)");
    expect(screen.holdsRemark("r = .42, as Checker computed it")).toBe(true);
    expect(screen.holdsRemark("see Zoe for the second analysis")).toBe(true);
    expect(screen.holdsRemark("ask Mockup")).toBe(true);
    expect(screen.holdsRemark("2024-03-05: recheck, d = 0.4")).toBe(true);
    expect(screen.holdsRemark("rechecked on 05.03.24")).toBe(true);
    expect(screen.holdsRemark("see the mail from zed@example.org")).toBe(true);
    // A statistic, a lower-case word that is also a name, and a word of the remark are no reason to hold a cell back.
    expect(screen.holdsRemark("F(2,58)=5.12, P<0.05")).toBe(false);
    expect(screen.holdsRemark("the checker task, 2 blocks of 2007 trials")).toBe(false);
    expect(screen.holdsRemark("Maybe 35 minutes")).toBe(false);
    expect(screen.holdsRemark("Cal")).toBe(false);
  });
});
