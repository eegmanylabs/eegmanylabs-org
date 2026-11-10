// Helpers shared by the integration tests of the import framework. They run the importers
// against the Firestore emulator with synthetic fixtures: every name in those fixtures is
// invented and every address is on example.org.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COLLECTION_ENTRIES, COLLECTIONS } from "@eegml/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { seedLookups } from "../../tools/src/commands/seed-lookups";
import type { ImporterDefinition } from "../../tools/src/import/model";
import { type RunReport, runImport } from "../../tools/src/import/run";
import { verifyImport } from "../../tools/src/import/verify";
import { adminDb } from "../support/admin";
import { clearFirestore, PROJECT_ID } from "../support/emulators";

/** The key of the keyed hash in tests. It protects nothing, because every value hashed with it is invented. */
export const TEST_HASH_KEY = "a-synthetic-hash-key-for-the-import-tests";

export const OBSERVED_ON = "2026-11-09";

/** An empty database with the lookup data that the importers rely on. */
export async function freshDatabase(): Promise<void> {
  await clearFirestore();
  await seedLookups(adminDb, PROJECT_ID);
}

const temporary: string[] = [];

/** A directory of its own for the files of one test. `removeTemporaryDirectories` removes them all. */
export function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "eegml-import-"));
  temporary.push(directory);
  return directory;
}

export function removeTemporaryDirectories(): void {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
}

let clock = Date.UTC(2026, 10, 9, 12, 0, 0);

/** An instant later than every earlier one, so that each run of a test has a batch identifier of its own. */
export function nextInstant(): Date {
  clock += 60_000;
  return new Date(clock);
}

export function run(
  importer: ImporterDefinition,
  inputPath: string,
  mode: "preview" | "apply",
  extra: { readonly previewBatchId?: string } = {},
): Promise<RunReport> {
  return runImport({
    db: adminDb,
    importer,
    input: { path: inputPath, observedOn: OBSERVED_ON },
    mode,
    secret: TEST_HASH_KEY,
    now: nextInstant(),
    ...extra,
  });
}

export function verify(importer: ImporterDefinition, inputPath: string) {
  return verifyImport({
    db: adminDb,
    importer,
    input: { path: inputPath, observedOn: OBSERVED_ON },
    secret: TEST_HASH_KEY,
  });
}

export interface StoredDocument {
  readonly data: DocumentData;
  /** When the document was last written, to the microsecond. */
  readonly updateTime: string;
}

/**
 * Every document of the database by path. The collection registry names every collection, so
 * one collection-group query for each name finds them all, subcollections included.
 */
export async function allDocuments(): Promise<Map<string, StoredDocument>> {
  const names = [...new Set(COLLECTION_ENTRIES.map((entry) => entry.collectionId))];
  const snapshots = await Promise.all(names.map((name) => adminDb.collectionGroup(name).get()));
  const found = new Map<string, StoredDocument>();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const time = doc.updateTime;
      found.set(doc.ref.path, {
        data: doc.data(),
        updateTime: `${time.seconds}.${String(time.nanoseconds).padStart(9, "0")}`,
      });
    }
  }
  return found;
}

/** The paths that were created, changed or removed between two states of the database. */
export function differences(before: ReadonlyMap<string, StoredDocument>, after: ReadonlyMap<string, StoredDocument>) {
  return {
    created: [...after.keys()].filter((path) => !before.has(path)).sort(),
    removed: [...before.keys()].filter((path) => !after.has(path)).sort(),
    rewritten: [...after.keys()]
      .filter((path) => before.has(path) && before.get(path)?.updateTime !== after.get(path)?.updateTime)
      .sort(),
  };
}

/** The documents of one top-level collection or collection group, by identifier or path. */
export async function documentsOf(collectionId: string, group = false): Promise<Map<string, DocumentData>> {
  const snapshot = await (group ? adminDb.collectionGroup(collectionId) : adminDb.collection(collectionId)).get();
  return new Map(snapshot.docs.map((doc) => [group ? doc.ref.path : doc.id, doc.data()]));
}

/** The items of the review queue, each with its kind and status. */
export async function reconciliationItems(): Promise<(DocumentData & { readonly id: string })[]> {
  const snapshot = await adminDb.collection(COLLECTIONS.reconciliationItems.collectionPath()).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/** How many items of each kind have a status. */
export async function itemCounts(status = "open"): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const item of await reconciliationItems()) {
    if (item.status === status) counts[item.kind as string] = (counts[item.kind as string] ?? 0) + 1;
  }
  return counts;
}

/** Whether every stored document of a collection fits the schema of that collection, which is strict. */
export async function schemaProblems(): Promise<string[]> {
  const problems: string[] = [];
  const documents = await allDocuments();
  for (const [documentPath] of documents) {
    const segments = documentPath.split("/");
    const entry = COLLECTION_ENTRIES.find((candidate) => {
      const template = candidate.path.split("/");
      return (
        template.length === segments.length &&
        template.every((part, index) => part.startsWith("{") || part === segments[index])
      );
    });
    if (entry === undefined) {
      problems.push(`${documentPath}: no entry in the collection registry`);
      continue;
    }
    const parsed = entry.schema.safeParse(documents.get(documentPath)?.data);
    if (!parsed.success)
      problems.push(
        `${documentPath}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.code}`).join(", ")}`,
      );
  }
  return problems;
}
