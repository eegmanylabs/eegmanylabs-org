// The refusals that the registry of replications and members relies on, proved at the security
// rules: the interface hides these controls, and these tests show that hiding them is never what
// protects the data. Each refusal stands beside the honest request that the rules accept.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { COLLECTIONS, entityRefId, MEMBERS_SCOPE_KEY } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, limit, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld } from "./seed";
import { createRulesEnvironment } from "./support";
import { autoId, MEMBER_UID, OTHER_REPLICATION, OWN_REPLICATION, OWNER_PERSON, OWNER_UID, uidOfCaller } from "./world";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, create, update, remove } = requestsOf(() => environment);

const REPLICATION = COLLECTIONS.replications.docPath(OWN_REPLICATION);
const PERSON = COLLECTIONS.persons.docPath(OWNER_PERSON);
const CONTACT = COLLECTIONS.personContact.docPath(OWNER_PERSON);
const DEMOGRAPHICS = COLLECTIONS.personDemographics.docPath(OWNER_PERSON);
const DETAIL = COLLECTIONS.replicationDetail.docPath(OWN_REPLICATION);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-registry");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

describe("editing a replication in place", () => {
  it("is accepted from a lead of the replication, the core team and administrators, and refused from anyone else", async () => {
    const edit = (caller: Parameters<typeof update>[0], title: string) =>
      update(caller, REPLICATION, { shortTitle: title });
    await expectOutcomes({
      "a lead of the replication edits its short title": ["allowed", edit("ownLead", "Edited by its lead")],
      "the core team edits it": ["allowed", edit("coreTeam", "Edited by the core team")],
      "an administrator edits it": ["allowed", edit("admin", "Edited by an administrator")],
      "a lead of another replication is refused": ["denied", edit("otherLead", "Edited by another lead")],
      "a confirmed team member who is no lead is refused": ["denied", edit("ownTeam", "Edited by its team")],
      "a member is refused": ["denied", edit("member", "Edited by a member")],
      "a caller who is not signed in is refused": ["denied", edit("signedOut", "Edited by nobody")],
      "an administrator without the second factor is refused": ["denied", edit("adminWithoutFactor", "Edited")],
    });
  });

  it("checks each value as the shared schema does, and lets a lead clear an optional field", async () => {
    await expectOutcomes({
      "a year outside the range is refused": ["denied", update("ownLead", REPLICATION, { originalYear: 1066 })],
      "a sign-up link that is no web address is refused": [
        "denied",
        update("ownLead", REPLICATION, { signupUrl: "javascript:alert(1)" }),
      ],
      "a valid year is accepted": ["allowed", update("ownLead", REPLICATION, { originalYear: 2001 })],
      "clearing the year is accepted": ["allowed", update("ownLead", REPLICATION, { originalYear: deleteField() })],
    });
  });
});

describe("the status of a replication", () => {
  it("never changes through a direct write, whoever writes, so the function is the only way (D-019)", async () => {
    const history = COLLECTIONS.statusHistory.docPath(autoId("historyForged"));
    await expectOutcomes({
      "a lead sets the status directly": ["denied", update("ownLead", REPLICATION, { statusKey: "collecting" })],
      "an administrator sets the status directly": [
        "denied",
        update("admin", REPLICATION, { statusKey: "collecting" }),
      ],
      "an administrator points the replication at another history entry": [
        "denied",
        update("admin", REPLICATION, { statusHistoryId: "history-forged" }),
      ],
      "a lead writes a history entry": [
        "denied",
        create(
          "ownLead",
          history,
          {
            entityType: "replication",
            entityId: OWN_REPLICATION,
            fromStatusKey: null,
            toStatusKey: "collecting",
            effectiveAt: new Date(),
            recordedAt: new Date(),
            changedBy: uidOfCaller("ownLead"),
            source: "manual",
            replicationId: OWN_REPLICATION,
            laboratoryId: null,
            scopeKeys: [`rep:${OWN_REPLICATION}`, MEMBERS_SCOPE_KEY],
          },
          true,
        ),
      ],
      "an administrator removes a history entry": [
        "denied",
        remove("admin", COLLECTIONS.statusHistory.docPath("history-1")),
      ],
      "a lead derives the leads directly": [
        "denied",
        update("ownLead", REPLICATION, { leadPersonIds: [OWNER_PERSON] }),
      ],
      "a member reads the status history of a replication": [
        "allowed",
        list(
          "member",
          COLLECTIONS.statusHistory.collectionPath(),
          where("entityType", "==", "replication"),
          where("entityId", "==", OWN_REPLICATION),
          where("scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]),
          limit(20),
        ),
      ],
    });
  });
});

describe("what the replication page reads", () => {
  it("keeps the restricted detail, with its unverified labels, to the team and the programme", async () => {
    await expectOutcomes({
      "a member reads the restricted detail": ["denied", get("member", DETAIL)],
      "a lead of another replication reads it": ["denied", get("otherLead", DETAIL)],
      "the team of the replication reads it": ["allowed", get("ownTeam", DETAIL)],
      "the core team reads it": ["allowed", get("coreTeam", DETAIL)],
    });
  });

  it("lists the memberships that wait for review only for the team and the programme", async () => {
    const toReview = (caller: Parameters<typeof listAcrossParents>[0]) =>
      listAcrossParents(caller, "memberships", where("reviewStatus", "==", "needsReview"), limit(50));
    await expectOutcomes({
      "a member lists them across replications": ["denied", toReview("member")],
      "a lead lists them across replications": ["denied", toReview("ownLead")],
      "the core team lists them": ["allowed", toReview("coreTeam")],
      "an administrator without the second factor lists them": ["denied", toReview("adminWithoutFactor")],
      "a member lists the confirmed ones": [
        "allowed",
        listAcrossParents("member", "memberships", where("reviewStatus", "==", "confirmed"), limit(50)),
      ],
    });
  });
});

describe("what the member page reads and writes", () => {
  it("serves the contact document to the person and to the programme, and refuses an unrelated member", async () => {
    await expectOutcomes({
      "the person reads their own contact details": ["allowed", get("owner", CONTACT)],
      "an unrelated member reads them": ["denied", get("member", CONTACT)],
      "a lead of another replication reads them": ["denied", get("otherLead", CONTACT)],
      "an administrator reads them": ["allowed", get("admin", CONTACT)],
    });
  });

  it("never serves demographic details from the database, to the person or to an administrator", async () => {
    await expectOutcomes({
      "the person reads their own demographics": ["denied", get("owner", DEMOGRAPHICS)],
      "an administrator reads them": ["denied", get("admin", DEMOGRAPHICS)],
      "the core team reads them": ["denied", get("coreTeam", DEMOGRAPHICS)],
    });
  });

  it("lets the person edit the profile addresses and nothing else, and nobody else edit them", async () => {
    await expectOutcomes({
      "the person sets a profile address": ["allowed", update("owner", PERSON, { labUrl: "https://example.org/lab" })],
      "the person removes it": ["allowed", update("owner", PERSON, { labUrl: deleteField() })],
      "the person changes their family name": ["denied", update("owner", PERSON, { familyName: "Renamed" })],
      "the person sets their ORCID iD directly": ["denied", update("owner", PERSON, { orcid: "0000-0002-1825-0097" })],
      "another member sets the person's profile address": [
        "denied",
        update("member", PERSON, { labUrl: "https://example.org/elsewhere" }),
      ],
      "the person sets an address that is no web address": [
        "denied",
        update("owner", PERSON, { labUrl: "javascript:alert(1)" }),
      ],
    });
  });
});

describe("favourites and recent items", () => {
  const reference = entityRefId("replication", OTHER_REPLICATION);
  const record = (uid: string) => ({ uid, entityType: "replication", entityId: OTHER_REPLICATION });

  it("belong to their account alone", async () => {
    await expectOutcomes({
      "a member stars a record for themselves": [
        "allowed",
        create("member", COLLECTIONS.userFavourites.docPath(MEMBER_UID, reference), record(MEMBER_UID)),
      ],
      "a member stars a record for another account": [
        "denied",
        create("member", COLLECTIONS.userFavourites.docPath(OWNER_UID, reference), record(OWNER_UID)),
      ],
      "a member reads another account's favourites": [
        "denied",
        list("member", COLLECTIONS.userFavourites.collectionPath(OWNER_UID), limit(10)),
      ],
      "a member records a visit for themselves": [
        "allowed",
        create("member", COLLECTIONS.userRecents.docPath(MEMBER_UID, reference), record(MEMBER_UID)),
      ],
      "a member updates the time of that visit": [
        "allowed",
        update("member", COLLECTIONS.userRecents.docPath(MEMBER_UID, reference), {}),
      ],
      "a member records a visit for another account": [
        "denied",
        create("member", COLLECTIONS.userRecents.docPath(OWNER_UID, reference), record(OWNER_UID)),
      ],
      "a member reads another account's recent items": [
        "denied",
        list("member", COLLECTIONS.userRecents.collectionPath(OWNER_UID), limit(10)),
      ],
      "a favourite under an identifier that is not its record is refused": [
        "denied",
        create("member", COLLECTIONS.userFavourites.docPath(MEMBER_UID, "replication__Elsewhere"), record(MEMBER_UID)),
      ],
      "a member removes their own star": [
        "allowed",
        remove("member", COLLECTIONS.userFavourites.docPath(MEMBER_UID, reference)),
      ],
    });
  });
});
