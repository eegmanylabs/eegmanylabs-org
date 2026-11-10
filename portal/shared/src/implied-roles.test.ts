// Fixtures are synthetic: invented laboratories and studies.
import { describe, expect, it } from "vitest";
import { distinctRoles, rolesOfMemberEntry, rolesOfMembership, rolesOfPerson } from "./implied-roles";
import { memberEntryCounts, membershipCounts, sameUnits, withUnit } from "./person-units";

describe("the entries that put a unit on a person", () => {
  it("are member entries that are confirmed and not archived", () => {
    expect(memberEntryCounts({ status: "confirmed", archivedAt: null })).toBe(true);
    expect(memberEntryCounts({ status: "confirmed" })).toBe(true);
    for (const entry of [
      { status: "proposed", archivedAt: null },
      { status: "ended", archivedAt: null },
      { status: "confirmed", archivedAt: { seconds: 1 } },
      null,
      undefined,
    ]) {
      expect(memberEntryCounts(entry)).toBe(false);
    }
  });

  it("are memberships that are confirmed, current and not archived", () => {
    expect(membershipCounts({ reviewStatus: "confirmed", isCurrent: true, archivedAt: null })).toBe(true);
    for (const membership of [
      { reviewStatus: "needsReview", isCurrent: true, archivedAt: null },
      { reviewStatus: "confirmed", isCurrent: false, archivedAt: null },
      { reviewStatus: "confirmed", isCurrent: true, archivedAt: { seconds: 1 } },
      { reviewStatus: "confirmed" },
      null,
    ]) {
      expect(membershipCounts(membership)).toBe(false);
    }
  });

  it("are kept as a sorted list without repeats", () => {
    expect(withUnit(["lab-b", "lab-a"], "lab-c", true)).toEqual(["lab-a", "lab-b", "lab-c"]);
    expect(withUnit(["lab-b", "lab-a", "lab-a"], "lab-a", true)).toEqual(["lab-a", "lab-b"]);
    expect(withUnit(["lab-b", "lab-a"], "lab-a", false)).toEqual(["lab-b"]);
    expect(withUnit([], "lab-a", false)).toEqual([]);
    expect(sameUnits(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(sameUnits(["a"], ["a", "b"])).toBe(false);
  });
});

describe("the roles that the records about a person imply", () => {
  const confirmed = { status: "confirmed", archivedAt: null };

  it("are membership of a laboratory at once, for a confirmed member entry", () => {
    expect(rolesOfMemberEntry("lab-a", { ...confirmed, role: "member" })).toEqual([
      { role: "lab_member", scopeType: "laboratory", scopeId: "lab-a", status: "active" },
    ]);
    expect(rolesOfMemberEntry("lab-a", { ...confirmed, role: "representative" })).toHaveLength(1);
  });

  it.each(["coordinator", "pi"])(
    "add the coordination of the laboratory, awaiting approval, for the role %s",
    (role) => {
      expect(rolesOfMemberEntry("lab-a", { ...confirmed, role })).toEqual([
        { role: "lab_member", scopeType: "laboratory", scopeId: "lab-a", status: "active" },
        { role: "lab_coordinator", scopeType: "laboratory", scopeId: "lab-a", status: "pendingApproval" },
      ]);
    },
  );

  it("are nothing for an entry that is proposed, ended, archived or missing", () => {
    expect(rolesOfMemberEntry("lab-a", { status: "proposed", role: "pi", archivedAt: null })).toEqual([]);
    expect(rolesOfMemberEntry("lab-a", { status: "ended", role: "coordinator", archivedAt: null })).toEqual([]);
    expect(rolesOfMemberEntry("lab-a", { ...confirmed, role: "pi", archivedAt: { seconds: 1 } })).toEqual([]);
    expect(rolesOfMemberEntry("lab-a", null)).toEqual([]);
  });

  it("are the lead of a replication, awaiting approval, for a current lead or co-lead and for no other membership", () => {
    const pending = [
      { role: "replication_lead", scopeType: "replication", scopeId: "StudyA2001", status: "pendingApproval" },
    ];
    for (const role of ["lead", "coLead"]) {
      expect(
        rolesOfMembership("StudyA2001", { role, isCurrent: true, reviewStatus: "needsReview", archivedAt: null }),
      ).toEqual(pending);
      expect(
        rolesOfMembership("StudyA2001", { role, isCurrent: true, reviewStatus: "confirmed", archivedAt: null }),
      ).toEqual(pending);
      expect(rolesOfMembership("StudyA2001", { role, isCurrent: false, archivedAt: null })).toEqual([]);
      expect(rolesOfMembership("StudyA2001", { role, isCurrent: true, archivedAt: { seconds: 1 } })).toEqual([]);
    }
    for (const role of ["formerLead", "coordinator", "analyst", "member", "advisor"]) {
      expect(
        rolesOfMembership("StudyA2001", { role, isCurrent: true, reviewStatus: "confirmed", archivedAt: null }),
      ).toEqual([]);
    }
    expect(rolesOfMembership("StudyA2001", null)).toEqual([]);
  });

  it("are the core team, awaiting approval, for a person whom the directory lists in it", () => {
    expect(rolesOfPerson({ isCoreTeam: true })).toEqual([
      { role: "core_team", scopeType: "programme", scopeId: "eegmanylabs", status: "pendingApproval" },
    ]);
    expect(rolesOfPerson({ isCoreTeam: false })).toEqual([]);
    expect(rolesOfPerson({ isCoreTeam: "yes" })).toEqual([]);
  });

  it("never grant a management role at once, whatever the records say", () => {
    const roles = [
      ...rolesOfMemberEntry("lab-a", { ...confirmed, role: "pi" }),
      ...rolesOfMembership("StudyA2001", {
        role: "lead",
        isCurrent: true,
        reviewStatus: "confirmed",
        archivedAt: null,
      }),
      ...rolesOfPerson({ isCoreTeam: true }),
    ];
    expect(roles.filter((role) => role.status === "active").map((role) => role.role)).toEqual(["lab_member"]);
  });

  it("are named once for a scope, and the active one holds where a role is implied twice", () => {
    const pending = {
      role: "lab_member",
      scopeType: "laboratory",
      scopeId: "lab-a",
      status: "pendingApproval",
    } as const;
    const active = { ...pending, status: "active" } as const;
    expect(distinctRoles([pending, active, pending])).toEqual([active]);
    expect(distinctRoles([active, pending])).toEqual([active]);
    expect(distinctRoles([pending, { ...pending, scopeId: "lab-b" }])).toHaveLength(2);
  });
});
