// Fixtures are synthetic: invented accounts and studies.
import { describe, expect, it } from "vitest";
import { type AccessInputs, resolveAccess } from "./access";
import {
  atLeast,
  laboratoryPageAudience,
  type PageAccessFacts,
  type PageAudience,
  pageLevelFor,
  personPageAudience,
  principalScopeKey,
  replicationPageAudience,
  restrictedPageAudience,
  workspacePageAudience,
} from "./page-access";

const NOW = new Date("2026-06-01T00:00:00Z");

function accessOf(uid: string, extra: Partial<AccessInputs> = {}) {
  return resolveAccess({
    uid,
    now: NOW,
    user: { status: "active", mfaEnrolled: extra.user?.mfaEnrolled ?? false },
    personId: "person-synthetic",
    sessionsValidAfter: null,
    roleAssignments: [],
    capabilityGrants: [],
    roleCapabilities: [],
    recordGrants: [],
    groupKeys: [],
    confirmedReplicationIds: [],
    ...extra,
  });
}

const role = (uid: string, roleName: "replication_lead" | "lab_member" | "programme_admin", scope: string) =>
  ({
    uid,
    role: roleName,
    scopeType: roleName === "programme_admin" ? "programme" : roleName === "lab_member" ? "laboratory" : "replication",
    scopeId: scope,
    status: "active",
    expiresAt: null,
  }) as const;

const facts = (audience: PageAudience, accessMode: "inherit" | "restricted" = "inherit"): PageAccessFacts => ({
  accessMode,
  ...audience,
});

const noFactor = { secondFactorVerified: false };
const withFactor = { secondFactorVerified: true };

describe("the audience of a page", () => {
  it("holds, at each level, the keys of every level above it", () => {
    const audience = restrictedPageAudience({ replicationId: "Study2001", laboratoryId: null }, [
      { principalType: "user", principalId: "uid-reader", level: "view" },
      { principalType: "user", principalId: "uid-commenter", level: "comment" },
      { principalType: "group", principalId: "writers", level: "edit" },
      { principalType: "user", principalId: "uid-owner", level: "full" },
    ]);
    expect(audience.levelKeys.full).toEqual(["user:uid-owner"]);
    expect(audience.levelKeys.edit).toEqual(["group:writers", "user:uid-owner"]);
    expect(audience.levelKeys.comment).toEqual(["group:writers", "user:uid-commenter", "user:uid-owner"]);
    expect(audience.scopeKeys).toEqual(["group:writers", "user:uid-commenter", "user:uid-owner", "user:uid-reader"]);
    expect(audience.replicationId).toBe("Study2001");
  });

  it("follows the record that a body page belongs to", () => {
    expect(replicationPageAudience("Study2001").levelKeys.edit).toEqual(["rep:Study2001"]);
    expect(laboratoryPageAudience("lab-one").levelKeys.edit).toEqual(["lab:lab-one"]);
    expect(personPageAudience("uid-person").levelKeys.full).toEqual(["user:uid-person"]);
    expect(personPageAudience(null).levelKeys.edit).toEqual([]);
    expect(workspacePageAudience("uid-creator").levelKeys).toEqual({
      comment: ["members", "user:uid-creator"],
      edit: ["members", "user:uid-creator"],
      full: ["user:uid-creator"],
    });
  });

  it("names principals by the scope keys their accounts hold", () => {
    expect(principalScopeKey("role", "lab_member")).toBe("role:lab_member");
    expect(() => principalScopeKey("role", "not_a_role")).toThrow();
  });
});

describe("pageLevelFor", () => {
  const page = facts(replicationPageAudience("Study2001"));

  it("gives every member comment on the body of a replication, its team edit and its leads full", () => {
    expect(pageLevelFor(accessOf("uid-member"), noFactor, page)).toBe("comment");
    const team = accessOf("uid-team", { confirmedReplicationIds: ["Study2001"] });
    expect(pageLevelFor(team, noFactor, page)).toBe("edit");
    const lead = accessOf("uid-lead", { roleAssignments: [role("uid-lead", "replication_lead", "Study2001")] });
    expect(pageLevelFor(lead, noFactor, page)).toBe("full");
    const otherLead = accessOf("uid-other", { roleAssignments: [role("uid-other", "replication_lead", "Study2002")] });
    expect(pageLevelFor(otherLead, noFactor, page)).toBe("comment");
  });

  it("keeps the managers of a unit out of a restricted page that does not list them", () => {
    const restricted = facts(
      restrictedPageAudience({ replicationId: "Study2001", laboratoryId: null }, [
        { principalType: "user", principalId: "uid-reader", level: "view" },
      ]),
      "restricted",
    );
    const lead = accessOf("uid-lead", { roleAssignments: [role("uid-lead", "replication_lead", "Study2001")] });
    expect(pageLevelFor(lead, noFactor, restricted)).toBe("none");
    expect(pageLevelFor(accessOf("uid-reader"), noFactor, restricted)).toBe("view");
    expect(atLeast(pageLevelFor(accessOf("uid-reader"), noFactor, restricted), "comment")).toBe(false);
  });

  it("gives programme administrators full access only in a session with their second factor", () => {
    const admin = accessOf("uid-admin", {
      user: { status: "active", mfaEnrolled: true },
      roleAssignments: [role("uid-admin", "programme_admin", "programme")],
    });
    const restricted = facts(restrictedPageAudience({ replicationId: null, laboratoryId: null }, []), "restricted");
    expect(pageLevelFor(admin, withFactor, restricted)).toBe("full");
    expect(pageLevelFor(admin, noFactor, restricted)).toBe("none");
    expect(pageLevelFor(admin, noFactor, page)).toBe("comment");
  });

  it("gives nothing to a suspended account, to an account that is no member and to nobody", () => {
    expect(pageLevelFor({ ...accessOf("uid-member"), suspended: true }, noFactor, page)).toBe("none");
    expect(pageLevelFor({ ...accessOf("uid-member"), member: false }, noFactor, page)).toBe("none");
    expect(pageLevelFor(null, noFactor, page)).toBe("none");
  });
});
