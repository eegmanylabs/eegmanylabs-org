// SYNTHETIC test fixtures. Every contributor sheet built here is invented: the people, their
// affiliations, their funding statements and their addresses (all on example.org) are
// fictitious, the ORCID iDs are made-up numbers with a computed check digit, and nothing is
// copied from a real sheet. Only the headers are the real ones, because they are the structure
// that the importer maps. The builders reproduce the awkward cases of the real sheets:
//
// | Awkward case of the real sheets                                   | Where it is reproduced              |
// |-------------------------------------------------------------------|-------------------------------------|
// | Column order and column set differ in every file                  | The four layouts below              |
// | An agreement column after the surname, with a red header          | `ALPHA_BETA_SHEET`                  |
// | Blank rows inside the range and hundreds of rows of unticked boxes | `ALPHA_BETA_SHEET`, `EPSILON_SHEET` |
// | A column of order numbers and a column of booleans without headers | `ALPHA_GAMMA_SHEET`                |
// | A whole row in a highlight colour, and a blank checkbox           | `ALPHA_GAMMA_SHEET`                 |
// | Role columns in another order, and ORCID iDs under `Funding 2`    | `EPSILON_SHEET`                     |
// | Numbered rows without a name between contributor rows             | `EPSILON_SHEET`                     |
// | Words in the order column, rows without an order or without a role | `DELTA_SHEET`                      |
// | ORCID iDs as addresses with a hyperlink, one ending in `X`        | `EPSILON_SHEET`, `DELTA_SHEET`      |
// | An address with a letter outside ASCII, and one with capitals     | `DELTA_SHEET`, `ALPHA_BETA_SHEET`   |
// | An iD with a wrong check digit, a semicolon in an affiliation     | `ALPHA_BETA_SHEET`                  |
// | One person in two sheets with other roles, another affiliation string and another address | `ALPHA_BETA_SHEET`, `ALPHA_GAMMA_SHEET` |
// | A first name spelt differently in two sheets                      | `Jo Mockup`, `Jon Mockup`           |
// | A note on each role header, three of which begin with an invisible character | Every layout             |
import { CREDIT_ROLES, type CreditRoleKey } from "@eegml/shared";
import ExcelJS from "exceljs";

/** What a cell of a fixture holds: a typed value, nothing, or a text with the target of its hyperlink. */
export type FixtureCell = string | number | boolean | null | { readonly text: string; readonly hyperlink: string };

export interface FixtureColumn {
  /** The header as the sheet writes it, or null for a column without a header. */
  readonly header: string | null;
  /** The key under which a row states its cell. */
  readonly key: string;
  /** A checkbox column holds a stored `FALSE` in every row of the table, the unused ones included. */
  readonly checkbox?: boolean;
  /** The note on the header cell. */
  readonly note?: string;
}

export type FixtureRow =
  | {
      readonly cells: Readonly<Record<string, FixtureCell>>;
      /** A fill on every cell of the row, as eight hexadecimal digits with the opacity first. */
      readonly fill?: string;
    }
  /** Rows that hold nothing except unticked checkboxes. */
  | { readonly filler: number }
  | { readonly blank: number };

export interface ContributorSheetFixture {
  readonly tabName?: string;
  readonly columns: readonly FixtureColumn[];
  readonly rows: readonly FixtureRow[];
  /** A second tab, which the importer refuses. */
  readonly secondTab?: boolean;
}

/** The header of a role column as the sheets write it: with a hyphen where the taxonomy has a dash. */
export const roleHeader = (key: CreditRoleKey): string =>
  (CREDIT_ROLES.find((role) => role.key === key)?.name ?? key).replace("\u2013", "-");

/** The invented note of a role header. Three begin with a zero-width space and one holds an en dash, as in the real sheets. */
export function roleNote(key: CreditRoleKey): string {
  const invisible = ["methodology", "software", "visualization"].includes(key) ? "\u200b" : "";
  const dash = key === "writingReviewEditing" ? " \u2013 including later stages" : "";
  return `${invisible}An invented definition of the role "${roleHeader(key)}"${dash}.`;
}

const ROLE_KEYS = CREDIT_ROLES.map((role) => role.key);

export interface LayoutOptions {
  /** The header of the order column. Null leaves the column without a header. */
  readonly orderHeader?: string | null;
  /** The agreement column, directly after the surname. */
  readonly agreement?: boolean;
  /** The role columns in their order. The default is the order of the taxonomy. */
  readonly roleOrder?: readonly CreditRoleKey[];
  readonly affiliationHeaders?: readonly string[];
  /** The header over the ORCID iDs, or null for a sheet without that column. */
  readonly orcidHeader?: string | null;
  readonly conflict?: boolean;
  /** A last column without a header that holds a checkbox. */
  readonly trailingCheckbox?: boolean;
}

/** The columns of a synthetic sheet. The contact columns stand after the roles, as in every real sheet. */
export function sheetColumns(options: LayoutOptions = {}): FixtureColumn[] {
  const affiliationHeaders = options.affiliationHeaders ?? ["Primary affiliation", "Secondary affiliation"];
  const orderHeader = options.orderHeader === undefined ? "Order in publication" : options.orderHeader;
  const orcidHeader = options.orcidHeader === undefined ? "ORCID iD" : options.orcidHeader;
  return [
    { header: orderHeader, key: "order" },
    { header: "Firstname", key: "first" },
    { header: "Middle name", key: "middle" },
    { header: "Surname", key: "surname" },
    ...(options.agreement
      ? [
          {
            header: "I agree with the current version of the manuscript to be submitted",
            key: "agreement",
            checkbox: true,
          },
        ]
      : []),
    ...(options.roleOrder ?? ROLE_KEYS).map((key) => ({
      header: roleHeader(key),
      key,
      checkbox: true,
      note: roleNote(key),
    })),
    { header: "Email address", key: "email" },
    ...affiliationHeaders.map((header, index) => ({ header, key: `affiliation${index + 1}` })),
    { header: "Funding", key: "funding" },
    ...(orcidHeader === null ? [] : [{ header: orcidHeader, key: "orcid" }]),
    { header: "Corresponding author?", key: "corresponding", checkbox: true },
    ...(options.conflict ? [{ header: "Conflict of interest", key: "conflict" }] : []),
    ...(options.trailingCheckbox ? [{ header: null, key: "unlabelled", checkbox: true }] : []),
  ];
}

/** One invented contributor, as a row states it. */
export interface PersonSpec {
  readonly order?: number | string | null;
  readonly first: string | null;
  readonly middle?: string;
  readonly surname: string | null;
  /** The roles whose boxes are ticked. Every other box of the row is unticked. */
  readonly roles?: readonly CreditRoleKey[];
  readonly email?: string;
  readonly affiliations?: readonly (string | null)[];
  readonly funding?: string;
  readonly orcid?: FixtureCell;
  /** Null leaves the cell blank. */
  readonly corresponding?: boolean | null;
  readonly agreement?: boolean;
  readonly conflict?: string;
  /** Cells stated directly by column key, which replace what the fields above give. */
  readonly cells?: Readonly<Record<string, FixtureCell>>;
  readonly fill?: string;
}

/** The row of one invented contributor: a stored boolean in every checkbox column, as a real sheet holds. */
export function personRow(spec: PersonSpec): FixtureRow {
  const cells: Record<string, FixtureCell> = {
    order: spec.order ?? null,
    first: spec.first,
    middle: spec.middle ?? null,
    surname: spec.surname,
    agreement: spec.agreement ?? false,
    email: spec.email ?? null,
    funding: spec.funding ?? null,
    orcid: spec.orcid ?? null,
    corresponding: spec.corresponding === undefined ? false : spec.corresponding,
    conflict: spec.conflict ?? null,
    unlabelled: false,
  };
  for (const key of ROLE_KEYS) cells[key] = (spec.roles ?? []).includes(key);
  for (const [index, text] of (spec.affiliations ?? []).entries()) cells[`affiliation${index + 1}`] = text;
  return { cells: { ...cells, ...spec.cells }, ...(spec.fill === undefined ? {} : { fill: spec.fill }) };
}

/** An invented ORCID iD with a correct ISO 7064 MOD 11-2 check digit, from fifteen digits. */
export function inventedOrcid(fifteenDigits: string): string {
  let total = 0;
  for (const digit of fifteenDigits) total = (total + Number(digit)) * 2;
  const check = (12 - (total % 11)) % 11;
  const digits = `${fifteenDigits}${check === 10 ? "X" : String(check)}`;
  return [0, 4, 8, 12].map((start) => digits.slice(start, start + 4)).join("-");
}

/** The same iD as the address that some rows hold, with the hyperlink that the sheet puts on the cell. */
export const orcidLink = (orcid: string): FixtureCell => ({
  text: `https://orcid.org/${orcid}`,
  hyperlink: `https://orcid.org/${orcid}`,
});

export const ORCID_ADA = inventedOrcid("000000090000001");
export const ORCID_ELI = inventedOrcid("000000090000002");
export const ORCID_MAX = inventedOrcid("000000090000003");
/** An invented iD whose check character is `X`. */
export const ORCID_QUIN = inventedOrcid("000000090000004");
/** An invented iD with a wrong check digit. */
export const ORCID_DEFECT = `${inventedOrcid("000000090000005").slice(0, -1)}${
  inventedOrcid("000000090000005").endsWith("0") ? "1" : "0"
}`;

export const YELLOW = "FFFFFF00";
/** One of the banding colours of the template, which carries no meaning. */
export const TEMPLATE_BAND = "FFFCE5CD";

export const FUNDING_KIT = "Invented Foundation, synthetic grant 12345";
export const FUNDING_NIA = "A made-up fellowship of the Example Council, reference EX-0001";

/**
 * A complete list in the middle of sign-off: an agreement column, an order from 1 to 6, three
 * blank rows inside the range and forty rows of unticked boxes.
 */
export const ALPHA_BETA_SHEET: ContributorSheetFixture = {
  columns: sheetColumns({ agreement: true }),
  rows: [
    personRow({
      order: 1,
      first: "Ada",
      surname: "Example",
      roles: ["conceptualization", "supervision", "writingReviewEditing"],
      email: "Ada.Example@example.org",
      affiliations: ["University of Nowhere, Department of Examples, Nowhereland"],
      orcid: ORCID_ADA,
      corresponding: true,
      agreement: true,
    }),
    personRow({
      order: 2,
      first: "Bo",
      surname: "Fictional",
      roles: ["investigation"],
      affiliations: ["Institute of Fiction"],
      fill: TEMPLATE_BAND,
    }),
    personRow({
      order: 3,
      first: " Hal",
      surname: "Nobody",
      roles: ["investigation", "dataCuration"],
      email: "hal.nobody@example.org",
      affiliations: ["Sample College, Specimen City"],
      orcid: ORCID_DEFECT,
    }),
    personRow({
      order: 4,
      first: "Ida",
      surname: "Specimen",
      roles: ["formalAnalysis", "software"],
      email: "ida.specimen@example.org",
      affiliations: ["Sample College, Specimen City", "Mockup Institute; Example Clinic"],
    }),
    personRow({
      order: 5,
      first: "Jo",
      surname: "Mockup",
      roles: ["investigation"],
      affiliations: ["Mockup Institute, Department of Models"],
    }),
    personRow({
      order: 6,
      first: "Kit",
      middle: "Q.",
      surname: "Placeholder-Sample",
      roles: ["fundingAcquisition", "writingOriginalDraft"],
      email: "kit@example.org",
      affiliations: ["Mockup Institute, Department of Models, Modelville"],
      funding: FUNDING_KIT,
    }),
    { blank: 3 },
    { filler: 40 },
  ],
};

/**
 * An ordered list whose order column and whose last column have no header. It shares five
 * people with `ALPHA_BETA_SHEET`, with other roles, another affiliation string for one of them,
 * another address for one and another first name for one.
 */
export const ALPHA_GAMMA_SHEET: ContributorSheetFixture = {
  columns: sheetColumns({ orderHeader: null, trailingCheckbox: true }),
  rows: [
    personRow({
      order: 1,
      first: "Ada",
      surname: "Example",
      roles: ["conceptualization", "projectAdministration"],
      email: "ada.example@example.org",
      affiliations: ["University of Nowhere"],
      corresponding: true,
    }),
    personRow({
      order: 2,
      first: "Bo",
      surname: "Fictional",
      roles: ["investigation", "validation"],
      affiliations: ["Institute of Fiction"],
      fill: YELLOW,
    }),
    personRow({
      order: 3,
      first: "Hal",
      surname: "Nobody",
      roles: ["investigation"],
      email: "h.nobody@example.org",
      affiliations: ["Sample College, Specimen City"],
    }),
    personRow({
      order: 4,
      first: "Ida",
      surname: "Specimen",
      roles: ["software"],
      affiliations: ["Sample College, Specimen City"],
      corresponding: null,
    }),
    personRow({
      order: 5,
      first: "Jon",
      surname: "Mockup",
      roles: ["investigation"],
      affiliations: ["Mockup Institute, Department of Models"],
    }),
    personRow({
      order: 6,
      first: "Lu",
      surname: "Sample",
      roles: ["resources"],
      affiliations: ["Example Hospital, Sampleton"],
    }),
  ],
};

/** The order of the role columns in the sheet that departs from the taxonomy. */
const EPSILON_ROLE_ORDER: readonly CreditRoleKey[] = [
  "conceptualization",
  "methodology",
  "software",
  ...ROLE_KEYS.filter((key) => !["conceptualization", "methodology", "software"].includes(key)),
];

/**
 * A list that is still being filled: the role columns in another order, ORCID iDs under the
 * header `Funding 2`, two numbered rows without a name between contributor rows, nobody flagged
 * as corresponding author, and thirty rows of unticked boxes.
 */
export const EPSILON_SHEET: ContributorSheetFixture = {
  columns: sheetColumns({
    roleOrder: EPSILON_ROLE_ORDER,
    affiliationHeaders: ["Affiliation 1", "Affiliation 2"],
    orcidHeader: "Funding 2",
    conflict: true,
  }),
  rows: [
    personRow({
      order: 1,
      first: "Eli",
      surname: "Madeup",
      roles: ["conceptualization", "methodology"],
      email: "eli.madeup@example.org",
      affiliations: ["Invented Polytechnic, Faculty of Samples"],
      orcid: orcidLink(ORCID_ELI),
      conflict: "no competing interest",
    }),
    personRow({
      order: 2,
      first: "Max",
      surname: "Dummy",
      roles: ["software", "dataCuration"],
      email: "max.dummy@example.org",
      affiliations: ["Invented Polytechnic, Faculty of Samples", "Example Research Centre"],
      orcid: ORCID_MAX,
      conflict: "no competing interest ",
    }),
    personRow({ order: 3, first: null, surname: null }),
    personRow({ order: 4, first: null, surname: null }),
    personRow({
      order: 5,
      first: "Nia",
      surname: "Imagined",
      roles: ["investigation", "writingReviewEditing"],
      affiliations: [null],
      funding: FUNDING_NIA,
    }),
    { filler: 30 },
  ],
};

/**
 * A list whose order is a rule: two numbers, the words `alphabetical` and `last`, rows without
 * an order, two rows without any role, two corresponding authors and a third affiliation column.
 */
export const DELTA_SHEET: ContributorSheetFixture = {
  columns: sheetColumns({ affiliationHeaders: ["Affiliation 1", "Affiliation 2", "Affiliation 3"], conflict: true }),
  rows: [
    personRow({
      order: 1,
      first: "Cy",
      surname: "Invented",
      roles: ["conceptualization", "investigation", "writingOriginalDraft"],
      email: "cy.invented@example.org",
      affiliations: ["Invented University & Example Hospital"],
      corresponding: true,
    }),
    personRow({
      order: 2,
      first: "Dee",
      surname: "Imaginary",
      roles: ["formalAnalysis"],
      email: "dee.imaginary@example.org",
      affiliations: ["Imaginary Academy"],
    }),
    personRow({
      order: "alphabetical",
      first: "Oz",
      surname: "Unreal",
      affiliations: ["Imaginary Academy"],
    }),
    personRow({
      first: "Pía",
      surname: "Fabricated",
      email: "pía.fabricated@example.org",
      affiliations: ["Fabricated Institute of Technology"],
    }),
    personRow({
      first: "Quin",
      surname: "Notional",
      roles: ["resources"],
      affiliations: ["Notional College", "Imaginary Academy", "Example Research Centre"],
      orcid: orcidLink(ORCID_QUIN),
    }),
    personRow({
      order: "last",
      first: "Rae",
      surname: "Hypothetical",
      roles: ["supervision", "fundingAcquisition"],
      email: "rae.hypothetical@example.org",
      affiliations: ["Notional College"],
      corresponding: true,
    }),
    { filler: 4 },
  ],
};

/** Builds the workbook of a synthetic contributor sheet: one tab, the header in row 1, a note on each role header. */
export async function contributorWorkbook(fixture: ContributorSheetFixture): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(fixture.tabName ?? "Sheet1");
  fixture.columns.forEach((column, index) => {
    const cell = sheet.getCell(1, index + 1);
    if (column.header !== null) cell.value = column.header;
    cell.font = { bold: true };
    if (column.note !== undefined) cell.note = column.note;
  });
  let at = 2;
  for (const row of fixture.rows) {
    if ("blank" in row) {
      at += row.blank;
      continue;
    }
    const repeats = "filler" in row ? row.filler : 1;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      fixture.columns.forEach((column, index) => {
        const cell = sheet.getCell(at, index + 1);
        const value = "filler" in row ? (column.checkbox ? false : null) : (row.cells[column.key] ?? null);
        if (value !== null) cell.value = value;
        if ("cells" in row && row.fill !== undefined) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row.fill } };
        }
      });
      at += 1;
    }
  }
  if (fixture.secondTab) workbook.addWorksheet("Sheet2").getCell("A1").value = "an invented second tab";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
