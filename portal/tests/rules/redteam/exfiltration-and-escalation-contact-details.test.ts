// Red-team attacks on the contact details of a person: the email addresses in
// persons/{personId}/private/contact and every copy of an address that another collection holds.
// The victim is the person of the account `owner`, who belongs to the owning replication and the
// owning laboratory. Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  or,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import {
  CALLERS,
  type CallerKind,
  firestoreOf,
  MEMBER_PERSON,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  stored,
  uidOfCaller,
} from "../world";
import {
  EVERYONE,
  forEach,
  INSIDERS_WITHOUT_MANAGEMENT,
  OUTSIDERS,
  seed,
  storedPath,
} from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents } = requestsOf(() => environment);
const dbOf = (caller: CallerKind) => firestoreOf(environment, CALLERS[caller]);

const PERSON = `persons/${OWNER_PERSON}`;
const CONTACT = `${PERSON}/private/contact`;
const VICTIM_ADDRESS = "owner.account@example.org";
const OTHER_OUTREACH = "outreachContacts/contact-other";

/** Callers who neither are the victim nor lead or coordinate a unit that the victim belongs to. */
const NO_SIGHT_OF_THE_VICTIM = [...OUTSIDERS, ...INSIDERS_WITHOUT_MANAGEMENT] as const;
/** Callers who may read the contact document by its path, and must still not harvest contact documents. */
const MAY_READ_ONE = ["owner", "ownLead", "ownCoordinator", "coreTeam", "admin"] as const;

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-contact");
  await seedWorld(environment);
  await seed(environment, {
    // An outreach row of the other replication, so that its lead has a list of its own to widen.
    [OTHER_OUTREACH]: {
      ...stored(),
      replicationId: OTHER_REPLICATION,
      labNameSource: "Synthetic Laboratory Four",
      contactEmail: "second.contact@example.org",
      sourceRecordId: "source-record-1",
      scopeKeys: [`rep:${OTHER_REPLICATION}`],
    },
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("the contact document of another person", () => {
  it("is refused by its path to every caller who neither is that person nor manages a unit of that person", async () => {
    await expectOutcomes({
      ...forEach(NO_SIGHT_OF_THE_VICTIM, "denied", "reads the contact document", (caller) => get(caller, CONTACT)),
      // The refusals above are about the caller: the same request succeeds for the permitted roles.
      ...forEach(MAY_READ_ONE, "allowed", "reads the contact document", (caller) => get(caller, CONTACT)),
    });
  });

  it("is never listed beneath its person, whatever the query says", async () => {
    const beneath = (caller: CallerKind) => collection(dbOf(caller), `${PERSON}/private`);
    await expectOutcomes({
      ...forEach([...NO_SIGHT_OF_THE_VICTIM, ...MAY_READ_ONE], "denied", "lists the private documents", (caller) =>
        list(caller, `${PERSON}/private`, limit(5)),
      ),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, ...MAY_READ_ONE],
        "denied",
        "lists by document name",
        (caller) => () => getDocs(query(beneath(caller), where(documentId(), "==", "contact"), limit(1))),
      ),
      ...forEach(
        NO_SIGHT_OF_THE_VICTIM,
        "denied",
        "lists by an address",
        (caller) => () => getDocs(query(beneath(caller), where("emails", "!=", null), limit(1))),
      ),
      ...forEach(
        NO_SIGHT_OF_THE_VICTIM,
        "denied",
        "lists in the order of the addresses",
        (caller) => () => getDocs(query(beneath(caller), orderBy("emails"), limit(1))),
      ),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, ...MAY_READ_ONE],
        "denied",
        "counts the private documents",
        (caller) => () => getCountFromServer(query(beneath(caller), limit(5))),
      ),
    });
  });

  it("is never harvested across people through a collection-group query", async () => {
    const group = (caller: CallerKind) => collectionGroup(dbOf(caller), "private");
    await expectOutcomes({
      ...forEach([...NO_SIGHT_OF_THE_VICTIM, ...MAY_READ_ONE], "denied", "lists every private document", (caller) =>
        listAcrossParents(caller, "private", limit(5)),
      ),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, ...MAY_READ_ONE],
        "denied",
        "lists one private document by its path",
        (caller) => () => getDocs(query(group(caller), where(documentId(), "==", CONTACT), limit(1))),
      ),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, ...MAY_READ_ONE],
        "denied",
        "lists the private documents that hold addresses",
        (caller) => () => getDocs(query(group(caller), orderBy("emails"), limit(5))),
      ),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, ...MAY_READ_ONE],
        "denied",
        "counts every private document",
        (caller) => () => getCountFromServer(query(group(caller), limit(5))),
      ),
    });
  });

  it("is refused to a lead and a coordinator of units that the person does not belong to", async () => {
    // The person of the account `member` belongs to no replication and no laboratory.
    const unrelated = `persons/${MEMBER_PERSON}/private/contact`;
    await seed(environment, {
      [unrelated]: {
        ...stored(),
        emails: [{ email: "member.account@example.org", kind: "primary", verifiedAt: null, claimEligible: true }],
      },
    });
    await expectOutcomes({
      ...forEach(["ownLead", "otherLead", "ownCoordinator", "otherCoordinator"], "denied", "reads it", (caller) =>
        get(caller, unrelated),
      ),
      "member: reads the contact document of its own person": ["allowed", get("member", unrelated)],
    });
  });
});

describe("a copy of an address in another collection", () => {
  it("is refused in the login profile, the access document and the claim of another account", async () => {
    const others = EVERYONE.filter((caller) => caller !== "owner");
    await expectOutcomes({
      ...forEach(others, "denied", "reads the login profile", (caller) => get(caller, `users/${OWNER_UID}`)),
      ...forEach(others, "denied", "finds a login profile by its address", (caller) =>
        list(caller, "users", where("emailLower", "==", VICTIM_ADDRESS), limit(1)),
      ),
      ...forEach(others, "denied", "reads the access document", (caller) => get(caller, `access/${OWNER_UID}`)),
      ...forEach(others, "denied", "reads the claim", (caller) => get(caller, `accountClaims/${OWNER_UID}`)),
      ...forEach(others, "denied", "lists the claims", (caller) => list(caller, "accountClaims", limit(5))),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, "ownLead", "ownCoordinator"],
        "denied",
        "reads the evidence of the claim",
        (caller) => get(caller, storedPath("accountClaimReview")),
      ),
      ...forEach(
        [...OUTSIDERS, ...INSIDERS_WITHOUT_MANAGEMENT, "ownLead"],
        "denied",
        "reads the evidence of the laboratory claim",
        (caller) => get(caller, storedPath("labClaimReview")),
      ),
    });
  });

  it("is refused to every client where only trusted code reads: invitations, outbound mail and the two indexes", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "reads an invitation", (caller) => get(caller, storedPath("invitations"))),
      ...forEach(EVERYONE, "denied", "finds an invitation by its address", (caller) =>
        list(caller, "invitations", where("email", "==", "invited.person@example.org"), limit(1)),
      ),
      ...forEach(EVERYONE, "denied", "reads an outbound message", (caller) => get(caller, storedPath("mail"))),
      ...forEach(EVERYONE, "denied", "lists the outbound mail", (caller) => list(caller, "mail", limit(5))),
      ...forEach(EVERYONE, "denied", "reads the index of addresses", (caller) =>
        get(caller, storedPath("personEmailIndex")),
      ),
      ...forEach(EVERYONE, "denied", "lists the index of addresses", (caller) =>
        list(caller, "personEmailIndex", limit(5)),
      ),
      ...forEach(EVERYONE, "denied", "reads an identity key", (caller) => get(caller, storedPath("identityKeys"))),
    });
  });

  it("is refused in the outreach correspondence of a replication that the caller does not lead", async () => {
    const outreach = (caller: CallerKind) => collection(dbOf(caller), "outreachContacts");
    const withoutOutreach = [...NO_SIGHT_OF_THE_VICTIM, "owner", "ownCoordinator"] as const;
    await expectOutcomes({
      ...forEach(withoutOutreach, "denied", "reads an outreach row", (caller) =>
        get(caller, storedPath("outreachContacts")),
      ),
      ...forEach(withoutOutreach, "denied", "lists the rows of the replication", (caller) =>
        list(caller, "outreachContacts", where("replicationId", "==", OWN_REPLICATION), limit(5)),
      ),
      ...forEach(withoutOutreach, "denied", "looks an address up", (caller) =>
        list(caller, "outreachContacts", where("contactEmail", "==", "contact.person@example.org"), limit(1)),
      ),
      ...forEach(
        withoutOutreach,
        "denied",
        "counts the rows",
        (caller) => () => getCountFromServer(query(outreach(caller), limit(5))),
      ),
      // A lead reads the rows of its own replication, and no query widens that to another one.
      "otherLead: lists the rows of its own replication": [
        "allowed",
        list("otherLead", "outreachContacts", where("replicationId", "==", OTHER_REPLICATION), limit(5)),
      ],
      "otherLead: lists the rows of two replications": [
        "denied",
        list(
          "otherLead",
          "outreachContacts",
          where("replicationId", "in", [OTHER_REPLICATION, OWN_REPLICATION]),
          limit(5),
        ),
      ],
      "otherLead: lists the rows of every replication from its own onwards": [
        "denied",
        list("otherLead", "outreachContacts", where("replicationId", ">=", OTHER_REPLICATION), limit(5)),
      ],
      "otherLead: lists its own rows or those of another replication": [
        "denied",
        () =>
          getDocs(
            query(
              outreach("otherLead"),
              or(where("replicationId", "==", OTHER_REPLICATION), where("replicationId", "==", OWN_REPLICATION)),
              limit(5),
            ),
          ),
      ],
      "otherLead: lists by the scope key of another replication": [
        "denied",
        list("otherLead", "outreachContacts", where("scopeKeys", "array-contains", `rep:${OWN_REPLICATION}`), limit(5)),
      ],
    });
  });

  it("is refused in the private contact of a contributor outside the scope of its replication", async () => {
    const contact = storedPath("contributorContact");
    await expectOutcomes({
      ...forEach(
        [...OUTSIDERS, "ownLabMember", "ownCoordinator", "owner"],
        "denied",
        "reads the address of a contributor",
        (caller) => get(caller, contact),
      ),
      ...forEach(
        [...OUTSIDERS, "ownLabMember", "ownCoordinator", "ownLead"],
        "denied",
        "lists the private documents of contributors",
        (caller) => listAcrossParents(caller, "private", where("email", "!=", null), limit(5)),
      ),
      "ownLead: reads the address of a contributor of its replication": ["allowed", get("ownLead", contact)],
    });
  });

  it("is refused in the raw rows and the change logs of imports to everyone who does not run imports", async () => {
    const withoutImports = [...NO_SIGHT_OF_THE_VICTIM, "owner", "ownLead", "ownCoordinator"] as const;
    await expectOutcomes({
      ...forEach(withoutImports, "denied", "reads a raw row", (caller) => get(caller, storedPath("sourceRecords"))),
      ...forEach(withoutImports, "denied", "reads the continuation of a raw row", (caller) =>
        get(caller, storedPath("sourceRecordRawChunks")),
      ),
      ...forEach(withoutImports, "denied", "reads a change of a batch", (caller) =>
        get(caller, storedPath("importBatchChanges")),
      ),
      ...forEach(withoutImports, "denied", "lists the changes that name a person", (caller) =>
        listAcrossParents(caller, "changes", where("documentPath", "==", CONTACT), limit(5)),
      ),
    });
  });

  it("is refused in an account name of a unit that the caller does not belong to", async () => {
    await seed(environment, {
      "externalAccounts/account-google": {
        ...stored(),
        ownerType: "laboratory",
        ownerId: OWN_LABORATORY,
        system: "google",
        accountName: "synthetic.laboratory@example.org",
        scopeKeys: [`lab:${OWN_LABORATORY}`],
      },
      "externalAccounts/account-person": {
        ...stored(),
        ownerType: "person",
        ownerId: OWNER_PERSON,
        system: "google",
        accountName: VICTIM_ADDRESS,
        scopeKeys: [`user:${OWNER_UID}`],
      },
    });
    await expectOutcomes({
      ...forEach([...OUTSIDERS, "ownTeam", "ownLead"], "denied", "reads the account of the laboratory", (caller) =>
        get(caller, "externalAccounts/account-google"),
      ),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, "ownLead", "ownCoordinator"],
        "denied",
        "reads the account of the person",
        (caller) => get(caller, "externalAccounts/account-person"),
      ),
      ...forEach(
        [...NO_SIGHT_OF_THE_VICTIM, "ownLead", "ownCoordinator"],
        "denied",
        "lists by the key of another login",
        (caller) =>
          list(caller, "externalAccounts", where("scopeKeys", "array-contains", `user:${OWNER_UID}`), limit(5)),
      ),
      ...forEach(NO_SIGHT_OF_THE_VICTIM, "denied", "lists by its own key or that of another login", (caller) =>
        list(
          caller,
          "externalAccounts",
          where("scopeKeys", "array-contains-any", [`user:${uidOfCaller("member")}`, `user:${OWNER_UID}`]),
          limit(5),
        ),
      ),
      "owner: reads the account of its own person": ["allowed", get("owner", "externalAccounts/account-person")],
    });
  });
});
