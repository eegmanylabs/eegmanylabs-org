// Source H: the public website data (docs/MIGRATION_PLAN.md, section 4.1). Four TSV files in
// the `data` directory of this repository, from which the public website is built. Everything
// in them is public by origin. This importer is the baseline against which every later source
// is compared.
//
// | File               | Row key              | Feeds                                                             |
// |--------------------|----------------------|-------------------------------------------------------------------|
// | `replications.tsv` | Folded `StudyId`     | Replication, alias of scheme `website`, DOI lookup, lead membership, sign-up links, terms |
// | `publications.tsv` | Folded `PublicationId` | Manuscript, DOI lookup, links, aliases for repository names, terms |
// | `people.tsv`       | Website `PersonId`   | Person with identity key, role tags, affiliation, institution candidate, lead claims |
// | `members.tsv`      | Website `PersonId`   | Person with identity key, affiliation, institution candidate      |
//
// Where the `data` directory sits in a checkout of the repository, the importer also lists the
// files that the website keys by a record identifier (PDFs, previews, portraits and committed
// people pages), so that a file without a record reaches a reviewer.
//
// The importer chooses between no two values. A lead whom only the people file names, a link
// between a study and a publication that the two files state differently, and two entries that
// may be one person are all kept as they stand and queued for review.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  COLLECTIONS,
  doiSchema,
  type EntityRef,
  keySchema,
  LIMITS,
  lookupFold,
  PROGRAMME_KEY,
  PROGRAMME_SCOPE_KEY,
  replicationMembershipId,
  replicationScopeKey,
  shortHash,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { personEvidence } from "../identity";
import type {
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  InputFile,
  PlanContext,
  RecordedRow,
  SourceReading,
  SourceRow,
  SourceTab,
  StructureIssue,
} from "../model";
import { PlanBuilder } from "../plan";
import {
  affiliationDocuments,
  aliasDocuments,
  cellText,
  doiKey,
  doiLookupDocument,
  isEditorAddress,
  isStorableUrl,
  slotLinkDocument,
  VocabularyCollector,
} from "../records";
import { STUDY_ID_PATTERN } from "../studies";
import { readTsv, type TsvFile, TsvFormatError } from "../tsv";
import { contentRowKey, sha256OfBytes, wholeNumberOf } from "../values";

const SOURCE_KEY = "h";

interface FileSpec {
  readonly stem: "replications" | "publications" | "people" | "members";
  /** The exact header list. The first column is the key from which the public site is built. */
  readonly headers: readonly string[];
  readonly keyHeader: string;
  /** Whether the key is folded for the row key. A website `PersonId` is used as it stands. */
  readonly foldKey: boolean;
}

const FILES: readonly FileSpec[] = [
  {
    stem: "replications",
    headers: [
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
    keyHeader: "StudyId",
    foldKey: true,
  },
  {
    stem: "publications",
    headers: [
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
    keyHeader: "PublicationId",
    foldKey: true,
  },
  {
    stem: "people",
    headers: [
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
    keyHeader: "PersonId",
    foldKey: false,
  },
  {
    stem: "members",
    headers: ["SequenceNumber", "PersonId", "FullName", "Affiliation", "Country"],
    keyHeader: "PersonId",
    foldKey: false,
  },
];

/** The tab of the files that the website keys by a record identifier. */
const FILES_TAB = "files";

/** Where those files are, relative to the root of the repository, and which of them count. */
const FILE_AREAS: readonly { readonly directory: string; readonly pattern: RegExp }[] = [
  { directory: "assets/pdfs", pattern: /\.pdf$/ },
  { directory: "assets/images/previews", pattern: /\.pdf\.png$/ },
  { directory: "assets/images/headshots", pattern: /^[^.]/ },
  // The section page is written by hand. Every other page of the directory is build output.
  { directory: "content/people", pattern: /^(?!index\.md$).+\.md$/ },
];

/** The address under which the public website serves its files. */
const PUBLIC_SITE_ORIGIN = "https://eegmanylabs.org";

/**
 * The alias table of country spellings, which a maintainer can read and extend. It is seeded
 * with the one entry that the map script of the website already uses. No spelling is matched
 * by similarity.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = { USA: "United States" };

/**
 * How the two status cells of a publication row are read. The verbatim cells stay in the
 * source record and become vocabulary terms. A pair that is not listed creates no manuscript
 * and goes to review.
 *
 * | `Status`    | `StatusText`           | Kind       | Status                  |
 * |-------------|------------------------|------------|-------------------------|
 * | `stage1`    | `Stage 1 accepted`     | `stage1Rr` | `inPrincipleAcceptance` |
 * | `stage1`    | `Stage 1 under review` | `stage1Rr` | `underReview`           |
 * | `published` | `published`            | `article`  | `published`             |
 * | `preprint`  | `preprint`             | `preprint` | `published`             |
 */
const PUBLICATION_STATUSES: readonly {
  readonly status: string;
  readonly statusText: string;
  readonly kind: "stage1Rr" | "article" | "preprint";
  readonly manuscriptStatus: "inPrincipleAcceptance" | "underReview" | "published";
}[] = [
  { status: "stage1", statusText: "Stage 1 accepted", kind: "stage1Rr", manuscriptStatus: "inPrincipleAcceptance" },
  { status: "stage1", statusText: "Stage 1 under review", kind: "stage1Rr", manuscriptStatus: "underReview" },
  { status: "published", statusText: "published", kind: "article", manuscriptStatus: "published" },
  { status: "preprint", statusText: "preprint", kind: "preprint", manuscriptStatus: "published" },
];

/** The role flags of the people file with the tag each gives, in the order in which the website lists the tags. */
const ROLE_FLAGS: readonly { readonly header: string; readonly tag: string }[] = [
  { header: "CoordinatorRole", tag: "coordinator" },
  { header: "AdvisorRole", tag: "advisor" },
  { header: "CoInvestigatorRole", tag: "co-investigator" },
  { header: "LeadRole", tag: "study_lead" },
  { header: "SpinOffRole", tag: "spin-off" },
];

const positional = (count: number): string[] => Array.from({ length: count }, (_unused, index) => `c${index + 1}`);

function readFile(spec: FileSpec, name: string, bytes: Uint8Array, issues: StructureIssue[]): SourceTab {
  const tab = { tabKey: spec.stem, name, visibility: "visible" as const, headerRow: 1 };
  const issue = (check: string, message: string, expected: string, found: string) =>
    issues.push({ check, tabKey: spec.stem, message, expected, found });
  let file: TsvFile;
  try {
    file = readTsv(bytes);
  } catch (error) {
    if (!(error instanceof TsvFormatError)) throw error;
    issue("encoding", `The file ${name} is not valid UTF-8 text.`, "UTF-8", "other bytes");
    return { ...tab, rows: [], fillerRows: 0, blankRows: 0 };
  }
  const headerValid =
    file.header.length === spec.headers.length && file.header.every((header, index) => header === spec.headers[index]);
  if (!headerValid) {
    issue(
      "header",
      `The header of ${name} is not the expected list of columns: a column is unknown, missing or reordered.`,
      spec.headers.join(" | "),
      file.header.join(" | "),
    );
  }
  if (file.quoteCount > 0) {
    // The site's own reader would read a double quote as a quoting character, so the meaning of the file is open.
    issue("quote", `The file ${name} contains double quotes.`, "0", String(file.quoteCount));
  }

  const rows: SourceRow[] = [
    {
      rowClass: "header",
      rowNumber: 1,
      rowKey: "header",
      cells: file.header.map((cell) => (cell === "" ? null : cell)),
      labels: positional(file.header.length),
    },
  ];
  const keyIndex = spec.headers.indexOf(spec.keyHeader);
  const keys = new Set<string>(["header"]);
  const unkeyed = new Map<string, number>();
  let blankRows = 0;
  let wrongWidth = 0;
  let badKeys = 0;
  for (const line of file.rows) {
    if (line.cells.every((cell) => cell === "")) {
      blankRows += 1;
      continue;
    }
    const cells = line.cells.map((cell) => (cell === "" ? null : cell));
    const fits = headerValid && cells.length === spec.headers.length;
    if (cells.length !== file.header.length) wrongWidth += 1;
    const key = fits ? (line.cells[keyIndex] ?? "") : "";
    let rowKey = spec.foldKey ? lookupFold(key) : key;
    if (rowKey === "" || rowKey.length > LIMITS.shortText || keys.has(rowKey)) {
      // A row without a usable key of its own is still captured, under the hash of its content.
      if (fits) badKeys += 1;
      rowKey = contentRowKey(cells, unkeyed);
    }
    keys.add(rowKey);
    rows.push({
      rowClass: "data",
      rowNumber: line.lineNumber,
      rowKey,
      cells,
      labels: fits ? [...spec.headers] : positional(cells.length),
    });
  }
  if (wrongWidth > 0) {
    issue(
      "fieldCount",
      `${wrongWidth} lines of ${name} do not have as many fields as the header.`,
      String(file.header.length),
      `${wrongWidth} lines of another width`,
    );
  }
  if (badKeys > 0) {
    issue(
      "key",
      `${badKeys} rows of ${name} have an empty ${spec.keyHeader} or one that another row has as well.`,
      "one distinct key for each row",
      `${badKeys} rows without one`,
    );
  }
  return { ...tab, rows, fillerRows: 0, blankRows };
}

/** The files that the website keys by a record identifier, where the input sits in a checkout of the repository. */
function repositoryFiles(dataDirectory: string): SourceTab | null {
  const root = path.dirname(path.resolve(dataDirectory));
  if (!existsSync(path.join(root, "assets"))) return null;
  const paths = FILE_AREAS.flatMap((area) => {
    const directory = path.join(root, area.directory);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => area.pattern.test(name) && statSync(path.join(directory, name)).isFile())
      .sort()
      .map((name) => `${area.directory}/${name}`);
  });
  return {
    tabKey: FILES_TAB,
    name: "repository files",
    visibility: "visible",
    rows: paths
      .filter((file) => file.length <= LIMITS.shortText)
      .map((file, index) => ({
        rowClass: "data",
        rowNumber: index + 1,
        rowKey: file,
        cells: [file],
        labels: ["path"],
      })),
    fillerRows: 0,
    blankRows: 0,
  };
}

async function read(input: ImportInput): Promise<SourceReading> {
  const issues: StructureIssue[] = [];
  const tabs: SourceTab[] = [];
  const inputFiles: InputFile[] = [];
  if (!existsSync(input.path) || !statSync(input.path).isDirectory()) {
    issues.push({
      check: "input",
      tabKey: null,
      message: "The input is not a directory. Name the `data` directory of the repository.",
      expected: "a directory",
      found: "something else",
    });
  } else {
    for (const spec of FILES) {
      const name = `${spec.stem}.tsv`;
      const filePath = path.join(input.path, name);
      if (!existsSync(filePath)) {
        issues.push({
          check: "file",
          tabKey: spec.stem,
          message: `The file ${name} is missing from the input directory.`,
          expected: name,
          found: "no such file",
        });
        continue;
      }
      const bytes = readFileSync(filePath);
      inputFiles.push({ name, sha256: sha256OfBytes(bytes) });
      tabs.push(readFile(spec, name, bytes, issues));
    }
    const files = repositoryFiles(input.path);
    if (files !== null) tabs.push(files);
  }
  const listing = inputFiles.map((file) => `${file.name}\n${file.sha256}\n`).join("");
  return { contentHash: sha256OfBytes(Buffer.from(listing, "utf8")), inputFiles, tabs, issues };
}

interface PersonRef {
  readonly personId: string;
  readonly name: string;
  readonly row: RecordedRow;
}

interface LeadClaim extends PersonRef {
  /** The cell that names the lead: `h/replications` for the named lead, `h/people` for a flagged one. */
  readonly source: string;
}

interface StoredManuscript {
  readonly id: string;
  readonly replicationId: string | null;
  readonly doi: string | null;
  readonly kind: string;
  readonly status: string;
}

const person = (personId: string) => ({ entityType: "person", entityId: personId }) as const satisfies EntityRef;
const replication = (studyId: string) =>
  ({ entityType: "replication", entityId: studyId }) as const satisfies EntityRef;
const manuscript = (id: string) => ({ entityType: "manuscript", entityId: id }) as const satisfies EntityRef;

/** The folded words of a name: the first and the last are compared, and nothing in between. */
const nameWords = (name: string): string[] =>
  name.normalize("NFC").trim().split(/\s+/u).map(lookupFold).filter(Boolean);

class WebsitePlan {
  readonly #context: PlanContext;
  readonly #builder = new PlanBuilder();
  readonly #terms = new VocabularyCollector();
  /** The replication of each row of the replications file, by row key. */
  readonly #studyOfRow = new Map<string, string>();
  readonly #corePeople = new Map<string, PersonRef>();
  readonly #people: (PersonRef & { readonly file: "people" | "members" })[] = [];
  readonly #leadClaims = new Map<string, LeadClaim[]>();
  readonly #countries = new Set<string>();
  readonly #publicationIds = new Set<string>();
  readonly #publicationsOfStudy = new Map<string, { readonly id: string; readonly row: RecordedRow }[]>();
  readonly #files = new Map<string, RecordedRow>();

  constructor(context: PlanContext) {
    this.#context = context;
  }

  #rows(tabKey: string): readonly RecordedRow[] {
    return (this.#context.rows.get(tabKey) ?? []).filter((row) => row.rowClass === "data");
  }

  /**
   * Raises an item for a cell that cannot be read mechanically. The row is still imported,
   * unless the cell is one that its record cannot do without: the row then waits in the queue.
   */
  #unparsed(file: string, row: RecordedRow, field: string, value: string, hold = false): void {
    const item = this.#context.items.unparsedValue({
      subject: `${SOURCE_KEY}/${file}/${row.rowKey}`,
      field,
      claims: [{ source: `${SOURCE_KEY}/${file}`, value, valueSource: value, sourceRecordId: row.recordId }],
    });
    if (hold) this.#builder.hold(row.recordId, item);
    else this.#builder.item(item);
  }

  async build(): Promise<ImportPlan> {
    const programme = await this.#context.db.doc(COLLECTIONS.programmes.docPath(PROGRAMME_KEY)).get();
    if (!programme.exists) {
      this.#builder.block(
        "lookups",
        "The programme document does not exist, so a replication would refer to nothing. Run seed:lookups first.",
      );
      return this.#builder.build();
    }
    for (const row of this.#rows(FILES_TAB)) this.#files.set(row.rowKey, row);
    await this.#resolveStudies();
    for (const row of this.#rows("people")) await this.#person(row, "people");
    for (const row of this.#rows("members")) await this.#person(row, "members");
    this.#affiliationTails();
    this.#probableDuplicates();
    for (const row of this.#rows("replications")) this.#replication(row);
    this.#leads();
    await this.#publications();
    this.#publicationLinks();
    this.#repositoryFiles();
    this.#terms.documents(this.#builder);
    return this.#builder.build();
  }

  /**
   * Decides which replication each row of the replications file is. A spelling that the folded
   * lookup already knows keeps the identifier it resolves to, because an existing identifier is
   * never renamed. Any other well-formed `StudyId` is the identifier of a new replication.
   */
  async #resolveStudies(): Promise<void> {
    const { items, studies } = this.#context;
    const unmatched = (row: RecordedRow, studyId: string, replicationIds: readonly string[]) =>
      this.#builder.hold(
        row.recordId,
        items.unmatchedIdentifier({
          subject: `${SOURCE_KEY}/replications/${row.rowKey}`,
          entityRefs: replicationIds.map(replication),
          claims: [
            {
              source: `${SOURCE_KEY}/replications`,
              value: studyId,
              valueSource: studyId,
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
    const claims = new Map<string, { readonly row: RecordedRow; readonly studyId: string }[]>();
    for (const row of this.#rows("replications")) {
      const studyId = cellText(row, "StudyId") ?? "";
      const resolution = STUDY_ID_PATTERN.test(studyId) ? await studies.resolve(studyId) : null;
      if (resolution?.status === "resolved" || resolution?.status === "unresolved") {
        const target = resolution.status === "resolved" ? resolution.replicationId : studyId;
        claims.set(target, [...(claims.get(target) ?? []), { row, studyId }]);
      } else {
        // Malformed, or a spelling that several replications carry: no replication is created.
        unmatched(row, studyId, resolution?.status === "ambiguous" ? resolution.replicationIds : []);
      }
    }
    for (const [replicationId, rows] of claims) {
      // Two rows may resolve to one replication, one of them through an alias. Only the row that
      // writes the identifier itself describes the replication, and the other goes to review.
      const own = rows.length === 1 ? rows[0] : rows.find((candidate) => candidate.studyId === replicationId);
      for (const candidate of rows) {
        if (candidate === own) this.#studyOfRow.set(candidate.row.rowKey, replicationId);
        else unmatched(candidate.row, candidate.studyId, [replicationId]);
      }
      if (own !== undefined) studies.declare(own.studyId, replicationId);
    }
  }

  /** The reading of a role flag: `1` is set, `0` is not, and a blank is not set only where the column uses blank for it. */
  #flag(row: RecordedRow, header: string, blankIsFalse: boolean): boolean | null {
    const cell = cellText(row, header);
    if (cell === "1") return true;
    if (cell === "0" || (cell === null && blankIsFalse)) return false;
    this.#unparsed("people", row, header, cell ?? "");
    return null;
  }

  #country(row: RecordedRow): string | undefined {
    const raw = cellText(row, "Country");
    if (raw === null) return undefined;
    const target = COUNTRY_ALIASES[raw];
    this.#countries.add(lookupFold(raw));
    this.#terms.add("country", target ?? raw, row.recordId, raw);
    if (target !== undefined) {
      this.#countries.add(lookupFold(target));
      // An alias in use merges two spellings into one term, which a maintainer confirms.
      this.#builder.item(
        this.#context.items.vocabularyReview({
          subject: `${SOURCE_KEY}/country/${lookupFold(raw)}`,
          claims: [
            {
              source: `${SOURCE_KEY}/countryAliases`,
              value: `${raw}\t${target}`,
              valueSource: raw,
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
    }
    return raw;
  }

  async #person(row: RecordedRow, file: "people" | "members"): Promise<void> {
    const { items, identities } = this.#context;
    const builder = this.#builder;
    const source = `${SOURCE_KEY}/${file}`;
    const websiteId = cellText(row, "PersonId") ?? "";
    const name = cellText(row, "FullName") ?? "";
    if (!keySchema.safeParse(websiteId).success || name === "" || name.length > LIMITS.shortText) {
      // The website identifier becomes the slug of the person, and a person needs a name to be listed.
      this.#unparsed(file, row, name === "" ? "FullName" : "PersonId", name === "" ? name : websiteId, true);
      return;
    }
    const evidence =
      file === "people" ? personEvidence.websitePeople(websiteId) : personEvidence.websiteMembers(websiteId);
    const resolution = await identities.resolvePerson([evidence]);
    if (resolution.status === "erased") {
      builder.rawOnly(row.recordId, "erasedPerson");
      return;
    }
    const claim = { source, value: websiteId, valueSource: name, sourceRecordId: row.recordId };
    if (resolution.status !== "existing" && resolution.status !== "new") {
      const known = resolution.status === "ambiguous" ? resolution.personIds : [];
      builder.hold(
        row.recordId,
        items.duplicatePerson({ subject: `${source}/${row.rowKey}`, entityRefs: known.map(person), claims: [claim] }),
      );
      return;
    }
    const personId = resolution.personId;
    const holders = (await identities.holdersOfSlug(websiteId)).filter((holder) => holder !== personId);
    if (holders.length > 0) {
      // The slug is the public page anchor and never names two people. A reviewer decides whether they are one.
      builder.hold(
        row.recordId,
        items.duplicatePerson({
          subject: `slug/${websiteId}`,
          entityRefs: [...holders, personId].map(person),
          claims: [claim],
        }),
      );
      return;
    }

    const roles: string[] = [];
    const urls: Record<string, string | undefined> = {};
    if (file === "people") {
      const flags = new Map(ROLE_FLAGS.map(({ header, tag }) => [tag, this.#flag(row, header, false)]));
      const other = cellText(row, "OtherRole");
      const director = this.#flag(row, "DirectorRole", true);
      for (const { tag } of ROLE_FLAGS) if (flags.get(tag) === true) roles.push(tag);
      if (other !== null && other.length <= LIMITS.shortText) roles.push(other);
      else if (other !== null) this.#unparsed(file, row, "OtherRole", other);
      if (director === true) roles.push("directors");
      for (const role of roles) this.#terms.add("coreRole", role, row.recordId);
      for (const [header, field] of [
        ["ScholarUrl", "scholarUrl"],
        ["UniUrl", "universityUrl"],
        ["LabUrl", "labUrl"],
      ] as const) {
        const address = cellText(row, header);
        if (address !== null && isStorableUrl(address)) urls[field] = address;
        else if (address !== null) this.#unparsed(file, row, header, address);
      }
      await this.#leadFlag(row, { personId, name, row }, flags.get("study_lead") ?? null);
      this.#corePeople.set(websiteId, { personId, name, row });
    }

    builder.document({
      collection: "persons",
      ids: [personId],
      fixed: {
        slug: websiteId,
        laboratoryIds: [],
        replicationIds: [],
        userId: null,
        claimedAt: null,
        custom: {},
        dataOrigin: "live",
      },
      owned: {
        displayName: name,
        countrySource: this.#country(row),
        websitePersonId: websiteId,
        isCoreTeam: file === "people",
        publicListing: file === "people" ? "coreTeam" : "member",
        coreRoles: roles,
        headshotFilename: file === "people" ? (cellText(row, "HeadShotFilename") ?? undefined) : undefined,
        scholarUrl: urls.scholarUrl,
        universityUrl: urls.universityUrl,
        labUrl: urls.labUrl,
      },
      sourceRecordIds: [row.recordId],
    });
    for (const key of identities.keyDocuments(personId, [evidence], row.recordId)) builder.document(key);
    builder.document(identities.slugDocument(personId, websiteId, row.recordId));
    const affiliation = cellText(row, "Affiliation");
    if (affiliation !== null) {
      affiliationDocuments(builder, {
        personId,
        sourceKey: SOURCE_KEY,
        tabKey: file,
        slot: 1,
        affiliation,
        recordId: row.recordId,
      });
    }
    this.#people.push({ personId, name, row, file });
  }

  /** Notes the lead claim of a row of the people file: who is flagged as a lead, and of which study. */
  async #leadFlag(row: RecordedRow, who: PersonRef, flagged: boolean | null): Promise<void> {
    const { items, studies } = this.#context;
    const studyCell = cellText(row, "StudyId");
    const source = `${SOURCE_KEY}/people`;
    if ((flagged === true) !== (studyCell !== null)) {
      // The flag and the study belong together. One without the other names no lead of any study.
      this.#builder.item(
        items.valueConflict({
          subject: `${source}/${row.rowKey}`,
          field: "LeadRole",
          personal: false,
          claims: [
            { source: `${source}/LeadRole`, value: cellText(row, "LeadRole") ?? "", sourceRecordId: row.recordId },
            {
              source: `${source}/StudyId`,
              value: studyCell ?? "",
              valueSource: studyCell ?? "",
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
      return;
    }
    if (studyCell === null) return;
    const resolution = await studies.resolve(studyCell);
    if (resolution.status !== "resolved") {
      this.#builder.item(
        items.unmatchedIdentifier({
          subject: `${source}/${row.rowKey}`,
          field: "StudyId",
          claims: [{ source, value: studyCell, valueSource: studyCell, sourceRecordId: row.recordId }],
        }),
      );
      return;
    }
    const claims = this.#leadClaims.get(resolution.replicationId) ?? [];
    claims.push({ ...who, source });
    this.#leadClaims.set(resolution.replicationId, claims);
  }

  /**
   * Reports the last part of a member affiliation that is no country spelling the files know.
   * It may be a spelling that the alias table lacks, or no country at all. A person decides
   * which, and nothing is derived from the tail of the string.
   */
  #affiliationTails(): void {
    const known = new Set([...this.#countries, ...Object.keys(COUNTRY_ALIASES).map(lookupFold)]);
    const unknown = new Map<string, { readonly spelling: string; readonly recordId: string }[]>();
    for (const row of this.#rows("members")) {
      const tail = (cellText(row, "Affiliation") ?? "").split(",").at(-1)?.trim() ?? "";
      const folded = lookupFold(tail);
      if (folded === "" || known.has(folded)) continue;
      unknown.set(folded, [...(unknown.get(folded) ?? []), { spelling: tail, recordId: row.recordId }]);
    }
    for (const [folded, rows] of unknown) {
      this.#builder.item(
        this.#context.items.vocabularyReview({
          subject: `${SOURCE_KEY}/members/affiliationTail/${shortHash(folded)}`,
          field: "Affiliation",
          claims: rows
            .sort((a, b) => (a.recordId < b.recordId ? -1 : 1))
            .slice(0, 90)
            .map((row) => ({
              source: `${SOURCE_KEY}/members`,
              value: folded,
              valueSource: row.spelling,
              sourceRecordId: row.recordId,
            })),
        }),
      );
    }
  }

  /**
   * Reports an entry of the Core Team and an entry of the Members list that may be one person:
   * the same last word of the name, and the same first word or the same first letter. Nothing
   * is merged on a name, and a reviewer decides.
   */
  #probableDuplicates(): void {
    const members = new Map<string, (PersonRef & { readonly first: string })[]>();
    for (const entry of this.#people.filter((candidate) => candidate.file === "members")) {
      const words = nameWords(entry.name);
      const [first, last] = [words[0], words.at(-1)];
      if (first === undefined || last === undefined) continue;
      members.set(last, [...(members.get(last) ?? []), { ...entry, first }]);
    }
    for (const entry of this.#people.filter((candidate) => candidate.file === "people")) {
      const words = nameWords(entry.name);
      const [first, last] = [words[0], words.at(-1)];
      if (first === undefined || last === undefined) continue;
      for (const member of members.get(last) ?? []) {
        if (member.first[0] !== first[0]) continue;
        this.#builder.item(
          this.#context.items.duplicatePerson({
            subject: [entry.personId, member.personId].sort().join("+"),
            entityRefs: [entry.personId, member.personId].map(person),
            claims: [
              {
                source: `${SOURCE_KEY}/people`,
                value: entry.personId,
                valueSource: entry.name,
                sourceRecordId: entry.row.recordId,
              },
              {
                source: `${SOURCE_KEY}/members`,
                value: member.personId,
                valueSource: member.name,
                sourceRecordId: member.row.recordId,
              },
            ],
          }),
        );
      }
    }
  }

  #replication(row: RecordedRow): void {
    const { items, studies } = this.#context;
    const builder = this.#builder;
    const studyId = this.#studyOfRow.get(row.rowKey);
    if (studyId === undefined) return;
    const source = `${SOURCE_KEY}/replications`;
    const written = cellText(row, "StudyId") ?? studyId;

    const yearCell = cellText(row, "PublicationYear");
    // The year stays as text in the source record, because two rows carry a letter suffix.
    const year = yearCell !== null && /^\d{4}[a-z]?$/.test(yearCell) ? Number(yearCell.slice(0, 4)) : undefined;
    if (yearCell !== null && year === undefined) this.#unparsed("replications", row, "PublicationYear", yearCell);
    const doiCell = cellText(row, "Doi");
    const doi = doiCell !== null && doiSchema.safeParse(doiCell).success ? doiCell : undefined;
    if (doiCell !== null && doi === undefined) this.#unparsed("replications", row, "Doi", doiCell);
    const stageCell = cellText(row, "StageNumber");
    const stageNumber = stageCell === null ? null : wholeNumberOf(stageCell);
    if (stageCell !== null && (stageNumber === null || stageNumber > 100)) {
      this.#unparsed("replications", row, "StageNumber", stageCell);
    }
    const activeCell = cellText(row, "SignUpActive");
    const signupActive = activeCell === "1" ? true : activeCell === "0" ? false : undefined;
    if (activeCell !== null && signupActive === undefined)
      this.#unparsed("replications", row, "SignUpActive", activeCell);

    // `done` in the sign-up column is a status and no address. The raw cell stays in the source record.
    const signupCell = cellText(row, "SignupUrl");
    const signupUrl = signupCell !== null && isStorableUrl(signupCell) ? signupCell : undefined;
    if (signupCell !== null && signupUrl === undefined && signupCell !== "done") {
      this.#unparsed("replications", row, "SignupUrl", signupCell);
    }
    const archiveCell = cellText(row, "allSignUpLinks");
    const archiveUrl = archiveCell !== null && isStorableUrl(archiveCell) ? archiveCell : undefined;
    if (archiveCell !== null && archiveUrl === undefined)
      this.#unparsed("replications", row, "allSignUpLinks", archiveCell);
    if (
      (signupUrl !== undefined) !== (signupActive === true) ||
      (signupUrl !== undefined && archiveUrl !== signupUrl)
    ) {
      // The three sign-up cells state one fact three times. Where they disagree, a person decides.
      builder.item(
        items.valueConflict({
          subject: studyId,
          field: "signupUrl",
          entityRefs: [replication(studyId)],
          claims: [
            {
              source: `${source}/SignupUrl`,
              value: signupCell ?? "",
              valueSource: signupCell ?? "",
              sourceRecordId: row.recordId,
            },
            {
              source: `${source}/SignUpActive`,
              value: activeCell ?? "",
              valueSource: activeCell ?? "",
              sourceRecordId: row.recordId,
            },
            {
              source: `${source}/allSignUpLinks`,
              value: archiveCell ?? "",
              valueSource: archiveCell ?? "",
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
    }

    const text = (header: string, limit: number): string | undefined => {
      const cell = cellText(row, header);
      if (cell !== null && cell.length > limit) this.#unparsed("replications", row, header, cell);
      return cell !== null && cell.length <= limit ? cell : undefined;
    };
    builder.document({
      collection: "replications",
      ids: [studyId],
      fixed: {
        programmeId: PROGRAMME_KEY,
        studyKey: studyId,
        citationStatus: "unverified",
        statusKey: null,
        statusHistoryId: null,
        selectionStatus: "selected",
        leadPersonIds: [],
        vocabulary: [],
        custom: {},
        dataOrigin: "live",
      },
      owned: {
        originalAuthors: text("Authors", LIMITS.longText),
        originalYear: year,
        originalTitle: text("Title", LIMITS.longText),
        originalReference: text("Reference", LIMITS.longText),
        originalDoi: doi,
        theme: text("Theme", LIMITS.shortText),
        psychConstruct: text("PsychConstruct", LIMITS.shortText),
        publicStageNumber: stageNumber !== null && stageNumber <= 100 ? stageNumber : undefined,
        publicStageName: text("StageName", LIMITS.shortText),
        publicStageText: text("LongStageText", LIMITS.longText),
        signupUrl,
        signupActive,
      },
      sourceRecordIds: [row.recordId],
    });
    aliasDocuments(builder, studies, {
      replicationId: studyId,
      scheme: "website",
      alias: written,
      recordId: row.recordId,
    });
    if (doi !== undefined) {
      const sharing = this.#rows("replications").filter(
        (other) => doiKey(cellText(other, "Doi") ?? "") === doiKey(doi),
      );
      if (sharing.length === 1) doiLookupDocument(builder, replication(studyId), doi, row.recordId);
      else if (sharing[0]?.recordId === row.recordId) {
        // One DOI on several studies names no single study, so no lookup is written for it.
        builder.item(
          items.valueConflict({
            subject: `${source}/doi/${shortHash(doiKey(doi))}`,
            field: "originalDoi",
            entityRefs: sharing.flatMap((other) => this.#studyOfRow.get(other.rowKey) ?? []).map(replication),
            claims: sharing.map((other) => ({
              source,
              value: cellText(other, "StudyId") ?? "",
              valueSource: doi,
              sourceRecordId: other.recordId,
            })),
          }),
        );
      }
    }

    const scope = [replicationScopeKey(studyId)];
    const link = (slot: string, url: string | undefined) => {
      if (url === undefined) return;
      slotLinkDocument(builder, {
        owner: replication(studyId),
        slot,
        url,
        replicationId: studyId,
        ownerScopeKeys: scope,
        recordId: row.recordId,
      });
      if (!isEditorAddress(url)) return;
      builder.item(
        items.linkDefect({
          subject: studyId,
          field: slot,
          entityRefs: [replication(studyId)],
          claims: [{ source, value: url, valueSource: url, sourceRecordId: row.recordId }],
        }),
      );
    };
    link("signup", signupUrl);
    link("signupArchive", archiveUrl);

    const theme = cellText(row, "Theme");
    const construct = cellText(row, "PsychConstruct");
    if (theme !== null) this.#terms.add("theme", theme, row.recordId);
    for (const term of (construct ?? "").split(",").map((part) => part.trim())) {
      if (term !== "") this.#terms.add("psychConstruct", term, row.recordId);
    }
    const stageName = cellText(row, "StageName");
    const stageText = cellText(row, "LongStageText");
    if (stageCell !== null && stageName !== null) {
      const stage = `${stageCell}_${stageName}`;
      this.#terms.add("publicStage", stage, row.recordId);
      if (stageText !== null) this.#terms.add("publicStage", stage, row.recordId, stageText);
    }
    if (theme !== null && construct !== null) this.#themeAndConstruct(row, studyId, theme, construct);

    const leadId = cellText(row, "PersonId");
    const leadName = cellText(row, "LeadFullName");
    const lead = leadId === null ? undefined : this.#corePeople.get(leadId);
    if (lead !== undefined) {
      // The named lead comes first. A flag of the same person in the people file names the same membership.
      this.#leadClaims.set(studyId, [
        { ...lead, name: leadName ?? lead.name, row, source },
        ...(this.#leadClaims.get(studyId) ?? []),
      ]);
      if (leadName !== null && leadName !== lead.name) {
        builder.item(
          items.valueConflict({
            subject: lead.personId,
            field: "displayName",
            entityRefs: [person(lead.personId)],
            personal: true,
            claims: [
              { source, value: leadName, valueSource: leadName, sourceRecordId: row.recordId },
              {
                source: `${SOURCE_KEY}/people`,
                value: lead.name,
                valueSource: lead.name,
                sourceRecordId: lead.row.recordId,
              },
            ],
          }),
        );
      }
    } else if (leadId !== null || leadName !== null) {
      // The named lead resolves to no person. No person is created from a name, and no membership is written.
      builder.item(
        items.candidateLink({
          subject: studyId,
          field: "lead",
          entityRefs: [replication(studyId)],
          claims: [
            { source, value: leadId ?? leadName ?? "", valueSource: leadName ?? "", sourceRecordId: row.recordId },
          ],
        }),
      );
    }
  }

  /**
   * Reports a construct that names one theme of the file while its own row carries another.
   * The pairing may be meant, so the row is imported as it stands.
   */
  #themeAndConstruct(row: RecordedRow, studyId: string, theme: string, construct: string): void {
    const themes = new Set(
      this.#rows("replications").flatMap((other) => lookupFold(cellText(other, "Theme") ?? "") || []),
    );
    const words = construct
      .split(/[\s,]+/u)
      .map(lookupFold)
      .filter(Boolean);
    const named = [...themes].filter((candidate) => words.some((word) => word.startsWith(candidate)));
    if (named.length === 0 || named.includes(lookupFold(theme))) return;
    const source = `${SOURCE_KEY}/replications`;
    this.#builder.item(
      this.#context.items.vocabularyReview({
        subject: studyId,
        field: "theme",
        entityRefs: [replication(studyId)],
        claims: [
          { source: `${source}/Theme`, value: theme, valueSource: theme, sourceRecordId: row.recordId },
          {
            source: `${source}/PsychConstruct`,
            value: construct,
            valueSource: construct,
            sourceRecordId: row.recordId,
          },
        ],
      }),
    );
  }

  /**
   * Writes the lead memberships. A lead whom the replications file names and nobody contradicts
   * is confirmed, because the programme has itself published it. Where the claims for one study
   * name different people, every membership concerned needs review and one item lists the claims.
   */
  #leads(): void {
    for (const [studyId, claims] of this.#leadClaims) {
      const people = new Set(claims.map((claim) => claim.personId));
      const agreed = people.size === 1 && claims[0]?.source === `${SOURCE_KEY}/replications`;
      for (const claim of claims) {
        this.#builder.document({
          collection: "replicationMemberships",
          ids: [studyId, replicationMembershipId(claim.personId, "lead")],
          fixed: { replicationId: studyId, personId: claim.personId, role: "lead", earlierPeriods: [] },
          owned: { isCurrent: true, reviewStatus: agreed ? "confirmed" : "needsReview" },
          // A reviewer's confirmation is a decision, which the item below already asks for.
          silent: ["isCurrent", "reviewStatus"],
          sourceRecordIds: [claim.row.recordId],
        });
      }
      if (people.size < 2) continue;
      this.#builder.item(
        this.#context.items.conflictingLead({
          subject: studyId,
          field: "lead",
          entityRefs: [replication(studyId), ...[...people].sort().map(person)],
          claims: claims.map((claim) => ({
            source: claim.source,
            value: claim.personId,
            valueSource: claim.name,
            sourceRecordId: claim.row.recordId,
          })),
        }),
      );
    }
  }

  async #publications(): Promise<void> {
    const { db } = this.#context;
    const rows = this.#rows("publications");
    for (const row of rows) this.#publicationIds.add(cellText(row, "PublicationId") ?? "");
    const stored: StoredManuscript[] = (await db.collection(COLLECTIONS.manuscripts.collectionPath()).get()).docs
      .filter((doc) => typeof doc.get("websitePublicationId") === "string")
      .map((doc) => ({
        id: doc.id,
        replicationId: (doc.get("replicationId") as string | undefined) ?? null,
        doi: typeof doc.get("doi") === "string" ? doiKey(doc.get("doi") as string) : null,
        kind: String(doc.get("kind")),
        status: String(doc.get("status")),
      }));
    const dois = new Map<string, number>();
    for (const row of rows) {
      const key = doiKey(cellText(row, "DOI") ?? "");
      dois.set(key, (dois.get(key) ?? 0) + 1);
    }
    for (const row of rows) await this.#publication(row, stored, dois);
  }

  async #publication(
    row: RecordedRow,
    stored: readonly StoredManuscript[],
    dois: ReadonlyMap<string, number>,
  ): Promise<void> {
    const { items, studies } = this.#context;
    const builder = this.#builder;
    const source = `${SOURCE_KEY}/publications`;
    const id = cellText(row, "PublicationId") ?? "";
    const claim = { source, value: id, valueSource: id, sourceRecordId: row.recordId };
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(id) || id.length > 100) {
      builder.hold(row.recordId, items.unmatchedIdentifier({ subject: `${source}/${row.rowKey}`, claims: [claim] }));
      return;
    }
    const title = cellText(row, "Title");
    if (title === null || title.length > 1_000) {
      this.#unparsed("publications", row, "Title", title ?? "", true);
      return;
    }
    const statusCell = cellText(row, "Status") ?? "";
    const statusText = cellText(row, "StatusText") ?? "";
    const reading = PUBLICATION_STATUSES.find(
      (entry) => entry.status === statusCell && entry.statusText === statusText,
    );
    if (statusCell !== "") this.#terms.add("publicationStatus", statusCell, row.recordId);
    if (statusText !== "") this.#terms.add("publicationStatusText", statusText, row.recordId);
    if (reading === undefined) {
      // A status outside the table is read by a person. Until then the row creates no manuscript.
      builder.hold(
        row.recordId,
        items.vocabularyReview({
          subject: `${source}/${row.rowKey}`,
          field: "Status",
          claims: [
            { source, value: `${statusCell}\t${statusText}`, valueSource: statusText, sourceRecordId: row.recordId },
          ],
        }),
      );
      return;
    }

    const studyCell = cellText(row, "ReplicationId");
    const resolution = studyCell === null ? null : await studies.resolve(studyCell);
    const replicationId = resolution?.status === "resolved" ? resolution.replicationId : undefined;
    if (studyCell !== null && replicationId === undefined) {
      builder.item(
        items.unmatchedIdentifier({
          subject: `${source}/${row.rowKey}`,
          field: "ReplicationId",
          entityRefs: [manuscript(id)],
          claims: [{ source, value: studyCell, valueSource: studyCell, sourceRecordId: row.recordId }],
        }),
      );
    }
    const doiCell = cellText(row, "DOI");
    const doi = doiCell !== null && doiSchema.safeParse(doiCell).success ? doiCell : undefined;
    if (doiCell !== null && doi === undefined) this.#unparsed("publications", row, "DOI", doiCell);

    const existing = stored.find((entry) => entry.id === id);
    if (existing === undefined) {
      // An identifier that has gone while a new one arrives for the same study or DOI is a probable rename.
      const renamed = stored.filter(
        (entry) =>
          !this.#publicationIds.has(entry.id) &&
          ((replicationId !== undefined && entry.replicationId === replicationId) ||
            (doi !== undefined && entry.doi === doiKey(doi))),
      );
      if (renamed.length > 0) {
        builder.hold(
          row.recordId,
          items.missingFromSource({
            subject: `${source}/rename/${renamed
              .map((entry) => entry.id)
              .sort()
              .join("+")}`,
            entityRefs: renamed.map((entry) => manuscript(entry.id)),
            claims: [...renamed.map((entry) => ({ source: "portal", value: entry.id, valueSource: entry.id })), claim],
          }),
        );
        return;
      }
    } else if (existing.status !== reading.manuscriptStatus || existing.kind !== reading.kind) {
      // A status changes through the function that writes its history, so the import only reports the difference.
      builder.item(
        items.statusQuestion({
          subject: id,
          field: "status",
          entityRefs: [manuscript(id)],
          claims: [
            { source: "portal", value: `${existing.kind}\t${existing.status}`, valueSource: existing.status },
            {
              source,
              value: `${reading.kind}\t${reading.manuscriptStatus}`,
              valueSource: statusText,
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
    }

    const text = (header: string): string | undefined => {
      const cell = cellText(row, header);
      if (cell !== null && cell.length > LIMITS.shortText) this.#unparsed("publications", row, header, cell);
      return cell !== null && cell.length <= LIMITS.shortText ? cell : undefined;
    };
    const dateCell = cellText(row, "DatePublishedNumber");
    const date = dateCell === null ? null : /^(\d{4})(\d{2})(\d{2})$/.exec(dateCell);
    const instant = date === null ? Number.NaN : Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    const sameDay =
      date !== null && new Date(instant).toISOString().slice(0, 10) === `${date[1]}-${date[2]}-${date[3]}`;
    if (dateCell !== null && !sameDay) this.#unparsed("publications", row, "DatePublishedNumber", dateCell);
    const osfCell = cellText(row, "OSF");
    const osfUrl = osfCell !== null && isStorableUrl(osfCell) ? osfCell : undefined;
    const journal = text("Journal");
    if (journal !== undefined) this.#terms.add("journal", journal, row.recordId);
    const scope = replicationId === undefined ? [PROGRAMME_SCOPE_KEY] : [replicationScopeKey(replicationId)];

    builder.document({
      collection: "manuscripts",
      ids: [id],
      fixed: {
        websitePublicationId: id,
        kind: reading.kind,
        status: reading.manuscriptStatus,
        statusHistoryId: null,
        custom: {},
        scopeKeys: scope,
      },
      owned: {
        replicationId,
        title,
        journal,
        doi,
        osfUrl,
        authorsShort: text("AuthorsShort"),
        publishedAt: sameDay ? Timestamp.fromMillis(instant) : undefined,
      },
      sourceRecordIds: [row.recordId],
    });
    if (doi !== undefined && dois.get(doiKey(doi)) === 1) doiLookupDocument(builder, manuscript(id), doi, row.recordId);

    const link = (slot: string, header: string) => {
      const address = cellText(row, header);
      if (address === null) return;
      if (!isStorableUrl(address)) {
        this.#unparsed("publications", row, header, address);
        return;
      }
      slotLinkDocument(builder, {
        owner: manuscript(id),
        slot,
        url: address,
        replicationId: replicationId ?? null,
        ownerScopeKeys: scope,
        recordId: row.recordId,
      });
    };
    link("url", "URLs");
    link("osf", "OSF");
    link("code", "Code");
    // The website states neither the modality nor the workflow status that a dataset record needs,
    // so a data address is kept as a link of its manuscript and no dataset is written.
    link("data", "DataUrl");
    link("data2", "Data2Url");
    const pdf = this.#files.get(`assets/pdfs/${id}.pdf`);
    if (pdf !== undefined) {
      slotLinkDocument(builder, {
        owner: manuscript(id),
        slot: "pdf",
        url: `${PUBLIC_SITE_ORIGIN}/assets/pdfs/${id}.pdf`,
        replicationId: replicationId ?? null,
        ownerScopeKeys: scope,
        recordId: pdf.recordId,
      });
    }
    for (const header of ["DataUrl", "Data2Url"]) await this.#repositoryAlias(row, header, replicationId);
    if (studyCell !== null && replicationId !== undefined) {
      this.#publicationsOfStudy.set(replicationId, [
        ...(this.#publicationsOfStudy.get(replicationId) ?? []),
        { id, row },
      ]);
    }
    this.#publicationRowChecks(row, id);
  }

  /** States the alias for a repository name on the data host that embeds a study identifier. */
  async #repositoryAlias(row: RecordedRow, header: string, replicationId: string | undefined): Promise<void> {
    const { items, studies } = this.#context;
    const address = cellText(row, header);
    const name =
      address === null || !isStorableUrl(address)
        ? undefined
        : new URL(address).pathname.split("/").filter(Boolean).at(-1);
    const embedded = name === undefined ? null : /^EEGManyLabs_Replication_([A-Za-z0-9]+)_[A-Za-z]+$/.exec(name);
    if (name === undefined || embedded === null) return;
    const resolution = await studies.resolve(embedded[1] ?? "");
    const source = `${SOURCE_KEY}/publications`;
    if (
      resolution.status !== "resolved" ||
      (replicationId !== undefined && resolution.replicationId !== replicationId)
    ) {
      // The repository names a study that is unknown, or another study than its own row does.
      this.#builder.item(
        items.aliasConfirmation({
          subject: `${source}/${row.rowKey}`,
          field: header,
          entityRefs: replicationId === undefined ? [] : [replication(replicationId)],
          claims: [{ source, value: name, valueSource: name, sourceRecordId: row.recordId }],
        }),
      );
      return;
    }
    aliasDocuments(this.#builder, studies, {
      replicationId: resolution.replicationId,
      scheme: "dataRepository",
      alias: name,
      recordId: row.recordId,
    });
  }

  /** Reports a publication row that contradicts itself: in its years, or between its identifier and its authors. */
  #publicationRowChecks(row: RecordedRow, id: string): void {
    const { items } = this.#context;
    const source = `${SOURCE_KEY}/publications`;
    const idYear = /(\d{4})$/.exec(id)?.[1];
    const year = cellText(row, "PublicationYear");
    const date = cellText(row, "DatePublishedNumber");
    const years = [idYear, year ?? undefined, date?.slice(0, 4)].filter((value) => value !== undefined);
    if (new Set(years).size > 1) {
      this.#builder.item(
        items.valueConflict({
          subject: id,
          field: "publicationYear",
          entityRefs: [manuscript(id)],
          claims: [
            { source: `${source}/PublicationId`, value: idYear ?? "", valueSource: id, sourceRecordId: row.recordId },
            {
              source: `${source}/PublicationYear`,
              value: year ?? "",
              valueSource: year ?? "",
              sourceRecordId: row.recordId,
            },
            {
              source: `${source}/DatePublishedNumber`,
              value: date?.slice(0, 4) ?? "",
              valueSource: date ?? "",
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
    }
    const authors = cellText(row, "AuthorsShort");
    const surname = lookupFold(id.replace(/\d+$/, ""));
    if (authors !== null && surname !== "" && !lookupFold(authors).startsWith(surname)) {
      this.#builder.item(
        items.valueConflict({
          subject: id,
          field: "authorsShort",
          entityRefs: [manuscript(id)],
          claims: [
            { source: `${source}/PublicationId`, value: surname, valueSource: id, sourceRecordId: row.recordId },
            {
              source: `${source}/AuthorsShort`,
              value: lookupFold(authors),
              valueSource: authors,
              sourceRecordId: row.recordId,
            },
          ],
        }),
      );
    }
  }

  /**
   * Compares the link between a study and its publication, which each file states for itself.
   * Where the two disagree both values are kept, and the manuscript keeps what its own row says.
   */
  #publicationLinks(): void {
    const { items } = this.#context;
    for (const row of this.#rows("replications")) {
      const studyId = this.#studyOfRow.get(row.rowKey);
      if (studyId === undefined) continue;
      const named = cellText(row, "PublicationId");
      const naming = this.#publicationsOfStudy.get(studyId) ?? [];
      if (named === null ? naming.length === 0 : naming.length === 1 && naming[0]?.id === named) continue;
      this.#builder.item(
        items.valueConflict({
          subject: studyId,
          field: "publication",
          entityRefs: [replication(studyId)],
          claims: [
            {
              source: `${SOURCE_KEY}/replications`,
              value: named ?? "",
              valueSource: named ?? "",
              sourceRecordId: row.recordId,
            },
            ...naming.map((entry) => ({
              source: `${SOURCE_KEY}/publications`,
              value: entry.id,
              valueSource: entry.id,
              sourceRecordId: entry.row.recordId,
            })),
          ],
        }),
      );
    }
  }

  /** Accounts for every listed file: it belongs to a record, or it goes to review. */
  #repositoryFiles(): void {
    const portraits = new Set(this.#rows("people").flatMap((row) => cellText(row, "HeadShotFilename") ?? []));
    for (const [file, row] of this.#files) {
      const name = file.slice(file.lastIndexOf("/") + 1);
      const belongs = file.startsWith("assets/images/headshots/")
        ? portraits.has(name)
        : file.startsWith("assets/") && this.#publicationIds.has(name.replace(/\.pdf(\.png)?$/, ""));
      if (belongs) {
        this.#builder.rawOnly(row.recordId, "fileOfARecord");
        continue;
      }
      // A file with no record, or a page of a record that was committed although the build writes it.
      this.#builder.item(
        this.#context.items.annotationReview({
          subject: `${SOURCE_KEY}/${FILES_TAB}/${shortHash(file)}`,
          claims: [
            { source: `${SOURCE_KEY}/${FILES_TAB}`, value: file, valueSource: file, sourceRecordId: row.recordId },
          ],
        }),
      );
    }
  }
}

export const importer: ImporterDefinition = {
  key: "websiteData",
  sourceKey: SOURCE_KEY,
  summary: "Public website data: replications, publications, the Core Team and the members.",
  inputDescription: "the `data` directory of the repository, which holds the four TSV files",
  read,
  plan: (context) => new WebsitePlan(context).build(),
};
