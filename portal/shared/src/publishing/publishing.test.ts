// Synthetic people, studies and laboratories. Every name, identifier and address here is invented,
// and the addresses use the example.org domain.
import { describe, expect, it } from "vitest";
import { PUBLIC_FIELDS, publicProjection } from "./allow-list";
import { diffWebsiteFile } from "./diff";
import { generateWebsiteFiles, type PublicInputs } from "./generate";
import { privacyFindings } from "./guard";
import { parseTsv, serialiseTsv } from "./tsv";

const MEMBERS =
  "SequenceNumber\tPersonId\tFullName\tAffiliation\tCountry\n1\tada\tAda Synthetic\tOld Institute\tFrance\n2\tbo\tBo Invented\tNowhere University\tSpain\n";
const PEOPLE =
  "PersonId\tFullName\tHeadShotFilename\tAffiliation\tCountry\tStudyId\tSpinOffId\tLeadRole\tSpinOffRole\tCoordinatorRole\tAdvisorRole\tCoInvestigatorRole\tOtherRole\tDirectorRole\tScholarUrl\tUniUrl\tLabUrl\r\ncy\tCy Core\tcy.jpg\tCore Institute\tItaly\t\t\t0\t0\t1\t0\t0\t\t0\t\t\t\n";
const REPLICATIONS =
  "StudyId\tPublicationId\tLeadFullName\tTheme\tLongStageText\tStageNumber\tStageName\tPersonId\tAuthors\tPublicationYear\tTitle\tReference\tDoi\tPsychConstruct\tSignupUrl\tSignUpActive\tallSignUpLinks\nAlpha2001\t\tAda Synthetic\tAttention\tPlanning\t2\tplanning\tada\t\t2001\tA title\t\t\tattention\thttps://forms.example.org/a\t1\thttps://forms.example.org/a\nGamma2003\t\t\tMemory\tFinished\t9\tfinished\t\t\t2003\tAnother\t\t\tmemory\tdone\t0\t";
const PUBLICATIONS =
  "PublicationId\tReplicationId\tURLs\tStatus\tStatusText\tJournal\tAuthorsShort\tPublicationYear\tDatePublishedNumber\tOSF\tDataUrl\tData2Url\tCode\tDOI\tTitle\r\nAlpha2024\tAlpha2001\t\tstage1\tStage 1 under review\tSynthetic Journal\tSynthetic\t2024\t20240101\t\t\t\t\t10.5555/alpha\tStage 1 of Alpha";

const base = { members: MEMBERS, people: PEOPLE, replications: REPLICATIONS, publications: PUBLICATIONS };

function inputs(overrides: Partial<PublicInputs> = {}): PublicInputs {
  return {
    persons: [],
    replications: [],
    laboratories: [],
    participations: [],
    manuscripts: [],
    summaries: [],
    ...overrides,
  };
}

const ALL = { origins: ["live", "importedHistorical"] as const };

describe("the TSV model", () => {
  it.each([
    ["LF without a final newline", "a\tb\n1\t2\n3\t4"],
    ["CRLF with LF alone on the last line", "a\tb\r\n1\t2\r\n3\t4\n"],
    ["LF with a final newline", "a\tb\n1\t2\n"],
    ["a blank line in the middle", "a\tb\n1\t2\n\n3\t4\n"],
    ["an empty file", ""],
  ])("writes back %s byte for byte", (_label, text) => {
    expect(serialiseTsv(parseTsv(text))).toBe(text);
  });

  it("gives an added line the usual ending and keeps the file's own last ending", () => {
    const table = parseTsv("a\tb\r\n1\t2\r\n3\t4\n");
    const text = serialiseTsv({ ...table, lines: [...table.lines, { cells: ["5", "6"], ending: null }] });
    expect(text).toBe("a\tb\r\n1\t2\r\n3\t4\r\n5\t6\n");
  });
});

describe("the allow-list", () => {
  it("takes the public fields of a record by name and nothing else, including a field added later", () => {
    const projected = publicProjection("person", "person-1", {
      displayName: "Ada Synthetic",
      publicListing: "member",
      archivedAt: null,
      dataOrigin: "live",
      privateNotes: "PRIVATE-NOTE-MARKER",
      email: "ada.synthetic@example.org",
      genderCategory: "PRIVATE-GENDER-MARKER",
      custom: { phone: "PRIVATE-PHONE-MARKER" },
      addedNextYear: "PRIVATE-NEW-FIELD-MARKER",
    });
    expect(projected).toEqual({
      id: "person-1",
      archived: false,
      dataOrigin: "live",
      displayName: "Ada Synthetic",
      publicListing: "member",
    });
  });

  it("leaves out a value of the wrong shape rather than coercing it", () => {
    const projected = publicProjection("replication", "Alpha2001", {
      studyKey: "Alpha2001",
      publicStageNumber: "seven",
      archivedAt: null,
    });
    expect(projected).not.toHaveProperty("publicStageNumber");
  });

  it("names no field that a private or special document holds", () => {
    const named = Object.values(PUBLIC_FIELDS).flat() as string[];
    for (const field of [
      "emails",
      "privateNotes",
      "postalAddress",
      "genderCategory",
      "ethnicityCategory",
      "internalNotes",
      "address",
      "custom",
    ]) {
      expect(named).not.toContain(field);
    }
  });
});

describe("the generator", () => {
  it("changes nothing when the portal states nothing", () => {
    const { files } = generateWebsiteFiles(base, inputs(), {
      outputs: ["members", "replications", "publications"],
      ...ALL,
    });
    expect(files.members).toBe(MEMBERS);
    expect(files.people).toBe(PEOPLE);
    expect(files.replications).toBe(REPLICATIONS);
    expect(files.publications).toBe(PUBLICATIONS);
  });

  it("updates the listed members, removes one who withdrew, adds a new one and keeps unknown values", () => {
    const persons = [
      publicProjection("person", "p-ada", {
        websitePersonId: "ada",
        displayName: "Ada Synthetic",
        affiliationSummary: "New Institute",
        publicListing: "member",
        archivedAt: null,
        dataOrigin: "live",
      }),
      publicProjection("person", "p-bo", { websitePersonId: "bo", publicListing: "none", archivedAt: null }),
      publicProjection("person", "p-di", {
        slug: "di-new",
        displayName: "Di New",
        affiliationSummary: "Fresh College",
        countrySource: "Portugal",
        publicListing: "member",
        archivedAt: null,
        dataOrigin: "live",
      }),
    ];
    const { files, notes } = generateWebsiteFiles(base, inputs({ persons }), { outputs: ["members"], ...ALL });
    expect(files.members).toBe(
      "SequenceNumber\tPersonId\tFullName\tAffiliation\tCountry\n1\tada\tAda Synthetic\tNew Institute\tFrance\n3\tdi-new\tDi New\tFresh College\tPortugal\n",
    );
    expect(notes.join(" ")).toContain("bo is no longer listed");
  });

  it("leaves a member who is also in the core team file out of the members file", () => {
    const persons = [
      publicProjection("person", "p-cy", {
        websitePersonId: "cy",
        displayName: "Cy Core",
        publicListing: "coreTeam",
        archivedAt: null,
      }),
    ];
    const withCy = { ...base, members: `${MEMBERS}3\tcy\tCy Core\tCore Institute\tItaly\n` };
    const { files } = generateWebsiteFiles(withCy, inputs({ persons }), { outputs: ["members"], ...ALL });
    expect(files.people).toContain("cy\tCy Core\tcy.jpg");
    expect(files.members).toBe(MEMBERS);
  });

  it("writes the public stage and the closed sign-up of a replication in the site's own spelling", () => {
    const replications = [
      publicProjection("replication", "Alpha2001", {
        studyKey: "Alpha2001",
        publicStageNumber: 6,
        publicStageName: "data_collection",
        publicStageText: "Data collection ongoing",
        signupActive: false,
        archivedAt: null,
        dataOrigin: "live",
      }),
      publicProjection("replication", "Beta2002", {
        studyKey: "Beta2002",
        theme: "Error",
        publicStageName: "stage1_prep",
        archivedAt: null,
        dataOrigin: "live",
      }),
      // A new replication without a stage the website knows would be a card that no filter finds.
      publicProjection("replication", "Delta2004", {
        studyKey: "Delta2004",
        theme: "Error",
        archivedAt: null,
        dataOrigin: "live",
      }),
    ];
    const { files, notes } = generateWebsiteFiles(base, inputs({ replications }), {
      outputs: ["replications"],
      ...ALL,
    });
    const table = parseTsv(files.replications ?? "");
    expect(table.lines.map((line) => line.cells[0])).toEqual(["Alpha2001", "Beta2002", "Gamma2003"]);
    expect(notes.join(" ")).toContain("Delta2004");
    expect(table.lines[0]?.cells.slice(3, 7)).toEqual(["Attention", "Data collection ongoing", "6", "data_collection"]);
    expect(table.lines[0]?.cells.slice(14, 17)).toEqual(["done", "0", "https://forms.example.org/a"]);
    expect(files.replications?.endsWith("\t")).toBe(true);
  });

  it("never publishes an archived, projected or demonstration record unless demonstration data is allowed", () => {
    const laboratories = [
      publicProjection("laboratory", "lab-1", {
        slug: "lab-one",
        name: "Lab One",
        status: "active",
        archivedAt: null,
        dataOrigin: "demo",
      }),
      publicProjection("laboratory", "lab-2", {
        slug: "lab-two",
        name: "Lab Two",
        status: "active",
        archivedAt: { seconds: 1 },
        dataOrigin: "live",
      }),
      publicProjection("laboratory", "lab-3", {
        slug: "lab-three",
        name: "Lab Three",
        status: "active",
        archivedAt: null,
        dataOrigin: "projected",
      }),
    ];
    const live = generateWebsiteFiles(base, inputs({ laboratories }), { outputs: ["laboratories"], ...ALL });
    expect(live.files.laboratories).toBe("LaboratoryId\tName\tDepartment\tCity\tCountry\tWebsite\tStudyIds\n");
    const synthetic = generateWebsiteFiles(base, inputs({ laboratories }), {
      outputs: ["laboratories"],
      origins: ["live", "demo"],
    });
    expect(synthetic.files.laboratories).toContain("lab-one\tLab One");
    expect(synthetic.files.laboratories).not.toContain("Lab Three");
  });

  it("writes aggregate recruitment with an unknown count left empty, never zero", () => {
    const summaries = [
      publicProjection("summary", "Alpha2001__recruitment", {
        replicationId: "Alpha2001",
        totals: { labReported: { main: { tested: 40 }, rest: { usable: 12 } } },
        reporting: { labReported: { main: { tested: 3 }, rest: { usable: 2 } } },
        latestAsOfDate: "2026-10-31",
        archivedAt: null,
      }),
    ];
    const { files } = generateWebsiteFiles(base, inputs({ summaries }), { outputs: ["recruitment"], ...ALL });
    expect(files.recruitment).toBe(
      "StudyId\tBasis\tModality\tTested\tUsable\tParticipationsReporting\tAsOfDate\nAlpha2001\tlabReported\tmain\t40\t\t3\t2026-10-31\nAlpha2001\tlabReported\trest\t\t12\t2\t2026-10-31\n",
    );
  });
});

describe("figures that would point at one laboratory or a status not reached", () => {
  it("leave out recruitment that only one participation reports, and say so", () => {
    const summaries = [
      publicProjection("summary", "Alpha2001__recruitment", {
        replicationId: "Alpha2001",
        totals: { labReported: { main: { tested: 18 }, rest: { tested: 30 } } },
        reporting: { labReported: { main: { tested: 1 }, rest: { tested: 2 } } },
        latestAsOfDate: "2026-10-31",
        archivedAt: null,
      }),
    ];
    const { files, notes } = generateWebsiteFiles(base, inputs({ summaries }), { outputs: ["recruitment"], ...ALL });
    expect(files.recruitment).toBe(
      "StudyId\tBasis\tModality\tTested\tUsable\tParticipationsReporting\tAsOfDate\nAlpha2001\tlabReported\trest\t30\t\t2\t2026-10-31\n",
    );
    expect(notes.join(" ")).toContain("Alpha2001");
  });

  it("announce a Stage 1 acceptance only for a report whose status says it was accepted", () => {
    const manuscript = (id: string, status: string) =>
      publicProjection("manuscript", id, {
        replicationId: "Alpha2001",
        kind: "stage1Rr",
        status,
        acceptedAt: "2026-01-15",
        title: "Stage 1 of Alpha",
        archivedAt: null,
        dataOrigin: "live",
      });
    const { files } = generateWebsiteFiles(
      base,
      inputs({ manuscripts: [manuscript("planned-1", "planned"), manuscript("accepted-1", "inPrincipleAcceptance")] }),
      { outputs: ["milestones"], ...ALL },
    );
    expect(files.milestones).toBe("StudyId\tMilestone\tDate\tPublicationId\nAlpha2001\tstage1Accepted\t2026-01-15\t\n");
  });
});

describe("the difference", () => {
  it("shows each changed cell with its column, and added and removed rows", () => {
    const after =
      "SequenceNumber\tPersonId\tFullName\tAffiliation\tCountry\n1\tada\tAda Synthetic\tNew Institute\tFrance\n3\tdi\tDi New\tFresh College\tPortugal\n";
    const diff = diffWebsiteFile(MEMBERS, after, "PersonId");
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 0 });
    expect(diff.rows.find((row) => row.kind === "changed")).toEqual({
      key: "ada",
      kind: "changed",
      fields: [{ column: "Affiliation", before: "Old Institute", after: "New Institute" }],
    });
    expect(diff.rows.find((row) => row.kind === "removed")?.key).toBe("bo");
  });

  it("reports no row change for a reordered file and marks a new file as created", () => {
    const reordered =
      "SequenceNumber\tPersonId\tFullName\tAffiliation\tCountry\n2\tbo\tBo Invented\tNowhere University\tSpain\n1\tada\tAda Synthetic\tOld Institute\tFrance\n";
    expect(diffWebsiteFile(MEMBERS, reordered, "PersonId").rows).toEqual([]);
    const created = diffWebsiteFile(null, "A\tB\nx\ty\n", "A|B");
    expect(created.created).toBe(true);
    expect(created.counts.added).toBe(1);
  });
});

describe("the privacy guard", () => {
  it("finds an email-shaped text and a planted private value, and names the line only", () => {
    const findings = privacyFindings({ "data/members.tsv": "a\tb\nx\tsomeone@example.org\ny\tPRIVATE-MARKER-1\n" }, [
      "PRIVATE-MARKER-1",
    ]);
    expect(findings).toEqual([
      { path: "data/members.tsv", line: 2, kind: "emailShaped" },
      { path: "data/members.tsv", line: 3, kind: "privateValue" },
    ]);
  });
});
