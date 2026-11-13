import { isDeepStrictEqual } from "node:util";
import {
  type ChangeState,
  COLLECTIONS,
  consentInForce,
  isWithheldState,
  planBatchRollback,
  type RollbackStep,
  rollbackImportBatchContract,
  sequenceId,
  specialSubjectOf,
} from "@eegml/shared";
import {
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  type Precondition,
  Timestamp,
} from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

/** The most documents one read or one batch of writes names. */
const CHUNK = 200;
/** The most documents the answer lists. */
const LISTED = 1_000;

const chunked = <T>(values: readonly T[]): T[][] => {
  const pieces: T[][] = [];
  for (let start = 0; start < values.length; start += CHUNK) pieces.push(values.slice(start, start + CHUNK));
  return pieces;
};

async function readAll(db: Firestore, paths: readonly string[]): Promise<Map<string, DocumentSnapshot>> {
  const found = new Map<string, DocumentSnapshot>();
  for (const piece of chunked([...new Set(paths)])) {
    for (const snapshot of await db.getAll(...piece.map((path) => db.doc(path))))
      found.set(snapshot.ref.path, snapshot);
  }
  return found;
}

const ACTION_OF: Readonly<Record<RollbackStep["kind"], "restore" | "remove" | "withdraw" | "keep" | null>> = {
  restore: "restore",
  recreate: "restore",
  restoreItem: "restore",
  remove: "remove",
  withdraw: "withdraw",
  keep: "keep",
  discard: null,
  skip: null,
};

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
  const consents = await readAll(db, [...persons.values()]);
  for (const [path, consentPath] of persons) {
    if (!consentInForce(consents.get(consentPath)?.data())) refused.add(path);
  }
  return refused;
}

/**
 * Rolls an import batch back from its change log (docs/MIGRATION_PLAN.md, section 6). Capability:
 * `imports.rollback` for the programme, which is sensitive: programme administrators hold it,
 * and the core team only where an administrator has switched it on, always with the second
 * factor where the access document requires one.
 *
 * What happens to each document is decided by `planBatchRollback` of the shared package, the
 * logic that the command `import rollback` of the tools uses, and the writes follow the tools:
 * each carries the update time it was planned against as a precondition, so a document that
 * changes in the meantime stops the rollback instead of being overwritten, and a rollback that
 * stopped is carried on by asking again. Without `confirm` nothing is written and the answer
 * lists what would change. With it, the batch is reversed, its status becomes `rolledBack`, a
 * line is added to its log, and the audit entry is written with that last step.
 */
export const rollbackImportBatch = defineCallable(rollbackImportBatchContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "imports.rollback", "programme");

    const batchReference = db.doc(COLLECTIONS.importBatches.docPath(input.batchId));
    const batch = await batchReference.get();
    if (!batch.exists) throw new AppError("not-found", "This import batch does not exist.");
    if (batch.get("mode") !== "apply") {
      return { status: "nothingToReverse" as const, reason: "It is a preview, which wrote no record." };
    }
    if (batch.get("status") === "rolledBack") {
      return { status: "nothingToReverse" as const, reason: "It has been rolled back already." };
    }

    const log = await db.collection(COLLECTIONS.importBatchChanges.collectionPath(input.batchId)).get();
    const entries = log.docs.sort((a, b) => (a.id < b.id ? 1 : -1));
    const marked = (entry: (typeof entries)[number]) => [entry.get("before"), entry.get("after")].some(isWithheldState);
    const statePath = (id: string) => COLLECTIONS.importBatchChangeState.docPath(input.batchId, id);
    const special = await readAll(
      db,
      entries.filter(marked).map((entry) => statePath(entry.id)),
    );
    // A removal for good keeps no state on purpose, and stays removed.
    const irreversible = (entry: (typeof entries)[number]) => entry.get("irreversible") === true;
    const stateless = entries.filter(
      (entry) => marked(entry) && !irreversible(entry) && special.get(statePath(entry.id))?.exists !== true,
    );
    if (stateless.length > 0) {
      return {
        status: "refused" as const,
        changedDocuments: stateless
          .map((entry) => entry.ref.path)
          .sort()
          .slice(0, LISTED),
      };
    }
    const states: ChangeState[] = entries.map((entry) => {
      const kept = special.get(statePath(entry.id));
      const keptData = kept?.exists === true ? kept.data() : undefined;
      return {
        path: (keptData?.documentPath as string | undefined) ?? (entry.get("documentPath") as string),
        before: (keptData === undefined ? entry.get("before") : keptData.before) as Record<string, unknown> | null,
        after: (keptData === undefined ? entry.get("after") : keptData.after) as Record<string, unknown> | null,
        irreversible: irreversible(entry),
      };
    });
    const current = await readAll(
      db,
      states.map((state) => state.path),
    );
    const plan = planBatchRollback({
      states,
      current: new Map([...current].map(([path, snapshot]) => [path, snapshot.data() ?? null])),
      equal: isDeepStrictEqual,
      itemsPrefix: `${COLLECTIONS.reconciliationItems.collectionPath()}/`,
      withoutConsent: await specialWithoutConsent(db, states),
    });
    if (plan.status === "refused") {
      return { status: "refused" as const, changedDocuments: plan.changedDocuments.slice(0, LISTED) };
    }
    if (!input.confirm) {
      const documents = plan.steps.flatMap((step) => {
        const action = ACTION_OF[step.kind];
        return action === null ? [] : [{ path: step.path, action }];
      });
      return {
        status: "planned" as const,
        counts: plan.counts,
        documents: documents.slice(0, LISTED),
        truncated: documents.length > LISTED,
      };
    }

    const now = Timestamp.fromDate(at);
    for (const piece of chunked(plan.steps)) {
      const write = db.batch();
      for (const step of piece) {
        const reference = db.doc(step.path);
        const stored = current.get(step.path);
        const precondition: Precondition =
          stored?.exists === true && stored.updateTime !== undefined ? { lastUpdateTime: stored.updateTime } : {};
        switch (step.kind) {
          case "skip":
          case "keep":
          case "discard":
            break;
          case "withdraw":
            write.update(
              reference,
              {
                status: "withdrawn",
                resolvedBy: uid,
                resolvedAt: now,
                ...touchedFields(callerStamp(uid, at, null)),
              },
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
            write.create(reference, step.data);
            break;
          case "restore":
            write.update(
              reference,
              { ...step.set, ...Object.fromEntries(step.remove.map((field) => [field, FieldValue.delete()])) },
              precondition,
            );
            break;
        }
      }
      await write.commit();
    }

    const logCount = await db.collection(COLLECTIONS.importBatchLog.collectionPath(input.batchId)).count().get();
    const finish = db.batch();
    const auditEventId = writeAudit(
      finish,
      {
        action: "importBatch.rolledBack",
        actor: { kind: "user", uid },
        entityType: "importBatch",
        entityId: input.batchId,
        changes: [
          { field: "status", before: batch.get("status") ?? null, after: "rolledBack" },
          { field: "restored", after: plan.counts.restored },
          { field: "removed", after: plan.counts.removed },
          { field: "itemsWithdrawn", after: plan.counts.itemsWithdrawn },
          { field: "itemsLeft", after: plan.counts.itemsLeft },
          { field: "discarded", after: plan.counts.discarded },
        ],
        at,
      },
      db,
    );
    const stamp = callerStamp(uid, at, auditEventId);
    finish.update(batchReference, { status: "rolledBack", ...touchedFields(stamp) });
    finish.create(
      db.doc(COLLECTIONS.importBatchLog.docPath(input.batchId, sequenceId(logCount.data().count + 1))),
      COLLECTIONS.importBatchLog.schema.parse({
        schemaVersion: COLLECTIONS.importBatchLog.schemaVersion,
        createdAt: now,
        createdBy: uid,
        writeContext: stamp.writeContext,
        batchId: input.batchId,
        level: "info",
        message:
          `Rolled back in the portal: ${plan.counts.restored} documents restored, ${plan.counts.removed} removed, ` +
          `${plan.counts.itemsWithdrawn} items withdrawn, ${plan.counts.itemsLeft} decided items left in place. ` +
          "Source records were kept.",
      }),
    );
    await finish.commit();
    for (const piece of chunked([...special.keys()])) {
      const clean = db.batch();
      for (const path of piece) clean.delete(db.doc(path));
      await clean.commit();
    }
    return { status: "rolledBack" as const, counts: plan.counts };
  },
});
