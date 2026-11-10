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
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCOUNTS, type Caller, createRulesEnvironment, firestoreAs, seedDocuments } from "./support";

let environment: RulesTestEnvironment;

const owner = ACCOUNTS.owner.uid;
const other = ACCOUNTS.other.uid;
const EVERYONE: readonly Caller[] = ["owner", "other", "signedOut"];
const NOT_THE_OWNER: readonly Caller[] = ["other", "signedOut"];

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
    [`access/${owner}`]: { member: false, personId: null },
    [`access/${other}`]: { member: false, personId: null },
    "auditEvents/event-1": { type: "account.created", targetPath: `access/${owner}` },
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
    await assertFails(setDoc(entry, { type: "account.created" }));
  });

  it.each(EVERYONE)("denies changing or deleting an entry to: %s", async (caller) => {
    const entry = doc(firestoreAs(environment, caller), "auditEvents", "event-1");
    await assertFails(updateDoc(entry, { type: "forged" }));
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
