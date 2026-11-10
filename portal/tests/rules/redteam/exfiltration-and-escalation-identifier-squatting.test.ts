// Red-team attack on the identifiers that importers derive.
// Fixtures are synthetic: fictitious accounts, studies and publications on the example.org domain.
//
// A record made in the portal takes an identifier that Firestore generates, and an importer
// derives the identifier of a record from the natural key of its source row, so that a repeated
// import addresses the same document (docs/DATA_MODEL.md, section 1). Those derived identifiers
// can be predicted: a document link is `<owner>__<slot>`, and a manuscript takes the publication
// identifier of the public website. The rules let a client choose the identifier of a record it
// creates, so a lead creates a record of its own replication under the identifier that the
// import will use for a record of another replication. The import then finds a document where
// it expected none, leaves the fields that differ alone, and the record of the other
// replication is never written: its place is held by a document that the attacker controls.
//
// The secure behaviour is stated on the outcome, since the hole can be closed in the rules or in
// the importer: after the import has run, the record at a derived identifier is the record of
// the import. The import below is run by the importer's own code. That seeding is the only use
// of the Admin SDK here: every request of the attacker goes through the client SDK and the rules.
import { documentLinkSlotId, entityRefId, MEMBERS_SCOPE_KEY, replicationScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp as AdminTimestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../../scripts/ports.mjs";
import { applyDiff } from "../../../tools/src/import/apply";
import type { RunContext } from "../../../tools/src/import/context";
import { PlanBuilder } from "../../../tools/src/import/plan";
import { comparePlan } from "../../../tools/src/import/preview";
import { itemBuilders } from "../../../tools/src/import/reconcile";
import { slotLinkDocument } from "../../../tools/src/import/records";
import { PORTS } from "../../support/emulators";
import { outcomeOf } from "../attempts";
import { FIXTURES } from "../fixtures";
import { requestsOf } from "../requests";
import { seedWorld, storedDocument } from "../seed";
import { createRulesEnvironment } from "../support";
import { OTHER_REPLICATION, OWN_REPLICATION, uidOfCaller } from "../world";
import { newRecord, seed } from "./exfiltration-and-escalation-support";

const PROJECT_ID = "demo-eegml-redteam-squatting";
const BATCH = "batch-website";
const SOURCE_RECORD = "source-record-website";
/** The key of the keyed hash in this test. It protects nothing, because every value hashed with it is invented. */
const HASH_KEY = "a-synthetic-hash-key-for-the-red-team-tests";

const OTHER_KEY = replicationScopeKey(OTHER_REPLICATION);
const SIGN_UP_ADDRESS = "https://example.org/synthetic-sign-up-form";
/** The publication identifier of the public website: the first author and the year. */
const PUBLICATION = "Synthetic2027";
const PUBLICATION_TITLE = "A synthetic multi-site replication";

for (const [name, value] of Object.entries(emulatorEnvironment(PORTS, PROJECT_ID))) process.env[name] ??= value;
const adminApp = initializeApp({ projectId: PROJECT_ID }, "redteam-squatting");

let environment: RulesTestEnvironment;
const { createAt } = requestsOf(() => environment);

/** The identifier of the link that a source gives a named place of the other replication. */
const linkPath = (slot: string) =>
  `documentLinks/${documentLinkSlotId(entityRefId("replication", OTHER_REPLICATION), slot)}`;

/** One run of the import of the website data for the other replication: a link in a slot, and a publication. */
async function importWebsiteData(slot: string, publicationId: string): Promise<void> {
  const builder = new PlanBuilder();
  slotLinkDocument(builder, {
    owner: { entityType: "replication", entityId: OTHER_REPLICATION },
    slot,
    url: SIGN_UP_ADDRESS,
    replicationId: OTHER_REPLICATION,
    ownerScopeKeys: [OTHER_KEY],
    recordId: SOURCE_RECORD,
  });
  // The manuscript as the importer of the website data states it.
  builder.document({
    collection: "manuscripts",
    ids: [publicationId],
    fixed: {
      websitePublicationId: publicationId,
      kind: "stage1Rr",
      status: "inPrincipleAcceptance",
      statusHistoryId: null,
      custom: {},
      scopeKeys: [OTHER_KEY],
    },
    owned: { replicationId: OTHER_REPLICATION, title: PUBLICATION_TITLE, journal: "Synthetic Journal" },
    sourceRecordIds: [SOURCE_RECORD],
  });
  const context: RunContext = {
    db: getFirestore(adminApp),
    sourceKey: "h",
    batchId: BATCH,
    now: AdminTimestamp.fromMillis(Date.now()),
  };
  const diff = await comparePlan(context, builder.build(), {
    ownRecordIds: new Set([SOURCE_RECORD]),
    items: itemBuilders(HASH_KEY),
    complete: false,
  });
  await applyDiff(context, diff);
}

beforeAll(async () => {
  environment = await createRulesEnvironment(PROJECT_ID);
});

afterAll(async () => {
  await environment.cleanup();
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await seedWorld(environment);
  await seed(environment, {
    [`importBatches/${BATCH}`]: { ...FIXTURES.importBatches?.seed, sourceKey: "h", status: "running", stats: {} },
  });
});

describe("a record at an identifier that an importer derives", () => {
  it("is written by the import where nobody has interfered", async () => {
    await importWebsiteData("signup", PUBLICATION);
    expect(await storedDocument(environment, linkPath("signup"))).toMatchObject({
      entityType: "replication",
      entityId: OTHER_REPLICATION,
      replicationId: OTHER_REPLICATION,
      url: SIGN_UP_ADDRESS,
      scopeKeys: [OTHER_KEY, MEMBERS_SCOPE_KEY],
    });
    expect(await storedDocument(environment, `manuscripts/${PUBLICATION}`)).toMatchObject({
      replicationId: OTHER_REPLICATION,
      title: PUBLICATION_TITLE,
      scopeKeys: [OTHER_KEY],
    });
  });

  it("is the link of the import, although a lead of another replication claimed the identifier first", async () => {
    // The lead of the owning replication attaches a link to its own replication, which it may
    // do, and chooses the identifier of the sign-up link of the other replication for it.
    await outcomeOf(
      createAt("ownLead", linkPath("signup"), {
        ...newRecord("documentLinks", uidOfCaller("ownLead")),
        kind: "form",
        url: "https://example.org/a-form-of-the-attacker",
        title: "Sign up",
      }),
    );

    await importWebsiteData("signup", PUBLICATION);

    expect(await storedDocument(environment, linkPath("signup"))).toMatchObject({
      entityId: OTHER_REPLICATION,
      replicationId: OTHER_REPLICATION,
      url: SIGN_UP_ADDRESS,
      scopeKeys: [OTHER_KEY, MEMBERS_SCOPE_KEY],
    });
  });

  it("is the manuscript of the import, although a lead of another replication claimed the identifier first", async () => {
    // The lead of the owning replication creates a manuscript of its own replication, which it
    // may do, under the publication identifier that a paper of the other replication will carry.
    await outcomeOf(
      createAt("ownLead", `manuscripts/${PUBLICATION}`, {
        ...newRecord("manuscripts", uidOfCaller("ownLead")),
        title: "A title of the attacker's choosing",
      }),
    );

    await importWebsiteData("osf", PUBLICATION);

    const manuscript = await storedDocument(environment, `manuscripts/${PUBLICATION}`);
    expect(manuscript).toMatchObject({
      replicationId: OTHER_REPLICATION,
      title: PUBLICATION_TITLE,
      scopeKeys: [OTHER_KEY],
    });
    // The lead of the other replication, and not the attacker, manages the manuscript.
    expect(manuscript?.replicationId).not.toBe(OWN_REPLICATION);
  });
});
