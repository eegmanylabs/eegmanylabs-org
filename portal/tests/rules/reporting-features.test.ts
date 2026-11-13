// The rules of reporting, publishing and automation of phase 9 (docs/DATA_MODEL.md, sections 3,
// 12 and 13), beside the registry-driven matrix: a saved search is its owner's alone and keeps
// to its fixed list of kinds; the publishing log with the files of each export is read by those
// who prepare exports; automation rules, their runs, failed events and scheduled reports are read
// by those who manage automations; and no client writes any of the latter, an administrator
// included, because callable functions and triggers do.
// Fixtures are synthetic: fictitious accounts and studies on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { limit, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { EVERYONE, forEach, storedPath } from "./redteam/exfiltration-and-escalation-support";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld } from "./seed";
import { createRulesEnvironment } from "./support";
import { autoId, OWN_REPLICATION, OWNER_UID, stored, uidOfCaller } from "./world";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, create, update, remove, createAt } = requestsOf(() => environment);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-reporting");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

const savedSearch = (uid: string, overrides: Record<string, unknown> = {}) => ({
  uid,
  name: "Synthetic search",
  query: "synthetic",
  kinds: ["page", "comment"],
  replicationId: null,
  ...overrides,
});

describe("a saved search", () => {
  it("is created, read and removed by its owner alone", async () => {
    const own = `users/${OWNER_UID}/savedSearches/${autoId("a new search")}`;
    const member = uidOfCaller("member");
    await expectOutcomes({
      "the owner saves a search": ["allowed", create("owner", own, savedSearch(OWNER_UID))],
      "the owner saves a search of one replication": [
        "allowed",
        create(
          "owner",
          `users/${OWNER_UID}/savedSearches/${autoId("a search of a study")}`,
          savedSearch(OWNER_UID, { replicationId: OWN_REPLICATION }),
        ),
      ],
      "the owner reads their saved search": ["allowed", get("owner", storedPath("userSavedSearches"))],
      "the owner lists their saved searches": ["allowed", list("owner", `users/${OWNER_UID}/savedSearches`, limit(50))],
      "another member reads the owner's saved search": ["denied", get("member", storedPath("userSavedSearches"))],
      "another member saves a search for the owner": [
        "denied",
        create("member", `users/${OWNER_UID}/savedSearches/${autoId("planted search")}`, savedSearch(OWNER_UID)),
      ],
      "another member saves a search naming themselves under the owner": [
        "denied",
        create("member", `users/${OWNER_UID}/savedSearches/${autoId("planted search two")}`, savedSearch(member)),
      ],
      "an administrator reads the owner's saved search": ["denied", get("admin", storedPath("userSavedSearches"))],
      "another member removes the owner's saved search": ["denied", remove("member", storedPath("userSavedSearches"))],
      "the saved searches are listed across users": [
        "denied",
        listAcrossParents("admin", "savedSearches", where("uid", "==", OWNER_UID), limit(50)),
      ],
    });
  });

  it("keeps to its fixed kinds, its caps and an identifier that Firestore generated", async () => {
    const path = (label: string) => `users/${OWNER_UID}/savedSearches/${autoId(label)}`;
    await expectOutcomes({
      "a kind outside the list": [
        "denied",
        create("owner", path("bad kind"), savedSearch(OWNER_UID, { kinds: ["secret"] })),
      ],
      "a name that is too long": [
        "denied",
        create("owner", path("long name"), savedSearch(OWNER_UID, { name: "n".repeat(101) })),
      ],
      "an empty query": ["denied", create("owner", path("empty query"), savedSearch(OWNER_UID, { query: "" }))],
      "a replication that is not an identifier": [
        "denied",
        create("owner", path("bad replication"), savedSearch(OWNER_UID, { replicationId: 7 })),
      ],
      "a field the schema does not name": [
        "denied",
        create("owner", path("extra field"), savedSearch(OWNER_UID, { scopeKeys: ["programme"] })),
      ],
      "an identifier of the importers' shape": [
        "denied",
        createAt("owner", `users/${OWNER_UID}/savedSearches/derived__search`, {
          ...savedSearch(OWNER_UID),
          ...stored(),
        }),
      ],
      "a change of the replication after saving": [
        "denied",
        update("owner", storedPath("userSavedSearches"), { replicationId: OWN_REPLICATION }),
      ],
      "a change of the name": ["allowed", update("owner", storedPath("userSavedSearches"), { name: "Renamed search" })],
    });
  });
});

describe("the publishing log", () => {
  it("is read by those who prepare exports, with the files of each export", async () => {
    await expectOutcomes({
      "an administrator reads an export": ["allowed", get("admin", storedPath("publicationBatches"))],
      "the core team reads an export": ["allowed", get("coreTeam", storedPath("publicationBatches"))],
      "an administrator reads a file of an export": ["allowed", get("admin", storedPath("publicationFiles"))],
      "an administrator lists the files across exports": ["allowed", listAcrossParents("admin", "files", limit(50))],
      "an administrator without the factor reads an export": [
        "denied",
        get("adminWithoutFactor", storedPath("publicationBatches")),
      ],
      "a lead reads an export": ["denied", get("ownLead", storedPath("publicationBatches"))],
      "a member reads a file of an export": ["denied", get("member", storedPath("publicationFiles"))],
      "a member lists the files across exports": ["denied", listAcrossParents("member", "files", limit(50))],
      "a signed-out caller reads an export": ["denied", get("signedOut", storedPath("publicationBatches"))],
    });
  });
});

describe("automations and scheduled reports", () => {
  it("are read by those who manage automations and by nobody else", async () => {
    for (const key of ["automationRules", "automationRuns", "eventFailures", "scheduledReports"] as const) {
      await expectOutcomes({
        [`an administrator reads ${key}`]: ["allowed", get("admin", storedPath(key))],
        [`the core team reads ${key}`]: ["allowed", get("coreTeam", storedPath(key))],
        [`a lead reads ${key}`]: ["denied", get("ownLead", storedPath(key))],
        [`a coordinator reads ${key}`]: ["denied", get("ownCoordinator", storedPath(key))],
        [`a member reads ${key}`]: ["denied", get("member", storedPath(key))],
        [`an administrator without the factor reads ${key}`]: ["denied", get("adminWithoutFactor", storedPath(key))],
      });
    }
  });

  it("accept no client write, an administrator's included, and nothing exports itself", async () => {
    for (const key of [
      "automationRules",
      "automationRuns",
      "eventFailures",
      "scheduledReports",
      "publicationBatches",
      "publicationFiles",
    ] as const) {
      await expectOutcomes({
        ...forEach(EVERYONE, "denied", `changes ${key}`, (caller) =>
          update(caller, storedPath(key), { schemaVersion: 1 }),
        ),
        [`an administrator deletes ${key}`]: ["denied", remove("admin", storedPath(key))],
        [`an administrator writes over ${key}`]: ["denied", createAt("admin", storedPath(key), stored())],
      });
    }
    await expectOutcomes({
      "an administrator approves an export directly": [
        "denied",
        update("admin", storedPath("publicationBatches"), { status: "staged", approvedBy: uidOfCaller("admin") }),
      ],
      "an administrator switches a rule on directly": [
        "denied",
        update("admin", storedPath("automationRules"), { enabled: false }),
      ],
    });
  });
});
