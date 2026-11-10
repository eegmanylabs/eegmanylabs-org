// What every stage of one run shares: the database, the batch, the instant and the actor.
import { COLLECTIONS, type CollectionEntry, type CollectionKey, systemActor, systemWriteContext } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";

/** The actor recorded on everything an importer writes. */
export const IMPORT_ACTOR = systemActor("import");

/** The most documents that one read or one batched write of the framework names. */
export const CHUNK_SIZE = 200;

export interface RunContext {
  readonly db: Firestore;
  readonly sourceKey: string;
  readonly batchId: string;
  /** The instant of the run. Every document of the run carries it, so a change log states exactly what was written. */
  readonly now: Timestamp;
}

/** The standard fields of a document that the run creates. */
export function createdFields(now: Timestamp): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: IMPORT_ACTOR,
    updatedBy: IMPORT_ACTOR,
    archivedAt: null,
    writeContext: systemWriteContext("import"),
  };
}

/** The standard fields that the run sets on a document it updates. */
export function updatedFields(now: Timestamp): Record<string, unknown> {
  return { updatedAt: now, updatedBy: IMPORT_ACTOR, writeContext: systemWriteContext("import") };
}

/** The standard fields of a document in an append-only collection. */
export function appendOnlyFields(now: Timestamp): Record<string, unknown> {
  return { schemaVersion: 1, createdAt: now, createdBy: IMPORT_ACTOR, writeContext: systemWriteContext("import") };
}

export const entryOf = (collection: CollectionKey): CollectionEntry => COLLECTIONS[collection] as CollectionEntry;

/** Splits a list into pieces of a bounded size. */
export function chunked<T>(values: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const pieces: T[][] = [];
  for (let start = 0; start < values.length; start += size) pieces.push(values.slice(start, start + size));
  return pieces;
}

/** The stored data of documents by path, or null where a document does not exist. Reads in bounded pieces. */
export async function readDocuments(
  db: Firestore,
  paths: readonly string[],
): Promise<Map<string, { readonly data: Record<string, unknown>; readonly updateTime: Timestamp } | null>> {
  const found = new Map<string, { readonly data: Record<string, unknown>; readonly updateTime: Timestamp } | null>();
  for (const piece of chunked([...new Set(paths)])) {
    const snapshots = await db.getAll(...piece.map((path) => db.doc(path)));
    for (const snapshot of snapshots) {
      const data = snapshot.data();
      found.set(
        snapshot.ref.path,
        data === undefined || snapshot.updateTime === undefined ? null : { data, updateTime: snapshot.updateTime },
      );
    }
  }
  return found;
}

/** Validates a document against the schema of its collection before it is written. The error quotes no value. */
export function validated(entry: CollectionEntry, path: string, data: Record<string, unknown>): Record<string, unknown> {
  const parsed = entry.schema.safeParse(data);
  if (parsed.success) return data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(document)"}: ${issue.code}`);
  throw new Error(`The planned document ${path} does not fit the schema of ${entry.key}: ${[...new Set(problems)].join(", ")}.`);
}
