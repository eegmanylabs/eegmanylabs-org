// Integration tests of the importer of the contributor sheets against the Firestore emulator.
// The sheets and the website data they are matched against are synthetic: every person,
// affiliation, funding statement, iD and address (on example.org) in them is invented.
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
  institutionCandidateId,
  personEvidenceKey,
  vocabularyTermId,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ColumnOverride, PrivateConfig } from "../../tools/src/import/config";
import {
  ALPHA_BETA_SHEET,
  ALPHA_GAMMA_SHEET,
  type ContributorSheetFixture,
  contributorWorkbook,
  DELTA_SHEET,
  EPSILON_SHEET,
  type FixtureRow,
  FUNDING_KIT,
  FUNDING_NIA,
  ORCID_ADA,
  ORCID_DEFECT,
  ORCID_ELI,
  ORCID_MAX,
  ORCID_QUIN,
  personRow,
  roleNote,
  sheetColumns,
} from "../../tools/src/import/fixtures/contributor-sheets";
import { websiteFixture, writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import type { ImporterDefinition } from "../../tools/src/import/model";
import { itemBuilders } from "../../tools/src/import/reconcile";
import { runImport } from "../../tools/src/import/run";
import { importer } from "../../tools/src/import/sources/contributor-sheets";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import { importCli } from "./cli-support";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  itemCounts,
  nextInstant,
  OBSERVED_ON,
  reconciliationItems,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

/** The invented file identifier of each registered sheet, by the name under which it is registered. */
const FILE_IDENTIFIERS = {
  "alpha-beta": "an-invented-identifier-of-the-sheet-alpha-beta",
  "alpha-gamma": "an-invented-identifier-of-the-sheet-alpha-gamma",
  epsilon: "an-invented-identifier-of-the-sheet-epsilon",
  delta: "an-invented-identifier-of-the-sheet-delta",
} as const;
type SheetName = keyof typeof FILE_IDENTIFIERS;

const REPLICATIONS: Readonly<Record<SheetName, string>> = {
  "alpha-beta": "AlphaBeta2001",
  "alpha-gamma": "AlphaGamma2002",
  epsilon: "EpsilonVanZeta2010",
  delta: "Delta1999",
};

const FIXTURES: Readonly<Record<SheetName, ContributorSheetFixture>> = {
  "alpha-beta": ALPHA_BETA_SHEET,
  "alpha-gamma": ALPHA_GAMMA_SHEET,
  epsilon: EPSILON_SHEET,
  delta: DELTA_SHEET,
};

function configWith(overrides: Partial<Record<SheetName, ColumnOverride[]>> = {}): PrivateConfig {
  return {
    hashKey: TEST_HASH_KEY,
    sources: {},
    rehearse: [],
    contributorSheets: Object.fromEntries(
      (Object.keys(FILE_IDENTIFIERS) as SheetName[]).map((name) => [
        name,
        {
          externalId: FILE_IDENTIFIERS[name],
          replicationId: REPLICATIONS[name],
          url: `https://sheets.example.org/${name}/edit`,
          ...(overrides[name] === undefined ? {} : { columnOverrides: overrides[name] }),
        },
      ]),
    ),
  };
}

function sheet(name: SheetName, overrides: ColumnOverride[] | undefined = undefined): ImporterDefinition {
  const bound = importer.select?.({
    selector: name,
    config: configWith(overrides === undefined ? {} : { [name]: overrides }),
  });
  if (bound === undefined) throw new Error("The importer of the contributor sheets selects no sheet.");
  return bound;
}

async function workbookFile(fixture: ContributorSheetFixture): Promise<string> {
  const file = path.join(temporaryDirectory(), "contributors.xlsx");
  writeFileSync(file, await contributorWorkbook(fixture));
  return file;
}

const applySheet = async (name: SheetName, fixture: ContributorSheetFixture = FIXTURES[name]) =>
  run(sheet(name), await workbookFile(fixture), "apply");

/** Applies the synthetic website data, which creates the replications and the people of the public site. */
async function applyWebsite(): Promise<void> {
  await run(website, writeWebsiteFixture(temporaryDirectory(), websiteFixture()), "apply");
}

const sourceKeyOf = (name: SheetName) => contributorSheetSourceKey(FILE_IDENTIFIERS[name]);
const tableIdOf = (name: SheetName) => contributorTableId(FILE_IDENTIFIERS[name]);
const nameHash = (first: string, surname: string) => contributorNameHash(first, surname, TEST_HASH_KEY) ?? "";
const idOf = (name: SheetName, first: string, surname: string) =>
  contributorId(FILE_IDENTIFIERS[name], nameHash(first, surname), 1);
const contributorOf = async (name: SheetName, first: string, surname: string) =>
  (await adminDb.doc(`contributors/${idOf(name, first, surname)}`).get()).data();
const contactOf = async (name: SheetName, first: string, surname: string) =>
  (await adminDb.doc(`contributors/${idOf(name, first, surname)}/private/contact`).get()).data();

const withRows = (fixture: ContributorSheetFixture, rows: readonly FixtureRow[]): ContributorSheetFixture => ({
  ...fixture,
  rows,
});

/** The open items of one source, optionally of one kind. */
async function itemsOf(name: SheetName, kind?: string) {
  return (await reconciliationItems()).filter(
    (item) =>
      item.sourceKey === sourceKeyOf(name) && item.status === "open" && (kind === undefined || item.kind === kind),
  );
}

/** Every value of the fixtures that is restricted: an address, a part of one, or a funding statement. */
const RESTRICTED_VALUES = [
  "@example.org",
  "hal.nobody",
  "ida.specimen",
  FUNDING_KIT,
  FUNDING_NIA,
  "synthetic grant",
  "made-up fellowship",
];

const MEMBER_READABLE = new Set(
  COLLECTION_ENTRIES.filter((entry) => entry.dataClass === "public" || entry.dataClass === "member").map(
    (entry) => entry.path,
  ),
);

function isMemberReadable(documentPath: string): boolean {
  const segments = documentPath.split("/");
  return [...MEMBER_READABLE].some((template) => {
    const parts = template.split("/");
    return (
      parts.length === segments.length && parts.every((part, index) => part.startsWith("{") || part === segments[index])
    );
  });
}

const items = itemBuilders(TEST_HASH_KEY);

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

describe("the contributor sheet importer", () => {
  it("accounts for every row of the used range, and registers the sheet under a key without its file identifier", async () => {
    await applyWebsite();
    const report = await runImport({
      db: adminDb,
      importer: sheet("alpha-beta"),
      input: { path: await workbookFile(ALPHA_BETA_SHEET), observedOn: OBSERVED_ON },
      mode: "preview",
      secret: TEST_HASH_KEY,
      now: nextInstant(),
    });
    const sourceKey = sourceKeyOf("alpha-beta");
    expect(report).toMatchObject({ sourceKey, status: "previewed", blocking: [] });
    expect(report.tabs).toEqual([
      expect.objectContaining({
        tabKey: "t0",
        // 1 header, 6 contributors, 3 blank rows and 40 rows of unticked boxes: the 50 rows of the used range.
        rows: expect.objectContaining({ header: 1, data: 6, placeholder: 0, annotation: 0, filler: 40, blank: 3 }),
        cellAnnotations: 14,
        imported: 6,
        queued: 0,
        rawOnly: {},
        unaccounted: 0,
      }),
    ]);
    // A preview stores the rows and writes no entity.
    const records = await adminDb.collection("sourceRecords").where("sourceKey", "==", sourceKey).get();
    expect(records.size).toBe(1 + 6 + 14);
    expect((await documentsOf("contributors")).size).toBe(0);

    expect((await adminDb.doc(`sources/${sourceKey}`).get()).data()).toMatchObject({
      key: sourceKey,
      title: "Contributor sheet of AlphaBeta2001 (alpha-beta)",
      kind: "googleSheet",
      authority: "live",
    });
    expect((await adminDb.doc(`sources/${sourceKey}/tabs/t0`).get()).data()).toMatchObject({
      name: "Sheet1",
      headerRow: 1,
      rowCount: 6,
      importerKey: "contributorSheets",
    });
    // The identifier and the address of the file are in the location document, which no client reads, and nowhere else.
    expect((await adminDb.doc(`sources/${sourceKey}/private/location`).get()).data()).toMatchObject({
      externalId: FILE_IDENTIFIERS["alpha-beta"],
      url: "https://sheets.example.org/alpha-beta/edit",
    });
    for (const [documentPath, { data }] of await allDocuments()) {
      expect(documentPath).not.toContain(FILE_IDENTIFIERS["alpha-beta"]);
      if (documentPath !== `sources/${sourceKey}/private/location`) {
        expect(JSON.stringify(data), documentPath).not.toContain(FILE_IDENTIFIERS["alpha-beta"]);
      }
    }
  });

  it("writes one contributor table and one contributor for each named row, with every cell verbatim", async () => {
    await applyWebsite();
    const report = await applySheet("alpha-beta");
    expect(report.status).toBe("applied");
    expect(report.collections.contributors).toMatchObject({ created: 6 });
    expect(report.collections.contributorTables).toMatchObject({ created: 1 });

    const header = (await adminDb.collection("sourceRecords").where("rowKey", "==", "header").get()).docs.find(
      (doc) => doc.get("sourceKey") === sourceKeyOf("alpha-beta"),
    );
    const tables = await documentsOf("contributorTables");
    expect([...tables.keys()]).toEqual([tableIdOf("alpha-beta")]);
    const table = tables.get(tableIdOf("alpha-beta"));
    expect(table).toMatchObject({
      replicationId: "AlphaBeta2001",
      sourceKey: sourceKeyOf("alpha-beta"),
      scopeKeys: ["rep:AlphaBeta2001"],
      sourceRecordId: header?.id,
    });
    // What kind of table it is, and whether it is published, is never read from its completeness.
    expect(table).not.toHaveProperty("isOnlySignupTable");
    expect(table).not.toHaveProperty("isPublished");

    const contributors = await documentsOf("contributors");
    expect(contributors.size).toBe(6);
    for (const id of contributors.keys()) expect(id).toMatch(/^ctr__[0-9a-f]{20}__[0-9a-f]{20}__1$/);
    const ada = await contributorOf("alpha-beta", "Ada", "Example");
    expect(ada).toMatchObject({
      firstNameSource: "Ada",
      surnameSource: "Example",
      orderInPublication: 1,
      affiliationSource: "University of Nowhere, Department of Examples, Nowhereland",
      affiliationSlotsSource: { "1": "University of Nowhere, Department of Examples, Nowhereland" },
      orcid: ORCID_ADA,
      agreementSource: "TRUE",
      reviewStatus: "needsReview",
      replicationId: "AlphaBeta2001",
      manuscriptId: null,
      contributorTableId: tableIdOf("alpha-beta"),
      personId: null,
      scopeKeys: ["rep:AlphaBeta2001"],
    });
    // The verbatim value of each of the fourteen role cells: a stored boolean, ticked or not.
    expect(Object.keys(ada?.creditRoles as object)).toHaveLength(14);
    expect(ada?.creditRoles).toMatchObject({
      conceptualization: true,
      supervision: true,
      writingReviewEditing: true,
      dataCuration: false,
      writingOriginalDraft: false,
    });
    expect(ada).not.toHaveProperty("middleNameSource");

    // A name cell is stored as written, with the space before it. Nothing is split, merged or re-cased.
    const hal = await contributorOf("alpha-beta", " Hal", "Nobody");
    expect(hal).toMatchObject({ firstNameSource: " Hal", orcid: ORCID_DEFECT, agreementSource: "FALSE" });
    const kit = await contributorOf("alpha-beta", "Kit", "Placeholder-Sample");
    expect(kit).toMatchObject({ middleNameSource: "Q.", surnameSource: "Placeholder-Sample", orderInPublication: 6 });
    // Each affiliation slot holds one string, which is never split at its semicolon.
    expect((await contributorOf("alpha-beta", "Ida", "Specimen"))?.affiliationSlotsSource).toEqual({
      "1": "Sample College, Specimen City",
      "2": "Mockup Institute; Example Clinic",
    });
    expect(await schemaProblems()).toEqual([]);
  });

  it("creates no person, grants nothing, and links no contributor to a person on a name", async () => {
    await applyWebsite();
    const before = await allDocuments();
    await applySheet("alpha-beta");
    const { created } = differences(before, await allDocuments());
    const collections = new Set(created.map((documentPath) => documentPath.split("/")[0]));
    // A contributor row creates no person, no identity key, no membership, no role and no access.
    for (const forbidden of ["persons", "identityKeys", "personEmailIndex", "roleAssignments", "access", "groups"]) {
      expect(collections.has(forbidden), forbidden).toBe(false);
    }
    expect(created.some((documentPath) => documentPath.includes("/memberships/"))).toBe(false);
    // The website knows a person of the same name. The row is not linked to that person: the question is queued.
    const people = await documentsOf("persons");
    const adaPerson = [...people].find(([, data]) => data.displayName === "Ada Example")?.[0] ?? "";
    expect(adaPerson).not.toBe("");
    expect((await contributorOf("alpha-beta", "Ada", "Example"))?.personId).toBeNull();
    const expected = items.duplicatePerson({
      subject: `contributorName/${nameHash("Ada", "Example")}`,
      claims: [
        { source: tableIdOf("alpha-beta"), value: idOf("alpha-beta", "Ada", "Example") },
        { source: "person", value: adaPerson },
      ],
    });
    const raised = (await itemsOf("alpha-beta", "duplicatePerson")).find((item) => item.id === expected.fingerprint);
    expect(raised?.entityRefs).toEqual([
      { entityType: "contributor", entityId: idOf("alpha-beta", "Ada", "Example") },
      { entityType: "person", entityId: adaPerson },
    ]);
    // A row with no identifier and no namesake anywhere is queued as well: only a person can say who it is.
    const jo = items.duplicatePerson({
      subject: `contributorName/${nameHash("Jo", "Mockup")}`,
      claims: [{ source: tableIdOf("alpha-beta"), value: idOf("alpha-beta", "Jo", "Mockup") }],
    });
    expect((await itemsOf("alpha-beta", "duplicatePerson")).map((item) => item.id)).toContain(jo.fingerprint);
    // A row with an address, and no namesake, raises nothing of the kind.
    expect((await itemsOf("alpha-beta", "duplicatePerson")).length).toBe(4);
  });

  it("links a contributor to a person who exists, by an address or a valid iD, and never by an iD that fails its check", async () => {
    await applyWebsite();
    const adaPerson = importedPersonId(personEvidenceKey.email("ada.example@example.org"), TEST_HASH_KEY);
    const halPerson = importedPersonId(personEvidenceKey.orcid(ORCID_DEFECT), TEST_HASH_KEY);
    const key = (kind: string, value: string, personId: string) =>
      adminDb.doc(`identityKeys/${identityKeyId("person", kind, value, TEST_HASH_KEY)}`).set({
        entityType: "person",
        keyKind: kind,
        entityIds: [personId],
        status: "active",
        mergedIntoId: null,
      });
    // The address of the sheet is written with capitals. It finds the key of the address in canonical form.
    await key("email", personEvidenceKey.email("ada.example@example.org"), adaPerson);
    await key("orcid", personEvidenceKey.orcid(ORCID_DEFECT), halPerson);
    await applySheet("alpha-beta");
    expect((await contributorOf("alpha-beta", "Ada", "Example"))?.personId).toBe(adaPerson);
    // The iD of this row fails its check digit. It is kept as written, queued, and used for no matching.
    const hal = await contributorOf("alpha-beta", " Hal", "Nobody");
    expect(hal).toMatchObject({ personId: null, orcid: ORCID_DEFECT });
    const defects = await itemsOf("alpha-beta", "identifierDefect");
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatchObject({
      field: "orcid",
      entityRefs: [{ entityType: "contributor", entityId: idOf("alpha-beta", " Hal", "Nobody") }],
    });
    expect(defects[0]?.id).toBe(
      items.identifierDefect({
        subject: idOf("alpha-beta", " Hal", "Nobody"),
        field: "orcid",
        claims: [{ source: sourceKeyOf("alpha-beta"), value: ORCID_DEFECT }],
      }).fingerprint,
    );
  });

  it("writes an address and a funding statement to the restricted contact document and to nothing a member reads", async () => {
    await applyWebsite();
    const first = await applySheet("alpha-beta");
    const second = await applySheet("epsilon");
    await applySheet("alpha-gamma");
    // The address is kept as the sheet writes it, capitals included.
    expect(await contactOf("alpha-beta", "Ada", "Example")).toMatchObject({ email: "Ada.Example@example.org" });
    expect(await contactOf("alpha-beta", "Kit", "Placeholder-Sample")).toMatchObject({
      email: "kit@example.org",
      fundingStatement: FUNDING_KIT,
    });
    expect(await contactOf("epsilon", "Nia", "Imagined")).toMatchObject({ fundingStatement: FUNDING_NIA });
    // A row with neither has no contact document.
    expect(await contactOf("alpha-beta", "Bo", "Fictional")).toBeUndefined();

    const documents = await allDocuments();
    const holding = [...documents].filter(([, { data }]) =>
      RESTRICTED_VALUES.some((value) => JSON.stringify(data).includes(value)),
    );
    for (const [documentPath, { data }] of holding) {
      expect(isMemberReadable(documentPath), documentPath).toBe(false);
      // Such a value is in the contact documents, in the raw rows and in the entries of the change log that hold
      // the state of a contact document for a rollback. No item, no batch record and no log entry holds one.
      expect(documentPath).toMatch(
        /^(contributors\/[^/]+\/private\/contact|sourceRecords\/[^/]+|importBatches\/[^/]+\/changes\/\d+)$/,
      );
      if (documentPath.startsWith("importBatches/")) {
        expect(data.documentPath).toMatch(/^contributors\/[^/]+\/private\/contact$/);
      }
    }
    expect(holding.length).toBeGreaterThan(0);
    // The reports of the runs, which the command line prints and the batches store, hold counts and identifiers only.
    for (const value of RESTRICTED_VALUES) {
      expect(JSON.stringify([first, second])).not.toContain(value);
    }
    for (const name of ["Hal", "Nobody", "Specimen", "Imagined", "Fictional"]) {
      expect(JSON.stringify([first, second]), name).not.toContain(name);
    }
    expect(await schemaProblems()).toEqual([]);
  });

  it("writes nothing on a second run, and passes every check of the verification", async () => {
    await applyWebsite();
    const file = await workbookFile(ALPHA_BETA_SHEET);
    await run(sheet("alpha-beta"), file, "apply");
    const before = await allDocuments();
    const again = await run(sheet("alpha-beta"), file, "apply");
    expect(again).toMatchObject({ status: "applied", documentsWritten: 0, changesCommitted: 0 });
    expect(again.sourceRecords).toMatchObject({ created: 0, superseded: 0, missing: 0 });
    const changed = differences(before, await allDocuments());
    // One write: the batch record.
    expect(changed.created).toEqual([`importBatches/${again.batchId}`]);
    expect(changed.rewritten).toEqual([]);
    expect(changed.removed).toEqual([]);
    // A fresh export of the unchanged sheet has another file hash and writes nothing either.
    const fresh = await run(sheet("alpha-beta"), await workbookFile(ALPHA_BETA_SHEET), "apply");
    expect(fresh.documentsWritten).toBe(0);
    const checks = await verify(sheet("alpha-beta"), file);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
    expect(checks.map((check) => check.key)).toContain("noAddress");
  });

  it("stores a reserved position as an annotation of the table, and reads the contributors after it", async () => {
    await applyWebsite();
    const report = await applySheet("epsilon");
    expect(report.tabs[0]).toMatchObject({
      rows: expect.objectContaining({ data: 3, placeholder: 2, filler: 30, blank: 0 }),
      imported: 3,
      unaccounted: 0,
    });
    expect((await documentsOf("contributors")).size).toBe(3);
    expect(await contributorOf("epsilon", "Nia", "Imagined")).toMatchObject({ orderInPublication: 5 });
    const placeholders = await itemsOf("epsilon", "annotationReview");
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]?.entityRefs).toEqual([{ entityType: "contributorTable", entityId: tableIdOf("epsilon") }]);
    // Nobody is flagged as corresponding author, which is a question about the table.
    const flag = await itemsOf("epsilon", "valueConflict");
    expect(flag).toHaveLength(1);
    expect(flag[0]).toMatchObject({ field: "correspondingAuthor", candidates: [{ valueSource: "noneFlagged" }] });
  });

  it("maps no column by guesswork: a blank header over data and a header over iDs it does not name are queued", async () => {
    await applyWebsite();
    await applySheet("epsilon");
    // The iDs under the header `Funding 2` are not read as iDs, and stay in the source records.
    expect(await contributorOf("epsilon", "Eli", "Madeup")).not.toHaveProperty("orcid");
    const misfit = await itemsOf("epsilon", "structureChange");
    expect(misfit).toHaveLength(1);
    expect(misfit[0]?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource)).toEqual([
      "Funding 2",
      "orcid",
    ]);

    await applySheet("alpha-gamma");
    expect(await contributorOf("alpha-gamma", "Ada", "Example")).not.toHaveProperty("orderInPublication");
    const blank = await itemsOf("alpha-gamma", "structureChange");
    // The column of whole numbers and the column of unticked boxes, each under a blank header.
    expect(blank.map((item) => item.candidates[0]?.valueSource).sort()).toEqual(["booleans", "integers"]);
    expect(blank.every((item) => item.id.length === 20)).toBe(true);
  });

  it("applies a column override of the registration, and only while the content of the column fits it", async () => {
    await applyWebsite();
    const overrides: ColumnOverride[] = [{ header: "Funding 2", field: "orcid" }];
    const file = await workbookFile(EPSILON_SHEET);
    await run(sheet("epsilon", overrides), file, "apply");
    // The decision of a maintainer maps the column, and the iD links as any other.
    expect(await contributorOf("epsilon", "Eli", "Madeup")).toMatchObject({ orcid: `https://orcid.org/${ORCID_ELI}` });
    expect(await contributorOf("epsilon", "Max", "Dummy")).toMatchObject({ orcid: ORCID_MAX });
    expect(await itemsOf("epsilon", "structureChange")).toEqual([]);
    // The registration is unchanged, so a second run writes nothing.
    expect((await run(sheet("epsilon", overrides), file, "apply")).documentsWritten).toBe(0);

    await run(
      sheet("alpha-gamma", [{ header: "", position: 1, field: "orderInPublication" }]),
      await workbookFile(ALPHA_GAMMA_SHEET),
      "apply",
    );
    expect(await contributorOf("alpha-gamma", "Lu", "Sample")).toMatchObject({ orderInPublication: 6 });
    // The other column without a header has no override and stays in the queue.
    expect((await itemsOf("alpha-gamma", "structureChange")).map((item) => item.candidates[0]?.valueSource)).toEqual([
      "booleans",
    ]);

    // Once the column holds something else, the override is not applied and an item says so.
    const changed = withRows(EPSILON_SHEET, [
      ...EPSILON_SHEET.rows.slice(0, 1),
      personRow({ order: 2, first: "Max", surname: "Dummy", orcid: "an invented remark about funding" }),
      ...EPSILON_SHEET.rows.slice(2),
    ]);
    await run(sheet("epsilon", overrides), await workbookFile(changed), "apply");
    const queued = await itemsOf("epsilon", "structureChange");
    expect(
      queued.map((item) => item.candidates.map((candidate: { key: string }) => candidate.key.split(":")[0])),
    ).toEqual(expect.arrayContaining([["override", "found"]]));
  });

  it("stores a word of the order column as a rule without a number, and queues what a person has to read", async () => {
    await applyWebsite();
    await applySheet("delta");
    const oz = await contributorOf("delta", "Oz", "Unreal");
    const rae = await contributorOf("delta", "Rae", "Hypothetical");
    expect(oz).not.toHaveProperty("orderInPublication");
    expect(rae).not.toHaveProperty("orderInPublication");
    expect(await contributorOf("delta", "Dee", "Imaginary")).toMatchObject({ orderInPublication: 2 });
    for (const rule of ["alphabetical", "last"]) {
      expect(
        (await adminDb.doc(`vocabularyTerms/${vocabularyTermId("authorOrderRule", rule)}`).get()).data(),
      ).toMatchObject({
        kind: "authorOrderRule",
        name: rule,
        labelsSource: [rule],
      });
    }
    const unparsed = await itemsOf("delta", "unparsedValue");
    const byField = (field: string) => unparsed.filter((item) => item.field === field);
    // The two words, and one item for the two rows that have no order while other rows have one.
    expect(byField("orderInPublication")).toHaveLength(3);
    expect(byField("orderInPublication").filter((item) => item.candidates.length === 2)).toHaveLength(1);
    // Two rows with no role ticked: not filled in yet, and never a statement that the person did nothing.
    expect(
      byField("creditRoles")
        .map((item) => item.entityRefs[0]?.entityId)
        .sort(),
    ).toEqual([idOf("delta", "Oz", "Unreal"), idOf("delta", "Pía", "Fabricated")].sort());
    expect(oz?.creditRoles).toMatchObject({ conceptualization: false, writingReviewEditing: false });
    // Two rows are flagged as corresponding author.
    const flags = await itemsOf("delta", "valueConflict");
    expect(flags).toHaveLength(1);
    expect(flags[0]?.candidates).toHaveLength(2);

    // An iD written as an address with a hyperlink is kept as written. Its check character X is valid.
    expect(await contributorOf("delta", "Quin", "Notional")).toMatchObject({
      orcid: `https://orcid.org/${ORCID_QUIN}`,
    });
    // An address with a letter outside ASCII is kept in the contact document, queued, and used for no matching.
    expect(await contactOf("delta", "Pía", "Fabricated")).toMatchObject({ email: "pía.fabricated@example.org" });
    const defects = await itemsOf("delta", "identifierDefect");
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatchObject({ field: "email" });
    expect(JSON.stringify(defects)).not.toContain("fabricated@");
  });

  it("reads a blank checkbox as unknown, keeps any other value verbatim, and queues both", async () => {
    await applyWebsite();
    const fixture: ContributorSheetFixture = {
      columns: sheetColumns(),
      rows: [
        personRow({
          order: 1,
          first: "Sam",
          surname: "Stand-In",
          roles: ["software"],
          corresponding: true,
          cells: { validation: null, resources: "x", supervision: "TRUE" },
        }),
      ],
    };
    await applySheet("alpha-beta", fixture);
    const sam = await contributorOf("alpha-beta", "Sam", "Stand-In");
    // A blank cell is absent, and never false. A text is kept as written.
    expect(sam?.creditRoles).not.toHaveProperty("validation");
    expect(sam?.creditRoles).toMatchObject({ resources: "x", supervision: "TRUE", software: true, methodology: false });
    const unparsed = await itemsOf("alpha-beta", "unparsedValue");
    expect(unparsed.map((item) => item.field).sort()).toEqual(["resources", "validation"]);
    expect(unparsed.find((item) => item.field === "validation")?.candidates[0]).toMatchObject({ valueSource: "blank" });
  });

  it("queues what the sheet says by formatting and by punctuation: a highlighted row and a semicolon", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    // The banding of the template is no highlight.
    expect(await itemsOf("alpha-beta", "formattingSignal")).toEqual([]);
    const semicolon = (await itemsOf("alpha-beta", "unparsedValue")).filter(
      (item) => item.field === "affiliationSlotsSource",
    );
    expect(semicolon).toHaveLength(1);
    expect(semicolon[0]?.candidates[0]).toMatchObject({ valueSource: "Mockup Institute; Example Clinic" });
    await applySheet("alpha-gamma");
    const highlight = await itemsOf("alpha-gamma", "formattingSignal");
    expect(highlight).toHaveLength(1);
    expect(highlight[0]).toMatchObject({
      field: "rowHighlight",
      entityRefs: [{ entityType: "contributor", entityId: idOf("alpha-gamma", "Bo", "Fictional") }],
      candidates: [{ valueSource: "FFFF00" }],
    });
    // A blank corresponding-author cell is unknown, and a question.
    const blank = (await itemsOf("alpha-gamma", "unparsedValue")).filter(
      (item) => item.field === "correspondingAuthor",
    );
    expect(blank.map((item) => item.entityRefs[0]?.entityId)).toEqual([idOf("alpha-gamma", "Ida", "Specimen")]);
  });

  it("makes each distinct affiliation string an institution candidate, and queues strings that may name one place", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    const candidates = await documentsOf("institutionCandidates");
    for (const text of [
      "University of Nowhere, Department of Examples, Nowhereland",
      "Sample College, Specimen City",
      "Mockup Institute; Example Clinic",
      "Mockup Institute, Department of Models",
      "Mockup Institute, Department of Models, Modelville",
    ]) {
      expect(candidates.get(institutionCandidateId(text) ?? ""), text).toMatchObject({
        affiliationsSource: [text],
        institutionId: null,
      });
    }
    // No institution is created or guessed, and no string is split at a comma or a semicolon.
    expect((await documentsOf("institutions")).size).toBe(0);
    const pairs = await itemsOf("alpha-beta", "institutionMatch");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource).sort()).toEqual([
      "Mockup Institute, Department of Models",
      "Mockup Institute, Department of Models, Modelville",
    ]);
  });

  it("seeds the vocabulary of the CRediT roles with the header and the note of each role column", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    const term = (
      await adminDb.doc(`vocabularyTerms/${vocabularyTermId("creditRole", "Writing - review & editing")}`).get()
    ).data();
    // The term is the one of the lookup data. The spelling of the sheet is added to it, and its note is the definition.
    expect(term).toMatchObject({
      sourceId: "writingReviewEditing",
      name: "Writing \u2013 review & editing",
      description: roleNote("writingReviewEditing"),
      labelsSource: ["Writing \u2013 review & editing", "Writing - review & editing"],
    });
    expect((await documentsOf("vocabularyTerms")).size).toBe(
      [...(await documentsOf("vocabularyTerms")).values()].filter((data) => data.kind !== "creditRole").length + 14,
    );
    // A sheet whose note differs does not overwrite the definition: the difference is queued.
    const changed: ContributorSheetFixture = {
      ...EPSILON_SHEET,
      columns: EPSILON_SHEET.columns.map((column) =>
        column.key === "software" ? { ...column, note: "Another invented definition of this role." } : column,
      ),
    };
    await applySheet("epsilon", changed);
    const software = (await adminDb.doc(`vocabularyTerms/${vocabularyTermId("creditRole", "Software")}`).get()).data();
    expect(software?.description).toBe(roleNote("software"));
    const conflicts = (await itemsOf("epsilon", "valueConflict")).filter((item) => item.field === "description");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource).sort()).toEqual(
      ["Another invented definition of this role.", roleNote("software")].sort(),
    );
  });
});

describe("contributors of several sheets", () => {
  it("queues one name in two sheets, its two addresses and its two affiliations, and merges nothing", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    const report = await applySheet("alpha-gamma");
    // A person in two sheets has two contributors, because roles, order and affiliation differ per manuscript.
    expect((await documentsOf("contributors")).size).toBe(12);
    const first = await contributorOf("alpha-beta", "Ada", "Example");
    const second = await contributorOf("alpha-gamma", "Ada", "Example");
    expect(first?.creditRoles).toMatchObject({ supervision: true, projectAdministration: false });
    expect(second?.creditRoles).toMatchObject({ supervision: false, projectAdministration: true });
    expect([first?.personId, second?.personId]).toEqual([null, null]);

    // One name with two different addresses: neither is preferred, and neither address is shown in the item.
    const hal = `contributorName/${nameHash("Hal", "Nobody")}`;
    const addresses = items.ambiguousEmail({
      subject: hal,
      field: "email",
      claims: [
        { source: tableIdOf("alpha-gamma"), value: "h.nobody@example.org" },
        { source: tableIdOf("alpha-beta"), value: "hal.nobody@example.org" },
      ],
    });
    const ambiguous = await itemsOf("alpha-gamma", "ambiguousEmail");
    expect(ambiguous.map((item) => item.id)).toEqual([addresses.fingerprint]);
    expect(ambiguous[0]?.entityRefs).toEqual([
      { entityType: "contributor", entityId: idOf("alpha-gamma", "Hal", "Nobody") },
      { entityType: "contributor", entityId: idOf("alpha-beta", "Hal", "Nobody") },
    ]);
    expect(JSON.stringify(ambiguous)).not.toContain("example.org");
    // The same address in another case is one address, and no question.
    expect(report.items.raise.ambiguousEmail).toBe(1);

    // One name with two affiliation strings: a move, or one place written in two ways.
    const moved = (await itemsOf("alpha-gamma", "institutionMatch")).filter((item) => item.field === "affiliation");
    expect(moved).toHaveLength(1);
    expect(moved[0]?.id).toBe(
      items.institutionMatch({
        subject: `contributorName/${nameHash("Ada", "Example")}`,
        field: "affiliation",
        claims: [
          { source: tableIdOf("alpha-gamma"), value: "University of Nowhere" },
          { source: tableIdOf("alpha-beta"), value: "University of Nowhere, Department of Examples, Nowhereland" },
        ],
      }).fingerprint,
    );

    // A first name that differs between the two sheets, under one surname and one initial.
    const variant = (await itemsOf("alpha-gamma", "duplicatePerson")).filter(
      (item) =>
        item.entityRefs.every((ref: { entityType: string }) => ref.entityType === "contributor") &&
        item.entityRefs.some((ref: { entityId: string }) => ref.entityId === idOf("alpha-beta", "Jo", "Mockup")),
    );
    expect(variant).toHaveLength(1);
    expect(variant[0]?.entityRefs).toEqual([
      { entityType: "contributor", entityId: idOf("alpha-gamma", "Jon", "Mockup") },
      { entityType: "contributor", entityId: idOf("alpha-beta", "Jo", "Mockup") },
    ]);
  });

  it("settles the questions of two sheets in one pass: the second sheet supersedes what the first stated alone", async () => {
    await applyWebsite();
    const betaFile = await workbookFile(ALPHA_BETA_SHEET);
    const gammaFile = await workbookFile(ALPHA_GAMMA_SHEET);
    await run(sheet("alpha-beta"), betaFile, "apply");
    const alone = items.duplicatePerson({
      subject: `contributorName/${nameHash("Bo", "Fictional")}`,
      shared: true,
      claims: [
        { source: tableIdOf("alpha-beta"), value: idOf("alpha-beta", "Bo", "Fictional") },
        {
          source: "person",
          value: [...(await documentsOf("persons"))].find(([, data]) => data.displayName === "Bo Fictional")?.[0] ?? "",
        },
      ],
    });
    const stored = await adminDb.doc(`reconciliationItems/${alone.fingerprint}`).get();
    expect(stored.get("status")).toBe("open");
    // Every statement of the question carries the key of the question, whatever its candidates.
    expect(stored.get("subjectKey")).toBe(alone.subjectKey);

    // The second sheet states the question with the rows of both sheets, and the earlier statement gives way at once.
    const second = await run(sheet("alpha-gamma"), gammaFile, "apply");
    expect(second.items.supersede.duplicatePerson).toBeGreaterThan(0);
    const outdated = await adminDb.doc(`reconciliationItems/${alone.fingerprint}`).get();
    expect(outdated.get("status")).toBe("superseded");
    expect(outdated.get("sourceKey")).toBe(sourceKeyOf("alpha-beta"));

    // Neither sheet has anything left to write, and the verification of the first sheet holds without a second pass.
    const database = await allDocuments();
    expect((await run(sheet("alpha-gamma"), gammaFile, "apply")).documentsWritten).toBe(0);
    expect((await run(sheet("alpha-beta"), betaFile, "apply")).documentsWritten).toBe(0);
    // What differs afterwards is the record of each of the two runs, and nothing else.
    const { created, removed, rewritten } = differences(database, await allDocuments());
    expect([removed, rewritten]).toEqual([[], []]);
    expect(created.every((documentPath) => /^importBatches\/[^/]+$/.test(documentPath))).toBe(true);
    expect(created).toHaveLength(2);
    const checks = await verify(sheet("alpha-beta"), betaFile);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("asks the same open questions whichever sheet is read first", async () => {
    const openQuestions = async (order: readonly SheetName[]) => {
      await freshDatabase();
      await applyWebsite();
      for (const name of order) await applySheet(name);
      // An item names the sheet that raised it, so the questions are compared by what they ask.
      return (await reconciliationItems())
        .filter((item) => item.status === "open" && String(item.sourceKey).startsWith("ctable-"))
        .filter((item) => ["duplicatePerson", "ambiguousEmail", "institutionMatch"].includes(item.kind))
        .map((item) => item.id)
        .sort();
    };
    const forwards = await openQuestions(["alpha-beta", "alpha-gamma"]);
    const backwards = await openQuestions(["alpha-gamma", "alpha-beta"]);
    expect(forwards.length).toBeGreaterThan(0);
    expect(backwards).toEqual(forwards);
  });

  it("never lets two sheets close each other's statement where neither holds all candidates of the other", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    await applySheet("alpha-gamma");
    const subject = `contributorName/${nameHash("Ada", "Example")}`;
    const [open] = (await reconciliationItems()).filter(
      (item) => item.status === "open" && item.kind === "duplicatePerson" && item.subjectKey !== undefined,
    );
    expect(open).toBeDefined();
    // A statement of the same question with a candidate of its own, as another source of the family may have made it.
    const other = items.duplicatePerson({
      subject,
      shared: true,
      claims: [{ source: "ctable__0123456789abcdef0123", value: "a-row-that-neither-sheet-holds" }],
    });
    const { id: _id, ...statement } = open ?? { id: "" };
    await adminDb.doc(`reconciliationItems/${other.fingerprint}`).set({
      ...statement,
      candidates: other.candidates,
      subjectKey: other.subjectKey,
      sourceKey: "ctable-0123456789abcdef0123",
    });
    const again = await applySheet("alpha-gamma");
    expect(again.items.supersede).toEqual({});
    expect((await adminDb.doc(`reconciliationItems/${other.fingerprint}`).get()).get("status")).toBe("open");
  });
});

describe("a contributor sheet that changes", () => {
  it("follows the source where a field still holds what the sheet said, and leaves an edit of the portal alone", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    const reference = adminDb.doc(`contributors/${idOf("alpha-beta", "Bo", "Fictional")}`);
    const firstRecord = (await reference.get()).get("sourceRecordId") as string;
    // A coordinator corrects the order in the portal.
    await reference.update({ orderInPublication: 9, updatedBy: "uid-of-a-coordinator" });
    const changed = withRows(ALPHA_BETA_SHEET, [
      ALPHA_BETA_SHEET.rows[0] as FixtureRow,
      personRow({
        order: 7,
        first: "Bo",
        surname: "Fictional",
        roles: ["investigation", "validation"],
        affiliations: ["Institute of Fiction"],
      }),
      ...ALPHA_BETA_SHEET.rows.slice(2),
    ]);
    const report = await applySheet("alpha-beta", changed);
    expect(report.sourceRecords).toMatchObject({ created: 1, superseded: 1 });
    expect(report.collections.contributors).toMatchObject({ created: 0, changed: 1 });
    const bo = (await reference.get()).data();
    // The role cell follows the sheet. The order keeps the value of the portal, with the new source value beside it.
    expect(bo?.creditRoles).toMatchObject({ investigation: true, validation: true });
    expect(bo?.orderInPublication).toBe(9);
    expect(bo?.importedValues).toMatchObject({ orderInPublication: 7 });
    expect(bo?.sourceRecordId).not.toBe(firstRecord);
    // The earlier revision of the row is kept and names its successor.
    expect((await adminDb.doc(`sourceRecords/${firstRecord}`).get()).get("supersededById")).toBe(bo?.sourceRecordId);
    const conflicts = (await itemsOf("alpha-beta", "valueConflict")).filter(
      (item) => item.field === "orderInPublication",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.candidates.map((candidate: { key: string }) => candidate.key.split(":")[0]).sort()).toEqual([
      sourceKeyOf("alpha-beta"),
      "portal",
    ]);
    // The change log holds the state before and after, so the batch can be reversed.
    const changes = await adminDb.collection(`importBatches/${report.batchId}/changes`).get();
    const logged = changes.docs.find((doc) => doc.get("documentPath") === reference.path);
    expect(logged?.get("before")).toMatchObject({ orderInPublication: 9 });
    expect(logged?.get("relation")).toBe("updated");
  });

  it("deletes nothing when a row disappears, and queues the contributor that the sheet no longer names", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    const without = withRows(
      ALPHA_BETA_SHEET,
      ALPHA_BETA_SHEET.rows.filter((_row, index) => index !== 4),
    );
    const report = await applySheet("alpha-beta", without);
    expect(report.sourceRecords).toMatchObject({ created: 0, missing: 1 });
    expect(await contributorOf("alpha-beta", "Jo", "Mockup")).toMatchObject({ firstNameSource: "Jo" });
    const missing = await itemsOf("alpha-beta", "missingFromSource");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.entityRefs).toEqual([
      { entityType: "contributor", entityId: idOf("alpha-beta", "Jo", "Mockup") },
    ]);
  });

  it("stops when a header is new or gone since the last run, until a reviewer has accepted the change", async () => {
    await applyWebsite();
    await applySheet("alpha-beta");
    const renamed: ContributorSheetFixture = {
      ...ALPHA_BETA_SHEET,
      columns: ALPHA_BETA_SHEET.columns.map((column) =>
        column.key === "funding" ? { ...column, header: "Funding statement" } : column,
      ),
    };
    const file = await workbookFile(renamed);
    const before = await allDocuments();
    const blocked = await run(sheet("alpha-beta"), file, "apply");
    expect(blocked.status).toBe("failed");
    expect(blocked.blocking.map((check) => check.check)).toEqual(["headers"]);
    expect(blocked.tabs[0]).toMatchObject({ imported: 0, rawOnly: { blocked: 6 } });
    const written = differences(before, await allDocuments());
    // Nothing of the sheet is written except the raw rows and the item that explains the stop.
    expect(written.rewritten.filter((documentPath) => documentPath.startsWith("contributors"))).toEqual([]);
    const [item] = (await reconciliationItems()).filter(
      (candidate) => candidate.kind === "structureChange" && candidate.batchId === blocked.batchId,
    );
    expect(item?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource).sort()).toEqual([
      "Funding",
      "Funding statement",
    ]);
    // The message of the check quotes no header and no cell.
    expect(blocked.blocking[0]?.message).toBe(
      "The headers have changed since the last run of the sheet: 1 are gone and 1 are new.",
    );

    await adminDb.doc(`reconciliationItems/${item?.id}`).update({
      status: "resolved",
      resolvedBy: "uid-of-a-reviewer",
      resolvedAt: Timestamp.now(),
    });
    const accepted = await run(sheet("alpha-beta"), file, "apply");
    expect(accepted.status).toBe("applied");
    // The renamed column is one that the mapping does not know: it is reported, and its cells stay raw.
    expect((await itemsOf("alpha-beta", "structureChange")).map((entry) => entry.candidates[0]?.valueSource)).toEqual([
      "Funding statement",
    ]);
    expect((await run(sheet("alpha-beta"), file, "apply")).documentsWritten).toBe(0);
  });
});

describe("rows and sheets that the importer refuses", () => {
  it("imports neither of two rows of one name, nor a row with one of its two names, and holds them in the queue", async () => {
    await applyWebsite();
    const fixture: ContributorSheetFixture = {
      columns: sheetColumns(),
      rows: [
        personRow({ order: 1, first: "Ada", surname: "Example", roles: ["software"], corresponding: true }),
        personRow({ order: 2, first: "ADA", surname: "example", roles: ["software"] }),
        personRow({ order: 3, first: "Sam", surname: null, roles: ["software"] }),
        personRow({ order: 4, first: "Tess", surname: "Trial", roles: ["software"] }),
        personRow({ first: null, surname: null, roles: ["validation"] }),
      ],
    };
    const report = await applySheet("alpha-beta", fixture);
    expect(report.tabs[0]).toMatchObject({
      rows: expect.objectContaining({ data: 4, annotation: 1 }),
      imported: 1,
      queued: 3,
      unaccounted: 0,
    });
    expect([...(await documentsOf("contributors")).keys()]).toEqual([idOf("alpha-beta", "Tess", "Trial")]);
    const twins = (await itemsOf("alpha-beta", "duplicatePerson")).filter((item) => item.candidates.length === 2);
    expect(twins).toHaveLength(1);
    expect((await itemsOf("alpha-beta", "unparsedValue")).filter((item) => item.field === "name")).toHaveLength(1);
    // A tick on a row without a name is kept as an annotation and queued.
    expect(await itemsOf("alpha-beta", "annotationReview")).toHaveLength(1);
  });

  it("stops a sheet whose replication does not exist, and one that the database files under another replication", async () => {
    const missing = await applySheet("alpha-beta");
    expect(missing.status).toBe("failed");
    expect(missing.blocking.map((check) => check.check)).toEqual(["replication"]);
    expect((await documentsOf("contributors")).size).toBe(0);
    expect(await itemCounts()).toEqual({ unmatchedIdentifier: 1 });

    await applyWebsite();
    // Another source has registered the table of this sheet under another replication.
    await adminDb.doc(`contributorTables/${tableIdOf("alpha-beta")}`).set({
      replicationId: "Delta1999",
      sourceKey: sourceKeyOf("alpha-beta"),
      scopeKeys: ["rep:Delta1999"],
    });
    const conflicting = await applySheet("alpha-beta");
    expect(conflicting.blocking.map((check) => check.check)).toEqual(["registry"]);
    expect((await documentsOf("contributors")).size).toBe(0);
    const [conflict] = await itemsOf("alpha-beta", "valueConflict");
    // Both statements are kept, and neither is chosen.
    expect(conflict?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource).sort()).toEqual([
      "AlphaBeta2001",
      "Delta1999",
    ]);
    expect((await adminDb.doc(`contributorTables/${tableIdOf("alpha-beta")}`).get()).get("replicationId")).toBe(
      "Delta1999",
    );
  });

  it("stops a workbook with a second tab or without a role header, and writes the item that says why at preview", async () => {
    await applyWebsite();
    const second = await run(
      sheet("alpha-beta"),
      await workbookFile({ ...ALPHA_BETA_SHEET, secondTab: true }),
      "preview",
    );
    expect(second.blocking.map((check) => check.check)).toEqual(["tabs"]);
    const columns = sheetColumns().filter((column) => column.key !== "investigation");
    const headless = await run(
      sheet("alpha-beta"),
      await workbookFile({ columns, rows: ALPHA_BETA_SHEET.rows }),
      "preview",
    );
    expect(headless.blocking.map((check) => check.check)).toEqual(["header"]);
    expect(headless.tabs[0]).toMatchObject({ imported: 0, rawOnly: { blocked: 6 } });
    expect((await itemsOf("alpha-beta", "structureChange")).length).toBe(2);
    expect((await documentsOf("contributors")).size).toBe(0);
  });
});

describe("the command line with a contributor sheet", () => {
  it("lists the family, refuses an unregistered sheet, and prints counts and identifiers only", async () => {
    await applyWebsite();
    const directory = temporaryDirectory();
    const config = path.join(directory, "sources.json");
    writeFileSync(config, JSON.stringify(configWith()));
    const file = await workbookFile(ALPHA_BETA_SHEET);

    const listed = importCli(["list"]);
    expect(listed.stdout).toMatch(/^ {2}ctable {2}Contributor sheets: contributorSheets\..*--sheet\.$/m);

    const base = [
      "run",
      "ctable",
      "--input",
      file,
      "--mode",
      "apply",
      "--observed-on",
      OBSERVED_ON,
      "--config",
      config,
    ];
    const unnamed = importCli(base);
    expect(unnamed.status).toBe(2);
    expect(unnamed.stderr).toContain("--sheet");
    const unregistered = importCli([...base, "--sheet", "another-sheet"]);
    expect(unregistered.status).toBe(2);
    expect(unregistered.stderr).toContain("registers no contributor sheet");

    // Every member could read an applied list, so the apply is withheld. A preview is possible.
    const withheld = importCli([...base, "--sheet", "alpha-beta"]);
    expect(withheld.status).toBe(2);
    expect(withheld.stderr).toContain("the contributor lists, which every member could read, are withheld");
    expect(withheld.stderr).toContain("question 10");
    expect((await documentsOf("contributors")).size).toBe(0);
    const previewed = importCli([
      ...base.map((argument) => (argument === "apply" ? "preview" : argument)),
      "--sheet",
      "alpha-beta",
    ]);
    expect(previewed.status).toBe(0);
    expect(previewed.stdout).toContain("contributors: 6 to create");
    expect((await documentsOf("contributors")).size).toBe(0);

    // This emulator rehearses the withheld output, as its private configuration says.
    writeFileSync(config, JSON.stringify({ ...configWith(), rehearse: ["contributorLists"] }));
    const applied = importCli([...base, "--sheet", "alpha-beta"]);
    expect(applied.stderr).toBe("");
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain(`import apply of source ${sourceKeyOf("alpha-beta")}`);
    expect(applied.stdout).toContain(
      "t0: 1 header, 6 data, 40 filler, 3 blank. Data rows: 6 imported, 0 held in the queue. 14 cell annotations.",
    );
    expect(applied.stdout).toContain("contributors: 6 created");
    // Neither a name, an address, a statement, an iD nor the identifier of the file reaches the output.
    for (const secret of [
      ...RESTRICTED_VALUES,
      "Ada",
      "Nobody",
      "Specimen",
      ORCID_ADA,
      FILE_IDENTIFIERS["alpha-beta"],
      "sheets.example.org",
    ]) {
      expect(applied.output, secret).not.toContain(secret);
    }
    const verify = () =>
      importCli([
        "verify",
        "ctable",
        "--sheet",
        "alpha-beta",
        "--input",
        file,
        "--observed-on",
        OBSERVED_ON,
        "--config",
        config,
      ]);
    // Without a stated baseline of rows the import is not verified.
    const unstated = verify();
    expect(unstated.status).toBe(3);
    expect(unstated.stdout).toContain("FAILED  rowBaseline: no baseline of rows is stated for this source");
    const sheets = configWith().contributorSheets ?? {};
    const baseline = { Sheet1: { header: 1, data: 6, filler: 40, blank: 3 } };
    writeFileSync(
      config,
      JSON.stringify({
        ...configWith(),
        rehearse: ["contributorLists"],
        contributorSheets: { ...sheets, "alpha-beta": { ...sheets["alpha-beta"], baseline } },
      }),
    );
    const verified = verify();
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain(
      "passed  rowBaseline: 4 counts of 1 tabs compared with the stated baseline, all equal",
    );
    expect(verified.stdout).toContain("Every check passed.");
  });
});
