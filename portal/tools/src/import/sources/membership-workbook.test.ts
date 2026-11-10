// Unit tests of how the importer of the membership and contributor workbook (source G) reads
// its workbook and checks its structure. The workbook is the synthetic fixture, which encodes
// only what the project brief states: every person, address (on example.org) and term in it is
// invented, and nothing here is a fact about the real workbook.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { contributorTableId, sourceTabKey } from "@eegml/shared";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONFIRMED_STUDY_HEADERS,
  type MembershipWorkbookOptions,
  membershipWorkbook,
  SPECIAL_TERMS,
  TABLE_FILE_IDENTIFIERS,
} from "../fixtures/membership-workbook";
import type { RawCell, SourceReading, SourceRow, SourceTab } from "../model";
import { SOURCE_DEFINITIONS, SYNTHETIC_FIXTURES_ONLY } from "../registry";
import { importer, TAB_TITLES } from "./membership-workbook";

const READ_CONTEXT = { secret: "a-synthetic-hash-key-for-the-import-tests" };
const directory = mkdtempSync(path.join(tmpdir(), "eegml-membership-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

let files = 0;
/** Reads the fixture. Unless a test says otherwise, a maintainer has confirmed the header of the study descriptions. */
async function reading(
  options: MembershipWorkbookOptions = {},
  secret = READ_CONTEXT.secret,
  confirmedHeaders: Readonly<Record<string, readonly string[]>> | null = CONFIRMED_STUDY_HEADERS,
): Promise<SourceReading> {
  files += 1;
  const file = path.join(directory, `membership-${files}.xlsx`);
  writeFileSync(file, await membershipWorkbook(options));
  return importer.read(
    { path: file, observedOn: "2026-11-09" },
    { secret, ...(confirmedHeaders === null ? {} : { confirmedHeaders }) },
  );
}

const tab = (read: SourceReading, title: string): SourceTab => {
  const found = read.tabs.find((candidate) => candidate.name === title);
  if (found === undefined) throw new Error(`The reading holds no tab ${title}.`);
  return found;
};
const dataOf = (found: SourceTab): SourceRow[] => found.rows.filter((row) => row.rowClass === "data");
const cell = (row: SourceRow | undefined, label: string): RawCell | undefined => row?.cells[row.labels.indexOf(label)];
const checks = async (options: MembershipWorkbookOptions) =>
  (await reading(options)).issues.map((issue) => issue.check).sort();
const canonical = (value: unknown) => JSON.stringify(value);

describe("the registry entry of source G", () => {
  it("says that the importer is built against synthetic fixtures only", () => {
    const definition = SOURCE_DEFINITIONS.find((candidate) => candidate.key === importer.sourceKey);
    expect(definition?.notes).toBe(SYNTHETIC_FIXTURES_ONLY);
    expect(importer.summary).toContain("synthetic fixtures only");
  });
});

describe("reading the member tab", () => {
  it("finds the header below the title line, and classes every row", async () => {
    const read = await reading();
    expect(read.issues).toEqual([]);
    const members = tab(read, TAB_TITLES.members);
    expect(members).toMatchObject({
      tabKey: sourceTabKey("list_members"),
      visibility: "visible",
      headerRow: 3,
      blankRows: 1,
    });
    expect(members.rows.map((row) => row.rowClass)).toEqual(["banner", "header", ...Array(7).fill("data")]);
    // Every member row says which of its cells name the person or hold an address: name, surname and the two addresses.
    expect(dataOf(members).every((row) => canonical(row.personal) === canonical(["A", "B", "C", "D"]))).toBe(true);
  });

  it("counts a row of unticked boxes as filler and stores none of them", async () => {
    const read = await reading({ fillerRows: 40 });
    expect(read.issues).toEqual([]);
    const members = tab(read, TAB_TITLES.members);
    expect(members.fillerRows).toBe(40);
    expect(dataOf(members)).toHaveLength(7);
  });

  it("keys a row by the keyed hash of its address, else of its name, and never by a value that can be read", async () => {
    const data = dataOf(tab(await reading(), TAB_TITLES.members));
    expect(data.map((row) => row.rowKey.replace(/[0-9a-f]{20}/, "#"))).toEqual([
      "m__#__1",
      "m__#__1",
      // A row without any address is keyed by its folded name.
      "n__#__1",
      // The primary cell holds two addresses, so the secondary address keys the row.
      "m__#__1",
      // Two rows with one address, written in two cases, share a stem and differ by their ordinal.
      "m__#__1",
      "m__#__2",
      "m__#__1",
    ]);
    expect(data[4]?.rowKey.slice(0, -1)).toBe(data[5]?.rowKey.slice(0, -1));
    expect(JSON.stringify(data.map((row) => row.rowKey))).not.toMatch(/ada|example|twin|@/i);
    // Another secret gives other keys: without the secret a key cannot be checked against a guess.
    const other = dataOf(tab(await reading({}, `${READ_CONTEXT.secret}-other`), TAB_TITLES.members));
    expect(other[0]?.rowKey).not.toBe(data[0]?.rowKey);
  });

  it("takes the gender and ethnicity cells out of the row, and leaves a marker with a keyed hash in their place", async () => {
    const data = dataOf(tab(await reading(), TAB_TITLES.members));
    const [ada, uma, vic, , yanOne] = data;
    // Columns H and I hold gender and ethnicity. The cells themselves travel apart from the row.
    expect(ada?.special).toEqual({
      H: { v: "synthetic gender term 1", t: "string" },
      I: { v: "synthetic ethnicity term A", t: "string" },
    });
    expect(cell(ada, "H")).toEqual({ t: "specialCategory", k: expect.stringMatching(/^[0-9a-f]{20}$/) });
    // A term is kept as written, with its capitals and the space after it. A blank cell stays blank.
    expect(uma?.special).toEqual({ H: { v: "Synthetic Gender Term 2 ", t: "string" } });
    expect(cell(uma, "I")).toBeNull();
    // No special-category term is left anywhere in the rows that become source records.
    for (const term of SPECIAL_TERMS) {
      expect(JSON.stringify(data.map((row) => [row.cells, row.rowKey]))).not.toContain(term.trim());
    }
    // Rows with one term carry different markers, so that nobody can count how often a term occurs.
    const markers = [ada, vic, yanOne].map((row) => (cell(row, "H") as { k: string }).k);
    expect(new Set(markers).size).toBe(3);
    // The marker follows the value: a changed term is a new revision of the row.
    const changed = dataOf(
      tab(
        await reading({
          members: [
            {
              cells: {
                name: "Ada",
                surname: "Example",
                email: "ada.example@example.org",
                gender: "another synthetic term",
              },
            },
          ],
        }),
        TAB_TITLES.members,
      ),
    );
    expect(changed[0]?.rowKey).toBe(ada?.rowKey);
    expect((cell(changed[0], "H") as { k: string }).k).not.toBe(markers[0]);
  });

  it("reads a hidden row as data and stores that it is hidden, and that a name is struck through", async () => {
    const data = dataOf(tab(await reading(), TAB_TITLES.members));
    expect(cell(data[6], "A")).toEqual({ v: "Zed", t: "string", hiddenRow: true });
    expect(cell(data[1], "A")).toEqual({ v: "Uma", t: "string", strike: true });
    expect(cell(data[0], "A")).toEqual({ v: "Ada", t: "string" });
  });

  it("accepts headers in another case, spacing and punctuation, in row 1 as well", async () => {
    const read = await reading({
      memberHeaderRow: 1,
      memberHeaders: {
        secondaryEmail: "Secondary Email",
        eegSystem: "eeg system",
        replications: "whichReplication",
        isCoauthor: "IsCoAuthor",
      },
    });
    expect(read.issues).toEqual([]);
    expect(tab(read, TAB_TITLES.members)).toMatchObject({ headerRow: 1 });
    expect(dataOf(tab(read, TAB_TITLES.members))).toHaveLength(7);
  });
});

describe("reading the other tabs", () => {
  it("keys a row of the contributor tables by the hash of the sheet it links to, also through a hyperlink", async () => {
    const tables = tab(await reading(), TAB_TITLES.tables);
    expect(tables).toMatchObject({ headerRow: 1, visibility: "visible" });
    const data = dataOf(tables);
    const keyOf = (identifier: string) => `t__${contributorTableId(identifier).slice(8)}__1`;
    expect(data.map((row) => row.rowKey)).toEqual([
      keyOf(TABLE_FILE_IDENTIFIERS.alphaBeta),
      // The cell shows a label. The address is the target of its hyperlink.
      keyOf(TABLE_FILE_IDENTIFIERS.delta),
      keyOf(TABLE_FILE_IDENTIFIERS.iota),
      expect.stringMatching(/^t__[0-9a-f]{20}__1$/),
      // A cell that names no sheet is keyed by the keyed hash of its text.
      expect.stringMatching(/^link__[0-9a-f]{20}__1$/),
    ]);
    expect(JSON.stringify(data.map((row) => row.rowKey))).not.toContain("invented-identifier");
  });

  it("reads the hidden tab of study descriptions, whose fields the brief does not state, as rows that nothing interprets", async () => {
    const studies = tab(await reading(), TAB_TITLES.studies);
    expect(studies).toMatchObject({ visibility: "hidden", headerRow: 1, blankRows: 1 });
    expect(studies.rows.map((row) => row.rowClass)).toEqual(["header", "data", "data"]);
    expect(dataOf(studies).every((row) => /^row__[0-9a-f]{20}__1$/.test(row.rowKey))).toBe(true);
  });
});

describe("the structure check of source G", () => {
  it("stops when a tab of the brief is missing, and when the workbook holds a tab that the brief does not name", async () => {
    expect(await checks({ withoutTab: "contibutor_tables" })).toEqual(["tabs"]);
    const read = await reading({ extraTab: "payments" });
    expect(read.issues.map((issue) => issue.check)).toEqual(["unknownTab"]);
    expect(read.issues[0]).toMatchObject({ found: "payments" });
    // Nothing of the unknown tab is stored.
    expect(tab(read, "payments").rows).toEqual([]);
  });

  it("fails closed as a whole: where one tab differs from the brief, no tab gives more than its header row", async () => {
    for (const options of [
      { extraTab: "payments" },
      { withoutTab: "contibutor_tables" },
      { extraMemberColumn: { header: "Notes", value: "an invented remark" } },
      { linkHeader: "Link to the table" },
    ] satisfies MembershipWorkbookOptions[]) {
      const read = await reading(options);
      expect(read.issues.length, JSON.stringify(options)).toBeGreaterThan(0);
      const classes = new Set(read.tabs.flatMap((found) => found.rows.map((row) => row.rowClass)));
      expect([...classes], JSON.stringify(options)).toEqual(["header"]);
      // No member row means no contact detail and no special-category cell in what would be stored.
      expect(read.tabs.flatMap((found) => found.rows).some((row) => row.special !== undefined)).toBe(false);
      expect(JSON.stringify(read.tabs)).not.toMatch(/example\.org|synthetic gender|synthetic ethnicity/i);
    }
  });

  it("stops on a member row above the header, and lets no special-category cell of it reach a record", async () => {
    const above = {
      cells: {
        name: "Quin",
        surname: "Strayed",
        email: "quin.strayed@example.org",
        gender: "an invented term of a strayed row",
        ethnicity: "another invented term of a strayed row",
      },
    };
    const read = await reading({ aboveHeader: above });
    expect(read.issues.map((issue) => issue.check)).toEqual(["rowAboveHeader"]);
    expect(read.issues[0]?.message).toContain("1 rows above the header");
    expect(JSON.stringify(read)).not.toMatch(/strayed/i);
    // A row above the header that holds one special-category cell and nothing else stops the import as well.
    const lone = await reading({ aboveHeader: { cells: { gender: "an invented term of a strayed row" } } });
    expect(lone.issues.map((issue) => issue.check)).toEqual(["rowAboveHeader"]);
    expect(JSON.stringify(lone)).not.toMatch(/strayed/i);
  });

  it("reads the rows of the study descriptions only under the header list that a maintainer has confirmed", async () => {
    // Nothing is confirmed yet: the header is kept and reported, the rows are not stored, and the import stops.
    const first = await reading({}, READ_CONTEXT.secret, null);
    expect(first.issues).toEqual([
      expect.objectContaining({
        check: "unconfirmedHeaders",
        tabKey: sourceTabKey("study_description"),
        found: "StudyID | Description",
      }),
    ]);
    expect(first.issues[0]?.message).toContain("Its 2 rows are not stored");
    expect(JSON.stringify(first.tabs)).not.toContain("invented description");
    // The confirmed list is checked on every run: a column that appears later stops the import again.
    const grown = await reading({ studyHeaders: ["StudyID", "Description", "Contact"] });
    expect(grown.issues.map((issue) => issue.check)).toEqual(["unconfirmedHeaders"]);
    expect(grown.issues[0]).toMatchObject({ expected: "StudyID | Description", found: "StudyID | Description | Contact" });
    expect(JSON.stringify(grown.tabs)).not.toContain("an invented value of a further column");
  });

  it("refuses a tab of study descriptions with a column of personal or special-category data, whatever is confirmed", async () => {
    for (const header of ["Gender", "ethnicity", "E-mail", "secondary_email", "Name"]) {
      const studyHeaders = ["StudyID", "Description", header];
      const read = await reading({ studyHeaders }, READ_CONTEXT.secret, { study_description: studyHeaders });
      expect(read.issues.map((issue) => issue.check), header).toEqual(["studyHeaders"]);
      expect(read.issues[0]?.found).toBe(header);
      expect(JSON.stringify(read.tabs)).not.toContain("an invented value of a further column");
    }
  });

  it("names the columns that are missing, and stores no member row while the structure is not what the brief states", async () => {
    const read = await reading({ memberHeaders: { ethnicity: null, country: null } });
    expect(read.issues).toEqual([
      expect.objectContaining({
        check: "missingHeader",
        tabKey: sourceTabKey("list_members"),
        expected: "country | ethnicity",
        message: "The header of the tab list_members, in row 3, lacks 2 of its 11 expected columns.",
      }),
    ]);
    // Only the header is kept: no cell of a member reaches a source record before the structure is confirmed.
    expect(tab(read, TAB_TITLES.members).rows.map((row) => row.rowClass)).toEqual(["header"]);
    // The other tabs are as the brief states. They are not read either, because the workbook is read as a whole.
    expect(dataOf(tab(read, TAB_TITLES.tables))).toHaveLength(0);
  });

  it("names every column that it does not recognise, with its letter in the message and its header in the report", async () => {
    const read = await reading({
      extraMemberColumn: { header: "Gender identity (free text)", value: "an invented answer" },
    });
    expect(read.issues).toHaveLength(1);
    expect(read.issues[0]).toMatchObject({ check: "unknownHeader", found: "L: Gender identity (free text)" });
    expect(read.issues[0]?.message).toContain("1 columns that the importer does not recognise: L.");
    // The message quotes no header and no cell. A column that is not recognised may hold anything.
    expect(read.issues[0]?.message).not.toContain("Gender identity");
    expect(JSON.stringify(read.tabs)).not.toContain("an invented answer");
  });

  it("stops on data under a blank header, on a header that stands twice and on a tab without a header row", async () => {
    expect(await checks({ extraMemberColumn: { header: null, value: "an invented remark" } })).toEqual(["blankHeader"]);
    expect(await checks({ memberHeaders: { secondaryEmail: "E-mail" } })).toEqual(["duplicateHeader", "missingHeader"]);
    expect(await checks({ memberHeaderRow: 12 })).toEqual(["headerRow"]);
    expect(await checks({ linkHeader: "Link to the table" })).toEqual(["missingHeader", "unknownHeader"]);
  });
});
