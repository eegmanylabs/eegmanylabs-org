// Helpers shared by the integration tests of the import framework. They run the importers
// against the Firestore emulator with synthetic fixtures: every name in those fixtures is
// invented and every address is on example.org.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COLLECTION_ENTRIES, COLLECTIONS, importBatchId } from "@eegml/shared";
import { type DocumentData, Timestamp } from "firebase-admin/firestore";
import { confirmAgreedLeads } from "../../tools/src/commands/confirm-agreed-leads";
import { seedLookups } from "../../tools/src/commands/seed-lookups";
import { createdFields, IMPORT_ACTOR } from "../../tools/src/import/context";
import { type ImporterDefinition, ROW_CLASSES, type RowClass } from "../../tools/src/import/model";
import type { PrivateLocations } from "../../tools/src/import/registry";
import { type RunReport, runImport } from "../../tools/src/import/run";
import { type VerifyOptions, verifyImport } from "../../tools/src/import/verify";
import { type RunTarget, WITHHELD_OUTPUT_KEYS } from "../../tools/src/import/withheld";
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

/** An emulator on which every withheld output is rehearsed, as the suites of the single importers need it. */
export const REHEARSAL: RunTarget = { production: false, rehearse: WITHHELD_OUTPUT_KEYS };

export interface RunExtra {
  readonly previewBatchId?: string;
  /** Where the run writes. Without it: the emulators, with every withheld output rehearsed. */
  readonly target?: RunTarget;
  /** `required` enforces the order of the sources, as the command line does. Without it one importer runs by itself. */
  readonly order?: "required" | "notChecked";
  readonly locations?: PrivateLocations;
}

export function run(
  importer: ImporterDefinition,
  inputPath: string,
  mode: "preview" | "apply",
  extra: RunExtra = {},
): Promise<RunReport> {
  return runImport({
    db: adminDb,
    importer,
    input: { path: inputPath, observedOn: OBSERVED_ON },
    mode,
    secret: TEST_HASH_KEY,
    now: nextInstant(),
    target: REHEARSAL,
    order: "notChecked",
    ...extra,
  });
}

export function verify(
  importer: ImporterDefinition,
  inputPath: string,
  extra: Partial<Pick<VerifyOptions, "target" | "baseline" | "requireBaseline" | "record" | "confirmedHeaders">> = {},
) {
  return verifyImport({
    db: adminDb,
    importer,
    input: { path: inputPath, observedOn: OBSERVED_ON },
    secret: TEST_HASH_KEY,
    target: REHEARSAL,
    ...extra,
  });
}

/**
 * Records that a source has been applied, as its own apply would. It is for a test that runs a
 * later source under the order of the plan and needs nothing of the earlier source but that fact.
 */
export async function recordApplied(sourceKey: string): Promise<string> {
  const started = nextInstant();
  const contentHash = "0".repeat(64);
  const batchId = importBatchId(started, contentHash);
  const now = Timestamp.fromDate(started);
  await adminDb.doc(COLLECTIONS.importBatches.docPath(batchId)).create({
    ...createdFields(now),
    schemaVersion: COLLECTIONS.importBatches.schemaVersion,
    sourceKey,
    mode: "apply",
    status: "applied",
    contentHash,
    startedBy: IMPORT_ACTOR,
    startedAt: now,
    finishedAt: now,
    stats: {},
  });
  return batchId;
}

/**
 * Confirms the leads on which the lead-naming sources agree, as `leads:confirm-agreed` does after a
 * first round of imports (question 5). The sources other than the website are recorded as applied
 * for the moment of the step only, so that the imports a test runs next start afresh.
 */
export async function agreeOnLeads(): Promise<void> {
  const stand = await Promise.all(["a", "d", "f"].map((sourceKey) => recordApplied(sourceKey)));
  const summary = await confirmAgreedLeads(adminDb, { apply: true });
  if (summary.waitingFor.length > 0) throw new Error(`Still waiting for ${summary.waitingFor.join(", ")}.`);
  for (const batchId of stand) await adminDb.doc(COLLECTIONS.importBatches.docPath(batchId)).delete();
}

/** The rows of each class that a batch counted in each tab, in the form of a baseline of the private configuration. */
export async function baselineOf(batchId: string): Promise<Record<string, Partial<Record<RowClass, number>>>> {
  const stats = ((await adminDb.doc(COLLECTIONS.importBatches.docPath(batchId)).get()).get("stats") ?? {}) as Record<
    string,
    number
  >;
  const baseline: Record<string, Partial<Record<RowClass, number>>> = {};
  for (const [key, count] of Object.entries(stats)) {
    const [kind, tabKey = "", rowClass = ""] = key.split(":");
    if (kind !== "rows") continue;
    baseline[tabKey] ??= {};
    if ((ROW_CLASSES as readonly string[]).includes(rowClass)) (baseline[tabKey] ?? {})[rowClass as RowClass] = count;
  }
  return baseline;
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
