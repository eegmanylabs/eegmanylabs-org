// Red-team attacks on the security rules behind the registry, the laboratory pages and the
// imports console, made through the client SDK as each kind of signed-in caller: reading the
// private detail of a laboratory or a participation, the outreach correspondence, the source
// records, the import batches, the review queue and the search index from outside their scope;
// verifying one's own laboratory; changing a status without the callable function; writing
// equipment directly; and approving readiness from the laboratory side.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, laboratories, people and studies on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, limit, serverTimestamp, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld, trusted } from "../seed";
import { createRulesEnvironment } from "../support";
import { MEMBER_PERSON, OWN_LABORATORY, OWN_PARTICIPATION, OWN_REPLICATION, uidOfCaller } from "../world";
import { forEach, OUTSIDERS, seed, storedPath } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, create, createAt, update } = requestsOf(() => environment);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-registry");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

const LABORATORY = `laboratories/${OWN_LABORATORY}`;
const PARTICIPATION = `participations/${OWN_PARTICIPATION}`;

describe("the status of a laboratory", () => {
  it("is not verified by the coordinator whose laboratory awaits verification", async () => {
    await seed(environment, { [LABORATORY]: { ...(await storedData(LABORATORY)), status: "unverified" } });
    await expectOutcomes({
      "ownCoordinator: verifies its own laboratory": [
        "denied",
        update("ownCoordinator", LABORATORY, { status: "active" }),
      ],
      "admin: verifies the laboratory": ["allowed", update("admin", LABORATORY, { status: "active" })],
    });
  });
});

/** A document of the world as it is stored. */
async function storedData(path: string): Promise<Record<string, unknown>> {
  return trusted(environment, async (db) => (await getDoc(doc(db, path))).data() ?? {});
}

describe("a verified citation", () => {
  it("is not left marked as verified when a lead changes the citation it verified", async () => {
    const replication = `replications/${OWN_REPLICATION}`;
    await seed(environment, {
      [replication]: {
        ...(await storedData(replication)),
        originalDoi: "10.5555/synthetic.2001",
        originalTitle: "A synthetic original study",
        citationStatus: "verified",
      },
    });
    await expectOutcomes({
      "ownLead: points the verified citation at another article": [
        "denied",
        update("ownLead", replication, { originalDoi: "10.5555/another.article" }),
      ],
      "ownLead: retitles the verified original study": [
        "denied",
        update("ownLead", replication, { originalTitle: "Another title altogether" }),
      ],
      "ownLead: edits the abstract, which the check does not cover": [
        "allowed",
        update("ownLead", replication, { abstract: "A synthetic abstract." }),
      ],
    });
  });
});

describe("the same mistake elsewhere", () => {
  it("keeps the coordinator's other edits of its laboratory, and lets a lead edit a citation nobody has checked", async () => {
    const replication = `replications/${OWN_REPLICATION}`;
    await seed(environment, { [LABORATORY]: { ...(await storedData(LABORATORY)), status: "unverified" } });
    await expectOutcomes({
      "ownCoordinator: renames the laboratory that awaits verification": [
        "allowed",
        update("ownCoordinator", LABORATORY, { city: "Exampleton" }),
      ],
      "ownCoordinator: sets its laboratory inactive": [
        "denied",
        update("ownCoordinator", LABORATORY, { status: "inactive" }),
      ],
      "ownLead: corrects the title of an unverified citation": [
        "allowed",
        update("ownLead", replication, { originalTitle: "A corrected synthetic title" }),
      ],
    });
  });

  it("does not leave a manuscript's checked citation describing something else", async () => {
    const manuscript = storedPath("manuscripts");
    await seed(environment, { [manuscript]: { ...(await storedData(manuscript)), citationStatus: "verified" } });
    await expectOutcomes({
      "ownLead: retitles a manuscript whose citation was checked": [
        "denied",
        update("ownLead", manuscript, { title: "Another synthetic title" }),
      ],
      "ownLead: points it at another DOI": ["denied", update("ownLead", manuscript, { doi: "10.5555/another" })],
      "ownLead: names another journal": ["denied", update("ownLead", manuscript, { journal: "Synthetic Journal" })],
      // What the citation does not cover stays the lead's to change.
      "ownLead: records its OSF page": [
        "allowed",
        update("ownLead", manuscript, { osfUrl: "https://example.org/osf/synthetic" }),
      ],
      // The dates move only with the status, through recordManuscriptEvent.
      "ownLead: records when it was submitted": [
        "denied",
        update("ownLead", manuscript, { submittedAt: serverTimestamp() }),
      ],
    });
  });
});

describe("restricted detail outside its scope", () => {
  it("keeps the private detail of a laboratory from everyone outside it", async () => {
    await expectOutcomes({
      ...forEach(OUTSIDERS, "denied", "reads the address and internal notes of a laboratory", (caller) =>
        get(caller, storedPath("laboratoryDetail")),
      ),
      "ownCoordinator: reads them": ["allowed", get("ownCoordinator", storedPath("laboratoryDetail"))],
    });
  });

  it("keeps the private detail of a participation from everyone outside its units", async () => {
    await expectOutcomes({
      ...forEach(OUTSIDERS, "denied", "reads ethics, training and notes of a participation", (caller) =>
        get(caller, storedPath("participationDetail")),
      ),
      "ownLead: reads them": ["allowed", get("ownLead", storedPath("participationDetail"))],
    });
  });

  it("keeps the outreach correspondence from everyone but the leads of its replication and the programme", async () => {
    await expectOutcomes({
      ...forEach(
        [...OUTSIDERS, "ownLabMember", "ownTeam", "ownCoordinator"] as const,
        "denied",
        "reads an outreach contact",
        (caller) => get(caller, storedPath("outreachContacts")),
      ),
      ...forEach(
        [...OUTSIDERS, "ownCoordinator", "ownTeam"] as const,
        "denied",
        "lists the outreach contacts of the replication",
        (caller) => list(caller, "outreachContacts", where("replicationId", "==", OWN_REPLICATION), limit(10)),
      ),
      "ownLead: reads an outreach contact": ["allowed", get("ownLead", storedPath("outreachContacts"))],
    });
  });

  it("keeps the source records, the batches and the review queue from anyone without the import capabilities", async () => {
    const callers = [...OUTSIDERS, "ownLead", "ownCoordinator", "ownTeam", "owner"] as const;
    await expectOutcomes({
      ...forEach(callers, "denied", "reads a source record", (caller) => get(caller, storedPath("sourceRecords"))),
      ...forEach(callers, "denied", "reads the continuation of a raw row", (caller) =>
        listAcrossParents(caller, "rawChunks", limit(10)),
      ),
      ...forEach(callers, "denied", "lists the import batches", (caller) => list(caller, "importBatches", limit(10))),
      ...forEach(callers, "denied", "reads the change log of a batch across batches", (caller) =>
        listAcrossParents(caller, "changes", limit(10)),
      ),
      ...forEach(callers, "denied", "reads an item of the review queue", (caller) =>
        get(caller, storedPath("reconciliationItems")),
      ),
      ...forEach(callers, "denied", "lists the review queue", (caller) =>
        list(caller, "reconciliationItems", limit(10)),
      ),
      // A raw row holds what a decision of the programme seals, so programme administrators alone read it.
      "coreTeam: reads a source record": ["denied", get("coreTeam", storedPath("sourceRecords"))],
      "admin: reads a source record": ["allowed", get("admin", storedPath("sourceRecords"))],
    });
  });

  it("keeps the special-category cells of a source row and of a change from every client", async () => {
    await expectOutcomes({
      ...forEach(["coreTeam", "admin"] as const, "denied", "reads the special-category cells of a row", (caller) =>
        get(caller, storedPath("sourceRecordSpecial")),
      ),
      ...forEach(["coreTeam", "admin"] as const, "denied", "reads the special-category state of a change", (caller) =>
        get(caller, storedPath("importBatchChangeState")),
      ),
      ...forEach(
        ["coreTeam", "admin"] as const,
        "denied",
        "lists the special-category documents across parents",
        (caller) => listAcrossParents(caller, "special", limit(10)),
      ),
    });
  });

  it("keeps the search index from every client", async () => {
    await expectOutcomes(
      forEach(["member", "ownLead", "coreTeam", "admin"] as const, "denied", "lists the search index", (caller) =>
        list(caller, "searchIndex", limit(10)),
      ),
    );
  });
});

describe("writes that belong to callable functions", () => {
  it("does not let the coordinator or the lead change the status of a participation directly", async () => {
    await expectOutcomes({
      "ownCoordinator: sets the participation to collecting": [
        "denied",
        update("ownCoordinator", PARTICIPATION, { status: "collecting" }),
      ],
      "ownLead: sets the participation to ready": ["denied", update("ownLead", PARTICIPATION, { status: "ready" })],
      "ownLead: points the status at a history entry of its choosing": [
        "denied",
        update("ownLead", PARTICIPATION, { statusHistoryId: "history-1" }),
      ],
    });
  });

  it("does not let anyone write an equipment configuration, or rewrite a closed one, directly", async () => {
    const equipment = storedPath("laboratoryEquipment");
    await expectOutcomes({
      ...forEach(["ownCoordinator", "coreTeam", "admin"] as const, "denied", "rewrites a configuration", (caller) =>
        update(caller, equipment, { channelCount: 8 }),
      ),
      ...forEach(["ownCoordinator", "admin"] as const, "denied", "reopens a configuration", (caller) =>
        update(caller, equipment, { isCurrent: true, validTo: null }),
      ),
      "ownCoordinator: writes a configuration of its own": [
        "denied",
        createAt("ownCoordinator", `${LABORATORY}/equipment/configuration-forged`, {
          laboratoryId: OWN_LABORATORY,
          name: "Forged",
          isCurrent: true,
          validFrom: serverTimestamp(),
          validTo: null,
          supersedesId: null,
        }),
      ],
    });
  });

  it("does not let the laboratory sign the readiness approval item of its own checklist", async () => {
    const item = `${PARTICIPATION}/checklist/readinessApproval`;
    const ethics = storedPath("participationChecklist");
    const template = await storedData(ethics);
    await seed(environment, {
      [item]: { ...template, templateItemKey: "readinessApproval", label: "Readiness approval" },
    });
    await expectOutcomes({
      ...forEach(["ownCoordinator", "ownLabMember"] as const, "denied", "completes the readiness approval", (caller) =>
        update(caller, item, {
          status: "done",
          completedBy: uidOfCaller(caller),
          completedAt: serverTimestamp(),
        }),
      ),
      "ownLead: completes the readiness approval": [
        "allowed",
        update("ownLead", item, {
          status: "done",
          completedBy: uidOfCaller("ownLead"),
          completedAt: serverTimestamp(),
        }),
      ],
    });
  });

  it("does not let a coordinator confirm a member entry of its laboratory directly", async () => {
    await expectOutcomes({
      "ownCoordinator: adds a person as a confirmed coordinator": [
        "denied",
        create("ownCoordinator", `${LABORATORY}/members/${MEMBER_PERSON}`, {
          laboratoryId: OWN_LABORATORY,
          personId: MEMBER_PERSON,
          role: "coordinator",
          isAuthorisedRepresentative: true,
          earlierPeriods: [],
          status: "confirmed",
        }),
      ],
    });
  });
});
