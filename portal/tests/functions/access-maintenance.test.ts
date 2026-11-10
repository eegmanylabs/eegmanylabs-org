// Integration tests of the maintenance of `access/{uid}`, run against the emulators: the
// triggers that follow a change made outside a callable function, and the resolution itself.
// Fixtures are synthetic: fictitious accounts and units, with addresses on the example.org domain.
import { COLLECTIONS, can, capabilityGrantId, roleAssignmentId } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { expireAccess } from "../../functions/src/access/expiry";
import { rebuildAccess, rebuildAllAccess } from "../../functions/src/access/maintain";
import { adminDb } from "../support/admin";
import {
  accessOf,
  account,
  eventually,
  grantCapability,
  grantRole,
  laboratory,
  leaveNoTrace,
  person,
  resetWorld,
  standard,
} from "./support";

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeEach(resetWorld);

afterAll(leaveNoTrace);

describe("the access document after a change that no callable function made", () => {
  it("loses the scope of a role once the role is revoked", async () => {
    await laboratory("lab-a");
    await account("uid-coordinator", { personId: null });
    const id = await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");
    const before = await accessOf("uid-coordinator");
    expect(before.scopeKeys).toContain("lab:lab-a");
    expect(before.coordinatorLaboratoryIds).toEqual(["lab-a"]);
    expect(can(before, "labs.manage", { laboratoryId: "lab-a" })).toBe(true);

    // An administrator's tool, or the console, revokes the assignment. Nothing else is written.
    await adminDb
      .doc(COLLECTIONS.roleAssignments.docPath(id))
      .update({ status: "revoked", revokedBy: "system:test", revokedAt: Timestamp.now() });

    const after = await eventually(async () => {
      const access = await accessOf("uid-coordinator");
      return access.scopeKeys.includes("lab:lab-a") ? null : access;
    }, "the access document without the scope of the revoked role");
    expect(after.coordinatorLaboratoryIds).toEqual([]);
    expect(after.manageScopeKeys).toEqual([]);
    expect(after.contactLaboratoryIds).toEqual([]);
    expect(can(after, "labs.manage", { laboratoryId: "lab-a" })).toBe(false);
    expect(after.member).toBe(false);
    expect(after.updatedBy).toBe("system:accessMaintenance");
  });

  it("loses a role whose assignment document is deleted", async () => {
    await laboratory("lab-a");
    await account("uid-member");
    const id = await grantRole("uid-member", "lab_member", "laboratory", "lab-a");
    expect((await accessOf("uid-member")).memberLaboratoryIds).toEqual(["lab-a"]);

    await adminDb.doc(COLLECTIONS.roleAssignments.docPath(id)).delete();

    await eventually(
      async () => (await accessOf("uid-member")).memberLaboratoryIds.length === 0,
      "the access document without the deleted role",
    );
  });

  it("confers nothing at all once the account is suspended, whatever it has been granted", async () => {
    await laboratory("lab-a");
    await person("person-1", [], { userId: "uid-suspended", replicationIds: ["StudyA2001"] });
    await account("uid-suspended", { personId: "person-1", mfaEnrolled: true });
    await grantRole("uid-suspended", "programme_admin");
    await grantRole("uid-suspended", "lab_coordinator", "laboratory", "lab-a");
    await grantCapability("uid-suspended", "demographics.read");
    const before = await accessOf("uid-suspended");
    expect(before.member).toBe(true);
    expect(can(before, "roles.manage", "programme")).toBe(true);
    expect(before.teamReplicationIds).toEqual(["StudyA2001"]);

    await adminDb.doc(COLLECTIONS.users.docPath("uid-suspended")).update({ status: "suspended" });

    const after = await eventually(async () => {
      const access = await accessOf("uid-suspended");
      return access.suspended ? access : null;
    }, "the access document of the suspended account");
    expect(after).toMatchObject({
      suspended: true,
      member: false,
      programmeRoles: [],
      leadReplicationIds: [],
      teamReplicationIds: [],
      coordinatorLaboratoryIds: [],
      memberLaboratoryIds: [],
      contactReplicationIds: [],
      contactLaboratoryIds: [],
      groupKeys: [],
      scopeKeys: [],
      manageScopeKeys: [],
      sharedRecordKeys: [],
      editableRecordKeys: [],
      pendingRoles: [],
      capabilities: {},
      secondFactorRequired: false,
    });
    for (const capability of [
      "roles.manage",
      "labs.manage",
      "demographics.read",
      "directory.read",
      "portal.use",
    ] as const) {
      expect(can(after, capability, capability === "labs.manage" ? { laboratoryId: "lab-a" } : "programme")).toBe(
        false,
      );
    }

    // The suspension is lifted, and everything that was granted is back.
    await adminDb.doc(COLLECTIONS.users.docPath("uid-suspended")).update({ status: "active" });
    const restored = await eventually(async () => {
      const access = await accessOf("uid-suspended");
      return access.suspended ? null : access;
    }, "the access document of the reinstated account");
    expect(can(restored, "roles.manage", "programme")).toBe(true);
    expect(restored.coordinatorLaboratoryIds).toEqual(["lab-a"]);
  });

  it("gains a named capability when a grant is written, and loses it when the grant is revoked", async () => {
    await account("uid-reader", { mfaEnrolled: true });
    await adminDb.doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId("uid-reader", "audit.read"))).set({
      ...standard(),
      uid: "uid-reader",
      capability: "audit.read",
      grantedBy: "system:test",
      grantedAt: Timestamp.now(),
      reason: "A synthetic grant.",
      expiresAt: null,
      revokedBy: null,
      revokedAt: null,
      history: [],
    });
    const granted = await eventually(async () => {
      const access = await accessOf("uid-reader");
      return can(access, "audit.read", "programme") ? access : null;
    }, "the capability of the grant");
    expect(granted.secondFactorRequired).toBe(true);

    await adminDb
      .doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId("uid-reader", "audit.read")))
      .update({ revokedBy: "system:test", revokedAt: Timestamp.now() });
    await eventually(
      async () => !can(await accessOf("uid-reader"), "audit.read", "programme"),
      "the access document without the revoked grant",
    );
  });

  it("follows the link to a person and the replications of the person's confirmed memberships", async () => {
    await person("person-1");
    await account("uid-claimant");
    expect((await accessOf("uid-claimant")).member).toBe(false);

    await adminDb.doc(COLLECTIONS.persons.docPath("person-1")).update({ userId: "uid-claimant" });
    await adminDb.doc(COLLECTIONS.users.docPath("uid-claimant")).update({ personId: "person-1" });
    const linked = await eventually(async () => {
      const access = await accessOf("uid-claimant");
      return access.member ? access : null;
    }, "membership after the link");
    expect(linked.personId).toBe("person-1");
    expect(linked.scopeKeys).toEqual(["members", "user:uid-claimant"]);

    await adminDb.doc(COLLECTIONS.persons.docPath("person-1")).update({ replicationIds: ["StudyA2001"] });
    const onTeam = await eventually(async () => {
      const access = await accessOf("uid-claimant");
      return access.teamReplicationIds.length > 0 ? access : null;
    }, "the replication of the confirmed membership");
    expect(onTeam.teamReplicationIds).toEqual(["StudyA2001"]);
    expect(onTeam.scopeKeys).toContain("rep:StudyA2001");
  });

  it("resolves every account again when an override of the capability matrix is written", async () => {
    await laboratory("lab-a");
    await account("uid-core-1", { mfaEnrolled: true });
    await account("uid-core-2", { mfaEnrolled: true });
    await account("uid-member");
    await grantRole("uid-core-1", "core_team");
    await grantRole("uid-core-2", "core_team");
    await grantRole("uid-member", "lab_member", "laboratory", "lab-a");
    expect(can(await accessOf("uid-core-1"), "users.suspend", "programme")).toBe(false);
    const untouched = (await adminDb.doc("access/uid-member").get()).updateTime;

    await adminDb
      .doc(COLLECTIONS.roleCapabilities.docPath("core_team"))
      .set({ ...standard(), role: "core_team", overrides: { usersSuspend: true } });

    for (const uid of ["uid-core-1", "uid-core-2"]) {
      await eventually(
        async () => can(await accessOf(uid), "users.suspend", "programme"),
        `the overridden capability of ${uid}`,
      );
    }
    // An account that the override does not concern is not written.
    expect((await adminDb.doc("access/uid-member").get()).updateTime?.isEqual(untouched as Timestamp)).toBe(true);
  });
});

describe("the second factor in the access document", () => {
  it("is required of a programme administrator and of the core team while no setting says otherwise", async () => {
    await account("uid-admin");
    await account("uid-core");
    await account("uid-lead");
    await grantRole("uid-admin", "programme_admin");
    await grantRole("uid-core", "core_team");
    await grantRole("uid-lead", "replication_lead", "replication", "StudyA2001");

    for (const uid of ["uid-admin", "uid-core"]) {
      const access = await accessOf(uid);
      expect(access.secondFactorRequired).toBe(true);
      // No factor is enrolled, so the powers of the programme role are withheld.
      expect(access.capabilities).toEqual({});
      expect(access.scopeKeys).not.toContain("programme");
    }
    expect((await accessOf("uid-lead")).secondFactorRequired).toBe(false);
  });

  it("is required while the setting says true, and waived for every account once the setting says false", async () => {
    await account("uid-admin");
    await account("uid-core");
    await grantRole("uid-admin", "programme_admin");
    await grantRole("uid-core", "core_team");
    const settings = adminDb.doc(COLLECTIONS.systemSettings.docPath());
    const fields = { ...standard(), featureFlags: {}, maintenanceMode: false, listLimit: 200, retention: {} };

    await settings.set({ ...fields, requireSecondFactor: true });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect((await accessOf("uid-admin")).secondFactorRequired).toBe(true);

    await settings.update({ requireSecondFactor: false });
    for (const uid of ["uid-admin", "uid-core"]) {
      const waived = await eventually(async () => {
        const access = await accessOf(uid);
        return access.secondFactorRequired ? null : access;
      }, `the waived second factor of ${uid}`);
      expect(waived.mfaEnrolled).toBe(true);
      expect(waived.scopeKeys).toContain("programme");
      expect(can(waived, "directory.read", "programme")).toBe(true);
    }
    expect(can(await accessOf("uid-admin"), "roles.manage", "programme")).toBe(true);
    // The profile keeps saying that no factor is enrolled.
    expect((await adminDb.doc("users/uid-admin").get()).get("mfaEnrolled")).toBe(false);

    await settings.update({ requireSecondFactor: true });
    const required = await eventually(async () => {
      const access = await accessOf("uid-admin");
      return access.secondFactorRequired ? access : null;
    }, "the second factor required again");
    expect(required.mfaEnrolled).toBe(false);
    expect(required.capabilities).toEqual({});
  });
});

describe("the resolution of an access document", () => {
  it("writes nothing when the stored document already says what is resolved", async () => {
    await laboratory("lab-a");
    await account("uid-steady");
    await grantRole("uid-steady", "lab_member", "laboratory", "lab-a");
    const before = await adminDb.doc("access/uid-steady").get();

    const options = { at: new Date(), logger };
    expect(await rebuildAccess(adminDb, "uid-steady", options)).toBe("unchanged");
    expect(await rebuildAccess(adminDb, "uid-steady", options)).toBe("unchanged");
    expect(await rebuildAllAccess(adminDb, options)).toEqual({ created: 0, updated: 0, unchanged: 1, absent: 0 });

    const after = await adminDb.doc("access/uid-steady").get();
    expect(after.updateTime?.isEqual(before.updateTime as Timestamp)).toBe(true);
  });

  it("makes no access document for an account that has no profile", async () => {
    await adminDb
      .doc(COLLECTIONS.roleAssignments.docPath(roleAssignmentId("uid-ghost", "core_team", "programme", "eegmanylabs")))
      .set({
        ...standard(),
        uid: "uid-ghost",
        role: "core_team",
        scopeType: "programme",
        scopeId: "eegmanylabs",
        status: "active",
        grantedBy: "system:test",
        grantedAt: Timestamp.now(),
        expiresAt: null,
        revokedBy: null,
        revokedAt: null,
        history: [],
      });
    expect(await rebuildAccess(adminDb, "uid-ghost", { at: new Date(), logger })).toBe("absent");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect((await adminDb.doc("access/uid-ghost").get()).exists).toBe(false);
  });

  it("lets an expired assignment and a damaged one confer nothing", async () => {
    await laboratory("lab-a");
    await account("uid-lapsed");
    const id = await grantRole("uid-lapsed", "lab_coordinator", "laboratory", "lab-a");
    await adminDb
      .doc(COLLECTIONS.roleAssignments.docPath(id))
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1_000) });
    await adminDb
      .doc(
        COLLECTIONS.roleAssignments.docPath(
          roleAssignmentId("uid-lapsed", "programme_admin", "programme", "eegmanylabs"),
        ),
      )
      .set({ uid: "uid-lapsed", role: "programme_admin", status: "active" });

    const warnings: unknown[] = [];
    await rebuildAccess(adminDb, "uid-lapsed", {
      at: new Date(),
      logger: { ...logger, warn: (_message: string, fields?: unknown) => warnings.push(fields) },
    });

    const access = await accessOf("uid-lapsed");
    expect(access.coordinatorLaboratoryIds).toEqual([]);
    expect(access.programmeRoles).toEqual([]);
    expect(access.capabilities).toEqual({});
    expect(JSON.stringify(warnings)).toContain("roleAssignments/uid-lapsed__programme_admin__programme__eegmanylabs");
  });
});

describe("the expiry of a role and of a named grant", () => {
  const inAnHour = () => new Date(Date.now() + 3_600_000);
  const inTwoHours = () => new Date(Date.now() + 7_200_000);

  it("marks an assignment that has run out as expired, audits it and takes its scope from the access document", async () => {
    await laboratory("lab-a");
    await account("uid-timed");
    const id = await grantRole("uid-timed", "lab_coordinator", "laboratory", "lab-a");
    await grantRole("uid-timed", "lab_member", "laboratory", "lab-a");
    const assignment = adminDb.doc(COLLECTIONS.roleAssignments.docPath(id));
    await assignment.update({ expiresAt: Timestamp.fromDate(inAnHour()) });

    // Nothing has run out yet.
    expect(await expireAccess(adminDb, new Date(), logger)).toEqual({
      expiredAssignments: 0,
      accountsWithExpiredGrants: 0,
    });
    expect((await accessOf("uid-timed")).coordinatorLaboratoryIds).toEqual(["lab-a"]);

    expect(await expireAccess(adminDb, inTwoHours(), logger)).toEqual({
      expiredAssignments: 1,
      accountsWithExpiredGrants: 0,
    });

    expect((await assignment.get()).data()).toMatchObject({ status: "expired", updatedBy: "system:accessExpiry" });
    const access = await accessOf("uid-timed");
    expect(access.coordinatorLaboratoryIds).toEqual([]);
    // The role without an expiry time stays.
    expect(access.memberLaboratoryIds).toEqual(["lab-a"]);
    const audited = await adminDb.collection("auditEvents").where("action", "==", "role.expired").get();
    expect(audited.docs.map((entry) => entry.data())).toMatchObject([
      { actorKind: "system", actorUid: null, entityType: "user", entityId: "uid-timed" },
    ]);
    // A second sweep finds nothing left to end.
    expect(await expireAccess(adminDb, inTwoHours(), logger)).toEqual({
      expiredAssignments: 0,
      accountsWithExpiredGrants: 0,
    });
    expect((await adminDb.collection("auditEvents").where("action", "==", "role.expired").get()).size).toBe(1);
  });

  it("takes the capability of a named grant that has run out from the access document, once", async () => {
    await account("uid-granted", { mfaEnrolled: true });
    await grantCapability("uid-granted", "audit.read", inAnHour());
    expect(can(await accessOf("uid-granted"), "audit.read", "programme")).toBe(true);

    expect(await expireAccess(adminDb, inTwoHours(), logger)).toEqual({
      expiredAssignments: 0,
      accountsWithExpiredGrants: 1,
    });

    const access = await accessOf("uid-granted");
    expect(can(access, "audit.read", "programme")).toBe(false);
    expect(access.secondFactorRequired).toBe(false);
    expect(await expireAccess(adminDb, inTwoHours(), logger)).toEqual({
      expiredAssignments: 0,
      accountsWithExpiredGrants: 0,
    });
  });
});
