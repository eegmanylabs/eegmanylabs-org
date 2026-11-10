// Integration tests of the functions behind the administration console and the account page:
// listUsers, listAuditEvents and endAllSessions, run against the emulators.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain.
import {
  COLLECTIONS,
  endAllSessionsContract,
  listAuditEventsContract,
  listUsersContract,
  setUserStatusContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminAuth, adminDb } from "../support/admin";
import {
  accessOf,
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  coreTeamMember,
  grantCapability,
  grantRole,
  laboratory,
  leaveNoTrace,
  person,
  refusal,
  resetWorld,
  standard,
} from "./support";

beforeEach(resetWorld);
afterAll(leaveNoTrace);

/** Gives an account a name, as sessionStart would from its sign-in token. */
async function named(uid: string, displayName: string): Promise<void> {
  await adminDb.doc(COLLECTIONS.users.docPath(uid)).update({ displayName });
}

describe("listUsers", () => {
  it("lists accounts by name with their roles, and gives addresses to whoever may read contact details", async () => {
    const admin = await administrator("uid-admin");
    await named("uid-admin", "Zed Administrator");
    await person("person-amy", [], { displayName: "Amy Synthetic" });
    await account("uid-amy", { email: "amy.synthetic@example.org", personId: "person-amy" });
    await account("uid-bo", { email: "bo.synthetic@example.org" });
    await named("uid-bo", "Bo Synthetic");
    await laboratory("lab-a");
    await grantRole("uid-bo", "lab_coordinator", "laboratory", "lab-a", "pendingApproval");

    const listed = await call(admin, listUsersContract, {});
    expect(listed.addressesShown).toBe(true);
    expect(listed.total).toBe(3);
    // Sorted by the name of the linked person, else the name the account gives itself.
    expect(listed.users.map((user) => user.uid)).toEqual(["uid-amy", "uid-bo", "uid-admin"]);
    expect(listed.users[0]).toMatchObject({ personName: "Amy Synthetic", emailLower: "amy.synthetic@example.org" });
    expect(listed.users[1]?.roles).toEqual([
      expect.objectContaining({ role: "lab_coordinator", scopeId: "lab-a", status: "pendingApproval" }),
    ]);
    expect(listed.users[2]?.roles).toEqual([expect.objectContaining({ role: "programme_admin", status: "active" })]);

    // Search by name and by address, a status filter and a page.
    expect((await call(admin, listUsersContract, { search: "synthetic bo" })).users).toEqual([]);
    expect((await call(admin, listUsersContract, { search: "Bo Synth" })).users.map((user) => user.uid)).toEqual([
      "uid-bo",
    ]);
    expect((await call(admin, listUsersContract, { search: "amy.synthetic@" })).users.map((user) => user.uid)).toEqual(
      ["uid-amy"],
    );
    const page = await call(admin, listUsersContract, { offset: 1, limit: 1 });
    expect(page).toMatchObject({ total: 3 });
    expect(page.users.map((user) => user.uid)).toEqual(["uid-bo"]);
    expect((await call(admin, listUsersContract, { uids: ["uid-bo", "uid-missing"] })).users).toHaveLength(1);
  });

  it("hides addresses, and never searches them, for a caller who may not read contact details", async () => {
    // The core team may suspend accounts here through a named grant, and the matrix is
    // overridden so that it may not read contact details.
    const core = await coreTeamMember("uid-core");
    await grantCapability("uid-core", "users.suspend");
    await adminDb.doc(COLLECTIONS.roleCapabilities.docPath("core_team")).set({
      ...standard(),
      role: "core_team",
      overrides: { peopleContactRead: false },
    });
    await grantRole("uid-core", "core_team");
    await account("uid-hidden", { email: "hidden.address@example.org" });

    const listed = await call(core, listUsersContract, {});
    expect(listed.addressesShown).toBe(false);
    expect(listed.users.every((user) => user.emailLower === null)).toBe(true);
    // An address finds nobody, so the search says nothing about which addresses have accounts.
    expect((await call(core, listUsersContract, { search: "hidden.address" })).total).toBe(0);
  });

  it("refuses a member, a caller without the second factor and a signed-out caller", async () => {
    const member = await account("uid-member");
    await laboratory("lab-a");
    await grantRole("uid-member", "lab_coordinator", "laboratory", "lab-a");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });
    await adminDb.doc(COLLECTIONS.access.docPath("uid-admin")).update({ secondFactorRequired: true });

    expect(await codeOf(call(member, listUsersContract, {}))).toBe("permission-denied");
    const refused = await refusal(call(withoutFactor, listUsersContract, {}));
    expect(refused.code).toBe("failed-precondition");
    expect(refused.details).toMatchObject({ public: true, reason: "secondFactorRequired" });
    expect(await codeOf(call(null, listUsersContract, {}))).toBe("unauthenticated");
  });
});

describe("listAuditEvents", () => {
  async function entry(id: string, fields: Record<string, unknown>, at: Date): Promise<void> {
    await adminDb.doc(COLLECTIONS.auditEvents.docPath(id)).set({
      schemaVersion: 1,
      createdAt: Timestamp.fromDate(at),
      createdBy: "system:test",
      writeContext: standard().writeContext,
      actorUid: null,
      actorKind: "system",
      action: "document.updated",
      documentPath: `laboratories/${id}`,
      entityType: null,
      entityId: null,
      changes: [],
      context: {
        origin: "system",
        depth: 0,
        correlationId: null,
        causationId: null,
        requestId: null,
        ipHash: null,
        userAgent: null,
      },
      ...fields,
    });
  }

  it("pages through the trail newest first, filters it, and keeps withheld values withheld", async () => {
    const admin = await administrator("uid-auditor");
    await named("uid-auditor", "Audit Reader");
    const base = Date.parse("2026-03-01T12:00:00Z");
    for (let index = 0; index < 5; index += 1) {
      await entry(
        `zz-entry-${index}`,
        index % 2 === 0
          ? {
              actorUid: "uid-auditor",
              actorKind: "user",
              action: "role.granted",
              entityType: "user",
              entityId: "uid-target",
              changes: [
                { field: "status", before: "pendingApproval", after: "active" },
                { field: "grantedAt", after: Timestamp.fromDate(new Date(base)) },
                { field: "reason", withheld: true },
              ],
            }
          : {},
        new Date(base + index * 60_000),
      );
    }
    const window = { from: "2026-03-01T11:59:00Z", to: "2026-03-01T12:10:00Z" };

    const first = await call(admin, listAuditEventsContract, { ...window, limit: 2 });
    expect(first.events.map((event) => event.eventId)).toEqual(["zz-entry-4", "zz-entry-3"]);
    expect(first.next).not.toBeNull();
    const second = await call(admin, listAuditEventsContract, {
      ...window,
      limit: 2,
      ...(first.next === null ? {} : { after: first.next }),
    });
    expect(second.events.map((event) => event.eventId)).toEqual(["zz-entry-2", "zz-entry-1"]);

    const byActor = await call(admin, listAuditEventsContract, { ...window, actorUid: "uid-auditor" });
    expect(byActor.events.map((event) => event.eventId)).toEqual(["zz-entry-4", "zz-entry-2", "zz-entry-0"]);
    expect(byActor.next).toBeNull();
    expect(byActor.events[0]).toMatchObject({
      actorName: "Audit Reader",
      action: "role.granted",
      changes: [
        { field: "status", before: "pendingApproval", after: "active" },
        { field: "grantedAt", after: "2026-03-01T12:00:00.000Z" },
        { field: "reason", withheld: true },
      ],
    });
    expect(byActor.events[0]?.changes[2]).not.toHaveProperty("after");

    // Two filters at once: one goes to Firestore and the other is applied to what it returns.
    const both = await call(admin, listAuditEventsContract, {
      ...window,
      action: "document.updated",
      entityType: "user",
    });
    expect(both.events).toEqual([]);
    const narrow = await call(admin, listAuditEventsContract, {
      ...window,
      action: "role.granted",
      from: "2026-03-01T12:01:00Z",
    });
    expect(narrow.events.map((event) => event.eventId)).toEqual(["zz-entry-4", "zz-entry-2"]);
  });

  it("refuses everyone who does not hold audit.read for the programme", async () => {
    await laboratory("lab-a");
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");
    expect(await codeOf(call(coordinator, listAuditEventsContract, {}))).toBe("permission-denied");
    expect(await codeOf(call(await account("uid-plain"), listAuditEventsContract, {}))).toBe("permission-denied");
    expect(await codeOf(call(null, listAuditEventsContract, {}))).toBe("unauthenticated");
  });
});

describe("endAllSessions", () => {
  async function signedInAccount(email: string): Promise<Caller> {
    const { uid } = await adminAuth.createUser({ email, emailVerified: true });
    return account(uid, { email });
  }

  it("ends every earlier session of the caller's own account, with one audit entry", async () => {
    const caller = await signedInAccount("ends.sessions@example.org");
    const before = Date.now();
    const result = await call(caller, endAllSessionsContract, {});

    const boundary = Date.parse(result.sessionsValidAfter);
    expect(boundary % 1000).toBe(0);
    expect(boundary).toBeGreaterThan(before - 1_000);
    expect((await accessOf(caller.uid)).sessionsValidAfter?.toMillis()).toBe(boundary);
    const audit = await auditOf("account.sessionsEnded", caller.uid);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changes).toEqual([{ field: "sessionsValidAfter", withheld: true }]);
    // The refresh tokens of the account are revoked as well.
    const record = await adminAuth.getUser(caller.uid);
    expect(Date.parse(record.tokensValidAfterTime ?? "")).toBeGreaterThanOrEqual(boundary);

    // A session that began before the boundary is refused from its next request.
    const earlier = { ...caller, authTime: Math.floor(before / 1000) - 60 };
    expect(await codeOf(call(earlier, endAllSessionsContract, {}))).toBe("unauthenticated");
  });

  it("concerns the caller alone, and refuses a suspended account", async () => {
    const admin = await administrator("uid-admin");
    const caller = await signedInAccount("only.mine@example.org");
    const other = await signedInAccount("someone.else@example.org");
    await call(caller, endAllSessionsContract, {});
    expect((await accessOf(other.uid)).sessionsValidAfter).toBeNull();
    expect(await codeOf(call(caller, endAllSessionsContract, { uid: other.uid } as never))).toBe("invalid-argument");

    await call(admin, setUserStatusContract, { uid: other.uid, status: "suspended", reason: "A synthetic reason." });
    expect(await codeOf(call(other, endAllSessionsContract, {}))).toBe("permission-denied");
  });
});
