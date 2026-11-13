// The refusals that laboratory management, participation and the imports console rely on,
// proved at the security rules: the interface hides these controls, and these tests show that
// hiding them is never what protects the data. Each refusal stands beside the honest request
// that the rules accept.
// Fixtures are synthetic: fictitious accounts, people, laboratories and studies on the example.org domain.
import { COLLECTIONS, labClaimId, unitScopeKeys } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { limit, serverTimestamp, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld } from "./seed";
import { createRulesEnvironment, seedDocuments } from "./support";
import {
  autoId,
  OTHER_LABORATORY,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  stored,
  uidOfCaller,
} from "./world";

let environment: RulesTestEnvironment;
const { get, list, create, createAt, update } = requestsOf(() => environment);

const READINESS = COLLECTIONS.participationChecklist.docPath(OWN_PARTICIPATION, "readinessApproval");
const ETHICS = COLLECTIONS.participationChecklist.docPath(OWN_PARTICIPATION, "ethics");
const PROPOSAL_LABORATORY = "lab__0123456789abcdef0123";
const PROPOSAL_CLAIM = labClaimId(uidOfCaller("member"), PROPOSAL_LABORATORY);

const checklistItem = (key: string, position: number) => ({
  ...stored(),
  participationId: OWN_PARTICIPATION,
  templateKey: "onboarding",
  templateItemKey: key,
  label: key,
  status: "notStarted",
  completedBy: null,
  completedAt: null,
  position,
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-laboratories");
  await seedWorld(environment);
  await seedDocuments(environment, {
    [READINESS]: checklistItem("readinessApproval", 8),
    [COLLECTIONS.labClaims.docPath(PROPOSAL_CLAIM)]: {
      ...stored(),
      laboratoryId: PROPOSAL_LABORATORY,
      uid: uidOfCaller("member"),
      requestedRole: "coordinator",
      status: "pendingReview",
      submittedAt: stored().createdAt,
      proposal: { name: "Synthetic Vision Laboratory", institutionId: "inst__0123456789abcdef0123" },
    },
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("the onboarding checklist of a participation", () => {
  it("lets only the replication's side change the item of readiness approval", async () => {
    const start = (caller: Parameters<typeof update>[0]) => update(caller, READINESS, { status: "inProgress" });
    await expectOutcomes({
      "a member of the laboratory is refused": ["denied", start("ownLabMember")],
      "a coordinator of the laboratory is refused": ["denied", start("ownCoordinator")],
      "a member of another laboratory is refused": ["denied", start("otherLabMember")],
      "a lead of another replication is refused": ["denied", start("otherLead")],
      "a lead of the replication is accepted": ["allowed", start("ownLead")],
      "an administrator is accepted": ["allowed", update("admin", READINESS, { status: "notStarted" })],
    });
  });

  it("lets a member of the laboratory work on the other items, and refuses a member of another laboratory", async () => {
    await expectOutcomes({
      "a member of another laboratory updates an item": [
        "denied",
        update("otherLabMember", ETHICS, { status: "inProgress" }),
      ],
      "a member of the laboratory changes a label, which comes from the template": [
        "denied",
        update("ownLabMember", ETHICS, { label: "Something else" }),
      ],
      "a member of the laboratory marks an item as in progress": [
        "allowed",
        update("ownLabMember", ETHICS, { status: "inProgress", note: "The application has been sent." }),
      ],
      "a member of the laboratory completes it in their own name": [
        "allowed",
        update("ownLabMember", ETHICS, {
          status: "done",
          completedBy: uidOfCaller("ownLabMember"),
          completedAt: serverTimestamp(),
        }),
      ],
      "a member of the laboratory completes it in someone else's name": [
        "denied",
        update("ownLabMember", ETHICS, { completedBy: uidOfCaller("ownCoordinator"), completedAt: serverTimestamp() }),
      ],
    });
  });

  it("is never created by a client, so the function instantiates every checklist from the template", async () => {
    await expectOutcomes({
      "a lead creates an item": [
        "denied",
        createAt(
          "ownLead",
          COLLECTIONS.participationChecklist.docPath(OWN_PARTICIPATION, "pilot"),
          checklistItem("pilot", 7),
        ),
      ],
    });
  });
});

describe("the restricted detail of a participation and of a laboratory", () => {
  it("is read within the scope of the participation and refused to a member of another laboratory", async () => {
    const detail = COLLECTIONS.participationDetail.docPath(OWN_PARTICIPATION);
    const laboratoryDetail = COLLECTIONS.laboratoryDetail.docPath(OWN_LABORATORY);
    await expectOutcomes({
      "a member of the laboratory reads the participation detail": ["allowed", get("ownLabMember", detail)],
      "a lead of the replication reads it": ["allowed", get("ownLead", detail)],
      "a member of another laboratory is refused": ["denied", get("otherLabMember", detail)],
      "a member is refused": ["denied", get("member", detail)],
      "a coordinator reads the detail of the laboratory": ["allowed", get("ownCoordinator", laboratoryDetail)],
      "a coordinator of another laboratory is refused it": ["denied", get("otherCoordinator", laboratoryDetail)],
      "a member is refused the detail of a laboratory": ["denied", get("member", laboratoryDetail)],
    });
  });
});

describe("equipment, participations and laboratories", () => {
  it("refuse a direct write of equipment, so the history of configurations stays whole", async () => {
    const configuration = COLLECTIONS.laboratoryEquipment.docPath(OWN_LABORATORY, autoId("configForged"));
    await expectOutcomes({
      "a coordinator creates a configuration directly": [
        "denied",
        create("ownCoordinator", configuration, {
          laboratoryId: OWN_LABORATORY,
          name: "Forged",
          isCurrent: true,
          validFrom: serverTimestamp(),
          validTo: null,
          supersedesId: null,
        }),
      ],
      "an administrator creates one directly": [
        "denied",
        create("admin", configuration, {
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

  it("refuse a laboratory created by a client, and a participation that a member of a laboratory invents", async () => {
    await expectOutcomes({
      "a member creates a laboratory": [
        "denied",
        createAt("member", COLLECTIONS.laboratories.docPath(PROPOSAL_LABORATORY), {
          slug: "synthetic-vision",
          name: "Synthetic Vision Laboratory",
          status: "unverified",
          custom: {},
          dataOrigin: "live",
        }),
      ],
      "a member of the laboratory invites it to a replication": [
        "denied",
        createAt("ownLabMember", COLLECTIONS.participations.docPath(`${OWN_REPLICATION}__${OTHER_LABORATORY}`), {
          replicationId: OWN_REPLICATION,
          laboratoryId: OTHER_LABORATORY,
          scopeKeys: unitScopeKeys(OWN_REPLICATION, OTHER_LABORATORY),
          status: "invited",
          statusHistoryId: null,
          readinessStatus: "notStarted",
          custom: {},
          dataOrigin: "live",
        }),
      ],
    });
  });

  it("show a proposed laboratory to the member who proposed it and to the programme, and to nobody else", async () => {
    const claim = COLLECTIONS.labClaims.docPath(PROPOSAL_CLAIM);
    await expectOutcomes({
      "the member who proposed it reads the request": ["allowed", get("member", claim)],
      "an administrator reads it": ["allowed", get("admin", claim)],
      "a coordinator of another laboratory is refused": ["denied", get("ownCoordinator", claim)],
      "another member is refused": ["denied", get("ownLabMember", claim)],
      "a coordinator lists the pending requests of the programme": [
        "denied",
        list(
          "ownCoordinator",
          COLLECTIONS.labClaims.collectionPath(),
          where("status", "==", "pendingReview"),
          limit(50),
        ),
      ],
    });
  });
});

describe("the imports console and the integrity report", () => {
  it("are read by the holders of their capabilities and refused to everyone else", async () => {
    const items = COLLECTIONS.reconciliationItems.collectionPath();
    const batches = COLLECTIONS.importBatches.collectionPath();
    const sources = COLLECTIONS.sources.collectionPath();
    const reports = COLLECTIONS.integrityReports.collectionPath();
    await expectOutcomes({
      "an administrator lists the review queue": ["allowed", list("admin", items, limit(50))],
      // The core team holds no sealed.read, so it lists the items that are not sealed (questions 7 and 14).
      "the core team lists it": ["allowed", list("coreTeam", items, where("sealed", "==", false), limit(50))],
      "the core team lists it without the clause": ["denied", list("coreTeam", items, limit(50))],
      "a lead is refused the review queue": ["denied", list("ownLead", items, limit(50))],
      "an administrator without the second factor is refused it": [
        "denied",
        list("adminWithoutFactor", items, limit(50)),
      ],
      "an administrator lists the batches": ["allowed", list("admin", batches, limit(50))],
      "a coordinator is refused the batches": ["denied", list("ownCoordinator", batches, limit(50))],
      "an administrator lists the sources": ["allowed", list("admin", sources, limit(50))],
      "a member is refused the sources": ["denied", list("member", sources, limit(50))],
      "an administrator lists the integrity reports": ["allowed", list("admin", reports, limit(5))],
      "a member is refused the integrity reports": ["denied", list("member", reports, limit(5))],
    });
  });
});
