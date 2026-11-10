// SYNTHETIC test fixture. Every term below is invented: the names, the abbreviations, the
// descriptions and the codes describe no real questionnaire and no real concept, and nothing is
// copied from the real community vocabulary. Only the column headers and the shape of the
// identifiers are the real ones, because they are the public format of such a sheet. The builder
// reproduces the structure and the awkward cases of the real workbook:
//
// | Awkward case of the real workbook                              | Where it is reproduced            |
// |----------------------------------------------------------------|-----------------------------------|
// | Hundreds of rows that are formatted as text in advance and hold nothing | Column A below the terms  |
// | A column that exists and is empty on every row                 | `invalid_reason`                  |
// | One external code that two terms share                         | `trm_001` and `trm_002`           |
// | A code of the long format, from the extension of one namespace | `trm_004`                         |
// | A description with two spaces in a row                         | `trm_004`                         |
// | An abbreviation with transposed letters, which nothing can detect | `trm_007`                      |
// | A type that only the name states                               | `trm_006`                         |
// | Abbreviations that begin alike, in two families                | `IMI-` and `DEMO-`                |
// | A frozen header row                                            | Row 1                             |
import ExcelJS from "exceljs";

/** One row of the synthetic vocabulary. A value that is left out is a cell that holds nothing. */
export interface VocabularyRow {
  readonly id?: string | number;
  readonly name?: string;
  readonly abbreviation?: string;
  readonly description?: string;
  readonly invalidReason?: string;
  readonly sameAs?: string;
  /** A value in a column beyond the six of the format. */
  readonly extra?: string;
}

/** The synthetic vocabulary as it stands at first: eight invented terms in two categories. */
export const VOCABULARY_ROWS: readonly VocabularyRow[] = [
  {
    id: "trm_001",
    name: "Participant - Invented Mood Inventory (Morning Form)",
    abbreviation: "IMI-Morning",
    description: "Invented morning mood (asked in person)",
    sameAs: "snomed:900001007",
  },
  {
    id: "trm_002",
    name: "Participant - Invented Mood Inventory (Evening Form)",
    abbreviation: "IMI-Evening",
    description: "Invented evening mood (asked in person)",
    sameAs: "snomed:900001007",
  },
  {
    id: "trm_003",
    name: "Participant - Fictional Handedness Checklist",
    abbreviation: "FHC",
    description: "Hand preference in a checklist that does not exist (asked in person)",
  },
  {
    id: "trm_004",
    name: "Participant - Made-up condition",
    abbreviation: "SAMPLE-Condition",
    description: "has a made-up condition  (asked in person)",
    sameAs: "snomed:90000501000000106",
  },
  {
    id: "trm_005",
    name: "Meta - Has invented signal",
    abbreviation: "DEMO-Signal",
    description: "has an invented signal recorded",
  },
  {
    id: "trm_006",
    name: "Meta - N invented channels (integer)",
    abbreviation: "DEMO-Channels",
    description: "number of invented channels",
  },
  {
    id: "trm_007",
    name: "Meta - Imaginary task data",
    abbreviation: "DEMO-Taks",
    description: "has imaginary task data",
  },
  {
    id: "trm_008",
    name: "Meta - Time of an invented day",
    abbreviation: "TOID",
    description: "has invented time information",
  },
];

export const VOCABULARY_HEADERS = ["id", "name", "abbreviation", "description", "invalid_reason", "same_as"] as const;

export interface VocabularyWorkbookOptions {
  readonly rows?: readonly VocabularyRow[];
  /** The six headers of row 1, to change their case or to break the header check. */
  readonly headers?: readonly string[];
  /** The header of a seventh column, which the format does not know. Left out, the column has no header. */
  readonly extraHeader?: string;
  /** The identifier of a term above which one row is left blank. */
  readonly blankRowAbove?: string;
  /** A second tab, which the importer refuses. */
  readonly secondTab?: boolean;
  /** The last row down to which column A is formatted as text in advance. */
  readonly formattedDownTo?: number;
}

/** Builds the synthetic community vocabulary workbook: one tab, headers in row 1, one term to a row. */
export async function vocabularyWorkbook(options: VocabularyWorkbookOptions = {}): Promise<Uint8Array> {
  const rows = options.rows ?? VOCABULARY_ROWS;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.getRow(1).values = [
    ...(options.headers ?? VOCABULARY_HEADERS),
    ...(options.extraHeader === undefined ? [] : [options.extraHeader]),
  ];
  let at = 2;
  for (const row of rows) {
    if (row.id === options.blankRowAbove) at += 1;
    const cells = [row.id, row.name, row.abbreviation, row.description, row.invalidReason, row.sameAs, row.extra];
    cells.forEach((value, index) => {
      // A value that is left out stays a cell that does not exist, which is not an empty text.
      if (value !== undefined) sheet.getCell(at, index + 1).value = value;
    });
    at += 1;
  }
  // The real sheet formats its identifier column as text far below the last term.
  for (let row = 1; row <= (options.formattedDownTo ?? 60); row += 1) sheet.getCell(row, 1).numFmt = "@";
  if (options.secondTab) workbook.addWorksheet("Sheet2").getCell("A1").value = "an invented second tab";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
