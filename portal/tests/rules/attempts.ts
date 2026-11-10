// The requests that the matrix makes for one registry entry and one caller, each with the
// answer the registry gives. Nothing here knows the rules file: the expected answers come from
// policy.ts, which reads the registry, and from the fixture of the entry.
// Everything here is synthetic: fictitious accounts, people and studies on the example.org domain.
import type { CollectionEntry, WriteOperation } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import type { Fixture } from "./fixtures";
import { isListable, isReadAcrossParents, type Known, mayRead, mayWrite } from "./policy";
import { fixtureOf, parametersOf, pathOf, placeholderDocument, placeholderIds } from "./seed";
import { actingUid, type CallerProfile, createdBy, firestoreOf, updatedBy } from "./world";

/** The most documents a list of the matrix asks for. */
const LIST_LIMIT = 20;

export interface Attempt {
  /** What the request does, in words, for the report of a failure. */
  readonly operation: string;
  readonly kind: "read" | WriteOperation;
  /** The answer of the registry: whether the request is allowed. */
  readonly expected: boolean;
  /** The path of the document that a write concerns. */
  readonly path: string | null;
  run(): Promise<unknown>;
}

export type Outcome = "allowed" | "denied";

/** Runs a request and says whether the rules allowed it. Any failure other than a refusal is raised. */
export async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run();
    return "allowed";
  } catch (error) {
    if ((error as { code?: string }).code === "permission-denied") return "denied";
    throw error;
  }
}

/**
 * What the path of the collection proves about every document in it. The rules decide a
 * replication or a laboratory from the fields of the document itself, so the only fact a path
 * proves is the user that a subcollection of a user belongs to.
 */
function provenByPath(entry: CollectionEntry, ids: readonly string[]): Known {
  const ancestors = parametersOf(entry).slice(0, -1);
  const index = ancestors.indexOf("uid");
  const ownerUid = index >= 0 && entry.read.scopeFields.includes("{uid}") ? ids[index] : undefined;
  return ownerUid === undefined ? {} : { ownerUid };
}

const withoutStandardFields = (document: Record<string, unknown>): Record<string, unknown> => {
  const {
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    archivedAt: _archivedAt,
    writeContext: _writeContext,
    ...fields
  } = document;
  return fields;
};

/** The identifiers of a sibling of a document: the same ancestors and a new last identifier. */
function siblingIds(ids: readonly string[]): string[] {
  return [...ids.slice(0, -1), `${ids.at(-1) ?? "record"}-new`];
}

/** The path of the collection that holds a document. */
const collectionOf = (documentPath: string) => documentPath.split("/").slice(0, -1).join("/");

function readAttempts(
  environment: RulesTestEnvironment,
  entry: CollectionEntry,
  caller: CallerProfile,
  ids: readonly string[],
  fixture: Fixture | undefined,
): Attempt[] {
  const db = firestoreOf(environment, caller);
  const path = pathOf(entry, ids);
  const container = collection(db, collectionOf(path));
  const subject = fixture?.subject ?? {};
  const read = (operation: string, expected: boolean, run: () => Promise<unknown>): Attempt => ({
    operation,
    kind: "read",
    expected,
    path: null,
    run,
  });
  const attempts = [read("get", mayRead(entry, caller, subject), () => getDoc(doc(db, path)))];

  if (isListable(entry)) {
    const proven = provenByPath(entry, ids);
    attempts.push(
      read("list", mayRead(entry, caller, proven), () => getDocs(query(container, limit(LIST_LIMIT)))),
      // A list that does not say how many documents it asks for is refused to everyone.
      read("list without a limit", false, () => getDocs(container)),
    );
    for (const { where: constraint, proves } of fixture?.listBy ?? []) {
      const [field, operator, value] = constraint;
      attempts.push(
        read(`list where ${field} ${operator} ${String(value)}`, mayRead(entry, caller, { ...proven, ...proves }), () =>
          getDocs(query(container, where(field, operator, value), limit(LIST_LIMIT))),
        ),
      );
    }
  } else {
    // A document with a fixed name is read by its path alone.
    attempts.push(read("list of its collection", false, () => getDocs(query(container, limit(LIST_LIMIT)))));
  }

  if (entry.parent !== null) {
    const constraint = fixture?.listBy?.[0];
    const group = collectionGroup(db, entry.collectionId);
    const expected = isReadAcrossParents(entry) && mayRead(entry, caller, constraint?.proves ?? {});
    attempts.push(
      read("list across parents", expected, () =>
        getDocs(
          constraint === undefined
            ? query(group, limit(LIST_LIMIT))
            : query(group, where(...constraint.where), limit(LIST_LIMIT)),
        ),
      ),
    );
  }
  return attempts;
}

function writeAttempts(
  environment: RulesTestEnvironment,
  entry: CollectionEntry,
  caller: CallerProfile,
  ids: readonly string[],
  fixture: Fixture | undefined,
): Attempt[] {
  const db = firestoreOf(environment, caller);
  const uid = actingUid(caller);
  const path = pathOf(entry, ids);
  const subject = fixture?.subject ?? {};
  const seed = fixture?.seed ?? placeholderDocument();
  const attempts: Attempt[] = [];

  const creation = fixture?.create;
  if (creation !== undefined) {
    const createPath = pathOf(entry, creation.ids);
    attempts.push({
      operation: "create",
      kind: "create",
      expected: mayWrite(entry, "create", caller, creation.subject ?? subject),
      path: createPath,
      run: () => setDoc(doc(db, createPath), { ...creation.data(uid), ...createdBy(uid, entry.flags.appendOnly) }),
    });
  } else if (ids.length > 0) {
    // No client creates a document of this entry: a copy of the stored one, written beside it
    // with the standard fields a client would set, is refused to everyone.
    const createPath = pathOf(entry, siblingIds(ids));
    attempts.push({
      operation: "create",
      kind: "create",
      expected: false,
      path: createPath,
      run: () =>
        setDoc(doc(db, createPath), { ...withoutStandardFields(seed), ...createdBy(uid, entry.flags.appendOnly) }),
    });
  }

  attempts.push(
    {
      operation: "update",
      kind: "update",
      expected: mayWrite(entry, "update", caller, subject),
      path,
      run: () => updateDoc(doc(db, path), { ...(fixture?.update?.(uid) ?? {}), ...updatedBy(uid) }),
    },
    {
      operation: "delete",
      kind: "delete",
      expected: mayWrite(entry, "delete", caller, subject),
      path,
      run: () => deleteDoc(doc(db, path)),
    },
  );
  return attempts;
}

/** Every request of the matrix for one entry and one caller, reads first and the delete last. */
export function attemptsFor(
  environment: RulesTestEnvironment,
  entry: CollectionEntry,
  caller: CallerProfile,
): Attempt[] {
  const fixture = fixtureOf(entry.key);
  const ids = fixture?.ids ?? placeholderIds(entry);
  return [
    ...readAttempts(environment, entry, caller, ids, fixture),
    ...writeAttempts(environment, entry, caller, ids, fixture),
  ];
}
