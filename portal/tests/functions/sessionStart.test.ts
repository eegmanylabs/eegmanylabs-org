// Integration tests for the sessionStart function, run against the emulators.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import { accessDocSchema, auditEventSchema, sessionStartContract, userDocSchema } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditEventId } from "../../functions/src/framework/audit";
import { adminDb } from "../support/admin";
import {
  createTestClient,
  errorCodeOf,
  signInWithEmailLinkFromEmulator,
  signUpWithUnverifiedEmail,
  type TestClient,
} from "../support/client";
import { clearAuth, clearFirestore } from "../support/emulators";

let client: TestClient;

beforeEach(async () => {
  await Promise.all([clearFirestore(), clearAuth()]);
  client = createTestClient();
});

afterEach(async () => {
  await client.close();
});

const auditEvents = () => adminDb.collection("auditEvents").get();

describe("sessionStart", () => {
  it("refuses a caller who is not signed in", async () => {
    expect(await errorCodeOf(client.call(sessionStartContract, {}))).toBe("functions/unauthenticated");
    expect((await adminDb.collection("users").get()).size).toBe(0);
  });

  it("registers a new account with no membership and records one audit entry", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "First.Visitor@example.org");

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });

    const stored = userDocSchema.parse((await adminDb.doc(`users/${user.uid}`).get()).data());
    expect(stored).toMatchObject({
      schemaVersion: 1,
      emailLower: "first.visitor@example.org",
      displayName: null,
      status: "active",
      dataOrigin: "live",
    });
    expect(stored.lastSeenAt.toMillis()).toBe(stored.createdAt.toMillis());

    const access = accessDocSchema.parse((await adminDb.doc(`access/${user.uid}`).get()).data());
    expect(access).toMatchObject({ schemaVersion: 1, member: false, personId: null, dataOrigin: "live" });

    const events = await auditEvents();
    expect(events.size).toBe(1);
    const [event] = events.docs;
    expect(event?.id).toBe(auditEventId(`account.created:${user.uid}`));
    expect(auditEventSchema.parse(event?.data())).toMatchObject({
      type: "account.created",
      actor: { kind: "user", uid: user.uid },
      targetPath: `access/${user.uid}`,
      idempotencyKey: `account.created:${user.uid}`,
    });
  });

  it("on a later call updates when the account was last seen and nothing else", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "returning.visitor@example.org");
    await client.call(sessionStartContract, {});
    const userBefore = await adminDb.doc(`users/${user.uid}`).get();
    const accessBefore = await adminDb.doc(`access/${user.uid}`).get();
    // Timestamps have millisecond resolution here: make sure the second call is measurably later.
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });

    const userAfter = await adminDb.doc(`users/${user.uid}`).get();
    const accessAfter = await adminDb.doc(`access/${user.uid}`).get();
    expect(userAfter.get("createdAt").toMillis()).toBe(userBefore.get("createdAt").toMillis());
    expect(userAfter.get("lastSeenAt").toMillis()).toBeGreaterThan(userBefore.get("lastSeenAt").toMillis());
    expect(accessAfter.updateTime?.isEqual(accessBefore.updateTime as Timestamp)).toBe(true);
    expect((await auditEvents()).size).toBe(1);
  });

  it("never overwrites an access document that already exists", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "linked.member@example.org");
    const existing = {
      schemaVersion: 1,
      member: true,
      personId: "person-synthetic-1",
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      dataOrigin: "demo",
    };
    await adminDb.doc(`access/${user.uid}`).set(existing);
    const before = await adminDb.doc(`access/${user.uid}`).get();

    expect(await client.call(sessionStartContract, {})).toEqual({ member: true, personId: "person-synthetic-1" });

    const after = await adminDb.doc(`access/${user.uid}`).get();
    expect(after.data()).toEqual(existing);
    expect(after.updateTime?.isEqual(before.updateTime as Timestamp)).toBe(true);
    // The access document was not created by this call, so there is nothing to record.
    expect((await auditEvents()).size).toBe(0);
  });

  it("does not lift a suspension when the account signs in again", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "suspended.account@example.org");
    await client.call(sessionStartContract, {});
    await adminDb.doc(`users/${user.uid}`).update({ status: "suspended" });

    await client.call(sessionStartContract, {});

    expect((await adminDb.doc(`users/${user.uid}`).get()).get("status")).toBe("suspended");
  });

  it("refuses an account whose email address is not verified", async () => {
    const user = await signUpWithUnverifiedEmail(client, "unverified.account@example.org");

    expect(await errorCodeOf(client.call(sessionStartContract, {}))).toBe("functions/failed-precondition");

    expect((await adminDb.doc(`users/${user.uid}`).get()).exists).toBe(false);
    expect((await adminDb.doc(`access/${user.uid}`).get()).exists).toBe(false);
  });

  it.each([
    ["an unexpected field", { uid: "someone-else" }],
    ["no data at all", null],
    ["a value that is not an object", "x"],
  ])("refuses a call that carries %s", async (_label, data) => {
    await signInWithEmailLinkFromEmulator(client, "curious.caller@example.org");
    expect(await errorCodeOf(client.callRaw("sessionStart", data))).toBe("functions/invalid-argument");
    expect((await adminDb.collection("users").get()).size).toBe(0);
  });
});
