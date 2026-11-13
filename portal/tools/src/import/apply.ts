// The apply stage (docs/MIGRATION_PLAN.md, section 6): writes the changes of a diff in bounded
// pieces. Each piece is one batched write that carries the changes together with their entries in
// the change log, so no change exists without its log entry. Every write names the state it
// expects to find: a document that has changed since the diff was computed fails its piece, the
// batch stops, and a new run picks up what remains.
import {
  COLLECTIONS,
  consentInForce,
  isSealedEntry,
  sequenceId,
  specialSubjectOf,
  type WithheldStateMarker,
} from "@eegml/shared";
import {
  type DocumentData,
  type DocumentReference,
  FieldValue,
  type Precondition,
  type Timestamp,
  type UpdateData,
  type WithFieldValue,
} from "firebase-admin/firestore";
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
  /** Why the states are withheld from the change log, or null where the log shows them. */
  readonly withheld: WithheldStateMarker | null;
  /** Whether the entry is about a sealed document or a sealed review item, which programme administrators alone read. */
  readonly sealed: boolean;
  /** A removal that no rollback undoes: its entry keeps no state, and says so. */
  readonly irreversible?: true;
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
  return withheldMarker("specialCategory", state);
}

/**
 * The marker for the state of a withheld document. A document that a decision of the programme
 * seals is withheld in the same way as a special-category one: its entry names the collection and
 * no document, since whether a replication has sealed values at all says something about them,
 * and the entry is marked sealed, so that programme administrators alone read it.
 */
export function withheldMarker(
  marker: WithheldStateMarker,
  state: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return state === null ? null : { [marker]: true };
}

/** What a batched write and a transaction both offer, so that one piece is staged the same way in either. */
interface Writes {
  create(reference: DocumentReference, data: WithFieldValue<DocumentData>): unknown;
  update(reference: DocumentReference, data: UpdateData<DocumentData>, precondition?: Precondition): unknown;
  delete(reference: DocumentReference, precondition?: Precondition): unknown;
}

function stage(batch: Writes, context: RunContext, change: LoggedChange, sequence: number): void {
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
      // Which withheld document was written is said only where no client reads: the entry names the collection.
      documentPath:
        change.withheld !== null && change.collectionPath !== undefined ? change.collectionPath : change.path,
      operation: change.operation,
      relation: change.relation,
      sourceRecordIds: [...change.sourceRecordIds],
      before: change.withheld === null ? change.before : withheldMarker(change.withheld, change.before),
      after: change.withheld === null ? change.after : withheldMarker(change.withheld, change.after),
      sealed: change.sealed,
      ...(change.irreversible === true ? { irreversible: true } : {}),
    }),
  );
  // An irreversible removal keeps no state: the values it removes must not outlive it.
  if (change.withheld !== null && change.irreversible !== true) {
    // The two states of a withheld document are kept where no client can read them.
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

function withheldOf(change: DocumentChange): WithheldStateMarker | null {
  const entry = entryOf(change.collection);
  if (entry.dataClass === "special") return "specialCategory";
  return isSealedEntry(entry) ? "sealed" : null;
}

const ofDocument = (change: DocumentChange): LoggedChange => {
  const withheld = withheldOf(change);
  return { ...change, withheld, sealed: withheld === "sealed", collectionPath: entryOf(change.collection).path };
};

/** Whether a state of a review item is sealed. An item written before the seal carries no flag and counts as sealed. */
const sealedItemState = (state: Record<string, unknown> | null): boolean => state !== null && state.sealed !== false;

const ofItem = (change: ItemChange): LoggedChange => ({
  path: change.path,
  operation: change.before === null ? "create" : "update",
  relation: change.before === null ? "created" : "updated",
  before: change.before,
  after: change.after,
  sourceRecordIds: change.sourceRecordIds,
  updateTime: change.updateTime,
  withheld: null,
  sealed: sealedItemState(change.before) || sealedItemState(change.after),
});

/** What an apply wrote, and the values it left out because the person's consent ended while the import ran. */
export interface ApplyResult {
  readonly committed: number;
  readonly discarded: number;
}

/** The person whose values document a change writes, where it writes one, which needs their consent in force. */
function valuesWrittenFor(change: LoggedChange): string | null {
  const subject = specialSubjectOf(change.path);
  return subject?.kind === "person" && change.after !== null ? subject.personId : null;
}

/**
 * Writes changes with their log entries, starting at a sequence number. Returns the number of
 * changes committed. On a failed piece the batch is marked as failed with the number that was
 * committed before it, and `ImportStopped` is raised.
 *
 * Gender and ethnicity are written only while the person's consent is in force (question 20). The
 * plan read the consent, but a withdrawal may land before the write, so a piece that writes values
 * runs as a transaction that reads each person's consent again and leaves out the values of anyone
 * whose consent is no longer in force. A withdrawal during the transaction makes it start again.
 */
async function commit(
  context: RunContext,
  changes: readonly LoggedChange[],
  firstSequence: number,
): Promise<ApplyResult> {
  const { db, batchId } = context;
  const batchReference = db.doc(COLLECTIONS.importBatches.docPath(batchId));
  let committed = firstSequence - 1;
  let discarded = 0;
  for (const piece of chunked(changes, APPLY_CHUNK_SIZE)) {
    const persons = [...new Set(piece.flatMap((change) => valuesWrittenFor(change) ?? []))];
    let written = piece.length;
    try {
      if (persons.length === 0) {
        const batch = db.batch();
        for (const [index, change] of piece.entries()) stage(batch, context, change, committed + index + 1);
        batch.update(batchReference, { "stats.changesCommitted": committed + piece.length });
        await batch.commit();
      } else {
        written = await db.runTransaction(async (transaction) => {
          const consents = await transaction.getAll(
            ...persons.map((personId) => db.doc(COLLECTIONS.personDemographicsConsent.docPath(personId))),
          );
          const consenting = new Set(persons.filter((_personId, index) => consentInForce(consents[index]?.data())));
          const kept = piece.filter((change) => {
            const personId = valuesWrittenFor(change);
            return personId === null || consenting.has(personId);
          });
          for (const [index, change] of kept.entries()) stage(transaction, context, change, committed + index + 1);
          transaction.update(batchReference, { "stats.changesCommitted": committed + kept.length });
          return kept.length;
        });
      }
    } catch (error) {
      await batchReference.update({ status: "failed", finishedAt: context.now });
      const reason = error instanceof Error ? error.message.split("\n")[0] : "unknown";
      throw new ImportStopped(
        `Batch ${batchId} stopped after ${committed} committed changes, because a document is no longer what the plan expected (${reason}). ` +
          "Nothing of the failed piece was written. Run the import again to pick up what remains.",
      );
    }
    committed += written;
    discarded += piece.length - written;
  }
  return { committed: committed - (firstSequence - 1), discarded };
}

/** Applies the document changes and then the item changes of a diff. */
export async function applyDiff(context: RunContext, diff: PlanDiff): Promise<ApplyResult> {
  return commit(context, [...diff.changes.map(ofDocument), ...diff.itemChanges.map(ofItem)], 1);
}

/** Writes only the items that explain why a batch cannot be applied, which a preview raises so that a reviewer can act. */
export async function applyBlockingItems(context: RunContext, diff: PlanDiff): Promise<ApplyResult> {
  return commit(
    context,
    diff.itemChanges
      .filter((change) => change.blocking && (change.action === "raise" || change.action === "reopen"))
      .map(ofItem),
    1,
  );
}
