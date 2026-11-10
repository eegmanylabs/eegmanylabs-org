// An end-to-end test of the demonstration world with the functions: `seed:demo` writes the
// world, the triggers leave it as it is, and the claim flow runs over it from the bootstrap of
// the administrator to the approval of a role.
// Fixtures are synthetic: the demonstration world is fictitious and every address in it uses the example.org domain.
import {
  can,
  claimProfileContract,
  getPersonDemographicsContract,
  listAccountClaimsContract,
  requestAccessContract,
  reviewAccountClaimContract,
  sessionStartContract,
  setRoleAssignmentContract,
} from "@eegml/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../tools/src/commands/seed-demo";
import { DEMO_ACCOUNTS } from "../../tools/src/fixtures/demo-accounts";
import { DEMO_BOOTSTRAP_ADMIN_EMAIL } from "../../tools/src/fixtures/demo-world";
import { adminAuth, adminDb } from "../support/admin";
import { PROJECT_ID } from "../support/emulators";
import { accessOf, type Caller, call, codeOf, dataOf, leaveNoTrace, notificationsOf, settle } from "./support";

const admin: Caller = { uid: "uid-demo-admin", email: DEMO_BOOTSTRAP_ADMIN_EMAIL };
const ben: Caller = { uid: "uid-demo-ben", email: "ben.sample@example.org" };
const twin: Caller = { uid: "uid-demo-twin", email: "shared.mock@example.org" };
const stranger: Caller = { uid: "uid-demo-stranger", email: "nobody.in.particular@example.org" };

beforeAll(async () => {
  await leaveNoTrace();
  await seedDemo({ db: adminDb, auth: adminAuth }, PROJECT_ID);
});

afterAll(leaveNoTrace);

describe("the demonstration world with the functions running", () => {
  it("is left as the seed wrote it: the triggers find every derived value in place", async () => {
    const watched = ["persons", "access", "replications"];
    const updateTimes = async () =>
      Promise.all(
        watched.map(async (name) =>
          (await adminDb.collection(name).get()).docs.map((document) => document.updateTime.toMillis()),
        ),
      );
    const before = await updateTimes();

    await settle();

    expect(await updateTimes()).toEqual(before);
    // The seed is recorded by the audit trigger as the work of trusted code, and never as a person's.
    const seeded = await adminDb.collection("auditEvents").where("documentPath", "==", "persons/demo-person-ben").get();
    expect(seeded.docs.map((entry) => [entry.get("action"), entry.get("actorKind"), entry.get("createdBy")])).toEqual([
      ["document.created", "system", "system:system"],
    ]);
  });

  it("runs the claim flow from the bootstrap of the administrator to the approval of a role", async () => {
    // The demonstration administrator signs in. The world waives the second factor, which the
    // emulator cannot provide, so the powers of the role are in effect at once.
    expect(await call(admin, sessionStartContract, {})).toEqual({ member: true, personId: null });
    const administratorAccess = await accessOf(admin.uid);
    expect(administratorAccess).toMatchObject({
      programmeRoles: ["programme_admin"],
      secondFactorRequired: false,
      mfaEnrolled: true,
    });
    expect(can(administratorAccess, "roles.manage", "programme")).toBe(true);
    // The administrator is a person of the world as well, and claims that profile.
    expect(await call(admin, claimProfileContract, {})).toEqual({ status: "linked", personId: "demo-person-ada" });

    // A lead and principal investigator claims a profile: a member at once, a manager once approved.
    await call(ben, sessionStartContract, {});
    expect(await call(ben, claimProfileContract, {})).toEqual({ status: "linked", personId: "demo-person-ben" });
    const claimed = await accessOf(ben.uid);
    expect(claimed).toMatchObject({
      member: true,
      memberLaboratoryIds: ["demo-lab-attention"],
      leadReplicationIds: [],
      coordinatorLaboratoryIds: [],
      teamReplicationIds: ["DemoAlpha2001"],
    });
    expect(claimed.pendingRoles.map((role) => `${role.role} ${role.scopeId}`)).toEqual([
      "lab_coordinator demo-lab-attention",
      "replication_lead DemoAlpha2001",
    ]);
    expect(await notificationsOf(admin.uid)).toMatchObject([
      { type: "roleDecision", payload: { kind: "rolesAwaitApproval", count: 2 } },
    ]);

    await call(admin, setRoleAssignmentContract, {
      action: "approve",
      assignmentId: `${ben.uid}__replication_lead__replication__DemoAlpha2001`,
    });
    const approved = await accessOf(ben.uid);
    expect(approved.leadReplicationIds).toEqual(["DemoAlpha2001"]);
    expect(can(approved, "replications.manage", { replicationId: "DemoAlpha2001" })).toBe(true);
    expect(can(approved, "replications.manage", { replicationId: "DemoBeta2005" })).toBe(false);

    // Two persons hold one address: the claim goes to the queue, and the administrator decides it.
    await call(twin, sessionStartContract, {});
    expect(await call(twin, claimProfileContract, {})).toEqual({ status: "pendingReview", statementGiven: false });
    const { claims } = await call(admin, listAccountClaimsContract, {});
    expect(claims).toMatchObject([
      { uid: twin.uid, candidates: [{ personId: "demo-person-hana" }, { personId: "demo-person-hugo" }] },
    ]);
    await call(admin, reviewAccountClaimContract, { uid: twin.uid, decision: "approve", personId: "demo-person-hugo" });
    expect(await call(twin, claimProfileContract, {})).toEqual({ status: "linked", personId: "demo-person-hugo" });
    expect((await dataOf("persons/demo-person-hana"))?.userId).toBeNull();

    // An address that nobody holds matches nothing, and its account asks for access.
    await call(stranger, sessionStartContract, {});
    expect(await call(stranger, claimProfileContract, {})).toEqual({ status: "noMatch" });
    expect(
      await call(stranger, requestAccessContract, {
        statedName: "Synthetic Stranger",
        affiliation: "Nowhere",
        message: "Hello.",
      }),
    ).toEqual({
      status: "pendingReview",
    });
  });

  it("serves the placeholder demographics of the world to the person concerned alone", async () => {
    const [claimedAccount] = DEMO_ACCOUNTS;
    const ivy: Caller = { uid: claimedAccount?.uid ?? "", email: claimedAccount?.email ?? "" };

    expect(
      (await call(ivy, getPersonDemographicsContract, { personId: "demo-person-ivy" })).demographics,
    ).toMatchObject({
      genderSource: "synthetic gender term B",
      ethnicitySource: "synthetic ethnicity term B",
    });
    expect(await codeOf(call(ivy, getPersonDemographicsContract, { personId: "demo-person-ben" }))).toBe(
      "permission-denied",
    );
  });
});
