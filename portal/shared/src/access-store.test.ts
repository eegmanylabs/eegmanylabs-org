// Fixtures are synthetic: invented accounts and units, with an address on the example.org domain.
import { describe, expect, it } from "vitest";
import { emptyAccess, resolveAccess } from "./access";
import {
  changedAccessFields,
  type DocumentReader,
  planAccessWrite,
  readAccessSources,
  requireSecondFactorOf,
  type StoredDocument,
} from "./access-store";
import { systemWriteContext } from "./schemas/base";
import type { FirestoreTimestamp } from "./timestamp";

const timestamp = (millis: number): FirestoreTimestamp => ({
  seconds: Math.floor(millis / 1000),
  nanoseconds: (millis % 1000) * 1_000_000,
  toDate: () => new Date(millis),
  toMillis: () => millis,
});
const NOW = new Date("2026-03-04T05:06:07Z");
const at = timestamp(NOW.getTime());
const standard = {
  schemaVersion: 1,
  createdAt: at,
  updatedAt: at,
  createdBy: "system:test",
  updatedBy: "system:test",
  archivedAt: null,
  writeContext: systemWriteContext(),
};
const stamp = { now: at, actor: "system:accessMaintenance", writeContext: systemWriteContext() };

/** A reader over documents held in memory, keyed by path. */
function readerOf(documents: Record<string, Record<string, unknown>>): DocumentReader & { reads: string[] } {
  const reads: string[] = [];
  const inCollection = (collectionPath: string): StoredDocument[] =>
    Object.entries(documents)
      .filter(([path]) => path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes("/"))
      .map(([path, data]) => ({ id: path.slice(collectionPath.length + 1), data }));
  return {
    reads,
    get: async (path) => {
      reads.push(path);
      const data = documents[path];
      return data === undefined ? null : { id: path.split("/").at(-1) ?? "", data };
    },
    whereEquals: async (collectionPath, field, value) =>
      inCollection(collectionPath).filter((document) => document.data[field] === value),
    whereArrayContains: async (collectionPath, field, value) =>
      inCollection(collectionPath).filter((document) =>
        (document.data[field] as unknown[] | undefined)?.includes(value),
      ),
    list: async (collectionPath) => inCollection(collectionPath),
  };
}

const user = {
  ...standard,
  emailLower: "synthetic.account@example.org",
  displayName: null,
  personId: null,
  status: "active",
  mfaEnrolled: true,
  lastSeenAt: at,
  dataOrigin: "demo",
};
const assignment = (uid: string, role: string, scopeType: string, scopeId: string, status = "active") => ({
  ...standard,
  uid,
  role,
  scopeType,
  scopeId,
  status,
  grantedBy: "system:test",
  grantedAt: at,
  expiresAt: null,
  revokedBy: null,
  revokedAt: null,
  history: [],
});

describe("the sources of an access document", () => {
  it("are nothing for an account without a profile", async () => {
    expect(await readAccessSources(readerOf({}), "uid-ghost", NOW)).toBeNull();
  });

  it("are the assignments, grants, groups and overrides of the account, and the units of its person", async () => {
    const reader = readerOf({
      "users/uid-1": { ...user, personId: "person-1" },
      "users/uid-2": user,
      "persons/person-1": { userId: "uid-1", replicationIds: ["StudyA2001", 7] },
      "roleAssignments/a": assignment("uid-1", "lab_coordinator", "laboratory", "lab-a"),
      "roleAssignments/b": assignment("uid-2", "programme_admin", "programme", "eegmanylabs"),
      "roleAssignments/c": assignment("uid-1", "replication_lead", "replication", "StudyB2002", "pendingApproval"),
      "roleCapabilities/lab_coordinator": {
        ...standard,
        role: "lab_coordinator",
        overrides: { peopleContactRead: false },
      },
      "groups/working-group": { memberUids: ["uid-1", "uid-3"] },
      "groups/other-group": { memberUids: ["uid-3"] },
      "capabilityGrants/uid-1__audit.read": {
        ...standard,
        uid: "uid-1",
        capability: "audit.read",
        grantedBy: "uid-9",
        grantedAt: at,
        reason: "A synthetic reason.",
        expiresAt: null,
        revokedBy: null,
        revokedAt: null,
        history: [],
      },
    });

    const sources = await readAccessSources(reader, "uid-1", NOW);

    expect(sources?.unreadable).toEqual([]);
    expect(sources?.stored).toBeNull();
    expect(sources?.inputs).toMatchObject({
      uid: "uid-1",
      personId: "person-1",
      user: { status: "active", mfaEnrolled: true },
      groupKeys: ["working-group"],
      confirmedReplicationIds: ["StudyA2001"],
      requireSecondFactor: true,
      sessionsValidAfter: null,
    });
    expect(sources?.inputs.roleAssignments.map((stored) => stored.role).sort()).toEqual([
      "lab_coordinator",
      "replication_lead",
    ]);
    const resolved = resolveAccess(sources?.inputs ?? ({} as never));
    expect(resolved.coordinatorLaboratoryIds).toEqual(["lab-a"]);
    // The override takes the capability from the role, and with it the unit for contact details.
    expect(resolved.contactLaboratoryIds).toEqual([]);
    expect(resolved.capabilities.auditRead).toEqual(["programme"]);
    expect(resolved.teamReplicationIds).toEqual(["StudyA2001"]);
    expect(resolved.pendingRoles).toEqual([
      { role: "replication_lead", scopeType: "replication", scopeId: "StudyB2002" },
    ]);
  });

  it("count the replications of a person only while the person names the account as its login", async () => {
    const reader = readerOf({
      "users/uid-1": { ...user, personId: "person-1" },
      "persons/person-1": { userId: "uid-somebody-else", replicationIds: ["StudyA2001"] },
    });
    expect((await readAccessSources(reader, "uid-1", NOW))?.inputs.confirmedReplicationIds).toEqual([]);
  });

  it("treat a profile that is not plainly active as suspended, and keep the boundary of its sessions", async () => {
    const boundary = timestamp(1_800_000_000_000);
    const reader = readerOf({
      "users/uid-1": { ...user, status: "disabled-in-some-new-way" },
      "access/uid-1": { ...standard, ...emptyAccess(), sessionsValidAfter: boundary },
    });
    const sources = await readAccessSources(reader, "uid-1", NOW);
    expect(sources?.inputs.user.status).toBe("suspended");
    expect(sources?.inputs.sessionsValidAfter).toBe(boundary);
    expect(resolveAccess(sources?.inputs ?? ({} as never))).toMatchObject({
      suspended: true,
      sessionsValidAfter: boundary,
    });
  });

  it("let a document that does not fit its schema confer nothing, and name its path", async () => {
    const reader = readerOf({
      "users/uid-1": user,
      "roleAssignments/damaged": { uid: "uid-1", role: "programme_admin", status: "active" },
      "roleAssignments/sound": assignment("uid-1", "lab_member", "laboratory", "lab-a"),
      "recordGrants/damaged": { uid: "uid-1", entityType: "spaceship" },
    });
    const sources = await readAccessSources(reader, "uid-1", NOW);
    expect(sources?.unreadable).toEqual(["roleAssignments/damaged", "recordGrants/damaged"]);
    expect(sources?.inputs.roleAssignments.map((stored) => stored.role)).toEqual(["lab_member"]);
  });

  it("read the setting for the second factor as required unless it plainly says false", async () => {
    expect(requireSecondFactorOf(null)).toBe(true);
    expect(requireSecondFactorOf({})).toBe(true);
    expect(requireSecondFactorOf({ requireSecondFactor: "false" })).toBe(true);
    expect(requireSecondFactorOf({ requireSecondFactor: true })).toBe(true);
    expect(requireSecondFactorOf({ requireSecondFactor: false })).toBe(false);
    const reader = readerOf({ "users/uid-1": user, "system/settings": { requireSecondFactor: false } });
    expect((await readAccessSources(reader, "uid-1", NOW))?.inputs.requireSecondFactor).toBe(false);
  });
});

describe("the write of an access document", () => {
  const resolved = { ...emptyAccess(), member: true, scopeKeys: ["members", "user:uid-1"] };

  it("creates the document where none is stored, with the standard fields of the writer", () => {
    const write = planAccessWrite(null, resolved, stamp);
    expect(write).toMatchObject({
      kind: "create",
      document: {
        ...resolved,
        schemaVersion: 1,
        createdBy: "system:accessMaintenance",
        updatedBy: "system:accessMaintenance",
        archivedAt: null,
      },
    });
  });

  it("writes nothing where the stored document already says what was resolved", () => {
    const stored = { id: "uid-1", data: { ...standard, ...resolved, sessionsValidAfter: null } };
    expect(planAccessWrite(stored, resolved, stamp)).toEqual({ kind: "none" });
    expect(changedAccessFields(stored.data, resolved)).toEqual([]);
    // Two timestamps of one instant are the same value, whichever SDK made them.
    const boundary = { ...resolved, sessionsValidAfter: timestamp(5_000) };
    const withBoundary = { id: "uid-1", data: { ...standard, ...resolved, sessionsValidAfter: timestamp(5_000) } };
    expect(planAccessWrite(withBoundary, boundary, stamp)).toEqual({ kind: "none" });
  });

  it("updates the fields that differ, and those alone, with the stamps of an update", () => {
    const stored = { id: "uid-1", data: { ...standard, ...emptyAccess() } };
    const write = planAccessWrite(stored, resolved, stamp);
    expect(write).toEqual({
      kind: "update",
      changes: {
        member: true,
        scopeKeys: ["members", "user:uid-1"],
        updatedAt: at,
        updatedBy: "system:accessMaintenance",
        writeContext: systemWriteContext(),
      },
    });
  });

  it("writes the fields that a document from an earlier version lacks", () => {
    const { contactReplicationIds: _removed, contactLaboratoryIds: _alsoRemoved, ...older } = emptyAccess();
    const write = planAccessWrite({ id: "uid-1", data: { ...standard, ...older } }, emptyAccess(), stamp);
    expect(write.kind).toBe("update");
    expect(write.kind === "update" ? Object.keys(write.changes).sort() : []).toEqual([
      "contactLaboratoryIds",
      "contactReplicationIds",
      "updatedAt",
      "updatedBy",
      "writeContext",
    ]);
  });
});
