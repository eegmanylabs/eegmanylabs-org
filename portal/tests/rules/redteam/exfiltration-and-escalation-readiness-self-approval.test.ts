// Red-team attack by a laboratory coordinator on the readiness of its own laboratory.
//
// The readiness of a participation moves from `notStarted` through `readyForReview` to
// `approved`, and `readinessApprovedBy` in the restricted document names who approved it. The
// laboratory asks for the review and the replication decides it. The rules let whoever manages
// either side set every value, so a coordinator approves its own laboratory, and a coordinator
// with no tie to a replication creates a participation in it that is approved from the start.
// Every member reads the participation, and the readiness matrix is drawn from it.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, laboratories and studies on the example.org domain.
import { participationId } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { serverTimestamp } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { OTHER_LABORATORY, OTHER_REPLICATION, OWN_LABORATORY, OWN_PARTICIPATION, uidOfCaller } from "../world";
import { newRecord } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { create, update } = requestsOf(() => environment);

const PARTICIPATION = `participations/${OWN_PARTICIPATION}`;
/** The participation that the fixture creates: the owning laboratory in the other replication. */
const NEW_PARTICIPATION = `participations/${participationId(OTHER_REPLICATION, OWN_LABORATORY)}`;
/** A participation of the other laboratory in the other replication, which its coordinator may create. */
const OTHER_PARTICIPATION = `participations/${participationId(OTHER_REPLICATION, OTHER_LABORATORY)}`;

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-readiness");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

describe("the readiness of a participation", () => {
  it("is put forward for review by the coordinator of the laboratory and approved by the lead of the replication", async () => {
    await expectOutcomes({
      "ownCoordinator: says that the laboratory is ready for review": [
        "allowed",
        update("ownCoordinator", PARTICIPATION, { readinessStatus: "readyForReview" }),
      ],
      "ownLead: approves the readiness": ["allowed", update("ownLead", PARTICIPATION, { readinessStatus: "approved" })],
      "ownLead: names itself as the one who approved": [
        "allowed",
        update("ownLead", `${PARTICIPATION}/private/detail`, {
          readinessApprovedBy: uidOfCaller("ownLead"),
          readinessApprovedAt: serverTimestamp(),
        }),
      ],
      "ownCoordinator: signs its laboratory up to another replication, not started": [
        "allowed",
        create("ownCoordinator", NEW_PARTICIPATION, newRecord("participations", uidOfCaller("ownCoordinator"))),
      ],
    });
  });

  it("is not approved by the coordinator of the laboratory that is under review", async () => {
    await expectOutcomes({
      "ownCoordinator: approves the readiness of its own laboratory": [
        "denied",
        update("ownCoordinator", PARTICIPATION, { readinessStatus: "approved" }),
      ],
      "ownCoordinator: names itself as the one who approved": [
        "denied",
        update("ownCoordinator", `${PARTICIPATION}/private/detail`, {
          readinessApprovedBy: uidOfCaller("ownCoordinator"),
          readinessApprovedAt: serverTimestamp(),
        }),
      ],
    });
  });

  it("is not approved from the start in a participation that a coordinator creates in a replication it has no part in", async () => {
    await expectOutcomes({
      "ownCoordinator: creates a participation that is approved already": [
        "denied",
        create("ownCoordinator", NEW_PARTICIPATION, {
          ...newRecord("participations", uidOfCaller("ownCoordinator")),
          readinessStatus: "approved",
        }),
      ],
      "otherCoordinator: creates a participation that is approved already": [
        "denied",
        create("otherCoordinator", OTHER_PARTICIPATION, {
          ...newRecord("participations", uidOfCaller("otherCoordinator")),
          replicationId: OTHER_REPLICATION,
          laboratoryId: OTHER_LABORATORY,
          scopeKeys: [`rep:${OTHER_REPLICATION}`, `lab:${OTHER_LABORATORY}`],
          readinessStatus: "approved",
        }),
      ],
    });
  });
});
