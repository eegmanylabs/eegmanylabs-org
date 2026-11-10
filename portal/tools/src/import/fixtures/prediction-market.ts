// SYNTHETIC test fixture. Every study, hypothesis, label, note, reviewer and address in this
// workbook is invented, and nothing is copied from the real prediction-market workbook. Only
// the tab titles and the column headers are the real ones, because they are the public
// structure of the workbook (docs/SOURCE_REGISTRY.md). The eight studies are those of the
// synthetic website data and of the synthetic list of studies. The builder reproduces the
// awkward cases of the real workbook:
//
// | Awkward case                                                        | Where                                        |
// |---------------------------------------------------------------------|----------------------------------------------|
// | Hidden rows that are data, labelled `cancelled`                     | The two rows of `Kappa2006`                  |
// | A hidden tab whose status column has no header                      | `review`, column B                           |
// | A link whose text is a label, with the address in the target only   | `infosheet_link`                             |
// | A citation without its DOI in the text                              | `Lambda2003`                                 |
// | An identifier with a diacritic, and link labels that are misspelled | `ÉpsilonVanZeta2010`, `Itoa2004`             |
// | Numbers stored as numbers, the text `null`, and blank beside `no`   | `hypothesis_number`, `year`, `null-sig`, `replicated` |
// | An outcome label on a study that is not finished, and on a `null` hypothesis | `AlphaBeta2001`                     |
// | A year that the website writes with a letter, and a title it writes differently | `AlphaGamma2002`                 |
// | A hypothesis text with a trailing space and doubled spaces          | `Iota2004`                                   |
// | Footer cells below the data: a typed counter, a counting formula under a date format, a dated note, a link | Rows 14, 16 and 19 |
// | Lists that validate the status columns, one of them with a label that names a reviewer | Columns F and G, `review` column B |
// | Headings, questions and options in one column, told apart by font, with one question twice | `questions4MarketsNSurvey` |
import ExcelJS from "exceljs";
import { citationOf } from "./list-of-studies";

/** The status label of the review tab, which embeds the given name of an invented reviewer. */
export const REVIEW_STATUS_LABEL = "checked_Zebedee";

/** The two notes of the review tab: one about the tab as a whole, one about its study. */
export const REVIEW_NOTES = [
  "An invented note that speaks about the tab as a whole ",
  "An invented note that speaks about one study",
] as const;

/**
 * What the real workbook restricts, in its synthetic form: the label that names a reviewer and
 * the review notes. A test asserts that none of these leaves the source records. The labels of
 * `replicated` are restricted as well. They are common words, so a test checks where they are
 * stored instead of searching for them.
 */
export const PREDICTION_MARKET_RESTRICTED = [
  REVIEW_STATUS_LABEL,
  "Zebedee",
  ...REVIEW_NOTES.map((note) => note.trim()),
];

export interface HypothesisFixture {
  /** The identifier as the row writes it. */
  readonly studyId: string;
  readonly number: number;
  readonly text: string;
  readonly nullSig: string;
  readonly replicated: string | null;
  readonly hidden?: boolean;
}

interface PaperFixture {
  /** The label of the infosheet link, which names the study in its own spelling. */
  readonly label: string;
  readonly osf: string;
  readonly infosheet: string;
  readonly authors: string;
  readonly year: number;
  readonly title: string;
  readonly citation: string;
  readonly doi: string;
}

const infosheet = (name: string) => `https://docs.example.org/document/d/invented-infosheet-${name}/edit?usp=sharing`;
const AUTHORS = "Invented, A., & Authors, B.";

/** The study-level cells, which every row of a study repeats. */
export const PAPERS: Readonly<Record<string, PaperFixture>> = {
  AlphaBeta2001: {
    label: "AlphaBeta2001",
    osf: "https://osf.example.org/ab001",
    infosheet: infosheet("alphabeta"),
    authors: AUTHORS,
    year: 2001,
    title: "An invented study called AlphaBeta2001",
    citation: citationOf("2001", "10.1000/invented.2001.01"),
    doi: "10.1000/invented.2001.01",
  },
  AlphaGamma2002: {
    label: "AlphaGamma2002",
    osf: "https://osf.example.org/ag002",
    infosheet: infosheet("alphagamma"),
    authors: AUTHORS,
    year: 2002,
    // The website writes the same title without its last words.
    title: "An invented study called AlphaGamma2002. Journal of Examples",
    citation: citationOf("2002", "10.1000/INVENTED(2002)02"),
    doi: "10.1000/INVENTED(2002)02",
  },
  Delta1999: {
    label: "Delta1999",
    osf: "https://osf.example.org/de999",
    infosheet: infosheet("delta"),
    authors: AUTHORS,
    year: 1999,
    title: "An invented study called Delta1999",
    citation: citationOf("1999", "10.1000/invented.1999.03"),
    doi: "10.1000/invented.1999.03",
  },
  ÉpsilonVanZeta2010: {
    // The label is the usual spelling, and the identifier column carries a diacritic.
    label: "EpsilonVanZeta2010",
    osf: "https://osf.example.org/ep010",
    infosheet: infosheet("epsilon"),
    authors: AUTHORS,
    year: 2010,
    title: "An invented study called EpsilonVanZeta2010",
    citation: citationOf("2010", "10.1000/invented.2010.04"),
    doi: "10.1000/invented.2010.04",
  },
  EtaTheta2005: {
    label: "EtaTheta2005",
    osf: "https://osf.example.org/et005",
    infosheet: infosheet("etatheta"),
    authors: AUTHORS,
    year: 2005,
    title: "An invented study called EtaTheta2005",
    citation: citationOf("2005", "10.1000/invented.2005.05"),
    doi: "10.1000/invented.2005.05",
  },
  Iota2004: {
    // Two letters of the label are transposed.
    label: "Itoa2004",
    osf: "https://osf.example.org/io004",
    infosheet: infosheet("iota"),
    authors: AUTHORS,
    year: 2004,
    title: "An invented study called Iota2004",
    citation: citationOf("2004", "10.1000/invented.2004.06"),
    doi: "10.1000/invented.2004.06",
  },
  Kappa2006: {
    label: "Kappa2006",
    osf: "https://osf.example.org/ka006",
    infosheet: infosheet("kappa"),
    authors: AUTHORS,
    year: 2006,
    title: "A fictitious account of rewards that were never paid",
    citation: citationOf("2006", "10.1000/invented.2006.07", "A fictitious account of rewards that were never paid"),
    doi: "10.1000/invented.2006.07",
  },
  Lambda2003: {
    label: "Lambda2003",
    osf: "https://osf.example.org/la003",
    infosheet: infosheet("lambda"),
    authors: AUTHORS,
    year: 2003,
    title: "A made-up report on imaginary rhythms",
    // The DOI of this paper is in the target of the link only.
    citation:
      "Invented, A., & Authors, B. (2003). A made-up report on imaginary rhythms. Journal of Examples, 1(1), 1–2.",
    doi: "10.1000/invented.2003.08",
  },
};

/** The twelve hypotheses of the eight studies, in the order of the sheet. */
export const HYPOTHESES: readonly HypothesisFixture[] = [
  {
    studyId: "AlphaBeta2001",
    number: 1,
    text: "Errors are followed by a larger negativity",
    nullSig: "sig",
    replicated: "no",
  },
  {
    studyId: "AlphaBeta2001",
    number: 2,
    text: "The negativity is not different between groups",
    nullSig: "null",
    replicated: "no",
  },
  {
    studyId: "AlphaGamma2002",
    number: 1,
    text: "Unexpected words give a larger N400",
    nullSig: "sig",
    replicated: null,
  },
  {
    studyId: "Delta1999",
    number: 1,
    text: "Targets give a contralateral negativity",
    nullSig: "sig",
    replicated: null,
  },
  {
    studyId: "Delta1999",
    number: 2,
    text: "Distractors do not influence the negativity",
    nullSig: "null",
    replicated: null,
  },
  {
    studyId: "Delta1999",
    number: 3,
    text: "The negativity is larger for No-Go trials",
    nullSig: "sig",
    replicated: null,
  },
  {
    studyId: "ÉpsilonVanZeta2010",
    number: 1,
    text: "Delay activity grows with load",
    nullSig: "sig",
    replicated: null,
  },
  {
    studyId: "EtaTheta2005",
    number: 1,
    text: "Emotional pictures give a larger positivity",
    nullSig: "sig",
    replicated: "yes",
  },
  {
    studyId: "Iota2004",
    number: 1,
    text: "Alpha  power decreases over  the attended side ",
    nullSig: "sig",
    replicated: null,
  },
  {
    studyId: "Kappa2006",
    number: 1,
    text: "Losses give a larger negativity",
    nullSig: "sig",
    replicated: "cancelled",
    hidden: true,
  },
  {
    studyId: "Kappa2006",
    number: 2,
    text: "Wins and losses do not differ later on",
    nullSig: "null",
    replicated: "cancelled",
    hidden: true,
  },
  { studyId: "Lambda2003", number: 1, text: "Phase before onset predicts detection", nullSig: "sig", replicated: null },
];

export const PROGRAMME_LINK = {
  description: "An invented description of the link that stands beside it",
  label: "Invented general information",
  address: "https://docs.example.org/document/d/invented-general-information/edit?usp=sharing",
} as const;

type Font = "bold" | "italic" | null;

/**
 * The rows of the questions tab: the text, its choices and its font. A null stands for a blank
 * row. Sections and groups are told apart by font alone, as in the real tab.
 */
export const QUESTIONS: readonly (readonly [text: string, choices: string | null, font: Font] | null)[] = [
  ["How well do you understand the hypothesis?", "extremely - not at all", null],
  ["How confident are you in your prediction?", "extremely - not at all", null],
  null,
  ["Were you involved in this replication?", "yes/no", null],
  null,
  [
    "How familiar are you with the original paper?",
    "I have read it, I have cited it, I wrote it, It is new to me",
    null,
  ],
  ["I have a conflict of interest", "tickbox", null],
  null,
  ["Optional", null, null],
  ["Why did you predict this?", null, "italic"],
  ["What shaped your invented forecast", null, "italic"],
  ["Sample size of the original study", "tickbox", null],
  ["Something else, say what", "field", null],
  null,
  null,
  ["About you", null, "bold"],
  ["Age", null, null],
  ["Number of EEG papers published", "number", null],
  null,
  ["Invented open practices", null, "italic"],
  ["Shared an invented protocol", "tickbox", null],
  ["Shared an invented protocol", "tickbox", null],
  ["Posted invented data openly", "tickbox", null],
];

const HEADERS = [
  "study_id",
  "studyDescr_pdf",
  "infosheet_link",
  "hypothesis_number",
  "hypothesis_text",
  "null-sig",
  "replicated",
  "authors",
  "year",
  "title",
  "citation",
] as const;

export interface PredictionMarketOptions {
  readonly hypotheses?: readonly HypothesisFixture[];
  /** Changes the finished workbook before it is written, for a test of one awkward case. */
  readonly change?: (workbook: ExcelJS.Workbook) => void;
}

/** Builds the synthetic prediction-market workbook: three tabs, the second of them hidden. */
export async function predictionMarketWorkbook(options: PredictionMarketOptions = {}): Promise<Uint8Array> {
  const hypotheses = options.hypotheses ?? HYPOTHESES;
  const workbook = new ExcelJS.Workbook();

  const links = workbook.addWorksheet("links_hypotheses");
  links.getRow(1).values = [...HEADERS];
  links.getRow(1).font = { bold: true };
  const last = hypotheses.length + 1;
  hypotheses.forEach((hypothesis, index) => {
    const row = index + 2;
    const paper = PAPERS[hypothesis.studyId];
    if (paper === undefined) throw new RangeError(`The fixture knows no paper for ${hypothesis.studyId}.`);
    links.getCell(row, 1).value = hypothesis.studyId;
    links.getCell(row, 2).value = { text: paper.osf, hyperlink: paper.osf };
    links.getCell(row, 3).value = { text: paper.label, hyperlink: paper.infosheet };
    links.getCell(row, 4).value = hypothesis.number;
    links.getCell(row, 5).value = hypothesis.text;
    links.getCell(row, 6).value = hypothesis.nullSig;
    if (hypothesis.replicated !== null) links.getCell(row, 7).value = hypothesis.replicated;
    links.getCell(row, 8).value = paper.authors;
    links.getCell(row, 9).value = paper.year;
    links.getCell(row, 10).value = paper.title;
    links.getCell(row, 11).value = { text: paper.citation, hyperlink: `https://doi.org/${paper.doi}` };
    links.getCell(row, 6).dataValidation = { type: "list", allowBlank: true, formulae: ['"sig,null"'] };
    links.getCell(row, 7).dataValidation = { type: "list", allowBlank: true, formulae: ['"no,yes,cancelled"'] };
    if (hypothesis.hidden) links.getRow(row).hidden = true;
  });
  // The footer: counters that nobody may parse, a dated note, and the link of the programme.
  const count = (column: "nullSig" | "replicated", value: string) =>
    hypotheses.filter((hypothesis) => hypothesis[column] === value).length;
  links.getCell(last + 1, 6).value = `${count("nullSig", "null")}/${hypotheses.length}`;
  links.getCell(last + 1, 7).value = {
    formula: `COUNTIF(G2:G${last},"yes") & "/" & (COUNTIF(G2:G${last},"no")+COUNTIF(G2:G${last},"yes"))`,
    result: `${count("replicated", "yes")}/${count("replicated", "yes") + count("replicated", "no")}`,
  };
  // The format of a date on a counter is what turns it into a date in a type-guessing reader.
  links.getCell(last + 1, 7).numFmt = "m/d";
  links.getCell(last + 3, 6).value =
    `${hypotheses.length - count("replicated", "cancelled")} hypotheses left (08.2026)`;
  links.getCell(last + 6, 1).value = PROGRAMME_LINK.description;
  links.getCell(last + 6, 3).value = { text: PROGRAMME_LINK.label, hyperlink: PROGRAMME_LINK.address };

  const review = workbook.addWorksheet("review", { state: "hidden" });
  review.getCell("A1").value = "study_id";
  review.getCell("C1").value = "notes";
  const reviewed = [...new Set(hypotheses.map((hypothesis) => hypothesis.studyId))];
  reviewed.forEach((studyId, index) => {
    const row = index + 2;
    // The review tab writes every identifier without a diacritic.
    review.getCell(row, 1).value = studyId.normalize("NFD").replace(/\p{M}/gu, "");
    review.getCell(row, 2).value = REVIEW_STATUS_LABEL;
    review.getCell(row, 2).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"checked_pass1,checked_pass2,${REVIEW_STATUS_LABEL}"`],
    };
  });
  review.getCell("C2").value = REVIEW_NOTES[0];
  review.getCell("C4").value = REVIEW_NOTES[1];

  const questions = workbook.addWorksheet("questions4MarketsNSurvey");
  questions.getCell("A1").value = "Question about the specific paper";
  questions.getCell("B1").value = "Choices";
  questions.getRow(1).font = { bold: true };
  QUESTIONS.forEach((entry, index) => {
    if (entry === null) return;
    const [text, choices, font] = entry;
    const row = index + 2;
    questions.getCell(row, 1).value = text;
    if (choices !== null) questions.getCell(row, 2).value = choices;
    if (font !== null) questions.getCell(row, 1).font = { [font]: true };
  });

  options.change?.(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
