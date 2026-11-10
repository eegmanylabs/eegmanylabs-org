// SYNTHETIC test fixture. Every study, paper, person, note and address in this workbook is
// invented, and nothing is copied from the real list of studies. Only the tab titles and the
// column headers are the real ones, because they are the public structure of the workbook
// (docs/SOURCE_REGISTRY.md). The six studies that the synthetic website data holds reappear
// here, with two that it does not hold. The builder reproduces the awkward cases of the real
// workbook:
//
// | Awkward case                                                          | Where                                         |
// |-----------------------------------------------------------------------|-----------------------------------------------|
// | Two header rows, with banners in arbitrary cells of row 1 and headers that exist in row 1 only | Every tab except `Sheet5`     |
// | Headers that end in a line feed or a space, and a micro sign          | `Notes. Comments`, `Name `, the statistics header |
// | Hidden tabs, and hidden columns that hold data                        | `questionnaires`, `Sheet5`; keyword and group columns |
// | A citation column with no header at all, and one headed by one space  | `shortlist_archived`, `AlphaAsymmetry_RSSubproject` |
// | A citation as a `HYPERLINK` formula, and one whose address is text only | `Delta1999`, `EpsilonVanZeta2010`           |
// | A DOI with capitals and parentheses, a mistyped DOI, and rows without one | `AlphaGamma2002`, `Lambda2003`, `Phi1992`, `Upsilon2004`, `Psi1995` |
// | Free text, several experiments and a remark about a person in numeric columns | `AlphaGamma2002`, `Delta1999`, `Iota2004` |
// | A blank, a cell of white space and tokens such as `none` and `-`      | The equipment and questionnaire columns       |
// | A stage outside the validated list, and a line appended to a stage or type cell | `Kappa2006`, `Omega1998`, `Sigma1997`, `Upsilon2004` |
// | A lead that differs between two tabs, and one that differs from the website | `EpsilonVanZeta2010`, `Iota2004`        |
// | Keywords copied from another study, and a year that differs between tabs | `AlphaGamma2002`                           |
// | A sign-up link that is an editor address, and a target ending in a stray parenthesis | `EpsilonVanZeta2010`           |
// | Votes typed as names, two in one cell, one with a remark, and a stale vote count | `allranked_archived`               |
// | Names left over in group columns under a banner about confirmed laboratories | `AlphaBeta2001` in two tabs            |
import ExcelJS from "exceljs";

/**
 * What the real workbook restricts, in its synthetic form: the names of leads, extractors,
 * reviewers and voters, the notes, and the remarks that sit inside value cells. A test asserts
 * that none of these reaches a document that members can read, a log line or the statistics of
 * a batch.
 */
export const LIST_OF_STUDIES_RESTRICTED = [
  "Ada Example",
  "Bo Fictional",
  "Dee Imaginary",
  "Eli Madeup",
  "Fay Notreal",
  "Hal Nobody",
  "Jo Standin",
  "Kit Placeholder",
  "Ivy Earlier",
  "Lin Extractor",
  "Moe Checker",
  "Ned Reviewer",
  "Ann Voter",
  "Ben Voter",
  "Cal Voter",
  "Dot Voter",
  "Nia Suggester",
  "Zed Remarker",
  "thinks the sample is too small",
  "recheck the effect size",
  "zed@example.org",
  "lab.example.org/cal",
] as const;

type Value = string | number | { readonly text: string; readonly hyperlink: string } | null;

const doiAddress = (doi: string) => `https://doi.org/${doi}`;

/** The reference of a paper in the form of the synthetic website data, so that the two sources can agree. */
export const citationOf = (year: string, doi: string, title = "An invented study of nothing in particular") =>
  `Invented, A., & Authors, B. (${year}). ${title}. Journal of Examples, 1(1), 1–2. ${doiAddress(doi)}`;

const HEADERS = {
  effect:
    "The effect of interest. (EEG findings are a combination of spatial, [frequency], and temporal features. The effect should be localized in all relevant to the study dimensions.)",
  plain: "The effect of interest in plain language",
  originalN: "original N",
  statistics:
    "Statistics from the original paper (t, F, p values, effect sizes including µV effect size where available)",
  effectSize: "Standardized effect size (d, r, partial eta)",
  convertedR: "Original effect sizes converted to r",
  bayesFactor: "BF10",
  duration: "Your estimation of the time to complete the study in min (without preparation time)\n",
  sample: "Type of the sample (community, college students, etc)",
  channels:
    "minimal number of channels to obtain the effect (e.g. 1 channel if the main effect was analyzed in Cz channel only)",
  equipment: "additional requirements to the equipment (e.g., eye-tracker, EDA sensor, etc)",
  powerN:
    "Required N to have 90% power to detect the effect, assuming that the effect size is 50% of that in the original study",
  questionnaires: "Questionnaires. If there were any",
  notes: "Notes. Comments\n",
  studyType: "Correlational/experimental study",
  outcome: "Main outcome variable (ERP component, EEG phenomenon)",
  construct: "Psychological Construct",
  descriptors: "Other Descriptors",
} as const;
type ExtractionField = keyof typeof HEADERS;

/** The extraction columns in the order of the sheets. `convertedR` exists in the current tab only. */
const EXTRACTION_ORDER: readonly ExtractionField[] = [
  "effect",
  "plain",
  "originalN",
  "statistics",
  "effectSize",
  "convertedR",
  "bayesFactor",
  "duration",
  "sample",
  "channels",
  "equipment",
  "powerN",
  "questionnaires",
  "notes",
  "studyType",
  "outcome",
  "construct",
  "descriptors",
];

const STAGE_LIST = [
  "Data extracted (stage 1)",
  "Data verified (stage 2)",
  "Looking for replicating labs (stage 3)",
  "Team is assembled. Registered report Stage 1 preparation (stage 4) ",
  "Registered report Stage 1 submitted/under review/revision (stage 5) ",
  "IPA acquired. Data collection (stage 6) ",
  "Data collection completed. Stage 2 RR submitted.",
  "Completed",
] as const;

const GROUP_BANNER =
  "An invented banner about laboratories that confirmed their part, which stands in one cell of its group";
const VOTE_BANNER = "AN INVENTED BANNER THAT ASKS READERS TO TYPE THEIR NAMES";
const GROUP_COUNT = 24;

type Extraction = Partial<Record<ExtractionField, Value>>;

export interface StudyFixture {
  readonly studyId: string;
  readonly doi: string;
  readonly lead: string;
  /** The citation cell of the current tab. */
  readonly citation: Value | { readonly formula: string; readonly result: string };
  readonly abstract: string;
  readonly extraction: Extraction;
  readonly stage: string;
  readonly signup: { readonly text: string; readonly hyperlink: string };
  /** Names left in the group columns `Group18` to `Group22`. */
  readonly leftovers?: readonly string[];
}

const linked = (year: string, doi: string, title?: string) => ({
  text: citationOf(year, doi, title),
  hyperlink: doiAddress(doi),
});
const form = (name: string) => ({
  text: `https://forms.example.org/${name}`,
  hyperlink: `https://forms.example.org/${name}`,
});

/** The handedness questionnaire of one study, which the hidden planning list repeats word for word. */
export const QUESTIONNAIRE_TEXT = "The Invented Handedness Inventory (Nobody, 1971)";

/**
 * The eight rows of the current tab.
 *
 * | Study                | What its row shows                                                                 |
 * |----------------------|------------------------------------------------------------------------------------|
 * | `AlphaBeta2001`      | Numeric cells, a required N with its assumptions, a restricted note, leftover names |
 * | `AlphaGamma2002`     | Several experiments in one cell, a dated remark in a value cell, keywords of another study |
 * | `Delta1999`          | A citation as a formula, a Bayes factor labelled BF01, white space for equipment    |
 * | `EpsilonVanZeta2010` | A citation without a link, an editor address, a target with a stray parenthesis     |
 * | `EtaTheta2005`       | A reference that differs from the website, the stage `Completed`                    |
 * | `Iota2004`           | A lead that differs from the website, an address inside a value cell                |
 * | `Kappa2006`          | Not on the website, with a stage outside the validated list                         |
 * | `Lambda2003`         | Not on the website, with a DOI that the ranked list mistypes                        |
 */
export const STUDIES: readonly StudyFixture[] = [
  {
    studyId: "AlphaBeta2001",
    doi: "10.1000/invented.2001.01",
    lead: "Ada Example",
    citation: linked("2001", "10.1000/invented.2001.01"),
    abstract: "An invented abstract about conflict in a task that nobody ran.",
    extraction: {
      effect: " Larger invented negativity after errors than after correct responses ",
      plain: "People notice their own invented mistakes",
      originalN: 19,
      statistics: "F(2,58)=5.12, P<0.05",
      effectSize: "r = .42",
      convertedR: 0.412,
      bayesFactor: "BF10 = 3.207",
      duration: "~40 mins",
      sample: "invented volunteers\nright-handed",
      channels: 1,
      equipment: "none",
      powerN: "N=84 (one-tailed, with dz=.31, alpha level 0.02, power 90)",
      questionnaires: `${QUESTIONNAIRE_TEXT}\n`,
      notes: "Zed Remarker thinks the sample is too small",
      studyType: "1_Experimental",
      outcome: "N1x,P9z",
      construct: "conflict monitoring",
      descriptors: "press/no-press task, invented views",
    },
    stage: "IPA acquired. Data collection (stage 6) ",
    signup: form("alphabeta"),
    leftovers: ["Ann Voter", "Ben Voter", "Cal Voter", "Dot Voter", "Ann Voter"],
  },
  {
    studyId: "AlphaGamma2002",
    doi: "10.1000/INVENTED(2002)02",
    lead: "Bo Fictional ",
    citation: linked("2002", "10.1000/INVENTED(2002)02"),
    abstract: "An invented abstract about words that nobody read.",
    extraction: {
      effect: "A larger invented N400 for unexpected words",
      plain: "Surprising words stand out",
      originalN: "N=17 (+3 excluded)",
      statistics: "Expt1: t(12)=2.5, p<.05\nExpt2: t(14)=3.1, p<.01",
      effectSize: "2024-03-05 Zed Remarker: recheck the effect size, d = 0.4",
      convertedR: "r = .41",
      bayesFactor: 3.2,
      duration: "1 hour",
      sample: "a sample of volunteers\nhandedness not stated",
      channels: "2: P4-P3",
      equipment: "-",
      powerN: 44,
      notes: "Checked twice",
      studyType: "1_Experimental",
      // The three keyword cells are those of the study above, which the ranked list contradicts.
      outcome: "N1x,P9z",
      construct: "conflict monitoring",
      descriptors: "press/no-press task, invented views",
    },
    stage: "Registered report Stage 1 submitted/under review/revision (stage 5) ",
    signup: form("alphagamma"),
  },
  {
    studyId: "Delta1999",
    doi: "10.1000/invented.1999.03",
    lead: "Dee Imaginary",
    citation: {
      formula: `HYPERLINK("${doiAddress("10.1000/invented.1999.03")}","${citationOf("1999", "10.1000/invented.1999.03")}")`,
      result: citationOf("1999", "10.1000/invented.1999.03"),
    },
    abstract: "An invented abstract about targets that nobody saw.",
    extraction: {
      effect: "An invented posterior contralateral negativity for targets",
      plain: "Attention goes where the target is",
      originalN: 28,
      statistics: "t(27)=3.9",
      effectSize: "d = 0.75",
      convertedR: 0.6,
      bayesFactor: "BF01 = 4.2",
      duration: "45 min",
      sample: "volunteers\nright-handed",
      channels: "1 (Cz)",
      equipment: "  ",
      powerN: "n = 60 for .90 power, one-tailed test",
      questionnaires: "N/A",
      studyType: "1_Experimental",
      outcome: "N2pc",
      construct: "visual perception, attention",
    },
    stage: "Looking for replicating labs (stage 3)",
    signup: form("delta"),
  },
  {
    studyId: "EpsilonVanZeta2010",
    doi: "10.1000/invented.2010.04",
    lead: "Eli Madeup",
    // The address of the paper is text only, and the cell ends in a line feed and two spaces.
    citation: `${citationOf("2010", "10.1000/invented.2010.04")}\n  `,
    abstract: "An invented abstract about items that nobody remembered.",
    extraction: {
      effect: "An invented delay activity that grows with memory load",
      plain: "Holding more in mind takes more activity",
      originalN: 12,
      statistics: "F(1,11)=9.1",
      effectSize: "pη2=0.45",
      convertedR: 0.67,
      bayesFactor: 12.5,
      duration: "2 hours",
      sample: "invented volunteers\nright-handed",
      channels: "3 (Oz, Pz, Cz)",
      equipment: "a response box is desirable",
      powerN: {
        text: "see the invented power document for 2 analyses",
        hyperlink: "https://docs.example.org/document/d/invented-power-doc)",
      },
      studyType: "1_Experimental",
      outcome: "CDA",
      construct: "working memory",
      descriptors: "change detection",
    },
    stage: "Team is assembled. Registered report Stage 1 preparation (stage 4) ",
    signup: {
      text: "https://docs.google.com/forms/d/another-invented-form/edit",
      hyperlink: "https://docs.google.com/forms/d/another-invented-form/edit",
    },
  },
  {
    studyId: "EtaTheta2005",
    doi: "10.1000/invented.2005.05",
    lead: "Fay Notreal",
    // The same paper as on the website, cited with other pages.
    citation: {
      text: citationOf("2005", "10.1000/invented.2005.05").replace("1–2", "11–22"),
      hyperlink: doiAddress("10.1000/invented.2005.05"),
    },
    abstract: "An invented abstract about faces that nobody feared.",
    extraction: {
      effect: "A larger invented late positivity for emotional pictures",
      plain: "Emotional pictures hold attention",
      originalN: 30,
      statistics: "r(28) = .48, p < .02",
      effectSize: 0.48,
      convertedR: 0.48,
      duration: "Unknown",
      sample: "all right-handed adults",
      channels: 3,
      equipment: "no",
      powerN: 120,
      questionnaires: "none",
      studyType: "2_Correlational",
      outcome: "LPP",
      construct: "emotions",
    },
    stage: "Completed",
    signup: {
      text: "https://docs.google.com/forms/d/an-invented-form-identifier/edit",
      hyperlink: "https://docs.google.com/forms/d/an-invented-form-identifier/edit",
    },
  },
  {
    studyId: "Iota2004",
    doi: "10.1000/invented.2004.06",
    lead: "Hal Nobody",
    citation: linked("2004", "10.1000/invented.2004.06"),
    abstract: "An invented abstract about cues that nobody followed.",
    extraction: {
      effect: "An invented alpha decrease over the attended side",
      plain: "Larger effects, see the mail from zed@example.org",
      originalN: 16,
      statistics: "t(15)=2.2",
      effectSize: "d = 0.55",
      convertedR: 0.49,
      bayesFactor: "BF = 1.84",
      duration: "25min",
      sample: "students",
      channels: "4",
      powerN: "64 participants",
      studyType: "1_Experimental",
      outcome: "invented rhythm power",
      construct: "attention",
      descriptors: "pretend cueing",
    },
    stage: "Data collection completed. Stage 2 RR submitted.",
    signup: form("iota"),
  },
  {
    studyId: "Kappa2006",
    doi: "10.1000/invented.2006.07",
    lead: "Jo Standin",
    citation: linked("2006", "10.1000/invented.2006.07", "A fictitious account of rewards that were never paid"),
    abstract: "An invented abstract about rewards.",
    extraction: {
      effect: "An invented feedback negativity for losses",
      plain: "Losses register quickly",
      originalN: 20,
      statistics: "F(1,19)=6.0",
      effectSize: "pη2=0.24",
      convertedR: 0.49,
      bayesFactor: "BF10 = 3.1",
      duration: "40 min",
      sample: "volunteers\nright-handed",
      channels: "1 (Oz)",
      powerN: "N=70",
      studyType: "1_Experimental",
      outcome: "FRN",
      construct: "imaginary reward",
      descriptors: "pretend wager task",
    },
    stage: "Currently put on hold",
    signup: form("kappa"),
  },
  {
    studyId: "Lambda2003",
    doi: "10.1000/invented.2003.08",
    lead: "Kit Placeholder",
    citation: linked("2003", "10.1000/invented.2003.08", "A made-up report on imaginary rhythms"),
    abstract: "An invented abstract about rhythms.",
    extraction: {
      effect: "An invented phase effect before stimulus onset",
      plain: "Timing matters",
      originalN: 14,
      statistics: "t(13)=2.9",
      effectSize: "d = 0.78",
      convertedR: 0.63,
      bayesFactor: "BF10 = 5.0",
      duration: "50 min",
      sample: "students",
      channels: "1 (Pz)",
      powerN: "N=58",
      studyType: "2_Correlational",
      outcome: "alpha phase",
      construct: "visual perception",
    },
    stage: "Looking for replicating labs (stage 3)",
    signup: form("lambda"),
  },
];

interface ShortlistFixture {
  readonly citation: Value | { readonly formula: string; readonly result: string };
  readonly extractor: string;
  readonly reviewer: string | null;
  readonly stage: string;
  readonly lead?: string;
  readonly signup?: { readonly text: string; readonly hyperlink: string };
  /** What differs from the current tab, or the whole extraction of a paper that never became a study. */
  readonly extraction: Extraction;
  readonly leftovers?: readonly string[];
}

const current = (studyId: string): Extraction => {
  const { convertedR: _only, ...shared } = STUDIES.find((study) => study.studyId === studyId)?.extraction ?? {};
  return shared;
};

/**
 * The ten rows of the shortlist: an earlier generation of the eight studies, and two papers
 * that never became a study. The required N differs from the current tab on every row.
 */
const SHORTLIST: readonly ShortlistFixture[] = [
  {
    citation: linked("2001", "10.1000/invented.2001.01"),
    extractor: "Lin Extractor; Moe Checker",
    reviewer: "Ned Reviewer",
    stage: "Data verified (stage 2)",
    lead: "Ada Example",
    signup: form("alphabeta"),
    extraction: { ...current("AlphaBeta2001"), effectSize: "r = .36", powerN: "N=62 (alpha level 0.05)" },
    leftovers: ["Ann Voter", "Ben Voter", "Cal Voter", "Dot Voter", "Ann Voter"],
  },
  {
    // The same paper as in the current tab, cited with another year.
    citation: linked("2001", "10.1000/INVENTED(2002)02"),
    extractor: "Lin Extractor",
    reviewer: "Ned Reviewer",
    stage: "Data verified (stage 2)",
    extraction: { ...current("AlphaGamma2002"), originalN: 17, powerN: 30 },
  },
  {
    citation: {
      formula: `HYPERLINK("${doiAddress("10.1000/invented.1999.03")}","${citationOf("1999", "10.1000/invented.1999.03")}")`,
      result: citationOf("1999", "10.1000/invented.1999.03"),
    },
    extractor: "Moe Checker",
    reviewer: null,
    stage: "Data extracted (stage 1)",
    extraction: { ...current("Delta1999"), powerN: "n = 40", equipment: null },
  },
  {
    citation: linked("2010", "10.1000/invented.2010.04"),
    extractor: "Lin Extractor",
    reviewer: "Ned Reviewer",
    stage: "Data verified (stage 2)",
    lead: "Ivy Earlier",
    extraction: { ...current("EpsilonVanZeta2010"), powerN: "44 participants for the main effect in Experiment 1" },
  },
  {
    citation: linked("2005", "10.1000/invented.2005.05"),
    extractor: "Moe Checker",
    reviewer: "Ned Reviewer",
    stage: "Data verified (stage 2)",
    extraction: { ...current("EtaTheta2005"), powerN: 90 },
  },
  {
    citation: linked("2004", "10.1000/invented.2004.06"),
    extractor: "Lin Extractor",
    reviewer: "Ned Reviewer",
    stage: "Data extraction is ongoing (stage 0)",
    extraction: { ...current("Iota2004"), plain: "Attention shifts the rhythm", powerN: "50 participants" },
  },
  {
    citation: linked("2006", "10.1000/invented.2006.07", "A fictitious account of rewards that were never paid"),
    extractor: "Moe Checker",
    reviewer: "Ned Reviewer",
    stage: "Open call for Replicating Labs (stage 3)",
    lead: "Jo Standin ",
    extraction: { ...current("Kappa2006"), powerN: "N=55" },
  },
  {
    citation: linked("2003", "10.1000/invented.2003.08", "A made-up report on imaginary rhythms"),
    extractor: "Lin Extractor",
    reviewer: "Ned Reviewer",
    stage: "Data verified (stage 2)",
    extraction: { ...current("Lambda2003"), powerN: "N=40" },
  },
  {
    citation: linked("1998", "10.1000/invented.1998.09", "An imaginary inquiry into sounds that were never played"),
    extractor: "Moe Checker",
    reviewer: "Ned Reviewer",
    stage: "Data verified (stage 2) \nOn hold for an invented reason",
    extraction: {
      effect: "An invented mismatch response",
      plain: "Odd sounds stand out",
      originalN: "18 (+2 excluded)",
      powerN: "N=400",
      studyType: "1_Experimental",
      outcome: "MMN",
      construct: "imaginary hearing",
    },
  },
  {
    citation: linked("1997", "10.1000/invented.1997.10", "A pretend survey of movements that were never made"),
    extractor: "Lin Extractor",
    reviewer: "Ned Reviewer",
    stage: "Data verified (stage 2)\nExcluded (for an invented reason)\n",
    extraction: {
      effect: "An invented readiness potential",
      plain: "The brain prepares to move",
      originalN: 10,
      studyType: "2_Correlational",
      outcome: "RP",
      construct: "motor control",
    },
  },
];

interface RankedFixture {
  readonly authors: string;
  readonly year: number | string;
  readonly title: string;
  readonly journal: string;
  readonly doi: string | null;
  readonly keywords: readonly [outcome: string, construct: string, descriptors: string | null];
  readonly votes: readonly string[];
  /** A cached count that no longer agrees with the cells, in place of the right one. */
  readonly staleCount?: number;
}

const TITLE = "An invented study of nothing in particular";

/** The fourteen rows of the ranked list, in the order of their votes. */
const RANKED: readonly RankedFixture[] = [
  {
    authors: "Invented, A; Authors, B",
    year: 2001,
    title: TITLE.toUpperCase(),
    journal: "JOURNAL OF EXAMPLES",
    doi: "10.1000/invented.2001.01",
    keywords: ["N1x, P9z", "conflict monitoring", "press/no-press task, invented views"],
    votes: ["Ann Voter", "Ben Voter", "Cal Voter", "Dot Voter", "Ann Voter", "Ada Example"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 2002,
    title: `${TITLE} at all`,
    journal: "JOURNAL OF EXAMPLES",
    doi: "10.1000/INVENTED(2002)02",
    keywords: ["N7y", "pretend speech, attention", "invented blink"],
    votes: ["Ann Voter; Ben Voter", "Cal Voter", "Dot Voter", "Bo Fictional", "Eli Madeup"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 1999,
    title: `${TITLE} whatsoever`,
    journal: "Journal of Examples",
    doi: "10.1000/invented.1999.03",
    keywords: ["N2pc", "visual perception, attention", null],
    votes: ["Ann Voter", "Ben Voter", "Cal Voter (see https://lab.example.org/cal)", "Dot Voter", "Dee Imaginary"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 2010,
    title: `${TITLE}, part four`,
    journal: "JOURNAL OF EXAMPLES",
    doi: "10.1000/invented.2010.04",
    keywords: ["CDA", "working memory", "change detection"],
    votes: ["Ann Voter", "Ben Voter", "Cal Voter", "Eli Madeup"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 2005,
    title: `${TITLE}, part five`,
    journal: "JOURNAL OF EXAMPLES",
    doi: "10.1000/invented.2005.05",
    keywords: ["LPP", "emotions", null],
    votes: ["Ann Voter", "Ben Voter", "Dot Voter", "Fay Notreal"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 2004,
    title: `${TITLE}, part six`,
    journal: "JOURNAL OF EXAMPLES",
    doi: "10.1000/invented.2004.06",
    keywords: ["invented rhythm power", "attention", "pretend cueing"],
    votes: ["Ann Voter", "Cal Voter", "Dot Voter", "Hal Nobody"],
    // The formula counted three when a fourth name was typed, and was never recalculated.
    staleCount: 3,
  },
  {
    authors: "Invented, A., & Authors, B.",
    year: 2006,
    title: "A fictitious account of rewards that were never paid",
    journal: "Examples Letters",
    doi: "10.1000/invented.2006.07",
    keywords: ["FRN", "imaginary reward", "pretend wager task"],
    votes: ["Ben Voter", "Cal Voter", "Dot Voter", "Jo Standin"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 2003,
    title: "A made-up report on imaginary rhythms",
    journal: "EXAMPLES LETTERS",
    // One digit is mistyped: the current tab and the shortlist end in `.08`.
    doi: "10.1000/invented.2003.80",
    keywords: ["alpha phase", "visual perception", null],
    votes: ["Ann Voter", "Ben Voter", "Cal Voter", "Kit Placeholder"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 1998,
    title: "An imaginary inquiry into sounds that were never played",
    journal: "EXAMPLES LETTERS",
    doi: "10.1000/invented.1998.09",
    keywords: ["MMN", "imaginary hearing, pretend processing", null],
    votes: ["Ann Voter", "Ben Voter", "Dot Voter"],
  },
  {
    authors: "Invented, A; Authors, B",
    year: 1997,
    title: "A pretend survey of movements that were never made",
    journal: "EXAMPLES LETTERS",
    doi: "10.1000/invented.1997.10",
    keywords: ["RP", "motor control", null],
    votes: ["Ann Voter", "Cal Voter", "Dot Voter"],
  },
  {
    authors: "Sample, C; Invented, A",
    year: 2003,
    title: "A simulated look at resting asymmetries of no one",
    journal: "EXAMPLES LETTERS",
    doi: "10.1000/invented.2003.11",
    keywords: ["invented asymmetry", "made-up trait", "pretend rest"],
    votes: ["Ann Voter", "Ben Voter", "Cal Voter"],
  },
  {
    authors: "Sample, C; Invented, A",
    year: 2004,
    title: "A notional follow-up on resting asymmetries of nobody",
    journal: "EXAMPLES LETTERS",
    doi: "10.1000/invented.2004.12",
    keywords: ["made-up asymmetry", "made-up trait", "pretend rest"],
    votes: ["Ann Voter", "Ben Voter", "Dot Voter"],
  },
  {
    authors: "Specimen, D",
    year: 1992,
    title: "A hypothetical note that carries no identifier",
    journal: "EXAMPLES LETTERS",
    doi: null,
    keywords: ["Ex1, Cx2", "imaginary errors", null],
    votes: ["Ann Voter", "Ben Voter"],
  },
  {
    authors: "Mockup, E; Specimen, D",
    // A year that is no number is kept as it is written.
    year: "in press",
    title: "A supposed study that was ranked and never shortlisted",
    journal: "EXAMPLES LETTERS",
    doi: "10.1000/invented.2000.14",
    // The construct of an earlier row, with a capital: one term with two spellings.
    keywords: ["FRN", "Pretend processing", null],
    votes: ["Cal Voter", "Dot Voter"],
  },
];

/** The questionnaire cell of the first candidate of the subproject, which the hidden planning list repeats. */
export const SUBPROJECT_QUESTIONNAIRE = "Invented Activation Scale (Nobody & Noone, 1994)";

const SUBPROJECT: readonly ShortlistFixture[] = [
  {
    citation: {
      text: "Sample, C., & Invented, A. (2003). A simulated look at resting asymmetries of no one. Examples Letters, 2, 3–4. https://doi.org/10.1000/invented.2003.11",
      hyperlink: doiAddress("10.1000/invented.2003.11"),
    },
    extractor: "Moe Checker",
    reviewer: null,
    stage: "",
    extraction: {
      effect: "An invented asymmetry that goes with approach motivation",
      plain: "A resting pattern goes with a trait",
      originalN: 26,
      statistics: "r(31) = .44, p < .02",
      effectSize: "r = .48",
      bayesFactor: "BF = 1.84",
      duration: "8 minutes of rest",
      sample: "all right-handed adults",
      channels: "2: P4-P3",
      equipment: "no",
      powerN: "n = 132 for .90 power, one-tailed test, .25 effect size",
      questionnaires: SUBPROJECT_QUESTIONNAIRE,
      studyType: "3_Correlational (resting state, separate subproject)",
      outcome: "invented asymmetry",
      construct: "made-up trait",
      descriptors: "pretend rest",
    },
    leftovers: ["Ann Voter", "Ben Voter", "Cal Voter"],
  },
  {
    // The citation carries no DOI, and the ranked list holds one for the paper.
    citation:
      "Sample, C., & Invented, A. (2004). A notional follow-up on resting asymmetries of nobody. Examples Letters, 3, 5–6.",
    extractor: "Moe Checker",
    reviewer: null,
    stage: "",
    extraction: { studyType: "3_Correlational\n\nExcluded: longitudinal study" },
  },
  {
    // Neither a DOI nor a title of the ranked list places this paper.
    citation: "Dummy, F. (1995). A conjectural paper that nobody ranked. Examples Letters, 4, 7–8.",
    extractor: "Lin Extractor",
    reviewer: null,
    stage: "",
    extraction: { studyType: "3_Correlational\n\nExcluded: longitudinal study" },
  },
];

function fill(sheet: ExcelJS.Worksheet, row: number, column: number, value: StudyFixture["citation"]): void {
  if (value === null) return;
  sheet.getCell(row, column).value = value as ExcelJS.CellValue;
}

function groupHeaders(sheet: ExcelJS.Worksheet, firstColumn: number): void {
  for (let index = 0; index < GROUP_COUNT; index += 1) fill(sheet, 2, firstColumn + index, `Group${index + 1}`);
}

function hideColumns(sheet: ExcelJS.Worksheet, from: number, to: number): void {
  for (let column = from; column <= to; column += 1) sheet.getColumn(column).hidden = true;
}

/** The extraction columns of a shortlist-style row, from a first column on. */
function extractionCells(
  sheet: ExcelJS.Worksheet,
  row: number,
  firstColumn: number,
  fields: readonly ExtractionField[],
  extraction: Extraction,
): void {
  fields.forEach((field, index) => {
    fill(sheet, row, firstColumn + index, extraction[field] ?? null);
  });
}

const SHARED_FIELDS = EXTRACTION_ORDER.filter((field) => field !== "convertedR");

export interface ListOfStudiesOptions {
  readonly studies?: readonly StudyFixture[];
  /** Changes the finished workbook before it is written, for a test of one awkward case. */
  readonly change?: (workbook: ExcelJS.Workbook) => void;
}

/** Builds the synthetic list of studies: six tabs, two of them hidden, in the layout of the real workbook. */
export async function listOfStudiesWorkbook(options: ListOfStudiesOptions = {}): Promise<Uint8Array> {
  const studies = options.studies ?? STUDIES;
  const workbook = new ExcelJS.Workbook();

  // `list of studies`: banners in arbitrary cells of row 1, headers in row 2, and two headers in row 1 only.
  const list = workbook.addWorksheet("list of studies");
  fill(list, 1, 7, "An invented banner of the extraction");
  fill(list, 1, 21, "INVENTED KEYWORD BANNER");
  fill(list, 1, 23, "Progress stage\n");
  fill(list, 1, 24, "Link to the sign-up form");
  fill(list, 1, 25, GROUP_BANNER);
  ["StudyID", "Lead Replicating Lab", "Study", "Abstract"].forEach((header, index) => {
    fill(list, 2, index + 1, header);
  });
  EXTRACTION_ORDER.forEach((field, index) => {
    fill(list, 2, 5 + index, HEADERS[field]);
  });
  groupHeaders(list, 25);
  studies.forEach((study, index) => {
    const row = index + 3;
    fill(list, row, 1, study.studyId);
    fill(list, row, 2, study.lead);
    fill(list, row, 3, study.citation);
    fill(list, row, 4, study.abstract);
    extractionCells(list, row, 5, EXTRACTION_ORDER, study.extraction);
    fill(list, row, 23, study.stage);
    fill(list, row, 24, study.signup);
    (study.leftovers ?? []).forEach((name, position) => {
      fill(list, row, 25 + 17 + position, name);
    });
    // The validated list covers every row except those whose stage is outside it. A long list is
    // written as two quoted texts joined by an ampersand, split in the middle of an option.
    if (STAGE_LIST.some((stage) => stage === study.stage)) {
      const options = STAGE_LIST.join(",");
      const cut = options.indexOf("(stage 6)");
      list.getCell(row, 23).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${options.slice(0, cut)}"&"${options.slice(cut)}"`],
      };
    }
  });
  hideColumns(list, 20, 22);
  hideColumns(list, 25, 48);

  // `shortlist_archived`: the citation has no header, and six headers exist in row 1 only.
  const shortlist = workbook.addWorksheet("shortlist_archived");
  fill(shortlist, 1, 2, "Abstract");
  fill(shortlist, 1, 3, "Data extractor");
  fill(shortlist, 1, 4, "Coding reviewer\n");
  fill(shortlist, 1, 5, "Progress stage\n");
  fill(shortlist, 1, 8, "An invented banner of the extraction");
  fill(shortlist, 1, 21, "INVENTED KEYWORD BANNER");
  fill(shortlist, 1, 23, "Lead Replicating Lab");
  fill(shortlist, 1, 24, "Link to the sign-up form");
  fill(shortlist, 1, 25, GROUP_BANNER);
  SHARED_FIELDS.forEach((field, index) => {
    fill(shortlist, 2, 6 + index, HEADERS[field]);
  });
  // The shared columns end at V, one column short of the lead, so that the keyword columns stand at T, U and V.
  groupHeaders(shortlist, 25);
  SHORTLIST.forEach((entry, index) => {
    const row = index + 3;
    fill(shortlist, row, 1, entry.citation);
    fill(shortlist, row, 2, "An invented abstract of the shortlist.");
    fill(shortlist, row, 3, entry.extractor);
    fill(shortlist, row, 4, entry.reviewer);
    fill(shortlist, row, 5, entry.stage);
    extractionCells(shortlist, row, 6, SHARED_FIELDS, entry.extraction);
    fill(shortlist, row, 23, entry.lead ?? null);
    fill(shortlist, row, 24, entry.signup ?? null);
    (entry.leftovers ?? []).forEach((name, position) => {
      fill(shortlist, row, 25 + 17 + position, name);
    });
  });
  hideColumns(shortlist, 20, 22);
  hideColumns(shortlist, 37, 48);

  // `allranked_archived`: `Votes count` is headed in row 1 only, and each count is a formula.
  const ranked = workbook.addWorksheet("allranked_archived");
  fill(ranked, 1, 8, "INVENTED KEYWORD BANNER");
  fill(ranked, 1, 10, "Votes count");
  fill(ranked, 1, 16, VOTE_BANNER);
  [
    "Authors",
    "Year",
    "Title",
    "Journal",
    "Abstract",
    "DOI",
    HEADERS.outcome,
    HEADERS.construct,
    HEADERS.descriptors,
  ].forEach((header, index) => {
    fill(ranked, 2, index + 1, header);
  });
  groupHeaders(ranked, 11);
  RANKED.forEach((entry, index) => {
    const row = index + 3;
    [
      entry.authors,
      entry.year,
      entry.title,
      entry.journal,
      "An invented abstract of the ranked list.",
      entry.doi,
    ].forEach((value, column) => {
      fill(ranked, row, column + 1, value);
    });
    entry.keywords.forEach((value, column) => {
      fill(ranked, row, 7 + column, value);
    });
    ranked.getCell(row, 10).value = {
      formula: `SUMPRODUCT((TRIM(K${row}:AH${row})<>"")*1)`,
      result: entry.staleCount ?? entry.votes.length,
    };
    entry.votes.forEach((name, position) => {
      fill(ranked, row, 11 + position, name);
    });
  });

  // `questionnaires`, hidden: a banner in row 1 and the headers in row 2.
  const questionnaires = workbook.addWorksheet("questionnaires", { state: "hidden" });
  fill(questionnaires, 1, 1, "An invented banner of the hidden planning list");
  ["Name ", "Duration, min", "In which study from the list it was used"].forEach((header, index) => {
    fill(questionnaires, 2, index + 1, header);
  });
  const planned: readonly (readonly [Value, Value, Value])[] = [
    [QUESTIONNAIRE_TEXT, null, citationOf("2001", "10.1000/invented.2001.01")],
    [SUBPROJECT_QUESTIONNAIRE, null, "Sample, C., & Invented, A. (2003). https://doi.org/10.1000/invented.2003.11"],
    // A third place that cites the paper of `AlphaGamma2002`, with the year of the shortlist.
    ["An invented mood scale", null, citationOf("2001", "10.1000/INVENTED(2002)02")],
    ["An invented trait scale", 5, "proposed by Nia Suggester"],
  ];
  planned.forEach((cells, index) => {
    cells.forEach((value, column) => {
      fill(questionnaires, index + 3, column + 1, value);
    });
  });

  // `AlphaAsymmetry_RSSubproject`: A1 holds one space, and the group columns have no banner.
  const subproject = workbook.addWorksheet("AlphaAsymmetry_RSSubproject");
  fill(subproject, 1, 1, " ");
  fill(subproject, 1, 2, "Abstract");
  fill(subproject, 1, 3, "Data extractor");
  fill(subproject, 1, 6, "An invented banner of the extraction");
  fill(subproject, 1, 19, "INVENTED KEYWORD BANNER");
  SHARED_FIELDS.forEach((field, index) => {
    fill(subproject, 2, 4 + index, HEADERS[field]);
  });
  groupHeaders(subproject, 21);
  SUBPROJECT.forEach((entry, index) => {
    const row = index + 3;
    fill(subproject, row, 1, entry.citation);
    fill(subproject, row, 2, "An invented abstract of the subproject.");
    fill(subproject, row, 3, entry.extractor);
    extractionCells(subproject, row, 4, SHARED_FIELDS, entry.extraction);
    (entry.leftovers ?? []).forEach((name, position) => {
      fill(subproject, row, 21 + position, name);
    });
  });

  // `Sheet5`, hidden: one column without a header.
  const scratch = workbook.addWorksheet("Sheet5", { state: "hidden" });
  fill(scratch, 1, 1, {
    text: "Invented et al. (2001). An invented study. ",
    hyperlink: doiAddress("10.1000/invented.2001.01"),
  });
  fill(scratch, 2, 1, "Invented et al. (1999). Another invented study. ");
  fill(scratch, 3, 1, "Invented et al. (1998). An imaginary inquiry.");

  options.change?.(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
