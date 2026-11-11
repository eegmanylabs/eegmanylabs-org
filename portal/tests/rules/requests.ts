// Requests as the hand-written rules tests make them: one line for each read and each write,
// and one assertion for a whole table of them, so that a test reads as a list of what is
// accepted and what is refused.
// Everything here is synthetic: fictitious accounts on the example.org domain.

import { COLLECTION_ENTRIES, entryOfDocumentPath, isAutoId } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  type QueryConstraint,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { expect } from "vitest";
import { type Outcome, outcomeOf } from "./attempts";
import { actingUid, CALLERS, type CallerKind, createdBy, firestoreOf, updatedBy } from "./world";

type Request = () => Promise<unknown>;

/** A table of requests, each with the answer the rules must give. */
export type Expectations = Readonly<Record<string, readonly [expected: Outcome, request: Request]>>;

/** Makes every request of a table in order and fails with the labels of those that were answered wrongly. */
export async function expectOutcomes(expectations: Expectations): Promise<void> {
  const wrong: string[] = [];
  for (const [label, [expected, request]] of Object.entries(expectations)) {
    const outcome = await outcomeOf(request);
    if (outcome !== expected) wrong.push(`${label}: ${outcome}`);
  }
  expect(wrong).toEqual([]);
}

/**
 * The paths of the collections in which a client creates documents under an identifier that
 * Firestore generates, as patterns.
 */
const OPAQUE_PATHS = COLLECTION_ENTRIES.filter(
  (entry) =>
    entry.enforcement === "enforced" &&
    entry.identifier.kind === "auto" &&
    entry.write.mode === "client" &&
    entry.write.grants.some((grant) => grant.operations.includes("create")),
).map((entry) => new RegExp(`^${entry.path.replace(/\{[^{}]+\}/g, "[^/]+")}$`));

/**
 * Stops a test that creates a record under a readable name where the rules accept only an
 * identifier that Firestore generated. Such a request is refused for its identifier, whatever
 * else is right or wrong with it, so the test would prove nothing about what it means to prove.
 * A test names a new record with `autoId`. A test that attacks the identifier itself says so by
 * creating the document with `createAt`.
 */
export function assertGeneratedIdentifier(path: string): void {
  const identifier = path.split("/").at(-1) ?? "";
  if (OPAQUE_PATHS.some((pattern) => pattern.test(path)) && !isAutoId(identifier)) {
    throw new Error(
      `The test creates ${path}, whose identifier is opaque. Name the document with autoId("${identifier}"), ` +
        "or use createAt where the identifier itself is under attack.",
    );
  }
}

/** A caller of the world, or a Firestore client that a test made with a token of its own. */
export type Actor = CallerKind | { readonly db: Firestore; readonly uid: string };

export interface Requests {
  get(actor: Actor, path: string): Request;
  list(actor: Actor, collectionPath: string, ...constraints: QueryConstraint[]): Request;
  listAcrossParents(actor: Actor, collectionId: string, ...constraints: QueryConstraint[]): Request;
  /** Creates a document with the standard fields a client sets, under an identifier that Firestore could have generated. */
  create(actor: Actor, path: string, data: Record<string, unknown>, appendOnly?: boolean): Request;
  /** Creates a document under an identifier of the caller's own choosing, which is what an attack on identifiers does. */
  createAt(actor: Actor, path: string, data: Record<string, unknown>): Request;
  /** Changes a document, with the standard fields a client sets. */
  update(actor: Actor, path: string, patch: Record<string, unknown>): Request;
  remove(actor: Actor, path: string): Request;
}

export function requestsOf(environment: () => RulesTestEnvironment): Requests {
  const dbOf = (actor: Actor) => (typeof actor === "string" ? firestoreOf(environment(), CALLERS[actor]) : actor.db);
  const uidOf = (actor: Actor) => (typeof actor === "string" ? actingUid(CALLERS[actor]) : actor.uid);
  return {
    get: (actor, path) => () => getDoc(doc(dbOf(actor), path)),
    list:
      (actor, collectionPath, ...constraints) =>
      () =>
        getDocs(query(collection(dbOf(actor), collectionPath), ...constraints)),
    listAcrossParents:
      (actor, collectionId, ...constraints) =>
      () =>
        getDocs(query(collectionGroup(dbOf(actor), collectionId), ...constraints)),
    create: (actor, path, data, appendOnly = false) => {
      assertGeneratedIdentifier(path);
      return () => setDoc(doc(dbOf(actor), path), { ...data, ...createdBy(uidOf(actor), appendOnly) });
    },
    createAt: (actor, path, data) => () =>
      setDoc(doc(dbOf(actor), path), {
        ...data,
        ...createdBy(uidOf(actor), entryOfDocumentPath(path)?.entry.flags.appendOnly ?? false),
      }),
    update: (actor, path, patch) => () => updateDoc(doc(dbOf(actor), path), { ...patch, ...updatedBy(uidOf(actor)) }),
    remove: (actor, path) => () => deleteDoc(doc(dbOf(actor), path)),
  };
}
