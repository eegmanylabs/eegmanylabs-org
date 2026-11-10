// Integration tests of notifications, run against the emulators: a function writes one, and its
// owner reads it and marks it as read directly, under the security rules. No function is needed
// for that.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import { setRoleAssignmentContract, userNotificationDocSchema, userWriteContext } from "@eegml/shared";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, signInWithEmailLinkFromEmulator, type TestClient } from "../support/client";
import { HOST, PORTS } from "../support/emulators";
import {
  accessOf,
  account,
  administrator,
  call,
  laboratory,
  leaveNoTrace,
  notificationsOf,
  resetWorld,
} from "./support";

const clients: TestClient[] = [];

beforeEach(resetWorld);

afterAll(async () => {
  await leaveNoTrace();
  await Promise.all(clients.map((client) => client.close()));
});

/** An account signed in through the Authentication emulator, with the Firestore of the web SDK. */
async function signedIn(email: string) {
  const client = createTestClient();
  clients.push(client);
  const user = await signInWithEmailLinkFromEmulator(client, email);
  const db = getFirestore(client.app);
  connectFirestoreEmulator(db, HOST, PORTS.firestore);
  return { uid: user.uid, db };
}

describe("a notification that a function wrote", () => {
  it("is read by its owner, who marks it as read under the security rules and changes nothing else", async () => {
    const owner = await signedIn("notified.member@example.org");
    const other = await signedIn("another.member@example.org");
    await laboratory("lab-a");
    await account(owner.uid, { email: "notified.member@example.org" });
    await account(other.uid, { email: "another.member@example.org" });
    const admin = await administrator("uid-admin");

    // A function grants the owner a role, which makes the account a member, and notifies it.
    await call(admin, setRoleAssignmentContract, {
      action: "grant",
      uid: owner.uid,
      role: "lab_member",
      scopeType: "laboratory",
      scopeId: "lab-a",
    });
    expect((await accessOf(owner.uid)).member).toBe(true);

    const listed = await getDocs(query(collection(owner.db, `users/${owner.uid}/notifications`), limit(20)));
    expect(listed.size).toBe(1);
    const notification = listed.docs[0];
    expect(userNotificationDocSchema.parse(notification?.data())).toMatchObject({
      uid: owner.uid,
      type: "roleDecision",
      entityType: "user",
      entityId: owner.uid,
      payload: { kind: "roleGranted", role: "lab_member", scopeType: "laboratory", scopeId: "lab-a" },
      readAt: null,
      emailedAt: null,
      createdBy: "uid-admin",
    });

    const reference = doc(owner.db, `users/${owner.uid}/notifications/${notification?.id}`);
    const stamp = { updatedAt: serverTimestamp(), updatedBy: owner.uid, writeContext: userWriteContext() };
    await updateDoc(reference, { readAt: serverTimestamp(), ...stamp });
    const [stored] = await notificationsOf(owner.uid);
    expect(stored?.readAt).not.toBeNull();
    expect(stored?.readAt?.toMillis()).toBe(stored?.updatedAt.toMillis());
    // Back to unread works the same way.
    await updateDoc(reference, { readAt: null, ...stamp });
    expect((await notificationsOf(owner.uid))[0]?.readAt).toBeNull();

    // The owner changes nothing but that, and nobody else reads or writes the notification.
    await expect(updateDoc(reference, { payload: { kind: "roleRevoked" }, ...stamp })).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(updateDoc(reference, { type: "mention", ...stamp })).rejects.toMatchObject({
      code: "permission-denied",
    });
    const foreign = doc(other.db, `users/${owner.uid}/notifications/${notification?.id}`);
    await expect(getDoc(foreign)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      updateDoc(foreign, { readAt: serverTimestamp(), ...stamp, updatedBy: other.uid }),
    ).rejects.toMatchObject({
      code: "permission-denied",
    });
  });
});
