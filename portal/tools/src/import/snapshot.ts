// The snapshot stage (docs/MIGRATION_PLAN.md, sections 2 and 6): every stored row becomes an
// immutable source record whose identifier covers the source, the tab, the natural key of the
// row and the hash of its raw cells. An unchanged row therefore addresses the record that
// exists, and a changed row adds a record while the earlier one is kept and named as superseded.
//
// The special-category cells of a row are stored beneath its record, in a document that no
// client can read, and the record itself holds the marker that the importer put in their place.
//
// A record is written when a row first appears or changes. Its `lastSeenBatchId` is written
// again only when the row goes missing or reappears, and each batch names the list of the
// records it saw, so a snapshot of an unchanged file writes nothing new.
import { COLLECTIONS, SEEN_RECORDS_CHUNK_MAX, sequenceId, sourceRecordId } from "@eegml/shared";
import {
  appendOnlyFields,
  CHUNK_SIZE,
  chunked,
  createdFields,
  entryOf,
  type RunContext,
  updatedFields,
  validated,
} from "./context";
import type { RecordedRow, SourceReading } from "./model";
import { canonicalJson, rowHash } from "./values";

/** A raw row has to fit one document, which Firestore limits to 1 MiB. */
const MAX_RAW_BYTES = 900_000;

/** Gives every stored row of a reading its source record identifier. Pure: nothing is read or written. */
export function recordRows(sourceKey: string, reading: SourceReading): Map<string, RecordedRow[]> {
  const byTab = new Map<string, RecordedRow[]>();
  for (const tab of reading.tabs) {
    const keys = new Set<string>();
    const rows = tab.rows.map((row) => {
      if (keys.has(row.rowKey)) {
        throw new Error(
          `Two rows of tab ${tab.tabKey} of source ${sourceKey} have the same natural key, so they cannot be told apart.`,
        );
      }
      keys.add(row.rowKey);
      if (row.cells.length !== row.labels.length || new Set(row.labels).size !== row.labels.length) {
        throw new Error(`A row of tab ${tab.tabKey} of source ${sourceKey} does not name each of its cells once.`);
      }
      const rawHash = rowHash(row.cells);
      return {
        ...row,
        tabKey: tab.tabKey,
        rawHash,
        recordId: sourceRecordId(sourceKey, tab.tabKey, row.rowKey, rawHash),
      };
    });
    byTab.set(tab.tabKey, rows);
  }
  return byTab;
}

interface StoredRecord {
  readonly id: string;
  readonly tabKey: string;
  readonly rowKey: string;
  readonly supersededById: string | null;
}

/** What the snapshot stage found when it compared the reading with the stored records of the source. */
export interface SnapshotState {
  /** Every source record of the source, earlier revisions and the rows of this reading included. */
  readonly ownRecordIds: ReadonlySet<string>;
  /** Rows that have no record yet. */
  readonly created: readonly RecordedRow[];
  /** Earlier revisions that a row of this reading replaces. */
  readonly superseded: readonly { readonly id: string; readonly by: string }[];
  /** Records that are current again, because a row has returned to an earlier content. */
  readonly revived: readonly string[];
  /** Current records whose row is absent from this reading, with the tab and key of each. */
  readonly missing: readonly StoredRecord[];
  /** Records that the previous batch saw and this reading does not. */
  readonly newlyMissing: readonly string[];
  /** Records that exist, that the previous batch did not see and that this reading holds again. */
  readonly reappeared: readonly string[];
  /** Records that are no longer current: superseded now or earlier. */
  readonly retired: readonly string[];
  readonly previousBatchId: string | null;
  /** The batch whose list of seen records equals what this reading holds, or null when the list has changed. */
  readonly unchangedManifestBatchId: string | null;
  readonly seen: readonly string[];
}

const rowIdentity = (tabKey: string, rowKey: string): string => `${tabKey}\n${rowKey}`;

/** Compares the rows of a reading with the stored source records. Reads only. */
export async function compareSnapshot(
  context: Pick<RunContext, "db" | "sourceKey" | "batchId">,
  rows: ReadonlyMap<string, readonly RecordedRow[]>,
): Promise<SnapshotState> {
  const { db, sourceKey } = context;
  const stored = await db
    .collection(COLLECTIONS.sourceRecords.collectionPath())
    .where("sourceKey", "==", sourceKey)
    .select("tabKey", "rowKey", "supersededById")
    .get();
  const existing = new Map<string, StoredRecord>(
    stored.docs.map((doc) => [
      doc.id,
      {
        id: doc.id,
        tabKey: doc.get("tabKey"),
        rowKey: doc.get("rowKey"),
        supersededById: doc.get("supersededById") ?? null,
      },
    ]),
  );

  // The latest earlier batch of the source that completed its snapshot names the records it saw.
  const batches = await db
    .collection(COLLECTIONS.importBatches.collectionPath())
    .where("sourceKey", "==", sourceKey)
    .get();
  const previous = batches.docs
    .filter((doc) => doc.id < context.batchId && typeof doc.get("manifestBatchId") === "string")
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const previousManifestId = (previous?.get("manifestBatchId") as string | undefined) ?? null;
  const previouslySeen = new Set<string>();
  if (previousManifestId !== null) {
    const chunks = await db.collection(COLLECTIONS.importBatchSeenRecords.collectionPath(previousManifestId)).get();
    for (const chunk of chunks.docs) for (const id of chunk.get("sourceRecordIds") as string[]) previouslySeen.add(id);
  }

  const current = [...rows.values()].flat();
  const seen = current.map((row) => row.recordId).sort();
  const currentByIdentity = new Map(current.map((row) => [rowIdentity(row.tabKey, row.rowKey), row.recordId]));
  const created = current.filter((row) => !existing.has(row.recordId));
  const superseded: { id: string; by: string }[] = [];
  const missing: StoredRecord[] = [];
  const newlyMissing: string[] = [];
  const retired: string[] = [];
  for (const record of existing.values()) {
    const successor = currentByIdentity.get(rowIdentity(record.tabKey, record.rowKey));
    if (successor === record.id) continue;
    if (successor !== undefined) {
      if (record.supersededById !== successor) superseded.push({ id: record.id, by: successor });
      retired.push(record.id);
    } else if (record.supersededById === null) {
      missing.push(record);
      if (previouslySeen.has(record.id)) newlyMissing.push(record.id);
    } else {
      retired.push(record.id);
    }
  }
  const revived = current
    .filter((row) => (existing.get(row.recordId)?.supersededById ?? null) !== null)
    .map((row) => row.recordId);
  const reappeared =
    previous === undefined
      ? []
      : current
          .filter((row) => existing.has(row.recordId) && !previouslySeen.has(row.recordId))
          .map((row) => row.recordId);
  const unchanged =
    previousManifestId !== null && seen.length === previouslySeen.size && seen.every((id) => previouslySeen.has(id));
  return {
    ownRecordIds: new Set([...existing.keys(), ...seen]),
    created,
    superseded,
    revived,
    missing: missing.sort((a, b) => (a.id < b.id ? -1 : 1)),
    newlyMissing,
    reappeared,
    retired: retired.sort(),
    previousBatchId: previous?.id ?? null,
    unchangedManifestBatchId: unchanged ? previousManifestId : null,
    seen,
  };
}

export interface SnapshotWrites {
  /** The number of documents written. */
  readonly writes: number;
  /** The batch whose `seenRecords` list what this batch saw. */
  readonly manifestBatchId: string;
}

/**
 * Writes what the comparison found: new records, the links from superseded records to their
 * successors, the changes of presence, and the list of seen records where it has changed. It
 * runs for a preview as well as for an apply, because a source record states what the source
 * said on that date whether or not the batch goes ahead.
 */
export async function writeSnapshot(
  context: RunContext,
  state: SnapshotState,
  observedOn: string,
): Promise<SnapshotWrites> {
  const { db, sourceKey, batchId, now } = context;
  const entry = entryOf("sourceRecords");
  const special = entryOf("sourceRecordSpecial");
  let writes = 0;
  let specialWrites = 0;
  // A row with special-category cells is two documents, so the pieces are half as large.
  for (const piece of chunked(state.created, CHUNK_SIZE / 2)) {
    const batch = db.batch();
    for (const row of piece) {
      const raw = Object.fromEntries(row.labels.map((label, index) => [label, row.cells[index] ?? null]));
      if (canonicalJson(raw).length > MAX_RAW_BYTES) {
        throw new Error(`A row of tab ${row.tabKey} of source ${sourceKey} is too large for one source record.`);
      }
      const path = entry.docPath(row.recordId);
      batch.create(
        db.doc(path),
        validated(entry, path, {
          ...createdFields(now),
          schemaVersion: entry.schemaVersion,
          sourceKey,
          tabKey: row.tabKey,
          rowKey: row.rowKey,
          rowNumber: row.rowNumber,
          raw,
          rawHash: row.rawHash,
          observedOn,
          firstSeenBatchId: batchId,
          lastSeenBatchId: batchId,
          supersededById: null,
        }),
      );
      if (row.special === undefined || Object.keys(row.special).length === 0) continue;
      // The special-category cells of the row sit beneath its record, where no client can read them.
      const specialPath = special.docPath(row.recordId);
      batch.create(
        db.doc(specialPath),
        validated(special, specialPath, {
          ...createdFields(now),
          schemaVersion: special.schemaVersion,
          sourceRecordId: row.recordId,
          raw: { ...row.special },
        }),
      );
      specialWrites += 1;
    }
    await batch.commit();
    writes += piece.length;
  }
  writes += specialWrites;

  // The raw content of a record never changes. Only these two fields are written later.
  const updates = new Map<string, Record<string, unknown>>();
  const update = (id: string, fields: Record<string, unknown>) => updates.set(id, { ...updates.get(id), ...fields });
  for (const { id, by } of state.superseded) update(id, { supersededById: by });
  for (const id of state.revived) update(id, { supersededById: null });
  for (const id of state.reappeared) update(id, { lastSeenBatchId: batchId });
  if (state.previousBatchId !== null)
    for (const id of state.newlyMissing) update(id, { lastSeenBatchId: state.previousBatchId });
  for (const piece of chunked([...updates])) {
    const batch = db.batch();
    for (const [id, fields] of piece) batch.update(db.doc(entry.docPath(id)), { ...fields, ...updatedFields(now) });
    await batch.commit();
    writes += piece.length;
  }

  if (state.unchangedManifestBatchId !== null) return { writes, manifestBatchId: state.unchangedManifestBatchId };
  const manifest = entryOf("importBatchSeenRecords");
  const pieces = chunked(state.seen, SEEN_RECORDS_CHUNK_MAX);
  for (const [index, piece] of pieces.entries()) {
    const path = manifest.docPath(batchId, sequenceId(index));
    await db
      .doc(path)
      .create(validated(manifest, path, { ...appendOnlyFields(now), batchId, index, sourceRecordIds: piece }));
    writes += 1;
  }
  return { writes, manifestBatchId: batchId };
}
