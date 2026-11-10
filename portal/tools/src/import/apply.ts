// The apply stage (docs/MIGRATION_PLAN.md, section 6): writes the changes of a diff in bounded
// pieces. Each piece is one batched write that carries the changes together with their entries in
// the change log, so no change exists without its log entry. Every write names the state it
// expects to find: a document that has changed since the diff was computed fails its piece, the
// batch stops, and a new run picks up what remains.
import { COLLECTIONS, sequenceId } from "@eegml/shared";
import { FieldValue, type Timestamp, type WriteBatch } from "firebase-admin/firestore";
import { appendOnlyFields, chunked, entryOf, type RunContext, validated } from "./context";
import { changedTopLevelFields, type DocumentChange, type ItemChange, type PlanDiff } from "./preview";

/** The number of changes in one batched write. With the log entries it stays well below the limit of Firestore. */
export const APPLY_CHUNK_SIZE = 100;

/** Raised when the database no longer is what the plan was computed against. Nothing of the failed piece is written. */
export class ImportStopped extends Error {
  override readonly name = "ImportStopped";
}

interface LoggedChange {
  readonly path: string;
  readonly operation: "create" | "update" | "delete";
  readonly relation: "created" | "updated" | "matched";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  /** The collection of a special-category document, whose path the client-readable entry does not name. */
  readonly collectionPath?: string;
  readonly sourceRecordIds: readonly string[];
  readonly updateTime: Timestamp | null;
  readonly special: boolean;
}

/**
 * The state that the change log shows for a special-category document: a marker, and nothing
 * that depends on the values. Whoever runs imports reads the change log, and a digest of the
 * document would let such a reader confirm a guess of its values: a demographics document has a
 * handful of possible values in each field, and everything else in it can be read from the
 * entry itself. The entry does not say whose document it was either: it names the collection,
 * so a reader of the log cannot tell which person has such a record or when it changed. The
 * path and the two states sit beside the entry in `special/state`, which no client reads and
 * from which a rollback restores them.
 */
export function specialMarker(state: Record<string, unknown> | null): Record<string, unknown> | null {
  return state === null ? null : { specialCategory: true };
}

function stage(batch: WriteBatch, context: RunContext, change: LoggedChange, sequence: number): void {
  const { db, batchId, now } = context;
  const reference = db.doc(change.path);
  const expected = change.updateTime === null ? {} : { lastUpdateTime: change.updateTime };
  if (change.after === null) {
    batch.delete(reference, expected);
  } else if (change.before === null) {
    // `create` fails when the document has appeared in the meantime.
    batch.create(reference, change.after);
  } else {
    const patch: Record<string, unknown> = {};
    for (const [field, value] of changedTopLevelFields(change.before, change.after)) {
      patch[field] = value === undefined ? FieldValue.delete() : value;
    }
    batch.update(reference, patch, expected);
  }
  const entry = entryOf("importBatchChanges");
  const logPath = COLLECTIONS.importBatchChanges.docPath(batchId, sequenceId(sequence));
  batch.create(
    db.doc(logPath),
    validated(entry, logPath, {
      ...appendOnlyFields(now),
      batchId,
      // Whose special-category document was written is said only where no client reads: the entry names the collection.
      documentPath: change.special && change.collectionPath !== undefined ? change.collectionPath : change.path,
      operation: change.operation,
      relation: change.relation,
      sourceRecordIds: [...change.sourceRecordIds],
      before: change.special ? specialMarker(change.before) : change.before,
      after: change.special ? specialMarker(change.after) : change.after,
    }),
  );
  if (change.special) {
    // The two states of a special-category document are kept where no client can read them.
    const statePath = COLLECTIONS.importBatchChangeState.docPath(batchId, sequenceId(sequence));
    batch.create(
      db.doc(statePath),
      validated(entryOf("importBatchChangeState"), statePath, {
        ...appendOnlyFields(now),
        documentPath: change.path,
        before: change.before,
        after: change.after,
      }),
    );
  }
}

const ofDocument = (change: DocumentChange): LoggedChange => ({
  ...change,
  special: entryOf(change.collection).dataClass === "special",
  collectionPath: entryOf(change.collection).path,
});

const ofItem = (change: ItemChange): LoggedChange => ({
  path: change.path,
  operation: change.before === null ? "create" : "update",
  relation: change.before === null ? "created" : "updated",
  before: change.before,
  after: change.after,
  sourceRecordIds: change.sourceRecordIds,
  updateTime: change.updateTime,
  special: false,
});

/**
 * Writes changes with their log entries, starting at a sequence number. Returns the number of
 * changes committed. On a failed piece the batch is marked as failed with the number that was
 * committed before it, and `ImportStopped` is raised.
 */
async function commit(context: RunContext, changes: readonly LoggedChange[], firstSequence: number): Promise<number> {
  const { db, batchId } = context;
  const batchReference = db.doc(COLLECTIONS.importBatches.docPath(batchId));
  let committed = firstSequence - 1;
  for (const piece of chunked(changes, APPLY_CHUNK_SIZE)) {
    const batch = db.batch();
    for (const [index, change] of piece.entries()) stage(batch, context, change, committed + index + 1);
    batch.update(batchReference, { "stats.changesCommitted": committed + piece.length });
    try {
      await batch.commit();
    } catch (error) {
      await batchReference.update({ status: "failed", finishedAt: context.now });
      const reason = error instanceof Error ? error.message.split("\n")[0] : "unknown";
      throw new ImportStopped(
        `Batch ${batchId} stopped after ${committed} committed changes, because a document is no longer what the plan expected (${reason}). ` +
          "Nothing of the failed piece was written. Run the import again to pick up what remains.",
      );
    }
    committed += piece.length;
  }
  return committed - (firstSequence - 1);
}

/** Applies the document changes and then the item changes of a diff. Returns the number of changes committed. */
export async function applyDiff(context: RunContext, diff: PlanDiff): Promise<number> {
  return commit(context, [...diff.changes.map(ofDocument), ...diff.itemChanges.map(ofItem)], 1);
}

/** Writes only the items that explain why a batch cannot be applied, which a preview raises so that a reviewer can act. */
export async function applyBlockingItems(context: RunContext, diff: PlanDiff): Promise<number> {
  return commit(
    context,
    diff.itemChanges
      .filter((change) => change.blocking && (change.action === "raise" || change.action === "reopen"))
      .map(ofItem),
    1,
  );
}
