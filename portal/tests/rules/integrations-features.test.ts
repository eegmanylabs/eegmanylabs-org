// The rules of the Google integrations (docs/DATA_MODEL.md, section 12), beside the
// registry-driven matrix: whoever manages the integrations reads the connections, mappings,
// runs, conflicts, review items, push channels and templates, and nobody else does; the cell
// states and the leases are read by no client at all; a generated document is read as its
// record; and no client writes any of them, because callable functions and jobs do.
// Fixtures are synthetic: fictitious accounts, studies and files on the example.org domain.
import { MEMBERS_SCOPE_KEY, replicationScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, limit, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { EVERYONE, forEach, storedPath } from "./redteam/exfiltration-and-escalation-support";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import { OWN_REPLICATION, stored } from "./world";

let environment: RulesTestEnvironment;
const { get, list, update, remove, createAt } = requestsOf(() => environment);

const MANAGED = [
  "integrationConnections",
  "driveChannels",
  "syncMappings",
  "syncRuns",
  "syncConflicts",
  "syncReviewItems",
  "documentTemplates",
] as const;

const RESTRICTED_DOCUMENT = "generatedDocuments/synthetic-template__replication__RestrictedStudy2001";

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-integrations");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await trusted(environment, async (db) => {
    await setDoc(doc(db, RESTRICTED_DOCUMENT), {
      ...stored(),
      templateKey: "synthetic-template",
      entityType: "replication",
      entityId: OWN_REPLICATION,
      title: "Synthetic recruitment for the team only",
      managedSections: {},
      lastGeneratedAt: null,
      status: "pending",
      restricted: true,
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      // The audience of a recruitment document: the replication's team and programme staff.
      scopeKeys: [replicationScopeKey(OWN_REPLICATION), "programme"],
    });
  });
});

describe("the records of the integrations", () => {
  it("are read by those who manage the integrations, with the second factor, and by nobody else", async () => {
    for (const key of MANAGED) {
      const path = storedPath(key);
      await expectOutcomes({
        [`an administrator reads ${key}`]: ["allowed", get("admin", path)],
        [`the core team reads ${key}`]: ["allowed", get("coreTeam", path)],
        [`the core team lists ${key}`]: ["allowed", list("coreTeam", key, limit(100))],
        [`an administrator without the factor reads ${key}`]: ["denied", get("adminWithoutFactor", path)],
        [`a lead reads ${key}`]: ["denied", get("ownLead", path)],
        [`a coordinator reads ${key}`]: ["denied", get("ownCoordinator", path)],
        [`a member reads ${key}`]: ["denied", get("member", path)],
        [`a signed-out caller reads ${key}`]: ["denied", get("signedOut", path)],
        [`a list above the limit of ${key}`]: ["denied", list("admin", key, limit(1_001))],
      });
    }
  });

  it("keep the state of every cell and the lease of every spreadsheet from every client, administrators included", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "reads the base of a cell", (caller) =>
        get(caller, storedPath("syncMappingCellState")),
      ),
      ...forEach(EVERYONE, "denied", "reads the lease of a spreadsheet", (caller) =>
        get(caller, storedPath("syncLeases")),
      ),
    });
  });

  it("are never written by a client: not a conflict resolved, a mapping made live or a secret named", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "resolves a conflict directly", (caller) =>
        update(caller, storedPath("syncConflicts"), { status: "resolved", resolution: "keepApp" }),
      ),
      ...forEach(EVERYONE, "denied", "approves a mapping for live writes directly", (caller) =>
        update(caller, storedPath("syncMappings"), { mode: "live" }),
      ),
      ...forEach(EVERYONE, "denied", "names a secret directly", (caller) =>
        update(caller, storedPath("integrationConnections"), { credentialRef: "ANOTHER_SECRET" }),
      ),
      ...forEach(EVERYONE, "denied", "deletes a run", (caller) => remove(caller, storedPath("syncRuns"))),
      "an administrator creates a template directly": [
        "denied",
        createAt("admin", "documentTemplates/direct-template", {
          key: "direct-template",
          name: "Direct",
          enabled: true,
        }),
      ],
    });
  });
});

describe("a generated document", () => {
  it("is read as the record it was generated for", async () => {
    const open = storedPath("generatedDocuments");
    await expectOutcomes({
      "a member reads a document every member may read": ["allowed", get("member", open)],
      "a member lists the documents of a replication by the keys it holds": [
        "allowed",
        list(
          "member",
          "generatedDocuments",
          where("entityType", "==", "replication"),
          where("entityId", "==", OWN_REPLICATION),
          where("scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]),
          limit(100),
        ),
      ],
      "a member lists them without a scope": ["denied", list("member", "generatedDocuments", limit(100))],
      "a member reads a document for the team only": ["denied", get("member", RESTRICTED_DOCUMENT)],
      "a lead of another replication reads it": ["denied", get("otherLead", RESTRICTED_DOCUMENT)],
      "a member of a laboratory of the replication reads it": ["denied", get("ownLabMember", RESTRICTED_DOCUMENT)],
      "the team reads it": ["allowed", get("ownTeam", RESTRICTED_DOCUMENT)],
      "a lead reads it": ["allowed", get("ownLead", RESTRICTED_DOCUMENT)],
      "the core team reads it": ["allowed", get("coreTeam", RESTRICTED_DOCUMENT)],
      "a signed-out caller reads it": ["denied", get("signedOut", open)],
      ...forEach(EVERYONE, "denied", "marks a document current directly", (caller) =>
        update(caller, open, { status: "current" }),
      ),
    });
  });
});
