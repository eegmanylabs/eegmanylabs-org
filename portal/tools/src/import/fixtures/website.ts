// SYNTHETIC test fixture. Every study, person, institution, publication and address below is
// invented, and nothing is copied from the real website data. Only the column headers are the
// real ones, because they are the public structure of the four files. The fixture reproduces
// the awkward cases of the real files:
//
// | Awkward case                                                        | Where                              |
// |---------------------------------------------------------------------|------------------------------------|
// | Mixed line endings, and a file without a final newline              | `people.tsv`, `replications.tsv`   |
// | The literal `done` in the sign-up column, and a form-editor address | `AlphaBeta2001`, `EtaTheta2005`    |
// | A year with a letter suffix, and a DOI with capitals and parentheses | `AlphaGamma2002`                  |
// | A second lead whom only the people file names                       | `Delta1999`                        |
// | A study and a publication linked in one direction only, and a link to a publication that has no row | `AlphaGamma2002`, `Delta1999` |
// | A blank where the other role flags use `0`                          | `DirectorRole`                     |
// | A country spelling that the alias table maps, and case variants of one journal | `USA`, `ExampleArXiv`   |
// | Two entries that may be one person, in the two people files         | `hnobody`, `fnotreal`              |
// | An affiliation whose last part is an unknown country spelling, or no country | `kit-q-specimen`, `lu-mockup` |
// | A publication whose years disagree, and one spelled unlike its own authors | `Kept2025`, `Madeup2021`    |
// | A file without a record, and a committed page of a record           | `Orphan2020.pdf`, `zformer.jpg`, `aexample.md` |
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type FixtureRow = Record<string, string>;

export interface WebsiteFixture {
  replications: FixtureRow[];
  publications: FixtureRow[];
  people: FixtureRow[];
  members: FixtureRow[];
  /** The files of the repository that the website keys by a record identifier, relative to its root. */
  files: string[];
}

export const WEBSITE_HEADERS = {
  replications: [
    "StudyId",
    "PublicationId",
    "LeadFullName",
    "Theme",
    "LongStageText",
    "StageNumber",
    "StageName",
    "PersonId",
    "Authors",
    "PublicationYear",
    "Title",
    "Reference",
    "Doi",
    "PsychConstruct",
    "SignupUrl",
    "SignUpActive",
    "allSignUpLinks",
  ],
  publications: [
    "PublicationId",
    "ReplicationId",
    "URLs",
    "Status",
    "StatusText",
    "Journal",
    "AuthorsShort",
    "PublicationYear",
    "DatePublishedNumber",
    "OSF",
    "DataUrl",
    "Data2Url",
    "Code",
    "DOI",
    "Title",
  ],
  people: [
    "PersonId",
    "FullName",
    "HeadShotFilename",
    "Affiliation",
    "Country",
    "StudyId",
    "SpinOffId",
    "LeadRole",
    "SpinOffRole",
    "CoordinatorRole",
    "AdvisorRole",
    "CoInvestigatorRole",
    "OtherRole",
    "DirectorRole",
    "ScholarUrl",
    "UniUrl",
    "LabUrl",
  ],
  members: ["SequenceNumber", "PersonId", "FullName", "Affiliation", "Country"],
} as const;

type FileStem = keyof typeof WEBSITE_HEADERS;

const rowsOf = (stem: FileStem, table: readonly (readonly string[])[]): FixtureRow[] =>
  table.map((cells) => Object.fromEntries(WEBSITE_HEADERS[stem].map((header, index) => [header, cells[index] ?? ""])));

const STAGES = {
  prep: ["Stage 1 Registered report in preparation", "4", "stage1_prep"],
  review: ["Stage 1 Registered report under review", "5", "stage1_review"],
  collecting: ["IPA acquired. Data collection ongoing", "6", "data_collection"],
  stage2: ["Data collected. Stage 2 RR in preparation", "7", "stage2_prep"],
  finished: ["Finished", "9", "finished"],
} as const;

const reference = (authors: string, year: string, doi: string) =>
  `${authors} (${year}). An invented study of nothing in particular. Journal of Examples, 1(1), 1–2. https://doi.org/${doi}`;

/** A fresh copy of the synthetic website data, which a test may change before writing it. */
export function websiteFixture(): WebsiteFixture {
  const replication = (
    studyId: string,
    publicationId: string,
    lead: readonly [name: string, personId: string],
    theme: string,
    stage: keyof typeof STAGES,
    year: string,
    doi: string,
    construct: string,
    signup: readonly [url: string, active: string, all: string],
  ) => [
    studyId,
    publicationId,
    lead[0],
    theme,
    ...STAGES[stage],
    lead[1],
    "Invented, & Authors",
    year,
    `An invented study called ${studyId}`,
    reference("Invented, A., & Authors, B.", year.slice(0, 4), doi),
    doi,
    construct,
    ...signup,
  ];
  const form = (name: string) => `https://forms.example.org/${name}`;
  const editor = "https://docs.google.com/forms/d/an-invented-form-identifier/edit";
  const core = (
    personId: string,
    name: string,
    affiliation: string,
    country: string,
    studyId: string,
    flags: readonly [lead: string, spinOff: string, coordinator: string, advisor: string, coInvestigator: string],
    other: string,
    director: string,
  ) => [
    personId,
    name,
    `${personId}.jpg`,
    affiliation,
    country,
    studyId,
    flags[1] === "1" ? "sideproject" : "",
    ...flags,
    other,
    director,
    `https://scholar.example.org/${personId}`,
    `https://university.example.org/staff/${personId}`,
    personId === "aexample" ? "http://lab.example.org/" : "",
  ];
  const publication = (
    id: string,
    studyId: string,
    status: readonly [status: string, text: string],
    journal: string,
    authors: string,
    year: string,
    date: string,
    extras: readonly [osf: string, data: string, data2: string, code: string] = ["", "", "", ""],
  ) => [
    id,
    studyId,
    `https://papers.example.org/${id.toLowerCase()}`,
    ...status,
    journal,
    authors,
    year,
    date,
    ...extras,
    `10.1000/invented.output.${id.toLowerCase()}`,
    `An invented report called ${id}`,
  ];
  return {
    replications: rowsOf("replications", [
      replication(
        "AlphaBeta2001",
        "Example2023",
        ["Ada Example", "aexample"],
        "Personality",
        "stage2",
        "2001",
        "10.1000/invented.2001.01",
        "conflict monitoring",
        ["done", "0", form("alphabeta")],
      ),
      replication(
        "AlphaGamma2002",
        "",
        ["Bo Fictional", "bfictional"],
        "Conflict",
        "collecting",
        "2002a",
        "10.1000/INVENTED(2002)02",
        "conflict monitoring",
        [form("alphagamma"), "1", form("alphagamma")],
      ),
      replication(
        "Delta1999",
        "Gone2022",
        ["Cy Invented", "cinvented"],
        "Attention",
        "prep",
        "1999",
        "10.1000/invented.1999.03",
        "visual perception, attention",
        [form("delta"), "1", form("delta")],
      ),
      replication(
        "EpsilonVanZeta2010",
        "",
        ["Eli Madeup", "emadeup"],
        "Memory",
        "prep",
        "2010",
        "10.1000/invented.2010.04",
        "working memory",
        [form("epsilon"), "1", form("epsilon")],
      ),
      replication(
        "EtaTheta2005",
        "Madeup2021",
        ["Fay Notreal", "fnotreal"],
        "Emotion",
        "finished",
        "2005",
        "10.1000/invented.2005.05",
        "emotions",
        ["done", "0", editor],
      ),
      replication(
        "Iota2004",
        "",
        ["Gus Pretend", "gpretend"],
        "Attention",
        "review",
        "2004",
        "10.1000/invented.2004.06",
        "attention",
        [form("iota"), "1", form("iota")],
      ),
    ]),
    publications: rowsOf("publications", [
      publication(
        "Example2023",
        "AlphaBeta2001",
        ["stage1", "Stage 1 accepted"],
        "ExampleArXiv",
        "Example et al",
        "2023",
        "20231201",
        [
          "https://osf.example.org/abcde/",
          "https://data.example.org/EEGManyLabs/EEGManyLabs_Replication_AlphaBeta2001_Raw",
          "https://data.example.org/EEGManyLabs/EEGManyLabs_Replication_AlphaBeta2001_Processed",
          "https://code.example.org/invented/analysis",
        ],
      ),
      publication(
        "Sample2024",
        "AlphaGamma2002",
        ["stage1", "Stage 1 under review"],
        "Examplearxiv",
        "Sample et al",
        "2024",
        "20240115",
      ),
      publication(
        "Kept2025",
        "Delta1999",
        ["published", "published"],
        "Journal of Examples",
        "Kept et al",
        "2025",
        "20240601",
      ),
      publication(
        "Madeup2021",
        "EtaTheta2005",
        ["published", "published"],
        "Journal of Examples",
        "Maedup et al",
        "2021",
        "20210309",
      ),
      publication("Programme2022", "", ["preprint", "preprint"], "ExampleArXiv", "Programme et al", "2022", "20220224"),
    ]),
    people: rowsOf("people", [
      core(
        "aexample",
        "Ada Example",
        "University of Nowhere",
        "Nowhereland",
        "AlphaBeta2001",
        ["1", "0", "1", "0", "0"],
        "founder",
        "1",
      ),
      core(
        "bfictional",
        "Bo Fictional",
        "Institute of Fiction",
        "USA",
        "AlphaGamma2002",
        ["1", "0", "0", "0", "0"],
        "",
        "",
      ),
      core(
        "cinvented",
        "Cy Invented",
        "Invented University & Example Hospital",
        "Nowhereland",
        "Delta1999",
        ["1", "0", "0", "0", "0"],
        "",
        "",
      ),
      core(
        "dimaginary",
        "Dee Imaginary",
        "Imaginary College",
        "United States",
        "Delta1999",
        ["1", "0", "0", "0", "1"],
        "",
        "",
      ),
      core(
        "emadeup",
        "Eli Madeup",
        "University of Nowhere",
        "Nowhereland",
        "EpsilonVanZeta2010",
        ["1", "0", "0", "0", "0"],
        "",
        "",
      ),
      core(
        "fnotreal",
        "Fay Notreal",
        "Notreal Institute",
        "Nowhereland",
        "EtaTheta2005",
        ["1", "0", "0", "1", "0"],
        "",
        "",
      ),
      core(
        "gpretend",
        "Gus Pretend",
        "Pretend Polytechnic",
        "Elsewhere",
        "Iota2004",
        ["1", "0", "0", "0", "0"],
        "",
        "",
      ),
      core(
        "hnobody",
        "Hal Nobody",
        "Imaginary College",
        "Nowhereland",
        "",
        ["0", "1", "0", "1", "0"],
        "contributor",
        "",
      ),
    ]),
    members: rowsOf("members", [
      [
        "1",
        "ida-sample",
        "Ida Sample",
        "Department of Samples, University of Nowhere, Nowhere City, Nowhereland",
        "Nowhereland",
      ],
      ["2", "jo-placeholder", "Jo Placeholder", "Institute of Fiction, Fictionville, USA", "United States"],
      ["3", "kit-q-specimen", "Kit Q. Specimen", "School of Specimens, Specimen University, EW", "Elsewhere"],
      ["4", "lu-mockup", "Lu Mockup", "Mockup Research Centre, Mockup Institute", "Elsewhere"],
      ["5", "hal-j-nobody", "Hal J. Nobody", "Imaginary College, Nowhereland", "Nowhereland"],
      ["6", "faye-notreal", "Faye Notreal", "Notreal Institute, Nowhereland", "Nowhereland"],
      [
        "7",
        "zoe-exemple",
        "Zoë Exemple",
        "Département d’Exemples, Université de Nulle Part, Nowhereland",
        "Nowhereland",
      ],
    ]),
    files: [
      "assets/pdfs/Example2023.pdf",
      "assets/pdfs/Orphan2020.pdf",
      "assets/images/previews/Example2023.pdf.png",
      "assets/images/headshots/aexample.jpg",
      "assets/images/headshots/bfictional.jpg",
      "assets/images/headshots/zformer.jpg",
      "content/people/index.md",
      "content/people/aexample.md",
    ],
  };
}

/** How each file ends its lines, as the real files do: one of them mixes two endings. */
const LINE_ENDINGS: Readonly<Record<FileStem, (line: number, last: boolean) => string>> = {
  replications: (_line, last) => (last ? "" : "\n"),
  publications: (_line, last) => (last ? "" : "\r\n"),
  people: (_line, last) => (last ? "\n" : "\r\n"),
  members: () => "\n",
};

/** The text of one file of the fixture. */
export function tsvOf(stem: FileStem, rows: readonly FixtureRow[]): string {
  const headers: readonly string[] = WEBSITE_HEADERS[stem];
  const lines = [headers.join("\t"), ...rows.map((row) => headers.map((header) => row[header] ?? "").join("\t"))];
  return lines.map((line, index) => line + LINE_ENDINGS[stem](index, index === lines.length - 1)).join("");
}

/**
 * Writes the fixture as a checkout of the website repository would hold it: the four files in
 * `data`, and the listed files beside it. Returns the `data` directory, which is the input of
 * the importer.
 */
export function writeWebsiteFixture(root: string, fixture: WebsiteFixture = websiteFixture()): string {
  const data = path.join(root, "data");
  mkdirSync(data, { recursive: true });
  for (const stem of Object.keys(WEBSITE_HEADERS) as FileStem[]) {
    writeFileSync(path.join(data, `${stem}.tsv`), tsvOf(stem, fixture[stem]));
  }
  for (const file of fixture.files) {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), "an invented file\n");
  }
  return data;
}
