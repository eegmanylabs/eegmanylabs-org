// The generator of the public website's data files (requirement R14.2, docs/INTEGRATIONS.md,
// section 6). It takes the files as they stand on the website's main branch and the public
// projections of the portal's records, and writes the files that a publication would commit.
//
// The four files that the site's build reads today keep their columns, their order of rows,
// their line endings and every cell that the portal does not hold: a row changes only in the
// columns listed below, and only where the portal states a value, because an unknown value is
// never written over a known one. Three candidate files are new. The site's build refuses a file
// in `data/` that has no archetype, which the staging build showed, so they are published as
// static files under `assets/data/`, where the build copies them unchanged and the public can
// download them; a maintainer adds pages that show them through the ordinary route.
//
// | File                     | Key          | Rows                                                     | Columns the portal writes |
// |--------------------------|--------------|----------------------------------------------------------|---------------------------|
// | `data/replications.tsv`  | `StudyId`    | Every replication, in ascending order of the key         | `Theme`, `LongStageText`, `StageNumber`, `StageName`, `PsychConstruct`, `SignupUrl`, `SignUpActive` |
// | `data/publications.tsv`  | `PublicationId` | Manuscripts that carry a website identifier           | `ReplicationId`, `Status`, `StatusText`, `Journal`, `AuthorsShort`, `PublicationYear`, `DatePublishedNumber`, `OSF`, `DOI`, `Title` |
// | `data/people.tsv`        | `PersonId`   | People listed as core team                               | `FullName`, `HeadShotFilename`, `Affiliation`, `Country`, `ScholarUrl`, `UniUrl`, `LabUrl` |
// | `data/members.tsv`       | `PersonId`   | People listed as members and not in the core team file   | `FullName`, `Affiliation`, `Country` |
// | `assets/data/laboratories.tsv`| `LaboratoryId` | Active laboratories                                    | All: new file |
// | `assets/data/milestones.tsv`  | `StudyId` and `Milestone` | Stage 1 acceptances and publications       | All: new file |
// | `assets/data/recruitment.tsv` | `StudyId`, `Basis` and `Modality` | Aggregate recruitment of each replication, from at least two participations | All: new file |
//
// A row of `people.tsv` or `members.tsv` whose person the portal knows and no longer lists is
// removed, so that a member who withdraws from the public listing leaves the website. A row the
// portal does not know is kept as it is. Replications and publications are never removed by the
// generator: that is a maintainer's decision.
import type {
  PublicLaboratory,
  PublicManuscript,
  PublicParticipation,
  PublicPerson,
  PublicReplication,
  PublicSummary,
} from "./allow-list";
import { websiteStageOf } from "./stages";
import { cellOf, columnIndex, parseTsv, serialiseTsv, type TsvLine, type TsvTable, tsvCell } from "./tsv";

export const WEBSITE_FILES = {
  replications: { path: "data/replications.tsv", key: "StudyId", existing: true },
  publications: { path: "data/publications.tsv", key: "PublicationId", existing: true },
  people: { path: "data/people.tsv", key: "PersonId", existing: true },
  members: { path: "data/members.tsv", key: "PersonId", existing: true },
  laboratories: { path: "assets/data/laboratories.tsv", key: "LaboratoryId", existing: false },
  milestones: { path: "assets/data/milestones.tsv", key: "StudyId|Milestone|PublicationId", existing: false },
  recruitment: { path: "assets/data/recruitment.tsv", key: "StudyId|Basis|Modality", existing: false },
} as const;
export type WebsiteFileKey = keyof typeof WEBSITE_FILES;
export const WEBSITE_FILE_KEYS = Object.keys(WEBSITE_FILES) as readonly WebsiteFileKey[];

/**
 * The candidate outputs of requirement R14.2, each the files it writes.
 *
 * | Output         | Files                                 |
 * |----------------|---------------------------------------|
 * | `members`      | `people.tsv` and `members.tsv`        |
 * | `laboratories` | `assets/data/laboratories.tsv`                    |
 * | `replications` | `replications.tsv`                    |
 * | `publications` | `publications.tsv`                    |
 * | `milestones`   | `assets/data/milestones.tsv`                      |
 * | `recruitment`  | `assets/data/recruitment.tsv`                     |
 */
export const PUBLIC_OUTPUTS = {
  members: ["people", "members"],
  laboratories: ["laboratories"],
  replications: ["replications"],
  publications: ["publications"],
  milestones: ["milestones"],
  recruitment: ["recruitment"],
} as const satisfies Record<string, readonly WebsiteFileKey[]>;
export type PublicOutput = keyof typeof PUBLIC_OUTPUTS;
export const PUBLIC_OUTPUT_KEYS = Object.keys(PUBLIC_OUTPUTS) as readonly PublicOutput[];

const NEW_FILE_HEADERS = {
  laboratories: ["LaboratoryId", "Name", "Department", "City", "Country", "Website", "StudyIds"],
  milestones: ["StudyId", "Milestone", "Date", "PublicationId"],
  recruitment: ["StudyId", "Basis", "Modality", "Tested", "Usable", "ParticipationsReporting", "AsOfDate"],
} as const;

export interface PublicInputs {
  readonly persons: readonly PublicPerson[];
  readonly replications: readonly PublicReplication[];
  readonly laboratories: readonly PublicLaboratory[];
  readonly participations: readonly PublicParticipation[];
  readonly manuscripts: readonly PublicManuscript[];
  readonly summaries: readonly PublicSummary[];
}

export interface GenerateOptions {
  readonly outputs: readonly PublicOutput[];
  /**
   * The origins a published record may have. `projected` is never published, whatever this says,
   * and `demo` only where a batch is made from synthetic data in the emulator.
   */
  readonly origins: readonly ("live" | "importedHistorical" | "demo")[];
}

export interface GeneratedFiles {
  /** The path of each file the batch writes, to its full new content. */
  readonly files: Readonly<Partial<Record<WebsiteFileKey, string>>>;
  /** What the generator left out and why, as sentences that name records and never a value. */
  readonly notes: readonly string[];
}

type Origin = PublicPerson["dataOrigin"];

/** Whether a record may be published at all: not archived, and of an allowed origin. */
function publishable(record: { readonly archived: boolean; readonly dataOrigin: Origin }, options: GenerateOptions) {
  if (record.archived) return false;
  if (record.dataOrigin === "projected") return false;
  return record.dataOrigin === null || (options.origins as readonly string[]).includes(record.dataOrigin);
}

/** The identifier of a person on the website: the one it already has, or the portal's slug. */
export function websitePersonIdOf(person: PublicPerson): string {
  return person.websitePersonId ?? person.slug ?? person.id;
}

/** A table whose cells of named columns change where `values` states them. */
function withValues(table: TsvTable, line: TsvLine, values: Readonly<Record<string, string | undefined>>): TsvLine {
  const cells = [...line.cells];
  while (cells.length < table.header.length) cells.push("");
  for (const [column, value] of Object.entries(values)) {
    const index = columnIndex(table, column);
    if (index < 0 || value === undefined) continue;
    cells[index] = tsvCell(value);
  }
  return { ...line, cells };
}

function newLine(table: TsvTable, values: Readonly<Record<string, string | undefined>>): TsvLine {
  return withValues(table, { cells: table.header.map(() => ""), ending: null }, values);
}

function emptyTable(header: readonly string[]): TsvTable {
  return { header, headerEnding: "\n", lines: [], usualEnding: "\n", finalEnding: "\n" };
}

function keyOf(table: TsvTable, line: TsvLine, column: string): string {
  return cellOf(table, line, column);
}

function personValues(person: PublicPerson, core: boolean): Record<string, string | undefined> {
  return {
    FullName: person.displayName,
    Affiliation: person.affiliationSummary,
    Country: person.countrySource,
    ...(core
      ? {
          HeadShotFilename: person.headshotFilename,
          ScholarUrl: person.scholarUrl,
          UniUrl: person.universityUrl,
          LabUrl: person.labUrl,
        }
      : {}),
  };
}

/** The people of the core team file and of the members file. */
function generatePeople(
  baseTexts: { readonly people: string; readonly members: string },
  persons: readonly PublicPerson[],
  options: GenerateOptions,
  notes: string[],
): { people: string; members: string } {
  const byWebsiteId = new Map(persons.map((person) => [websitePersonIdOf(person), person]));
  const listed = (person: PublicPerson, listing: "member" | "coreTeam") =>
    publishable(person, options) && person.publicListing === listing;

  const people = parseTsv(baseTexts.people);
  const coreIds = new Set<string>();
  const peopleLines: TsvLine[] = [];
  for (const line of people.lines) {
    const id = keyOf(people, line, "PersonId");
    const person = byWebsiteId.get(id);
    if (person === undefined) {
      peopleLines.push(line);
      if (id !== "") coreIds.add(id);
      continue;
    }
    if (!listed(person, "coreTeam")) {
      notes.push(`Person ${id} is no longer listed as core team, so their row of the core team file is removed.`);
      continue;
    }
    coreIds.add(id);
    peopleLines.push(withValues(people, line, personValues(person, true)));
  }
  for (const person of persons) {
    const id = websitePersonIdOf(person);
    if (coreIds.has(id) || !listed(person, "coreTeam")) continue;
    coreIds.add(id);
    peopleLines.push(newLine(people, { PersonId: id, ...personValues(person, true) }));
  }

  const members = parseTsv(baseTexts.members);
  const memberIds = new Set<string>();
  const memberLines: TsvLine[] = [];
  let sequence = 0;
  for (const line of members.lines) {
    const number = Number.parseInt(cellOf(members, line, "SequenceNumber"), 10);
    if (Number.isFinite(number)) sequence = Math.max(sequence, number);
  }
  for (const line of members.lines) {
    const id = keyOf(members, line, "PersonId");
    const person = byWebsiteId.get(id);
    if (person === undefined) {
      memberLines.push(line);
      memberIds.add(id);
      continue;
    }
    // The README asks that a member who is also in the core team file is left out of this one.
    if (!listed(person, "member") || coreIds.has(id)) {
      notes.push(
        coreIds.has(id)
          ? `Person ${id} is in the core team file, so their row of the members file is removed.`
          : `Person ${id} is no longer listed as a member, so their row of the members file is removed.`,
      );
      continue;
    }
    memberIds.add(id);
    memberLines.push(withValues(members, line, personValues(person, false)));
  }
  for (const person of persons) {
    const id = websitePersonIdOf(person);
    if (memberIds.has(id) || coreIds.has(id) || !listed(person, "member")) continue;
    memberIds.add(id);
    sequence += 1;
    memberLines.push(
      newLine(members, { SequenceNumber: String(sequence), PersonId: id, ...personValues(person, false) }),
    );
  }
  return {
    people: serialiseTsv({ ...people, lines: peopleLines }),
    members: serialiseTsv({ ...members, lines: memberLines }),
  };
}

/**
 * The cells of a replication's row. The stage is written from the website's own vocabulary: the
 * number and the long text that belong to the key, the text the portal states where it has one.
 * A key the website does not know leaves the three stage cells as they are and is noted, so a
 * card never gets a class that no filter matches or an empty tag.
 */
function replicationValues(replication: PublicReplication, notes: string[]): Record<string, string | undefined> {
  const signupOpen = replication.signupActive;
  const stage = websiteStageOf(replication.publicStageName);
  if (replication.publicStageName !== undefined && stage === null) {
    notes.push(
      `Replication ${replication.studyKey ?? replication.id} has a public stage that the website does not know, so its stage is left as it is.`,
    );
  }
  return {
    Theme: replication.theme,
    PsychConstruct: replication.psychConstruct,
    LongStageText: stage === null ? undefined : (replication.publicStageText ?? stage.longText),
    StageNumber: stage === null ? undefined : String(stage.number),
    StageName: stage?.key,
    // The site's build reads the literal `done` where sign-up has closed.
    SignupUrl: signupOpen === undefined ? undefined : signupOpen ? replication.signupUrl : "done",
    SignUpActive: signupOpen === undefined ? undefined : signupOpen ? "1" : "0",
  };
}

function generateReplications(
  base: string,
  replications: readonly PublicReplication[],
  options: GenerateOptions,
  notes: string[],
) {
  const table = parseTsv(base);
  const known = new Map(
    replications.filter((replication) => publishable(replication, options)).map((r) => [r.studyKey ?? r.id, r]),
  );
  const seen = new Set<string>();
  const lines = table.lines.map((line) => {
    const id = keyOf(table, line, "StudyId");
    seen.add(id);
    const replication = known.get(id);
    return replication === undefined ? line : withValues(table, line, replicationValues(replication, notes));
  });
  // A card without a stage the website knows would match no filter and show no stage, so a
  // replication is added only once it has one.
  const added = [...known.entries()]
    .filter(([id, replication]) => {
      if (seen.has(id)) return false;
      if (websiteStageOf(replication.publicStageName) !== null) return true;
      notes.push(`Replication ${id} has no stage that the website knows, so it is not added to the website yet.`);
      return false;
    })
    .map(([id, replication]) => newLine(table, { StudyId: id, ...replicationValues(replication, notes) }));
  // The file is in ascending order of its key, so an added study takes its place in that order.
  const merged = added.length === 0 ? lines : [...lines, ...added].sort((a, b) => compareKeys(table, a, b, "StudyId"));
  return serialiseTsv({ ...table, lines: merged });
}

function compareKeys(table: TsvTable, a: TsvLine, b: TsvLine, column: string): number {
  const left = cellOf(table, a, column);
  const right = cellOf(table, b, column);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The two status cells of a publication for the kind and status of a manuscript: the inverse of
 * the table that the importer of the website reads them with. A pair that is not listed leaves
 * the cells as they are.
 */
function statusCells(manuscript: PublicManuscript): { Status?: string; StatusText?: string } {
  if (manuscript.kind === "stage1Rr" && manuscript.status === "inPrincipleAcceptance") {
    return { Status: "stage1", StatusText: "Stage 1 accepted" };
  }
  if (manuscript.kind === "stage1Rr" && manuscript.status === "underReview") {
    return { Status: "stage1", StatusText: "Stage 1 under review" };
  }
  if (manuscript.kind === "article" && manuscript.status === "published") {
    return { Status: "published", StatusText: "published" };
  }
  if (manuscript.kind === "preprint" && manuscript.status === "published") {
    return { Status: "preprint", StatusText: "preprint" };
  }
  return {};
}

function publicationValues(manuscript: PublicManuscript): Record<string, string | undefined> {
  const day = manuscript.publishedAt;
  return {
    ReplicationId: manuscript.replicationId,
    ...statusCells(manuscript),
    Journal: manuscript.journal,
    AuthorsShort: manuscript.authorsShort,
    PublicationYear: day?.slice(0, 4),
    DatePublishedNumber: day?.replaceAll("-", ""),
    OSF: manuscript.osfUrl,
    DOI: manuscript.doi,
    Title: manuscript.title,
  };
}

function generatePublications(base: string, manuscripts: readonly PublicManuscript[], options: GenerateOptions) {
  const table = parseTsv(base);
  const known = new Map(
    manuscripts
      .filter((manuscript) => publishable(manuscript, options) && manuscript.websitePublicationId !== undefined)
      .map((manuscript) => [manuscript.websitePublicationId ?? manuscript.id, manuscript]),
  );
  const seen = new Set<string>();
  const lines = table.lines.map((line) => {
    const id = keyOf(table, line, "PublicationId");
    seen.add(id);
    const manuscript = known.get(id);
    return manuscript === undefined ? line : withValues(table, line, publicationValues(manuscript));
  });
  for (const [id, manuscript] of known) {
    if (!seen.has(id)) lines.push(newLine(table, { PublicationId: id, ...publicationValues(manuscript) }));
  }
  return serialiseTsv({ ...table, lines });
}

function generateLaboratories(inputs: PublicInputs, options: GenerateOptions): string {
  const table = emptyTable(NEW_FILE_HEADERS.laboratories);
  const studies = new Map<string, Set<string>>();
  for (const participation of inputs.participations) {
    if (!publishable(participation, options) || participation.status === "withdrawn") continue;
    if (participation.laboratoryId === undefined || participation.replicationId === undefined) continue;
    const set = studies.get(participation.laboratoryId) ?? new Set<string>();
    set.add(participation.replicationId);
    studies.set(participation.laboratoryId, set);
  }
  const lines = inputs.laboratories
    .filter((laboratory) => publishable(laboratory, options) && laboratory.status === "active")
    .map((laboratory) =>
      newLine(table, {
        LaboratoryId: laboratory.slug ?? laboratory.id,
        Name: laboratory.name,
        Department: laboratory.department,
        City: laboratory.city,
        Country: laboratory.countryCode,
        Website: laboratory.website,
        StudyIds: [...(studies.get(laboratory.id) ?? [])].sort().join(";"),
      }),
    )
    .sort((a, b) => compareKeys(table, a, b, "LaboratoryId"));
  return serialiseTsv({ ...table, lines });
}

/** The statuses of a Stage 1 report that has been accepted, in principle or in full. */
const STAGE1_ACCEPTED_STATUSES: ReadonlySet<PublicManuscript["status"]> = new Set([
  "inPrincipleAcceptance",
  "accepted",
  "published",
]);

function generateMilestones(inputs: PublicInputs, options: GenerateOptions): string {
  const table = emptyTable(NEW_FILE_HEADERS.milestones);
  const lines: TsvLine[] = [];
  for (const manuscript of inputs.manuscripts) {
    if (!publishable(manuscript, options) || manuscript.replicationId === undefined) continue;
    const publicationId = manuscript.websitePublicationId ?? "";
    // A date alone announces nothing: the status, which only the event that records it moves,
    // must say that the report was accepted.
    if (
      manuscript.kind === "stage1Rr" &&
      STAGE1_ACCEPTED_STATUSES.has(manuscript.status) &&
      manuscript.acceptedAt !== undefined
    ) {
      lines.push(
        newLine(table, {
          StudyId: manuscript.replicationId,
          Milestone: "stage1Accepted",
          Date: manuscript.acceptedAt,
          PublicationId: publicationId,
        }),
      );
    }
    if (manuscript.status === "published" && manuscript.publishedAt !== undefined) {
      lines.push(
        newLine(table, {
          StudyId: manuscript.replicationId,
          Milestone: manuscript.kind === "preprint" ? "preprintPublished" : "published",
          Date: manuscript.publishedAt,
          PublicationId: publicationId,
        }),
      );
    }
  }
  lines.sort(
    (a, b) =>
      compareKeys(table, a, b, "Date") || compareKeys(table, a, b, "StudyId") || compareKeys(table, a, b, "Milestone"),
  );
  return serialiseTsv({ ...table, lines });
}

const RECRUITMENT_BASES = ["centrallyVerified", "labReported"] as const;
const RECRUITMENT_MODALITIES = ["main", "rest", "participants"] as const;

/**
 * The fewest participations whose reports a public figure may rest on. A figure of one
 * participation is that laboratory's own report, which the portal scopes to the laboratory and
 * the leads, so it is not published as the replication's aggregate.
 */
export const PUBLIC_RECRUITMENT_MIN_PARTICIPATIONS = 2;

function generateRecruitment(inputs: PublicInputs, options: GenerateOptions, notes: string[]): string {
  const table = emptyTable(NEW_FILE_HEADERS.recruitment);
  const lines: TsvLine[] = [];
  const summaries = [...inputs.summaries]
    .filter((summary) => publishable(summary, options) && summary.replicationId !== undefined)
    .sort((a, b) => ((a.replicationId ?? "") < (b.replicationId ?? "") ? -1 : 1));
  const withheld = new Set<string>();
  for (const summary of summaries) {
    for (const basis of RECRUITMENT_BASES) {
      for (const modality of RECRUITMENT_MODALITIES) {
        const counts = summary.totals?.[basis]?.[modality];
        const reporting = summary.reporting?.[basis]?.[modality];
        // An unknown count stays empty and is never written as zero, and a modality that no
        // participation states has no row at all.
        if (counts?.tested === undefined && counts?.usable === undefined) continue;
        const stating = Math.max(reporting?.tested ?? 0, reporting?.usable ?? 0);
        if (stating < PUBLIC_RECRUITMENT_MIN_PARTICIPATIONS) {
          withheld.add(summary.replicationId ?? "");
          continue;
        }
        lines.push(
          newLine(table, {
            StudyId: summary.replicationId,
            Basis: basis,
            Modality: modality,
            Tested: counts.tested === undefined ? "" : String(counts.tested),
            Usable: counts.usable === undefined ? "" : String(counts.usable),
            ParticipationsReporting: String(stating),
            AsOfDate: summary.latestAsOfDate ?? "",
          }),
        );
      }
    }
  }
  for (const studyId of withheld) {
    notes.push(
      `Some recruitment figures of ${studyId} rest on the reports of fewer than ${PUBLIC_RECRUITMENT_MIN_PARTICIPATIONS} participations, so they are left out of the recruitment file.`,
    );
  }
  return serialiseTsv({ ...table, lines });
}

/**
 * Writes the files of the outputs asked for. `base` holds the current text of each existing
 * file; a file that does not exist yet is generated whole.
 */
export function generateWebsiteFiles(
  base: Readonly<Partial<Record<WebsiteFileKey, string>>>,
  inputs: PublicInputs,
  options: GenerateOptions,
): GeneratedFiles {
  const notes: string[] = [];
  const files: Partial<Record<WebsiteFileKey, string>> = {};
  const outputs = new Set(options.outputs);
  const required = (key: WebsiteFileKey): string => {
    const text = base[key];
    if (text === undefined) throw new RangeError(`The current ${WEBSITE_FILES[key].path} is needed.`);
    return text;
  };
  if (outputs.has("members")) {
    const generated = generatePeople(
      { people: required("people"), members: required("members") },
      inputs.persons,
      options,
      notes,
    );
    files.people = generated.people;
    files.members = generated.members;
  }
  if (outputs.has("replications"))
    files.replications = generateReplications(required("replications"), inputs.replications, options, notes);
  if (outputs.has("publications"))
    files.publications = generatePublications(required("publications"), inputs.manuscripts, options);
  if (outputs.has("laboratories")) files.laboratories = generateLaboratories(inputs, options);
  if (outputs.has("milestones")) files.milestones = generateMilestones(inputs, options);
  if (outputs.has("recruitment")) files.recruitment = generateRecruitment(inputs, options, notes);
  return { files, notes };
}
