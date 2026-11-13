// migrate:sealed-outcomes [--apply] [--production --project <identifier>]
//
// Brings what imports wrote before the programme sealed the outcome labels of source E and the
// summary figures of source F (docs/MIGRATION_PLAN.md, section 11, questions 7 and 14) under the
// seal. Without `--apply` it reports what it would change and writes nothing.
//
// | Step | What it changes                                                                      |
// |------|--------------------------------------------------------------------------------------|
// | 1    | Moves `replicatedSource` out of `replications/{studyKey}/private/detail`, which the team of the replication reads, into `predictionMarketOutcomes/{studyKey}`, in one transaction for each replication |
// | 2    | Takes `replicatedSource` out of both states of every change-log entry that holds it, and marks the entry sealed; every other entry is marked not sealed, so that the core team lists it again |
// | 3    | Takes the shown value out of every candidate that states a label or a summary figure, and marks the item sealed; every other item is marked not sealed |
// | 4    | Names the decision that seals them on the historical aggregates of source F          |
//
// The command is idempotent: a second run finds nothing to change. A replication whose sealed
// document exists already keeps it, and the field is removed from its detail document, because the
// import wrote the sealed document from the same rows. It reports identifiers and counts only,
// never a label or a figure. The way back is to restore the export taken before `--apply`
// (README, "Migrations").
import {
  COLLECTIONS,
  INITIAL_SCHEMA_VERSION,
  SEALED_OUTCOMES_DECISION,
  SEALED_SUMMARY_DECISION,
  SEALED_SUMMARY_SOURCE_KEY,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp, type WriteBatch } from "firebase-admin/firestore";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";
import { readDocuments } from "../import/context";
import { statesSealedValue } from "../import/reconcile";

/** The actor recorded on what the migration writes. */
export const SEALED_OUTCOMES_MIGRATION_ACTOR = systemActor("sealedOutcomesMigration");

export interface SealedOutcomesMigrationSummary {
  /** The replications whose labels were moved, or would be in a dry run. */
  readonly moved: string[];
  /** The replications whose sealed document existed, and whose detail document only lost the field. */
  readonly cleared: string[];
  /** Change-log entries that held labels, which lose them and are marked sealed. */
  readonly entriesSealed: number;
  /** Change-log entries without the flag that hold no sealed value, which are marked not sealed. */
  readonly entriesMarked: number;
  /** Review items about a label or a summary figure, which lose any shown value and are marked sealed. */
  readonly itemsSealed: number;
  /** Review items without the flag that are about no sealed value, which are marked not sealed. */
  readonly itemsMarked: number;
  /** Historical aggregates of source F that are given the decision that seals them. */
  readonly aggregatesSealed: number;
}

/** The source of a candidate: its key without the hash after the last colon. */
const claimSourceOf = (key: string): string => key.slice(0, Math.max(0, key.lastIndexOf(":")));

/** Whether a candidate of an item states a sealed value. */
const sealedCandidate = (candidate: Record<string, unknown>, field: string | undefined): boolean =>
  statesSealedValue(claimSourceOf(String(candidate.key)), field);

const withoutLabels = (state: unknown): unknown => {
  if (typeof state !== "object" || state === null || !("replicatedSource" in state)) return state;
  const { replicatedSource: _labels, ...kept } = state as Record<string, unknown>;
  const imported = kept.importedValues;
  if (typeof imported === "object" && imported !== null && "replicatedSource" in imported) {
    const { replicatedSource: _imported, ...rest } = imported as Record<string, unknown>;
    kept.importedValues = rest;
  }
  return kept;
};

const holdsLabels = (state: unknown): boolean =>
  typeof state === "object" && state !== null && "replicatedSource" in state;

/** Writes in batches of a bounded size. */
class Writer {
  #batch: WriteBatch | null = null;
  #count = 0;
  constructor(private readonly db: Firestore) {}
  async update(path: string, data: Record<string, unknown>): Promise<void> {
    this.#batch ??= this.db.batch();
    this.#batch.update(this.db.doc(path), data);
    this.#count += 1;
    if (this.#count >= 400) await this.flush();
  }
  async flush(): Promise<void> {
    if (this.#batch !== null) await this.#batch.commit();
    this.#batch = null;
    this.#count = 0;
  }
}

/** Moves the labels of every replication that still holds them in its restricted document. */
export async function migrateSealedOutcomes(
  db: Firestore,
  options: { readonly apply: boolean; readonly now?: Date },
): Promise<SealedOutcomesMigrationSummary> {
  const at = Timestamp.fromDate(options.now ?? new Date());
  const replications = await db.collection(COLLECTIONS.replications.collectionPath()).listDocuments();
  const summary = {
    moved: [] as string[],
    cleared: [] as string[],
    entriesSealed: 0,
    entriesMarked: 0,
    itemsSealed: 0,
    itemsMarked: 0,
    aggregatesSealed: 0,
  };
  for (const replication of replications.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const studyKey = replication.id;
    const detail = await db.doc(COLLECTIONS.replicationDetail.docPath(studyKey)).get();
    if (!detail.exists || detail.get("replicatedSource") === undefined) continue;
    const sealedReference = db.doc(COLLECTIONS.predictionMarketOutcomes.docPath(studyKey));
    const sealed = await sealedReference.get();
    (sealed.exists ? summary.cleared : summary.moved).push(studyKey);
    if (!options.apply) continue;
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(detail.ref);
      const labels: unknown = current.get("replicatedSource");
      if (labels === undefined) return;
      const exists = (await transaction.get(sealedReference)).exists;
      if (!exists) {
        transaction.create(
          sealedReference,
          COLLECTIONS.predictionMarketOutcomes.schema.parse({
            schemaVersion: INITIAL_SCHEMA_VERSION,
            createdAt: at,
            updatedAt: at,
            createdBy: SEALED_OUTCOMES_MIGRATION_ACTOR,
            updatedBy: SEALED_OUTCOMES_MIGRATION_ACTOR,
            archivedAt: null,
            writeContext: systemWriteContext(),
            replicationId: studyKey,
            labelsSource: labels,
            sealedBy: SEALED_OUTCOMES_DECISION,
            ...(Array.isArray(current.get("sourceRecordIds"))
              ? { sourceRecordIds: current.get("sourceRecordIds") }
              : {}),
          }),
        );
      }
      const imported = current.get("importedValues") as Record<string, unknown> | undefined;
      transaction.update(detail.ref, {
        replicatedSource: FieldValue.delete(),
        ...(imported !== undefined && "replicatedSource" in imported
          ? { "importedValues.replicatedSource": FieldValue.delete() }
          : {}),
        updatedAt: at,
        updatedBy: SEALED_OUTCOMES_MIGRATION_ACTOR,
        writeContext: systemWriteContext(),
      });
    });
  }

  const writer = new Writer(db);
  // Step 2: the change log. An entry that names a detail document holds the labels in its states.
  const batches = await db.collection(COLLECTIONS.importBatches.collectionPath()).listDocuments();
  for (const batch of batches.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const entries = await db.collection(COLLECTIONS.importBatchChanges.collectionPath(batch.id)).get();
    for (const entry of entries.docs) {
      const before: unknown = entry.get("before");
      const after: unknown = entry.get("after");
      if (holdsLabels(before) || holdsLabels(after)) {
        summary.entriesSealed += 1;
        if (options.apply)
          await writer.update(entry.ref.path, {
            before: withoutLabels(before),
            after: withoutLabels(after),
            sealed: true,
          });
      } else if (typeof entry.get("sealed") !== "boolean") {
        summary.entriesMarked += 1;
        if (options.apply) await writer.update(entry.ref.path, { sealed: false });
      }
    }
  }

  // Step 3: the review queue.
  const items = await db.collection(COLLECTIONS.reconciliationItems.collectionPath()).get();
  for (const item of items.docs) {
    const candidates = (item.get("candidates") as Record<string, unknown>[] | undefined) ?? [];
    const field = item.get("field") as string | undefined;
    const sealed = candidates.some((candidate) => sealedCandidate(candidate, field));
    const shown = candidates.some(
      (candidate) => sealedCandidate(candidate, field) && candidate.valueSource !== undefined,
    );
    if (sealed && (item.get("sealed") !== true || shown)) {
      summary.itemsSealed += 1;
      if (options.apply) {
        await writer.update(item.ref.path, {
          candidates: candidates.map((candidate) => {
            if (!sealedCandidate(candidate, field)) return candidate;
            const { valueSource: _shown, ...kept } = candidate;
            return kept;
          }),
          sealed: true,
        });
      }
    } else if (!sealed && typeof item.get("sealed") !== "boolean") {
      summary.itemsMarked += 1;
      if (options.apply) await writer.update(item.ref.path, { sealed: false });
    }
  }

  // Step 4: the decision on the figures of source F.
  const aggregates = await db.collection(COLLECTIONS.historicalAggregates.collectionPath()).get();
  const unsealed = aggregates.docs.filter(
    (doc) => doc.get("sealedBy") === undefined && doc.get("dataOrigin") === "importedHistorical",
  );
  const records = await readDocuments(
    db,
    unsealed.map((doc) => COLLECTIONS.sourceRecords.docPath(String(doc.get("sourceRecordId")))),
  );
  for (const doc of unsealed) {
    const record = records.get(COLLECTIONS.sourceRecords.docPath(String(doc.get("sourceRecordId"))));
    if (record?.data.sourceKey !== SEALED_SUMMARY_SOURCE_KEY) continue;
    summary.aggregatesSealed += 1;
    if (options.apply) await writer.update(doc.ref.path, { sealedBy: SEALED_SUMMARY_DECISION });
  }
  await writer.flush();
  return summary;
}

const USAGE = "Usage: migrate:sealed-outcomes [--apply] [--production --project <identifier>]";

export const migrateSealedOutcomesCommand: Command = {
  name: "migrate:sealed-outcomes",
  summary: "Bring what imports wrote before the seal of questions 7 and 14 under it. Dry run without --apply.",
  async run(args) {
    let apply = false;
    let production = false;
    let projectId: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--apply") apply = true;
      else if (argument === "--production") production = true;
      else if (argument === "--project") {
        projectId = args[index + 1];
        if (projectId === undefined || projectId.startsWith("--"))
          throw new ToolRefusal(`--project needs a value.\n\n${USAGE}`);
        index += 1;
      } else throw new ToolRefusal(USAGE);
    }
    const target = requireImportTarget({ production, ...(projectId === undefined ? {} : { projectId }) });
    let db: Firestore;
    if (target.kind === "production") db = connectToProject(target.projectId).db;
    else {
      await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
      db = connectToEmulators(target).db;
    }
    const summary = await migrateSealedOutcomes(db, { apply });
    console.log(
      `migrate:sealed-outcomes in ${target.projectId} (${apply ? "applied" : "dry run, nothing written"}): ` +
        `${summary.moved.length} replication(s) ${apply ? "moved" : "to move"}, ${summary.cleared.length} with a sealed document already; ` +
        `change-log entries: ${summary.entriesSealed} sealed, ${summary.entriesMarked} marked not sealed; ` +
        `review items: ${summary.itemsSealed} sealed, ${summary.itemsMarked} marked not sealed; ` +
        `${summary.aggregatesSealed} figure(s) of source F given the decision that seals them.`,
    );
    for (const studyKey of [...summary.moved, ...summary.cleared]) console.log(`  ${studyKey}`);
    return undefined;
  },
};
