// Red-team attack on special-category data through the change log of an import.
// Fixtures are synthetic: a fictitious person, and placeholder labels in place of real answer
// options. Every address in the world of these tests is on the example.org domain.
//
// The rules let whoever runs imports read importBatches/{batchId}/changes. For a
// special-category document a change holds "a marker and a hash" in place of the two states
// (docs/DATA_MODEL.md, section 12). The attack reads that entry as a member of the core team,
// who holds `imports.run` and does not hold `demographics.read`, and then guesses: a
// demographics document has a handful of possible values in each field, everything else in it
// is stated by the change entry itself, and the hash can be recomputed for every combination.
//
// The secure behaviour is that nothing a client can read lets it confirm a guess. The import
// below is run by the importer's own code, exactly as an import of the membership workbook would
// run it. That seeding is the only use of the Admin SDK here: every read of the attack goes
// through the client SDK and the rules.
import { CURRENT_DEMOGRAPHICS_CONSENT, DEMOGRAPHICS_CONSENT_DECISION } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collectionGroup, doc, getDoc, getDocs, limit, query, type Timestamp, where } from "firebase/firestore";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp as AdminTimestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../../scripts/ports.mjs";
import { applyDiff } from "../../../tools/src/import/apply";
import { createdFields, entryOf, type RunContext, updatedFields } from "../../../tools/src/import/context";
import { newDocument } from "../../../tools/src/import/ownership";
import { PlanBuilder } from "../../../tools/src/import/plan";
import { comparePlan } from "../../../tools/src/import/preview";
import { itemBuilders } from "../../../tools/src/import/reconcile";
import { contentHash } from "../../../tools/src/import/values";
import { PORTS } from "../../support/emulators";
import { FIXTURES } from "../fixtures";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld, storedDocument } from "../seed";
import { createRulesEnvironment } from "../support";
import { CALLERS, firestoreOf } from "../world";
import { seed, storedPath } from "./exfiltration-and-escalation-support";

const PROJECT_ID = "demo-eegml-redteam-change-log";
const BATCH = "batch-demographics";
const PERSON = "person-synthetic-demographics";
const SOURCE_RECORD = "source-record-demographics";
const DEMOGRAPHICS = `persons/${PERSON}/special/demographics`;
/** What the change log names in place of the path of a special-category document. */
const DEMOGRAPHICS_COLLECTION = "persons/{personId}/special/demographics";
/** The key of the keyed hash in this test. It protects nothing, because every value hashed with it is invented. */
const HASH_KEY = "a-synthetic-hash-key-for-the-red-team-tests";

/** The answer options of a form, which anyone who has seen the form knows. Placeholders stand for the real ones. */
const GENDER_OPTIONS = [1, 2, 3, 4, 5].map((option) => `Synthetic gender option ${option}`);
const ETHNICITY_OPTIONS = Array.from({ length: 18 }, (_, index) => `Synthetic ethnicity option ${index + 1}`);
const TRUE_GENDER = GENDER_OPTIONS[3] ?? "";
const TRUE_ETHNICITY = ETHNICITY_OPTIONS[11] ?? "";

for (const [name, value] of Object.entries(emulatorEnvironment(PORTS, PROJECT_ID))) process.env[name] ??= value;
const adminApp = initializeApp({ projectId: PROJECT_ID }, "redteam-change-log");

let environment: RulesTestEnvironment;
const { get } = requestsOf(() => environment);

/** The demographics document as an importer plans it: the two source terms follow the source row. */
function plannedDemographics(genderSource: string, ethnicitySource: string, recordedAt: AdminTimestamp) {
  const builder = new PlanBuilder();
  builder.document({
    collection: "personDemographics",
    ids: [PERSON],
    fixed: { sourceRecordId: SOURCE_RECORD, recordedAt },
    owned: { genderSource, ethnicitySource },
    sourceRecordIds: [SOURCE_RECORD],
  });
  return builder.build();
}

beforeAll(async () => {
  environment = await createRulesEnvironment(PROJECT_ID);
  await seedWorld(environment);
  await seed(environment, {
    [`importBatches/${BATCH}`]: { ...FIXTURES.importBatches?.seed, sourceKey: "g", status: "running", stats: {} },
  });

  // The import itself: preview and apply, by the code that every importer runs. The person has consented, without
  // which the apply writes no value at all (question 20).
  const now = AdminTimestamp.fromMillis(Date.now());
  const context: RunContext = { db: getFirestore(adminApp), sourceKey: "g", batchId: BATCH, now };
  await context.db.doc(`persons/${PERSON}/private/demographicsConsent`).set({
    ...createdFields(now),
    schemaVersion: 1,
    personId: PERSON,
    uid: "uid-synthetic-demographics",
    status: "given",
    wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version,
    givenAt: now,
    withdrawnAt: null,
    history: [],
    basis: DEMOGRAPHICS_CONSENT_DECISION,
  });
  const diff = await comparePlan(context, plannedDemographics(TRUE_GENDER, TRUE_ETHNICITY, now), {
    ownRecordIds: new Set([SOURCE_RECORD]),
    items: itemBuilders(HASH_KEY),
    complete: false,
  });
  await applyDiff(context, diff);
});

afterAll(async () => {
  await environment.cleanup();
  await deleteApp(adminApp);
});

/**
 * Everything the attack uses: one change entry as a client reads it. The guess is made with the
 * importer's own code, which is public, and with nothing that the entry does not state.
 */
function guessDemographics(entry: {
  readonly createdAt: Timestamp;
  readonly after: { readonly sha256: string };
}): { genderSource: string; ethnicitySource: string } | null {
  const instant = AdminTimestamp.fromMillis(entry.createdAt.toMillis());
  const merge = { ownRecordIds: new Set<string>(), created: createdFields(instant), updated: updatedFields(instant) };
  for (const genderSource of GENDER_OPTIONS) {
    for (const ethnicitySource of ETHNICITY_OPTIONS) {
      const [candidate] = plannedDemographics(genderSource, ethnicitySource, instant).documents;
      if (candidate === undefined) continue;
      const state = newDocument(candidate, entryOf("personDemographics"), merge);
      if (contentHash(state) === entry.after.sha256) return { genderSource, ethnicitySource };
    }
  }
  return null;
}

describe("the change log of an import that wrote a demographics document", () => {
  it("was written by the import, and the core team reads the entry while it is refused the document itself", async () => {
    expect(CALLERS.coreTeam.access?.capabilities.demographicsRead).toBeUndefined();
    await expectOutcomes({
      "coreTeam: reads the demographics document": ["denied", get("coreTeam", DEMOGRAPHICS)],
      "coreTeam: reads the two states of the document": [
        "denied",
        get("coreTeam", `importBatches/${BATCH}/changes/000001/special/state`),
      ],
      "coreTeam: reads the special-category cells of a raw row": [
        "denied",
        get("coreTeam", storedPath("sourceRecordSpecial")),
      ],
      "coreTeam: reads the change entry": ["allowed", get("coreTeam", `importBatches/${BATCH}/changes/000001`)],
    });
  });

  it("does not let a reader who lacks demographics.read confirm a guess of the values", async () => {
    const db = firestoreOf(environment, CALLERS.coreTeam);
    // The change log is searched by the path of the document, as the data model describes, among the
    // entries that are not sealed, which is what the core team may list. The entry of a
    // special-category document does not name the person: it names the collection.
    const byPerson = await getDocs(
      query(
        collectionGroup(db, "changes"),
        where("documentPath", "==", DEMOGRAPHICS),
        where("sealed", "==", false),
        limit(5),
      ),
    );
    expect(byPerson.empty).toBe(true);
    const found = await getDocs(
      query(
        collectionGroup(db, "changes"),
        where("documentPath", "==", DEMOGRAPHICS_COLLECTION),
        where("sealed", "==", false),
        limit(5),
      ),
    );
    const entry = found.docs[0]?.data() as
      | { createdAt: Timestamp; after: { specialCategory?: boolean; sha256: string } }
      | undefined;
    expect(entry?.after.specialCategory).toBe(true);
    if (entry === undefined) return;

    const recovered = guessDemographics(entry);

    // The import stored the two values, and no client reads the document that holds them.
    expect(await storedDocument(environment, DEMOGRAPHICS)).toMatchObject({
      genderSource: TRUE_GENDER,
      ethnicitySource: TRUE_ETHNICITY,
    });
    expect(recovered).toBeNull();
  });

  it("holds no value of the document in clear in the entry that clients read", async () => {
    const snapshot = await getDoc(
      doc(firestoreOf(environment, CALLERS.admin), `importBatches/${BATCH}/changes/000001`),
    );
    const text = JSON.stringify(snapshot.data());
    expect(text).not.toContain(TRUE_GENDER);
    expect(text).not.toContain(TRUE_ETHNICITY);
  });
});
