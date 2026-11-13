// Rollback of a batch from its change log (docs/MIGRATION_PLAN.md, section 6). What happens to
// each document is decided by `planBatchRollback` of the shared package, which the callable
// function `rollbackImportBatch` uses as well; this file reads and writes for the command line.
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
import {
  type ChangeState,
  COLLECTIONS,
  consentInForce,
  isWithheldState,
  planBatchRollback,
  sequenceId,
  specialSubjectOf,
} from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { appendOnlyFields, chunked, IMPORT_ACTOR, readDocuments, updatedFields } from "./context";
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
      /** Special-category documents not written back: removed for good, or of a person without consent. */
      readonly discarded: number;
    };

const ITEMS_PREFIX = `${COLLECTIONS.reconciliationItems.collectionPath()}/`;

/**
 * The special-category documents of a log that a rollback may not write back: every copy of cells
 * beneath a source record, and the values of a person whose consent is not in force (question 20).
 */
async function specialWithoutConsent(db: Firestore, states: readonly ChangeState[]): Promise<Set<string>> {
  const refused = new Set<string>();
  const persons = new Map<string, string>();
  for (const state of states) {
    const subject = specialSubjectOf(state.path);
    if (subject?.kind === "sourceRecord") refused.add(state.path);
    if (subject?.kind === "person")
      persons.set(state.path, COLLECTIONS.personDemographicsConsent.docPath(subject.personId));
  }
  const consents = await readDocuments(db, [...persons.values()]);
  for (const [path, consentPath] of persons) {
    if (!consentInForce(consents.get(consentPath)?.data)) refused.add(path);
  }
  return refused;
}

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
  const marked = (entry: (typeof entries)[number]) => [entry.get("before"), entry.get("after")].some(isWithheldState);
  const statePath = (id: string) => COLLECTIONS.importBatchChangeState.docPath(batchId, id);
  const special = await readDocuments(
    db,
    entries.filter(marked).map((entry) => statePath(entry.id)),
  );
  // Without its kept states a special-category document cannot be given back what it held. Nothing is reversed then.
  // A removal for good keeps no state on purpose, and stays removed.
  const irreversible = (entry: (typeof entries)[number]) => entry.get("irreversible") === true;
  const stateless = entries.filter(
    (entry) => marked(entry) && !irreversible(entry) && !special.get(statePath(entry.id)),
  );
  if (stateless.length > 0) {
    return { status: "refused", changedDocuments: stateless.map((entry) => entry.ref.path).sort() };
  }
  const states: ChangeState[] = entries.map((entry) => {
    const kept = special.get(statePath(entry.id));
    return {
      path: (kept?.data.documentPath as string | undefined) ?? (entry.get("documentPath") as string),
      before: (kept ? kept.data.before : entry.get("before")) as Record<string, unknown> | null,
      after: (kept ? kept.data.after : entry.get("after")) as Record<string, unknown> | null,
      irreversible: irreversible(entry),
    };
  });
  const current = await readDocuments(
    db,
    states.map((state) => state.path),
  );
  const plan = planBatchRollback({
    states,
    current: new Map([...current].map(([path, stored]) => [path, stored?.data ?? null])),
    equal: sameValue,
    itemsPrefix: ITEMS_PREFIX,
    withoutConsent: await specialWithoutConsent(db, states),
  });
  if (plan.status === "refused") return { status: "refused", changedDocuments: plan.changedDocuments };

  for (const piece of chunked(plan.steps, 200)) {
    const write = db.batch();
    for (const step of piece) {
      const reference = db.doc(step.path);
      const stored = current.get(step.path) ?? null;
      const precondition = stored === null ? {} : { lastUpdateTime: stored.updateTime };
      switch (step.kind) {
        case "skip":
        case "keep":
        case "discard":
          break;
        case "withdraw":
          write.update(
            reference,
            { status: "withdrawn", resolvedBy: IMPORT_ACTOR, resolvedAt: now, ...updatedFields(now) },
            precondition,
          );
          break;
        case "restoreItem":
          write.update(reference, { ...step.data }, precondition);
          break;
        case "remove":
          write.delete(reference, precondition);
          break;
        case "recreate":
          // The batch removed the document. It is written again as it was.
          write.create(reference, step.data);
          break;
        case "restore":
          write.update(
            reference,
            {
              ...step.set,
              ...Object.fromEntries(step.remove.map((field) => [field, FieldValue.delete()])),
            },
            precondition,
          );
          break;
      }
    }
    await write.commit();
  }
  const { restored, removed, itemsWithdrawn, discarded } = plan.counts;
  const itemsLeft = plan.steps.filter((step) => step.kind === "keep").map((step) => step.path);

  const logEntries = await db.collection(COLLECTIONS.importBatchLog.collectionPath(batchId)).count().get();
  const finish = db.batch();
  finish.update(batchReference, { status: "rolledBack", ...updatedFields(now) });
  finish.create(db.doc(COLLECTIONS.importBatchLog.docPath(batchId, sequenceId(logEntries.data().count + 1))), {
    ...appendOnlyFields(now),
    batchId,
    level: "info",
    message:
      `Rolled back: ${restored} documents restored, ${removed} removed, ${itemsWithdrawn} items withdrawn, ` +
      `${itemsLeft.length} decided items left in place, ${discarded} special-category documents not written back. ` +
      "Source records were kept.",
  });
  await finish.commit();
  // The kept states of special-category documents have served their purpose. No copy of a value outlives the reversal.
  for (const piece of chunked([...special.keys()], 200)) {
    const clean = db.batch();
    for (const path of piece) clean.delete(db.doc(path));
    await clean.commit();
  }
  return { status: "rolledBack", restored, removed, itemsWithdrawn, itemsLeft: itemsLeft.sort(), discarded };
}
