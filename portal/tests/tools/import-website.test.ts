// Integration tests of the importer of the public website data (source H) against the
// Firestore emulator. Most tests use the synthetic website fixture, in which every study,
// person and address is invented. The last group reads the four TSV files of this repository,
// which are public already: the files from which the public website is built.
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  COLLECTIONS,
  documentLinkSlotId,
  identityKeyId,
  importedAffiliationId,
  importedPersonId,
  institutionCandidateId,
  integrationMappingId,
  personEvidenceKey,
  replicationMembershipId,
  studyAliasId,
  vocabularyTermId,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { confirmAgreedLeads } from "../../tools/src/commands/confirm-agreed-leads";
import { migrateManuscriptIds } from "../../tools/src/commands/migrate-manuscript-ids";
import { createdFields } from "../../tools/src/import/context";
import { type WebsiteFixture, websiteFixture, writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import { PORTAL_ROOT } from "../support/emulators";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  itemCounts,
  reconciliationItems,
  recordApplied,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

function input(change: (fixture: WebsiteFixture) => void = () => {}): string {
  const fixture = websiteFixture();
  change(fixture);
  return writeWebsiteFixture(temporaryDirectory(), fixture);
}

const row = (rows: readonly Record<string, string>[], key: string, value: string) => {
  const found = rows.find((candidate) => candidate[key] === value);
  if (found === undefined) throw new Error(`The fixture holds no row with ${key} ${value}.`);
  return found;
};

const corePerson = (websiteId: string) => importedPersonId(personEvidenceKey.websitePeople(websiteId), TEST_HASH_KEY);
const member = (websiteId: string) => importedPersonId(personEvidenceKey.websiteMembers(websiteId), TEST_HASH_KEY);
const data = async (documentPath: string) => (await adminDb.doc(documentPath).get()).data();

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

describe("the website importer on the synthetic fixture", () => {
  it("creates a replication under its study identifier, with the public fields of its row", async () => {
    await run(website, input(), "apply");
    const gamma = await data("replications/AlphaGamma2002");
    expect(gamma).toMatchObject({
      programmeId: "eegmanylabs",
      studyKey: "AlphaGamma2002",
      originalAuthors: "Invented, & Authors",
      // The year is derived from a cell with a letter suffix, which stays as text in the source record.
      originalYear: 2002,
      originalTitle: "An invented study called AlphaGamma2002",
      // The DOI is kept as written, with its capitals and parentheses.
      originalDoi: "10.1000/INVENTED(2002)02",
      theme: "Conflict",
      psychConstruct: "conflict monitoring",
      publicStageNumber: 6,
      publicStageName: "data_collection",
      publicStageText: "IPA acquired. Data collection ongoing",
      signupUrl: "https://forms.example.org/alphagamma",
      signupActive: true,
      // No status is set from any signal of a source, and the leads are derived from confirmed memberships.
      statusKey: null,
      statusHistoryId: null,
      leadPersonIds: [],
      selectionStatus: "selected",
      citationStatus: "unverified",
      dataOrigin: "live",
      createdBy: "system:import",
      writeContext: { origin: "import", depth: 0 },
    });
    expect(gamma?.sourceRecordIds).toHaveLength(1);
    expect(gamma?.importedValues.originalDoi).toBe("10.1000/INVENTED(2002)02");
    // `done` in the sign-up column is a status and no address.
    const beta = await data("replications/AlphaBeta2001");
    expect(beta).toMatchObject({ signupActive: false });
    expect(beta).not.toHaveProperty("signupUrl");
    expect([...(await documentsOf("replications")).keys()].sort()).toEqual([
      "AlphaBeta2001",
      "AlphaGamma2002",
      "Delta1999",
      "EpsilonVanZeta2010",
      "EtaTheta2005",
      "Iota2004",
    ]);
  });

  it("writes the alias, the entry of the folded lookup and the DOI lookup of each replication", async () => {
    await run(website, input(), "apply");
    expect(await data(`replications/Delta1999/aliases/${studyAliasId("website", "Delta1999")}`)).toMatchObject({
      replicationId: "Delta1999",
      alias: "Delta1999",
      aliasFolded: "delta1999",
      scheme: "website",
      isCanonical: true,
    });
    expect(await data("studyAliasIndex/delta1999")).toMatchObject({ replicationIds: ["Delta1999"] });
    // The key of a DOI is its lower-case form, and the identifier holds its hash, never the DOI.
    const lookup = integrationMappingId("doi", "replication", "10.1000/invented(2002)02");
    expect(lookup).toMatch(/^doi__replication__[0-9a-f]{20}$/);
    expect(await data(`integrationMappings/${lookup}`)).toMatchObject({
      system: "doi",
      entityType: "replication",
      entityId: "AlphaGamma2002",
      externalId: "10.1000/invented(2002)02",
    });
    // A repository name on the data host that embeds the study identifier is an alias of its own scheme.
    const repository = "EEGManyLabs_Replication_AlphaBeta2001_Raw";
    expect(
      await data(`replications/AlphaBeta2001/aliases/${studyAliasId("dataRepository", repository)}`),
    ).toMatchObject({
      alias: repository,
      scheme: "dataRepository",
      isCanonical: false,
    });
    expect((await documentsOf("aliases", true)).size).toBe(6 + 2);
  });

  it("creates a person for each website identifier, with a keyed identifier that holds no name", async () => {
    await run(website, input(), "apply");
    const ada = await data(`persons/${corePerson("aexample")}`);
    expect(ada).toMatchObject({
      slug: "aexample",
      displayName: "Ada Example",
      countrySource: "Nowhereland",
      websitePersonId: "aexample",
      isCoreTeam: true,
      publicListing: "coreTeam",
      // The role tags, in the order in which the website lists them. They grant nothing.
      coreRoles: ["coordinator", "study_lead", "founder", "directors"],
      headshotFilename: "aexample.jpg",
      scholarUrl: "https://scholar.example.org/aexample",
      universityUrl: "https://university.example.org/staff/aexample",
      labUrl: "http://lab.example.org/",
      userId: null,
      claimedAt: null,
      laboratoryIds: [],
      replicationIds: [],
      dataOrigin: "live",
    });
    // No name is split into parts, and no country code is derived.
    expect(ada).not.toHaveProperty("givenName");
    expect(ada).not.toHaveProperty("countryCode");
    // A blank in the director column is read as "no", where the other flags use 0.
    expect((await data(`persons/${corePerson("bfictional")}`))?.coreRoles).toEqual(["study_lead"]);
    expect((await data(`persons/${corePerson("hnobody")}`))?.coreRoles).toEqual(["advisor", "spin-off", "contributor"]);
    expect(await data(`persons/${member("zoe-exemple")}`)).toMatchObject({
      slug: "zoe-exemple",
      displayName: "Zoë Exemple",
      isCoreTeam: false,
      publicListing: "member",
      coreRoles: [],
    });
    const people = await documentsOf("persons");
    expect(people.size).toBe(8 + 7);
    for (const id of people.keys()) expect(id).toMatch(/^p__[0-9a-f]{20}$/);
    // Every person is found again through the key of the website identifier, and the slug is reserved.
    const key = identityKeyId(
      "person",
      "websitePersonId",
      personEvidenceKey.websiteMembers("zoe-exemple"),
      TEST_HASH_KEY,
    );
    expect(await data(`identityKeys/${key}`)).toMatchObject({
      entityType: "person",
      keyKind: "websitePersonId",
      entityIds: [member("zoe-exemple")],
      status: "active",
    });
    expect(await data(`identityKeys/${identityKeyId("person", "slug", "zoe-exemple", TEST_HASH_KEY)}`)).toMatchObject({
      keyKind: "slug",
      entityIds: [member("zoe-exemple")],
    });
    expect((await documentsOf("identityKeys")).size).toBe(30);
  });

  it("keeps the affiliation text verbatim, and makes one institution candidate for each folded string", async () => {
    await run(website, input(), "apply");
    const id = corePerson("cinvented");
    expect(await data(`persons/${id}/affiliations/${importedAffiliationId("h", "people", 1)}`)).toMatchObject({
      personId: id,
      // One raw string, which is never split on `&` or on commas.
      affiliationSource: "Invented University & Example Hospital",
      isPrimary: true,
    });
    const zoe = await data(`persons/${member("zoe-exemple")}/affiliations/${importedAffiliationId("h", "members", 1)}`);
    expect(zoe?.affiliationSource).toBe("Département d’Exemples, Université de Nulle Part, Nowhereland");
    expect(zoe).not.toHaveProperty("institutionId");
    // Two people of the Core Team write the same string: one candidate, named by both rows.
    const shared = await data(`institutionCandidates/${institutionCandidateId("University of Nowhere")}`);
    expect(shared).toMatchObject({
      affiliationFolded: "universityofnowhere",
      affiliationsSource: ["University of Nowhere"],
      institutionId: null,
    });
    expect(shared?.sourceRecordIds).toHaveLength(2);
    // No institution and no laboratory is created by an importer.
    expect((await documentsOf("institutions")).size).toBe(0);
    expect((await documentsOf("laboratories")).size).toBe(0);
    expect((await documentsOf("participations")).size).toBe(0);
  });

  it("writes every lead for review, and confirms one under question 5 only once every lead-naming source is applied", async () => {
    await run(website, input(), "apply");
    const memberships = [...(await documentsOf("memberships", true))];
    expect(memberships).toHaveLength(6 + 1);
    const ada = corePerson("aexample");
    const adaLead = `replications/AlphaBeta2001/memberships/${replicationMembershipId(ada, "lead")}`;
    // The website is imported before the other sources that name leads, so it cannot tell that they agree: every
    // lead it names waits for review, and no basis of a confirmation is written.
    expect(await data(adaLead)).toMatchObject({
      replicationId: "AlphaBeta2001",
      personId: ada,
      role: "lead",
      isCurrent: true,
      reviewStatus: "needsReview",
    });
    expect(memberships.filter(([, membership]) => membership.reviewStatus === "confirmed")).toEqual([]);
    for (const [, membership] of memberships) expect(membership).not.toHaveProperty("confirmationBasis");

    // While a lead-naming source has no applied batch, the step of question 5 confirms nothing.
    expect(await confirmAgreedLeads(adminDb, { apply: true })).toMatchObject({
      waitingFor: ["a", "d", "f"],
      confirmed: [],
    });
    for (const sourceKey of ["a", "d", "f"]) await recordApplied(sourceKey);
    const agreed = await confirmAgreedLeads(adminDb, { apply: true });
    expect(agreed.confirmed).toHaveLength(5);
    expect(await data(adaLead)).toMatchObject({
      reviewStatus: "confirmed",
      confirmationBasis: {
        basis: "allSourcesAgree",
        sources: ["a", "d", "f", "h"],
        decision: {
          decidedBy: "programmeLead",
          decidedOn: "2026-11-13",
          reference: "docs/MIGRATION_PLAN.md, section 11, question 5",
        },
      },
    });
    // The basis is the provenance of a decision: no source row is named for it, and it is no imported value.
    const confirmed = await data(adaLead);
    expect(confirmed?.importedValues).not.toHaveProperty("confirmationBasis");
    expect(confirmed?.fieldSources).not.toHaveProperty("confirmationBasis");
    expect(confirmed?.importedValues?.reviewStatus).toBe("needsReview");
    // The people file marks a second lead for one study. Neither is chosen: both memberships need review (question 4).
    const delta = [...(await documentsOf("memberships", true))].filter(
      ([, membership]) => membership.replicationId === "Delta1999",
    );
    expect(delta.map(([, membership]) => [membership.personId, membership.reviewStatus]).sort()).toEqual(
      [
        [corePerson("cinvented"), "needsReview"],
        [corePerson("dimaginary"), "needsReview"],
      ].sort(),
    );
    for (const [, membership] of delta) expect(membership).not.toHaveProperty("confirmationBasis");
    expect(agreed.questioned).toContain("Delta1999");
    // A second run changes nothing, and a later website import leaves the confirmation as it is.
    expect((await confirmAgreedLeads(adminDb, { apply: true })).confirmed).toEqual([]);
    await run(website, input(), "apply");
    expect((await data(adaLead))?.reviewStatus).toBe("confirmed");
    const [item] = (await reconciliationItems()).filter((candidate) => candidate.kind === "conflictingLead");
    expect(item).toMatchObject({ status: "open", field: "lead" });
    expect(item?.entityRefs[0]).toEqual({ entityType: "replication", entityId: "Delta1999" });
    expect(
      item?.candidates.map((candidate: { valueSource: string; key: string }) => [
        candidate.key.split(":")[0],
        candidate.valueSource,
      ]),
    ).toEqual([
      ["h/replications", "Cy Invented"],
      ["h/people", "Cy Invented"],
      ["h/people", "Dee Imaginary"],
    ]);
    // No portal role is granted, and no login exists.
    expect((await documentsOf("roleAssignments")).size).toBe(0);
    expect((await documentsOf("access")).size).toBe(0);
  });

  it("creates no person and no membership from a lead whom the website names without a known identifier", async () => {
    const report = await run(
      website,
      input((fixture) => {
        const iota = row(fixture.replications, "StudyId", "Iota2004");
        iota.PersonId = "nosuchperson";
        iota.LeadFullName = "Nemo Unlisted";
        row(fixture.people, "PersonId", "gpretend").StudyId = "";
        row(fixture.people, "PersonId", "gpretend").LeadRole = "0";
      }),
      "apply",
    );
    expect(report.items.raise.candidateLink).toBe(1);
    expect((await documentsOf("persons")).size).toBe(15);
    expect(
      [...(await documentsOf("memberships", true)).values()].filter(
        (membership) => membership.replicationId === "Iota2004",
      ),
    ).toEqual([]);
    // The name stays where reviewers work: in the source record, in the queue item and in the change log of the batch.
    const restricted = ["sourceRecords/", "reconciliationItems/", "importBatches/"];
    const stored = JSON.stringify(
      [...(await allDocuments())].filter(
        ([documentPath]) => !restricted.some((prefix) => documentPath.startsWith(prefix)),
      ),
    );
    expect(stored).not.toContain("Nemo Unlisted");
  });

  it("creates a manuscript for each publication, with its links in named slots", async () => {
    await run(website, input(), "apply");
    const example = await data("manuscripts/web__Example2023");
    expect(example).toMatchObject({
      websitePublicationId: "Example2023",
      replicationId: "AlphaBeta2001",
      title: "An invented report called Example2023",
      kind: "stage1Rr",
      status: "inPrincipleAcceptance",
      statusHistoryId: null,
      journal: "ExampleArXiv",
      doi: "10.1000/invented.output.example2023",
      osfUrl: "https://osf.example.org/abcde/",
      authorsShort: "Example et al",
      scopeKeys: ["rep:AlphaBeta2001"],
    });
    expect(example?.publishedAt.toDate().toISOString()).toBe("2023-12-01T00:00:00.000Z");
    expect(await data("manuscripts/web__Sample2024")).toMatchObject({ kind: "stage1Rr", status: "underReview" });
    expect(await data("manuscripts/web__Kept2025")).toMatchObject({ kind: "article", status: "published" });
    // A programme-level output belongs to no replication.
    const programme = await data("manuscripts/web__Programme2022");
    expect(programme).toMatchObject({ kind: "preprint", status: "published", scopeKeys: ["programme"] });
    expect(programme).not.toHaveProperty("replicationId");
    expect(
      await data(
        `integrationMappings/${integrationMappingId("doi", "manuscript", "10.1000/invented.output.kept2025")}`,
      ),
    ).toMatchObject({
      entityType: "manuscript",
      entityId: "web__Kept2025",
    });

    const links = await documentsOf("documentLinks");
    const slot = (owner: string, name: string) => links.get(documentLinkSlotId(owner, name));
    expect([...links.keys()].filter((id) => id.startsWith("manuscript__web__Example2023__")).sort()).toEqual(
      ["code", "data", "data2", "osf", "pdf", "url"].map((name) => `manuscript__web__Example2023__${name}`),
    );
    expect(slot("manuscript__web__Example2023", "pdf")).toMatchObject({
      entityType: "manuscript",
      entityId: "web__Example2023",
      url: "https://eegmanylabs.org/assets/pdfs/Example2023.pdf",
      kind: "pdf",
      replicationId: "AlphaBeta2001",
      laboratoryId: null,
      scopeKeys: ["rep:AlphaBeta2001", "members"],
      restricted: false,
      accessStatus: "unknown",
    });
    expect(slot("replication__Delta1999", "signup")).toMatchObject({
      url: "https://forms.example.org/delta",
      entityType: "replication",
    });
    expect(slot("replication__AlphaBeta2001", "signup")).toBeUndefined();
    expect(slot("replication__AlphaBeta2001", "signupArchive")).toMatchObject({
      url: "https://forms.example.org/alphabeta",
    });
    expect(slot("replication__EtaTheta2005", "signupArchive")).toMatchObject({ kind: "form" });
    expect(links.size).toBe(4 + 6 + 5 + 5);
    // The website states too little for a dataset record, so none is written.
    expect((await documentsOf("datasets")).size).toBe(0);
  });

  it("collects the labels of the files as vocabulary terms: spellings that fold alike are one term", async () => {
    await run(website, input(), "apply");
    expect(await data(`vocabularyTerms/${vocabularyTermId("journal", "ExampleArXiv")}`)).toMatchObject({
      kind: "journal",
      name: "ExampleArXiv",
      labelsSource: ["ExampleArXiv", "Examplearxiv"],
      isDeprecated: false,
    });
    // The alias table maps one country spelling to another, and the term lists both.
    expect(await data(`vocabularyTerms/${vocabularyTermId("country", "United States")}`)).toMatchObject({
      name: "United States",
      labelsSource: ["USA", "United States"],
    });
    expect(await data(`vocabularyTerms/${vocabularyTermId("psychConstruct", "visual perception")}`)).toMatchObject({
      name: "visual perception",
    });
    expect(await data(`vocabularyTerms/${vocabularyTermId("publicStage", "4_stage1_prep")}`)).toMatchObject({
      labelsSource: ["4_stage1_prep", "Stage 1 Registered report in preparation"],
    });
    const kinds = new Set([...(await documentsOf("vocabularyTerms")).values()].map((term) => term.kind));
    expect([...kinds].sort()).toEqual(
      [
        "coreRole",
        "country",
        "creditRole",
        "exclusionReason",
        "journal",
        "psychConstruct",
        "publicStage",
        "publicationStatus",
        "publicationStatusText",
        "theme",
      ].sort(),
    );
  });

  it("queues what needs a person to decide, and chooses between no two values", async () => {
    const report = await run(website, input(), "apply");
    expect(await itemCounts()).toEqual({
      conflictingLead: 1,
      duplicatePerson: 2,
      linkDefect: 1,
      valueConflict: 4,
      vocabularyReview: 4,
      annotationReview: 3,
    });
    expect(report.blocking).toEqual([]);
    const items = await reconciliationItems();
    const about = (kind: string, field?: string) =>
      items
        .filter((item) => item.kind === kind && (field === undefined || item.field === field))
        .map((item) => JSON.stringify([item.entityRefs, item.candidates]));

    // The two files state the link between a study and its publication differently for two studies.
    const links = about("valueConflict", "publication");
    expect(links).toHaveLength(2);
    expect(links.join()).toContain("AlphaGamma2002");
    expect(links.join()).toContain("Gone2022");
    expect(links.join()).toContain("Kept2025");
    // The manuscript keeps what its own row says, and the study's cell stays in its source record.
    expect((await data("manuscripts/web__Kept2025"))?.replicationId).toBe("Delta1999");
    // A publication row that contradicts itself.
    expect(about("valueConflict", "publicationYear").join()).toContain("Kept2025");
    expect(about("valueConflict", "authorsShort").join()).toContain("Madeup2021");

    // Two entries that may be one person are reported and never merged.
    const pairs = items
      .filter((item) => item.kind === "duplicatePerson")
      .map((item) => item.entityRefs.map((ref: { entityId: string }) => ref.entityId).sort());
    expect(pairs.sort()).toEqual(
      [
        [corePerson("hnobody"), member("hal-j-nobody")].sort(),
        [corePerson("fnotreal"), member("faye-notreal")].sort(),
      ].sort(),
    );
    expect((await documentsOf("persons")).size).toBe(15);

    const review = items
      .filter((item) => item.kind === "vocabularyReview")
      .map((item) => item.candidates.map((candidate: { valueSource: string }) => candidate.valueSource));
    expect(review.map((values) => values.join(" / ")).sort()).toEqual([
      "EW",
      "Mockup Institute",
      "Personality / conflict monitoring",
      "USA",
    ]);
    expect(about("linkDefect").join()).toContain("EtaTheta2005");
    const files = items
      .filter((item) => item.kind === "annotationReview")
      .map((item) => item.candidates[0].valueSource);
    expect(files.sort()).toEqual([
      "assets/images/headshots/zformer.jpg",
      "assets/pdfs/Orphan2020.pdf",
      "content/people/aexample.md",
    ]);
  });

  it("accounts for every row of every file, and passes its verification", async () => {
    const source = input();
    const report = await run(website, source, "apply");
    expect(
      report.tabs.map((tab) => [tab.tabKey, tab.rows.header, tab.rows.data, tab.imported, tab.queued, tab.unaccounted]),
    ).toEqual([
      ["replications", 1, 6, 6, 0, 0],
      ["publications", 1, 5, 5, 0, 0],
      ["people", 1, 8, 8, 0, 0],
      ["members", 1, 7, 7, 0, 0],
      ["files", 0, 7, 1, 3, 0],
    ]);
    expect(report.tabs.at(-1)?.rawOnly).toEqual({ fileOfARecord: 3 });
    expect((await verify(website, source)).filter((check) => !check.passed)).toEqual([]);
    expect(await schemaProblems()).toEqual([]);
  });

  it("reads a file with blank lines and without the repository around it", async () => {
    const source = input((fixture) => {
      fixture.files = [];
      fixture.members.push({});
    });
    const report = await run(website, source, "apply");
    expect(report.tabs.map((tab) => tab.tabKey)).toEqual(["replications", "publications", "people", "members"]);
    expect(report.tabs.at(-1)?.rows).toMatchObject({ data: 7, blank: 1 });
    expect((await documentsOf("documentLinks")).has("manuscript__web__Example2023__pdf")).toBe(false);
  });
});

describe("the website importer when the files change", () => {
  const blocked = async (change: (fixture: WebsiteFixture) => void, check: string) => {
    const source = input(change);
    const preview = await run(website, source, "preview");
    expect(preview.blocking.map((entry) => entry.check)).toEqual([check]);
    expect(preview).toMatchObject({ status: "previewed", changesCommitted: 1 });
    // The item that explains the block is written at once, so that a reviewer can act on it.
    expect(await itemCounts()).toEqual({ structureChange: 1 });
    const applied = await run(website, source, "apply");
    expect(applied.status).toBe("failed");
    // The rows are captured as source records, and nothing else is written.
    expect(
      (await documentsOf("replications")).size +
        (await documentsOf("persons")).size +
        (await documentsOf("manuscripts")).size,
    ).toBe(0);
    expect(Object.values(applied.tabs[0]?.rawOnly ?? {}).reduce((sum, count) => sum + count, 0)).toBe(
      applied.tabs[0]?.rows.data,
    );
    return applied;
  };

  it("refuses to import when a column is reordered, because the first column is the key of the public site", async () => {
    const source = temporaryDirectory();
    const fixture = websiteFixture();
    writeWebsiteFixture(source, fixture);
    const lines = readFileSync(path.join(source, "data", "members.tsv"), "utf8").split("\n");
    lines[0] = "PersonId\tSequenceNumber\tFullName\tAffiliation\tCountry";
    writeFileSync(path.join(source, "data", "members.tsv"), lines.join("\n"));
    const preview = await run(website, path.join(source, "data"), "preview");
    expect(preview.blocking).toEqual([expect.objectContaining({ check: "header" })]);
    const [item] = await reconciliationItems();
    expect(item).toMatchObject({ kind: "structureChange", status: "open" });
    expect(item?.candidates.map((candidate: { valueSource: string }) => candidate.valueSource)).toEqual([
      "SequenceNumber | PersonId | FullName | Affiliation | Country",
      "PersonId | SequenceNumber | FullName | Affiliation | Country",
    ]);
    expect((await documentsOf("persons")).size).toBe(0);
  });

  it("stops and reports when a double quote appears, when a key is used twice, and when a file is missing", async () => {
    await blocked((fixture) => {
      row(fixture.replications, "StudyId", "Iota2004").Title = 'An invented study with a "quoted" word';
    }, "quote");
    await freshDatabase();
    await blocked((fixture) => {
      fixture.replications.push({ ...row(fixture.replications, "StudyId", "Iota2004") });
    }, "key");
    await freshDatabase();
    const source = input();
    rmSync(path.join(source, "publications.tsv"));
    expect((await run(website, source, "preview")).blocking.map((entry) => entry.check)).toEqual(["file"]);
  });

  it("stops when the lookup data is missing, because a replication would refer to no programme", async () => {
    await adminDb.doc(COLLECTIONS.programmes.docPath("eegmanylabs")).delete();
    const report = await run(website, input(), "apply");
    expect(report.blocking.map((entry) => entry.check)).toEqual(["lookups"]);
    expect((await documentsOf("replications")).size).toBe(0);
  });

  it("writes a manuscript only at its namespaced identifier, and moves one of an earlier import first", async () => {
    await run(website, input(), "apply");
    // An earlier import wrote the manuscript at the bare publication identifier, with a link in
    // a named slot of that owner. The regression of docs/SECURITY.md: a client could take an
    // identifier of that form before the importer wrote it.
    const moved = adminDb.doc("manuscripts/web__Example2023");
    const original = (await moved.get()).data() ?? {};
    const pdfLink = adminDb.doc("documentLinks/manuscript__web__Example2023__pdf");
    const linkData = (await pdfLink.get()).data() ?? {};
    await adminDb.doc("manuscripts/Example2023").set(original);
    await adminDb.doc("documentLinks/manuscript__Example2023__pdf").set({ ...linkData, entityId: "Example2023" });
    await moved.delete();
    await pdfLink.delete();

    await expect(run(website, input(), "apply")).rejects.toThrow(/migrate:manuscript-ids/);

    const dryRun = await migrateManuscriptIds(adminDb, { apply: false });
    expect(dryRun.moved).toEqual(["Example2023 -> web__Example2023"]);
    expect((await documentsOf("manuscripts")).has("Example2023")).toBe(true);

    const applied = await migrateManuscriptIds(adminDb, { apply: true });
    expect(applied.moved).toEqual(["Example2023 -> web__Example2023"]);
    const manuscripts = await documentsOf("manuscripts");
    expect(manuscripts.has("Example2023")).toBe(false);
    expect(manuscripts.get("web__Example2023")).toMatchObject({ websitePublicationId: "Example2023" });
    const links = await documentsOf("documentLinks");
    expect(links.has("manuscript__Example2023__pdf")).toBe(false);
    expect(links.get("manuscript__web__Example2023__pdf")).toMatchObject({ entityId: "web__Example2023" });
    // A second run finds nothing to move, and the import runs again without a second manuscript.
    expect(await migrateManuscriptIds(adminDb, { apply: true })).toEqual({ moved: [], refused: [], rewritten: 0 });
    await run(website, input(), "apply");
    expect([...(await documentsOf("manuscripts")).keys()].filter((id) => id.endsWith("Example2023"))).toEqual([
      "web__Example2023",
    ]);
  });

  it("creates no second manuscript when a publication identifier is renamed, and asks a reviewer", async () => {
    await run(website, input(), "apply");
    const renamed = input((fixture) => {
      row(fixture.publications, "PublicationId", "Sample2024").PublicationId = "Sample2025";
    });
    const report = await run(website, renamed, "apply");
    expect([...(await documentsOf("manuscripts")).keys()].sort()).toEqual([
      "web__Example2023",
      "web__Kept2025",
      "web__Madeup2021",
      "web__Programme2022",
      "web__Sample2024",
    ]);
    expect(report.tabs.find((tab) => tab.tabKey === "publications")).toMatchObject({ imported: 4, queued: 1 });
    // The two rows differ in their identifier alone, so one item names both, and the manuscript of the earlier row.
    const renames = (await reconciliationItems()).filter((item) => item.kind === "missingFromSource");
    expect(
      renames.some(
        (item) =>
          JSON.stringify(item.candidates).includes("h/publications/renamedTo") &&
          JSON.stringify(item.entityRefs).includes("Sample2024"),
      ),
    ).toBe(true);
  });

  it("creates no second manuscript either when the renamed row has changed in other cells, by its study and its DOI", async () => {
    await run(website, input(), "apply");
    const renamed = input((fixture) => {
      const sample = row(fixture.publications, "PublicationId", "Sample2024");
      sample.PublicationId = "Sample2025";
      sample.StatusText = "Stage 1 accepted";
    });
    const report = await run(website, renamed, "apply");
    expect((await documentsOf("manuscripts")).has("web__Sample2025")).toBe(false);
    expect(report.tabs.find((tab) => tab.tabKey === "publications")).toMatchObject({ imported: 4, queued: 1 });
    // More than the identifier differs, so the importer itself recognises the manuscript and names the new identifier.
    const renames = (await reconciliationItems()).filter((item) => item.kind === "missingFromSource");
    expect(
      renames.some(
        (item) =>
          JSON.stringify(item.candidates).includes("Sample2025") &&
          JSON.stringify(item.entityRefs).includes("Sample2024"),
      ),
    ).toBe(true);
  });

  it("never changes the status of a manuscript by itself: a new status on the website becomes a question", async () => {
    await run(website, input(), "apply");
    const accepted = input((fixture) => {
      row(fixture.publications, "PublicationId", "Sample2024").StatusText = "Stage 1 accepted";
    });
    const report = await run(website, accepted, "apply");
    expect((await data("manuscripts/web__Sample2024"))?.status).toBe("underReview");
    expect(report.items.raise).toMatchObject({ statusQuestion: 1 });
    const [item] = (await reconciliationItems()).filter((candidate) => candidate.kind === "statusQuestion");
    expect(item?.candidates.map((candidate: { valueSource: string }) => candidate.valueSource)).toEqual([
      "underReview",
      "Stage 1 accepted",
    ]);
  });

  it("creates no manuscript from a status that the table of statuses does not hold", async () => {
    const report = await run(
      website,
      input((fixture) => {
        row(fixture.publications, "PublicationId", "Programme2022").Status = "stage2";
      }),
      "apply",
    );
    expect((await documentsOf("manuscripts")).has("web__Programme2022")).toBe(false);
    expect(report.tabs.find((tab) => tab.tabKey === "publications")).toMatchObject({ imported: 4, queued: 1 });
    expect((await itemCounts()).vocabularyReview).toBe(5);
  });

  it("never renames an existing replication: a row that resolves to it through an alias goes to review", async () => {
    await run(website, input(), "apply");
    // A reviewer has recorded another spelling of the identifier of one study: an alias and its entry in the lookup.
    const standard = { ...createdFields(Timestamp.now()), schemaVersion: 1 };
    await adminDb.doc(`replications/Delta1999/aliases/${studyAliasId("programme", "Zeta2011")}`).set({
      ...standard,
      replicationId: "Delta1999",
      alias: "Zeta2011",
      aliasFolded: "zeta2011",
      scheme: "programme",
      isCanonical: false,
    });
    await adminDb.doc("studyAliasIndex/zeta2011").set({ ...standard, replicationIds: ["Delta1999"] });
    const report = await run(
      website,
      input((fixture) => {
        fixture.replications.push({
          ...row(fixture.replications, "StudyId", "Delta1999"),
          StudyId: "Zeta2011",
          Doi: "10.1000/invented.2011.07",
        });
      }),
      "apply",
    );
    expect((await documentsOf("replications")).has("Zeta2011")).toBe(false);
    expect(report.items.raise.unmatchedIdentifier).toBe(1);
    expect(report.tabs[0]).toMatchObject({ imported: 6, queued: 1 });
  });

  it("resolves an identifier with a lower-case initial or a diacritic to the study it folds to, and creates no second study", async () => {
    await run(website, input(), "apply");
    const before = [...(await documentsOf("replications")).keys()].sort();
    for (const spelling of ["delta1999", "Déltá1999"]) {
      const report = await run(
        website,
        input((fixture) => {
          row(fixture.replications, "StudyId", "Delta1999").StudyId = spelling;
        }),
        "apply",
      );
      // The row keeps its key, because the key is the fold of the identifier. It is one revision more of the same row.
      expect(report.tabs[0], spelling).toMatchObject({ imported: 6, queued: 0 });
      // The spelling is an alias for a reviewer to confirm. No identifier goes unmatched.
      expect(report.items.raise.aliasConfirmation, spelling).toBe(1);
      expect(report.items.raise.unmatchedIdentifier, spelling).toBeUndefined();
      expect([...(await documentsOf("replications")).keys()].sort(), spelling).toEqual(before);
      const alias = await data(`replications/Delta1999/aliases/${studyAliasId("website", spelling)}`);
      expect(alias, spelling).toMatchObject({ alias: spelling, aliasFolded: "delta1999", isCanonical: false });
    }
    // A spelling that folds to no study and has not the shape of an identifier names nothing and creates nothing.
    const odd = await run(
      website,
      input((fixture) => {
        fixture.replications.push({ ...row(fixture.replications, "StudyId", "Delta1999"), StudyId: "omicron2012" });
      }),
      "apply",
    );
    expect((await documentsOf("replications")).has("omicron2012")).toBe(false);
    expect(odd.items.raise.unmatchedIdentifier).toBe(1);
  });

  it("marks the first lead for review too when a second lead appears later, and writes nothing for an identifier it cannot read", async () => {
    await run(website, input(), "apply");
    for (const sourceKey of ["a", "d", "f"]) await recordApplied(sourceKey);
    await confirmAgreedLeads(adminDb, { apply: true });
    const gus = replicationMembershipId(corePerson("gpretend"), "lead");
    expect((await data(`replications/Iota2004/memberships/${gus}`))?.reviewStatus).toBe("confirmed");
    expect((await data(`replications/Iota2004/memberships/${gus}`))?.confirmationBasis?.sources).toEqual([
      "a",
      "d",
      "f",
      "h",
    ]);
    const report = await run(
      website,
      input((fixture) => {
        const hal = row(fixture.people, "PersonId", "hnobody");
        hal.StudyId = "Iota2004";
        hal.LeadRole = "1";
        fixture.members.push({
          SequenceNumber: "8",
          PersonId: "not a slug",
          FullName: "Mal Formed",
          Affiliation: "",
          Country: "",
        });
      }),
      "apply",
    );
    expect((await data(`replications/Iota2004/memberships/${gus}`))?.reviewStatus).toBe("needsReview");
    // The sources no longer agree, so the basis of the confirmation goes with it.
    expect(await data(`replications/Iota2004/memberships/${gus}`)).not.toHaveProperty("confirmationBasis");
    expect(report.items.raise).toMatchObject({ conflictingLead: 1, unparsedValue: 1 });
    expect((await documentsOf("persons")).size).toBe(15);
  });
});

describe("the website importer on the public files of this repository", () => {
  const repositoryData = path.join(PORTAL_ROOT, "..", "data");
  const lines = (file: string) =>
    readFileSync(path.join(repositoryData, file), "utf8")
      .split(/\r\n|\n|\r/)
      .slice(1)
      .filter((line) => line.replaceAll("\t", "") !== "").length;
  const sha = (file: string) =>
    createHash("sha256")
      .update(readFileSync(path.join(repositoryData, file)))
      .digest("hex")
      .slice(0, 16);
  /** Whether the four files are still those of 9 November 2026, whose counts docs/MIGRATION_PLAN.md states. */
  const isBaseline =
    sha("replications.tsv") === "e904e664013ef892" &&
    sha("publications.tsv") === "b8b8c2d8105c0891" &&
    sha("people.tsv") === "4c5a0c51bc661da6" &&
    sha("members.tsv") === "62592ded80d962d2";

  it("imports every row, verifies, and writes nothing on a second run", async () => {
    const preview = await run(website, repositoryData, "preview");
    expect(preview.blocking).toEqual([]);
    const applied = await run(website, repositoryData, "apply", { previewBatchId: preview.batchId });
    expect(applied.status).toBe("applied");
    const counts = {
      replications: lines("replications.tsv"),
      publications: lines("publications.tsv"),
      people: lines("people.tsv"),
      members: lines("members.tsv"),
    };
    for (const tab of applied.tabs.filter((candidate) => candidate.tabKey !== "files")) {
      expect([tab.tabKey, tab.rows.data, tab.unaccounted]).toEqual([
        tab.tabKey,
        counts[tab.tabKey as keyof typeof counts],
        0,
      ]);
      expect(tab.imported + tab.queued + Object.values(tab.rawOnly).reduce((sum, count) => sum + count, 0)).toBe(
        tab.rows.data,
      );
    }
    expect((await verify(website, repositoryData)).filter((check) => !check.passed)).toEqual([]);
    expect(await schemaProblems()).toEqual([]);

    const before = await allDocuments();
    const second = await run(website, repositoryData, "apply");
    expect(second).toMatchObject({ documentsWritten: 0, changesCommitted: 0 });
    expect(differences(before, await allDocuments())).toEqual({
      created: [COLLECTIONS.importBatches.docPath(second.batchId)],
      removed: [],
      rewritten: [],
    });
    // No identifier of a document holds a name or an address, and no log entry of a batch quotes a cell.
    const names = new Set([...(await documentsOf("persons")).values()].map((entry) => entry.displayName as string));
    for (const documentPath of before.keys()) {
      expect(documentPath).not.toContain("@");
      for (const name of names) expect(documentPath.includes(name)).toBe(false);
    }
  });

  it.skipIf(!isBaseline)("reproduces the counts of the baseline of 9 November 2026", async () => {
    const applied = await run(website, repositoryData, "apply");
    expect(applied.tabs.slice(0, 4).map((tab) => [tab.tabKey, tab.rows.data, tab.imported])).toEqual([
      ["replications", 23, 23],
      ["publications", 18, 18],
      ["people", 46, 46],
      ["members", 300, 300],
    ]);
    expect((await documentsOf("replications")).size).toBe(23);
    const manuscripts = [...(await documentsOf("manuscripts")).values()];
    expect([manuscripts.length, manuscripts.filter((entry) => entry.replicationId !== undefined).length]).toEqual([
      18, 14,
    ]);
    const people = [...(await documentsOf("persons")).values()];
    expect([
      people.filter((entry) => entry.isCoreTeam).length,
      people.filter((entry) => !entry.isCoreTeam).length,
    ]).toEqual([46, 300]);
    // 23 named leads and 6 further leads whom only the people file marks. Every one needs review until the other
    // lead-naming sources have been applied, and for those 6 studies a question about the lead is raised (counted below).
    const memberships = [...(await documentsOf("memberships", true)).values()];
    expect(memberships).toHaveLength(29);
    expect(memberships.filter((entry) => entry.reviewStatus === "needsReview")).toHaveLength(29);
    expect((await documentsOf("institutionCandidates")).size).toBe(203);
    expect((await documentsOf("aliases", true)).size).toBe(23 + 3);
    expect((await documentsOf("integrationMappings")).size).toBe(23 + 18);
    expect(await itemCounts()).toMatchObject({
      // 4 studies whose link to a publication the two files state differently, and 3 inconsistent publication rows.
      valueConflict: 7,
      conflictingLead: 6,
      duplicatePerson: 2,
      linkDefect: 1,
      // 6 files: a PDF and a preview without a record, 2 portraits without a person, 2 committed pages.
      annotationReview: 6,
    });
    const review = (await reconciliationItems()).filter((item) => item.kind === "vocabularyReview");
    // 1 country alias in use, 2 themes paired with a construct that names another theme, and the affiliation tails.
    expect(review.filter((item) => item.field === "theme")).toHaveLength(2);
    expect(review.filter((item) => item.field === undefined)).toHaveLength(1);
    const tails = review.filter((item) => item.field === "Affiliation");
    const rows = tails.reduce((sum, item) => sum + item.candidates.length, 0);
    // 17 rows end in no country at all, and 49 end in a country spelling that the alias table lacks.
    expect(rows).toBe(17 + 49);
  });
});
