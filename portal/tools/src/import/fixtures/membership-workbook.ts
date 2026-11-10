// SYNTHETIC test fixture, and an ASSUMPTION ABOUT STRUCTURE. The membership and contributor
// workbook (source G) could not be opened, so this fixture encodes only what the project brief
// states about it: the three tab titles and the names of the fields. Where the header stands,
// which other columns exist and what the cells hold is invented here, and nothing in this file
// is a fact about the real workbook. Every person, affiliation and address (all on example.org)
// is fictitious, and the gender and ethnicity terms are made-up placeholders that name no real
// category.
//
// | Awkward case that the importer has to handle                         | Where it is reproduced            |
// |----------------------------------------------------------------------|-----------------------------------|
// | A header that does not stand in row 1, below a title line            | `list_members`, header in row 3   |
// | Headers in another case, spacing and punctuation than the brief      | The option `memberHeaders`        |
// | A hidden tab, a hidden row and a struck-through name                 | `study_description`, `Zed Dummy`, `Uma Synthetic` |
// | A secondary address, a cell with two addresses, a row without any    | `Ada Example`, `Wes Sample`, `Vic Pretend` |
// | Two rows with one address                                            | The two rows of `Yan Twin`        |
// | A gender or ethnicity term with capitals and a trailing space, and a blank | `Uma Synthetic`, `Zed Dummy` |
// | A tag that names no study, several tags in one cell                  | `Zed Dummy`, `Ada Example`        |
// | A flag that is a stored boolean, a text, a blank and something else  | `isCoauthor`, `IsPublished`       |
// | A link that is a hyperlink on a label, and a cell that names no sheet | `contibutor_tables`               |
// | A table that no contributor sheet import has read, and a study that does not exist | `Iota2004`, `NoSuchStudy1999` |
// | A member row that stands above the header, where nothing reads it    | The option `aboveHeader`          |
// | Rows of unticked boxes below the last member, in a table left at its default length | The option `fillerRows` |
// | A tab whose columns nobody has described, and one with a column of personal data | `study_description`, the option `studyHeaders` |
import ExcelJS from "exceljs";

export type MemberCell = string | number | boolean | null;

/** The member fields in the order of the brief, by the key under which a row states each. */
export const MEMBER_FIELD_HEADERS = {
  name: "name",
  surname: "surname",
  email: "email",
  secondaryEmail: "secondary_email",
  affiliation: "affiliation",
  country: "country",
  eegSystem: "EEG_system",
  gender: "gender",
  ethnicity: "ethnicity",
  replications: "whichReplication (Tags)",
  isCoauthor: "isCoauthor",
} as const;
export type MemberField = keyof typeof MEMBER_FIELD_HEADERS;

export interface MemberRow {
  readonly cells: Readonly<Partial<Record<MemberField, MemberCell>>>;
  readonly hidden?: boolean;
  /** Strike-through on the name cell. */
  readonly struck?: boolean;
}

/** Made-up placeholders for special-category terms. They name no real category. */
export const GENDER_TERM_ONE = "synthetic gender term 1";
export const GENDER_TERM_TWO = "Synthetic Gender Term 2 ";
export const ETHNICITY_TERM_ONE = "synthetic ethnicity term A";
export const ETHNICITY_TERM_TWO = "Synthetic ethnicity term B (self-described)";
/** Every special-category value of the fixture, for the tests that prove where such a value may be found. */
export const SPECIAL_TERMS = [GENDER_TERM_ONE, GENDER_TERM_TWO, ETHNICITY_TERM_ONE, ETHNICITY_TERM_TWO] as const;

export const MEMBER_ROWS: readonly MemberRow[] = [
  {
    cells: {
      name: "Ada",
      surname: "Example",
      email: "ada.example@example.org",
      secondaryEmail: "A.Example@Example.org ",
      affiliation: "University of Nowhere",
      country: "Nowhereland",
      eegSystem: "ExampleAmp 64",
      gender: GENDER_TERM_ONE,
      ethnicity: ETHNICITY_TERM_ONE,
      replications: "AlphaBeta2001, AlphaGamma2002",
      isCoauthor: true,
    },
  },
  {
    cells: {
      name: "Uma",
      surname: "Synthetic",
      email: "uma.synthetic@example.org",
      affiliation: "Synthetic State University",
      country: "USA",
      eegSystem: "MockCap 32",
      gender: GENDER_TERM_TWO,
      replications: "Delta1999",
      isCoauthor: "FALSE",
    },
    struck: true,
  },
  {
    // A name alone is no identity: this row creates no person.
    cells: {
      name: "Vic",
      surname: "Pretend",
      affiliation: "Pretend Polytechnic",
      country: "Nowhereland",
      gender: GENDER_TERM_ONE,
      ethnicity: ETHNICITY_TERM_TWO,
      isCoauthor: false,
    },
  },
  {
    // Two addresses in the primary cell. The secondary address is the one address of the row that can be used.
    cells: {
      name: "Wes",
      surname: "Sample",
      email: "wes.sample@example.org; w.sample@example.org",
      secondaryEmail: "wes@example.org",
      affiliation: "Sample College, Specimen City",
      country: "Nowhereland",
      ethnicity: ETHNICITY_TERM_TWO,
      isCoauthor: false,
    },
  },
  {
    cells: {
      name: "Yan",
      surname: "Twin",
      email: "yan.twin@example.org",
      affiliation: "Twin Institute",
      gender: GENDER_TERM_ONE,
    },
  },
  {
    cells: {
      name: "Yan",
      surname: "Twin",
      email: "Yan.Twin@example.org",
      affiliation: "Twin Institute, Second Campus",
      gender: GENDER_TERM_TWO,
    },
  },
  {
    cells: {
      name: "Zed",
      surname: "Dummy",
      email: "zed.dummy@example.org",
      affiliation: "Dummy Research Centre",
      country: "Dummyland",
      eegSystem: "ExampleAmp 128",
      ethnicity: ETHNICITY_TERM_ONE,
      replications: "NoSuchStudy1999; Delta1999",
      isCoauthor: "maybe",
    },
    hidden: true,
  },
];

export type TableCell = string | boolean | null | { readonly text: string; readonly hyperlink: string };

export interface TableRow {
  readonly replication: string | null;
  readonly link: TableCell;
  readonly signUpOnly?: TableCell;
  readonly published?: TableCell;
  readonly publication?: string | null;
  readonly pdf?: string | null;
}

/** The invented address of a contributor sheet, in the form from which the importer reads the identifier of the file. */
export const sheetAddress = (fileIdentifier: string): string =>
  `https://sheets.example.org/spreadsheets/d/${fileIdentifier}/edit#gid=0`;

export const TABLE_FILE_IDENTIFIERS = {
  alphaBeta: "an-invented-identifier-of-the-sheet-alpha-beta",
  delta: "an-invented-identifier-of-the-sheet-delta",
  iota: "an-invented-identifier-of-a-further-sheet",
} as const;

export const TABLE_ROWS: readonly TableRow[] = [
  {
    replication: "AlphaBeta2001",
    link: sheetAddress(TABLE_FILE_IDENTIFIERS.alphaBeta),
    signUpOnly: false,
    published: true,
    publication: "https://journal.example.org/articles/invented-2023",
    pdf: "https://files.example.org/invented-2023.pdf",
  },
  {
    replication: "Delta1999",
    // The cell shows a label, and the address is the target of its hyperlink.
    link: { text: "contributor table", hyperlink: sheetAddress(TABLE_FILE_IDENTIFIERS.delta) },
    signUpOnly: "TRUE",
    published: "not yet",
    publication: "to be announced",
  },
  { replication: "Iota2004", link: sheetAddress(TABLE_FILE_IDENTIFIERS.iota) },
  { replication: "NoSuchStudy1999", link: sheetAddress("an-invented-identifier-of-a-sheet-without-a-study") },
  { replication: "EtaTheta2005", link: "see the shared folder" },
];

export interface MembershipWorkbookOptions {
  readonly members?: readonly MemberRow[];
  readonly tables?: readonly TableRow[];
  /** The headers of the member tab by field, to spell one differently or, with null, to leave one out. */
  readonly memberHeaders?: Readonly<Partial<Record<MemberField, string | null>>>;
  /** A further column of the member tab, with its header (null for none) and one value for every row. */
  readonly extraMemberColumn?: { readonly header: string | null; readonly value: MemberCell };
  /** The row of the header of the member tab. The default is 3, below a title line. */
  readonly memberHeaderRow?: number;
  /** Leaves a tab out, or adds one that the brief does not name. */
  readonly withoutTab?: "list_members" | "study_description" | "contibutor_tables";
  readonly extraTab?: string;
  /** Replaces the header of the link column of the tab of contributor tables. */
  readonly linkHeader?: string;
  /** A member row in row 2, between the title line and the header in row 3, where no reader of the table looks. */
  readonly aboveHeader?: MemberRow;
  /** Rows below the last member that hold an unticked `isCoauthor` box and nothing else. */
  readonly fillerRows?: number;
  /** The header of the tab of study descriptions, and a value for every further column of its two rows. */
  readonly studyHeaders?: readonly string[];
}

/** The header of the tab of study descriptions of this fixture, as a maintainer would confirm it. */
export const STUDY_HEADERS = ["StudyID", "Description"] as const;
/** The confirmation of that header, in the form of the private configuration. */
export const CONFIRMED_STUDY_HEADERS = { study_description: STUDY_HEADERS } as const;

/**
 * Builds the synthetic membership workbook: the member tab with its header below a title line,
 * the hidden tab of study descriptions and the tab of contributor tables.
 */
export async function membershipWorkbook(options: MembershipWorkbookOptions = {}): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  if (options.withoutTab !== "list_members") {
    const sheet = workbook.addWorksheet("list_members");
    const headerRow = options.memberHeaderRow ?? 3;
    if (headerRow > 1) sheet.getCell("A1").value = "An invented list of members";
    const fields = (Object.keys(MEMBER_FIELD_HEADERS) as MemberField[]).filter(
      (field) => options.memberHeaders?.[field] !== null,
    );
    fields.forEach((field, index) => {
      sheet.getCell(headerRow, index + 1).value = options.memberHeaders?.[field] ?? MEMBER_FIELD_HEADERS[field];
    });
    const extra = options.extraMemberColumn;
    if (extra !== undefined && extra.header !== null) sheet.getCell(headerRow, fields.length + 1).value = extra.header;
    const members = options.members ?? MEMBER_ROWS;
    if (options.aboveHeader !== undefined) {
      fields.forEach((field, index) => {
        const value = options.aboveHeader?.cells[field] ?? null;
        if (value !== null) sheet.getCell(headerRow - 1, index + 1).value = value;
      });
    }
    for (let filler = 0; filler < (options.fillerRows ?? 0); filler += 1) {
      sheet.getCell(headerRow + 1 + members.length + filler, fields.indexOf("isCoauthor") + 1).value = false;
    }
    members.forEach((member, offset) => {
      const at = headerRow + 1 + offset;
      fields.forEach((field, index) => {
        const value = member.cells[field] ?? null;
        if (value !== null) sheet.getCell(at, index + 1).value = value;
      });
      if (extra !== undefined && extra.value !== null) sheet.getCell(at, fields.length + 1).value = extra.value;
      if (member.struck) sheet.getCell(at, 1).font = { strike: true };
      if (member.hidden) sheet.getRow(at).hidden = true;
    });
  }
  if (options.withoutTab !== "study_description") {
    const sheet = workbook.addWorksheet("study_description", { state: "hidden" });
    const headers = options.studyHeaders ?? STUDY_HEADERS;
    const further = headers.slice(STUDY_HEADERS.length).map(() => "an invented value of a further column");
    sheet.getRow(1).values = [...headers];
    sheet.getRow(2).values = ["AlphaBeta2001", "An invented description of an invented study.", ...further];
    sheet.getRow(4).values = ["Delta1999", "Another invented description.", ...further];
  }
  if (options.withoutTab !== "contibutor_tables") {
    const sheet = workbook.addWorksheet("contibutor_tables");
    sheet.getRow(1).values = [
      "ReplicationID",
      options.linkHeader ?? "TableLink",
      "IsOnlySignUpTable",
      "IsPublished",
      "PubLink",
      "PDFLink",
    ];
    (options.tables ?? TABLE_ROWS).forEach((row, offset) => {
      const at = offset + 2;
      const cells: TableCell[] = [
        row.replication,
        row.link,
        row.signUpOnly ?? null,
        row.published ?? null,
        row.publication ?? null,
        row.pdf ?? null,
      ];
      cells.forEach((value, index) => {
        if (value !== null) sheet.getCell(at, index + 1).value = value;
      });
    });
  }
  if (options.extraTab !== undefined) workbook.addWorksheet(options.extraTab).getCell("A1").value = "an invented tab";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
