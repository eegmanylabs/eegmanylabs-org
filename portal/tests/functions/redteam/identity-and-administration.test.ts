// Red-team review of identity, claiming and administration, run against the emulators through
// the callable protocol. Each test states the secure behaviour: a test that fails is a finding.
// Fixtures are synthetic: fictitious accounts, people and laboratories, with addresses on the
// example.org domain.
import {
  bootstrapAdminId,
  bootstrapAdminPath,
  COLLECTIONS,
  can,
  claimProfileContract,
  DEMO_IDENTITY_HASH_KEY,
  getPersonDemographicsContract,
  listAccountClaimsContract,
  listAuditEventsContract,
  listUsersContract,
  requestAccessContract,
  requestLabClaimContract,
  reviewAccountClaimContract,
  reviewLabClaimContract,
  roleAssignmentDocSchema,
  sessionStartContract,
  setCapabilityGrantContract,
  setRoleAssignmentContract,
  setRoleCapabilityOverrideContract,
  setUserStatusContract,
  unlinkAccountClaimContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdministrator } from "../../../tools/src/commands/admin-bootstrap";
import { adminDb } from "../../support/admin";
import {
  accessOf,
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  callRaw,
  codeOf,
  coreTeamMember,
  dataOf,
  grantCapability,
  grantRole,
  laboratory,
  leaveNoTrace,
  memberEntry,
  person,
  rebuild,
  refusal,
  resetWorld,
  standard,
} from "../support";

beforeEach(resetWorld);

afterAll(leaveNoTrace);

const NO_ERROR = "(no error)";
const DEMOGRAPHICS = { genderSource: "synthetic gender term Q", ethnicitySource: "synthetic ethnicity term Z" };

async function recordDemographics(personId: string): Promise<void> {
  await adminDb
    .doc(COLLECTIONS.personDemographics.docPath(personId))
    .set({ ...standard(), ...DEMOGRAPHICS, recordedAt: Timestamp.fromMillis(1_700_000_000_000) });
}

/** Gives the core team one capability through an override, as an administrator would. */
async function overrideCoreTeam(field: string, ...uids: string[]): Promise<void> {
  await adminDb
    .doc(COLLECTIONS.roleCapabilities.docPath("core_team"))
    .set({ ...standard(), role: "core_team", overrides: { [field]: true } });
  for (const uid of uids) await rebuild(uid);
}

/** A member whose account is linked to a person. */
async function linkedMember(uid: string, personId: string): Promise<Caller> {
  const email = `${uid}@example.org`;
  await person(personId, [{ email }], { userId: uid });
  return account(uid, { email, personId });
}

const assignmentOf = async (id: string) => roleAssignmentDocSchema.parse(await dataOf(`roleAssignments/${id}`));

describe("claiming a profile", () => {
  it("never reads an address from the input", async () => {
    await person("person-victim", [{ email: "victim@example.org" }]);
    const attacker = await account("uid-attacker", { email: "attacker@example.org" });
    expect(await codeOf(callRaw(attacker, claimProfileContract.name, { email: "victim@example.org" }))).toBe(
      "invalid-argument",
    );
    expect(await codeOf(callRaw(attacker, claimProfileContract.name, "victim@example.org"))).toBe("invalid-argument");
    expect((await dataOf("persons/person-victim"))?.userId).toBeNull();
  });

  it("gives an unverified address the same refusal whether or not a person holds it", async () => {
    await person("person-victim", [{ email: "victim@example.org" }]);
    const known = await account("uid-known", { email: "victim@example.org", emailVerified: false });
    const unknown = await account("uid-unknown", { email: "nobody@example.org", emailVerified: false });
    const first = await refusal(call(known, claimProfileContract, {}));
    const second = await refusal(call(unknown, claimProfileContract, {}));
    expect([first.code, first.message, first.details]).toEqual([second.code, second.message, second.details]);
    expect((await dataOf("persons/person-victim"))?.userId).toBeNull();
    expect(await dataOf("accountClaims/uid-known")).toBeUndefined();
  });

  it("never activates a pending management role, however often and however fast the claim is repeated", async () => {
    await laboratory("lab-a");
    const caller = await account("uid-pi", { email: "pi@example.org" });
    await person("person-pi", [{ email: "pi@example.org" }]);
    await memberEntry("lab-a", "person-pi", { role: "pi", status: "confirmed" });

    await Promise.all(Array.from({ length: 6 }, () => call(caller, claimProfileContract, {})));
    await call(caller, claimProfileContract, {});

    const coordinator = await assignmentOf("uid-pi__lab_coordinator__laboratory__lab-a");
    expect(coordinator.status).toBe("pendingApproval");
    expect((await accessOf("uid-pi")).coordinatorLaboratoryIds).toEqual([]);
  });

  it("does not let a reviewer approve the claim of their own account", async () => {
    await person("person-victim", [{ email: "victim@example.org" }]);
    const reviewer = await coreTeamMember("uid-reviewer");
    await call(reviewer, requestAccessContract, {
      statedName: "Synthetic reviewer",
      affiliation: "Synthetic institute",
      message: "Please link me.",
    });

    const code = await codeOf(
      call(reviewer, reviewAccountClaimContract, {
        uid: "uid-reviewer",
        decision: "approve",
        personId: "person-victim",
      }),
    );
    expect(code).toBe("permission-denied");
    expect((await dataOf("persons/person-victim"))?.userId).toBeNull();
  });

  it("does not let a reviewer without demographics.read reach special-category data by linking a second account", async () => {
    // The core team holds claims.review by default and demographics.read only through an override.
    await person("person-victim", [{ email: "victim@example.org" }]);
    await recordDemographics("person-victim");
    const reviewer = await coreTeamMember("uid-reviewer");
    expect(can(await accessOf("uid-reviewer"), "demographics.read", "programme")).toBe(false);
    expect(await codeOf(call(reviewer, getPersonDemographicsContract, { personId: "person-victim" }))).toBe(
      "permission-denied",
    );

    // A second account of the same human, under an address the reviewer controls.
    const sock = await account("uid-sock", { email: "sock@example.org" });
    await call(sock, requestAccessContract, { statedName: "A", affiliation: "B", message: "C" });
    const approval = await codeOf(
      call(reviewer, reviewAccountClaimContract, { uid: "uid-sock", decision: "approve", personId: "person-victim" }),
    );
    const read = await codeOf(call(sock, getPersonDemographicsContract, { personId: "person-victim" }));

    expect([approval, read]).not.toEqual([NO_ERROR, NO_ERROR]);
  });
});

describe("claiming a laboratory", () => {
  async function requester(): Promise<Caller> {
    await laboratory("lab-a");
    await laboratory("lab-b");
    return linkedMember("uid-requester", "person-requester");
  }

  it("does not let the coordinator of laboratory A decide a request for laboratory B", async () => {
    const member = await requester();
    await call(member, requestLabClaimContract, { laboratoryId: "lab-b", requestedRole: "coordinator" });
    const coordinatorA = await account("uid-coord-a");
    await grantRole("uid-coord-a", "lab_coordinator", "laboratory", "lab-a");

    expect(
      await codeOf(
        call(coordinatorA, reviewLabClaimContract, { claimId: "uid-requester__lab-b", decision: "approve" }),
      ),
    ).toBe("permission-denied");
    expect((await accessOf("uid-requester")).coordinatorLaboratoryIds).toEqual([]);
  });

  it("does not let a member, a pending coordinator or the requester decide the request", async () => {
    const member = await requester();
    await call(member, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole: "coordinator" });
    const plain = await account("uid-plain");
    await grantRole("uid-plain", "lab_member", "laboratory", "lab-a");
    const pending = await account("uid-pending");
    await grantRole("uid-pending", "lab_coordinator", "laboratory", "lab-a", "pendingApproval");
    const approve = { claimId: "uid-requester__lab-a", decision: "approve" } as const;

    expect(await codeOf(call(plain, reviewLabClaimContract, approve))).toBe("permission-denied");
    expect(await codeOf(call(pending, reviewLabClaimContract, approve))).toBe("permission-denied");
    expect(await codeOf(call(member, reviewLabClaimContract, approve))).toBe("permission-denied");
    expect((await accessOf("uid-requester")).coordinatorLaboratoryIds).toEqual([]);
  });
});

describe("escalation through the role functions", () => {
  it("refuses the core team without roles.manage everything that grants", async () => {
    const core = await coreTeamMember("uid-core");
    await account("uid-other");
    expect(
      await codeOf(
        call(core, setRoleAssignmentContract, {
          action: "grant",
          uid: "uid-other",
          role: "programme_admin",
          scopeType: "programme",
          scopeId: "eegmanylabs",
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(core, setCapabilityGrantContract, {
          action: "grant",
          uid: "uid-core",
          capability: "roles.manage",
          reason: "Self-promotion attempt.",
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(core, setRoleCapabilityOverrideContract, { role: "core_team", capability: "roles.manage", allowed: true }),
      ),
    ).toBe("permission-denied");
    expect(Object.keys((await accessOf("uid-core")).capabilities)).not.toContain("rolesManage");
  });

  it("does not let a holder of roles.manage who is no administrator make a programme administrator", async () => {
    const core = await coreTeamMember("uid-core");
    await overrideCoreTeam("rolesManage", "uid-core");
    expect(can(await accessOf("uid-core"), "roles.manage", "programme")).toBe(true);
    await account("uid-sock");

    const code = await codeOf(
      call(core, setRoleAssignmentContract, {
        action: "grant",
        uid: "uid-sock",
        role: "programme_admin",
        scopeType: "programme",
        scopeId: "eegmanylabs",
      }),
    );
    expect(code).toBe("permission-denied");
  });

  it("does not let a holder of roles.manage grant itself demographics.read", async () => {
    const admin = await administrator("uid-admin");
    const code = await codeOf(
      call(admin, setCapabilityGrantContract, {
        action: "grant",
        uid: "uid-admin",
        capability: "demographics.read",
        reason: "Self-granted access to special-category data.",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    expect(code).toBe("permission-denied");
  });

  it("never leaves the programme without an administrator through expiry times", async () => {
    const first = await administrator("uid-admin-1");
    const second = await administrator("uid-admin-2");
    const soon = new Date(Date.now() + 60_000).toISOString();
    const expire = (uid: string) =>
      ({
        action: "grant",
        uid,
        role: "programme_admin",
        scopeType: "programme",
        scopeId: "eegmanylabs",
        expiresAt: soon,
      }) as const;

    const one = await codeOf(call(first, setRoleAssignmentContract, expire("uid-admin-2")));
    const two = await codeOf(call(second, setRoleAssignmentContract, expire("uid-admin-1")));

    // Both assignments now end within a minute and nobody is left: one of the calls must fail.
    expect([one, two]).not.toEqual([NO_ERROR, NO_ERROR]);
  });

  it("keeps one administrator when two revoke each other at the same moment", async () => {
    const first = await administrator("uid-admin-1");
    const second = await administrator("uid-admin-2");
    const revoke = (uid: string) =>
      ({ action: "revoke", assignmentId: `${uid}__programme_admin__programme__eegmanylabs`, reason: "Race." }) as const;
    await Promise.allSettled([
      call(first, setRoleAssignmentContract, revoke("uid-admin-2")),
      call(second, setRoleAssignmentContract, revoke("uid-admin-1")),
    ]);
    const statuses = await Promise.all(
      ["uid-admin-1", "uid-admin-2"].map(
        async (uid) => (await assignmentOf(`${uid}__programme_admin__programme__eegmanylabs`)).status,
      ),
    );
    expect(statuses).toContain("active");
  });

  it("does not let a holder of users.suspend who is no administrator suspend an administrator, or anyone suspend themselves", async () => {
    await administrator("uid-admin-1");
    await administrator("uid-admin-2");
    const core = await coreTeamMember("uid-core");
    await overrideCoreTeam("usersSuspend", "uid-core");
    expect(can(await accessOf("uid-core"), "users.suspend", "programme")).toBe(true);

    expect(
      await codeOf(call(core, setUserStatusContract, { uid: "uid-core", status: "suspended", reason: "Self." })),
    ).toBe("permission-denied");
    const code = await codeOf(
      call(core, setUserStatusContract, { uid: "uid-admin-1", status: "suspended", reason: "Lower role." }),
    );
    expect(code).toBe("permission-denied");
    expect((await dataOf("users/uid-admin-1"))?.status).toBe("active");
  });
});

describe("the second factor", () => {
  it("is required by every privileged function from an administrator who does not present it", async () => {
    const admin = await administrator("uid-admin", { secondFactor: false });
    await account("uid-target");
    const attempts: [string, Promise<unknown>][] = [
      [
        "setRoleAssignment",
        call(admin, setRoleAssignmentContract, {
          action: "grant",
          uid: "uid-target",
          role: "core_team",
          scopeType: "programme",
          scopeId: "eegmanylabs",
        }),
      ],
      [
        "setCapabilityGrant",
        call(admin, setCapabilityGrantContract, {
          action: "grant",
          uid: "uid-target",
          capability: "audit.read",
          reason: "Test.",
        }),
      ],
      [
        "setRoleCapabilityOverride",
        call(admin, setRoleCapabilityOverrideContract, { role: "core_team", capability: "audit.read", allowed: false }),
      ],
      ["setUserStatus", call(admin, setUserStatusContract, { uid: "uid-target", status: "suspended", reason: "T." })],
      ["unlinkAccountClaim", call(admin, unlinkAccountClaimContract, { uid: "uid-target", reason: "T." })],
      ["listUsers", call(admin, listUsersContract, {})],
      ["listAuditEvents", call(admin, listAuditEventsContract, {})],
      ["listAccountClaims", call(admin, listAccountClaimsContract, {})],
      [
        "reviewAccountClaim",
        call(admin, reviewAccountClaimContract, { uid: "uid-target", decision: "reject", note: "T." }),
      ],
      ["getPersonDemographics", call(admin, getPersonDemographicsContract, { personId: "person-x" })],
    ];
    const codes = Object.fromEntries(
      await Promise.all(attempts.map(async ([name, attempt]) => [name, await codeOf(attempt)] as const)),
    );
    for (const [name, code] of Object.entries(codes)) {
      expect({ name, code }).toEqual({ name, code: "failed-precondition" });
    }
    expect((await dataOf("users/uid-target"))?.status).toBe("active");
  });
});

describe("special-category data", () => {
  it("is refused without the named grant and audited without a value when served", async () => {
    await person("person-subject", [{ email: "subject@example.org" }]);
    await recordDemographics("person-subject");
    const admin = await administrator("uid-admin");
    expect(await codeOf(call(admin, getPersonDemographicsContract, { personId: "person-subject" }))).toBe(
      "permission-denied",
    );

    await grantCapability("uid-admin", "demographics.read");
    const served = await call(admin, getPersonDemographicsContract, { personId: "person-subject" });
    expect(served.demographics?.genderSource).toBe(DEMOGRAPHICS.genderSource);

    const entries = await auditOf("demographics.read", "person-subject");
    expect(entries).toHaveLength(1);
    const text = JSON.stringify(entries);
    for (const value of Object.values(DEMOGRAPHICS)) expect(text).not.toContain(value);
  });
});

describe("what the claim flow writes", () => {
  it("puts no address and no free text of the claimant into an audit entry or a notification", async () => {
    await administrator("uid-admin");
    await person("person-victim", [{ email: "victim@example.org" }]);
    const caller = await account("uid-caller", { email: "Caller.Visible@example.org" });
    await call(caller, sessionStartContract, {});
    await call(caller, claimProfileContract, {});
    const script = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    await call(caller, requestAccessContract, {
      statedName: `${script} Synthetic`,
      affiliation: script,
      message: `${script} ${"x".repeat(1_900)}`,
    });

    const audit = await adminDb.collection("auditEvents").get();
    const notes = await adminDb.collectionGroup("notifications").get();
    const written = JSON.stringify([...audit.docs, ...notes.docs].map((document) => document.data())).toLowerCase();
    expect(written).not.toContain("caller.visible");
    expect(written).not.toContain("@example.org");
    expect(written).not.toContain("onerror");
    expect(written).not.toContain("<script");
  });
});

describe("the bootstrap of the first administrator", () => {
  it("is not used by an address that only folds to the bootstrapped one", async () => {
    await bootstrapAdministrator(adminDb, "kim@example.org", DEMO_IDENTITY_HASH_KEY);
    // U+212A KELVIN SIGN lower-cases to an ASCII k. It is another mailbox.
    const lookalike: Caller = { uid: "uid-lookalike", email: "Kim@example.org" };
    await call(lookalike, sessionStartContract, {});
    const record = await dataOf(bootstrapAdminPath(bootstrapAdminId("kim@example.org", DEMO_IDENTITY_HASH_KEY)));
    expect(record?.usedBy ?? null).toBeNull();
    expect((await accessOf("uid-lookalike")).programmeRoles).toEqual([]);
  });

  it("is not used by an unverified address", async () => {
    await bootstrapAdministrator(adminDb, "first.admin@example.org", DEMO_IDENTITY_HASH_KEY);
    const unverified: Caller = { uid: "uid-unverified", email: "first.admin@example.org", emailVerified: false };
    expect(await codeOf(call(unverified, sessionStartContract, {}))).toBe("failed-precondition");
    const record = await dataOf(
      bootstrapAdminPath(bootstrapAdminId("first.admin@example.org", DEMO_IDENTITY_HASH_KEY)),
    );
    expect(record?.usedBy ?? null).toBeNull();
  });
});
