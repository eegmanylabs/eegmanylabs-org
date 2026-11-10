// Integration tests for the sessionStart function, run against the emulators.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import {
  accessDocSchema,
  auditEventSchema,
  DISPLAY_NAME_MAX_LENGTH,
  isPublicErrorDetails,
  sessionStartContract,
  userDocSchema,
  userWriteContext,
} from "@eegml/shared";
import { updateProfile } from "firebase/auth";
import { Timestamp } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAST_SEEN_RESOLUTION_MS } from "../../functions/src/callables/sessionStart";
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
const userDocument = (uid: string) => adminDb.doc(`users/${uid}`);
const accessDocument = (uid: string) => adminDb.doc(`access/${uid}`);

/** The rejection of a call, as the web SDK reports it. */
async function failureOf(promise: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await promise;
  } catch (error) {
    const { code, message, details } = error as { code: string; message: string; details: unknown };
    return { code, message, details };
  }
  throw new Error("The call was expected to fail and it succeeded.");
}

describe("sessionStart", () => {
  it("refuses a caller who is not signed in", async () => {
    expect(await errorCodeOf(client.call(sessionStartContract, {}))).toBe("functions/unauthenticated");
    expect((await adminDb.collection("users").get()).size).toBe(0);
  });

  it("registers a new account with no membership and records one audit entry", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "First.Visitor@example.org");

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });

    const eventId = auditEventId(`account.created:${user.uid}`);
    const standard = {
      schemaVersion: 1,
      createdBy: user.uid,
      updatedBy: user.uid,
      archivedAt: null,
      // Both documents name the audit entry that was written with them.
      writeContext: userWriteContext(eventId),
    };

    const stored = userDocSchema.parse((await userDocument(user.uid).get()).data());
    expect(stored).toMatchObject({
      ...standard,
      emailLower: "first.visitor@example.org",
      displayName: null,
      personId: null,
      status: "active",
      mfaEnrolled: false,
      dataOrigin: "live",
    });

    const access = accessDocSchema.parse((await accessDocument(user.uid).get()).data());
    expect(access).toMatchObject({
      ...standard,
      member: false,
      personId: null,
      suspended: false,
      sessionsValidAfter: null,
    });
    expect(access).not.toHaveProperty("dataOrigin");

    const events = await auditEvents();
    expect(events.size).toBe(1);
    const [event] = events.docs;
    expect(event?.id).toBe(eventId);
    const entry = auditEventSchema.parse(event?.data());
    expect(entry).toMatchObject({
      createdBy: user.uid,
      actorUid: user.uid,
      actorKind: "user",
      action: "account.created",
      documentPath: `users/${user.uid}`,
      entityType: "user",
      entityId: user.uid,
      context: { origin: "user", depth: 0 },
      writeContext: userWriteContext(eventId),
    });
    // The profile is readable by its owner only, so the entry names the fields and no value.
    expect(entry.changes.length).toBeGreaterThan(0);
    for (const change of entry.changes) expect(change).toEqual({ field: change.field, withheld: true });
    expect(JSON.stringify(event?.data())).not.toContain("first.visitor");

    // One instant for everything the call wrote.
    const instants = [stored.createdAt, stored.updatedAt, stored.lastSeenAt, access.createdAt, entry.createdAt];
    expect(new Set(instants.map((instant) => instant.toMillis())).size).toBe(1);
  });

  it("registers an account once, however many calls arrive at the same moment", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "impatient.visitor@example.org");

    const answers = await Promise.all(Array.from({ length: 8 }, () => client.call(sessionStartContract, {})));

    expect(answers).toEqual(Array.from({ length: 8 }, () => ({ member: false, personId: null })));
    expect((await auditEvents()).size).toBe(1);
    expect((await userDocument(user.uid).get()).exists).toBe(true);
  });

  it("writes nothing on a later call while the account was last seen a moment ago", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "reloading.visitor@example.org");
    await client.call(sessionStartContract, {});
    const userBefore = await userDocument(user.uid).get();
    const accessBefore = await accessDocument(user.uid).get();

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });

    const userAfter = await userDocument(user.uid).get();
    const accessAfter = await accessDocument(user.uid).get();
    expect(userAfter.updateTime?.isEqual(userBefore.updateTime as Timestamp)).toBe(true);
    expect(accessAfter.updateTime?.isEqual(accessBefore.updateTime as Timestamp)).toBe(true);
    expect((await auditEvents()).size).toBe(1);
  });

  it("on a later call records when the account was last seen once the stored time is old, and nothing else", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "returning.visitor@example.org");
    await client.call(sessionStartContract, {});
    const longAgo = Timestamp.fromMillis(Date.now() - LAST_SEEN_RESOLUTION_MS - 60_000);
    await userDocument(user.uid).update({ lastSeenAt: longAgo, updatedAt: longAgo });
    const userBefore = await userDocument(user.uid).get();
    const accessBefore = await accessDocument(user.uid).get();

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });

    const userAfter = userDocSchema.parse((await userDocument(user.uid).get()).data());
    expect(userAfter.lastSeenAt.toMillis()).toBeGreaterThan(longAgo.toMillis());
    expect(userAfter.updatedAt.toMillis()).toBe(userAfter.lastSeenAt.toMillis());
    expect(userAfter.updatedBy).toBe(user.uid);
    // A write that no audit entry records says so.
    expect(userAfter.writeContext).toEqual(userWriteContext(null));
    expect(userAfter.createdAt.toMillis()).toBe(userBefore.get("createdAt").toMillis());
    expect(userAfter).toMatchObject({ emailLower: "returning.visitor@example.org", status: "active", personId: null });
    const accessAfter = await accessDocument(user.uid).get();
    expect(accessAfter.updateTime?.isEqual(accessBefore.updateTime as Timestamp)).toBe(true);
    expect((await auditEvents()).size).toBe(1);
  });

  it("never overwrites an access document that already exists", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "linked.member@example.org");
    const earlier = Timestamp.fromMillis(1_700_000_000_000);
    const existing = {
      schemaVersion: 1,
      createdAt: earlier,
      updatedAt: earlier,
      createdBy: "system:claims",
      updatedBy: "system:claims",
      archivedAt: null,
      writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
      member: true,
      personId: "person-synthetic-1",
      suspended: false,
      sessionsValidAfter: null,
    };
    await accessDocument(user.uid).set(existing);
    const before = await accessDocument(user.uid).get();

    expect(await client.call(sessionStartContract, {})).toEqual({ member: true, personId: "person-synthetic-1" });

    const after = await accessDocument(user.uid).get();
    expect(after.data()).toEqual(existing);
    expect(after.updateTime?.isEqual(before.updateTime as Timestamp)).toBe(true);
    // The access document was not created by this call, so there is nothing to record.
    expect((await auditEvents()).size).toBe(0);
    // The new profile takes the link from the access document, which is the authority.
    expect((await userDocument(user.uid).get()).get("personId")).toBe("person-synthetic-1");
  });

  it("refuses an account whose email address is not verified", async () => {
    const user = await signUpWithUnverifiedEmail(client, "unverified.account@example.org");

    const failure = await failureOf(client.call(sessionStartContract, {}));
    expect(failure.code).toBe("functions/failed-precondition");
    expect(failure.message).toContain("A verified email address is needed");
    expect(isPublicErrorDetails(failure.details)).toBe(true);

    expect((await userDocument(user.uid).get()).exists).toBe(false);
    expect((await accessDocument(user.uid).get()).exists).toBe(false);
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

describe("sessionStart for an account that may not act", () => {
  it("refuses a suspended account, says what to do next and writes nothing", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "suspended.account@example.org");
    await client.call(sessionStartContract, {});
    await accessDocument(user.uid).update({ suspended: true });
    await userDocument(user.uid).update({ status: "suspended" });
    const before = await userDocument(user.uid).get();

    const failure = await failureOf(client.call(sessionStartContract, {}));

    expect(failure.code).toBe("functions/permission-denied");
    expect(failure.message).toContain("This account has been suspended. Contact a programme administrator.");
    expect(isPublicErrorDetails(failure.details)).toBe(true);
    const after = await userDocument(user.uid).get();
    expect(after.get("status")).toBe("suspended");
    expect(after.updateTime?.isEqual(before.updateTime as Timestamp)).toBe(true);
  });

  it("refuses when only the profile says that the account is suspended", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "half.suspended@example.org");
    await client.call(sessionStartContract, {});
    await userDocument(user.uid).update({ status: "suspended" });

    expect(await errorCodeOf(client.call(sessionStartContract, {}))).toBe("functions/permission-denied");
    expect((await userDocument(user.uid).get()).get("status")).toBe("suspended");
  });

  it("serves the account again once the suspension is lifted", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "reinstated.account@example.org");
    await client.call(sessionStartContract, {});
    await accessDocument(user.uid).update({ suspended: true });
    expect(await errorCodeOf(client.call(sessionStartContract, {}))).toBe("functions/permission-denied");

    await accessDocument(user.uid).update({ suspended: false });

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });
  });

  it("refuses a session that began before the account's sessions were ended, and accepts a new sign-in", async () => {
    const email = "ended.session@example.org";
    const user = await signInWithEmailLinkFromEmulator(client, email);
    await client.call(sessionStartContract, {});
    const signedInAt = Number((await user.getIdTokenResult()).claims.auth_time);
    // Sessions are valid from the next whole second, so this one is not and the next one is.
    const boundary = (signedInAt + 1) * 1000;
    await accessDocument(user.uid).update({ sessionsValidAfter: Timestamp.fromMillis(boundary) });

    const failure = await failureOf(client.call(sessionStartContract, {}));
    expect(failure.code).toBe("functions/unauthenticated");
    expect(failure.message).toContain("This session has been ended. Sign in again to continue.");

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, boundary - Date.now()) + 50));
    await signInWithEmailLinkFromEmulator(client, email);
    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });
  });
});

// Any signed-in account can put any text in the name of its own sign-in token.
describe("sessionStart and the name an account gives itself", () => {
  const tooLong = "N".repeat(5_000);

  async function nameItself(client: TestClient, displayName: string): Promise<void> {
    const user = client.auth.currentUser;
    if (!user) throw new Error("Nobody is signed in.");
    await updateProfile(user, { displayName });
    // The name reaches the function in the token, so the token has to be issued again.
    await user.getIdToken(true);
  }

  it("registers an account whose name is far too long, with the name cut to the stored maximum", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "long.name.first@example.org");
    await nameItself(client, tooLong);

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });

    const stored = userDocSchema.parse((await userDocument(user.uid).get()).data());
    expect(stored.displayName).toBe("N".repeat(DISPLAY_NAME_MAX_LENGTH));
  });

  it("keeps the stored profile valid when a registered account changes its name to one that is far too long", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "long.name.later@example.org");
    await client.call(sessionStartContract, {});
    await nameItself(client, tooLong);

    expect(await client.call(sessionStartContract, {})).toEqual({ member: false, personId: null });

    const stored = userDocSchema.parse((await userDocument(user.uid).get()).data());
    expect(stored.displayName).toBe("N".repeat(DISPLAY_NAME_MAX_LENGTH));
  });

  it("stores the name without control characters, text-direction overrides or surplus white space", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "odd.name@example.org");
    await nameItself(client, "  Synthetic\u0000   Person‮\n ");

    await client.call(sessionStartContract, {});

    expect((await userDocument(user.uid).get()).get("displayName")).toBe("Synthetic Person");
  });

  it("keeps the stored name when the token carries none", async () => {
    const user = await signInWithEmailLinkFromEmulator(client, "named.account@example.org");
    await nameItself(client, "Synthetic Person");
    await client.call(sessionStartContract, {});
    await nameItself(client, "");

    await client.call(sessionStartContract, {});

    expect((await userDocument(user.uid).get()).get("displayName")).toBe("Synthetic Person");
  });
});
