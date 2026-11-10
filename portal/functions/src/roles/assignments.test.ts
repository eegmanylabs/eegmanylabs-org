// Fixtures are synthetic: invented accounts and laboratories.
import { type RoleAssignmentDoc, userWriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import type { WriteStamp } from "../framework/documents";
import { assignmentIdOf, inForce, nextAssignment, revokedAssignment } from "./assignments";

const at = new Date("2026-03-04T05:06:07Z");
const later = new Date("2026-04-04T05:06:07Z");
const stamp = (actor: string, when: Date = at): WriteStamp => ({
  at: when,
  actor,
  writeContext: userWriteContext("audit-entry-1"),
});
const wanted = { uid: "uid-target", role: "lab_coordinator", scopeType: "laboratory", scopeId: "lab-a" } as const;

const granted = (): RoleAssignmentDoc => {
  const created = nextAssignment(null, { ...wanted, status: "active", reason: "Elected." }, stamp("uid-admin"));
  if (created === null) throw new Error("A new assignment was expected.");
  return created;
};

describe("a role assignment", () => {
  it("is named by its account, its role and its scope", () => {
    expect(assignmentIdOf("uid-target", wanted)).toBe("uid-target__lab_coordinator__laboratory__lab-a");
  });

  it("starts active with whoever granted it, or pending with nobody", () => {
    expect(granted()).toMatchObject({
      ...wanted,
      status: "active",
      grantedBy: "uid-admin",
      grantedAt: Timestamp.fromDate(at),
      expiresAt: null,
      revokedBy: null,
      revokedAt: null,
      reason: "Elected.",
      history: [],
      createdBy: "uid-admin",
      writeContext: userWriteContext("audit-entry-1"),
    });
    const pending = nextAssignment(null, { ...wanted, status: "pendingApproval" }, stamp("uid-claimant"));
    expect(pending).toMatchObject({ status: "pendingApproval", grantedBy: null, grantedAt: null });
    expect(pending).not.toHaveProperty("reason");
  });

  it("becomes active when it is approved, and is never set back to pending", () => {
    const pending = nextAssignment(null, { ...wanted, status: "pendingApproval" }, stamp("uid-claimant"));
    const approved = nextAssignment(pending, { ...wanted, status: "active" }, stamp("uid-admin", later));
    expect(approved).toMatchObject({
      status: "active",
      grantedBy: "uid-admin",
      grantedAt: Timestamp.fromDate(later),
      createdBy: "uid-claimant",
      history: [],
    });
    expect(nextAssignment(pending, { ...wanted, status: "pendingApproval" }, stamp("uid-claimant", later))).toBeNull();
    expect(nextAssignment(approved, { ...wanted, status: "pendingApproval" }, stamp("uid-claimant", later))).toBeNull();
    expect(nextAssignment(approved, { ...wanted, status: "active" }, stamp("uid-admin", later))).toBeNull();
  });

  it("changes its expiry time only when a grant states another one", () => {
    const active = granted();
    const expiry = new Date("2027-01-01T00:00:00Z");
    expect(
      nextAssignment(active, { ...wanted, status: "active", expiresAt: null }, stamp("uid-admin", later)),
    ).toBeNull();
    const limited = nextAssignment(
      active,
      { ...wanted, status: "active", expiresAt: expiry },
      stamp("uid-admin", later),
    );
    expect(limited).toMatchObject({
      status: "active",
      expiresAt: Timestamp.fromDate(expiry),
      grantedAt: Timestamp.fromDate(at),
      history: [],
    });
    expect(
      nextAssignment(limited, { ...wanted, status: "active", expiresAt: expiry }, stamp("uid-admin", later)),
    ).toBeNull();
  });

  it("is in force while it is active and its expiry time lies ahead", () => {
    const active = granted();
    expect(inForce(active, later)).toBe(true);
    expect(inForce({ ...active, expiresAt: Timestamp.fromDate(later) }, at)).toBe(true);
    expect(inForce({ ...active, expiresAt: Timestamp.fromDate(at) }, later)).toBe(false);
    expect(inForce({ ...active, status: "pendingApproval" }, at)).toBe(false);
    expect(inForce(null, at)).toBe(false);
  });

  it("keeps its earlier period when it is revoked and granted again", () => {
    const revoked = revokedAssignment(granted(), "Left the laboratory.", stamp("uid-admin", later));
    expect(revoked).toMatchObject({
      status: "revoked",
      revokedBy: "uid-admin",
      revokedAt: Timestamp.fromDate(later),
      reason: "Left the laboratory.",
    });
    if (revoked === null) throw new Error("A revoked assignment was expected.");
    expect(revokedAssignment(revoked, "Again.", stamp("uid-admin", later))).toBeNull();

    const again = nextAssignment(revoked, { ...wanted, status: "active" }, stamp("uid-other-admin", later));
    expect(again).toMatchObject({ status: "active", grantedBy: "uid-other-admin", revokedBy: null, revokedAt: null });
    expect(again).not.toHaveProperty("reason");
    expect(again?.history).toEqual([
      {
        status: "revoked",
        grantedBy: "uid-admin",
        grantedAt: Timestamp.fromDate(at),
        expiresAt: null,
        revokedBy: "uid-admin",
        revokedAt: Timestamp.fromDate(later),
        reason: "Left the laboratory.",
      },
    ]);
  });

  it("starts a new period once its expiry time has passed", () => {
    const expired = { ...granted(), expiresAt: Timestamp.fromDate(at) };
    const again = nextAssignment(expired, { ...wanted, status: "pendingApproval" }, stamp("uid-claimant", later));
    expect(again).toMatchObject({ status: "pendingApproval", grantedBy: null, expiresAt: null });
    expect(again?.history).toMatchObject([{ status: "active", expiresAt: Timestamp.fromDate(at) }]);
  });
});
