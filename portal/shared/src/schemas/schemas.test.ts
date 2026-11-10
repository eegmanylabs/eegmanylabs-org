// Fixtures are synthetic: invented values on the example.org domain.
import { describe, expect, it } from "vitest";
import { DATA_ORIGINS } from "../data-origin";
import type { FirestoreTimestamp } from "../timestamp";
import { accessDocSchema, accountStanding } from "./access";
import { auditEventSchema } from "./audit";
import {
  APPEND_ONLY_BASE_FIELDS,
  DOCUMENT_BASE_FIELDS,
  isSystemActor,
  systemActor,
  systemWriteContext,
  userWriteContext,
} from "./base";
import { userDocSchema } from "./user";

/** A stand-in with the shape both Firebase SDKs give a timestamp. */
function timestamp(iso: string): FirestoreTimestamp {
  const date = new Date(iso);
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => date,
    toMillis: () => date.getTime(),
  };
}

const now = timestamp("2026-01-02T03:04:05Z");

const base = {
  schemaVersion: 1,
  createdAt: now,
  updatedAt: now,
  createdBy: "uid-synthetic",
  updatedBy: "uid-synthetic",
  archivedAt: null,
  writeContext: userWriteContext("event-synthetic"),
};

const user = {
  ...base,
  emailLower: "synthetic.person@example.org",
  displayName: null,
  personId: null,
  status: "active",
  mfaEnrolled: false,
  lastSeenAt: now,
  dataOrigin: "live",
};

const access = {
  ...base,
  member: false,
  personId: null,
  suspended: false,
  sessionsValidAfter: null,
};

describe("the standard fields", () => {
  it("are the ones the data model names", () => {
    expect([...DOCUMENT_BASE_FIELDS].sort()).toEqual(
      ["archivedAt", "createdAt", "createdBy", "schemaVersion", "updatedAt", "updatedBy", "writeContext"].sort(),
    );
    expect([...APPEND_ONLY_BASE_FIELDS].sort()).toEqual(
      ["createdAt", "createdBy", "schemaVersion", "writeContext"].sort(),
    );
  });

  it.each([
    ["the time of creation", { createdAt: undefined }],
    ["the time of the last change", { updatedAt: undefined }],
    ["who created it", { createdBy: undefined }],
    ["who last changed it", { updatedBy: "" }],
    ["the archive marker", { archivedAt: undefined }],
    ["the write context", { writeContext: undefined }],
    ["a known origin of the write", { writeContext: { ...base.writeContext, origin: "browser" } }],
    ["a depth that is a whole number", { writeContext: { ...base.writeContext, depth: -1 } }],
  ])("are required: a document without %s is rejected", (_label, change) => {
    expect(userDocSchema.safeParse({ ...user, ...change }).success).toBe(false);
    expect(accessDocSchema.safeParse({ ...access, ...change }).success).toBe(false);
  });

  it("start a chain at depth 0 with nothing to correlate", () => {
    expect(userWriteContext()).toEqual({
      origin: "user",
      depth: 0,
      correlationId: null,
      causationId: null,
      auditEventId: null,
    });
    expect(systemWriteContext("import", "event-1")).toMatchObject({ origin: "import", auditEventId: "event-1" });
    expect(systemWriteContext().origin).toBe("system");
  });
});

describe("systemActor", () => {
  it("builds the actor string of trusted code", () => {
    expect(systemActor("import")).toBe("system:import");
    expect(isSystemActor(systemActor("seedDemo"))).toBe(true);
    expect(isSystemActor("uid-synthetic")).toBe(false);
  });

  it.each(["", "Import", "two words", "a:b"])("refuses the name %j", (name) => {
    expect(() => systemActor(name)).toThrow(RangeError);
  });
});

describe("dataOrigin", () => {
  it("has the four values of the data model", () => {
    expect(DATA_ORIGINS).toEqual(["live", "importedHistorical", "demo", "projected"]);
  });
});

describe("userDocSchema", () => {
  it("accepts a well-formed document", () => {
    expect(userDocSchema.parse(user)).toEqual(user);
    const claimed = { ...user, personId: "person-synthetic-1", mfaEnrolled: true, displayName: "Synthetic Person" };
    expect(userDocSchema.parse(claimed)).toEqual(claimed);
  });

  it("drops fields it does not know, so a newer writer does not break an older reader", () => {
    expect(userDocSchema.parse({ ...user, addedLater: true })).toEqual(user);
  });

  it.each([
    ["a status outside the list", { status: "deleted" }],
    ["a schema version it does not know", { schemaVersion: 2 }],
    ["a date in place of a timestamp", { lastSeenAt: "2026-01-02" }],
    ["an origin outside the list", { dataOrigin: "guessed" }],
    ["the origin name of the first scaffold", { dataOrigin: "imported" }],
    ["an empty display name", { displayName: "" }],
    ["a display name over 200 characters", { displayName: "x".repeat(201) }],
    ["a missing person field", { personId: undefined }],
    ["a missing second-factor field", { mfaEnrolled: undefined }],
  ])("rejects %s", (_label, change) => {
    expect(userDocSchema.safeParse({ ...user, ...change }).success).toBe(false);
  });
});

describe("accessDocSchema", () => {
  it("accepts an unlinked account, a linked member and a suspended account", () => {
    expect(accessDocSchema.parse(access)).toEqual(access);
    const linked = { ...access, member: true, personId: "person-synthetic-1" };
    expect(accessDocSchema.parse(linked)).toEqual(linked);
    const suspended = { ...access, suspended: true, sessionsValidAfter: now };
    expect(accessDocSchema.parse(suspended)).toEqual(suspended);
  });

  it("carries no data origin: it is derived authorisation state, not a fact about the programme", () => {
    expect(accessDocSchema.parse({ ...access, dataOrigin: "demo" })).toEqual(access);
  });

  it.each([
    ["membership that is not a boolean", { member: "yes" }],
    ["a missing person field", { personId: undefined }],
    ["an empty person identifier", { personId: "" }],
    ["a missing suspension field", { suspended: undefined }],
    ["a missing session boundary", { sessionsValidAfter: undefined }],
    ["a session boundary that is not a timestamp", { sessionsValidAfter: 1_700_000_000 }],
  ])("rejects %s", (_label, change) => {
    expect(accessDocSchema.safeParse({ ...access, ...change }).success).toBe(false);
  });
});

describe("accountStanding", () => {
  const signedInAt = (iso: string) => ({ authTimeSeconds: Math.floor(new Date(iso).getTime() / 1000) });

  it("treats an account with no access document as active, because it has been granted nothing", () => {
    expect(accountStanding(null, { authTimeSeconds: null })).toBe("active");
  });

  it("refuses a suspended account whenever it signed in", () => {
    const suspended = { suspended: true, sessionsValidAfter: null };
    expect(accountStanding(suspended, signedInAt("2026-06-01T00:00:00Z"))).toBe("suspended");
  });

  it("refuses a session that began before the boundary and accepts one that began at or after it", () => {
    const bounded = { suspended: false, sessionsValidAfter: now };
    expect(accountStanding(bounded, signedInAt("2026-01-02T03:04:04Z"))).toBe("session-ended");
    expect(accountStanding(bounded, signedInAt("2026-01-02T03:04:05Z"))).toBe("active");
    expect(accountStanding(bounded, signedInAt("2026-01-03T00:00:00Z"))).toBe("active");
  });

  it("refuses a session whose start is unknown once a boundary has been set", () => {
    expect(accountStanding({ suspended: false, sessionsValidAfter: now }, { authTimeSeconds: null })).toBe(
      "session-ended",
    );
  });
});

describe("auditEventSchema", () => {
  const event = {
    schemaVersion: 1,
    createdAt: now,
    createdBy: "uid-synthetic",
    writeContext: userWriteContext("event-synthetic"),
    actorUid: "uid-synthetic",
    actorKind: "user",
    action: "account.created",
    documentPath: "users/uid-synthetic",
    entityType: "user",
    entityId: "uid-synthetic",
    changes: [{ field: "status", withheld: true }],
    context: {
      origin: "user",
      depth: 0,
      correlationId: null,
      causationId: null,
      requestId: null,
      ipHash: null,
      userAgent: null,
    },
  };

  it("accepts an entry made by a person and one made by trusted code", () => {
    expect(auditEventSchema.parse(event)).toEqual(event);
    const bySystem = { ...event, actorUid: null, actorKind: "import", createdBy: systemActor("import") };
    expect(auditEventSchema.parse(bySystem)).toEqual(bySystem);
  });

  it("accepts a change with its values, for documents that members can read", () => {
    const withValues = { ...event, changes: [{ field: "title", before: "Old", after: "New" }] };
    expect(auditEventSchema.parse(withValues).changes).toEqual(withValues.changes);
  });

  it.each([
    ["an action that is not in the registry", { action: "something.else" }],
    ["an actor of an unknown kind", { actorKind: "robot" }],
    ["a person without an account identifier", { actorUid: null }],
    ["trusted code that names an account", { actorKind: "system" }],
    ["an empty document path", { documentPath: "" }],
    ["an entity type that is not in the registry", { entityType: "spreadsheet" }],
    ["a missing entity identifier", { entityId: undefined }],
    ["a change that names no field", { changes: [{ before: 1, after: 2 }] }],
    ["a missing context", { context: undefined }],
    ["a missing time", { createdAt: undefined }],
    ["a missing write context", { writeContext: undefined }],
    ["the shape of the first scaffold", { type: "account.created", targetPath: "access/uid", action: undefined }],
  ])("rejects %s", (_label, change) => {
    expect(auditEventSchema.safeParse({ ...event, ...change }).success).toBe(false);
  });
});
