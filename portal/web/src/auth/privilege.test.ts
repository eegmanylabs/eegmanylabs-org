import { describe, expect, it } from "vitest";
import { decidePrivilege, navigableCapabilities, type PrivilegeFacts, programmePowersWithheld } from "./privilege";

type Access = PrivilegeFacts["access"];

const plain: Access = {
  suspended: false,
  capabilities: { directoryRead: ["programme"], recruitmentReport: ["laboratory:lab-a"] },
  programmeRoles: [],
  mfaEnrolled: false,
  secondFactorRequired: false,
};

/** A programme administrator whose powers are in effect: the factor is enrolled and was presented. */
const administrator: Access = {
  suspended: false,
  capabilities: { claimsReview: ["programme"], auditRead: ["programme"], rolesManage: ["programme"] },
  programmeRoles: ["programme_admin"],
  mfaEnrolled: true,
  secondFactorRequired: true,
};

const facts = (access: Access, sessionSecondFactor = true, enrolledFactors = 1): PrivilegeFacts => ({
  access,
  sessionSecondFactor,
  enrolledFactors,
});

describe("decidePrivilege", () => {
  it("opens what the access document confers, and nothing else", () => {
    expect(decidePrivilege(facts(plain, false, 0), "portal.use")).toBe("allowed");
    expect(decidePrivilege(facts(plain, false, 0), "recruitment.report")).toBe("allowed");
    expect(decidePrivilege(facts(plain, false, 0), "claims.review")).toBe("denied");
    expect(decidePrivilege(facts(administrator), "audit.read")).toBe("allowed");
  });

  it("asks an administrator who has not enrolled a factor to enrol one, where the role would open the page", () => {
    // resolveAccess withholds the programme powers until a factor is enrolled.
    const unenrolled: Access = { ...administrator, capabilities: {}, mfaEnrolled: false };
    expect(programmePowersWithheld(facts(unenrolled, false, 0))).toBe(true);
    expect(decidePrivilege(facts(unenrolled, false, 0), "claims.review")).toBe("enrol-factor");
    expect(decidePrivilege(facts(unenrolled, false, 0), "users.suspend")).toBe("enrol-factor");
  });

  it("asks an administrator whose session lacks the factor to sign in again with it", () => {
    expect(decidePrivilege(facts(administrator, false, 1), "audit.read")).toBe("sign-in-again");
    // Without an enrolled factor there is nothing to sign in with: enrol first.
    expect(decidePrivilege(facts(administrator, false, 0), "audit.read")).toBe("enrol-factor");
  });

  it("asks nothing of the core team for a sensitive capability its role does not confer", () => {
    const core: Access = { ...administrator, programmeRoles: ["core_team"], capabilities: {}, mfaEnrolled: false };
    expect(decidePrivilege(facts(core, false, 0), "claims.review")).toBe("enrol-factor");
    expect(decidePrivilege(facts(core, false, 0), "roles.manage")).toBe("denied");
  });

  it("keeps a right that a scoped role confers open without a factor", () => {
    const coordinatorAndAdmin: Access = {
      ...administrator,
      capabilities: { labsClaimsReview: ["laboratory:lab-a"] },
      mfaEnrolled: false,
    };
    expect(decidePrivilege(facts(coordinatorAndAdmin, false, 0), "labs.claims.review")).toBe("allowed");
  });

  it("opens nothing to a suspended account", () => {
    expect(decidePrivilege(facts({ ...administrator, suspended: true }), "audit.read")).toBe("denied");
  });

  it("follows the access document when it waives the factor", () => {
    const waived: Access = { ...administrator, secondFactorRequired: false };
    expect(programmePowersWithheld(facts(waived, false, 0))).toBe(false);
    expect(decidePrivilege(facts(waived, false, 0), "audit.read")).toBe("allowed");
  });
});

describe("navigableCapabilities", () => {
  it("lists what is open and what waits for the second factor, for a signed-in account only", () => {
    expect(navigableCapabilities(null, false).size).toBe(0);
    expect([...navigableCapabilities(null, true)]).toEqual(["portal.use"]);
    const waiting = navigableCapabilities(
      facts({ ...administrator, capabilities: {}, mfaEnrolled: false }, false, 0),
      true,
    );
    expect(waiting.has("claims.review")).toBe(true);
    expect(waiting.has("audit.read")).toBe(true);
    const member = navigableCapabilities(facts(plain, false, 0), true);
    expect(member.has("claims.review")).toBe(false);
    expect(member.has("directory.read")).toBe(true);
  });
});
