// Integration tests of explicit consent to holding a person's gender and ethnicity, as the
// programme decided on 13 November 2026 (docs/MIGRATION_PLAN.md, section 11, question 20):
// giving, reviewing and withdrawing consent, entering and confirming one's own values, the
// deletion of every copy on withdrawal, the counts of consenting people alone and the subject
// access export. Fixtures are synthetic: fictitious people and accounts on the example.org domain.
import {
  COLLECTIONS,
  CURRENT_DEMOGRAPHICS_CONSENT,
  exportPersonDataContract,
  getDemographicAggregatesContract,
  getPersonDemographicsContract,
  personDemographicsConsentDocSchema,
  saveOwnDemographicsContract,
  sequenceId,
  setDemographicsConsentContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import { recordConsent } from "../support/consent";
import {
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  dataOf,
  grantCapability,
  laboratory,
  person,
  refusal,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const VERSION = CURRENT_DEMOGRAPHICS_CONSENT.version;
const RECORDED = { genderSource: "synthetic gender term R", ethnicitySource: "synthetic ethnicity term S" };
const OWN_WORDS = { gender: "synthetic own words G", ethnicity: "synthetic own words E" };
const VALUES = [...Object.values(RECORDED), ...Object.values(OWN_WORDS)];

async function linkedMember(uid: string, personId: string, fields: Record<string, unknown> = {}): Promise<Caller> {
  await person(personId, [], { userId: uid, ...fields });
  return account(uid, { personId });
}

const give = (caller: Caller) =>
  call(caller, setDemographicsConsentContract, { status: "given", wordingVersion: VERSION });
const withdraw = (caller: Caller) =>
  call(caller, setDemographicsConsentContract, { status: "withdrawn", wordingVersion: VERSION });
const consentOf = async (personId: string) =>
  personDemographicsConsentDocSchema.parse(await dataOf(COLLECTIONS.personDemographicsConsent.docPath(personId)));

/** The values of a person as an import of source G writes them, with the copies that the import keeps. */
async function importedValues(personId: string, recordId: string): Promise<{ state: string; cell: string }> {
  const valuesPath = COLLECTIONS.personDemographics.docPath(personId);
  await adminDb.doc(valuesPath).set({
    ...standard(),
    ...RECORDED,
    sourceRecordId: recordId,
    sourceRecordIds: [recordId],
    recordedAt: Timestamp.now(),
  });
  const change = COLLECTIONS.importBatchChanges.docPath("batch-consent", sequenceId(1));
  await adminDb.doc(change).set({
    ...standard(),
    batchId: "batch-consent",
    documentPath: COLLECTIONS.personDemographics.path,
    operation: "create",
    relation: "created",
    sourceRecordIds: [recordId],
    before: null,
    after: { specialCategory: true },
  });
  const state = COLLECTIONS.importBatchChangeState.docPath("batch-consent", sequenceId(1));
  await adminDb.doc(state).set({ ...standard(), documentPath: valuesPath, before: null, after: RECORDED });
  const cell = COLLECTIONS.sourceRecordSpecial.docPath(recordId);
  await adminDb.doc(cell).set({ ...standard(), sourceRecordId: recordId, raw: { H: RECORDED.genderSource } });
  return { state, cell };
}

describe("giving and reviewing consent", () => {
  it("records the time, the wording read and the decision behind it, and audits the act without a value", async () => {
    const self = await linkedMember("uid-consent-self", "person-consent-self");
    const given = await give(self);
    expect(given).toMatchObject({ personId: "person-consent-self", status: "given", valuesDeleted: false });

    const record = await consentOf("person-consent-self");
    expect(record).toMatchObject({
      personId: "person-consent-self",
      uid: "uid-consent-self",
      status: "given",
      wordingVersion: VERSION,
      withdrawnAt: null,
      basis: { decidedBy: "programmeLead", decidedOn: "2026-11-13" },
    });
    expect(record.givenAt?.toDate().toISOString()).toBe(given.at);
    expect(record.basis.reference).toContain("question 20");
    expect(record.history).toHaveLength(1);
    const [entry] = await auditOf("demographics.consentGiven", "person-consent-self");
    expect(entry?.actorUid).toBe("uid-consent-self");
    const entryIds = (
      await adminDb.collection("auditEvents").where("action", "==", "demographics.consentGiven").get()
    ).docs.map((document) => document.id);
    expect(entryIds).toEqual([record.history[0]?.auditEventId]);
    expect(entry?.changes).toContainEqual({ field: "wordingVersion", before: null, after: VERSION });

    // Giving consent again to the same words changes nothing and writes no second entry.
    await give(self);
    expect((await consentOf("person-consent-self")).history).toHaveLength(1);
    expect(await auditOf("demographics.consentGiven", "person-consent-self")).toHaveLength(1);
  });

  it("refuses an account that is not linked to a person, a wording that does not exist, and a withdrawal without consent", async () => {
    const unlinked = await account("uid-consent-unlinked");
    expect(await codeOf(give(unlinked))).toBe("failed-precondition");
    const self = await linkedMember("uid-consent-none", "person-consent-none");
    expect(
      await codeOf(
        call(self, setDemographicsConsentContract, {
          status: "given",
          wordingVersion: "1999-01-01" as typeof VERSION,
        }),
      ),
    ).toBe("invalid-argument");
    expect((await refusal(withdraw(self))).message).toContain("nothing to withdraw");
    expect(await dataOf(COLLECTIONS.personDemographicsConsent.docPath("person-consent-none"))).toBeUndefined();
  });

  it("refuses an account whose access names a person that another account holds", async () => {
    await person("person-consent-taken", [], { userId: "uid-consent-holder" });
    const stranger = await account("uid-consent-stranger", { personId: "person-consent-taken" });
    expect(await codeOf(give(stranger))).toBe("permission-denied");
  });
});

describe("entering and confirming one's own values", () => {
  it("needs consent in force, stores the person's own words beside the recorded terms and never changes those", async () => {
    const self = await linkedMember("uid-own-values", "person-own-values");
    const words = { genderSelfDescribed: OWN_WORDS.gender, ethnicitySelfDescribed: OWN_WORDS.ethnicity };
    expect(
      (await refusal(call(self, saveOwnDemographicsContract, { ...words, confirmRecorded: false }))).message,
    ).toContain("Give your consent first");
    expect(await dataOf(COLLECTIONS.personDemographics.docPath("person-own-values"))).toBeUndefined();

    await give(self);
    // Nothing is recorded yet, so there is nothing to confirm.
    expect(await codeOf(call(self, saveOwnDemographicsContract, { ...words, confirmRecorded: true }))).toBe(
      "failed-precondition",
    );
    expect(await call(self, saveOwnDemographicsContract, { ...words, confirmRecorded: false })).toEqual({
      personId: "person-own-values",
      held: true,
    });
    const own = await call(self, getPersonDemographicsContract, { personId: "person-own-values" });
    expect(own.demographics).toMatchObject(words);

    // Recorded terms arrive from an import. The person confirms them and clears one of their own fields.
    await adminDb.doc(COLLECTIONS.personDemographics.docPath("person-own-values")).update(RECORDED);
    await call(self, saveOwnDemographicsContract, {
      genderSelfDescribed: OWN_WORDS.gender,
      ethnicitySelfDescribed: null,
      confirmRecorded: true,
    });
    const stored = await dataOf(COLLECTIONS.personDemographics.docPath("person-own-values"));
    expect(stored).toMatchObject({ ...RECORDED, genderSelfDescribed: OWN_WORDS.gender });
    expect(stored).not.toHaveProperty("ethnicitySelfDescribed");
    expect(stored?.confirmedAt).toBeInstanceOf(Timestamp);

    const entries = await auditOf("demographics.ownSaved", "person-own-values");
    expect(entries).toHaveLength(2);
    for (const value of VALUES) expect(JSON.stringify(entries)).not.toContain(value);
    expect(entries.flatMap((entry) => entry.changes.map((change) => change.field))).toEqual(
      expect.arrayContaining(["genderSelfDescribed", "ethnicitySelfDescribed", "confirmedAt"]),
    );
  });

  it("deletes the document once the person has cleared every value", async () => {
    const self = await linkedMember("uid-own-cleared", "person-own-cleared");
    await give(self);
    await call(self, saveOwnDemographicsContract, {
      genderSelfDescribed: OWN_WORDS.gender,
      ethnicitySelfDescribed: null,
      confirmRecorded: false,
    });
    expect(
      await call(self, saveOwnDemographicsContract, {
        genderSelfDescribed: "",
        ethnicitySelfDescribed: null,
        confirmRecorded: false,
      }),
    ).toEqual({ personId: "person-own-cleared", held: false });
    expect(await dataOf(COLLECTIONS.personDemographics.docPath("person-own-cleared"))).toBeUndefined();
  });
});

describe("withdrawing consent", () => {
  it("deletes the values at once with every copy that an import kept, and keeps the record of both acts", async () => {
    const self = await linkedMember("uid-withdraw", "person-withdraw", { sourceRecordIds: ["record-withdraw"] });
    await give(self);
    const { state, cell } = await importedValues("person-withdraw", "record-withdraw");
    // A copy that belongs to another person is no copy of these values and stays.
    await adminDb.doc(COLLECTIONS.importBatchChangeState.docPath("batch-other", sequenceId(1))).set({
      ...standard(),
      documentPath: COLLECTIONS.personDemographics.docPath("person-someone-else"),
      before: null,
      after: { genderSource: "synthetic term of someone else" },
    });

    const withdrawn = await withdraw(self);
    expect(withdrawn).toMatchObject({ status: "withdrawn", valuesDeleted: true });
    for (const path of [COLLECTIONS.personDemographics.docPath("person-withdraw"), state, cell]) {
      expect(await dataOf(path), path).toBeUndefined();
    }
    expect(await dataOf(COLLECTIONS.importBatchChangeState.docPath("batch-other", sequenceId(1)))).toBeDefined();

    const record = await consentOf("person-withdraw");
    expect(record.status).toBe("withdrawn");
    expect(record.withdrawnAt?.toDate().toISOString()).toBe(withdrawn.at);
    expect(record.givenAt).not.toBeNull();
    expect(record.history.map((event) => event.status)).toEqual(["given", "withdrawn"]);
    const [entry] = await auditOf("demographics.consentWithdrawn", "person-withdraw");
    expect(entry?.changes).toEqual(
      expect.arrayContaining([
        { field: "valuesDeleted", after: true },
        { field: "copiesDeleted", after: 2 },
      ]),
    );
    expect(JSON.stringify(entry)).not.toContain("synthetic gender");

    // Nothing can be entered until consent is given again, and the person sees that nothing is held.
    expect(
      await codeOf(
        call(self, saveOwnDemographicsContract, {
          genderSelfDescribed: OWN_WORDS.gender,
          ethnicitySelfDescribed: null,
          confirmRecorded: false,
        }),
      ),
    ).toBe("failed-precondition");
    expect((await call(self, getPersonDemographicsContract, { personId: "person-withdraw" })).demographics).toBeNull();
    await give(self);
    expect((await consentOf("person-withdraw")).history.map((event) => event.status)).toEqual([
      "given",
      "withdrawn",
      "given",
    ]);
  });
});

describe("the values of a person without consent", () => {
  it("are served to no holder of a grant and counted in no aggregate, and a withdrawal leaves the next count", async () => {
    await laboratory("lab-consent-counts");
    // Nine people hold the first category and eight the second. Six of each have consented.
    const categories = [...Array(9).fill("syntheticA"), ...Array(8).fill("syntheticB")] as string[];
    const consenting = new Set([0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14]);
    const ids = categories.map((_category, index) => `person-consent-count-${index}`);
    for (const [index, id] of ids.entries()) {
      await person(id, [], { laboratoryIds: ["lab-consent-counts"], userId: `uid-consent-count-${index}` });
      await adminDb
        .doc(COLLECTIONS.personDemographics.docPath(id))
        .set({ ...standard(), genderCategory: categories[index], recordedAt: Timestamp.now() });
      if (consenting.has(index)) await recordConsent(id);
    }

    const reader = await administrator("uid-consent-reader");
    await grantCapability(reader.uid, "demographics.read");
    const counts = async () =>
      (
        await call(reader, getDemographicAggregatesContract, {
          scopeType: "laboratory",
          scopeId: "lab-consent-counts",
          field: "genderCategory",
        })
      ).cells;
    // The five people without consent count as having nothing recorded, whatever the document still says.
    expect(await counts()).toEqual(
      expect.arrayContaining([
        { category: "syntheticA", count: 6 },
        { category: "syntheticB", count: 6 },
        { category: "Not recorded", count: 5 },
      ]),
    );
    expect((await call(reader, getPersonDemographicsContract, { personId: ids[6] ?? "" })).demographics).toBeNull();
    expect((await call(reader, getPersonDemographicsContract, { personId: ids[0] ?? "" })).demographics).toMatchObject({
      genderCategory: "syntheticA",
    });

    // One consenting person withdraws, and the next count holds one fewer of that category.
    const leaver = await account("uid-consent-count-0", { personId: ids[0] ?? "" });
    await withdraw(leaver);
    expect(await counts()).toEqual(
      expect.arrayContaining([
        { category: "syntheticA", count: 5 },
        { category: "syntheticB", count: 6 },
        { category: "Not recorded", count: 6 },
      ]),
    );
    expect(await dataOf(COLLECTIONS.personDemographics.docPath(ids[0] ?? ""))).toBeUndefined();
  });
});

describe("the subject access export", () => {
  it("holds the record of consent, with the time and the wording of each act, whatever the caller's grant", async () => {
    const self = await linkedMember("uid-consent-export", "person-consent-export");
    await give(self);
    await withdraw(self);
    const admin = await administrator("uid-consent-export-admin");
    const exported = await call(admin, exportPersonDataContract, { personId: "person-consent-export" });
    expect(exported.specialCategoryIncluded).toBe(false);
    const record = exported.documents.find(
      (document) => document.path === COLLECTIONS.personDemographicsConsent.docPath("person-consent-export"),
    );
    expect(record?.data).toMatchObject({
      status: "withdrawn",
      wordingVersion: VERSION,
      history: [
        { status: "given", wordingVersion: VERSION },
        { status: "withdrawn", wordingVersion: VERSION },
      ],
    });
    const actions = exported.documents
      .filter((document) => document.path.startsWith("auditEvents/"))
      .map((document) => (document.data as { action?: string }).action);
    expect(actions).toEqual(expect.arrayContaining(["demographics.consentGiven", "demographics.consentWithdrawn"]));
  });
});
