// Red-team attack by a replication lead, and by a laboratory coordinator, on the entry of
// another person in their unit.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
//
// A lead reads the contact document of the people whose directory document names the lead's
// replication, and a function derives that from the current, confirmed memberships. The data
// model therefore lets nobody but the person concerned or an administrator confirm an entry,
// "so nobody gains sight of an address by adding a person to their own unit". An entry that was
// confirmed once and is no longer in force is the gap. The lead may change `isCurrent`, so the
// lead makes an ended membership current again, and whoever may write an entry may also clear
// its `archivedAt`, so a lead or a coordinator restores an archived entry as confirmed as it
// was. Either way the person is back in the unit without having agreed.
// Each test states the secure behaviour, so a test that fails has found a hole.
import { replicationMembershipId } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { serverTimestamp } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { MEMBER_PERSON, OWN_LABORATORY, OWN_REPLICATION, OWNER_PERSON, STORED_AT, stored } from "../world";
import { seed } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, update } = requestsOf(() => environment);

const MEMBERSHIPS = `replications/${OWN_REPLICATION}/memberships`;
/** A confirmed membership that ended: the person of the account `member` has left the replication. */
const ENDED = `${MEMBERSHIPS}/${replicationMembershipId(MEMBER_PERSON, "analyst")}`;
/** A confirmed membership that is current, which the lead may end. */
const CURRENT = `${MEMBERSHIPS}/${replicationMembershipId(OWNER_PERSON, "member")}`;
/** A confirmed membership that was archived, which is how an entry is removed. */
const ARCHIVED = `${MEMBERSHIPS}/${replicationMembershipId(MEMBER_PERSON, "advisor")}`;
/** A confirmed entry of the same person in the owning laboratory, archived likewise. */
const ARCHIVED_LABORATORY_ENTRY = `laboratories/${OWN_LABORATORY}/members/${MEMBER_PERSON}`;
/** A confirmed entry of the owning laboratory that is in force, which the coordinator may archive. */
const LABORATORY_ENTRY = `laboratories/${OWN_LABORATORY}/members/${OWNER_PERSON}`;
const CONTACT = `persons/${MEMBER_PERSON}/private/contact`;

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-membership");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await seed(environment, {
    [ENDED]: {
      ...stored(),
      replicationId: OWN_REPLICATION,
      personId: MEMBER_PERSON,
      role: "analyst",
      isCurrent: false,
      endDate: "2025-12-31",
      earlierPeriods: [],
      reviewStatus: "confirmed",
    },
    [ARCHIVED]: {
      ...stored(),
      archivedAt: STORED_AT,
      replicationId: OWN_REPLICATION,
      personId: MEMBER_PERSON,
      role: "advisor",
      isCurrent: true,
      earlierPeriods: [],
      reviewStatus: "confirmed",
    },
    [ARCHIVED_LABORATORY_ENTRY]: {
      ...stored(),
      archivedAt: STORED_AT,
      laboratoryId: OWN_LABORATORY,
      personId: MEMBER_PERSON,
      role: "member",
      isAuthorisedRepresentative: false,
      earlierPeriods: [],
      status: "confirmed",
    },
    [CONTACT]: {
      ...stored(),
      emails: [{ email: "member.account@example.org", kind: "primary", verifiedAt: null, claimEligible: true }],
    },
  });
});

describe("a confirmed membership that has ended", () => {
  it("leaves the lead without sight of the address of the person, and the lead may still end a current membership", async () => {
    await expectOutcomes({
      "ownLead: reads the contact document of the former member": ["denied", get("ownLead", CONTACT)],
      "ownLead: ends a current membership": [
        "allowed",
        update("ownLead", CURRENT, { isCurrent: false, endDate: "2026-03-31" }),
      ],
    });
  });

  it("is not made current again by the lead, which would put the person back into the unit of the lead", async () => {
    await expectOutcomes({
      "ownLead: makes the ended membership current": ["denied", update("ownLead", ENDED, { isCurrent: true })],
      "ownLead: makes it current and moves its end date into the future": [
        "denied",
        update("ownLead", ENDED, { isCurrent: true, endDate: "2099-12-31" }),
      ],
    });
  });
});

describe("a confirmed entry that was archived", () => {
  it("leaves the coordinator without sight of the address, and those who manage a unit may still archive an entry", async () => {
    await expectOutcomes({
      "ownCoordinator: reads the contact document of the former member": ["denied", get("ownCoordinator", CONTACT)],
      "ownCoordinator: archives an entry of its laboratory": [
        "allowed",
        update("ownCoordinator", LABORATORY_ENTRY, { archivedAt: serverTimestamp() }),
      ],
      "ownLead: archives a membership of its replication": [
        "allowed",
        update("ownLead", CURRENT, { archivedAt: serverTimestamp() }),
      ],
      // An entry that is put forward again waits for the person to confirm it.
      "ownCoordinator: restores an archived entry as a proposal": [
        "allowed",
        update("ownCoordinator", ARCHIVED_LABORATORY_ENTRY, { archivedAt: null, status: "proposed" }),
      ],
    });
  });

  it("is not restored as confirmed by the lead or the coordinator of the unit", async () => {
    await expectOutcomes({
      "ownLead: restores the archived membership": ["denied", update("ownLead", ARCHIVED, { archivedAt: null })],
      "ownCoordinator: restores the archived entry of its laboratory": [
        "denied",
        update("ownCoordinator", ARCHIVED_LABORATORY_ENTRY, { archivedAt: null }),
      ],
    });
  });
});
