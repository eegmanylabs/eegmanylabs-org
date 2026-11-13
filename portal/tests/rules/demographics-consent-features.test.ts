// The record of consent to the portal holding a person's gender and ethnicity, at the security
// rules: the person alone reads it, nobody writes it, and the values stay closed to everyone,
// the person and a programme administrator included. The callable function is the only writer
// (portal/tests/functions/demographics-consent.test.ts).
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { COLLECTIONS, CURRENT_DEMOGRAPHICS_CONSENT, DEMOGRAPHICS_CONSENT_DECISION } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld } from "./seed";
import { createRulesEnvironment } from "./support";
import { MEMBER_PERSON, OWNER_PERSON, OWNER_UID } from "./world";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, createAt, update, remove } = requestsOf(() => environment);

const CONSENT = COLLECTIONS.personDemographicsConsent.docPath(OWNER_PERSON);
const OTHER_CONSENT = COLLECTIONS.personDemographicsConsent.docPath(MEMBER_PERSON);
const VALUES = COLLECTIONS.personDemographics.docPath(OWNER_PERSON);

const record = (uid: string, personId: string) => ({
  personId,
  uid,
  status: "given",
  wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version,
  givenAt: Timestamp.now(),
  withdrawnAt: null,
  history: [
    { status: "given", at: Timestamp.now(), wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version, auditEventId: "a1" },
  ],
  basis: DEMOGRAPHICS_CONSENT_DECISION,
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-consent");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

describe("the record of consent to holding gender and ethnicity", () => {
  it("is read by the person it is about and by nobody else, whatever their role", async () => {
    await expectOutcomes({
      "the person reads their own record": ["allowed", get("owner", CONSENT)],
      "another member is refused": ["denied", get("member", CONSENT)],
      "a lead of the person's replication is refused": ["denied", get("ownLead", CONSENT)],
      "a coordinator of the person's laboratory is refused": ["denied", get("ownCoordinator", CONSENT)],
      "the core team is refused": ["denied", get("coreTeam", CONSENT)],
      "a programme administrator is refused": ["denied", get("admin", CONSENT)],
      "a suspended account is refused": ["denied", get("suspended", CONSENT)],
      "a caller who is not signed in is refused": ["denied", get("signedOut", CONSENT)],
    });
  });

  it("is never listed, neither beneath a person nor across people", async () => {
    await expectOutcomes({
      "the person lists their private documents": [
        "denied",
        list("owner", `${COLLECTIONS.persons.docPath(OWNER_PERSON)}/private`),
      ],
      "an administrator lists every private document": ["denied", listAcrossParents("admin", "private")],
    });
  });

  it("is written by no client: neither given, changed nor withdrawn directly, the person included", async () => {
    await expectOutcomes({
      "the person forges consent for themselves": [
        "denied",
        createAt("member", OTHER_CONSENT, record("x", MEMBER_PERSON)),
      ],
      "the person withdraws by changing the status": [
        "denied",
        update("owner", CONSENT, { status: "withdrawn", withdrawnAt: Timestamp.now() }),
      ],
      "the person deletes the record": ["denied", remove("owner", CONSENT)],
      "an administrator records consent for someone": [
        "denied",
        createAt("admin", OTHER_CONSENT, record(OWNER_UID, MEMBER_PERSON)),
      ],
      "an administrator deletes the record": ["denied", remove("admin", CONSENT)],
    });
  });

  it("opens nothing of the values: the person with consent in force reads and writes none of them", async () => {
    await expectOutcomes({
      "the person reads their values": ["denied", get("owner", VALUES)],
      "the person writes their own words directly": [
        "denied",
        update("owner", VALUES, { genderSelfDescribed: "a synthetic description" }),
      ],
      "an administrator reads the values": ["denied", get("admin", VALUES)],
    });
  });
});
