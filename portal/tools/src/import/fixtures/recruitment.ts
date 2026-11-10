// SYNTHETIC test fixture. Every person, address (all on example.org), date, result, note,
// number and link below is invented, and no row is copied from the real recruitment and contact
// workbook. What is real is public: the study identifiers, the tab titles and the column headers,
// which docs/SOURCE_REGISTRY.md lists. The builder reproduces the structure and the awkward
// cases of the real workbook:
//
// | Awkward case of the real workbook                                   | Where it is reproduced                         |
// |---------------------------------------------------------------------|------------------------------------------------|
// | Hidden tabs, tab colours, a header on row 3 and on row 4            | Every outreach tab                             |
// | A tab without a title line, and one whose first line is a bare name | `Miltner1999 replicating labs se`, `Miltner1999` |
// | A stub study line, also one that contradicts its tab                | `AmodioMaster20072008`, `Vidal2000_`           |
// | A study line without a DOI, and one whose DOI is a hyperlink        | `Miltner1999`, `Frank2005 lead`                |
// | Titles with a suffix, a cut at 31 characters, a diacritic, two years | The titles themselves                         |
// | Blank rows inside the data, a section label, name-only rows         | `DelCul2007`, `Boksem2006_labs`                |
// | A tentative name, two names in one cell, a name like an address     | `Vidal2000`, `DelCul2007`, `Onton2005 lead`, `DonkersvanBoxtel2004 lead` |
// | A reversed address, an address with a trailing space                | `DonkersvanBoxtel2004 lead`, `Onton2005 lead`  |
// | Both text forms of a date, true dates, a follow-up before the first contact | `Vidal2000`, `HajcakMoser2005`, `DonkersvanBoxtel2004 lead` |
// | Red, green and theme-coloured fills, a fill without a result, a fill over empty cells | `Boksem2006`, `HajcakMoser2005` |
// | Strike-through on a candidate, and a remark in a column without a header | `Luck1996`                                |
// | Merged cells, a pasted list of recipients, a quoted reply, a pointer to a paper | `Miltner1999`                         |
// | Links with an access token or session parameters, a link whose text ends with `#` | `DonkersvanBoxtel2004 lead`, `Onton2005 lead` |
// | Rows copied into a sibling tab, with and without a difference       | The two Boksem tabs, the two Donkers tabs      |
// | A combined identifier, a blank beside an explicit zero, more labs finished than signed | `numberOfLabsPerReplication` |
// | Struck-through studies, totals and a projection as formulas, a timeline beside the table | `numberOfLabsPerReplication` |
// | An old leader in strike-through, two leaders in one cell with a second address under no header | `leadsEmails` |
import ExcelJS from "exceljs";

type Fill = "red" | "green" | "brightGreen" | "themeRed" | "white" | "yellow";

/** One cell of the fixture: a bare value, or a value with the formatting that the workbook uses as data. */
export interface FixtureCell {
  readonly v?: string | number | Date | null;
  readonly fill?: Fill;
  readonly strike?: boolean;
  readonly bold?: boolean;
  readonly link?: string;
  /** The number format, for a true date. */
  readonly format?: string;
}
export type CellInput = string | number | null | FixtureCell;

export interface OutreachTabFixture {
  title: string;
  hidden: boolean;
  colour: "red" | "blue" | "darkBlue" | null;
  /** The lines above the header, one to a row, in column A. */
  preamble: CellInput[];
  /** The six headers. A test changes them to break the detection of the header. */
  headers: string[];
  /** The rows below the header. `null` is a row that holds nothing. */
  rows: (CellInput[] | null)[];
  /** Merged ranges, as addresses of the finished sheet. */
  merges: string[];
  /** The rows below the header that the sheet hides, by their position in `rows`, from 0. */
  hiddenRows?: number[];
}

export interface CountsRowFixture {
  study: CellInput;
  leader: CellInput;
  /** Labs signed, participants to be run, labs finished, main experiment collected, resting state collected. */
  numbers: (number | string | null)[];
}

export interface LeadsRowFixture {
  study: CellInput;
  oldLeader: CellInput;
  leader: CellInput;
  email: CellInput;
  /** A value in the column beside the address, which has no header. */
  additional?: CellInput;
}

export interface RecruitmentFixture {
  counts: {
    headers: string[];
    rows: CountsRowFixture[];
    /** Whether the totals, the medians and the projection stand below the study rows. */
    derived: boolean;
    /** The cached value of the total of the first number column, to make it stale. Left out, it is correct. */
    staleTotal?: number;
    /** Entries beside the table, in a column without a header. */
    timeline: string[];
    note: string | null;
  };
  leads: { headers: string[]; rows: LeadsRowFixture[] };
  outreach: OutreachTabFixture[];
  /** Further tabs, which the reviewed table does not know. */
  extraTabs: OutreachTabFixture[];
}

/** The studies that the tests create as replications before the workbook is imported. `Frank2005` is left out on purpose. */
export const RECRUITMENT_STUDIES = [
  "AmodioJost2007",
  "Boksem2006",
  "BuschVanRullen2010",
  "Carretie2004",
  "DelCul2007",
  "DonkersvanBoxtel2004",
  "Hajcak2003",
  "Hajcak2006",
  "HajcakMoser2005",
  "Inzlicht2009",
  "Luck1996",
  "Miltner1999",
  "Muller2003",
  "Onton2005",
  "Vidal2000",
] as const;

/** The invented DOI of the original study of a replication, as the tests give it to the database. */
export const recruitmentDoi = (studyId: string): string => `10.1000/invented.${studyId.toLowerCase()}`;

export const OUTREACH_FIXTURE_HEADERS = [
  "contact name",
  "contact email",
  "date email sent first time",
  "date follow-up email sent",
  "result",
  "notes",
];

const LEAD_SEARCH = "A search of Lead Replicating Lab";
const LAB_SEARCH = "A search of Replicating Labs";
const leadLine = (name: string) => `Lead Replicating Lab: ${name}`;
const studyLine = (studyId: string, author: string) =>
  `Study: ${author}, I. (${studyId.slice(-4)}). An invented study of nothing in particular. Journal of Examples, 1(1), 1–2. https://doi.org/${recruitmentDoi(studyId)}`;

function tab(
  title: string,
  hidden: boolean,
  colour: OutreachTabFixture["colour"],
  preamble: CellInput[],
  rows: (CellInput[] | null)[],
  merges: string[] = [],
): OutreachTabFixture {
  return { title, hidden, colour, preamble, headers: [...OUTREACH_FIXTURE_HEADERS], rows, merges };
}

/** A quoted reply, as a note of several lines. Its content is invented. */
export const QUOTED_REPLY =
  "Dear invented colleague,\nthank you for the message about the invented study.\nI have to say no this time.\nKind regards,\nUma Nemo";

/** A pasted list of recipients in one cell. Every entry is invented. */
export const RECIPIENT_LIST =
  "Vic Sham <vic.sham@example.org>; Wyn Faux <wyn.faux@example.org>;\nxan.bogus@example.org";

export const LITERATURE_POINTER =
  "An invented title of a paper that does not exist, on a topic that nobody studies, by Yul Phantom";

/** The rows that the lead-search tab of Boksem2006 holds and that its lab-search tab repeats, cell for cell. */
const BOKSEM_ROWS: CellInput[][] = [
  [
    "Kit Placeholder",
    "kit.placeholder@example.org",
    "22.08.21",
    "03.10.21",
    { v: "agreed", fill: "green" },
    "an invented remark",
  ],
  ["Lea Dummy", "lea.dummy@example.org", "22.08.21", null, { v: "declined", fill: "red" }, null],
  ["Max Mockup", null, "30.08.21", null, { v: "no reply", fill: "red" }, null],
  ["Nia Fake", "nia.fake@example.org", null, null, null, "answered an invented survey"],
];

/** A fresh copy of the synthetic workbook, which a test may change before it is built. */
export function recruitmentFixture(): RecruitmentFixture {
  const ada = "Ada Example";
  return {
    counts: {
      headers: [
        "StudyID",
        "Leader",
        "NLabsSigned",
        "TotalNSubjectsToBeRun",
        "NLabsFinished",
        "TotalNMainExpCollected",
        "TotalNRest",
      ],
      rows: [
        { study: "AmodioJost2007 + AmodioMaster2007", leader: null, numbers: [9, 410, 12, 505, 505] },
        { study: "Boksem2006", leader: ada, numbers: [5, 150, null, null, null] },
        {
          study: { v: "Carretie2004", strike: true },
          leader: { v: "Cy Invented", strike: true },
          numbers: [null, null, null, null, null],
        },
        { study: "DelCul2007", leader: ada, numbers: [6, 174, null, null, null] },
        {
          study: { v: "Frank2005", strike: true },
          leader: { v: "Dee Imaginary", strike: true },
          numbers: [null, null, null, null, null],
        },
        { study: "Hajcak2003", leader: ada, numbers: [11, 330, 13, 372, null] },
        { study: "Inzlicht2009", leader: "Ada Example ", numbers: [2, 96, 2, 101, 0] },
        { study: "Luck1996", leader: ada, numbers: [7, 210, null, null, null] },
        { study: "Miltner1999", leader: ada, numbers: [4, 128, null, null, null] },
        { study: "Muller2003", leader: ada, numbers: [5, 115, null, null, null] },
        { study: "Onton2005", leader: ada, numbers: [2, 70, null, null, null] },
        { study: "Vidal2000", leader: ada, numbers: [8, 264, 7, 251, 97] },
      ],
      derived: true,
      timeline: [
        "2019 - an invented beginning",
        "2021 - an invented second step",
        "2024.03 - an invented third step",
        "2025.02 - Zed Nobody joined an invented committee.",
      ],
      note: "an invented forecast (Zed)",
    },
    leads: {
      headers: ["StudyID", "Old leader", "Leader", "Email"],
      rows: [
        {
          study: "AmodioJost2007 + AmodioMaster2007",
          oldLeader: { v: "Hal Pretend", strike: true },
          leader: "Gus Mock",
          email: "gus.mock@example.org",
        },
        { study: "Boksem2006", oldLeader: null, leader: "Eli Madeup", email: "eli.madeup@example.org" },
        { study: "Carretie2004", oldLeader: { v: "Ivy Notreal", strike: true }, leader: "Cy Invented", email: null },
        {
          study: "DelCul2007",
          oldLeader: { v: "Jo Specimen ", strike: true },
          leader: ada,
          email: "ada.example@example.org",
        },
        { study: "Frank2005", oldLeader: null, leader: "Dee Imaginary", email: "dee.imaginary@example.org" },
        {
          study: "Hajcak2003",
          oldLeader: null,
          leader: "Ada Example, Fay Sample",
          email: "ada.example@example.org",
          additional: "fay.sample@example.org",
        },
        { study: "Inzlicht2009", oldLeader: null, leader: "Ada Example ", email: "ada.example@example.org " },
        { study: "Luck1996", oldLeader: null, leader: ada, email: "Ada.Example@example.org" },
        { study: "Miltner1999", oldLeader: null, leader: ada, email: "ada.example@example.org" },
        { study: "Muller2003", oldLeader: null, leader: ada, email: "ada.example@example.org" },
        { study: "Onton2005", oldLeader: null, leader: ada, email: "ada.example@example.org" },
        { study: "Vidal2000", oldLeader: null, leader: ada, email: null },
      ],
    },
    outreach: [
      tab(
        "Vidal2000",
        true,
        "red",
        [LEAD_SEARCH, `${studyLine("Vidal2000", "Vidal")} `],
        [
          ["Bea Contact", "bea.contact@example.org", "05.03.21", "19.04.21", { v: "no reply", fill: "red" }, null],
          ["Cal Sample?", null, "16.06.2021", null, { v: "declined", fill: "red" }, null],
          ["Dot Imagined", null, null, null, null, null],
        ],
      ),
      tab(
        "DonkersvanBoxtel2004 lead",
        true,
        "red",
        [LEAD_SEARCH, studyLine("DonkersvanBoxtel2004", "Donkers")],
        [
          [
            "Eve Unreal",
            "eve.unreal@example.org",
            "18.11.21",
            "07.02.21",
            { v: "busy with another invented project", fill: "red" },
            {
              v: "https://papers.example.org/doi/full/10.1000/invented?casa_token=AN-INVENTED-TOKEN",
              link: "https://papers.example.org/doi/full/10.1000/invented?casa_token=AN-INVENTED-TOKEN",
            },
            {
              v: "https://articles.example.org/an-invented-article#",
              link: "https://articles.example.org/an-invented-article",
            },
          ],
          ["f.unreal", "gro.elpmaxe@laernu", null, null, null, "wrote about an invented topic"],
          [
            "Gil Unreal",
            "gro.elpmaxe@laernulig",
            null,
            null,
            null,
            "see https://staff.example.org/people/gil-unreal for the page",
          ],
          ["Hua Shared", "hua.shared@example.org", "05.03.21", null, { v: "declined", fill: "red" }, null],
          ["Ian Shared", "ian.shared@example.org", null, null, null, null],
        ],
      ),
      tab(
        "Frank2005 lead",
        true,
        "red",
        [
          LEAD_SEARCH,
          { v: `${studyLine("Frank2005", "Frank")}  `, link: `https://doi.org/${recruitmentDoi("Frank2005")}` },
        ],
        [["Jay Orphan", "jay.orphan@example.org", "05.03.21", "19.04.21", null, null]],
      ),
      tab("Boksem2006", true, "red", [LEAD_SEARCH, studyLine("Boksem2006", "Boksem")], BOKSEM_ROWS),
      tab(
        "Miltner1999",
        true,
        "red",
        ["Zyx Wanderer", "Study: Miltner, I. (1999). An invented study without an address of its own."],
        [
          [
            "Lou Forwarder",
            { v: "lou.forwarder@example.org", link: "mailto:lou.forwarder@example.org" },
            "27.09.21",
            null,
            { v: "accepted", fill: "green" },
            null,
          ],
          [{ v: RECIPIENT_LIST, link: "mailto:vic.sham@example.org" }],
          ["Moe Quoted", "moe.quoted@example.org", "13.01.22", null, { v: "declined", fill: "red" }, QUOTED_REPLY],
          null,
          null,
          ["Ned Maybe?", null, null, null, null, null],
          [LITERATURE_POINTER],
        ],
        ["C4:C5", "D4:D5", "E4:E5", "A5:B5"],
      ),
      tab(
        "Miltner1999 replicating labs se",
        true,
        "darkBlue",
        [leadLine("Ada Example"), "Study: Miltner, I. (1999). An invented study without an address of its own."],
        [
          [
            "Lou Forwarder",
            { v: "lou.forwarder@example.org", link: "mailto:lou.forwarder@example.org" },
            null,
            null,
            null,
            "an invented reason to ask again",
          ],
          ["Moe Quoted", "moe.quoted@example.org", "13.01.22", null, { v: "declined", fill: "red" }, QUOTED_REPLY],
          null,
          ["look for people who answered an invented call last year"],
          null,
          ["Ned Maybe?", null, null, null, null, null],
          [LITERATURE_POINTER],
        ],
      ),
      tab(
        "Onton2005 lead",
        true,
        "red",
        [LEAD_SEARCH, studyLine("Onton2005", "Onton")],
        [
          [
            "Oda Pair, Pat Pair",
            "oda.pair@example.org ",
            "02.07.21",
            null,
            { v: "?", fill: "red" },
            {
              v: "https://papers.example.org/science/article/pii/INVENTED?via%3Dihub",
              link: "https://papers.example.org/science/article/pii/INVENTED?via%3Dihub",
            },
          ],
          [
            "Quy Reader",
            "quy.reader@example.org",
            "15.07.21",
            null,
            null,
            {
              v: "https://journals.example.org/article/1/2/3?login=false",
              link: "https://journals.example.org/article/1/2/3?login=false",
            },
          ],
        ],
      ),
      tab(
        "BuschVanRullen2010",
        true,
        "blue",
        [leadLine("Ada Example"), LAB_SEARCH, studyLine("BuschVanRullen2010", "Busch")],
        [
          [
            "Rui Staff",
            "rui.staff@example.org",
            "09.09.21",
            "28.10.21",
            {
              v: "a long invented account of how the request went from one person to the next and came back without an answer",
              fill: "red",
            },
            { v: "https://staff.example.org/people/rui-staff", link: "https://staff.example.org/people/rui-staff" },
          ],
        ],
      ),
      tab(
        "Luck1996",
        false,
        "blue",
        [leadLine("Ada Example"), LAB_SEARCH, studyLine("Luck1996", "Luck")],
        [
          ["Sam Listed", null, null, null, null, "known from an invented meeting"],
          [
            { v: "Tia Struck", strike: true },
            null,
            null,
            null,
            null,
            { v: "wrote about an invented topic", strike: true },
            "an invented remark about Tia that nobody should read",
          ],
        ],
      ),
      tab(
        "Carretie2004",
        true,
        "blue",
        [leadLine("Cy Invented"), LAB_SEARCH, studyLine("Carretie2004", "Carretié")],
        [],
      ),
      tab("Frank2005", true, "blue", [leadLine("Dee Imaginary"), LAB_SEARCH, studyLine("Frank2005", "Frank")], []),
      tab(
        "DonkersvanBoxtel2004",
        true,
        "blue",
        [leadLine("Ada Example"), LAB_SEARCH, studyLine("DonkersvanBoxtel2004", "Donkers")],
        [
          // One row with other content than its copy in the lead-search tab, and one exact copy.
          ["Hua Shared", "hua.shared@example.org", null, null, null, null],
          ["Ian Shared", "ian.shared@example.org", null, null, null, null],
        ],
      ),
      tab(
        "Müller2003 replicating labs sea",
        true,
        "blue",
        [leadLine("Ada Example"), LAB_SEARCH, studyLine("Muller2003", "Müller")],
        [["Udo Dated", null, "06.12.21", null, null, "an invented note"]],
      ),
      tab(
        "Onton2005",
        false,
        "blue",
        [leadLine("Ada Example"), LAB_SEARCH, studyLine("Onton2005", "Onton")],
        [
          ["Val Second", "val.second@example.org", "17.11.21", null, { v: "agreed", fill: "red" }, null],
          ["Wes Second", "wes.second@example.org", "17.11.21", null, { v: "no reply" }, null],
        ],
      ),
      tab(
        "AmodioMaster20072008",
        true,
        "blue",
        [leadLine("Hal Pretend"), `${LAB_SEARCH} with an invented remark`, "Study: Amodio"],
        [["Xia Unplaced", "xia.unplaced@example.org", "25.02.22", null, null, null]],
      ),
      tab(
        "Vidal2000_",
        false,
        "blue",
        [leadLine("Ada Example"), LAB_SEARCH, "Study: Amodio"],
        [["Yan Stub", null, null, null, null, null]],
      ),
      {
        ...tab(
          "Boksem2006_labs",
          false,
          "blue",
          [LAB_SEARCH, studyLine("Boksem2006", "Boksem")],
          [...BOKSEM_ROWS, null, ["Zoe Added", null, null, null, null, "an invented note"]],
        ),
      },
      tab(
        "DelCul2007",
        true,
        "blue",
        [leadLine("Jo Specimen"), LAB_SEARCH, studyLine("DelCul2007", "Del Cul")],
        [
          ["Abe First; Bex First", "abe.first@example.org", "08.01.22", null, { v: "declined", fill: "red" }, null],
          null,
          null,
          [{ v: "More invented names:", bold: true }],
          ["Cam Later", null, null, null, null, null],
          ["Dag Later", null, null, null, null, null],
        ],
      ),
      tab(
        "Inzlicht2009",
        true,
        "blue",
        [leadLine("Ada Example"), `${LAB_SEARCH} | another invented remark`, studyLine("Inzlicht2009", "Inzlicht")],
        [["Ada Example", "ada.example@example.org", "09.09.21", null, null, "an invented message for the record"]],
      ),
      tab(
        "Hajcak2006",
        true,
        "blue",
        [
          leadLine("Ada Example"),
          LAB_SEARCH,
          { v: studyLine("Hajcak2006", "Hajcak"), link: `https://doi.org/${recruitmentDoi("Hajcak2006")}` },
        ],
        [["Eda Twice", "eda.twice@example.org", "23.03.21", null, null, null]],
      ),
      tab(
        "HajcakMoser2005",
        true,
        "blue",
        [leadLine("Ada Example"), LAB_SEARCH, studyLine("HajcakMoser2005", "Hajcak")],
        [
          // True dates: 23 March 2021 can only be day first, 9 March 2021 could be the third of September.
          [
            "Eda Twice",
            "eda.twice@example.org",
            { v: new Date(Date.UTC(2021, 2, 23)), format: "d/m/yy" },
            { v: new Date(Date.UTC(2021, 4, 17)), format: "d/m" },
            { v: "no reply", fill: "themeRed" },
            null,
          ],
          ["Fay Sample (Mentor): Gus Mock", "gus.mock@example.org", null, null, null, null],
          ["Hed Ambiguous", null, { v: new Date(Date.UTC(2021, 2, 9)), format: "d/m/yy" }, null, null, null],
          [
            { v: "Ida Filled", fill: "red" },
            { v: null, fill: "red" },
            { v: "23.03.21", fill: "red" },
            { v: null, fill: "red" },
            { v: "declined", fill: "red" },
            { v: null, fill: "red" },
          ],
          [{ v: "Jun Green", fill: "brightGreen" }, "jun.green@example.org", null, null, null, null],
          [{ v: "Kai Pasted", fill: "white" }, null, null, null, null, null],
          [{ v: "Lin Yellow", fill: "yellow" }, null, null, null, null, null],
        ],
      ),
    ],
    extraTabs: [],
  };
}

const FILLS: Readonly<Record<Fill, Partial<ExcelJS.Color>>> = {
  red: { argb: "FFFF0000" },
  green: { argb: "FF8FCB7A" },
  brightGreen: { argb: "FF00FF00" },
  // Accent 2 of the default theme, which is a red.
  themeRed: { theme: 5 },
  white: { argb: "FFFFFFFF" },
  yellow: { argb: "FFFFFF00" },
};

const TAB_COLOURS = { red: "FFDD0000", blue: "FF3366CC", darkBlue: "FF113399" } as const;

function put(sheet: ExcelJS.Worksheet, row: number, column: number, input: CellInput | undefined): void {
  if (input === null || input === undefined) return;
  const spec: FixtureCell = typeof input === "object" ? input : { v: input };
  const cell = sheet.getCell(row, column);
  const value = spec.v ?? null;
  if (spec.link !== undefined && typeof value === "string") cell.value = { text: value, hyperlink: spec.link };
  else if (value !== null) cell.value = value;
  if (spec.fill !== undefined) cell.fill = { type: "pattern", pattern: "solid", fgColor: FILLS[spec.fill] };
  if (spec.strike !== undefined || spec.bold !== undefined) {
    cell.font = { ...(spec.strike ? { strike: true } : {}), ...(spec.bold ? { bold: true } : {}) };
  }
  if (spec.format !== undefined) cell.numFmt = spec.format;
}

function outreachSheet(workbook: ExcelJS.Workbook, fixture: OutreachTabFixture): void {
  const sheet = workbook.addWorksheet(fixture.title, {
    state: fixture.hidden ? "hidden" : "visible",
    ...(fixture.colour === null ? {} : { properties: { tabColor: { argb: TAB_COLOURS[fixture.colour] } } }),
  });
  fixture.preamble.forEach((line, index) => {
    put(sheet, index + 1, 1, line);
  });
  const headerRow = fixture.preamble.length + 1;
  fixture.headers.forEach((text, index) => {
    put(sheet, headerRow, index + 1, text);
  });
  fixture.rows.forEach((cells, index) => {
    (cells ?? []).forEach((cell, column) => {
      put(sheet, headerRow + 1 + index, column + 1, cell);
    });
  });
  for (const range of fixture.merges) sheet.mergeCells(range);
  for (const index of fixture.hiddenRows ?? []) sheet.getRow(headerRow + 1 + index).hidden = true;
}

function countsSheet(workbook: ExcelJS.Workbook, fixture: RecruitmentFixture["counts"]): void {
  const sheet = workbook.addWorksheet("numberOfLabsPerReplication", { views: [{ state: "frozen", ySplit: 1 }] });
  fixture.headers.forEach((text, index) => {
    put(sheet, 1, index + 1, { v: text, bold: index < 2 });
  });
  fixture.rows.forEach((row, index) => {
    put(sheet, index + 2, 1, row.study);
    put(sheet, index + 2, 2, row.leader);
    row.numbers.forEach((value, column) => {
      put(sheet, index + 2, column + 3, value);
    });
  });
  const last = fixture.rows.length + 1;
  if (fixture.derived) {
    const numbers = (column: number) =>
      fixture.rows.map((row) => row.numbers[column]).filter((value): value is number => typeof value === "number");
    const total = (column: number) => numbers(column).reduce((sum, value) => sum + value, 0);
    const median = (column: number) => {
      const sorted = numbers(column).sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
    };
    // Two blank rows, then the totals in green, the medians and a projection that is put together by hand.
    const totals = last + 3;
    sheet.getCell(totals, 2).value = "Total";
    ["C", "D", "E", "F", "G"].forEach((letter, column) => {
      const cell = sheet.getCell(`${letter}${totals}`);
      cell.value = {
        formula: `SUM(${letter}2:${letter}${last})`,
        result: column === 0 && fixture.staleTotal !== undefined ? fixture.staleTotal : total(column),
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: FILLS.brightGreen };
    });
    sheet.getCell(totals + 2, 2).value = "Median";
    sheet.getCell(`C${totals + 2}`).value = { formula: `MEDIAN(C2:C${last})`, result: median(0) };
    sheet.getCell(`D${totals + 2}`).value = { formula: `MEDIAN(D2:D${last})`, result: median(1) };
    sheet.getCell(totals + 4, 2).value = "projected by the end of an invented year";
    const first = fixture.rows[0]?.numbers[1];
    const second = fixture.rows[1]?.numbers[1];
    const third = fixture.rows[0]?.numbers[3];
    sheet.getCell(`D${totals + 4}`).value = {
      formula: "SUM(D3,F2,D2)",
      result: [first, second, third].reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0),
    };
  }
  // The timeline stands beside the table, under no header of row 1, and belongs to no study.
  if (fixture.timeline.length > 0) {
    put(sheet, 4, 9, { v: "An invented timeline:", bold: true });
    fixture.timeline.forEach((entry, index) => {
      put(sheet, 5 + index, 9, entry);
    });
  }
  if (fixture.note !== null) {
    put(sheet, 4, 10, "Notes");
    put(sheet, 6, 10, fixture.note);
  }
}

function leadsSheet(workbook: ExcelJS.Workbook, fixture: RecruitmentFixture["leads"]): void {
  const sheet = workbook.addWorksheet("leadsEmails");
  fixture.headers.forEach((text, index) => {
    put(sheet, 1, index + 1, { v: text, bold: index < 3 });
  });
  fixture.rows.forEach((row, index) => {
    [row.study, row.oldLeader, row.leader, row.email, row.additional].forEach((cell, column) => {
      put(sheet, index + 2, column + 1, cell);
    });
  });
}

/**
 * Builds the synthetic workbook. The tabs stand in an order of their own, with the two summary
 * tabs among the outreach tabs, as in the real workbook.
 */
export async function recruitmentWorkbook(fixture: RecruitmentFixture = recruitmentFixture()): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const [first, ...rest] = fixture.outreach;
  if (first !== undefined) outreachSheet(workbook, first);
  if (fixture.counts.headers.length > 0) countsSheet(workbook, fixture.counts);
  if (fixture.leads.headers.length > 0) leadsSheet(workbook, fixture.leads);
  for (const sheet of [...rest, ...fixture.extraTabs]) outreachSheet(workbook, sheet);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
