// SYNTHETIC test fixtures. Every workbook built here is invented: the study identifiers, the
// names, the people and the addresses (all on example.org) are fictitious, and nothing is copied
// from a real source. The builders reproduce the structure and the awkward cases of the real
// workbooks: hidden and very hidden tabs, two-row and offset headers, hyperlinks, strike-through,
// fills, formulas with shared formulas, blank beside zero, hidden rows and columns, merged cells.
import ExcelJS from "exceljs";

async function bytesOf(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** One row of the synthetic naming conventions: the name of an invented study in four schemes. */
export interface NamingRow {
  readonly name: string;
  readonly cloud: string;
  readonly explanation: string;
  /** A typed letter in `Part 2`, where several studies share their first three letters. Otherwise a formula. */
  readonly part2Literal?: string;
  /** A typed BIDS name, in place of the formula that joins the two parts. */
  readonly bidsLiteral?: string;
  /** Formulas for the two parts that depart from the pattern of their columns: `[letters of part 1, letters of part 2]`. */
  readonly split?: readonly [number, number];
  readonly eegnet: string;
}

/**
 * The synthetic naming conventions as they stand at first: eight invented studies.
 *
 * | Awkward case of the real workbook                         | Where it is reproduced                 |
 * |-----------------------------------------------------------|----------------------------------------|
 * | Two studies share one BIDS name and one EEGNet name, marked with `*` and explained by a footnote in a column without a header | `AlphaBeta2001`, `AlphaGamma2002`, cell J2 |
 * | A typed literal where the column otherwise holds a formula | The BIDS names of those two studies    |
 * | A component formula that departs from the column's pattern | `EtaTheta2005`                         |
 * | A cloud name that the token rule cannot produce, and a third token in lower case | `EpsilonVanZeta2010` |
 * | One string used in two schemes                             | `Iota2004`                             |
 * | Studies that the website data does not hold                | `Kappa2006`, `Lambda2003`              |
 * | Formulas that depend on a shared formula, and spacer columns | Columns E, F and G; columns D and I  |
 */
export const NAMING_ROWS: readonly NamingRow[] = [
  {
    name: "AlphaBeta2001",
    cloud: "AlBe2001",
    explanation: "Al + Be + A",
    part2Literal: "A",
    bidsLiteral: "Alph*",
    eegnet: "ALP*",
  },
  {
    name: "AlphaGamma2002",
    cloud: "AlGa2002",
    explanation: "Al + Ga + A",
    part2Literal: "B",
    bidsLiteral: "Alph*",
    eegnet: "ALP*",
  },
  { name: "Delta1999", cloud: "Delt1999", explanation: "De + lt + A", eegnet: "DEL" },
  { name: "EpsilonVanZeta2010", cloud: "EpVZ2010", explanation: "Ep + VZ + a", eegnet: "EPS" },
  { name: "EtaTheta2005", cloud: "EtTh2005", explanation: "Et + Th + A", split: [1, 3], eegnet: "ETH" },
  { name: "Iota2004", cloud: "Iota2004", explanation: "Io + ta + A", eegnet: "IOT" },
  { name: "Kappa2006", cloud: "Kapp2006", explanation: "Ka + pp + A", eegnet: "KAP" },
  { name: "Lambda2003", cloud: "Lamb2003", explanation: "La + mb + A", eegnet: "LAM" },
];

export const NAMING_FOOTNOTE = "*synthetic footnote: the two invented studies share one dataset";

export interface NamingWorkbookOptions {
  readonly rows?: readonly NamingRow[];
  /** The footnote in the column without a header, or null for none. */
  readonly footnote?: string | null;
  /** A second tab, which the importer refuses. */
  readonly secondTab?: boolean;
  /** Replaces the header of the EEGNet column, to break the header check. */
  readonly eegnetHeader?: string;
}

/** Builds the synthetic naming conventions workbook: one tab, headers in row 1, spacer columns D and I, a footnote in J2. */
export async function namingWorkbook(options: NamingWorkbookOptions = {}): Promise<Uint8Array> {
  const rows = options.rows ?? NAMING_ROWS;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "Original Name";
  sheet.getCell("B1").value = "Standardized Name - cloud accounts";
  sheet.getCell("C1").value = "Explanation";
  sheet.getCell("E1").value = "Part 1";
  sheet.getCell("F1").value = "Part 2";
  sheet.getCell("G1").value = "Standardized Name - BIDS";
  sheet.getCell("H1").value = options.eegnetHeader ?? "EEGnet name";
  const last = rows.length + 1;
  rows.forEach((row, index) => {
    const at = index + 2;
    sheet.getCell(`A${at}`).value = row.name;
    sheet.getCell(`B${at}`).value = row.cloud;
    sheet.getCell(`C${at}`).value = row.explanation;
    sheet.getCell(`H${at}`).value = row.eegnet;
  });
  // The usual formulas are shared down their columns, so most cells carry no formula text of their own.
  // A shared formula starts at the first row that uses it, because later rows depend on that cell.
  const part2 = (row: NamingRow | undefined) => row?.part2Literal ?? (row?.name ?? "").slice(3, 4);
  const shared: readonly {
    readonly column: string;
    readonly usual: (row: NamingRow) => boolean;
    readonly formula: (at: number) => string;
    readonly result: (row: NamingRow | undefined) => string;
  }[] = [
    {
      column: "E",
      usual: (row) => row.split === undefined,
      formula: (at) => `LEFT(A${at}, 3)`,
      result: (row) => (row?.name ?? "").slice(0, 3),
    },
    {
      column: "F",
      usual: (row) => row.split === undefined && row.part2Literal === undefined,
      formula: (at) => `MID(A${at},4,1)`,
      result: part2,
    },
    {
      column: "G",
      usual: (row) => row.split === undefined && row.bidsLiteral === undefined,
      formula: (at) => `CONCATENATE(E${at},F${at})`,
      result: (row) => (row?.name ?? "").slice(0, 3) + part2(row),
    },
  ];
  for (const { column, usual, formula, result } of shared) {
    const first = rows.findIndex(usual) + 2;
    if (first < 2) continue;
    sheet.fillFormula(`${column}${first}:${column}${last}`, formula(first), (at) => result(rows[at - 2]));
  }
  rows.forEach((row, index) => {
    const at = index + 2;
    if (row.split !== undefined) {
      const [first, second] = row.split;
      sheet.getCell(`E${at}`).value = { formula: `LEFT(A${at}, ${first})`, result: row.name.slice(0, first) };
      sheet.getCell(`F${at}`).value = { formula: `MID(A${at},4,${second})`, result: row.name.slice(3, 3 + second) };
      sheet.getCell(`G${at}`).value = {
        formula: `CONCATENATE(E${at},F${at})`,
        result: row.name.slice(0, first) + row.name.slice(3, 3 + second),
      };
    }
    if (row.part2Literal !== undefined) sheet.getCell(`F${at}`).value = row.part2Literal;
    if (row.bidsLiteral !== undefined) sheet.getCell(`G${at}`).value = row.bidsLiteral;
  });
  const footnote = options.footnote === undefined ? NAMING_FOOTNOTE : options.footnote;
  if (footnote !== null) sheet.getCell("J2").value = footnote;
  if (options.secondTab) workbook.addWorksheet("Sheet2").getCell("A1").value = "an invented second tab";
  return bytesOf(workbook);
}

/**
 * Builds a workbook with every awkward case that the workbook reader has to keep, on three tabs.
 *
 * | Tab               | State       | What it holds                                                        |
 * |-------------------|-------------|----------------------------------------------------------------------|
 * | `Outreach demo `  | visible     | A title with a trailing space. A banner in row 1 above a header in row 2, a struck-through name, a hyperlink whose text is a label, an explicit zero beside a blank, a red fill, a theme fill, a hidden row, a hidden column, a merged range, a stored boolean, a text date and a true date, a total as a formula |
 * | `hidden notes`    | hidden      | A header that starts in row 3, below two lines of preamble           |
 * | `very hidden`     | very hidden | One cell                                                             |
 */
export async function awkwardWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const visible = workbook.addWorksheet("Outreach demo ");
  visible.getCell("A1").value = "Invented contacts";
  visible.getCell("D1").value = "Counts";
  visible.getRow(2).values = [
    "Contact name",
    "Contact email",
    "Result",
    "Signed",
    "Collected",
    "Agreed",
    "First contact",
    "Follow-up",
  ];
  visible.getRow(3).values = [
    "Ada Example",
    "ada@example.org",
    "accepted",
    0,
    null,
    true,
    "03.02.24",
    new Date(Date.UTC(2024, 2, 5)),
  ];
  visible.getRow(4).values = ["Bo Fictional", "bo@example.org", " no reply ", 12, 7, false, "04.02.2024", null];
  visible.getRow(5).values = ["Cy Invented", "cy@example.org", "declined", null, null, false, null, null];
  visible.getRow(6).values = [
    "Total",
    null,
    null,
    { formula: "SUM(D3:D5)", result: 12 },
    { formula: "SUM(E3:E5)", result: 7 },
  ];
  visible.getCell("H3").numFmt = "dd.mm.yyyy";
  visible.getCell("A4").font = { strike: true };
  visible.getCell("A6").font = { bold: true };
  visible.getCell("C5").font = { italic: true };
  visible.getCell("B3").value = { text: "write to Ada", hyperlink: "mailto:ada@example.org" };
  visible.getCell("C3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
  // The type definitions of the library leave out the tint of a theme colour, which it does write.
  const lightened: Partial<ExcelJS.Color> & { readonly tint: number } = { theme: 9, tint: 0.4 };
  visible.getCell("C4").fill = { type: "pattern", pattern: "solid", fgColor: lightened };
  visible.getRow(5).hidden = true;
  visible.getColumn(2).hidden = true;
  visible.getCell("A8").value = "a note that spans two rows";
  visible.mergeCells("A8:A9");
  visible.properties.tabColor = { argb: "FF00B050" };

  const hidden = workbook.addWorksheet("hidden notes", { state: "hidden" });
  hidden.getCell("A1").value = "Lead Replicating Lab: Dee Imaginary";
  hidden.getCell("A2").value = "Study: an invented study";
  hidden.getRow(3).values = ["contact name", "contact email"];
  hidden.getRow(4).values = ["Eli Madeup", "eli@example.org"];

  const veryHidden = workbook.addWorksheet("very hidden", { state: "veryHidden" });
  veryHidden.getCell("B2").value = "kept out of sight";
  return bytesOf(workbook);
}
