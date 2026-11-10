// Proves every allow and every deny in portal/firestore.rules.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNTS,
  type Caller,
  createRulesEnvironment,
  firestoreAs,
  SESSIONS_VALID_AFTER_SECONDS,
  seedDocuments,
} from "./support";

let environment: RulesTestEnvironment;

const owner = ACCOUNTS.owner.uid;
const other = ACCOUNTS.other.uid;
const suspended = ACCOUNTS.suspended.uid;
const ended = ACCOUNTS.ended.uid;
const EVERYONE: readonly Caller[] = ["owner", "other", "suspended", "ended", "signedOut"];
const NOT_THE_OWNER: readonly Caller[] = ["other", "suspended", "ended", "signedOut"];

const activeAccess = { member: false, personId: null, suspended: false, sessionsValidAfter: null };

beforeAll(async () => {
  environment = await createRulesEnvironment();
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seedDocuments(environment, {
    [`users/${owner}`]: { emailLower: ACCOUNTS.owner.email, status: "active" },
    [`users/${other}`]: { emailLower: ACCOUNTS.other.email, status: "active" },
    [`users/${suspended}`]: { emailLower: ACCOUNTS.suspended.email, status: "suspended" },
    [`users/${ended}`]: { emailLower: ACCOUNTS.ended.email, status: "active" },
    [`access/${owner}`]: activeAccess,
    [`access/${other}`]: activeAccess,
    [`access/${suspended}`]: { ...activeAccess, suspended: true },
    [`access/${ended}`]: {
      ...activeAccess,
      sessionsValidAfter: Timestamp.fromMillis(SESSIONS_VALID_AFTER_SECONDS * 1000),
    },
    "auditEvents/event-1": { action: "account.created", documentPath: `users/${owner}` },
    "persons/person-1": { displayName: "Synthetic Person" },
  });
});

// users/{uid} and access/{uid} follow the same policy: the owner may read the one document,
// and nobody may list or write from a browser.
describe.each(["users", "access"] as const)("%s/{uid}", (name) => {
  it("allows the owner to read their own document", async () => {
    const snapshot = await assertSucceeds(getDoc(doc(firestoreAs(environment, "owner"), name, owner)));
    expect(snapshot.exists()).toBe(true);
  });

  it("allows the owner to read their own document before it exists", async () => {
    await environment.clearFirestore();
    const snapshot = await assertSucceeds(getDoc(doc(firestoreAs(environment, "owner"), name, owner)));
    expect(snapshot.exists()).toBe(false);
  });

  it.each(NOT_THE_OWNER)("denies a read of someone else's document by: %s", async (caller) => {
    await assertFails(getDoc(doc(firestoreAs(environment, caller), name, owner)));
  });

  it.each(EVERYONE)("denies listing the collection to: %s", async (caller) => {
    await assertFails(getDocs(collection(firestoreAs(environment, caller), name)));
  });

  it("denies the owner a query even when it is narrowed to their own document", async () => {
    const db = firestoreAs(environment, "owner");
    await assertFails(getDocs(query(collection(db, name), where(documentId(), "==", owner))));
  });

  it.each(EVERYONE)("denies creating a document to: %s", async (caller) => {
    await environment.clearFirestore();
    await assertFails(setDoc(doc(firestoreAs(environment, caller), name, owner), { status: "active" }));
  });

  it.each(EVERYONE)("denies updating a document to: %s", async (caller) => {
    await assertFails(updateDoc(doc(firestoreAs(environment, caller), name, owner), { status: "suspended" }));
  });

  it.each(EVERYONE)("denies deleting a document to: %s", async (caller) => {
    await assertFails(deleteDoc(doc(firestoreAs(environment, caller), name, owner)));
  });

  it("denies reads and writes below the document", async () => {
    const nested = doc(firestoreAs(environment, "owner"), name, owner, "private", "note");
    await assertFails(getDoc(nested));
    await assertFails(setDoc(nested, { text: "x" }));
  });
});

describe("access/{uid}", () => {
  it("denies an account granting itself membership", async () => {
    const db = firestoreAs(environment, "owner");
    await assertFails(updateDoc(doc(db, "access", owner), { member: true }));
    await assertFails(setDoc(doc(db, "access", owner), { member: true, personId: "person-1" }));
  });

  it("denies a suspended account lifting its own suspension", async () => {
    const db = firestoreAs(environment, "suspended");
    await assertFails(updateDoc(doc(db, "access", suspended), { suspended: false }));
    await assertFails(setDoc(doc(db, "access", suspended), activeAccess));
    await assertFails(deleteDoc(doc(db, "access", suspended)));
  });

  it("denies an account moving the instant from which its sessions are valid", async () => {
    const db = firestoreAs(environment, "ended");
    await assertFails(updateDoc(doc(db, "access", ended), { sessionsValidAfter: null }));
    await assertFails(deleteDoc(doc(db, "access", ended)));
  });
});

// A suspended account, and a session that began before the account's sessions were ended, are
// refused everything, including the documents the account owns.
describe("an account that may not act", () => {
  it.each(["users", "access"] as const)("denies a suspended account its own %s document", async (name) => {
    await assertFails(getDoc(doc(firestoreAs(environment, "suspended"), name, suspended)));
  });

  it.each(["users", "access"] as const)("denies an ended session its own %s document", async (name) => {
    await assertFails(getDoc(doc(firestoreAs(environment, "ended"), name, ended)));
  });

  it.each(["users", "access"] as const)(
    "allows the same account its own %s document once it has signed in again",
    async (name) => {
      const snapshot = await assertSucceeds(getDoc(doc(firestoreAs(environment, "renewed"), name, ended)));
      expect(snapshot.exists()).toBe(true);
    },
  );

  it("allows the account again as soon as trusted code lifts the suspension, with the same sign-in", async () => {
    const db = firestoreAs(environment, "suspended");
    await assertFails(getDoc(doc(db, "users", suspended)));
    await seedDocuments(environment, { [`access/${suspended}`]: activeAccess });
    await assertSucceeds(getDoc(doc(db, "users", suspended)));
  });

  it("refuses an account on its next request once trusted code suspends it, with the same sign-in", async () => {
    const db = firestoreAs(environment, "owner");
    await assertSucceeds(getDoc(doc(db, "users", owner)));
    await seedDocuments(environment, { [`access/${owner}`]: { ...activeAccess, suspended: true } });
    await assertFails(getDoc(doc(db, "users", owner)));
    await assertFails(getDoc(doc(db, "access", owner)));
  });

  it("treats an access document without the two fields as active, so an older document locks nobody out", async () => {
    await seedDocuments(environment, { [`access/${owner}`]: { member: false, personId: null } });
    await assertSucceeds(getDoc(doc(firestoreAs(environment, "owner"), "access", owner)));
  });
});

describe("auditEvents/{eventId}", () => {
  it.each(EVERYONE)("denies reading an entry to: %s", async (caller) => {
    await assertFails(getDoc(doc(firestoreAs(environment, caller), "auditEvents", "event-1")));
  });

  it.each(EVERYONE)("denies listing entries to: %s", async (caller) => {
    await assertFails(getDocs(collection(firestoreAs(environment, caller), "auditEvents")));
  });

  it.each(EVERYONE)("denies creating an entry to: %s", async (caller) => {
    const entry = doc(firestoreAs(environment, caller), "auditEvents", "event-2");
    await assertFails(setDoc(entry, { action: "account.created" }));
  });

  it.each(EVERYONE)("denies changing or deleting an entry to: %s", async (caller) => {
    const entry = doc(firestoreAs(environment, caller), "auditEvents", "event-1");
    await assertFails(updateDoc(entry, { action: "forged" }));
    await assertFails(deleteDoc(entry));
  });
});

describe("every other path", () => {
  it.each(EVERYONE)("denies reading a collection that has no rule to: %s", async (caller) => {
    const db = firestoreAs(environment, caller);
    await assertFails(getDoc(doc(db, "persons", "person-1")));
    await assertFails(getDocs(collection(db, "persons")));
  });

  it.each(EVERYONE)("denies writing to a collection that has no rule to: %s", async (caller) => {
    const db = firestoreAs(environment, caller);
    await assertFails(setDoc(doc(db, "persons", "person-2"), { displayName: "Synthetic Person" }));
    await assertFails(setDoc(doc(db, "anything", "at-all"), { value: 1 }));
  });
});
