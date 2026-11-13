// Red-team attack by the lead of a replication on the dates of an output (docs/DATA_MODEL.md,
// section 11; D-019). The status of a manuscript moves only through `recordManuscriptEvent`,
// which sets `submittedAt`, `acceptedAt` and `publishedAt` together with the status it records.
// The rules still let a lead write the three dates directly, so an output that is only planned
// carries a date of acceptance or publication, and the export of the public milestones file reads
// a Stage 1 acceptance from that date alone (publishing-milestones-and-reports.test.ts in the
// functions red team).
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts and outputs on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { autoId, OWN_REPLICATION } from "../world";
import { storedPath } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { create, update } = requestsOf(() => environment);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-publishing-dates");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

describe("the dates of a planned output", () => {
  it("are not written by a lead outside the event that moves its status", async () => {
    const accepted = Timestamp.fromDate(new Date("2026-01-15T00:00:00Z"));
    await expectOutcomes({
      "ownLead: names its journal": [
        "allowed",
        update("ownLead", storedPath("manuscripts"), { journal: "Journal of Synthetic Results" }),
      ],
      "ownLead: dates the acceptance of a planned Stage 1 report": [
        "denied",
        update("ownLead", storedPath("manuscripts"), { acceptedAt: accepted }),
      ],
      "ownLead: dates the publication of a planned output": [
        "denied",
        update("ownLead", storedPath("manuscripts"), { publishedAt: accepted }),
      ],
      "ownLead: creates a planned output that is already dated as accepted": [
        "denied",
        create("ownLead", `manuscripts/${autoId("manuscriptDated")}`, {
          replicationId: OWN_REPLICATION,
          title: "A synthetic Stage 1 report",
          kind: "stage1Rr",
          status: "planned",
          statusHistoryId: null,
          acceptedAt: accepted,
          custom: {},
          scopeKeys: [`rep:${OWN_REPLICATION}`],
        }),
      ],
      "ownLead: creates the same planned output without a date": [
        "allowed",
        create("ownLead", `manuscripts/${autoId("manuscriptUndated")}`, {
          replicationId: OWN_REPLICATION,
          title: "A synthetic Stage 1 report",
          kind: "stage1Rr",
          status: "planned",
          statusHistoryId: null,
          custom: {},
          scopeKeys: [`rep:${OWN_REPLICATION}`],
        }),
      ],
    });
  });
});
