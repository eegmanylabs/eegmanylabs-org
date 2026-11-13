// Integration tests of participation, run against the emulators: createParticipation and
// setParticipationStatus.
// Fixtures are synthetic: fictitious accounts, people, laboratories and studies on the example.org domain.
import {
  COLLECTIONS,
  createParticipationContract,
  ONBOARDING_CHECKLIST_TEMPLATE,
  type ParticipationStatus,
  participationChecklistItemDocSchema,
  participationDocSchema,
  setParticipationStatusContract,
  statusHistoryDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  auditOf,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  grantRole,
  laboratory,
  person,
  refusal,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const STUDY = "SyntheticStudy2001";
const LAB = "lab-synthetic";
const PARTICIPATION = `${STUDY}__${LAB}`;

async function world() {
  await replication(STUDY);
  await replication("SyntheticStudy2002");
  await laboratory(LAB);
  await person("person-local-lead");
  await adminDb
    .doc(COLLECTIONS.checklistTemplates.docPath(ONBOARDING_CHECKLIST_TEMPLATE.key))
    .set({ ...standard(), key: ONBOARDING_CHECKLIST_TEMPLATE.key, items: ONBOARDING_CHECKLIST_TEMPLATE.items });
  const lead = await account("uid-lead");
  await grantRole("uid-lead", "replication_lead", "replication", STUDY);
  const otherLead = await account("uid-other-lead");
  await grantRole("uid-other-lead", "replication_lead", "replication", "SyntheticStudy2002");
  const coordinator = await account("uid-coordinator");
  await grantRole("uid-coordinator", "lab_coordinator", "laboratory", LAB);
  const labMember = await account("uid-lab-member");
  await grantRole("uid-lab-member", "lab_member", "laboratory", LAB);
  return { lead, otherLead, coordinator, labMember };
}

const INPUT = {
  replicationId: STUDY,
  laboratoryId: LAB,
  localLeadPersonId: "person-local-lead",
  targetNMain: 40,
  targetNRest: 30,
  reason: "Invited after the call for laboratories.",
} as const;

describe("createParticipation", () => {
  it("lets a lead of the replication create it, and refuses the laboratory, other leads and members", async () => {
    const { lead, otherLead, coordinator, labMember } = await world();
    expect(await codeOf(call(coordinator, createParticipationContract, INPUT))).toBe("permission-denied");
    expect(await codeOf(call(labMember, createParticipationContract, INPUT))).toBe("permission-denied");
    expect(await codeOf(call(otherLead, createParticipationContract, INPUT))).toBe("permission-denied");
    expect(await codeOf(call(null, createParticipationContract, INPUT))).toBe("unauthenticated");
    const created = await call(lead, createParticipationContract, INPUT);
    expect(created).toMatchObject({ participationId: PARTICIPATION, status: "invited", checklistItems: 9 });

    const participation = participationDocSchema.parse(await dataOf(COLLECTIONS.participations.docPath(PARTICIPATION)));
    expect(participation).toMatchObject({
      replicationId: STUDY,
      laboratoryId: LAB,
      scopeKeys: [`rep:${STUDY}`, `lab:${LAB}`],
      status: "invited",
      statusHistoryId: created.statusHistoryId,
      targetNMain: 40,
      targetNRest: 30,
      readinessStatus: "notStarted",
      dataOrigin: "live",
    });
    expect(await dataOf(COLLECTIONS.participationDetail.docPath(PARTICIPATION))).toMatchObject({
      ethicsStatus: "unknown",
      trainingStatus: "unknown",
      readinessApprovedBy: null,
    });
    const history = statusHistoryDocSchema.parse(
      await dataOf(COLLECTIONS.statusHistory.docPath(created.statusHistoryId)),
    );
    expect(history).toMatchObject({
      entityType: "participation",
      entityId: PARTICIPATION,
      fromStatusKey: null,
      toStatusKey: "invited",
      reason: INPUT.reason,
      scopeKeys: [`rep:${STUDY}`, `lab:${LAB}`, "members"],
    });
    const [audit] = await auditOf("participation.created", PARTICIPATION);
    expect(audit?.changes).toEqual(
      expect.arrayContaining([
        { field: "targetNMain", after: 40 },
        { field: "targetNRest", after: 30 },
      ]),
    );
    expect(participation.writeContext.auditEventId).toBe(audit?.writeContext.auditEventId);
  });

  it("instantiates the checklist from the template, with its labels and positions copied", async () => {
    const { lead } = await world();
    await call(lead, createParticipationContract, INPUT);
    const items = (
      await adminDb.collection(COLLECTIONS.participationChecklist.collectionPath(PARTICIPATION)).get()
    ).docs
      .map((document) => participationChecklistItemDocSchema.parse(document.data()))
      .sort((a, b) => a.position - b.position);
    expect(items.map((item) => [item.templateItemKey, item.label, item.position, item.status])).toEqual(
      ONBOARDING_CHECKLIST_TEMPLATE.items.map((item, position) => [item.key, item.label, position, "notStarted"]),
    );
    expect(items.map((item) => item.templateItemKey)).toEqual([
      "participationConfirmation",
      "verifiedContacts",
      "equipmentConfirmation",
      "ethics",
      "protocolReview",
      "training",
      "technicalChecks",
      "pilot",
      "readinessApproval",
    ]);
    for (const item of items) {
      expect(item).toMatchObject({ replicationId: STUDY, laboratoryId: LAB, completedBy: null, completedAt: null });
    }
    // A later edit of the template leaves the checklist as it was.
    await adminDb
      .doc(COLLECTIONS.checklistTemplates.docPath("onboarding"))
      .update({ items: [{ key: "ethics", label: "Edited later" }] });
    expect((await dataOf(COLLECTIONS.participationChecklist.docPath(PARTICIPATION, "ethics")))?.label).toBe("Ethics");
  });

  it("refuses a duplicate, a missing laboratory and a missing template, and writes nothing then", async () => {
    const { lead } = await world();
    await call(lead, createParticipationContract, INPUT);
    const duplicate = await refusal(call(lead, createParticipationContract, INPUT));
    expect(duplicate.code).toBe("already-exists");
    expect(await auditOf("participation.created")).toHaveLength(1);
    expect(
      await codeOf(call(lead, createParticipationContract, { replicationId: STUDY, laboratoryId: "lab-missing" })),
    ).toBe("not-found");
    await laboratory("lab-second");
    expect(
      await codeOf(
        call(lead, createParticipationContract, {
          replicationId: STUDY,
          laboratoryId: "lab-second",
          localLeadPersonId: "person-missing",
        }),
      ),
    ).toBe("invalid-argument");
    await adminDb.doc(COLLECTIONS.checklistTemplates.docPath("onboarding")).delete();
    expect(
      await codeOf(call(lead, createParticipationContract, { replicationId: STUDY, laboratoryId: "lab-second" })),
    ).toBe("failed-precondition");
    expect((await adminDb.doc(COLLECTIONS.participations.docPath(`${STUDY}__lab-second`)).get()).exists).toBe(false);
  });

  it("lets the core team and administrators create one too", async () => {
    await world();
    const core = await coreTeamMember("uid-core");
    const admin = await administrator("uid-admin");
    await laboratory("lab-second");
    await call(core, createParticipationContract, { replicationId: STUDY, laboratoryId: LAB });
    await call(admin, createParticipationContract, { replicationId: STUDY, laboratoryId: "lab-second" });
    expect(await auditOf("participation.created")).toHaveLength(2);
  });
});

describe("setParticipationStatus", () => {
  it("changes the status with a reason and a history entry, for the laboratory and the replication", async () => {
    const { lead, coordinator, labMember } = await world();
    await call(lead, createParticipationContract, INPUT);
    const change = (fromStatus: ParticipationStatus, toStatus: ParticipationStatus) =>
      ({ participationId: PARTICIPATION, fromStatus, toStatus, reason: `From ${fromStatus} to ${toStatus}.` }) as const;

    expect(await codeOf(call(labMember, setParticipationStatusContract, change("invited", "confirmed")))).toBe(
      "permission-denied",
    );
    const confirmed = await call(coordinator, setParticipationStatusContract, change("invited", "confirmed"));
    expect(confirmed.status).toBe("confirmed");
    await call(coordinator, setParticipationStatusContract, change("confirmed", "onboarding"));
    // Ready speaks for the replication.
    expect(await codeOf(call(coordinator, setParticipationStatusContract, change("onboarding", "ready")))).toBe(
      "permission-denied",
    );
    await call(lead, setParticipationStatusContract, change("onboarding", "ready"));
    // A status the caller did not see, and the same status, are refused.
    expect(await codeOf(call(lead, setParticipationStatusContract, change("onboarding", "collecting")))).toBe(
      "failed-precondition",
    );
    expect(await codeOf(call(lead, setParticipationStatusContract, change("ready", "ready")))).toBe(
      "failed-precondition",
    );

    const participation = participationDocSchema.parse(await dataOf(COLLECTIONS.participations.docPath(PARTICIPATION)));
    expect(participation.status).toBe("ready");
    const history = (
      await adminDb.collection(COLLECTIONS.statusHistory.collectionPath()).where("entityId", "==", PARTICIPATION).get()
    ).docs.map((document) => statusHistoryDocSchema.parse(document.data()));
    expect(history.map((entry) => [entry.fromStatusKey, entry.toStatusKey]).sort()).toEqual(
      [
        [null, "invited"],
        ["invited", "confirmed"],
        ["confirmed", "onboarding"],
        ["onboarding", "ready"],
      ].sort(),
    );
    expect(await auditOf("participation.statusChanged", PARTICIPATION)).toHaveLength(3);
    // A caller who may change nothing learns nothing about which participations exist.
    const missing = {
      participationId: `${STUDY}__lab-missing`,
      fromStatus: "invited",
      toStatus: "confirmed",
      reason: "None.",
    } as const;
    expect(await codeOf(call(lead, setParticipationStatusContract, missing))).toBe("permission-denied");
    expect(await codeOf(call(await administrator("uid-admin"), setParticipationStatusContract, missing))).toBe(
      "not-found",
    );
  });
});

describe("the moves of a participation", () => {
  const change = (fromStatus: ParticipationStatus, toStatus: ParticipationStatus) =>
    ({ participationId: PARTICIPATION, fromStatus, toStatus, reason: `From ${fromStatus} to ${toStatus}.` }) as const;
  const storedStatus = async () =>
    participationDocSchema.parse(await dataOf(COLLECTIONS.participations.docPath(PARTICIPATION))).status;

  it("starts collection only once readiness is approved and signed, on the replication's word", async () => {
    const { lead, coordinator } = await world();
    await call(lead, createParticipationContract, INPUT);
    await call(coordinator, setParticipationStatusContract, change("invited", "confirmed"));
    await call(coordinator, setParticipationStatusContract, change("confirmed", "onboarding"));
    await call(lead, setParticipationStatusContract, change("onboarding", "ready"));
    // Readiness is not approved yet.
    expect(await codeOf(call(lead, setParticipationStatusContract, change("ready", "collecting")))).toBe(
      "failed-precondition",
    );
    // Approved in the participation, but the approval is not signed in the detail.
    await adminDb.doc(COLLECTIONS.participations.docPath(PARTICIPATION)).update({ readinessStatus: "approved" });
    expect(await codeOf(call(lead, setParticipationStatusContract, change("ready", "collecting")))).toBe(
      "failed-precondition",
    );
    await adminDb
      .doc(COLLECTIONS.participationDetail.docPath(PARTICIPATION))
      .update({ readinessApprovedBy: "uid-lead", readinessApprovedAt: Timestamp.now() });
    // The laboratory still does not start collection itself.
    expect(await codeOf(call(coordinator, setParticipationStatusContract, change("ready", "collecting")))).toBe(
      "permission-denied",
    );
    await call(lead, setParticipationStatusContract, change("ready", "collecting"));
    expect(
      await codeOf(call(coordinator, setParticipationStatusContract, change("collecting", "collectionComplete"))),
    ).toBe("permission-denied");
    await call(lead, setParticipationStatusContract, change("collecting", "collectionComplete"));
    expect(await storedStatus()).toBe("collectionComplete");
    // Collection that is complete is not withdrawn.
    expect(
      await codeOf(call(coordinator, setParticipationStatusContract, change("collectionComplete", "withdrawn"))),
    ).toBe("failed-precondition");
  });

  it("lets the laboratory answer an invitation and withdraw, and refuses it the replication's answer to its interest", async () => {
    const { lead, coordinator } = await world();
    // The laboratory offers to take part, through the function, with its checklist and history.
    expect(await codeOf(call(lead, createParticipationContract, { ...INPUT, status: "interested" }))).toBe(
      "permission-denied",
    );
    const created = await call(coordinator, createParticipationContract, { ...INPUT, status: "interested" });
    expect(created).toMatchObject({ status: "interested", checklistItems: 9 });
    expect(
      (await adminDb.collection(COLLECTIONS.participationChecklist.collectionPath(PARTICIPATION)).get()).size,
    ).toBe(9);
    expect(await codeOf(call(coordinator, setParticipationStatusContract, change("interested", "confirmed")))).toBe(
      "permission-denied",
    );
    await call(lead, setParticipationStatusContract, change("interested", "confirmed"));
    await call(coordinator, setParticipationStatusContract, change("confirmed", "withdrawn"));
    expect(await codeOf(call(coordinator, setParticipationStatusContract, change("withdrawn", "invited")))).toBe(
      "permission-denied",
    );
    await call(lead, setParticipationStatusContract, change("withdrawn", "invited"));
    expect(await storedStatus()).toBe("invited");
  });
});
