// Integration tests of the administration of roles and accounts, run against the emulators:
// setRoleAssignment, setCapabilityGrant, setRoleCapabilityOverride and setUserStatus.
// Fixtures are synthetic: fictitious accounts and units, with addresses on the example.org domain.
import {
  can,
  capabilityGrantDocSchema,
  publicErrorReason,
  roleAssignmentDocSchema,
  roleCapabilitiesDocSchema,
  sessionStartContract,
  setCapabilityGrantContract,
  setRoleAssignmentContract,
  setRoleCapabilityOverrideContract,
  setUserStatusContract,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminAuth, adminDb } from "../support/admin";
import {
  accessOf,
  account,
  administrator,
  auditOf,
  call,
  callRaw,
  codeOf,
  coreTeamMember,
  dataOf,
  eventually,
  grantRole,
  laboratory,
  leaveNoTrace,
  notificationsOf,
  refusal,
  replication,
  resetWorld,
  standard,
} from "./support";

beforeEach(resetWorld);

afterAll(leaveNoTrace);

const assignmentOf = async (id: string) => roleAssignmentDocSchema.parse(await dataOf(`roleAssignments/${id}`));
const LAB_ROLE = { uid: "uid-target", role: "lab_coordinator", scopeType: "laboratory", scopeId: "lab-a" } as const;
const LAB_ROLE_ID = "uid-target__lab_coordinator__laboratory__lab-a";

describe("setRoleAssignment", () => {
  it("refuses a caller who is signed out, has no capability or lacks the second factor", async () => {
    await laboratory("lab-a");
    await account("uid-target");
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");
    const core = await coreTeamMember("uid-core");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });
    const grant = { action: "grant", ...LAB_ROLE } as const;

    expect(await codeOf(call(null, setRoleAssignmentContract, grant))).toBe("unauthenticated");
    // A coordinator manages a laboratory and grants no role, not even for that laboratory.
    expect(await codeOf(call(coordinator, setRoleAssignmentContract, grant))).toBe("permission-denied");
    // Granting roles is a sensitive capability, which the core team does not hold by default.
    expect(await codeOf(call(core, setRoleAssignmentContract, grant))).toBe("permission-denied");
    const refused = await refusal(call(withoutFactor, setRoleAssignmentContract, grant));
    expect(refused.code).toBe("failed-precondition");
    expect(publicErrorReason(refused.details)).toBe("secondFactorRequired");
    expect(refused.message).toContain("second factor");
    expect(await dataOf(`roleAssignments/${LAB_ROLE_ID}`)).toBeUndefined();
  });

  it("grants a role, which is in the access document of the account when the call returns", async () => {
    const admin = await administrator("uid-admin");
    await laboratory("lab-a");
    await account("uid-target");

    expect(
      await call(admin, setRoleAssignmentContract, {
        action: "grant",
        ...LAB_ROLE,
        reason: "Elected by the laboratory.",
      }),
    ).toEqual({
      assignmentId: LAB_ROLE_ID,
      status: "active",
    });

    expect(await assignmentOf(LAB_ROLE_ID)).toMatchObject({
      ...LAB_ROLE,
      status: "active",
      grantedBy: "uid-admin",
      reason: "Elected by the laboratory.",
      history: [],
    });
    const access = await accessOf("uid-target");
    expect(access.coordinatorLaboratoryIds).toEqual(["lab-a"]);
    expect(can(access, "labs.claims.review", { laboratoryId: "lab-a" })).toBe(true);
    const [entry] = await auditOf("role.granted", "uid-target");
    expect(entry).toMatchObject({ actorUid: "uid-admin", documentPath: "users/uid-target" });
    expect(entry?.changes).toContainEqual({ field: "role", after: "lab_coordinator" });
    expect(await notificationsOf("uid-target")).toMatchObject([
      { type: "roleDecision", payload: { kind: "roleGranted", role: "lab_coordinator", scopeId: "lab-a" } },
    ]);

    // Asking for what is so already changes nothing.
    expect(await call(admin, setRoleAssignmentContract, { action: "grant", ...LAB_ROLE })).toEqual({
      assignmentId: LAB_ROLE_ID,
      status: "active",
    });
    expect(await auditOf("role.granted", "uid-target")).toHaveLength(1);
  });

  it("revokes a role with a reason, and the scope leaves the access document in the same transaction", async () => {
    const admin = await administrator("uid-admin");
    await laboratory("lab-a");
    await account("uid-target");
    await grantRole("uid-target", "lab_coordinator", "laboratory", "lab-a");
    expect((await accessOf("uid-target")).scopeKeys).toContain("lab:lab-a");

    expect(await codeOf(callRaw(admin, "setRoleAssignment", { action: "revoke", assignmentId: LAB_ROLE_ID }))).toBe(
      "invalid-argument",
    );
    expect(
      await call(admin, setRoleAssignmentContract, {
        action: "revoke",
        assignmentId: LAB_ROLE_ID,
        reason: "Left the laboratory.",
      }),
    ).toEqual({ assignmentId: LAB_ROLE_ID, status: "revoked" });

    const access = await accessOf("uid-target");
    expect(access.scopeKeys).not.toContain("lab:lab-a");
    expect(access.coordinatorLaboratoryIds).toEqual([]);
    expect(can(access, "labs.manage", { laboratoryId: "lab-a" })).toBe(false);
    expect(await assignmentOf(LAB_ROLE_ID)).toMatchObject({
      status: "revoked",
      revokedBy: "uid-admin",
      reason: "Left the laboratory.",
    });
    const [entry] = await auditOf("role.revoked", "uid-target");
    expect(entry?.changes).toContainEqual({ field: "status", before: "active", after: "revoked" });
    expect(await notificationsOf("uid-target")).toMatchObject([{ payload: { kind: "roleRevoked" } }]);

    // A repeated revocation changes nothing, and a new grant keeps the earlier period.
    await call(admin, setRoleAssignmentContract, { action: "revoke", assignmentId: LAB_ROLE_ID, reason: "Again." });
    expect(await auditOf("role.revoked", "uid-target")).toHaveLength(1);
    await call(admin, setRoleAssignmentContract, { action: "grant", ...LAB_ROLE });
    const granted = await assignmentOf(LAB_ROLE_ID);
    expect(granted.status).toBe("active");
    expect(granted.history).toMatchObject([
      { status: "revoked", revokedBy: "uid-admin", reason: "Left the laboratory." },
    ]);
    expect(granted.reason).toBeUndefined();
  });

  it("approves a role that awaits approval, and nothing else", async () => {
    const admin = await administrator("uid-admin");
    await replication("StudyA2001");
    await account("uid-target");
    const id = await grantRole("uid-target", "replication_lead", "replication", "StudyA2001", "pendingApproval");
    expect((await accessOf("uid-target")).pendingRoles).toHaveLength(1);
    expect((await accessOf("uid-target")).leadReplicationIds).toEqual([]);

    expect(await call(admin, setRoleAssignmentContract, { action: "approve", assignmentId: id })).toEqual({
      assignmentId: id,
      status: "active",
    });

    expect(await assignmentOf(id)).toMatchObject({ status: "active", grantedBy: "uid-admin" });
    const access = await accessOf("uid-target");
    expect(access).toMatchObject({
      leadReplicationIds: ["StudyA2001"],
      contactReplicationIds: ["StudyA2001"],
      pendingRoles: [],
    });
    // Approving again changes nothing, and a revoked role cannot be approved.
    await call(admin, setRoleAssignmentContract, { action: "approve", assignmentId: id });
    expect(await auditOf("role.granted", "uid-target")).toHaveLength(1);
    await call(admin, setRoleAssignmentContract, { action: "revoke", assignmentId: id, reason: "A mistake." });
    expect(await codeOf(call(admin, setRoleAssignmentContract, { action: "approve", assignmentId: id }))).toBe(
      "failed-precondition",
    );
    expect(
      await codeOf(
        call(admin, setRoleAssignmentContract, {
          action: "approve",
          assignmentId: "uid-x__lab_member__laboratory__lab-x",
        }),
      ),
    ).toBe("not-found");
  });

  it("refuses a role for a scope that does not fit it or does not exist, an account without a profile and a past expiry", async () => {
    const admin = await administrator("uid-admin");
    await laboratory("lab-a");
    await account("uid-target");
    const grant = (change: object) =>
      call(admin, setRoleAssignmentContract, { action: "grant", ...LAB_ROLE, ...change });

    expect(await codeOf(grant({ scopeType: "replication" }))).toBe("invalid-argument");
    expect(await codeOf(grant({ scopeId: "lab-missing" }))).toBe("not-found");
    expect(await codeOf(grant({ role: "core_team", scopeType: "programme", scopeId: "another-programme" }))).toBe(
      "not-found",
    );
    expect(await codeOf(grant({ uid: "uid-never-seen" }))).toBe("not-found");
    expect(await codeOf(grant({ expiresAt: new Date(Date.now() - 60_000).toISOString() }))).toBe("invalid-argument");
    expect(await codeOf(grant({ role: "owner" }))).toBe("invalid-argument");
    expect((await adminDb.collection("roleAssignments").where("uid", "==", "uid-target").get()).size).toBe(0);

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    await grant({ expiresAt });
    expect((await assignmentOf(LAB_ROLE_ID)).expiresAt?.toDate().toISOString()).toBe(expiresAt);
  });

  it("never lets a caller change their own programme administrator role", async () => {
    const admin = await administrator("uid-admin");
    await administrator("uid-other-admin");
    const own = "uid-admin__programme_admin__programme__eegmanylabs";

    const revoke = await refusal(
      call(admin, setRoleAssignmentContract, { action: "revoke", assignmentId: own, reason: "Stepping down." }),
    );
    expect(revoke.code).toBe("permission-denied");
    expect(revoke.message).toContain("Ask another programme administrator");
    expect(
      await codeOf(
        call(admin, setRoleAssignmentContract, {
          action: "grant",
          uid: "uid-admin",
          role: "programme_admin",
          scopeType: "programme",
          scopeId: "eegmanylabs",
          expiresAt: null,
        }),
      ),
    ).toBe("permission-denied");
    expect(await codeOf(call(admin, setRoleAssignmentContract, { action: "approve", assignmentId: own }))).toBe(
      "permission-denied",
    );
    expect((await assignmentOf(own)).status).toBe("active");
  });

  it("never revokes the last active programme administrator", async () => {
    const admin = await administrator("uid-admin");
    // A member of the core team for whom an override switches the capability on.
    const core = await coreTeamMember("uid-core");
    await adminDb
      .doc("roleCapabilities/core_team")
      .set({ ...standard(), role: "core_team", overrides: { rolesManage: true } });
    await eventually(async () => can(await accessOf("uid-core"), "roles.manage", "programme"), "the override");
    const last = "uid-admin__programme_admin__programme__eegmanylabs";

    const refused = await refusal(
      call(core, setRoleAssignmentContract, { action: "revoke", assignmentId: last, reason: "A coup." }),
    );
    expect(refused.code).toBe("failed-precondition");
    expect(refused.message).toContain("last active programme administrator");
    expect((await assignmentOf(last)).status).toBe("active");

    // A suspended administrator does not count as another one.
    await account("uid-suspended-admin", { mfaEnrolled: true, status: "suspended" });
    await grantRole("uid-suspended-admin", "programme_admin");
    expect(
      await codeOf(call(core, setRoleAssignmentContract, { action: "revoke", assignmentId: last, reason: "A coup." })),
    ).toBe("failed-precondition");

    // With a second active administrator the first can be revoked, by somebody else.
    await administrator("uid-second-admin");
    expect(
      await call(core, setRoleAssignmentContract, { action: "revoke", assignmentId: last, reason: "Handed over." }),
    ).toEqual({
      assignmentId: last,
      status: "revoked",
    });
    expect(can(await accessOf(admin.uid), "roles.manage", "programme")).toBe(false);
  });
});

describe("setCapabilityGrant", () => {
  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
  const grant = {
    action: "grant",
    uid: "uid-target",
    capability: "audit.read",
    reason: "Reviews the audit trail this term.",
  } as const;
  const grantOf = async () => capabilityGrantDocSchema.parse(await dataOf("capabilityGrants/uid-target__audit.read"));

  it("refuses a caller who is signed out, has no capability or lacks the second factor", async () => {
    await account("uid-target", { mfaEnrolled: true });
    const core = await coreTeamMember("uid-core");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, setCapabilityGrantContract, grant))).toBe("unauthenticated");
    expect(await codeOf(call(core, setCapabilityGrantContract, grant))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, setCapabilityGrantContract, grant))).toBe("failed-precondition");
    // An account cannot grant itself anything either.
    expect(
      await codeOf(call({ uid: "uid-target", email: "uid-target@example.org" }, setCapabilityGrantContract, grant)),
    ).toBe("permission-denied");
    expect(await dataOf("capabilityGrants/uid-target__audit.read")).toBeUndefined();
  });

  it("grants a named capability with a reason and an expiry, and revokes it with the earlier period kept", async () => {
    const admin = await administrator("uid-admin");
    await account("uid-target", { mfaEnrolled: true });
    const expiresAt = inAnHour();

    expect(await call(admin, setCapabilityGrantContract, { ...grant, expiresAt })).toEqual({
      grantId: "uid-target__audit.read",
      active: true,
    });

    expect(await grantOf()).toMatchObject({
      uid: "uid-target",
      capability: "audit.read",
      grantedBy: "uid-admin",
      reason: grant.reason,
      revokedAt: null,
    });
    expect((await grantOf()).expiresAt?.toDate().toISOString()).toBe(expiresAt);
    const access = await accessOf("uid-target");
    expect(can(access, "audit.read", "programme")).toBe(true);
    expect(access.secondFactorRequired).toBe(true);
    const [entry] = await auditOf("capability.granted", "uid-target");
    expect(entry?.changes).toContainEqual({ field: "capability", after: "audit.read" });
    expect(await notificationsOf("uid-target")).toMatchObject([
      { payload: { kind: "capabilityGranted", capability: "audit.read" } },
    ]);
    // The same grant again changes nothing.
    await call(admin, setCapabilityGrantContract, { ...grant, expiresAt });
    expect(await auditOf("capability.granted", "uid-target")).toHaveLength(1);

    expect(
      await call(admin, setCapabilityGrantContract, { ...grant, action: "revoke", reason: "The review has ended." }),
    ).toEqual({
      grantId: "uid-target__audit.read",
      active: false,
    });
    expect(can(await accessOf("uid-target"), "audit.read", "programme")).toBe(false);
    const revoked = await grantOf();
    expect(revoked).toMatchObject({ revokedBy: "uid-admin", reason: "The review has ended." });
    expect(revoked.history).toMatchObject([{ reason: grant.reason, revokedAt: null }]);
    expect(await auditOf("capability.revoked", "uid-target")).toHaveLength(1);
    await call(admin, setCapabilityGrantContract, { ...grant, action: "revoke", reason: "Again." });
    expect(await auditOf("capability.revoked", "uid-target")).toHaveLength(1);
  });

  it("refuses a grant of special-category access without an expiry, a past expiry and an unknown target", async () => {
    const admin = await administrator("uid-admin");
    await account("uid-target", { mfaEnrolled: true });
    const demographics = { ...grant, capability: "demographics.read" } as const;

    const refused = await refusal(call(admin, setCapabilityGrantContract, demographics));
    expect(refused.code).toBe("invalid-argument");
    expect(refused.message).toContain("needs an expiry time");
    expect(
      await codeOf(
        call(admin, setCapabilityGrantContract, {
          ...demographics,
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
      ),
    ).toBe("invalid-argument");
    expect(await codeOf(call(admin, setCapabilityGrantContract, { ...grant, uid: "uid-never-seen" }))).toBe(
      "not-found",
    );
    expect(
      await codeOf(call(admin, setCapabilityGrantContract, { ...grant, action: "revoke", uid: "uid-target" })),
    ).toBe("not-found");
    expect(await codeOf(callRaw(admin, "setCapabilityGrant", { ...grant, capability: "portal.use" }))).toBe(
      "invalid-argument",
    );
    expect(await codeOf(callRaw(admin, "setCapabilityGrant", { ...grant, reason: "" }))).toBe("invalid-argument");

    await call(admin, setCapabilityGrantContract, { ...demographics, expiresAt: inAnHour() });
    expect(can(await accessOf("uid-target"), "demographics.read", "programme")).toBe(true);
  });
});

describe("setRoleCapabilityOverride", () => {
  const override = { role: "core_team", capability: "users.suspend", allowed: true } as const;

  it("refuses everybody but a programme administrator whose second factor is satisfied", async () => {
    const core = await coreTeamMember("uid-core");
    await adminDb
      .doc("roleCapabilities/core_team")
      .set({ ...standard(), role: "core_team", overrides: { rolesManage: true } });
    await eventually(async () => can(await accessOf("uid-core"), "roles.manage", "programme"), "the override");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, setRoleCapabilityOverrideContract, override))).toBe("unauthenticated");
    // The core team may hold roles.manage, and the matrix itself still belongs to administrators.
    expect(await codeOf(call(core, setRoleCapabilityOverrideContract, override))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, setRoleCapabilityOverrideContract, override))).toBe("failed-precondition");
    expect(roleCapabilitiesDocSchema.parse(await dataOf("roleCapabilities/core_team")).overrides).toEqual({
      rolesManage: true,
    });
  });

  it("sets and clears an override, and the access documents of the role follow", async () => {
    const admin = await administrator("uid-admin");
    await coreTeamMember("uid-core");
    expect(can(await accessOf("uid-core"), "users.suspend", "programme")).toBe(false);

    expect(await call(admin, setRoleCapabilityOverrideContract, override)).toEqual({
      role: "core_team",
      overrides: { "users.suspend": true },
    });

    expect(roleCapabilitiesDocSchema.parse(await dataOf("roleCapabilities/core_team"))).toMatchObject({
      role: "core_team",
      overrides: { usersSuspend: true },
      updatedBy: "uid-admin",
    });
    const [entry] = await auditOf("roleCapabilities.changed");
    expect(entry).toMatchObject({ actorUid: "uid-admin", entityType: "programme" });
    expect(entry?.changes).toEqual([
      { field: "role", after: "core_team" },
      { field: "capability", after: "users.suspend" },
      { field: "allowed", before: null, after: true },
    ]);
    await eventually(
      async () => can(await accessOf("uid-core"), "users.suspend", "programme"),
      "the capability of the core team",
    );

    // The same override again changes nothing.
    await call(admin, setRoleCapabilityOverrideContract, override);
    expect(await auditOf("roleCapabilities.changed")).toHaveLength(1);

    expect(await call(admin, setRoleCapabilityOverrideContract, { ...override, allowed: null })).toEqual({
      role: "core_team",
      overrides: {},
    });
    await eventually(
      async () => !can(await accessOf("uid-core"), "users.suspend", "programme"),
      "the default of the matrix",
    );
  });

  it("refuses an override that could never take effect, and the roles that take none", async () => {
    const admin = await administrator("uid-admin");
    const refused = await refusal(
      call(admin, setRoleCapabilityOverrideContract, { role: "lab_member", capability: "roles.manage", allowed: true }),
    );
    expect(refused.code).toBe("failed-precondition");
    for (const role of ["programme_admin", "external_collaborator"]) {
      expect(await codeOf(callRaw(admin, "setRoleCapabilityOverride", { ...override, role }))).toBe("invalid-argument");
    }
    expect(await dataOf("roleCapabilities/lab_member")).toBeUndefined();
  });
});

describe("setUserStatus", () => {
  const suspension = { uid: "uid-target", status: "suspended", reason: "Left the programme." } as const;

  async function target() {
    await adminAuth.createUser({ uid: "uid-target", email: "uid-target@example.org", emailVerified: true });
    await laboratory("lab-a");
    const caller = await account("uid-target");
    await grantRole("uid-target", "lab_coordinator", "laboratory", "lab-a");
    return caller;
  }

  it("refuses a caller who is signed out, has no capability or lacks the second factor", async () => {
    await target();
    const core = await coreTeamMember("uid-core");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, setUserStatusContract, suspension))).toBe("unauthenticated");
    expect(await codeOf(call(core, setUserStatusContract, suspension))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, setUserStatusContract, suspension))).toBe("failed-precondition");
    expect((await dataOf("users/uid-target"))?.status).toBe("active");
    expect((await adminAuth.getUser("uid-target")).disabled).toBe(false);
  });

  it("suspends an account: the profile, the access document, the Authentication account and its sessions", async () => {
    const caller = await target();
    const admin = await administrator("uid-admin");
    const signedInBefore = (await adminAuth.getUser("uid-target")).tokensValidAfterTime;

    expect(await call(admin, setUserStatusContract, suspension)).toEqual({ uid: "uid-target", status: "suspended" });

    expect(await dataOf("users/uid-target")).toMatchObject({ status: "suspended", updatedBy: "uid-admin" });
    const access = await accessOf("uid-target");
    expect(access).toMatchObject({
      suspended: true,
      member: false,
      scopeKeys: [],
      capabilities: {},
      coordinatorLaboratoryIds: [],
    });
    const record = await adminAuth.getUser("uid-target");
    expect(record.disabled).toBe(true);
    expect(record.tokensValidAfterTime).not.toBe(signedInBefore);
    const [entry] = await auditOf("account.suspended", "uid-target");
    expect(entry?.actorUid).toBe("uid-admin");
    expect(entry?.changes).toEqual([
      { field: "status", withheld: true },
      { field: "reason", after: "Left the programme." },
    ]);

    // The suspended account is refused by every function on its next call, with its old token.
    const refused = await refusal(call(caller, sessionStartContract, {}));
    expect(refused.code).toBe("permission-denied");
    expect(refused.message).toContain("suspended");

    // The same call again writes no second audit entry.
    await call(admin, setUserStatusContract, suspension);
    expect(await auditOf("account.suspended", "uid-target")).toHaveLength(1);

    expect(
      await call(admin, setUserStatusContract, { uid: "uid-target", status: "active", reason: "Returned." }),
    ).toEqual({
      uid: "uid-target",
      status: "active",
    });
    expect((await adminAuth.getUser("uid-target")).disabled).toBe(false);
    expect((await accessOf("uid-target")).coordinatorLaboratoryIds).toEqual(["lab-a"]);
    expect(await auditOf("account.reinstated", "uid-target")).toHaveLength(1);
    expect(await call(caller, sessionStartContract, {})).toMatchObject({ member: true });
  });

  it("never lets a caller suspend their own account, and never suspends the last active programme administrator", async () => {
    const admin = await administrator("uid-admin");
    const core = await coreTeamMember("uid-core");
    await adminDb
      .doc("roleCapabilities/core_team")
      .set({ ...standard(), role: "core_team", overrides: { usersSuspend: true } });
    await eventually(async () => can(await accessOf("uid-core"), "users.suspend", "programme"), "the override");

    const own = await refusal(call(admin, setUserStatusContract, { ...suspension, uid: "uid-admin" }));
    expect(own.code).toBe("permission-denied");
    expect(own.message).toContain("your own account");
    const last = await refusal(call(core, setUserStatusContract, { ...suspension, uid: "uid-admin" }));
    expect(last.code).toBe("failed-precondition");
    expect(last.message).toContain("last active programme administrator");
    expect((await dataOf("users/uid-admin"))?.status).toBe("active");
    expect(await codeOf(call(admin, setUserStatusContract, { ...suspension, uid: "uid-never-seen" }))).toBe(
      "not-found",
    );

    await administrator("uid-second-admin");
    expect(await call(core, setUserStatusContract, { ...suspension, uid: "uid-admin" })).toEqual({
      uid: "uid-admin",
      status: "suspended",
    });
    expect((await accessOf("uid-admin")).suspended).toBe(true);
  });
});
