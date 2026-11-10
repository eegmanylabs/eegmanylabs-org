// Integration tests of the importer of the membership and contributor workbook (source G)
// against the Firestore emulator. The workbook is a synthetic fixture that encodes only what the
// project brief states about the real one, which could not be opened: every person, address (on
// example.org), affiliation and gender or ethnicity term in it is invented.
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  COLLECTION_ENTRIES,
  contributorId,
  contributorNameHash,
  contributorSheetSourceKey,
  contributorTableId,
  identityKeyId,
  importedPersonId,
  personEmailIndexId,
  personEvidenceKey,
  sourceTabKey,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALPHA_BETA_SHEET, contributorWorkbook } from "../../tools/src/import/fixtures/contributor-sheets";
import {
  ETHNICITY_TERM_ONE,
  GENDER_TERM_ONE,
  GENDER_TERM_TWO,
  MEMBER_ROWS,
  type MemberRow,
  type MembershipWorkbookOptions,
  membershipWorkbook,
  SPECIAL_TERMS,
  TABLE_FILE_IDENTIFIERS,
} from "../../tools/src/import/fixtures/membership-workbook";
import { websiteFixture, writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import { itemBuilders } from "../../tools/src/import/reconcile";
import { rollbackBatch } from "../../tools/src/import/rollback";
import { importer as contributorSheets } from "../../tools/src/import/sources/contributor-sheets";
import { importer as membership } from "../../tools/src/import/sources/membership-workbook";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import { importCli } from "./cli-support";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  OBSERVED_ON,
  reconciliationItems,
  removeTemporaryDirectories,
  run,
  type StoredDocument,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

const MEMBERS = sourceTabKey("list_members");
const STUDIES = sourceTabKey("study_description");
const TABLES = sourceTabKey("contibutor_tables");

async function workbookFile(options: MembershipWorkbookOptions = {}): Promise<string> {
  const file = path.join(temporaryDirectory(), "membership.xlsx");
  writeFileSync(file, await membershipWorkbook(options));
  return file;
}

async function applyWebsite(): Promise<void> {
  await run(website, writeWebsiteFixture(temporaryDirectory(), websiteFixture()), "apply");
}

const personOf = (address: string) => importedPersonId(personEvidenceKey.email(address), TEST_HASH_KEY);
const ADA = personOf("ada.example@example.org");
const UMA = personOf("uma.synthetic@example.org");
const WES = personOf("wes@example.org");
const ZED = personOf("zed.dummy@example.org");

const data = async (documentPath: string) => (await adminDb.doc(documentPath).get()).data();
const openItems = async (kind?: string) =>
  (await reconciliationItems()).filter(
    (item) => item.sourceKey === "g" && item.status === "open" && (kind === undefined || item.kind === kind),
  );
const withMember = (index: number, change: MemberRow["cells"]): MemberRow[] =>
  MEMBER_ROWS.map((row, at) => (at === index ? { ...row, cells: { ...row.cells, ...change } } : row));

/** Every restricted value of the fixture: an address, or a part of one. */
const ADDRESS_PARTS = ["@example.org", "ada.example", "uma.synthetic", "w.sample", "yan.twin"];
/** The special-category terms of the fixture, as they are written and without the space around them. */
const TERMS = SPECIAL_TERMS.map((term) => term.trim());

const classOf = (documentPath: string): string => {
  const segments = documentPath.split("/");
  const entry = COLLECTION_ENTRIES.find((candidate) => {
    const parts = candidate.path.split("/");
    return (
      parts.length === segments.length && parts.every((part, index) => part.startsWith("{") || part === segments[index])
    );
  });
  return entry?.dataClass ?? "unregistered";
};
const holding = (documents: ReadonlyMap<string, StoredDocument>, values: readonly string[]): string[] =>
  [...documents]
    .filter(([, stored]) => values.some((value) => JSON.stringify(stored.data).includes(value)))
    .map(([key]) => key);

const items = itemBuilders(TEST_HASH_KEY);

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

describe("the membership workbook importer", () => {
  it("accounts for every row of every tab: imported, held in the queue, or kept raw for a stated reason", async () => {
    await applyWebsite();
    const report = await run(membership, await workbookFile(), "apply");
    expect(report).toMatchObject({ sourceKey: "g", status: "applied", blocking: [] });
    const byTab = Object.fromEntries(report.tabs.map((tab) => [tab.tabKey, tab]));
    expect(byTab[MEMBERS]).toMatchObject({
      rows: expect.objectContaining({ banner: 1, header: 1, data: 7, blank: 1 }),
      // Four people. The row without an address and the two rows of one address wait in the queue.
      imported: 4,
      queued: 3,
      rawOnly: {},
      unaccounted: 0,
    });
    expect(byTab[STUDIES]).toMatchObject({
      rows: expect.objectContaining({ header: 1, data: 2, blank: 1 }),
      imported: 0,
      queued: 0,
      rawOnly: { fieldsNotStated: 2 },
    });
    expect(byTab[TABLES]).toMatchObject({
      rows: expect.objectContaining({ header: 1, data: 5 }),
      imported: 3,
      queued: 2,
      unaccounted: 0,
    });
    expect((await data(`sources/g/tabs/${STUDIES}`))?.visibility).toBe("hidden");
    expect(await data(`sources/g/tabs/${MEMBERS}`)).toMatchObject({
      name: "list_members",
      headerRow: 3,
      rowCount: 7,
      importerKey: "membershipWorkbook",
    });
    // The registry says that the importer of this source has never seen the real workbook.
    expect((await data("sources/g"))?.notes).toMatch(/synthetic fixtures only/);
    expect(await schemaProblems()).toEqual([]);
  });

  it("creates a person for a row with one usable address, with an opaque slug and the name and country as written", async () => {
    await applyWebsite();
    const before = (await documentsOf("persons")).size;
    await run(membership, await workbookFile(), "apply");
    const people = await documentsOf("persons");
    expect(people.size).toBe(before + 4);
    expect(people.get(ADA)).toMatchObject({
      slug: `p-${ADA.slice(3)}`,
      givenName: "Ada",
      familyName: "Example",
      displayName: "Ada Example",
      countrySource: "Nowhereland",
      isCoreTeam: false,
      publicListing: "none",
      userId: null,
      dataOrigin: "live",
    });
    // The country is kept as written and mapped to no code. Nothing is inferred from the address or the affiliation.
    expect(people.get(UMA)).toMatchObject({ countrySource: "USA" });
    expect(people.get(UMA)).not.toHaveProperty("countryCode");
    expect(people.get(UMA)).not.toHaveProperty("institutionId");
    // A name alone is no identity: the row without an address creates nobody.
    expect([...people.values()].some((person) => person.displayName === "Vic Pretend")).toBe(false);
    expect([...people.values()].some((person) => person.displayName === "Yan Twin")).toBe(false);
    // The affiliation is one verbatim string beneath the person, and one institution candidate.
    expect(await data(`persons/${WES}/affiliations/g__${MEMBERS}__a1`)).toMatchObject({
      affiliationSource: "Sample College, Specimen City",
      isPrimary: true,
    });
    expect((await documentsOf("institutions")).size).toBe(0);
    // No membership, no role and no access follow from the tags or from the co-author flag.
    const created = differences(new Map(), await allDocuments()).created;
    expect(created.filter((documentPath) => /^(roleAssignments|access|groups)\//.test(documentPath))).toEqual([]);
    const memberships = [...(await documentsOf("memberships", true)).values()];
    expect(memberships.filter((entry) => [ADA, UMA, WES, ZED].includes(entry.personId as string))).toEqual([]);
  });

  it("writes every address to the restricted contact document and to the indexes that no client reads", async () => {
    await applyWebsite();
    await run(membership, await workbookFile(), "apply");
    const contact = await data(`persons/${ADA}/private/contact`);
    // Addresses are stored in canonical form: the secondary one is written with capitals and a space after it.
    expect(contact?.emails).toEqual([
      expect.objectContaining({
        email: "ada.example@example.org",
        kind: "primary",
        claimEligible: true,
        verifiedAt: null,
      }),
      expect.objectContaining({ email: "a.example@example.org", kind: "secondary", claimEligible: true }),
    ]);
    // A cell with two addresses is used for nothing. The one usable address of the row is its secondary one.
    expect((await data(`persons/${WES}/private/contact`))?.emails).toEqual([
      expect.objectContaining({ email: "wes@example.org", kind: "secondary" }),
    ]);
    const defects = await openItems("identifierDefect");
    expect(defects).toHaveLength(1);
    expect(JSON.stringify(defects)).not.toContain("sample@");

    for (const [address, personId] of [
      ["ada.example@example.org", ADA],
      ["a.example@example.org", ADA],
      ["wes@example.org", WES],
    ] as const) {
      expect(await data(`personEmailIndex/${personEmailIndexId(address, TEST_HASH_KEY)}`)).toMatchObject({
        personIds: [personId],
        claimEligiblePersonIds: [personId],
      });
      const key = identityKeyId("person", "email", personEvidenceKey.email(address), TEST_HASH_KEY);
      expect(await data(`identityKeys/${key}`)).toMatchObject({ keyKind: "email", entityIds: [personId] });
    }
    // The address of a row that is held in the queue reaches no index.
    expect(await data(`personEmailIndex/${personEmailIndexId("yan.twin@example.org", TEST_HASH_KEY)}`)).toBeUndefined();

    // No address is in a document that a member can read, in an item, in a batch record or in a log entry.
    const documents = await allDocuments();
    for (const documentPath of holding(documents, ADDRESS_PARTS)) {
      expect(classOf(documentPath), documentPath).toBe("restricted");
      expect(documentPath).toMatch(
        /^(persons\/[^/]+\/private\/contact|sourceRecords\/[^/]+|importBatches\/[^/]+\/changes\/\d+)$/,
      );
    }
  });

  it("stores gender and ethnicity verbatim in the special-category document, and nowhere that a client can read", async () => {
    await applyWebsite();
    const report = await run(membership, await workbookFile(), "apply");
    const ada = await data(`persons/${ADA}/special/demographics`);
    expect(ada).toMatchObject({ genderSource: GENDER_TERM_ONE, ethnicitySource: ETHNICITY_TERM_ONE });
    expect(ada?.recordedAt.toDate().toISOString()).toBe(`${OBSERVED_ON}T00:00:00.000Z`);
    // The term is kept exactly as written, with its capitals and the space after it. Nothing is standardised
    // and nothing is inferred: no category is set, and a blank cell stays absent.
    const uma = await data(`persons/${UMA}/special/demographics`);
    expect(uma?.genderSource).toBe(GENDER_TERM_TWO);
    expect(uma?.genderSource.endsWith(" ")).toBe(true);
    for (const field of ["ethnicitySource", "genderCategory", "ethnicityCategory", "genderSelfDescribed"]) {
      expect(uma, field).not.toHaveProperty(field);
    }
    expect(await data(`persons/${ZED}/special/demographics`)).not.toHaveProperty("genderSource");

    // A special-category value is found in three kinds of document only, each of which no client can read:
    // the demographics of a person, the cells beside a source record, and the states beside a change-log entry.
    const documents = await allDocuments();
    const withTerms = holding(documents, TERMS);
    expect(withTerms.length).toBeGreaterThan(0);
    for (const documentPath of withTerms) {
      expect(classOf(documentPath), documentPath).toBe("special");
      expect(documentPath).toMatch(
        /^(persons\/[^/]+\/special\/demographics|sourceRecords\/[^/]+\/special\/raw|importBatches\/[^/]+\/changes\/\d+\/special\/state)$/,
      );
    }
    // The source record of a member row holds a marker in the place of each cell, and its special cells apart.
    const records = await adminDb.collection("sourceRecords").where("tabKey", "==", MEMBERS).get();
    const adaRecord = records.docs.find((doc) => doc.id === ada?.sourceRecordId);
    expect(adaRecord?.get("raw").H).toEqual({ t: "specialCategory", k: expect.stringMatching(/^[0-9a-f]{20}$/) });
    expect((await data(`sourceRecords/${adaRecord?.id}/special/raw`))?.raw).toEqual({
      H: { v: GENDER_TERM_ONE, t: "string" },
      I: { v: ETHNICITY_TERM_ONE, t: "string" },
    });
    // The change log shows a marker for a special-category document, and nothing that depends on its values.
    const changes = await adminDb.collection(`importBatches/${report.batchId}/changes`).get();
    const logged = changes.docs.find((doc) => doc.get("documentPath") === `persons/${ADA}/special/demographics`);
    expect(logged?.get("after")).toEqual({ specialCategory: true });
    // The report of the run, which the command line prints and the batch stores, holds no term and no address.
    for (const value of [...TERMS, ...ADDRESS_PARTS, "Example", "Synthetic", "Nowhere"]) {
      expect(JSON.stringify(report), value).not.toContain(value);
    }
    expect((await data(`importBatches/${report.batchId}`))?.stats).toMatchObject({ "created:personDemographics": 4 });
  });

  it("keeps the cells of a row that creates no person where no client can read them, and queues the row", async () => {
    await applyWebsite();
    await run(membership, await workbookFile(), "apply");
    const queued = await openItems("duplicatePerson");
    // The row with a name alone, the two rows of one address, and the person whose name another source knows.
    expect(queued).toHaveLength(3);
    const twins = queued.find((item) => item.candidates.length === 2 && item.entityRefs.length === 0);
    const twinRecords =
      twins?.candidates.map((candidate: { sourceRecordId: string }) => candidate.sourceRecordId) ?? [];
    expect(twinRecords).toHaveLength(2);
    for (const recordId of twinRecords) {
      // The special-category cells of a held row are beside its source record, and in no demographics document.
      expect((await data(`sourceRecords/${recordId}/special/raw`))?.raw).toHaveProperty("H");
    }
    const demographics = [...(await allDocuments()).keys()].filter((key) =>
      /^persons\/[^/]+\/special\/demographics$/.test(key),
    );
    expect(demographics).toHaveLength(4);
    // The person of this workbook and the person of the website who has the same name are never merged here.
    const websiteAda = [...(await documentsOf("persons"))].find(
      ([id, person]) => person.displayName === "Ada Example" && id !== ADA,
    )?.[0];
    const namesake = items.duplicatePerson({
      subject: ADA,
      claims: [
        { source: `g/${MEMBERS}`, value: ADA },
        { source: "person", value: websiteAda ?? "" },
      ],
    });
    expect(queued.map((item) => item.id)).toContain(namesake.fingerprint);
    expect((await data(`persons/${websiteAda}`))?.websitePersonId).toBe("aexample");
    expect(await data(`persons/${websiteAda}/private/contact`)).toBeUndefined();
  });

  it("queues the replications that a row names as membership candidates, and what only formatting says", async () => {
    await applyWebsite();
    await run(membership, await workbookFile(), "apply");
    const candidates = await openItems("candidateLink");
    expect(candidates).toHaveLength(3);
    const ada = candidates.find((item) => item.entityRefs[0]?.entityId === ADA);
    expect(ada).toMatchObject({
      field: "replicationIds",
      entityRefs: [
        { entityType: "person", entityId: ADA },
        { entityType: "replication", entityId: "AlphaBeta2001" },
        { entityType: "replication", entityId: "AlphaGamma2002" },
      ],
    });
    expect(ada?.id).toBe(
      items.candidateLink({
        subject: ADA,
        field: "replicationIds",
        claims: ["AlphaBeta2001", "AlphaGamma2002"].map((value) => ({ source: `g/${MEMBERS}/replication`, value })),
      }).fingerprint,
    );
    // A tag that names no study is queued by itself. The other tag of its cell is still a candidate.
    const unmatched = (await openItems("unmatchedIdentifier")).filter((item) => item.field === undefined);
    expect(unmatched.map((item) => item.candidates[0]?.valueSource)).toEqual(["NoSuchStudy1999"]);
    expect(candidates.find((item) => item.entityRefs[0]?.entityId === ZED)?.entityRefs[1]).toEqual({
      entityType: "replication",
      entityId: "Delta1999",
    });
    // A flag that is no flag, a struck name and a hidden row are questions for a person.
    expect((await openItems("unparsedValue")).filter((item) => item.field === "isCoauthor")).toHaveLength(1);
    expect(
      (await openItems("formattingSignal")).map((item) => [item.field, item.entityRefs[0]?.entityId]).sort(),
    ).toEqual([
      ["hiddenRow", ZED],
      ["strike", UMA],
    ]);
  });

  it("writes the registry of contributor tables without the address of any sheet", async () => {
    await applyWebsite();
    await run(membership, await workbookFile(), "apply");
    const tables = await documentsOf("contributorTables");
    expect([...tables.keys()].sort()).toEqual(Object.values(TABLE_FILE_IDENTIFIERS).map(contributorTableId).sort());
    expect(tables.get(contributorTableId(TABLE_FILE_IDENTIFIERS.alphaBeta))).toMatchObject({
      replicationId: "AlphaBeta2001",
      sourceKey: contributorSheetSourceKey(TABLE_FILE_IDENTIFIERS.alphaBeta),
      scopeKeys: ["rep:AlphaBeta2001"],
      isOnlySignupTable: false,
      isPublished: true,
      publicationUrl: "https://journal.example.org/articles/invented-2023",
      pdfUrl: "https://files.example.org/invented-2023.pdf",
    });
    // A flag written as text is read, and anything else is left out and queued. Nothing is read as false.
    const delta = tables.get(contributorTableId(TABLE_FILE_IDENTIFIERS.delta));
    expect(delta).toMatchObject({ replicationId: "Delta1999", isOnlySignupTable: true });
    expect(delta).not.toHaveProperty("isPublished");
    expect(delta).not.toHaveProperty("publicationUrl");
    expect((await openItems("unparsedValue")).filter((item) => item.field === "isPublished")).toHaveLength(1);
    expect((await openItems("linkDefect")).map((item) => item.field).sort()).toEqual(["publicationUrl", "tableLink"]);
    // A table that no import of a contributor sheet has read is a further sheet, for a maintainer to register.
    expect((await openItems("statusQuestion")).map((item) => item.entityRefs[0]?.entityId).sort()).toEqual(
      Object.values(TABLE_FILE_IDENTIFIERS).map(contributorTableId).sort(),
    );
    expect((await openItems("unmatchedIdentifier")).filter((item) => item.field === "replicationId")).toHaveLength(1);
    // The address and the identifier of a sheet stay in the raw rows. No other document holds either.
    const documents = await allDocuments();
    const withLink = holding(documents, ["spreadsheets/d/", ...Object.values(TABLE_FILE_IDENTIFIERS)]);
    expect(withLink.length).toBeGreaterThan(0);
    for (const documentPath of withLink) expect(documentPath).toMatch(/^sourceRecords\/[^/]+$/);
  });

  it("writes nothing on a second run, and passes every check of the verification", async () => {
    await applyWebsite();
    const file = await workbookFile();
    await run(membership, file, "apply");
    const before = await allDocuments();
    const again = await run(membership, file, "apply");
    expect(again).toMatchObject({ status: "applied", documentsWritten: 0, changesCommitted: 0 });
    const changed = differences(before, await allDocuments());
    expect(changed.created).toEqual([`importBatches/${again.batchId}`]);
    expect(changed.rewritten).toEqual([]);
    expect((await run(membership, await workbookFile(), "apply")).documentsWritten).toBe(0);
    const checks = await verify(membership, file);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("follows the workbook where a field still holds what it said, and never overwrites a correction", async () => {
    await applyWebsite();
    await run(membership, await workbookFile(), "apply");
    // The person corrects the name in the portal, and a function records another gender term for the person.
    await adminDb.doc(`persons/${ADA}`).update({ displayName: "Ada B. Example" });
    await adminDb.doc(`persons/${ADA}/special/demographics`).update({ genderSource: "a corrected synthetic term" });
    const changedTerm = "a changed synthetic term";
    const report = await run(
      membership,
      await workbookFile({
        members: withMember(0, { name: "Adah", country: "Otherland", gender: changedTerm, ethnicity: null }),
      }),
      "apply",
    );
    expect(report.sourceRecords).toMatchObject({ created: 1, superseded: 1 });
    const ada = await data(`persons/${ADA}`);
    // The country and the given name follow the workbook. The corrected display name stays.
    expect(ada).toMatchObject({ givenName: "Adah", countrySource: "Otherland", displayName: "Ada B. Example" });
    const demographics = await data(`persons/${ADA}/special/demographics`);
    expect(demographics?.genderSource).toBe("a corrected synthetic term");
    // The cell that is blank now is absent now: a blank is never kept as a value.
    expect(demographics).not.toHaveProperty("ethnicitySource");
    const conflicts = await openItems("valueConflict");
    expect(conflicts.map((item) => item.field).sort()).toEqual(["displayName", "genderSource"]);
    // The conflict in a special-category field names the field and the source record, and shows no value.
    const special = conflicts.find((item) => item.field === "genderSource");
    expect(
      special?.candidates.every((candidate: { valueSource?: string }) => candidate.valueSource === undefined),
    ).toBe(true);
    expect(JSON.stringify(await reconciliationItems())).not.toContain("synthetic term");
    const documents = await allDocuments();
    for (const documentPath of holding(documents, [changedTerm, "a corrected synthetic term"])) {
      expect(classOf(documentPath), documentPath).toBe("special");
    }
  });

  it("links a contributor to the person of a member row by the address, and settles what kind of table a sheet is", async () => {
    await applyWebsite();
    const file = await workbookFile();
    await run(membership, file, "apply");
    const bound = contributorSheets.select?.({
      selector: "alpha-beta",
      config: {
        hashKey: TEST_HASH_KEY,
        sources: {},
        contributorSheets: {
          "alpha-beta": { externalId: TABLE_FILE_IDENTIFIERS.alphaBeta, replicationId: "AlphaBeta2001" },
        },
      },
    });
    if (bound === undefined) throw new Error("The importer of the contributor sheets selects no sheet.");
    const sheetFile = path.join(temporaryDirectory(), "contributors.xlsx");
    writeFileSync(sheetFile, await contributorWorkbook(ALPHA_BETA_SHEET));
    const report = await run(bound, sheetFile, "apply");
    expect(report.status).toBe("applied");
    const nameHash = contributorNameHash("Ada", "Example", TEST_HASH_KEY) ?? "";
    const contributor = await data(`contributors/${contributorId(TABLE_FILE_IDENTIFIERS.alphaBeta, nameHash, 1)}`);
    // The address of the sheet is the address of the member row, so the contributor is linked to that person.
    expect(contributor?.personId).toBe(ADA);
    // The workbook has said what kind of table the sheet is. Only its manuscript is still open.
    const question = (await reconciliationItems()).find(
      (item) => item.sourceKey === bound.sourceKey && item.kind === "statusQuestion" && item.status === "open",
    );
    expect(question?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource)).toEqual([
      "manuscriptId",
    ]);
    const table = await data(`contributorTables/${contributorTableId(TABLE_FILE_IDENTIFIERS.alphaBeta)}`);
    expect(table).toMatchObject({ isPublished: true, isOnlySignupTable: false });
    expect(typeof table?.sourceRecordId).toBe("string");
    // The next run of the workbook sees that the sheet has been read, and closes its question about it.
    const again = await run(membership, file, "apply");
    expect(again.items.clear).toEqual({ statusQuestion: 1 });
    expect(again.collections.contributorTables).toMatchObject({ created: 0, changed: 0 });
  });

  it("chooses nothing where the workbook and the registration of a sheet name different replications", async () => {
    await applyWebsite();
    const tableId = contributorTableId(TABLE_FILE_IDENTIFIERS.alphaBeta);
    await adminDb.doc(`contributorTables/${tableId}`).set({
      replicationId: "EtaTheta2005",
      sourceKey: contributorSheetSourceKey(TABLE_FILE_IDENTIFIERS.alphaBeta),
      scopeKeys: ["rep:EtaTheta2005"],
    });
    const report = await run(membership, await workbookFile(), "apply");
    expect(report.tabs.find((tab) => tab.tabKey === TABLES)).toMatchObject({ imported: 2, queued: 3 });
    const table = await data(`contributorTables/${tableId}`);
    expect(table?.replicationId).toBe("EtaTheta2005");
    expect(table).not.toHaveProperty("isPublished");
    const [conflict] = (await openItems("valueConflict")).filter((item) => item.field === "replicationId");
    expect(conflict?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource).sort()).toEqual([
      "AlphaBeta2001",
      "EtaTheta2005",
    ]);
  });
});

describe("a rollback of the membership workbook", () => {
  it("removes what the batch created, special-category documents included, and keeps the raw rows", async () => {
    await applyWebsite();
    const file = await workbookFile();
    const applied = await run(membership, file, "apply");
    const afterApply = await allDocuments();
    const result = await rollbackBatch(adminDb, applied.batchId);
    expect(result.status).toBe("rolledBack");
    const afterRollback = await allDocuments();
    for (const documentPath of [
      `persons/${ADA}`,
      `persons/${ADA}/private/contact`,
      `persons/${ADA}/special/demographics`,
    ]) {
      expect(afterRollback.has(documentPath), documentPath).toBe(false);
    }
    // A source record states what the workbook said, so it stays, with its special-category cells beside it.
    const raw = [...afterApply.keys()].filter((key) => key.startsWith("sourceRecords/"));
    expect(raw.length).toBeGreaterThan(0);
    for (const documentPath of raw) expect(afterRollback.has(documentPath), documentPath).toBe(true);
    // A new apply writes the same documents again.
    const again = await run(membership, file, "apply");
    expect(again.status).toBe("applied");
    const afterSecond = await allDocuments();
    const entities = (documents: ReadonlyMap<string, StoredDocument>) =>
      [...documents.keys()].filter((key) => !/^(importBatches|reconciliationItems)\//.test(key)).sort();
    expect(entities(afterSecond)).toEqual(entities(afterApply));
    expect((await data(`persons/${ADA}/special/demographics`))?.genderSource).toBe(GENDER_TERM_ONE);
  });
});

describe("the structure check of the membership workbook", () => {
  it("stops with a precise report when a column is missing, and stores no cell of a member", async () => {
    await applyWebsite();
    const before = (await documentsOf("persons")).size;
    const report = await run(membership, await workbookFile({ memberHeaders: { gender: null } }), "apply");
    expect(report.status).toBe("failed");
    expect(report.blocking).toEqual([
      {
        check: "missingHeader",
        message: "The header of the tab list_members, in row 3, lacks 1 of its 11 expected columns.",
      },
    ]);
    expect((await documentsOf("persons")).size).toBe(before);
    expect((await documentsOf("contributorTables")).size).toBe(0);
    // The item that explains the stop is written at once, and names what was expected.
    const [item] = await openItems("structureChange");
    expect(item?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource)).toEqual([
      "gender",
      "absent",
    ]);
    // Of the member tab only the header is stored. No address and no term has reached the database.
    const records = await adminDb.collection("sourceRecords").where("tabKey", "==", MEMBERS).get();
    expect(records.docs.map((doc) => doc.get("rowKey"))).toEqual(["header"]);
    const documents = await allDocuments();
    expect(holding(documents, [...TERMS, ...ADDRESS_PARTS])).toEqual([]);
  });

  it("stops on a column or a tab that the brief does not name, because either may hold anything", async () => {
    const column = await run(
      membership,
      await workbookFile({ extraMemberColumn: { header: "Free remarks", value: "an invented remark about a person" } }),
      "preview",
    );
    expect(column.blocking.map((check) => check.check)).toEqual(["unknownHeader"]);
    const tab = await run(membership, await workbookFile({ extraTab: "payments" }), "preview");
    expect(tab.blocking.map((check) => check.check)).toEqual(["unknownTab"]);
    const documents = await allDocuments();
    expect(holding(documents, ["an invented remark about a person", "an invented tab"])).toEqual([]);
  });
});

describe("the command line with the membership workbook", () => {
  it("prints counts and identifiers only, and never a name, an address or a special-category term", async () => {
    await applyWebsite();
    const config = path.join(temporaryDirectory(), "sources.json");
    writeFileSync(config, JSON.stringify({ hashKey: TEST_HASH_KEY, sources: {} }));
    const file = await workbookFile();
    const applied = importCli([
      "run",
      "g",
      "--input",
      file,
      "--mode",
      "apply",
      "--observed-on",
      OBSERVED_ON,
      "--config",
      config,
    ]);
    expect(applied.stderr).toBe("");
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain("import apply of source g");
    expect(applied.stdout).toContain("Data rows: 4 imported, 3 held in the queue");
    expect(applied.stdout).toContain("personDemographics: 4 created");
    for (const value of [...TERMS, ...ADDRESS_PARTS, "Ada", "Synthetic", "Nowhere", "ExampleAmp", "spreadsheets"]) {
      expect(applied.output, value).not.toContain(value);
    }
    expect(importCli(["list"]).stdout).toMatch(
      /^ {2}g {2}Membership and contributor workbook: membershipWorkbook\..*synthetic fixtures only/m,
    );
    // A source that is one source takes no member name.
    const misused = importCli(["run", "g", "--sheet", "any", "--input", file, "--mode", "preview", "--config", config]);
    expect(misused.status).toBe(2);
    expect(misused.stderr).toContain("takes no --sheet");
    const blocked = importCli([
      "run",
      "g",
      "--input",
      await workbookFile({ withoutTab: "study_description" }),
      "--mode",
      "preview",
      "--observed-on",
      OBSERVED_ON,
      "--config",
      config,
    ]);
    expect(blocked.status).toBe(3);
    expect(blocked.stdout).toContain(
      "Blocking check tabs: The workbook does not hold each of its three expected tabs once: 1 are missing or stand twice.",
    );
  });
});
