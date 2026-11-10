// Red-team attacks on the envelope of a write, from each of the five attackers on a record that
// the attacker may legitimately change: an editor that is someone else, a time of the client's
// choosing, a change to who created the record and when, a write context that claims an import
// or an audit entry, a change to an identifier, a scope field, the origin or the provenance,
// through an update, through a set with merge and through a set that replaces the document,
// a hard delete, a delete followed by a fresh document, and an archive outside the attacker's scope.
//
// Every test states the secure behaviour: the request is refused.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { unitScopeKeys, userWriteContext } from "@eegml/shared";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  arrayUnion,
  deleteField,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  MEMBER_PERSON,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_REPLICATION,
  OWNER_PERSON,
  SECOND_PARTICIPATION,
  STORED_AT,
  stored,
  updatedBy,
} from "../world";
import {
  ATTACKERS,
  type Attacker,
  arena,
  IMPORTED_LABORATORY,
  LABORATORY,
  PARTICIPATION,
  REPLICATION,
} from "./integrity-and-audit-support";

const lab = arena("envelope");

const past = () => Timestamp.fromMillis(Date.now() - 3_600_000);
const future = () => Timestamp.fromMillis(Date.now() + 3_600_000);
const MEMBER_AFFILIATION = `persons/${MEMBER_PERSON}/affiliations/affiliation-of-member`;

/** A record that each attacker may change, an honest change to it, and fields that are not theirs to change. */
const GROUND: {
  readonly [K in Attacker]: {
    readonly path: string;
    readonly honest: Record<string, unknown>;
    readonly fixed: Record<string, unknown>;
  };
} = {
  member: {
    path: `persons/${MEMBER_PERSON}`,
    honest: { scholarUrl: "https://example.org/scholar/synthetic-member" },
    fixed: { slug: "synthetic-owner", userId: "uid-owner", claimedAt: Timestamp.fromMillis(0), dataOrigin: "live" },
  },
  ownLabMember: {
    path: `${PARTICIPATION}/checklist/ethics`,
    honest: { status: "inProgress" },
    fixed: {
      templateKey: "another-template",
      templateItemKey: "training",
      label: "Ethics waived",
      position: 0,
      replicationId: OTHER_REPLICATION,
      laboratoryId: OTHER_LABORATORY,
      scopeKeys: ["members"],
    },
  },
  ownCoordinator: {
    path: LABORATORY,
    honest: { city: "Example Town" },
    fixed: { slug: "another-laboratory", dataOrigin: "live" },
  },
  ownLead: {
    path: REPLICATION,
    honest: { shortTitle: "Synthetic study, renamed" },
    fixed: {
      studyKey: "AnotherStudy1999",
      statusKey: "published",
      statusHistoryId: "history-1",
      leadPersonIds: ["person-synthetic-own-lead"],
      dataOrigin: "live",
    },
  },
  coreTeam: {
    path: `persons/${OWNER_PERSON}`,
    honest: { displayName: "Synthetic Owner-Example" },
    fixed: {
      slug: "another-person",
      userId: "uid-core-team",
      claimedAt: Timestamp.fromMillis(0),
      laboratoryIds: [],
      replicationIds: [],
      dataOrigin: "live",
    },
  },
};

describe.each(ATTACKERS)("the envelope of a write by the attacker: %s", (attacker) => {
  const { path, honest, fixed } = GROUND[attacker];
  const uid = () => lab.uid(attacker);
  const target = () => doc(lab.db(attacker), path);
  const stamp = () => updatedBy(uid());

  it("is accepted where it is honest", async () => {
    await assertSucceeds(updateDoc(target(), { ...honest, ...stamp() }));
    const after = await lab.stored(path);
    expect(after?.updatedBy).toBe(uid());
    expect(after?.createdBy).toBe("system:import");
  });

  it.each([
    ["another account as the editor", { updatedBy: "uid-owner" }],
    ["trusted code as the editor", { updatedBy: "system:import" }],
    ["nobody as the editor", { updatedBy: null }],
    ["a time of the change in the past", { updatedAt: past() }],
    ["a time of the change in the future", { updatedAt: future() }],
    ["the context of an import", { writeContext: { ...userWriteContext(), origin: "import" } }],
    ["the context of trusted code", { writeContext: { ...userWriteContext(), origin: "system" } }],
    ["a context that names an audit entry, as a function would", { writeContext: userWriteContext("event-1") }],
    ["a context deep in a chain of automations", { writeContext: { ...userWriteContext(), depth: 7 } }],
    ["a context with a key of its own", { writeContext: { ...userWriteContext(), approvedBy: "uid-admin" } }],
    ["the attacker as the creator", { createdBy: "self" }],
    ["another time of creation", { createdAt: serverTimestamp() }],
    ["another schema version", { schemaVersion: 2 }],
    ["a key that the schema does not name", { redTeam: true }],
  ] as const)("is refused with %s", async (_label, forged) => {
    const patch: Record<string, unknown> = { ...honest, ...stamp(), ...forged };
    if (patch.createdBy === "self") patch.createdBy = uid();
    await assertFails(updateDoc(target(), patch));
  });

  it("is refused with no editor and no time of its own, so that the last honest writer stays named", async () => {
    await assertFails(updateDoc(target(), honest));
    await assertFails(updateDoc(target(), { ...honest, updatedBy: uid() }));
    await assertFails(updateDoc(target(), { ...honest, updatedAt: serverTimestamp() }));
  });

  it("is refused where it removes the record of who created the document and when", async () => {
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), createdBy: deleteField() }));
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), createdAt: deleteField() }));
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), writeContext: deleteField() }));
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), schemaVersion: deleteField() }));
  });

  it.each(Object.entries(fixed))("is refused where an update changes the field %s", async (field, value) => {
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), [field]: value }));
  });

  it.each(Object.entries(fixed))("is refused where a set with merge changes the field %s", async (field, value) => {
    await assertFails(setDoc(target(), { ...honest, ...stamp(), [field]: value }, { merge: true }));
  });

  it("is refused where a set replaces the document and changes or drops a field that is not the attacker's", async () => {
    const current = (await lab.stored(path)) ?? {};
    const honestCopy = { ...current, ...honest, ...stamp() };
    await assertSucceeds(setDoc(target(), honestCopy));
    for (const [field, value] of Object.entries(fixed)) {
      const fresh = { ...((await lab.stored(path)) ?? {}), ...stamp() };
      await assertFails(setDoc(target(), { ...fresh, [field]: value }));
      const { [field]: _dropped, ...without } = fresh;
      await assertFails(setDoc(target(), without));
    }
    const fresh = { ...((await lab.stored(path)) ?? {}), ...stamp() };
    await assertFails(setDoc(target(), { ...fresh, createdBy: uid() }));
    await assertFails(setDoc(target(), { ...fresh, createdAt: serverTimestamp() }));
  });

  it("is refused where it takes the provenance of an import, or sheds it", async () => {
    const provenance = {
      sourceRecordIds: ["source-record-1"],
      fieldSources: { displayName: "source-record-1" },
      importedValues: { displayName: "A value from a source" },
      sourceCreatedAt: STORED_AT,
      sourceAuthor: { personId: null, nameSource: "Synthetic Author" },
    };
    for (const [field, value] of Object.entries(provenance)) {
      await assertFails(updateDoc(target(), { ...honest, ...stamp(), [field]: value }));
    }
    const current = (await lab.stored(path)) ?? {};
    await lab.plant({ [path]: { ...current, ...provenance } });
    for (const field of Object.keys(provenance)) {
      await assertFails(updateDoc(target(), { ...honest, ...stamp(), [field]: deleteField() }));
    }
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), sourceRecordIds: arrayUnion("source-record-2") }));
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), "fieldSources.displayName": "source-record-2" }));
    await assertFails(updateDoc(target(), { ...honest, ...stamp(), "importedValues.displayName": "Forged" }));
  });

  it("is refused as a delete, and as a fresh document in place of the stored one", async () => {
    await assertFails(lab.remove(attacker, path));
    const { createdAt: _createdAt, createdBy: _createdBy, ...rest } = (await lab.stored(path)) ?? {};
    await assertFails(
      setDoc(target(), { ...rest, ...honest, ...stamp(), createdAt: serverTimestamp(), createdBy: uid() }),
    );
  });
});

describe("an archive", () => {
  it("is set at the time of the request, never at a time of the attacker's choosing", async () => {
    await assertFails(lab.update("ownCoordinator", LABORATORY, { archivedAt: past() }));
    await assertFails(lab.update("ownCoordinator", LABORATORY, { archivedAt: future() }));
    await assertFails(lab.update("ownLead", REPLICATION, { archivedAt: Timestamp.fromMillis(0) }));
    await assertFails(lab.update("ownLead", REPLICATION, { archivedAt: true }));
    await assertFails(lab.update("ownLead", REPLICATION, { archivedAt: "2020-01-01" }));
    await assertSucceeds(lab.update("ownCoordinator", LABORATORY, { archivedAt: serverTimestamp() }));
  });

  it.each([
    ["an ordinary member", "member", [REPLICATION, LABORATORY, PARTICIPATION, `persons/${OWNER_PERSON}`]],
    ["a member of laboratory A", "ownLabMember", [LABORATORY, PARTICIPATION, `${PARTICIPATION}/checklist/ethics`]],
    [
      "a coordinator of laboratory A",
      "ownCoordinator",
      [
        `laboratories/${OTHER_LABORATORY}`,
        `participations/${SECOND_PARTICIPATION}`,
        REPLICATION,
        `${REPLICATION}/hypotheses/h01`,
        "manuscripts/manuscript-1",
        `persons/${OWNER_PERSON}`,
        "institutions/institution-1",
      ],
    ],
    [
      "a lead of replication X",
      "ownLead",
      [
        `replications/${OTHER_REPLICATION}`,
        LABORATORY,
        `${LABORATORY}/members/${OWNER_PERSON}`,
        `persons/${OWNER_PERSON}`,
        "statusDefinitions/replication__planning",
        "programmes/synthetic-programme",
        "countCategories/tested",
      ],
    ],
  ] as const)("is not set by %s on a record outside their scope", async (_who, attacker, paths) => {
    for (const path of paths) {
      await assertFails(lab.update(attacker, path, { archivedAt: serverTimestamp() }));
    }
  });

  it("is not lifted by a lead from a replication that a programme administrator archived", async () => {
    // Nothing on the record says who archived it, so once it is restored only the audit trail knows.
    const replication = await lab.stored(REPLICATION);
    await lab.plant({ [REPLICATION]: { ...replication, archivedAt: STORED_AT, updatedBy: "uid-admin" } });
    await assertFails(lab.update("ownLead", REPLICATION, { archivedAt: null }));
  });

  it("freezes the record: a lead does not rewrite a replication that is archived", async () => {
    const replication = await lab.stored(REPLICATION);
    await lab.plant({ [REPLICATION]: { ...replication, archivedAt: STORED_AT, updatedBy: "uid-admin" } });
    await assertFails(lab.update("ownLead", REPLICATION, { shortTitle: "Rewritten after it was withdrawn" }));
  });

  it("is not set by the lead of another replication or the coordinator of another laboratory", async () => {
    await assertFails(lab.update("otherLead", REPLICATION, { archivedAt: serverTimestamp() }));
    await assertFails(lab.update("otherLead", PARTICIPATION, { archivedAt: serverTimestamp() }));
    await assertFails(lab.update("otherCoordinator", LABORATORY, { archivedAt: serverTimestamp() }));
    await assertFails(lab.update("otherCoordinator", PARTICIPATION, { archivedAt: serverTimestamp() }));
  });
});

describe("a hard delete of a core record", () => {
  const CORE_RECORDS = [
    REPLICATION,
    `replications/${OTHER_REPLICATION}`,
    `${REPLICATION}/private/detail`,
    `${REPLICATION}/hypotheses/h01`,
    `${REPLICATION}/protocols/protocol-1`,
    `${REPLICATION}/protocolVersions/version-1`,
    `${REPLICATION}/equipmentRequirements/min-channels`,
    `${REPLICATION}/memberships/${OWNER_PERSON}__member`,
    LABORATORY,
    IMPORTED_LABORATORY,
    `${LABORATORY}/private/detail`,
    `${LABORATORY}/members/${OWNER_PERSON}`,
    `${LABORATORY}/equipment/configuration-1`,
    PARTICIPATION,
    `${PARTICIPATION}/private/detail`,
    `${PARTICIPATION}/checklist/ethics`,
    `${PARTICIPATION}/teamMembers/${OWNER_PERSON}`,
    `${PARTICIPATION}/deviations/deviation-1`,
    `persons/${OWNER_PERSON}`,
    `persons/${MEMBER_PERSON}`,
    `persons/${OWNER_PERSON}/private/address`,
    `persons/${OWNER_PERSON}/private/notes`,
    `persons/${OWNER_PERSON}/affiliations/affiliation-1`,
    MEMBER_AFFILIATION,
    "institutions/institution-1",
    "programmes/synthetic-programme",
    "manuscripts/manuscript-1",
    "manuscripts/manuscript-1/events/event-1",
    "contributorTables/table-1",
    "contributors/contributor-1",
    "contributors/contributor-1/private/contact",
    "documentLinks/link-1",
    "externalAccounts/account-1",
    "candidateStudies/candidate-1",
    "statusDefinitions/replication__planning",
    "vocabularyTerms/term-1",
    "predictionMarketItems/item-1",
    "checklistTemplates/onboarding",
    "countCategories/tested",
    "correctionRequests/request-1",
  ];

  it.each([...ATTACKERS, "owner", "admin"] as const)("is refused to the caller: %s", async (attacker) => {
    await lab.plant({
      [MEMBER_AFFILIATION]: { ...stored(), personId: MEMBER_PERSON, affiliationSource: "Example", isPrimary: true },
    });
    const removed: string[] = [];
    for (const path of CORE_RECORDS) {
      try {
        await assertFails(lab.remove(attacker, path));
      } catch {
        removed.push(path);
      }
    }
    expect(removed).toEqual([]);
    for (const path of CORE_RECORDS) expect(await lab.stored(path), path).not.toBeNull();
  });
});

describe("a number or a list that a client changes with a transform", () => {
  it("stays within the checks of the rules", async () => {
    const coordinator = lab.db("ownCoordinator");
    const stamp = updatedBy(lab.uid("ownCoordinator"));
    await assertFails(updateDoc(doc(coordinator, PARTICIPATION), { ...stamp, targetNMain: increment(-5) }));
    await assertFails(updateDoc(doc(coordinator, PARTICIPATION), { ...stamp, targetNMain: increment(0.5) }));
    await assertFails(updateDoc(doc(coordinator, PARTICIPATION), { ...stamp, targetNMain: increment(2_000_000) }));
    await assertFails(updateDoc(doc(coordinator, PARTICIPATION), { ...stamp, scopeKeys: arrayUnion("members") }));
    await assertFails(
      updateDoc(doc(coordinator, PARTICIPATION), { ...stamp, scopeKeys: arrayUnion(`rep:${OTHER_REPLICATION}`) }),
    );
    await assertFails(
      updateDoc(doc(lab.db("ownLead"), REPLICATION), {
        ...updatedBy(lab.uid("ownLead")),
        leadPersonIds: arrayUnion("person-synthetic-own-lead"),
      }),
    );
    await assertSucceeds(updateDoc(doc(coordinator, PARTICIPATION), { ...stamp, targetNMain: increment(5) }));
    expect((await lab.stored(PARTICIPATION))?.targetNMain).toBe(5);
  });
});

describe("a new document", () => {
  const favourite = `users/uid-member/favourites/replication__${OWN_REPLICATION}`;
  const fields = { uid: "uid-member", entityType: "replication", entityId: OWN_REPLICATION };
  const honest = () => ({
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    createdBy: "uid-member",
    updatedAt: serverTimestamp(),
    updatedBy: "uid-member",
    archivedAt: null,
    writeContext: userWriteContext(),
  });
  const create = (envelope: Record<string, unknown>) =>
    setDoc(doc(lab.db("member"), favourite), { ...fields, ...honest(), ...envelope });

  it("names its creator and the time of the request, and nothing else", async () => {
    await assertFails(create({ createdBy: "uid-owner" }));
    await assertFails(create({ createdBy: "system:import" }));
    await assertFails(create({ updatedBy: "uid-owner" }));
    await assertFails(create({ createdAt: past() }));
    await assertFails(create({ createdAt: future() }));
    await assertFails(create({ updatedAt: past() }));
    await assertFails(create({ archivedAt: serverTimestamp() }));
    await assertFails(create({ schemaVersion: 0 }));
    await assertFails(create({ writeContext: userWriteContext("event-1") }));
    await assertFails(create({ writeContext: { ...userWriteContext(), origin: "import" } }));
    await assertFails(create({ dataOrigin: "importedHistorical" }));
    await assertFails(create({ sourceRecordIds: ["source-record-1"] }));
    await assertSucceeds(create({}));
  });

  it("does not replace the participation that exists with one of the attacker's making", async () => {
    // A set on the path of a stored document is an update, so the record of its creation stays.
    await assertFails(
      lab.create("ownCoordinator", PARTICIPATION, {
        replicationId: OWN_REPLICATION,
        laboratoryId: OWN_LABORATORY,
        scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
        status: "interested",
        statusHistoryId: null,
        readinessStatus: "notStarted",
        custom: {},
        dataOrigin: "live",
      }),
    );
    expect((await lab.stored(PARTICIPATION))?.createdBy).toBe("system:import");
  });
});
