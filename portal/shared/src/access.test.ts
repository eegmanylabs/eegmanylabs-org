// The capability matrix as an exhaustive table of role by capability by scope, and the rules of
// `resolveAccess`: overrides, expiry, revocation, the second factor and suspension.
// Fixtures are synthetic: invented accounts, studies and laboratories.
import { describe, expect, it } from "vitest";
import { type AccessInputs, can, capabilitiesOf, emptyAccess, type ResolvedAccess, resolveAccess } from "./access";
import {
  CAPABILITIES,
  type CapabilityOverrides,
  capabilityField,
  DEFAULT_ROLE_CAPABILITIES,
  effectiveRoleCapabilities,
  GRANTABLE_CAPABILITIES,
  type GrantableCapability,
  ROLES,
  type Role,
  type RoleScopeType,
  SENSITIVE_CAPABILITIES,
} from "./capabilities";
import { systemWriteContext } from "./schemas/base";
import { accessDocSchema } from "./schemas/identity";
import type { FirestoreTimestamp } from "./timestamp";

function timestamp(iso: string): FirestoreTimestamp {
  const date = new Date(iso);
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => date,
    toMillis: () => date.getTime(),
  };
}

const NOW = new Date("2026-06-01T12:00:00Z");
const UID = "uid-synthetic";

/** The names other code is written against. The order is that of the registry. */
const NAMED: readonly GrantableCapability[] = [
  "directory.read",
  "people.manage",
  "people.contact.read",
  "demographics.read",
  "claims.review",
  "labs.manage",
  "labs.claims.review",
  "replications.manage",
  "participations.manage",
  "recruitment.report",
  "recruitment.verify",
  "tasks.manage",
  "datasets.manage",
  "datasets.paths.read",
  "pages.manage",
  "lookups.manage",
  "roles.manage",
  "users.suspend",
  "imports.run",
  "imports.rollback",
  "reconciliation.resolve",
  "integrations.manage",
  "integrations.credentials",
  "publishing.prepare",
  "publishing.approve",
  "audit.read",
  "automations.manage",
  "outreach.read",
];

const SENSITIVE: readonly GrantableCapability[] = [
  "roles.manage",
  "users.suspend",
  "demographics.read",
  "imports.rollback",
  "integrations.credentials",
  "publishing.approve",
];

type Reach = "programme" | "scope";
const everywhere = (capabilities: readonly GrantableCapability[]) =>
  Object.fromEntries(capabilities.map((capability) => [capability, "programme"])) as Partial<
    Record<GrantableCapability, Reach>
  >;

/**
 * What each role holds by default, written out by hand from docs/SECURITY.md, section 5, and
 * not derived from the code under test. `programme`: for the programme as a whole. `scope`:
 * within the replication or laboratory of the assignment. Absent: not held.
 */
const EXPECTED: { readonly [R in Role]: Partial<Record<GrantableCapability, Reach>> } = {
  programme_admin: everywhere(NAMED),
  core_team: everywhere(NAMED.filter((capability) => !SENSITIVE.includes(capability))),
  replication_lead: {
    "directory.read": "programme",
    "people.contact.read": "scope",
    "replications.manage": "scope",
    "participations.manage": "scope",
    "recruitment.report": "scope",
    "tasks.manage": "scope",
    "datasets.manage": "scope",
    "datasets.paths.read": "scope",
    "pages.manage": "scope",
    "outreach.read": "scope",
  },
  lab_coordinator: {
    "directory.read": "programme",
    "people.contact.read": "scope",
    "labs.manage": "scope",
    "labs.claims.review": "scope",
    "participations.manage": "scope",
    "recruitment.report": "scope",
    "tasks.manage": "scope",
    "datasets.manage": "scope",
    "datasets.paths.read": "scope",
    "pages.manage": "scope",
  },
  lab_member: {
    "directory.read": "programme",
    "recruitment.report": "scope",
  },
  external_collaborator: {},
};

/** The scope each role is assigned for in these tests, with a record inside it and one outside it. */
const ASSIGNED: {
  readonly [R in Role]: { readonly scopeType: RoleScopeType; readonly scopeId: string };
} = {
  programme_admin: { scopeType: "programme", scopeId: "eegmanylabs" },
  core_team: { scopeType: "programme", scopeId: "eegmanylabs" },
  replication_lead: { scopeType: "replication", scopeId: "StudyA2001" },
  lab_coordinator: { scopeType: "laboratory", scopeId: "lab-a" },
  lab_member: { scopeType: "laboratory", scopeId: "lab-a" },
  external_collaborator: { scopeType: "group", scopeId: "group-a" },
};
const INSIDE = { replicationId: "StudyA2001", laboratoryId: "lab-a", groupKey: "group-a" };
const OUTSIDE = { replicationId: "StudyB2002", laboratoryId: "lab-b", groupKey: "group-b" };

type Assignment = AccessInputs["roleAssignments"][number];

function assignment(role: Role, change: Partial<Assignment> = {}): Assignment {
  return { uid: UID, role, ...ASSIGNED[role], status: "active", expiresAt: null, ...change };
}

function inputs(change: Partial<AccessInputs> = {}): AccessInputs {
  return {
    uid: UID,
    now: NOW,
    user: { status: "active", mfaEnrolled: true },
    personId: "person-synthetic-1",
    sessionsValidAfter: null,
    roleAssignments: [],
    capabilityGrants: [],
    roleCapabilities: [],
    recordGrants: [],
    groupKeys: [],
    confirmedReplicationIds: [],
    ...change,
  };
}

const resolveRole = (role: Role, overrides?: CapabilityOverrides) =>
  resolveAccess(
    inputs({
      roleAssignments: [assignment(role)],
      roleCapabilities: overrides === undefined ? [] : [{ role, overrides }],
    }),
  );

/** A resolved access set must be storable as it stands: the writer only adds the standard fields. */
function expectStorable(access: ResolvedAccess): void {
  const at = timestamp(NOW.toISOString());
  const stored = {
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: "system:accessResolver",
    updatedBy: "system:accessResolver",
    archivedAt: null,
    writeContext: systemWriteContext(),
    ...access,
  };
  expect(accessDocSchema.safeParse(stored).error?.issues ?? []).toEqual([]);
}

describe("the registry of capabilities", () => {
  it("holds exactly the named capabilities, and portal.use for every signed-in account", () => {
    expect(CAPABILITIES).toEqual(["portal.use", ...NAMED]);
    expect(GRANTABLE_CAPABILITIES).toEqual(NAMED);
    expect(NAMED).toHaveLength(28);
  });

  it("names the six sensitive capabilities that the core team does not hold by default", () => {
    expect([...SENSITIVE_CAPABILITIES].sort()).toEqual([...SENSITIVE].sort());
  });

  it("keys a capability in camelCase, because a full stop separates the segments of a field path", () => {
    expect(capabilityField("demographics.read")).toBe("demographicsRead");
    expect(capabilityField("people.contact.read")).toBe("peopleContactRead");
    expect(capabilityField("labs.claims.review")).toBe("labsClaimsReview");
    const fields = NAMED.map((capability) => capabilityField(capability));
    expect(new Set(fields).size).toBe(NAMED.length);
    for (const field of fields) expect(field).toMatch(/^[a-z][A-Za-z]*$/);
  });
});

describe("the default capability matrix", () => {
  it("has the six roles", () => {
    expect(ROLES).toEqual([
      "programme_admin",
      "core_team",
      "replication_lead",
      "lab_coordinator",
      "lab_member",
      "external_collaborator",
    ]);
  });

  it.each(ROLES)("gives %s exactly the capabilities of the security design", (role) => {
    expect([...DEFAULT_ROLE_CAPABILITIES[role]].sort()).toEqual(Object.keys(EXPECTED[role]).sort());
  });

  it("gives the programme administrator every capability and the core team all but the sensitive ones", () => {
    expect(DEFAULT_ROLE_CAPABILITIES.programme_admin).toHaveLength(28);
    expect(DEFAULT_ROLE_CAPABILITIES.core_team).toHaveLength(22);
    for (const capability of SENSITIVE) expect(DEFAULT_ROLE_CAPABILITIES.core_team).not.toContain(capability);
  });

  const cells = ROLES.flatMap((role) =>
    NAMED.map((capability) => [role, capability, EXPECTED[role][capability]] as const),
  );

  it.each(cells)("%s and %s: held for %s", (role, capability, reach) => {
    const access = resolveRole(role);
    expect(can(access, capability, "programme")).toBe(reach === "programme");
    expect(can(access, capability, INSIDE)).toBe(reach !== undefined);
    expect(can(access, capability, OUTSIDE)).toBe(reach === "programme");
    expect(can(access, capability, "anywhere")).toBe(reach !== undefined);
    expect(can(access, capability, {})).toBe(reach === "programme");
  });

  it.each(ROLES)("resolves %s into a document that can be stored as it stands", (role) => {
    expectStorable(resolveRole(role));
  });

  it("limits a lead to the replication and a coordinator to the laboratory of the assignment", () => {
    const lead = resolveRole("replication_lead");
    expect(can(lead, "replications.manage", { replicationId: "StudyA2001" })).toBe(true);
    expect(can(lead, "replications.manage", { replicationId: "StudyB2002" })).toBe(false);
    // A replication elsewhere does not become manageable because the record sits in a laboratory of the same name.
    expect(can(lead, "participations.manage", { replicationId: "StudyB2002", laboratoryId: "StudyA2001" })).toBe(false);
    const coordinator = resolveRole("lab_coordinator");
    expect(can(coordinator, "labs.manage", { laboratoryId: "lab-a" })).toBe(true);
    expect(can(coordinator, "labs.manage", { laboratoryId: "lab-b" })).toBe(false);
    expect(can(coordinator, "participations.manage", { replicationId: "StudyB2002", laboratoryId: "lab-a" })).toBe(
      true,
    );
    expect(can(coordinator, "replications.manage", { replicationId: "StudyA2001", laboratoryId: "lab-a" })).toBe(false);
  });

  it("adds the scopes of several assignments together", () => {
    const access = resolveAccess(
      inputs({
        roleAssignments: [
          assignment("replication_lead"),
          assignment("replication_lead", { scopeId: "StudyC2003" }),
          assignment("lab_member", { scopeId: "lab-z" }),
        ],
      }),
    );
    expect(access.capabilities.replicationsManage).toEqual(["rep:StudyA2001", "rep:StudyC2003"]);
    expect(access.capabilities.recruitmentReport).toEqual(["lab:lab-z", "rep:StudyA2001", "rep:StudyC2003"]);
    expect(access.capabilities.directoryRead).toEqual(["programme"]);
    expect(can(access, "recruitment.report", { replicationId: "StudyB2002", laboratoryId: "lab-z" })).toBe(true);
    expect(can(access, "replications.manage", { replicationId: "StudyB2002" })).toBe(false);
  });
});

describe("portal.use", () => {
  it.each(ROLES)("belongs to an account whose role is %s", (role) => {
    expect(can(resolveRole(role), "portal.use", "anywhere")).toBe(true);
  });

  it("belongs to an account that has been granted nothing, and to no suspended account", () => {
    expect(can(emptyAccess(), "portal.use", "programme")).toBe(true);
    expect(can({ ...emptyAccess(), suspended: true }, "portal.use", "anywhere")).toBe(false);
    expect([...capabilitiesOf({ signedIn: true, access: emptyAccess() })]).toEqual(["portal.use"]);
    expect(capabilitiesOf({ signedIn: true, access: { ...emptyAccess(), suspended: true } }).size).toBe(0);
  });

  it("is never stored in the capabilities map", () => {
    for (const role of ROLES) expect(Object.keys(resolveRole(role).capabilities)).not.toContain("portalUse");
  });
});

describe("what the interface may show", () => {
  it("is every capability the account holds in at least one scope", () => {
    const shown = capabilitiesOf({ signedIn: true, access: resolveRole("lab_member") });
    expect([...shown].sort()).toEqual(["directory.read", "portal.use", "recruitment.report"]);
    expect(capabilitiesOf({ signedIn: true, access: resolveRole("programme_admin") }).size).toBe(29);
    expect(capabilitiesOf({ signedIn: false, access: resolveRole("programme_admin") }).size).toBe(0);
  });
});

describe("overrides of the matrix", () => {
  it("switch a sensitive capability on for the core team", () => {
    expect(can(resolveRole("core_team"), "roles.manage", "programme")).toBe(false);
    for (const capability of SENSITIVE) {
      const access = resolveRole("core_team", { [capabilityField(capability)]: true });
      expect(can(access, capability, "programme")).toBe(true);
      for (const other of SENSITIVE.filter((candidate) => candidate !== capability)) {
        expect(can(access, other, "anywhere")).toBe(false);
      }
    }
  });

  it("switch a capability off for a role", () => {
    expect(can(resolveRole("core_team", { auditRead: false }), "audit.read", "anywhere")).toBe(false);
    expect(can(resolveRole("core_team", { auditRead: false }), "imports.run", "programme")).toBe(true);
    expect(can(resolveRole("replication_lead", { outreachRead: false }), "outreach.read", INSIDE)).toBe(false);
    expect(can(resolveRole("lab_member", { recruitmentReport: false }), "recruitment.report", INSIDE)).toBe(false);
  });

  it("apply to the role they are stored for and to no other", () => {
    const access = resolveAccess(
      inputs({
        roleAssignments: [assignment("replication_lead"), assignment("lab_coordinator")],
        roleCapabilities: [{ role: "replication_lead", overrides: { tasksManage: false, recruitmentReport: false } }],
      }),
    );
    expect(access.capabilities.tasksManage).toEqual(["lab:lab-a"]);
    expect(access.capabilities.recruitmentReport).toEqual(["lab:lab-a"]);
  });

  it("never take a capability from the programme administrator", () => {
    const overrides = Object.fromEntries(NAMED.map((capability) => [capabilityField(capability), false]));
    expect(effectiveRoleCapabilities("programme_admin", overrides)).toEqual(NAMED);
    const access = resolveRole("programme_admin", overrides);
    for (const capability of NAMED) expect(can(access, capability, "programme")).toBe(true);
  });

  it("never give an external collaborator a capability", () => {
    const overrides = Object.fromEntries(NAMED.map((capability) => [capabilityField(capability), true]));
    expect(effectiveRoleCapabilities("external_collaborator", overrides)).toEqual([]);
    expect(resolveRole("external_collaborator", overrides).capabilities).toEqual({});
  });

  it.each(["replication_lead", "lab_coordinator", "lab_member"] as const)(
    "give %s a capability of a unit within its scope, and never one of the programme",
    (role) => {
      const overrides = Object.fromEntries(NAMED.map((capability) => [capabilityField(capability), true]));
      const access = resolveRole(role, overrides);
      const programmeOnly: readonly GrantableCapability[] = [
        "people.manage",
        "demographics.read",
        "claims.review",
        "recruitment.verify",
        "lookups.manage",
        "roles.manage",
        "users.suspend",
        "imports.run",
        "imports.rollback",
        "reconciliation.resolve",
        "integrations.manage",
        "integrations.credentials",
        "publishing.prepare",
        "publishing.approve",
        "audit.read",
        "automations.manage",
      ];
      for (const capability of programmeOnly) expect(can(access, capability, "anywhere")).toBe(false);
      for (const capability of NAMED.filter((candidate) => !programmeOnly.includes(candidate))) {
        expect(can(access, capability, INSIDE)).toBe(true);
        expect(can(access, capability, OUTSIDE)).toBe(capability === "directory.read");
      }
    },
  );
});

describe("assignments that confer nothing", () => {
  const nothing = {
    ...emptyAccess(),
    personId: "person-synthetic-1",
    member: true,
    mfaEnrolled: true,
    scopeKeys: ["members", `user:${UID}`],
  };

  it.each([
    ["pending approval", { status: "pendingApproval" }],
    ["revoked", { status: "revoked" }],
    ["marked as expired", { status: "expired" }],
    ["past its expiry time while still marked active", { expiresAt: timestamp("2026-06-01T11:59:59Z") }],
    ["at its expiry time to the millisecond", { expiresAt: timestamp("2026-06-01T12:00:00Z") }],
    ["made for another account", { uid: "uid-someone-else" }],
  ] as const)("an assignment that is %s", (_label, change) => {
    for (const role of ROLES) {
      const access = resolveAccess(inputs({ roleAssignments: [assignment(role, change)] }));
      expect({ ...access, pendingRoles: [] }).toEqual(nothing);
      for (const capability of NAMED) expect(can(access, capability, "anywhere")).toBe(false);
    }
  });

  it("an assignment of a role with a scope type that does not go with it", () => {
    const access = resolveAccess(
      inputs({
        roleAssignments: [
          assignment("replication_lead", { scopeType: "laboratory", scopeId: "lab-a" }),
          assignment("lab_coordinator", { scopeType: "programme", scopeId: "eegmanylabs" }),
          assignment("programme_admin", { scopeType: "replication", scopeId: "StudyA2001" }),
          assignment("core_team", { scopeType: "group", scopeId: "group-a" }),
        ],
      }),
    );
    expect(access).toEqual(nothing);
  });

  it("holds while its expiry time lies ahead, and stops when the clock passes it", () => {
    const expiring = [assignment("replication_lead", { expiresAt: timestamp("2026-06-01T12:00:01Z") })];
    expect(can(resolveAccess(inputs({ roleAssignments: expiring })), "replications.manage", INSIDE)).toBe(true);
    const later = inputs({ roleAssignments: expiring, now: new Date("2026-06-01T12:00:01Z") });
    expect(can(resolveAccess(later), "replications.manage", INSIDE)).toBe(false);
  });

  it("lists a pending role so that the interface can say that it awaits approval", () => {
    const access = resolveAccess(
      inputs({
        roleAssignments: [
          assignment("replication_lead", { status: "pendingApproval" }),
          assignment("lab_coordinator", { status: "pendingApproval" }),
          assignment("lab_member"),
          assignment("replication_lead", { status: "pendingApproval", uid: "uid-someone-else", scopeId: "StudyZ2009" }),
        ],
      }),
    );
    expect(access.pendingRoles).toEqual([
      { role: "lab_coordinator", scopeType: "laboratory", scopeId: "lab-a" },
      { role: "replication_lead", scopeType: "replication", scopeId: "StudyA2001" },
    ]);
    expect(access.leadReplicationIds).toEqual([]);
    expect(access.coordinatorLaboratoryIds).toEqual([]);
    expect(access.manageScopeKeys).toEqual([]);
    expect(access.memberLaboratoryIds).toEqual(["lab-a"]);
    expect(can(access, "labs.manage", INSIDE)).toBe(false);
    expectStorable(access);
  });
});

describe("a suspended account", () => {
  it("gets no capability, no scope and no membership, whatever it has been granted", () => {
    const access = resolveAccess(
      inputs({
        user: { status: "suspended", mfaEnrolled: true },
        sessionsValidAfter: timestamp("2026-05-01T00:00:00Z"),
        roleAssignments: ROLES.map((role) => assignment(role)),
        capabilityGrants: [{ uid: UID, capability: "demographics.read", expiresAt: null, revokedAt: null }],
        recordGrants: [
          { uid: UID, entityType: "dataset", entityId: "ds-1", level: "edit", expiresAt: null, revokedAt: null },
        ],
        groupKeys: ["group-a"],
        confirmedReplicationIds: ["StudyB2002"],
      }),
    );
    expect(access).toEqual({
      ...emptyAccess(),
      personId: "person-synthetic-1",
      mfaEnrolled: true,
      sessionsValidAfter: access.sessionsValidAfter,
      suspended: true,
    });
    expect(access.sessionsValidAfter?.toMillis()).toBe(Date.parse("2026-05-01T00:00:00Z"));
    for (const capability of CAPABILITIES) {
      for (const scope of ["programme", "anywhere", INSIDE, OUTSIDE] as const) {
        expect(can(access, capability, scope)).toBe(false);
      }
    }
    expectStorable(access);
  });

  it("is refused by can even when its document still lists capabilities", () => {
    const stale = { ...resolveRole("programme_admin"), suspended: true };
    for (const capability of CAPABILITIES) expect(can(stale, capability, "programme")).toBe(false);
  });
});

describe("the second factor", () => {
  const withoutFactor = { status: "active", mfaEnrolled: false } as const;

  it("is required of programme administrators, the core team and holders of a named grant, and of nobody else", () => {
    expect(resolveRole("programme_admin").secondFactorRequired).toBe(true);
    expect(resolveRole("core_team").secondFactorRequired).toBe(true);
    for (const role of ["replication_lead", "lab_coordinator", "lab_member", "external_collaborator"] as const) {
      expect(resolveRole(role).secondFactorRequired).toBe(false);
    }
    const granted = inputs({
      capabilityGrants: [{ uid: UID, capability: "demographics.read", expiresAt: null, revokedAt: null }],
    });
    expect(resolveAccess(granted).secondFactorRequired).toBe(true);
    expect(resolveAccess(inputs()).secondFactorRequired).toBe(false);
  });

  it.each(["programme_admin", "core_team"] as const)(
    "withholds the powers of %s until a factor is enrolled, and still names the role",
    (role) => {
      const access = resolveAccess(inputs({ user: withoutFactor, roleAssignments: [assignment(role)] }));
      expect(access.programmeRoles).toEqual([role]);
      expect(access.secondFactorRequired).toBe(true);
      expect(access.mfaEnrolled).toBe(false);
      expect(access.capabilities).toEqual({});
      expect(access.scopeKeys).toEqual(["members", `user:${UID}`]);
      expect(access.member).toBe(true);
      expectStorable(access);
    },
  );

  it("leaves the scoped roles of the same account in effect", () => {
    const access = resolveAccess(
      inputs({ user: withoutFactor, roleAssignments: [assignment("core_team"), assignment("lab_coordinator")] }),
    );
    expect(can(access, "labs.manage", INSIDE)).toBe(true);
    expect(can(access, "labs.manage", OUTSIDE)).toBe(false);
    expect(can(access, "imports.run", "anywhere")).toBe(false);
    expect(access.scopeKeys).toEqual(["lab:lab-a", "members", "role:lab_coordinator", `user:${UID}`]);
  });

  it("puts the powers in effect once the factor is enrolled", () => {
    const access = resolveRole("core_team");
    expect(access.scopeKeys).toEqual(["members", "programme", "role:core_team", `user:${UID}`]);
    expect(can(access, "imports.run", "programme")).toBe(true);
  });
});

describe("named capability grants", () => {
  const grant = (change: Partial<AccessInputs["capabilityGrants"][number]> = {}) => ({
    uid: UID,
    capability: "demographics.read" as const,
    expiresAt: timestamp("2026-06-02T00:00:00Z"),
    revokedAt: null,
    ...change,
  });

  it("give one capability for the programme as a whole to an account of any role", () => {
    const access = resolveAccess(inputs({ roleAssignments: [assignment("lab_member")], capabilityGrants: [grant()] }));
    expect(can(access, "demographics.read", "programme")).toBe(true);
    expect(access.capabilities.demographicsRead).toEqual(["programme"]);
    expect(can(access, "people.manage", "anywhere")).toBe(false);
    expectStorable(access);
  });

  it.each([
    ["has expired", { expiresAt: timestamp("2026-06-01T12:00:00Z") }],
    ["has been revoked", { revokedAt: timestamp("2026-05-31T00:00:00Z") }],
    ["was made for another account", { uid: "uid-someone-else" }],
  ])("give nothing when the grant %s", (_label, change) => {
    const access = resolveAccess(inputs({ capabilityGrants: [grant(change)] }));
    expect(can(access, "demographics.read", "anywhere")).toBe(false);
    expect(access.secondFactorRequired).toBe(false);
  });

  it("are withheld until the account has enrolled a second factor", () => {
    const access = resolveAccess(
      inputs({ user: { status: "active", mfaEnrolled: false }, capabilityGrants: [grant()] }),
    );
    expect(can(access, "demographics.read", "anywhere")).toBe(false);
    expect(access.secondFactorRequired).toBe(true);
  });
});

describe("membership and scope", () => {
  it("makes a member of an account with a linked person or a member role, and of no other", () => {
    expect(resolveAccess(inputs()).member).toBe(true);
    expect(resolveAccess(inputs({ personId: null })).member).toBe(false);
    expect(resolveAccess(inputs({ personId: null, roleAssignments: [assignment("lab_member")] })).member).toBe(true);
    expect(resolveRole("external_collaborator").member).toBe(false);
    const both = [assignment("external_collaborator"), assignment("lab_member")];
    expect(resolveAccess(inputs({ roleAssignments: both })).member).toBe(true);
  });

  it("gives an external collaborator neither the members scope nor the scope of a replication", () => {
    const access = resolveAccess(
      inputs({ roleAssignments: [assignment("external_collaborator")], confirmedReplicationIds: ["StudyA2001"] }),
    );
    expect(access.member).toBe(false);
    expect(access.teamReplicationIds).toEqual([]);
    expect(access.groupKeys).toEqual(["group-a"]);
    expect(access.scopeKeys).toEqual(["group:group-a", "role:external_collaborator", `user:${UID}`]);
    expectStorable(access);
  });

  it("lists every scope key the account holds, and the keys it manages", () => {
    const access = resolveAccess(
      inputs({
        roleAssignments: [
          assignment("replication_lead"),
          assignment("lab_coordinator"),
          assignment("lab_member", { scopeId: "lab-z" }),
        ],
        groupKeys: ["working-group-1"],
        confirmedReplicationIds: ["StudyB2002", "StudyA2001"],
      }),
    );
    expect(access.leadReplicationIds).toEqual(["StudyA2001"]);
    // Read scope alone: the replication the account leads is not listed a second time.
    expect(access.teamReplicationIds).toEqual(["StudyB2002"]);
    expect(access.coordinatorLaboratoryIds).toEqual(["lab-a"]);
    expect(access.memberLaboratoryIds).toEqual(["lab-z"]);
    expect(access.scopeKeys).toEqual([
      "group:working-group-1",
      "lab:lab-a",
      "lab:lab-z",
      "members",
      "rep:StudyA2001",
      "rep:StudyB2002",
      "role:lab_coordinator",
      "role:lab_member",
      "role:replication_lead",
      `user:${UID}`,
    ]);
    expect(access.manageScopeKeys).toEqual(["lab:lab-a", "rep:StudyA2001"]);
    expect(can(access, "replications.manage", { replicationId: "StudyB2002" })).toBe(false);
    expectStorable(access);
  });

  it("lists the records shared with the account, and those of them it may edit", () => {
    const record = (entityId: string, change: Partial<AccessInputs["recordGrants"][number]> = {}) => ({
      uid: UID,
      entityType: "dataset" as const,
      entityId,
      level: "view" as const,
      expiresAt: null,
      revokedAt: null,
      ...change,
    });
    const access = resolveAccess(
      inputs({
        recordGrants: [
          record("ds-2", { level: "edit" }),
          record("ds-1"),
          record("ds-3", { revokedAt: timestamp("2026-05-01T00:00:00Z") }),
          record("ds-4", { expiresAt: timestamp("2026-05-01T00:00:00Z") }),
          record("ds-5", { uid: "uid-someone-else" }),
        ],
      }),
    );
    expect(access.sharedRecordKeys).toEqual(["dataset__ds-1", "dataset__ds-2"]);
    expect(access.editableRecordKeys).toEqual(["dataset__ds-2"]);
  });

  it("gives the same document for the same inputs in any order", () => {
    const roleAssignments = [
      assignment("lab_member", { scopeId: "lab-z" }),
      assignment("replication_lead"),
      assignment("lab_coordinator"),
      assignment("replication_lead", { scopeId: "StudyC2003", status: "pendingApproval" }),
    ];
    const forwards = resolveAccess(
      inputs({ roleAssignments, groupKeys: ["b", "a"], confirmedReplicationIds: ["Y", "X"] }),
    );
    const backwards = resolveAccess(
      inputs({
        roleAssignments: [...roleAssignments].reverse(),
        groupKeys: ["a", "b", "a"],
        confirmedReplicationIds: ["X", "Y"],
      }),
    );
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });

  it("carries the instant from which sessions are valid over unchanged", () => {
    const boundary = timestamp("2026-05-01T00:00:00Z");
    expect(resolveAccess(inputs({ sessionsValidAfter: boundary })).sessionsValidAfter).toBe(boundary);
    expect(resolveAccess(inputs()).sessionsValidAfter).toBeNull();
  });
});
