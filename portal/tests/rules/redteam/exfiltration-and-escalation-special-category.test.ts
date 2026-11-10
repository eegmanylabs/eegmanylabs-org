// Red-team attacks on special-category data: gender and ethnicity. No client reads or writes
// the demographics document of a person, the special-category cells of a raw row or the two
// states of a special-category document in a change log, whatever the role of the caller, and a
// correction request never names a special-category field.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain, with
// placeholder values in every special-category field.
import { SPECIAL_CATEGORY_FIELDS } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import {
  autoId,
  CALLERS,
  type CallerKind,
  firestoreOf,
  MEMBER_PERSON,
  OWNER_PERSON,
  STORED_AT,
  uidOfCaller,
} from "../world";
import { EVERYONE, forEach, newRecord, storedPath } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, create, update, remove } = requestsOf(() => environment);
const dbOf = (caller: CallerKind) => firestoreOf(environment, CALLERS[caller]);

const PERSON = `persons/${OWNER_PERSON}`;
const DEMOGRAPHICS = `${PERSON}/special/demographics`;

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-special");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

describe("special-category data", () => {
  it("is refused by its path to every caller, the person concerned and a programme administrator included", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "reads the demographics document", (caller) => get(caller, DEMOGRAPHICS)),
      ...forEach(EVERYONE, "denied", "reads the special-category cells of a raw row", (caller) =>
        get(caller, storedPath("sourceRecordSpecial")),
      ),
      ...forEach(EVERYONE, "denied", "reads the two states of a special-category document in a change log", (caller) =>
        get(caller, storedPath("importBatchChangeState")),
      ),
    });
  });

  it("is never listed, counted or harvested across parents", async () => {
    const beneath = (caller: CallerKind) => collection(dbOf(caller), `${PERSON}/special`);
    const group = (caller: CallerKind) => collectionGroup(dbOf(caller), "special");
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "lists the special documents of a person", (caller) =>
        list(caller, `${PERSON}/special`, limit(5)),
      ),
      ...forEach(
        EVERYONE,
        "denied",
        "lists them by document name",
        (caller) => () => getDocs(query(beneath(caller), where(documentId(), "==", "demographics"), limit(1))),
      ),
      ...forEach(EVERYONE, "denied", "lists every special document", (caller) =>
        listAcrossParents(caller, "special", limit(5)),
      ),
      ...forEach(
        EVERYONE,
        "denied",
        "lists one special document by its path",
        (caller) => () => getDocs(query(group(caller), where(documentId(), "==", DEMOGRAPHICS), limit(1))),
      ),
      ...forEach(
        EVERYONE,
        "denied",
        "asks who holds one value of a field",
        (caller) => () => getDocs(query(group(caller), where("genderSource", "==", "synthetic value"), limit(5))),
      ),
      ...forEach(
        EVERYONE,
        "denied",
        "counts the holders of one value of a field",
        (caller) => () =>
          getCountFromServer(query(group(caller), where("ethnicitySource", "==", "synthetic value"), limit(5))),
      ),
    });
  });

  it("is never written by a client, the person concerned and a programme administrator included", async () => {
    const values = { genderSource: "synthetic value", ethnicitySource: "synthetic value", recordedAt: STORED_AT };
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "changes a value", (caller) =>
        update(caller, DEMOGRAPHICS, { genderSource: "another value" }),
      ),
      ...forEach(EVERYONE, "denied", "creates the document of another person", (caller) =>
        create(caller, `persons/${MEMBER_PERSON}/special/demographics`, values),
      ),
      ...forEach(EVERYONE, "denied", "removes the document", (caller) => remove(caller, DEMOGRAPHICS)),
      ...forEach(EVERYONE, "denied", "writes a second special document", (caller) =>
        create(caller, `${PERSON}/special/copy`, values),
      ),
    });
  });

  it("never enters the directory document of a person, which every member reads", async () => {
    await expectOutcomes({
      ...forEach(
        ["owner", "coreTeam", "admin"],
        "denied",
        "adds a special-category field to the directory document",
        (caller) => update(caller, PERSON, { genderSource: "synthetic value" }),
      ),
      "owner: changes a field of its own that it may change": [
        "allowed",
        update("owner", PERSON, { labUrl: "https://example.org/synthetic-laboratory" }),
      ],
    });
  });

  it("is never named by a correction request", async () => {
    const request = (caller: "member" | "admin", field: string) =>
      create(caller, `correctionRequests/${autoId(`request-${caller}-${field}`)}`, {
        ...newRecord("correctionRequests", uidOfCaller(caller)),
        entityType: "person",
        entityId: OWNER_PERSON,
        field,
      });
    await expectOutcomes({
      ...Object.fromEntries(
        SPECIAL_CATEGORY_FIELDS.flatMap((field) =>
          (["member", "admin"] as const).map((caller) => [
            `${caller}: files a correction of ${field}`,
            ["denied", request(caller, field)] as const,
          ]),
        ),
      ),
      "member: files a correction of a directory field": ["allowed", request("member", "displayName")],
    });
  });
});
