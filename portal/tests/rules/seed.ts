// Writes the synthetic world of the security-rules tests into the Firestore emulator, with the
// rules switched off, as trusted code would.
// Everything here is synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  COLLECTION_ENTRIES,
  type CollectionEntry,
  type CollectionKey,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  PROGRAMME_SCOPE_KEY,
  replicationScopeKey,
  userScopeKey,
} from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, type Firestore, getDoc, setDoc } from "firebase/firestore";
import { FIXTURES, type Fixture, SUPPORTING_DOCUMENTS } from "./fixtures";
import {
  accessDocuments,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  stored,
} from "./world";

type PathBuilder = (...ids: readonly string[]) => string;

/** The path of a document of an entry. */
export function pathOf(entry: CollectionEntry, ids: readonly string[]): string {
  return (entry.docPath as PathBuilder)(...ids);
}

/** The names of the parameters of the path of an entry, in order. */
export function parametersOf(entry: CollectionEntry): string[] {
  return [...entry.path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1] ?? "");
}

export function fixtureOf(key: string): Fixture | undefined {
  return FIXTURES[key as CollectionKey];
}

const KNOWN_PARENTS: Readonly<Record<string, string>> = {
  uid: OWNER_UID,
  personId: OWNER_PERSON,
  laboratoryId: OWN_LABORATORY,
  studyKey: OWN_REPLICATION,
  participationId: OWN_PARTICIPATION,
};

/**
 * The identifiers of the document that stands for an entry whose rules are not written yet. A
 * parameter that names a record of the world takes that record, so that such a document sits
 * beneath a parent that exists.
 */
export function placeholderIds(entry: CollectionEntry): string[] {
  return parametersOf(entry).map((name) => KNOWN_PARENTS[name] ?? "record-1");
}

/**
 * A document for an entry whose rules are not written yet. It names the owner, the owning units
 * and every scope a caller could hold, so that nothing about its content is the reason a read is
 * refused.
 */
export function placeholderDocument(): Record<string, unknown> {
  const everyScope = [
    MEMBERS_SCOPE_KEY,
    PROGRAMME_SCOPE_KEY,
    replicationScopeKey(OWN_REPLICATION),
    laboratoryScopeKey(OWN_LABORATORY),
    userScopeKey(OWNER_UID),
  ];
  return {
    ...stored(),
    uid: OWNER_UID,
    ownerUid: OWNER_UID,
    authorUid: OWNER_UID,
    assigneeUids: [OWNER_UID],
    isShared: true,
    replicationId: OWN_REPLICATION,
    laboratoryId: OWN_LABORATORY,
    scopeKeys: everyScope,
    levelKeys: { comment: everyScope, edit: everyScope, full: everyScope },
  };
}

/** Every document of the world, by path. */
export function worldDocuments(): Record<string, Record<string, unknown>> {
  const documents: Record<string, Record<string, unknown>> = { ...accessDocuments(), ...SUPPORTING_DOCUMENTS };
  for (const entry of COLLECTION_ENTRIES) {
    const fixture = fixtureOf(entry.key);
    if (fixture !== undefined) documents[pathOf(entry, fixture.ids)] = fixture.seed;
    else documents[pathOf(entry, placeholderIds(entry))] = placeholderDocument();
  }
  return documents;
}

/** Runs with the rules switched off, as trusted code would. */
export async function trusted<T>(environment: RulesTestEnvironment, run: (db: Firestore) => Promise<T>): Promise<T> {
  const results: T[] = [];
  await environment.withSecurityRulesDisabled(async (context) => {
    results.push(await run(context.firestore() as unknown as Firestore));
  });
  return results[0] as T;
}

/** Clears the database and writes the whole world. */
export async function seedWorld(environment: RulesTestEnvironment): Promise<void> {
  await environment.clearFirestore();
  const documents = Object.entries(worldDocuments());
  await trusted(environment, async (db) => {
    await Promise.all(documents.map(([path, data]) => setDoc(doc(db, path), data)));
  });
}

/** Puts documents back as they were stored, and removes the ones a test created. */
export async function restoreDocuments(
  environment: RulesTestEnvironment,
  stored: Readonly<Record<string, Record<string, unknown>>>,
  created: readonly string[],
): Promise<void> {
  await trusted(environment, async (db) => {
    await Promise.all([
      ...Object.entries(stored).map(([path, data]) => setDoc(doc(db, path), data)),
      ...created.map((path) => deleteDoc(doc(db, path))),
    ]);
  });
}

/** A document as it is stored, read with the rules switched off, or null when there is none. */
export function storedDocument(
  environment: RulesTestEnvironment,
  path: string,
): Promise<Record<string, unknown> | null> {
  return trusted(environment, async (db) => (await getDoc(doc(db, path))).data() ?? null);
}
