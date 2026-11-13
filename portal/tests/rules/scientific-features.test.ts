// The rules of the scientific workflows of phase 8 (docs/DATA_MODEL.md, sections 10 and 11),
// beside the registry-driven matrix: every member reads the methodological decision log; an
// analysis run, an incident with its actions and an authorship list with its entries are read
// within their scope; and no client writes any of it, an administrator included, because
// callable functions do: the log and the registry are append-only, a run is checked against its
// replication and an entry of an authorship list is answered by its own person.
// Fixtures are synthetic: fictitious accounts, studies and laboratories on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, limit, serverTimestamp, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { EVERYONE, forEach, storedPath } from "./redteam/exfiltration-and-escalation-support";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  stored,
} from "./world";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, update, remove, createAt } = requestsOf(() => environment);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-scientific");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

describe("the methodological decision log", () => {
  it("is read by every member and by no one else", async () => {
    await expectOutcomes({
      "a member reads an entry": ["allowed", get("member", storedPath("decisions"))],
      "a member of another laboratory reads an entry": ["allowed", get("otherLabMember", storedPath("decisions"))],
      "a member lists the log": ["allowed", list("member", "decisions", limit(50))],
      "a member lists the log without a limit": ["denied", list("member", "decisions")],
      "a signed-out caller reads an entry": ["denied", get("signedOut", storedPath("decisions"))],
      "an account without membership reads an entry": ["denied", get("noMembership", storedPath("decisions"))],
      "a suspended account reads an entry": ["denied", get("suspended", storedPath("decisions"))],
    });
  });
});

describe("analysis runs, incidents and authorship lists", () => {
  it("are read within their scope only", async () => {
    await expectOutcomes({
      "the replication's team reads a run": ["allowed", get("ownTeam", storedPath("processingRuns"))],
      "the laboratory's member reads a run": ["allowed", get("ownLabMember", storedPath("processingRuns"))],
      "a member reads a run": ["denied", get("member", storedPath("processingRuns"))],
      "another replication's lead reads a run": ["denied", get("otherLead", storedPath("processingRuns"))],
      "the lead lists the runs of the replication": [
        "allowed",
        list("ownLead", "processingRuns", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "a lead lists the runs of another replication": [
        "denied",
        list("ownLead", "processingRuns", where("replicationId", "==", OTHER_REPLICATION), limit(50)),
      ],
      "the coordinator reads an incident": ["allowed", get("ownCoordinator", storedPath("incidents"))],
      "the laboratory's member reads an action of an incident": [
        "allowed",
        get("ownLabMember", storedPath("incidentActions")),
      ],
      "a member of another laboratory reads an incident": ["denied", get("otherLabMember", storedPath("incidents"))],
      "a member of another laboratory reads an action": [
        "denied",
        get("otherLabMember", storedPath("incidentActions")),
      ],
      "the laboratory's member lists the actions of the laboratory": [
        "allowed",
        listAcrossParents("ownLabMember", "actions", where("laboratoryId", "==", OWN_LABORATORY), limit(50)),
      ],
      "the laboratory's member lists the actions of another laboratory": [
        "denied",
        listAcrossParents("ownLabMember", "actions", where("laboratoryId", "==", OTHER_LABORATORY), limit(50)),
      ],
      "the replication's team reads an authorship list": ["allowed", get("ownTeam", storedPath("authorshipLists"))],
      "the replication's team reads an entry": ["allowed", get("ownTeam", storedPath("authorshipEntries"))],
      "a member reads an authorship list": ["denied", get("member", storedPath("authorshipLists"))],
      // The person of an entry who is outside the team reads it through a callable function.
      "a member reads an entry": ["denied", get("member", storedPath("authorshipEntries"))],
      "the lead lists the entries of the replication": [
        "allowed",
        listAcrossParents("ownLead", "entries", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "another replication's lead lists the entries of the replication": [
        "denied",
        listAcrossParents("otherLead", "entries", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
    });
    for (const key of [
      "processingRuns",
      "incidents",
      "incidentActions",
      "authorshipLists",
      "authorshipEntries",
    ] as const) {
      await expectOutcomes({
        [`the core team reads ${key}`]: ["allowed", get("coreTeam", storedPath(key))],
        [`an administrator without the factor reads ${key}`]: ["denied", get("adminWithoutFactor", storedPath(key))],
        [`a signed-out caller reads ${key}`]: ["denied", get("signedOut", storedPath(key))],
      });
    }
  });
});

describe("the records of the scientific workflows", () => {
  it("accept no client write, an administrator's included", async () => {
    for (const key of [
      "processingRuns",
      "decisions",
      "incidents",
      "incidentActions",
      "authorshipLists",
      "authorshipEntries",
    ] as const) {
      await expectOutcomes({
        ...forEach(EVERYONE, "denied", `changes ${key}`, (caller) =>
          update(caller, storedPath(key), { schemaVersion: 1 }),
        ),
        [`an administrator deletes ${key}`]: ["denied", remove("admin", storedPath(key))],
        [`the lead writes over ${key}`]: ["denied", createAt("ownLead", storedPath(key), stored())],
      });
    }
  });

  it("let nobody confirm an entry of an authorship list directly, its own person included", async () => {
    await expectOutcomes({
      "the person confirms their entry directly": [
        "denied",
        update("member", storedPath("authorshipEntries"), {
          confirmation: { status: "confirmed", revision: 1, respondedAt: null },
        }),
      ],
      "the lead confirms an entry for its person": [
        "denied",
        update("ownLead", storedPath("authorshipEntries"), {
          confirmation: { status: "confirmed", revision: 1, respondedAt: null },
        }),
      ],
    });
  });
});

describe("the protocol and the team of a participation", () => {
  it("are chosen by those who manage the participation, so that its team can acknowledge the protocol", async () => {
    const participation = `participations/${OWN_PARTICIPATION}`;
    const member = storedPath("participationTeamMembers");
    await expectOutcomes({
      "the coordinator names a protocol of the replication": [
        "allowed",
        update("ownCoordinator", participation, { protocolId: "protocol-1", protocolVersionId: deleteField() }),
      ],
      "the coordinator names a protocol that does not exist": [
        "denied",
        update("ownCoordinator", participation, { protocolId: "protocol-missing" }),
      ],
      "a coordinator of another laboratory names a protocol": [
        "denied",
        update("otherCoordinator", participation, { protocolId: "protocol-1" }),
      ],
      "a member of the laboratory names a protocol": [
        "denied",
        update("ownLabMember", participation, { protocolId: "protocol-1" }),
      ],
      "the coordinator takes a person off the team": [
        "allowed",
        update("ownCoordinator", member, { archivedAt: serverTimestamp() }),
      ],
      "a coordinator of another laboratory takes a person off the team": [
        "denied",
        update("otherCoordinator", member, { archivedAt: serverTimestamp() }),
      ],
      // A restoration changes nothing else, so the role changes in a second write.
      "the coordinator puts the person back and changes the role in one write": [
        "denied",
        update("ownCoordinator", member, { archivedAt: null, role: "analyst" }),
      ],
      "the coordinator puts the person back": ["allowed", update("ownCoordinator", member, { archivedAt: null })],
      "the coordinator then gives the person another role": [
        "allowed",
        update("ownCoordinator", member, { role: "analyst" }),
      ],
      "the coordinator deletes a team entry": ["denied", remove("ownCoordinator", member)],
    });
  });
});
