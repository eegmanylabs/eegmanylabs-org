// Fixtures are synthetic: invented values on the example.org domain.
import { describe, expect, it } from "vitest";
import type { FirestoreTimestamp } from "../timestamp";
import { accessDocSchema } from "./access";
import { auditEventSchema, SYSTEM_ACTOR } from "./audit";
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

const user = {
  schemaVersion: 1,
  emailLower: "synthetic.person@example.org",
  displayName: null,
  status: "active",
  createdAt: now,
  lastSeenAt: now,
  dataOrigin: "live",
};

const access = {
  schemaVersion: 1,
  member: false,
  personId: null,
  createdAt: now,
  updatedAt: now,
  dataOrigin: "live",
};

describe("userDocSchema", () => {
  it("accepts a well-formed document", () => {
    expect(userDocSchema.parse(user)).toEqual(user);
  });

  it("drops fields it does not know, so a newer writer does not break an older reader", () => {
    expect(userDocSchema.parse({ ...user, addedLater: true })).toEqual(user);
  });

  it.each([
    ["a status outside the list", { status: "deleted" }],
    ["a schema version it does not know", { schemaVersion: 2 }],
    ["a date in place of a timestamp", { lastSeenAt: "2026-01-02" }],
    ["a missing timestamp", { createdAt: undefined }],
    ["an origin outside the list", { dataOrigin: "guessed" }],
    ["an empty display name", { displayName: "" }],
  ])("rejects %s", (_label, change) => {
    expect(userDocSchema.safeParse({ ...user, ...change }).success).toBe(false);
  });
});

describe("accessDocSchema", () => {
  it("accepts an unlinked account and a linked member", () => {
    expect(accessDocSchema.parse(access)).toEqual(access);
    const linked = { ...access, member: true, personId: "person-synthetic-1" };
    expect(accessDocSchema.parse(linked)).toEqual(linked);
  });

  it.each([
    ["membership that is not a boolean", { member: "yes" }],
    ["a missing person field", { personId: undefined }],
    ["an empty person identifier", { personId: "" }],
  ])("rejects %s", (_label, change) => {
    expect(accessDocSchema.safeParse({ ...access, ...change }).success).toBe(false);
  });
});

describe("auditEventSchema", () => {
  const event = {
    schemaVersion: 1,
    type: "account.created",
    actor: { kind: "user", uid: "uid-synthetic" },
    targetPath: "access/uid-synthetic",
    details: {},
    idempotencyKey: null,
    occurredAt: now,
  };

  it("accepts an entry made by a user and one made by the system", () => {
    expect(auditEventSchema.parse(event)).toEqual(event);
    expect(auditEventSchema.parse({ ...event, actor: SYSTEM_ACTOR }).actor).toEqual({ kind: "system", id: "system" });
  });

  it.each([
    ["a type that is not in the registry", { type: "something.else" }],
    ["an actor of an unknown kind", { actor: { kind: "robot", id: "r2" } }],
    ["a user actor without an identifier", { actor: { kind: "user" } }],
    ["a system actor with another name", { actor: { kind: "system", id: "root" } }],
    ["an empty target", { targetPath: "" }],
  ])("rejects %s", (_label, change) => {
    expect(auditEventSchema.safeParse({ ...event, ...change }).success).toBe(false);
  });
});
