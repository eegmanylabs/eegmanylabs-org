// What the registry shows to whom, decided from the access document as the rules decide it.
// Accounts and studies are synthetic.
import { emptyAccess, type ResolvedAccess } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { editsLinksOf, offersDemographicsOf, readsContactOf } from "@/pages/members/member-access";
import { viewerOf } from "./viewer";

const access = (fields: Partial<ResolvedAccess>): ResolvedAccess => ({
  ...emptyAccess(),
  member: true,
  personId: "person-self",
  scopeKeys: ["members", "user:uid-self"],
  ...fields,
});

const lead = access({
  leadReplicationIds: ["ExampleAlpha2001"],
  contactReplicationIds: ["ExampleAlpha2001"],
  scopeKeys: ["members", "rep:ExampleAlpha2001", "user:uid-self"],
  capabilities: { replicationsManage: ["rep:ExampleAlpha2001"], peopleContactRead: ["rep:ExampleAlpha2001"] },
});
const admin = (secondFactorRequired: boolean) =>
  access({
    programmeRoles: ["programme_admin"],
    mfaEnrolled: true,
    secondFactorRequired,
    scopeKeys: ["members", "programme", "role:programme_admin", "user:uid-self"],
    capabilities: {
      replicationsManage: ["programme"],
      peopleContactRead: ["programme"],
      demographicsRead: ["programme"],
      peopleManage: ["programme"],
    },
  });

const other = { userId: "uid-other", replicationIds: ["ExampleAlpha2001"], laboratoryIds: [] };
const stranger = { userId: null, replicationIds: ["ExampleBeta2005"], laboratoryIds: [] };
const self = { userId: "uid-self", replicationIds: [], laboratoryIds: [] };

describe("viewerOf", () => {
  it("gives a lead the management of its own replication only", () => {
    const viewer = viewerOf("uid-self", lead, false);
    expect(viewer.can("replications.manage", { replicationId: "ExampleAlpha2001" })).toBe(true);
    expect(viewer.can("replications.manage", { replicationId: "ExampleBeta2005" })).toBe(false);
    expect(viewer.staff).toBe(false);
    expect(viewer.readsTeamOf("ExampleAlpha2001")).toBe(true);
    expect(viewer.readsTeamOf("ExampleBeta2005")).toBe(false);
  });

  it("withholds the powers of a programme role while the session lacks a required second factor", () => {
    const withheld = viewerOf("uid-self", admin(true), false);
    expect(withheld.staff).toBe(false);
    expect(withheld.can("replications.manage", { replicationId: "ExampleBeta2005" })).toBe(false);
    expect(withheld.queryScopeKeys).toEqual(["members", "user:uid-self"]);

    const present = viewerOf("uid-self", admin(true), true);
    expect(present.staff).toBe(true);
    expect(present.administrator).toBe(true);
    expect(present.can("replications.manage", { replicationId: "ExampleBeta2005" })).toBe(true);
    expect(present.queryScopeKeys[0]).toBe("members");
  });

  it("holds nothing for a suspended account", () => {
    const viewer = viewerOf("uid-self", { ...lead, suspended: true }, false);
    expect(viewer.can("replications.manage", { replicationId: "ExampleAlpha2001" })).toBe(false);
    expect(viewer.can("portal.use", "anywhere")).toBe(false);
  });

  it("asks a list query for at most 30 scope keys, with members first", () => {
    const keys = Array.from({ length: 40 }, (_, index) => `rep:Example${index}`);
    const viewer = viewerOf("uid-self", access({ scopeKeys: [...keys, "members"] }), false);
    expect(viewer.queryScopeKeys).toHaveLength(30);
    expect(viewer.queryScopeKeys[0]).toBe("members");
  });
});

describe("the member page", () => {
  it("asks for the contact details of the person themselves, of the people of a unit the caller leads, and for administrators", () => {
    const member = viewerOf("uid-self", access({}), false);
    expect(readsContactOf(member, self)).toBe(true);
    expect(readsContactOf(member, other)).toBe(false);
    expect(readsContactOf(viewerOf("uid-self", lead, false), other)).toBe(true);
    expect(readsContactOf(viewerOf("uid-self", lead, false), stranger)).toBe(false);
    expect(readsContactOf(viewerOf("uid-self", admin(false), false), stranger)).toBe(true);
    expect(readsContactOf(viewerOf("uid-self", admin(true), false), stranger)).toBe(false);
  });

  it("offers demographic details to the person and to a holder of the capability with the second factor in place", () => {
    expect(offersDemographicsOf(viewerOf("uid-self", access({}), false), self)).toBe(true);
    expect(offersDemographicsOf(viewerOf("uid-self", access({}), false), other)).toBe(false);
    expect(offersDemographicsOf(viewerOf("uid-self", lead, false), other)).toBe(false);
    expect(offersDemographicsOf(viewerOf("uid-self", admin(true), true), other)).toBe(true);
    expect(offersDemographicsOf(viewerOf("uid-self", admin(true), false), other)).toBe(false);
  });

  it("lets the person and holders of people.manage edit the profile addresses, and nobody else", () => {
    expect(editsLinksOf(viewerOf("uid-self", access({}), false), self)).toBe(true);
    expect(editsLinksOf(viewerOf("uid-self", lead, false), other)).toBe(false);
    expect(editsLinksOf(viewerOf("uid-self", admin(false), false), other)).toBe(true);
    expect(editsLinksOf(viewerOf("uid-self", access({ member: false }), false), self)).toBe(false);
  });
});
