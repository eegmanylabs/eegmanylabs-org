// Unit tests of how the importer of the contributor sheets reads a workbook and is bound to a
// registered sheet. The workbooks are the synthetic fixtures: every person, affiliation, iD
// and address (on example.org) in them is invented.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { contributorNameHash, contributorSheetSourceKey } from "@eegml/shared";
import { afterAll, describe, expect, it } from "vitest";
import { ToolRefusal } from "../../environment";
import type { PrivateConfig } from "../config";
import {
  ALPHA_BETA_SHEET,
  ALPHA_GAMMA_SHEET,
  type ContributorSheetFixture,
  contributorWorkbook,
  DELTA_SHEET,
  EPSILON_SHEET,
  type FixtureRow,
  personRow,
  roleNote,
  sheetColumns,
  YELLOW,
} from "../fixtures/contributor-sheets";
import type { RawCell, SourceReading, SourceRow } from "../model";
import { importer } from "./contributor-sheets";

const SECRET = "a-synthetic-hash-key-for-the-import-tests";
const FILE_IDENTIFIER = "an-invented-file-identifier-of-a-sheet";
const CONFIG: PrivateConfig = {
  hashKey: SECRET,
  sources: {},
  contributorSheets: {
    "alpha-beta": {
      externalId: FILE_IDENTIFIER,
      replicationId: "AlphaBeta2001",
      exportUrl: "https://sheets.example.org/invented/export?format=xlsx",
    },
  },
};

const directory = mkdtempSync(path.join(tmpdir(), "eegml-contributor-sheets-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const bound = () => {
  const selected = importer.select?.({ selector: "alpha-beta", config: CONFIG });
  if (selected === undefined) throw new Error("The importer of the contributor sheets selects no sheet.");
  return selected;
};

let files = 0;
async function reading(fixture: ContributorSheetFixture): Promise<SourceReading> {
  files += 1;
  const file = path.join(directory, `sheet-${files}.xlsx`);
  writeFileSync(file, await contributorWorkbook(fixture));
  return bound().read({ path: file, observedOn: "2026-11-09" }, { secret: SECRET });
}

const rowsOf = (read: SourceReading, rowClass: string): SourceRow[] =>
  (read.tabs[0]?.rows ?? []).filter((row) => row.rowClass === rowClass && row.cellLevel !== true);
const cell = (row: SourceRow | undefined, label: string): RawCell | undefined => row?.cells[row.labels.indexOf(label)];
const keyOf = (first: string, surname: string, ordinal = 1) =>
  `c__${contributorNameHash(first, surname, SECRET)}__${ordinal}`;
const withRows = (fixture: ContributorSheetFixture, rows: readonly FixtureRow[]): ContributorSheetFixture => ({
  ...fixture,
  rows,
});

describe("the selection of a contributor sheet", () => {
  it("binds the importer to a registered sheet, under a source key that holds no file identifier", () => {
    const selected = bound();
    expect(selected.sourceKey).toBe(contributorSheetSourceKey(FILE_IDENTIFIER));
    expect(selected.sourceKey).toMatch(/^ctable-[0-9a-f]{20}$/);
    expect(selected.source).toMatchObject({ key: selected.sourceKey, kind: "googleSheet", authority: "live" });
    // The registry entry names the replication, and neither the identifier nor an address of the file.
    expect(JSON.stringify(selected.source)).not.toMatch(/invented-file-identifier|https?:/);
    expect(selected.source?.title).toContain("AlphaBeta2001");
    // The location is private. It reaches the location document of the registry and nothing else.
    expect(selected.location).toEqual({
      externalId: FILE_IDENTIFIER,
      exportUrl: "https://sheets.example.org/invented/export?format=xlsx",
    });
  });

  it("refuses a sheet that the private configuration does not register, and a run that names none", async () => {
    expect(() => importer.select?.({ selector: "unregistered", config: CONFIG })).toThrow(ToolRefusal);
    expect(() => importer.select?.({ selector: undefined, config: CONFIG })).toThrow(/--sheet.*alpha-beta/);
    expect(() => importer.select?.({ selector: "any", config: { hashKey: SECRET, sources: {} } })).toThrow(
      /registers no contributor sheet/,
    );
    // The family itself reads nothing: a sheet has to be named.
    expect(() => importer.read({ path: "unused", observedOn: "2026-11-09" }, { secret: SECRET })).toThrow(ToolRefusal);
    expect(importer.sourceKey).toBe("ctable");
  });
});

describe("reading a contributor sheet", () => {
  it("classifies every row of the used range, and counts the rows of unticked boxes without storing them", async () => {
    const read = await reading(ALPHA_BETA_SHEET);
    expect(read.issues).toEqual([]);
    const [tab] = read.tabs;
    expect(tab).toMatchObject({
      tabKey: "t0",
      name: "Sheet1",
      visibility: "visible",
      headerRow: 1,
      fillerRows: 40,
      blankRows: 3,
    });
    expect(rowsOf(read, "header")).toHaveLength(1);
    expect(rowsOf(read, "data")).toHaveLength(6);
    // 1 header, 6 contributors, 3 blank and 40 filler rows are the 50 rows of the used range.
    expect((tab?.rows ?? []).filter((row) => row.cellLevel !== true)).toHaveLength(7);
  });

  it("keys a contributor row by the keyed hash of its folded name, never by its row or its order", async () => {
    const read = await reading(ALPHA_BETA_SHEET);
    const data = rowsOf(read, "data");
    expect(data.map((row) => row.rowKey)).toEqual([
      keyOf("Ada", "Example"),
      keyOf("Bo", "Fictional"),
      // A space before the first name changes nothing.
      keyOf("Hal", "Nobody"),
      keyOf("Ida", "Specimen"),
      keyOf("Jo", "Mockup"),
      keyOf("Kit", "Placeholder-Sample"),
    ]);
    expect(JSON.stringify(data.map((row) => row.rowKey))).not.toMatch(/ada|example|nobody/i);
    // The same people in another order keep their keys.
    const reordered = await reading(withRows(ALPHA_BETA_SHEET, [...ALPHA_BETA_SHEET.rows.slice(0, 6)].reverse()));
    expect(rowsOf(reordered, "data").map((row) => row.rowKey)).toEqual(data.map((row) => row.rowKey).reverse());
  });

  it("keeps every cell as the file stores it: booleans, white space, a hyperlink and a number", async () => {
    const read = await reading(ALPHA_BETA_SHEET);
    const [ada, , hal] = rowsOf(read, "data");
    expect(cell(ada, "A")).toEqual({ v: 1, t: "number" });
    expect(cell(ada, "E")).toEqual({ v: true, t: "boolean" });
    expect(cell(ada, "G")).toEqual({ v: false, t: "boolean" });
    expect(cell(ada, "T")).toEqual({ v: "Ada.Example@example.org", t: "string" });
    expect(cell(hal, "B")).toEqual({ v: " Hal", t: "string" });
    const [eli] = rowsOf(await reading(EPSILON_SHEET), "data");
    expect(cell(eli, "W")).toMatchObject({ t: "string", l: expect.stringMatching(/^https:\/\/orcid\.org\//) });
  });

  it("stores a highlight and leaves the banding of the template out of the record", async () => {
    const banded = rowsOf(await reading(ALPHA_BETA_SHEET), "data")[1];
    expect(banded?.cells.every((entry) => entry === null || typeof entry !== "object" || !("fill" in entry))).toBe(
      true,
    );
    const highlighted = rowsOf(await reading(ALPHA_GAMMA_SHEET), "data")[1];
    expect(highlighted?.cells.every((entry) => typeof entry === "object" && entry?.fill === YELLOW.slice(2))).toBe(
      true,
    );
  });

  it("reads the rows after a numbered row without a name, which is a reserved position and no contributor", async () => {
    const read = await reading(EPSILON_SHEET);
    expect(read.tabs[0]).toMatchObject({ fillerRows: 30, blankRows: 0 });
    expect(rowsOf(read, "data").map((row) => row.rowKey)).toEqual([
      keyOf("Eli", "Madeup"),
      keyOf("Max", "Dummy"),
      keyOf("Nia", "Imagined"),
    ]);
    expect(rowsOf(read, "placeholder").map((row) => [row.rowKey, row.rowNumber])).toEqual([
      ["slot__3__1", 4],
      ["slot__4__1", 5],
    ]);
  });

  it("keeps the note of each role header as an annotation of the tab, keyed by its header", async () => {
    const read = await reading(DELTA_SHEET);
    const notes = (read.tabs[0]?.rows ?? []).filter((row) => row.cellLevel === true);
    expect(notes).toHaveLength(14);
    const methodology = notes.find((row) => row.rowKey === "note__methodology__1");
    // The invisible character at the start of the note is kept.
    expect(methodology?.cells).toEqual([{ v: roleNote("methodology"), t: "note" }]);
    expect(roleNote("methodology").startsWith("\u200b")).toBe(true);
    expect(notes.every((row) => row.rowClass === "annotation" && row.rowNumber === 1)).toBe(true);
  });

  it("sends a row with one name, a tick without a name and two rows of one name to their classes", async () => {
    const columns = sheetColumns();
    const read = await reading({
      columns,
      rows: [
        personRow({ order: 1, first: "Ada", surname: "Example" }),
        personRow({ order: 2, first: "ADA", surname: "example" }),
        personRow({ first: "Sam", surname: null }),
        personRow({ first: null, surname: null, roles: ["software"] }),
        personRow({ first: "?", surname: "??" }),
      ],
    });
    expect(read.issues).toEqual([]);
    expect(rowsOf(read, "data").map((row) => row.rowKey)).toEqual([
      keyOf("Ada", "Example", 1),
      keyOf("Ada", "Example", 2),
      expect.stringMatching(/^half__raw-[0-9a-f]{20}__1$/),
      // A name of which nothing is left after folding has no name key.
      expect.stringMatching(/^c__raw-[0-9a-f]{20}__1$/),
    ]);
    expect(rowsOf(read, "annotation").map((row) => row.rowKey)).toEqual([
      expect.stringMatching(/^tick__raw-[0-9a-f]{20}__1$/),
    ]);
  });
});

describe("the structure check of a contributor sheet", () => {
  const checks = async (fixture: ContributorSheetFixture) =>
    (await reading(fixture)).issues.map((issue) => issue.check);

  it("stops on a second tab and on a tab under another title", async () => {
    expect(await checks({ ...ALPHA_BETA_SHEET, secondTab: true })).toEqual(["tabs"]);
    expect(await checks({ ...ALPHA_BETA_SHEET, tabName: "Contributors" })).toEqual(["tabName"]);
  });

  it("stops when a name header or a role header is missing or stands twice, and names what is missing", async () => {
    const without = sheetColumns().filter((column) => column.key !== "surname" && column.key !== "software");
    const read = await reading({ columns: without, rows: [] });
    expect(read.issues).toHaveLength(1);
    expect(read.issues[0]).toMatchObject({ check: "header", tabKey: "t0", expected: "Surname | Software" });
    const twice = [...sheetColumns(), { header: "Validation", key: "validation", checkbox: true }];
    expect(await checks({ columns: twice, rows: [] })).toEqual(["duplicateHeader"]);
  });

  it("accepts a sheet without an order header, whose column stays unmapped", async () => {
    expect(await checks(ALPHA_GAMMA_SHEET)).toEqual([]);
  });

  it("reports a file that is no workbook as a failed check, and never throws", async () => {
    const file = path.join(directory, "not-a-workbook.xlsx");
    writeFileSync(file, "a text file with an invented content");
    const read = await bound().read({ path: file, observedOn: "2026-11-09" }, { secret: SECRET });
    expect(read.issues.map((issue) => issue.check)).toEqual(["format"]);
  });
});
