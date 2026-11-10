// Red-team attack by a replication lead on the contributor table of another replication.
//
// A contributor is one row of a contributor table, from which the list of authors of a paper is
// drawn. The rules tie a new contributor to a replication that the caller manages, and then
// trust the `contributorTableId` and the `manuscriptId` of the request: the table only has to
// exist, and the manuscript is not looked at. A lead therefore writes a row of its own
// replication into the table, or onto the manuscript, of a replication it has no part in, where
// everyone who reads that table by its identifier finds it.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, contributors and studies on the example.org domain.
import { replicationScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { limit, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { autoId, OTHER_REPLICATION, stored, uidOfCaller } from "../world";
import { newRecord, seed, storedPath } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, list, create, update } = requestsOf(() => environment);

/** The contributor table and the manuscript of the other replication, which the attacker does not lead. */
const VICTIM_TABLE = "table-of-other-replication";
const VICTIM_MANUSCRIPT = "manuscript-of-other-replication";
const OTHER_KEY = replicationScopeKey(OTHER_REPLICATION);

/** A row that the lead of the owning replication may write: it belongs to that replication and to its table. */
const ownRow = () => newRecord("contributors", uidOfCaller("ownLead"));

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-contributors");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await seed(environment, {
    [`contributorTables/${VICTIM_TABLE}`]: {
      ...stored(),
      replicationId: OTHER_REPLICATION,
      sourceKey: "F",
      scopeKeys: [OTHER_KEY],
    },
    [`manuscripts/${VICTIM_MANUSCRIPT}`]: {
      ...stored(),
      replicationId: OTHER_REPLICATION,
      title: "A synthetic stage 2 registered report",
      kind: "stage2Rr",
      status: "drafting",
      statusHistoryId: null,
      custom: {},
      scopeKeys: [OTHER_KEY],
    },
  });
});

describe("a contributor row", () => {
  it("is written by a lead for the table of its own replication, and the table of another is closed to that lead", async () => {
    await expectOutcomes({
      "ownLead: adds a row to the table of its replication": [
        "allowed",
        create("ownLead", `contributors/${autoId("row-own")}`, ownRow()),
      ],
      "ownLead: reads the table of the other replication": [
        "denied",
        get("ownLead", `contributorTables/${VICTIM_TABLE}`),
      ],
      "ownLead: adds a row that belongs to the other replication": [
        "denied",
        create("ownLead", `contributors/${autoId("row-foreign")}`, {
          ...ownRow(),
          replicationId: OTHER_REPLICATION,
          contributorTableId: VICTIM_TABLE,
          scopeKeys: [OTHER_KEY],
        }),
      ],
      // Every member reads contributor rows, so a row that names the table is found beside the real ones.
      "member: lists the rows of the table of the other replication": [
        "allowed",
        list("member", "contributors", where("contributorTableId", "==", VICTIM_TABLE), limit(20)),
      ],
    });
  });

  it("is not added by a lead to the contributor table of a replication that it does not lead", async () => {
    await expectOutcomes({
      "ownLead: adds a row of its own replication to the table of the other": [
        "denied",
        create("ownLead", `contributors/${autoId("row-injected")}`, {
          ...ownRow(),
          surnameSource: "Uninvited",
          orderInPublication: 1,
          reviewStatus: "confirmed",
          contributorTableId: VICTIM_TABLE,
        }),
      ],
      "ownLead: moves an existing row of its replication into the table of the other": [
        "denied",
        update("ownLead", storedPath("contributors"), { contributorTableId: VICTIM_TABLE }),
      ],
    });
  });

  it("is not attached by a lead to the manuscript of a replication that it does not lead", async () => {
    await expectOutcomes({
      "ownLead: adds a row of its own replication onto the manuscript of the other": [
        "denied",
        create("ownLead", `contributors/${autoId("row-on-manuscript")}`, {
          ...ownRow(),
          manuscriptId: VICTIM_MANUSCRIPT,
        }),
      ],
      "ownLead: moves an existing row of its replication onto the manuscript of the other": [
        "denied",
        update("ownLead", storedPath("contributors"), { manuscriptId: VICTIM_MANUSCRIPT }),
      ],
    });
  });
});
