// What the rules guarantee across collections, beside the registry-driven matrix: the shape of
// an identifier that a client may choose, the freeze of an archived record, the verbatim source
// values of an imported record, the agreement of the value checks with the shared schemas, and
// the room that the largest write of each collection needs within the 1000 expressions that a
// request may evaluate. The red-team tests in ./redteam attack single rules. These tests hold
// every block of the rules file to the same principles, so that the next block is held to them too.
// Fixtures are synthetic: fictitious accounts, people, studies and laboratories on the example.org domain.
import {
  COLLECTION_ENTRIES,
  COLLECTIONS,
  type CollectionEntry,
  type CollectionKey,
  isoDateSchema,
  replicationMembershipId,
  replicationScopeKey,
  urlSchema,
  verbatimSourceFields,
} from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, serverTimestamp } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outcomeOf } from "./attempts";
import { FIXTURES, type Fixture } from "./fixtures";
import { grantsFor } from "./policy";
import { expectOutcomes, requestsOf } from "./requests";
import { fixtureOf, pathOf, seedWorld, storedDocument, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  autoId,
  CALLERS,
  type CallerKind,
  MEMBER_PERSON,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  STORED_AT,
  stored,
  uidOfCaller,
} from "./world";

let environment: RulesTestEnvironment;
const { get, create, createAt, update } = requestsOf(() => environment);

const REPLICATION = `replications/${OWN_REPLICATION}`;
const LABORATORY = `laboratories/${OWN_LABORATORY}`;
const PARTICIPATION = `participations/${OWN_PARTICIPATION}`;
const PERSON = `persons/${OWNER_PERSON}`;
const REPLICATION_KEY = replicationScopeKey(OWN_REPLICATION);

const text = (length: number) => "x".repeat(length);

/** Writes documents with the rules switched off, as trusted code would. */
async function plant(documents: Readonly<Record<string, Record<string, unknown>>>): Promise<void> {
  const { doc, setDoc } = await import("firebase/firestore");
  await trusted(environment, async (db) => {
    await Promise.all(Object.entries(documents).map(([path, data]) => setDoc(doc(db, path), data)));
  });
}

/** The first of the given callers whom the registry lets perform a write on a record of an entry. */
function writerOf(
  entry: CollectionEntry,
  operation: "create" | "update",
  fixture: Fixture,
  candidates: readonly CallerKind[] = ["admin", "owner", "member"],
): CallerKind {
  const known = operation === "create" ? (fixture.create?.subject ?? fixture.subject) : fixture.subject;
  const writer = candidates.find((kind) => grantsFor(entry, operation, CALLERS[kind], known).length > 0);
  if (writer === undefined) throw new Error(`Nobody of the world may ${operation} a document of ${entry.key}.`);
  return writer;
}

/** Fails when a document that the rules accepted is no document of its schema. */
async function expectStoredMatches(entry: CollectionEntry, path: string): Promise<void> {
  const document = await storedDocument(environment, path);
  expect(document, path).not.toBeNull();
  const parsed = entry.schema.safeParse(document);
  expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join(".")), path).toEqual([]);
}

const expectSchemaAccepts = (key: CollectionKey, path: string) => expectStoredMatches(COLLECTIONS[key], path);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-hardening");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

const enforced = COLLECTION_ENTRIES.filter((entry) => entry.enforcement === "enforced");

describe("the identifier of a record that a client creates, where the data model calls it opaque", () => {
  const opaque = enforced.filter(
    (entry) =>
      entry.identifier.kind === "auto" &&
      entry.write.mode === "client" &&
      entry.write.grants.some((grant) => grant.operations.includes("create")),
  );

  it("is asked of every collection that importers and clients both write to", () => {
    expect(opaque.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "documentLinks",
        "manuscripts",
        "contributors",
        "contributorTables",
        "personAffiliations",
      ]),
    );
    expect(opaque.length).toBeGreaterThanOrEqual(12);
  });

  it.each(opaque.map((entry) => [entry.key, entry] as const))(
    "%s: is an identifier that Firestore generated, and no name of the client's choosing",
    async (key, entry) => {
      const fixture = fixtureOf(key);
      const creation = fixture?.create;
      if (fixture === undefined || creation === undefined)
        throw new Error(`The fixture of ${key} creates no document.`);
      const writer = writerOf(entry, "create", fixture);
      const data = creation.data(uidOfCaller(writer as Exclude<CallerKind, "signedOut">));
      const at = (identifier: string) => pathOf(entry, [...creation.ids.slice(0, -1), identifier]);
      await expectOutcomes({
        "a readable name": ["denied", createAt(writer, at("a-readable-name"), data)],
        "the identifier of a publication on the public website": [
          "denied",
          createAt(writer, at("Synthetic2027"), data),
        ],
        "an identifier with the separator of derived identifiers": [
          "denied",
          createAt(writer, at("replication__SyntheticStudy2002__signup"), data),
        ],
        "twenty characters with an underscore among them": [
          "denied",
          createAt(writer, at("AbCdEfGhIj_lMnOpQrSt"), data),
        ],
        "nineteen letters and digits": ["denied", createAt(writer, at("AbCdEfGhIjKlMnOpQrS"), data)],
        "twenty-one letters and digits": ["denied", createAt(writer, at("AbCdEfGhIjKlMnOpQrStU"), data)],
        "twenty letters and digits": ["allowed", createAt(writer, at("AbCdEfGhIjKlMnOpQrSt"), data)],
      });
    },
  );
});

describe("an archived record", () => {
  const admin = uidOfCaller("admin");
  const lead = uidOfCaller("ownLead");
  const coordinator = uidOfCaller("ownCoordinator");
  const archivedBy = (uid: string) => ({ archivedAt: STORED_AT, updatedBy: uid });

  it("is frozen, and is restored only by whoever archived it or by the programme", async () => {
    await plant({ [REPLICATION]: { ...FIXTURES.replications?.seed, ...archivedBy(admin) } });
    await expectOutcomes({
      "the lead edits a replication that an administrator archived": [
        "denied",
        update("ownLead", REPLICATION, { shortTitle: "Rewritten after it was withdrawn" }),
      ],
      "the lead restores it": ["denied", update("ownLead", REPLICATION, { archivedAt: null })],
      "the lead archives it again, at another time": [
        "denied",
        update("ownLead", REPLICATION, { archivedAt: serverTimestamp() }),
      ],
      "the core team edits it while it is archived": [
        "denied",
        update("coreTeam", REPLICATION, { shortTitle: "Rewritten by the core team" }),
      ],
      "the core team restores it and changes it in one request": [
        "denied",
        update("coreTeam", REPLICATION, { archivedAt: null, shortTitle: "Restored and renamed" }),
      ],
      "the core team restores it": ["allowed", update("coreTeam", REPLICATION, { archivedAt: null })],
      "the lead edits it once it is restored": ["allowed", update("ownLead", REPLICATION, { shortTitle: "Renamed" })],
    });
  });

  it("is restored by the account that archived it, which the record names", async () => {
    await expectOutcomes({
      "the lead archives its replication": [
        "allowed",
        update("ownLead", REPLICATION, { archivedAt: serverTimestamp() }),
      ],
    });
    expect((await storedDocument(environment, REPLICATION))?.updatedBy).toBe(lead);
    await expectOutcomes({
      "the lead edits it while it is archived": ["denied", update("ownLead", REPLICATION, { shortTitle: "Renamed" })],
      "the lead restores it and renames it in one request": [
        "denied",
        update("ownLead", REPLICATION, { archivedAt: null, shortTitle: "Renamed" }),
      ],
      "the lead restores it": ["allowed", update("ownLead", REPLICATION, { archivedAt: null })],
    });
  });

  it("stays the owner's to restore among the documents beneath a user", async () => {
    const favourite = pathOf(COLLECTIONS.userFavourites, FIXTURES.userFavourites?.ids ?? []);
    await expectOutcomes({
      "the owner archives a favourite": ["allowed", update("owner", favourite, { archivedAt: serverTimestamp() })],
      "the owner restores it": ["allowed", update("owner", favourite, { archivedAt: null })],
    });
  });

  it("returns a confirmed member entry of a laboratory to its unit only through the programme", async () => {
    const entry = `${LABORATORY}/members/${OWNER_PERSON}`;
    await expectOutcomes({
      "the coordinator archives a confirmed entry": [
        "allowed",
        update("ownCoordinator", entry, { archivedAt: serverTimestamp() }),
      ],
    });
    expect((await storedDocument(environment, entry))?.updatedBy).toBe(coordinator);
    await expectOutcomes({
      // The coordinator archived the entry, and still does not restore it as confirmed: a
      // confirmed entry gives the coordinator sight of the contact details of the person.
      "the coordinator restores it as it was": ["denied", update("ownCoordinator", entry, { archivedAt: null })],
      "the coordinator restores it as ended": [
        "denied",
        update("ownCoordinator", entry, { archivedAt: null, status: "ended" }),
      ],
      "the coordinator restores it as a proposal in another role": [
        "denied",
        update("ownCoordinator", entry, { archivedAt: null, status: "proposed", role: "pi" }),
      ],
      "an administrator restores it as it was": ["allowed", update("admin", entry, { archivedAt: null })],
    });
    await plant({ [entry]: { ...FIXTURES.laboratoryMembers?.seed, ...archivedBy(admin) } });
    await expectOutcomes({
      "the coordinator puts an entry that an administrator archived forward again": [
        "allowed",
        update("ownCoordinator", entry, { archivedAt: null, status: "proposed" }),
      ],
    });
  });

  it("returns a confirmed membership of a replication to its unit only through the programme", async () => {
    const confirmed = `${REPLICATION}/memberships/${replicationMembershipId(OWNER_PERSON, "member")}`;
    const proposed = `${REPLICATION}/memberships/${replicationMembershipId(MEMBER_PERSON, "analyst")}`;
    await plant({
      [proposed]: {
        ...FIXTURES.replicationMemberships?.seed,
        personId: MEMBER_PERSON,
        role: "analyst",
        reviewStatus: "needsReview",
      },
    });
    await expectOutcomes({
      "the lead archives a confirmed membership": [
        "allowed",
        update("ownLead", confirmed, { archivedAt: serverTimestamp() }),
      ],
      "the lead restores the confirmed membership that it archived": [
        "denied",
        update("ownLead", confirmed, { archivedAt: null }),
      ],
      "the core team restores it": ["allowed", update("coreTeam", confirmed, { archivedAt: null })],
      "the lead archives a membership that awaits review": [
        "allowed",
        update("ownLead", proposed, { archivedAt: serverTimestamp() }),
      ],
      "the lead restores the membership that awaits review": [
        "allowed",
        update("ownLead", proposed, { archivedAt: null }),
      ],
    });
  });
});

describe("a value that an import took verbatim from a source", () => {
  const withVerbatim = enforced.filter(
    (entry) =>
      entry.write.mode === "client" &&
      entry.write.grants.some((grant) => grant.onlyFields === null && grant.operations.includes("update")) &&
      verbatimSourceFields(entry).length > 0,
  );

  /** Another value of the type that the field holds. */
  const anotherValue = (field: string): unknown => {
    if (field === "affiliationSlotsSource") return { "1": "Another value" };
    if (field === "sameAsSource" || field === "labelsSource") return ["Another value"];
    return "Another value";
  };

  it("is kept in six collections that clients write to", () => {
    expect(withVerbatim.map((entry) => entry.key).sort()).toEqual([
      "contributors",
      "personAffiliations",
      "persons",
      "replicationHypotheses",
      "replications",
      "vocabularyTerms",
    ]);
  });

  it.each(withVerbatim.map((entry) => [entry.key, entry] as const))(
    "%s: is changed by nobody on a document that an import wrote, and stays editable on one made in the portal",
    async (key, entry) => {
      const fixture = fixtureOf(key);
      if (fixture === undefined) throw new Error(`No fixture for ${key}.`);
      const path = pathOf(entry, fixture.ids);
      const writer = writerOf(entry, "update", fixture);
      const fields = verbatimSourceFields(entry);
      const changes = (label: string) =>
        Object.fromEntries(
          fields.map((field) => [`${label}: ${field}`, update(writer, path, { [field]: anotherValue(field) })]),
        );
      // The document as an import left it: it names the source rows behind it.
      await plant({ [path]: { ...fixture.seed, sourceRecordIds: ["source-record-1"] } });
      await expectOutcomes(
        Object.fromEntries(Object.entries(changes("imported")).map(([label, request]) => [label, ["denied", request]])),
      );
      await expectOutcomes({
        "imported: a field that is no verbatim source value": [
          "allowed",
          update(writer, path, fixture.update?.(uidOfCaller(writer as Exclude<CallerKind, "signedOut">)) ?? {}),
        ],
      });
      // The same document as the portal made it.
      await plant({ [path]: fixture.seed });
      await expectOutcomes(
        Object.fromEntries(
          Object.entries(changes("made here")).map(([label, request]) => [label, ["allowed", request]]),
        ),
      );
      await expectStoredMatches(entry, path);
    },
  );
});

describe("a value check of the rules", () => {
  it("accepts exactly the calendar dates that the shared schema accepts", async () => {
    const path = `${PERSON}/affiliations/affiliation-1`;
    const dates = [
      "2024-02-29",
      "2023-02-29",
      "2000-02-29",
      "1900-02-29",
      "2026-04-30",
      "2026-04-31",
      "2026-12-31",
      "2026-13-01",
      "2026-00-10",
      "2026-01-00",
      "2026-1-1",
      "26-01-01",
      "2026-01-01T00:00:00Z",
      " 2026-01-01",
      "2026-01-01\n",
      "the day before yesterday",
      "",
    ];
    for (const date of dates) {
      const allowed = (await outcomeOf(update("owner", path, { startDate: date }))) === "allowed";
      expect(allowed, JSON.stringify(date)).toBe(isoDateSchema.safeParse(date).success);
    }
  });

  it("accepts no web address that the shared schema refuses, and every ordinary one", async () => {
    const ordinary = [
      "https://example.org",
      "https://example.org/",
      "http://example.org/a/b?c=d&e=f#g",
      "https://sub.example.org:8080/path",
      "HTTPS://EXAMPLE.ORG/Path",
      "https://example.org/a%20b",
      `https://example.org/${text(2_000)}`,
    ];
    const doubtful = [
      "javascript:alert(1)",
      "ftp://example.org/file",
      "https:example.org",
      "https://",
      "https:// example.org",
      "https://exa mple.org/",
      "https://example.org/a b",
      "//example.org",
      "example.org",
      "data:text/html,x",
      "https://example.org\n",
      `https://example.org/${text(2_040)}`,
      "",
    ];
    for (const address of ordinary) {
      expect(urlSchema.safeParse(address).success, address.slice(0, 60)).toBe(true);
      expect(await outcomeOf(update("owner", PERSON, { labUrl: address })), address.slice(0, 60)).toBe("allowed");
    }
    for (const address of doubtful) {
      const allowed = (await outcomeOf(update("owner", PERSON, { labUrl: address }))) === "allowed";
      // Whatever the rules accept, the schema accepts too.
      if (allowed) expect(urlSchema.safeParse(address).success, JSON.stringify(address.slice(0, 60))).toBe(true);
      expect(allowed, JSON.stringify(address.slice(0, 60))).toBe(false);
    }
  });

  it("holds the values of custom properties to plain values under keys that split no field path", async () => {
    const custom = (value: unknown) => update("ownCoordinator", LABORATORY, { custom: value });
    await expectOutcomes({
      "texts, numbers, booleans and null": [
        "allowed",
        custom({ room: "B12", booths: 2, gain: 0.5, shielded: true, note: null }),
      ],
      "no value at all": ["allowed", custom({})],
      "a value of 10,000 characters": ["allowed", custom({ note: text(10_000) })],
      "values of 10,001 characters between them": ["denied", custom({ note: text(10_000), more: "x" })],
      "a value of 900,000 characters": ["denied", custom({ note: text(900_000) })],
      "a list as a value": ["denied", custom({ rooms: ["B12"] })],
      "a map as a value": ["denied", custom({ room: { number: 12 } })],
      "a key with a full stop": ["denied", custom({ "room.number": 12 })],
      "a key with a slash": ["denied", custom({ "room/number": 12 })],
      "a key of 301 characters": ["denied", custom({ [text(301)]: 1 })],
      "five hundred and one values": [
        "denied",
        custom(Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`k${index}`, 1]))),
      ],
      "a text in place of the map": ["denied", custom("none")],
      "a list in place of the map": ["denied", custom([])],
    });
    await expectSchemaAccepts("laboratories", LABORATORY);
  });

  it("holds a list of texts to texts, each within its cap", async () => {
    const roles = (value: unknown) => update("coreTeam", PERSON, { coreRoles: value });
    const domains = (value: unknown) => update("coreTeam", "institutions/institution-1", { emailDomains: value });
    await expectOutcomes({
      "fifty roles": ["allowed", roles(Array.from({ length: 50 }, (_, index) => `Role ${index}`))],
      "fifty-one roles": ["denied", roles(Array.from({ length: 51 }, (_, index) => `Role ${index}`))],
      "a role of 300 characters": ["allowed", roles([text(300)])],
      "a role of 301 characters": ["denied", roles(["Chair", text(301)])],
      "an empty role": ["denied", roles(["Chair", ""])],
      "a number among the roles": ["denied", roles(["Chair", 7])],
      "a boolean among the roles": ["denied", roles([true])],
      "a map among the roles": ["denied", roles([{ title: "Chair" }])],
      "a role with a line break": ["denied", roles(["Chair\nTreasurer"])],
      "a text in place of the list": ["denied", roles("Chair")],
      "no role": ["allowed", roles([])],
      "two domains": ["allowed", domains(["example.org", "sub.example.org"])],
      "a domain of two characters": ["denied", domains(["ab"])],
      "a number among the domains": ["denied", domains(["example.org", 44])],
      "fifty-one domains": ["denied", domains(Array.from({ length: 51 }, (_, index) => `d${index}.example.org`))],
    });
    await expectSchemaAccepts("persons", PERSON);
    await expectSchemaAccepts("institutions", "institutions/institution-1");
  });
});

describe("the largest write of a collection", () => {
  // A request evaluates 1000 rule expressions at most, and every check of a field costs some of
  // them whether the field is there or not. Each write below sets every field that its writer
  // may set, as the member of the programme who pays most for being recognised, and must still
  // be accepted: a rule that grew beyond the limit would refuse the honest writer.

  it("fits for a replication, whose definition holds the most fields", async () => {
    const definition = {
      shortTitle: "Synthetic study",
      originalAuthors: "Synthetic, A., and Example, B.",
      originalYear: 2001,
      originalTitle: "A synthetic effect",
      originalReference: "Synthetic, A., and Example, B. (2001). A synthetic effect. Journal of Examples, 1, 1-10.",
      originalDoi: "10.1000/synthetic.2001",
      abstract: text(100_000),
      rationale: "Why the effect matters.",
      effectOfInterest: "The difference between two conditions.",
      plainLanguageDescription: "What the study is about, in plain words.",
      originalN: 24,
      originalNSource: "n = 24",
      originalStatistics: "t(23) = 2.5, p = .02",
      originalEffectSizeSource: "d = 0.51",
      originalEffectSizeValue: 0.51,
      originalEffectSizeMetric: "Cohen's d",
      originalBayesFactorSource: "BF10 = 3.2",
      powerAssumptions: "Ninety per cent power for half the original effect.",
      powerBasedN: 340,
      powerBasedNSource: "340",
      targetN: 400,
      durationSource: "90 minutes",
      sampleType: "Students",
      minEegChannels: 32,
      minEegChannelsSource: "at least 32",
      extraEquipment: "None.",
      studyType: "Event-related potential",
      outcome: "The amplitude of a component.",
      psychConstruct: "Synthetic construct",
      theme: "Synthetic theme",
      signupUrl: "https://example.org/sign-up",
      signupActive: true,
      custom: { room: "B12", booths: 2, shielded: true },
    };
    await expectOutcomes({
      "every field at once, by the lead": ["allowed", update("ownLead", REPLICATION, definition)],
      "every field at once, by the core team": [
        "allowed",
        update("coreTeam", REPLICATION, { ...definition, shortTitle: "Synthetic study, again", targetN: 401 }),
      ],
      "every field removed again, by an administrator": [
        "allowed",
        update(
          "admin",
          REPLICATION,
          Object.fromEntries(Object.keys(definition).map((field) => [field, field === "custom" ? {} : deleteField()])),
        ),
      ],
    });
    await expectSchemaAccepts("replications", REPLICATION);
  });

  it("fits for a new replication, which holds its identity alone", async () => {
    const fresh = FIXTURES.replications?.create?.data("") ?? {};
    const at = (studyKey: string) => `replications/${studyKey}`;
    const withKey = (studyKey: string, fields: Record<string, unknown> = {}) => ({ ...fresh, studyKey, ...fields });
    await expectOutcomes({
      "a definition from the start": [
        "denied",
        create("coreTeam", at("SyntheticStudy2005"), withKey("SyntheticStudy2005", { targetN: 400 })),
      ],
      "a public stage from the start": [
        "denied",
        create("admin", at("SyntheticStudy2005"), withKey("SyntheticStudy2005", { publicStageNumber: 1 })),
      ],
      "a verified citation from the start": [
        "denied",
        create("admin", at("SyntheticStudy2005"), withKey("SyntheticStudy2005", { citationStatus: "verified" })),
      ],
      "a withdrawn selection from the start": [
        "denied",
        create("admin", at("SyntheticStudy2005"), withKey("SyntheticStudy2005", { selectionStatus: "withdrawn" })),
      ],
      "a link to a vocabulary term from the start": [
        "denied",
        create(
          "admin",
          at("SyntheticStudy2005"),
          withKey("SyntheticStudy2005", { vocabulary: [{ termId: "term-1", relation: "construct" }] }),
        ),
      ],
      "custom values from the start": [
        "denied",
        create("admin", at("SyntheticStudy2005"), withKey("SyntheticStudy2005", { custom: { room: "B12" } })),
      ],
      "its identity, by the core team": [
        "allowed",
        create("coreTeam", at("SyntheticStudy2005"), withKey("SyntheticStudy2005")),
      ],
    });
    await expectSchemaAccepts("replications", at("SyntheticStudy2005"));
  });

  it("fits for a hypothesis, a protocol version and an equipment requirement", async () => {
    const hypothesis = {
      text: text(102_400),
      expectedEffect: text(10_000),
      outcomeMeasure: "The amplitude of a component.",
      analysisSpecification: "A linear mixed model.",
      preregistrationUrl: "https://example.org/preregistration",
      originalStatistics: "t(23) = 2.5",
      nullSigSource: "sig",
      analysisStatus: "completed",
      resultSummary: "The synthetic effect was found.",
      studyDescriptionUrl: "https://example.org/study-description",
      infosheetUrl: "https://example.org/information-sheet",
    };
    const core = uidOfCaller("coreTeam");
    const version = `${REPLICATION}/protocolVersions/${autoId("versionFull")}`;
    await expectOutcomes({
      "a new hypothesis with every field, by the lead": [
        "allowed",
        create("ownLead", `${REPLICATION}/hypotheses/h07`, {
          ...hypothesis,
          replicationId: OWN_REPLICATION,
          hypothesisNumber: "7",
          scientificReviewStatus: "unverified",
          resultReviewedBy: null,
          resultReviewedAt: null,
        }),
      ],
      "every field of a hypothesis and its review, by the core team": [
        "allowed",
        update("coreTeam", `${REPLICATION}/hypotheses/h01`, {
          ...hypothesis,
          scientificReviewStatus: "verified",
          resultReviewedBy: core,
          resultReviewedAt: serverTimestamp(),
        }),
      ],
      "a new protocol version with every field, by the core team": [
        "allowed",
        create("coreTeam", version, {
          replicationId: OWN_REPLICATION,
          protocolId: "protocol-1",
          versionLabel: "3.0",
          effectiveDate: "2026-03-01",
          status: "approved",
          changeSummary: text(10_000),
          documentLinkId: "link-1",
          approvedBy: core,
          approvedAt: serverTimestamp(),
        }),
      ],
      "a new requirement with every field, by the core team": [
        "allowed",
        create("coreTeam", `${REPLICATION}/equipmentRequirements/eye-tracker`, {
          replicationId: OWN_REPLICATION,
          requirementKey: "eye-tracker",
          operator: "equals",
          value: "Any model",
          isMandatory: true,
          note: text(10_000),
        }),
      ],
    });
    await expectSchemaAccepts("replicationHypotheses", `${REPLICATION}/hypotheses/h07`);
    await expectSchemaAccepts("replicationHypotheses", `${REPLICATION}/hypotheses/h01`);
    await expectSchemaAccepts("replicationProtocolVersions", version);
  });

  it("fits for a participation and its private detail", async () => {
    const everything = {
      localLeadPersonId: OWNER_PERSON,
      targetNMain: 1_000_000,
      targetNRest: 0,
      protocolId: "protocol-1",
      protocolVersionId: "version-1",
      equipmentConfigurationId: "configuration-1",
      signedUpAt: serverTimestamp(),
      readinessStatus: "approved",
      custom: { room: "B12", booths: 2 },
    };
    const core = uidOfCaller("coreTeam");
    await expectOutcomes({
      "every field of a participation, by the core team": ["allowed", update("coreTeam", PARTICIPATION, everything)],
      "every field of the private detail and its approval, by the core team": [
        "allowed",
        update("coreTeam", `${PARTICIPATION}/private/detail`, {
          ethicsStatus: "approved",
          ethicsReference: text(300),
          ethicsApprovedAt: serverTimestamp(),
          trainingStatus: "completed",
          readinessApprovedBy: core,
          readinessApprovedAt: serverTimestamp(),
          equipmentOverrideJustification: text(10_000),
          notes: text(10_000),
        }),
      ],
    });
    await expectSchemaAccepts("participations", PARTICIPATION);
    await expectSchemaAccepts("participationDetail", `${PARTICIPATION}/private/detail`);
  });

  it("fits for a manuscript, an event, a contributor table and a contributor", async () => {
    const manuscript = `manuscripts/${autoId("manuscriptFull")}`;
    const event = `manuscripts/manuscript-1/events/${autoId("eventFull")}`;
    const contributor = `contributors/${autoId("contributorFull")}`;
    const table = `contributorTables/${autoId("tableFull")}`;
    const roles = [
      "conceptualization",
      "dataCuration",
      "formalAnalysis",
      "fundingAcquisition",
      "investigation",
      "methodology",
      "projectAdministration",
      "resources",
      "software",
      "supervision",
      "validation",
      "visualization",
      "writingOriginalDraft",
      "writingReviewEditing",
    ];
    await expectOutcomes({
      "a new manuscript with every field, by the core team": [
        "allowed",
        create("coreTeam", manuscript, {
          replicationId: OWN_REPLICATION,
          title: text(1_000),
          kind: "stage2Rr",
          status: "planned",
          statusHistoryId: null,
          journal: "Journal of Synthetic Results",
          doi: "10.1000/synthetic.2026",
          preprintDoi: "10.31234/osf.io/synth",
          osfUrl: "https://example.org/osf/synth",
          authorsShort: "Synthetic et al.",
          submittedAt: serverTimestamp(),
          acceptedAt: serverTimestamp(),
          publishedAt: serverTimestamp(),
          custom: { round: 2 },
          scopeKeys: [REPLICATION_KEY],
        }),
      ],
      "a new event with every field, by the core team": [
        "allowed",
        create("coreTeam", event, {
          manuscriptId: "manuscript-1",
          kind: "decision",
          round: 100,
          occurredAt: serverTimestamp(),
          dueAt: serverTimestamp(),
          outcome: "majorRevision",
          summary: text(10_000),
          documentLinkIds: Array.from({ length: 500 }, (_, index) => `link-${index}`),
          replicationId: OWN_REPLICATION,
          laboratoryId: null,
          scopeKeys: [REPLICATION_KEY],
        }),
      ],
      "a new contributor table with every field, by the core team": [
        "allowed",
        create("coreTeam", table, {
          replicationId: OWN_REPLICATION,
          sourceKey: "F",
          isOnlySignupTable: false,
          isPublished: true,
          publicationUrl: "https://example.org/contributors",
          pdfUrl: "https://example.org/contributors.pdf",
          scopeKeys: [REPLICATION_KEY],
        }),
      ],
      "a new contributor with every field, by the core team": [
        "allowed",
        create("coreTeam", contributor, {
          firstNameSource: "Example",
          middleNameSource: "",
          surnameSource: "Contributor",
          orderInPublication: 100_000,
          affiliationSource: "Synthetic University",
          affiliationSlotsSource: Object.fromEntries(
            Array.from({ length: 9 }, (_, index) => [String(index + 1), `Affiliation ${index + 1}`]),
          ),
          orcid: "0000-0002-1825-0097",
          creditRoles: Object.fromEntries(roles.map((role, index) => [role, index % 2 === 0 ? true : "x"])),
          agreementSource: "Yes",
          reviewStatus: "confirmed",
          replicationId: OWN_REPLICATION,
          manuscriptId: "manuscript-1",
          contributorTableId: "table-1",
          personId: OWNER_PERSON,
          scopeKeys: [REPLICATION_KEY],
        }),
      ],
      "every field of that contributor again, by the core team": [
        "allowed",
        update("coreTeam", contributor, {
          firstNameSource: "Another",
          surnameSource: "Name",
          orderInPublication: 1,
          affiliationSource: "Example Institute",
          affiliationSlotsSource: { "1": "Example Institute" },
          orcid: "",
          creditRoles: { software: 1 },
          agreementSource: "No",
          reviewStatus: "needsReview",
          manuscriptId: null,
          personId: MEMBER_PERSON,
        }),
      ],
    });
    await expectSchemaAccepts("manuscripts", manuscript);
    await expectSchemaAccepts("manuscriptEvents", event);
    await expectSchemaAccepts("contributorTables", table);
    await expectSchemaAccepts("contributors", contributor);
  });

  it("fits for the directory record of a person and for a laboratory", async () => {
    await expectOutcomes({
      "every field of a person, by the core team": [
        "allowed",
        update("coreTeam", PERSON, {
          givenName: "Synthetic",
          middleName: "Q.",
          familyName: "Owner",
          displayName: text(300),
          countryCode: "GB",
          countrySource: " United Kingdom ",
          isCoreTeam: true,
          publicListing: "coreTeam",
          coreRoles: Array.from({ length: 50 }, (_, index) => `Role ${index}`),
          headshotFilename: "synthetic-owner.jpg",
          scholarUrl: "https://example.org/scholar",
          universityUrl: "https://example.org/university",
          labUrl: "https://example.org/laboratory",
          custom: { office: "B12", floor: 2 },
        }),
      ],
      "every field of a laboratory, by the core team": [
        "allowed",
        update("coreTeam", LABORATORY, {
          name: text(300),
          institutionId: "institution-1",
          department: "Department of Examples",
          countryCode: "GB",
          city: "Example Town",
          website: "https://example.org/laboratory",
          piPersonId: OWNER_PERSON,
          status: "inactive",
          description: text(10_000),
          custom: { booths: 2, shielded: true },
        }),
      ],
    });
    await expectSchemaAccepts("persons", PERSON);
    await expectSchemaAccepts("laboratories", LABORATORY);
  });

  it("fits for a checklist template of fifteen items, which are checked one by one", async () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ key: `step-${index + 1}`, label: `Step ${index + 1}` }));
    const template = (list: unknown) => ({ key: "synthetic-template", items: list });
    const path = "checklistTemplates/synthetic-template";
    await expectOutcomes({
      "sixteen items": ["denied", create("coreTeam", path, template(items(16)))],
      "no item": ["denied", create("coreTeam", path, template([]))],
      "a number among the items": ["denied", create("coreTeam", path, template([...items(3), 42]))],
      "a text among the items": ["denied", create("coreTeam", path, template([...items(14), "ab"]))],
      "an item with a third key": [
        "denied",
        create("coreTeam", path, template([...items(2), { key: "step-3", label: "Step 3", required: true }])),
      ],
      "an item without a label": ["denied", create("coreTeam", path, template([...items(2), { key: "step-3" }]))],
      "an item whose key holds a full stop": [
        "denied",
        create("coreTeam", path, template([...items(2), { key: "step.3", label: "Step 3" }])),
      ],
      "an item with a label of 301 characters": [
        "denied",
        create("coreTeam", path, template([...items(2), { key: "step-3", label: text(301) }])),
      ],
      "two items with one key": [
        "denied",
        create("coreTeam", path, template([...items(14), { key: "step-1", label: "The first step again" }])),
      ],
      "fifteen items, by the core team": ["allowed", create("coreTeam", path, template(items(15)))],
      "fifteen other items, by an administrator": [
        "allowed",
        update("admin", path, { items: items(15).map((item) => ({ ...item, label: `${item.label}, revised` })) }),
      ],
      "one item": ["allowed", update("coreTeam", path, { items: items(1) })],
    });
    await expectSchemaAccepts("checklistTemplates", path);
  });

  it("fits for a question of the prediction market, a vocabulary term and an external account", async () => {
    const question = `predictionMarketItems/${autoId("questionFull")}`;
    const account = `externalAccounts/${autoId("accountFull")}`;
    await expectOutcomes({
      "a new question with fifty choices, by the core team": [
        "allowed",
        create("coreTeam", question, {
          replicationId: OWN_REPLICATION,
          hypothesisId: "h01",
          questionText: text(10_000),
          choices: Array.from({ length: 50 }, (_, index) => `Choice ${index + 1}`),
        }),
      ],
      "fifty-one choices": [
        "denied",
        update("coreTeam", question, { choices: Array.from({ length: 51 }, (_, index) => `Choice ${index + 1}`) }),
      ],
      "a number among the choices": ["denied", update("coreTeam", question, { choices: ["Yes", 2] })],
      "a hypothesis of another replication": ["denied", update("coreTeam", question, { hypothesisId: "h42" })],
      "every field of a vocabulary term, by the core team": [
        "allowed",
        update("coreTeam", "vocabularyTerms/term-1", {
          abbreviation: "SC",
          description: text(10_000),
          invalidReason: "Replaced by another term.",
          sameAsSource: ["https://example.org/vocabulary/1", ""],
          labelsSource: ["Synthetic construct", "synthetic  construct"],
          isDeprecated: true,
        }),
      ],
      "a new account with every field, by the core team": [
        "allowed",
        create("coreTeam", account, {
          ownerType: "replication",
          ownerId: OWN_REPLICATION,
          system: "github",
          accountName: text(300),
          notes: text(10_000),
          scopeKeys: [REPLICATION_KEY],
        }),
      ],
    });
    await expectSchemaAccepts("predictionMarketItems", question);
    await expectSchemaAccepts("vocabularyTerms", "vocabularyTerms/term-1");
    await expectSchemaAccepts("externalAccounts", account);
  });
});

describe("a version of a protocol", () => {
  const versions = `${REPLICATION}/protocolVersions`;
  const lead = uidOfCaller("ownLead");
  const draft = `${versions}/version-1`;
  const approved = `${versions}/version-0`;

  it("names its approver exactly while it is approved, and changes no more once it is", async () => {
    await expectOutcomes({
      "a draft that names an approver": [
        "denied",
        update("ownLead", draft, { approvedBy: lead, approvedAt: serverTimestamp() }),
      ],
      "an approval that names nobody": ["denied", update("ownLead", draft, { status: "approved" })],
      "an edit of the draft": [
        "allowed",
        update("ownLead", draft, { versionLabel: "1.0 (draft)", effectiveDate: "2026-03-01" }),
      ],
      "the approval of the draft by the lead, now": [
        "allowed",
        update("ownLead", draft, { status: "approved", approvedBy: lead, approvedAt: serverTimestamp() }),
      ],
      "another label on the approved version": ["denied", update("ownLead", draft, { versionLabel: "1.0 (final)" })],
      "another approver on the approved version": [
        "denied",
        update("coreTeam", draft, { approvedBy: uidOfCaller("coreTeam"), approvedAt: serverTimestamp() }),
      ],
      "the approved version made a draft again": [
        "denied",
        update("ownLead", draft, { status: "draft", approvedBy: null, approvedAt: null }),
      ],
      "the approved version superseded": ["allowed", update("ownLead", draft, { status: "superseded" })],
      "the superseded version approved again": ["denied", update("ownLead", draft, { status: "approved" })],
      "another summary on the superseded version": [
        "denied",
        update("ownLead", draft, { changeSummary: "Rewritten." }),
      ],
      "an archive of the superseded version": ["allowed", update("ownLead", draft, { archivedAt: serverTimestamp() })],
    });
  });

  it("points at a document link of its own replication", async () => {
    await plant({
      "documentLinks/link-of-other": {
        ...FIXTURES.documentLinks?.seed,
        entityId: OTHER_REPLICATION,
        replicationId: OTHER_REPLICATION,
        scopeKeys: [replicationScopeKey(OTHER_REPLICATION), "members"],
      },
    });
    await expectOutcomes({
      "a link that does not exist": ["denied", update("ownLead", draft, { documentLinkId: "link-missing" })],
      "a link of another replication": ["denied", update("ownLead", draft, { documentLinkId: "link-of-other" })],
      "a link of the replication": ["allowed", update("ownLead", draft, { documentLinkId: "link-1" })],
      "the approved version, which stays as it was approved": [
        "denied",
        update("ownLead", approved, { documentLinkId: "link-1" }),
      ],
    });
  });
});

describe("what trusted code alone records", () => {
  it("is no part of a new document link or of a new manuscript", async () => {
    const link = FIXTURES.documentLinks?.create?.data("") ?? {};
    const manuscript = FIXTURES.manuscripts?.create?.data("") ?? {};
    const linkAt = `documentLinks/${autoId("checkedLink")}`;
    const manuscriptAt = `manuscripts/${autoId("claimedManuscript")}`;
    await expectOutcomes({
      "a link that says it is public": ["denied", create("ownLead", linkAt, { ...link, accessStatus: "public" })],
      "a link with the answer of a server": ["denied", create("ownLead", linkAt, { ...link, httpStatus: 200 })],
      "a link with the name of an owner": ["denied", create("ownLead", linkAt, { ...link, ownerName: "Forged" })],
      "a link with a time of modification": [
        "denied",
        create("ownLead", linkAt, { ...link, modifiedAt: serverTimestamp() }),
      ],
      "a manuscript with the identifier of the public website": [
        "denied",
        create("ownLead", manuscriptAt, { ...manuscript, websitePublicationId: "Synthetic2027" }),
      ],
      "a manuscript with a verified citation": [
        "denied",
        create("ownLead", manuscriptAt, { ...manuscript, citationStatus: "verified" }),
      ],
      "the identifier of the public website on a manuscript, by an administrator": [
        "denied",
        update("admin", "manuscripts/manuscript-1", { websitePublicationId: "Synthetic2027" }),
      ],
      "the result of the citation check on a manuscript, by a lead": [
        "denied",
        update("ownLead", "manuscripts/manuscript-1", {
          citationStatus: "verified",
          citationMetadata: { source: "crossref" },
        }),
      ],
    });
  });

  it("is the original identifier of a vocabulary term and the ROR identifier of an institution", async () => {
    const term = FIXTURES.vocabularyTerms?.create?.data("") ?? {};
    await expectOutcomes({
      "a new term with an original identifier": [
        "denied",
        create("coreTeam", "vocabularyTerms/term-claimed", { ...term, sourceId: "term-1" }),
      ],
      "a new term whose kind is no key": [
        "denied",
        create("coreTeam", "vocabularyTerms/term-claimed", { ...term, kind: "a kind.of term" }),
      ],
      "the ROR identifier of an institution, by an administrator": [
        "denied",
        update("admin", "institutions/institution-1", { rorId: "05gq02987" }),
      ],
    });
  });
});

describe("the contact document of a person", () => {
  it("is refused to an account whose access document names no unit for contact details", async () => {
    // An access document that was resolved before the two lists existed still holds the
    // capability for the replication. Without the lists the rule has nothing to compare, and it
    // refuses: the document is read again once the access resolver has run.
    const resolved = CALLERS.ownLead.access;
    if (resolved === null) throw new Error("The lead of the world has an access document.");
    const { contactReplicationIds: _replications, contactLaboratoryIds: _laboratories, ...stale } = resolved;
    expect(stale.capabilities.peopleContactRead).toEqual([REPLICATION_KEY]);
    await plant({ [`access/${uidOfCaller("ownLead")}`]: { ...stored(), ...stale } });
    await expectOutcomes({
      "the lead reads the contact document of a person of its replication": [
        "denied",
        get("ownLead", `${PERSON}/private/contact`),
      ],
      "the lead still reads the directory": ["allowed", get("ownLead", PERSON)],
      "the person reads its own": ["allowed", get("owner", `${PERSON}/private/contact`)],
    });
  });
});

describe("a participation", () => {
  it("names a protocol version only together with the protocol it belongs to", async () => {
    await plant({
      [`${REPLICATION}/protocols/protocol-2`]: {
        ...FIXTURES.replicationProtocols?.seed,
        title: "Second synthetic protocol",
        currentVersionId: null,
      },
    });
    await expectOutcomes({
      "a version without its protocol": [
        "denied",
        update("ownLead", PARTICIPATION, { protocolVersionId: "version-1" }),
      ],
      "a version of another protocol": [
        "denied",
        update("ownLead", PARTICIPATION, { protocolId: "protocol-2", protocolVersionId: "version-1" }),
      ],
      "a protocol and its version": [
        "allowed",
        update("ownLead", PARTICIPATION, { protocolId: "protocol-1", protocolVersionId: "version-1" }),
      ],
      "another protocol under the version that is stored": [
        "denied",
        update("ownLead", PARTICIPATION, { protocolId: "protocol-2" }),
      ],
    });
  });
});
