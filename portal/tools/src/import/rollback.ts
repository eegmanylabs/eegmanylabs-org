// Rollback of a batch from its change log (docs/MIGRATION_PLAN.md, section 6).
//
// The entries of the batch are walked in reverse order. A document that still is what the batch
// wrote gets its earlier state back, is removed if the batch created it, or is written again if
// the batch removed it. If any document has changed since, the rollback refuses as a whole and
// lists those documents, so that a person decides and nothing that was edited in the portal is
// lost. Source records stay, because they remain true statements of what the source said. Open
// reconciliation items that the batch raised are closed as withdrawn, and items that a reviewer
// has decided are reported and left in place.
//
// A rollback that stopped part-way is carried on by running it again: a document that is already
// in its earlier state counts as reversed and is skipped. The states of special-category
// documents, which the change log keeps where no client reads them, are removed once the batch
// is reversed, because nothing needs them any more.
import { COLLECTIONS, sequenceId } from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { appendOnlyFields, chunked, IMPORT_ACTOR, readDocuments, updatedFields } from "./context";
import { changedTopLevelFields } from "./preview";
import { sameValue } from "./values";

export type RollbackResult =
  | { readonly status: "notFound" }
  /** The batch wrote nothing that can be reversed: a preview, or a batch that was rolled back already. */
  | { readonly status: "nothingToReverse"; readonly reason: string }
  /** At least one document has changed since the batch wrote it. Nothing was reversed. */
  | { readonly status: "refused"; readonly changedDocuments: readonly string[] }
  | {
      readonly status: "rolledBack";
      readonly restored: number;
      readonly removed: number;
      readonly itemsWithdrawn: number;
      /** Items that a reviewer has decided since. They are left as they are. */
      readonly itemsLeft: readonly string[];
    };

const ITEMS_PREFIX = `${COLLECTIONS.reconciliationItems.collectionPath()}/`;

export async function rollbackBatch(db: Firestore, batchId: string, at: Date = new Date()): Promise<RollbackResult> {
  const now = Timestamp.fromDate(at);
  const batchReference = db.doc(COLLECTIONS.importBatches.docPath(batchId));
  const batch = await batchReference.get();
  if (!batch.exists) return { status: "notFound" };
  if (batch.get("mode") !== "apply")
    return { status: "nothingToReverse", reason: "it is a preview, which writes no entity" };
  if (batch.get("status") === "rolledBack") return { status: "nothingToReverse", reason: "it was rolled back already" };

  const log = await db.collection(COLLECTIONS.importBatchChanges.collectionPath(batchId)).get();
  const entries = log.docs.sort((a, b) => (a.id < b.id ? 1 : -1));
  const marked = (entry: (typeof entries)[number]) =>
    [entry.get("before"), entry.get("after")].some(
      (state) => (state as { specialCategory?: boolean } | null)?.specialCategory === true,
    );
  const statePath = (id: string) => COLLECTIONS.importBatchChangeState.docPath(batchId, id);
  const special = await readDocuments(
    db,
    entries.filter(marked).map((entry) => statePath(entry.id)),
  );
  // Without its kept states a special-category document cannot be given back what it held. Nothing is reversed then.
  const stateless = entries.filter((entry) => marked(entry) && !special.get(statePath(entry.id)));
  if (stateless.length > 0) {
    return { status: "refused", changedDocuments: stateless.map((entry) => entry.ref.path).sort() };
  }
  const states = entries.map((entry) => {
    const kept = special.get(statePath(entry.id));
    return {
      path: (kept?.data.documentPath as string | undefined) ?? (entry.get("documentPath") as string),
      before: (kept ? kept.data.before : entry.get("before")) as Record<string, unknown> | null,
      after: (kept ? kept.data.after : entry.get("after")) as Record<string, unknown> | null,
    };
  });
  const current = await readDocuments(
    db,
    states.map((state) => state.path),
  );

  const isItem = (path: string) => path.startsWith(ITEMS_PREFIX);
  const holds = (state: (typeof states)[number], wanted: Record<string, unknown> | null) =>
    sameValue(current.get(state.path)?.data ?? null, wanted);
  const unchangedSince = (state: (typeof states)[number]) => holds(state, state.after);
  /** A document that an earlier attempt of this rollback has reversed already: it is in its earlier state, or withdrawn. */
  const reversed = (state: (typeof states)[number]) =>
    !unchangedSince(state) &&
    (holds(state, state.before) ||
      (isItem(state.path) && state.before === null && current.get(state.path)?.data.status === "withdrawn"));
  const changedDocuments = states
    .filter((state) => !isItem(state.path) && !unchangedSince(state) && !reversed(state))
    .map((state) => state.path);
  if (changedDocuments.length > 0) return { status: "refused", changedDocuments: changedDocuments.sort() };

  let restored = 0;
  let removed = 0;
  let itemsWithdrawn = 0;
  const itemsLeft: string[] = [];
  for (const piece of chunked(states, 200)) {
    const write = db.batch();
    for (const state of piece) {
      const reference = db.doc(state.path);
      const stored = current.get(state.path) ?? null;
      const precondition = stored === null ? {} : { lastUpdateTime: stored.updateTime };
      if (reversed(state)) continue;
      if (isItem(state.path)) {
        if (stored === null) continue;
        if (!unchangedSince(state)) {
          // A reviewer has decided the item, or a later batch has closed it. The decision stands.
          itemsLeft.push(state.path);
        } else if (state.before === null) {
          write.update(
            reference,
            { status: "withdrawn", resolvedBy: IMPORT_ACTOR, resolvedAt: now, ...updatedFields(now) },
            precondition,
          );
          itemsWithdrawn += 1;
        } else {
          write.update(reference, { ...state.before }, precondition);
          restored += 1;
        }
      } else if (state.before === null) {
        write.delete(reference, precondition);
        removed += 1;
      } else if (state.after === null) {
        // The batch removed the document. It is written again as it was.
        write.create(reference, state.before);
        restored += 1;
      } else {
        const patch: Record<string, unknown> = {};
        for (const [field, value] of changedTopLevelFields(state.after ?? {}, state.before)) {
          patch[field] = value === undefined ? FieldValue.delete() : value;
        }
        write.update(reference, patch, precondition);
        restored += 1;
      }
    }
    await write.commit();
  }

  const logEntries = await db.collection(COLLECTIONS.importBatchLog.collectionPath(batchId)).count().get();
  const finish = db.batch();
  finish.update(batchReference, { status: "rolledBack", ...updatedFields(now) });
  finish.create(db.doc(COLLECTIONS.importBatchLog.docPath(batchId, sequenceId(logEntries.data().count + 1))), {
    ...appendOnlyFields(now),
    batchId,
    level: "info",
    message:
      `Rolled back: ${restored} documents restored, ${removed} removed, ${itemsWithdrawn} items withdrawn, ` +
      `${itemsLeft.length} decided items left in place. Source records were kept.`,
  });
  await finish.commit();
  // The kept states of special-category documents have served their purpose. No copy of a value outlives the reversal.
  for (const piece of chunked([...special.keys()], 200)) {
    const clean = db.batch();
    for (const path of piece) clean.delete(db.doc(path));
    await clean.commit();
  }
  return { status: "rolledBack", restored, removed, itemsWithdrawn, itemsLeft: itemsLeft.sort() };
}
