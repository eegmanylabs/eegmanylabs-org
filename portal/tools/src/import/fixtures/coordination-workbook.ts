// SYNTHETIC test fixture, and an ASSUMPTION ABOUT STRUCTURE. The historical replication
// coordination workbook (source A) could not be opened, so this fixture encodes only what the
// project brief states about it: the seven fields of its summary. The titles of its tabs, the
// row of its header and everything else here is invented, and nothing in this file is a fact
// about the real workbook. Every study, person, number and address (on example.org) is
// fictitious.
//
// | Awkward case that the importer has to handle                        | Where it is reproduced               |
// |---------------------------------------------------------------------|--------------------------------------|
// | A blank number beside an explicit zero                              | `AlphaGamma2002`                     |
// | More laboratories finished than signed                              | `Delta1999`                          |
// | One cell that names two studies, and an identifier of no study      | `Iota2004 + EtaTheta2005`, `NoSuchStudy1999` |
// | A struck-through study                                              | `EpsilonVanZeta2010`                 |
// | A total as a formula below the study rows                           | The row `Total`                      |
// | A hidden tab in the layout of an outreach tab, with a title line    | `Invented outreach`                  |
// | Summary headers in another case and spacing, or below a title line  | The options `headers` and `headerRow` |
// | A column that the brief does not name, and a tab of no known layout | The options `extraColumn` and `unknownTab` |
// | A second tab with the seven summary headers, as a copy of the first would be | The option `secondSummary`  |
import ExcelJS from "exceljs";

export const SUMMARY_HEADERS = [
  "StudyID",
  "Leader",
  "NLabsSigned",
  "TotalNSubjectsToBeRun",
  "NLabsFinished",
  "TotalNMainExpCollected",
  "TotalNRest",
] as const;

export interface SummaryRow {
  readonly study: string;
  readonly leader: string | null;
  /** Labs signed, participants to be run, labs finished, main experiment collected, resting state collected. */
  readonly numbers: readonly (number | string | null)[];
  readonly struck?: boolean;
}

export const SUMMARY_ROWS: readonly SummaryRow[] = [
  { study: "AlphaBeta2001", leader: "Ada Example", numbers: [12, 300, 4, 120, 80] },
  // A blank is unknown, and the zero beside it is a count of zero.
  { study: "AlphaGamma2002", leader: "Bo Fictional", numbers: [8, 200, null, 0, null] },
  { study: "Delta1999", leader: "Cy Invented", numbers: [5, 150, 6, 60, 60] },
  { study: "EpsilonVanZeta2010", leader: "Eli Madeup", numbers: [3, 90, null, null, null], struck: true },
  { study: "Iota2004 + EtaTheta2005", leader: "Gus Pretend", numbers: [7, 210, 2, 40, 20] },
  { study: "NoSuchStudy1999", leader: null, numbers: [1, 30, null, null, null] },
];

export interface CoordinationWorkbookOptions {
  readonly rows?: readonly SummaryRow[];
  /** The headers of the summary, to spell them differently or to leave one out. */
  readonly headers?: readonly string[];
  /** The row of the header of the summary. The default is 1. */
  readonly headerRow?: number;
  /** A further headed column of the summary, with one value for every study row. */
  readonly extraColumn?: { readonly header: string; readonly value: string };
  /** A tab in the layout of an outreach tab. The default is true. */
  readonly outreachTab?: boolean;
  /** A tab that has none of the layouts that the importer reads. */
  readonly unknownTab?: boolean;
  /** Leaves the summary tab out. */
  readonly withoutSummary?: boolean;
  /** A second tab with the seven summary headers and the same study rows, under another title. */
  readonly secondSummary?: boolean;
}

/** The titles of the two tabs of the fixture, as a maintainer would enter them in the reviewed table. */
export const SUMMARY_TAB_TITLE = "Invented summary";
export const OUTREACH_TAB_TITLE = "Invented outreach";

/** Builds the synthetic coordination workbook: a summary tab, and a hidden tab in the layout of an outreach tab. */
export async function coordinationWorkbook(options: CoordinationWorkbookOptions = {}): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const rows = options.rows ?? SUMMARY_ROWS;
  const titles = [
    ...(options.withoutSummary ? [] : [SUMMARY_TAB_TITLE]),
    ...(options.secondSummary ? ["Invented summary, an earlier copy"] : []),
  ];
  for (const title of titles) {
    const sheet = workbook.addWorksheet(title);
    const headerRow = options.headerRow ?? 1;
    if (headerRow > 1) sheet.getCell("A1").value = "An invented overview of the studies";
    const headers = options.headers ?? SUMMARY_HEADERS;
    headers.forEach((text, index) => {
      sheet.getCell(headerRow, index + 1).value = text;
    });
    if (options.extraColumn !== undefined)
      sheet.getCell(headerRow, headers.length + 1).value = options.extraColumn.header;
    rows.forEach((row, offset) => {
      const at = headerRow + 1 + offset;
      sheet.getCell(at, 1).value = row.study;
      if (row.struck) sheet.getCell(at, 1).font = { strike: true };
      if (row.leader !== null) sheet.getCell(at, 2).value = row.leader;
      row.numbers.forEach((value, index) => {
        if (value !== null) sheet.getCell(at, index + 3).value = value;
      });
      if (options.extraColumn !== undefined) sheet.getCell(at, headers.length + 1).value = options.extraColumn.value;
    });
    // Two blank rows, then a total that is computed and is never imported as data.
    const last = headerRow + rows.length;
    const signed = rows.reduce((sum, row) => sum + (typeof row.numbers[0] === "number" ? row.numbers[0] : 0), 0);
    sheet.getCell(last + 3, 2).value = "Total";
    sheet.getCell(last + 3, 3).value = { formula: `SUM(C${headerRow + 1}:C${last})`, result: signed };
  }
  if (options.outreachTab !== false) {
    const sheet = workbook.addWorksheet(OUTREACH_TAB_TITLE, { state: "hidden" });
    sheet.getCell("A1").value = "A search of Replicating Labs";
    sheet.getRow(2).values = [
      "Contact name",
      "Contact email",
      "Date email sent first time",
      "Date follow-up email sent",
      "Result",
      "Notes",
    ];
    sheet.getRow(3).values = ["Hal Nobody", "hal.nobody@example.org", "03.02.21", null, "no reply", null];
    sheet.getRow(4).values = [
      "Ida Specimen",
      "ida.specimen@example.org",
      "04.02.2021",
      null,
      "accepted",
      "an invented note",
    ];
  }
  if (options.unknownTab) {
    const sheet = workbook.addWorksheet("Invented notes");
    sheet.getCell("A1").value = "An invented remark that follows no layout";
    sheet.getCell("B3").value = 42;
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
