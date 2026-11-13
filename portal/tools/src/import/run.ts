// One run of an importer, from reading the input to the finished batch record
// (docs/MIGRATION_PLAN.md, section 2).
//
// | Stage     | Preview                                   | Apply                                      |
// |-----------|-------------------------------------------|--------------------------------------------|
// | Read      | The importer reads and classifies         | The same                                   |
// | Snapshot  | Source records are written when new       | The same                                   |
// | Plan      | The importer plans, the framework adds the items for rows and documents that have gone | The same |
// | Compare   | The diff against the database             | The same                                   |
// | Write     | Only items that explain a blocked batch   | Every change, each with its log entry      |
//
// A run on an unchanged source writes its own batch record and nothing else.
import { COLLECTIONS, type CollectionKey, importBatchId, type ReconciliationKind, sequenceId } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { ToolRefusal } from "../environment";
import { applyBlockingItems, applyDiff, ImportStopped } from "./apply";
import {
  appendOnlyFields,
  chunked,
  createdFields,
  entryOf,
  IMPORT_ACTOR,
  type RunContext,
  readDocuments,
  updatedFields,
  validated,
} from "./context";
import { IdentityResolver } from "./identity";
import { requireOutsideRepository } from "./local-export";
import type {
  BlockingCheck,
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  PlannedItem,
  RecordedRow,
  RowClass,
  SourceReading,
} from "./model";
import { PlanBuilder } from "./plan";
import { comparePlan, entityRefOf, type ItemAction, type PlanDiff } from "./preview";
import { guardPlan, withGuard } from "./privacy-guard";
import { type ItemBuilders, itemBuilders } from "./reconcile";
import { type PrivateLocations, sourceDefinition, syncRegistry } from "./registry";
import { compareSnapshot, recordRows, type SnapshotState, writeSnapshot } from "./snapshot";
import { StudyResolver } from "./studies";
import { canonicalJson } from "./values";
import { DEFAULT_TARGET, type RunTarget, requireReleased, writesWithheld } from "./withheld";

export interface TabAccount {
  readonly tabKey: string;
  /** The rows of each class. Filler and blank rows are counted and not stored. */
  readonly rows: Readonly<Record<RowClass, number>>;
  /** Cells that are recorded by themselves, such as a footnote. They count as no row. */
  readonly cellAnnotations: number;
  /** Data rows that a planned document names. */
  readonly imported: number;
  /** Data rows that only a reconciliation item names: held in the queue. */
  readonly queued: number;
  /** Data rows that are kept as source records only, by the reason the importer gives. */
  readonly rawOnly: Readonly<Record<string, number>>;
  /** Data rows that nothing accounts for. Any such row fails the run. */
  readonly unaccounted: number;
}

export interface CollectionAccount {
  created: number;
  changed: number;
  /** Documents that the run removes: the special-category cells of a row once they stand in their own document. */
  removed: number;
  /** Documents whose values stay and whose source records are brought up to date. */
  matched: number;
  unchanged: number;
  /** How many documents each field changes in. Values are never reported. */
  fields: Record<string, number>;
}

export interface RunReport {
  readonly batchId: string;
  readonly sourceKey: string;
  readonly mode: "preview" | "apply";
  readonly status: "previewed" | "applied" | "failed";
  readonly blocking: readonly BlockingCheck[];
  readonly tabs: readonly TabAccount[];
  readonly sourceRecords: {
    readonly created: number;
    readonly superseded: number;
    readonly missing: number;
    readonly seen: number;
  };
  readonly collections: Readonly<Partial<Record<CollectionKey, CollectionAccount>>>;
  readonly items: Readonly<Record<ItemAction, Partial<Record<ReconciliationKind, number>>>> & {
    readonly standing: number;
  };
  /** Fields that were left alone because the live value differs from the source. */
  readonly conflicts: number;
  /**
   * Rows whose special-category cells were discarded without being stored, because their person
   * has given no consent to holding them or is not known yet. A count, which names nobody.
   */
  readonly specialCategoryDiscarded: number;
  /** Changes written with a log entry. Always 0 for a preview that is not blocked. */
  readonly changesCommitted: number;
  /** Every document written by the run except its own batch record. */
  readonly documentsWritten: number;
  readonly planHash: string;
}

export interface RunOptions {
  readonly db: Firestore;
  readonly importer: ImporterDefinition;
  readonly input: ImportInput;
  readonly mode: "preview" | "apply";
  /** The secret of the keyed hash. */
  readonly secret: string;
  /** The private locations of the sources, where the configuration names them. */
  readonly locations?: PrivateLocations;
  /** A previewed batch that the apply must match. */
  readonly previewBatchId?: string;
  /** Where the run writes. Without it: the emulators, with no withheld output rehearsed. */
  readonly target?: RunTarget;
  /**
   * `notChecked` lets a source run before the sources that the plan puts ahead of it. It is for
   * the test or the rehearsal of one importer by itself, and the command line never says it.
   */
  readonly order?: "required" | "notChecked";
  readonly now?: Date;
}

/** The plan of a reading that could not be interpreted: one blocking item for each structural failure. */
function planOfIssues(sourceKey: string, reading: SourceReading, items: ItemBuilders): ImportPlan {
  const builder = new PlanBuilder();
  for (const issue of reading.issues) {
    builder.block(
      issue.check,
      issue.message,
      items.structureChange({
        subject: `${sourceKey}/${issue.tabKey ?? "source"}/${issue.check}`,
        claims: [
          { source: "expected", value: issue.expected, valueSource: issue.expected },
          { source: "found", value: issue.found, valueSource: issue.found },
        ],
        blocking: true,
      }),
    );
  }
  return builder.build();
}

/** A row that has gone together with the row that probably replaces it under another key. */
interface RenamePair {
  readonly gone: { readonly id: string; readonly tabKey: string; readonly rowKey: string };
  readonly row: RecordedRow;
  readonly item: PlannedItem;
}

/**
 * Pairs a row that has gone from the source with a data row of the same tab whose cells equal
 * its cells in every column but one: a renamed natural key (docs/MIGRATION_PLAN.md, section 6).
 * The two are presented together in one item, and the new row waits in the queue instead of
 * creating a second record beside the first. A row counts as new while this run sees it for the
 * first time, or while the item that pairs it is open or resolved. An item that a reviewer has
 * dismissed says that the rows are two records, and the new row is imported.
 */
async function probableRenames(
  context: RunContext,
  rows: ReadonlyMap<string, readonly RecordedRow[]>,
  state: SnapshotState,
  items: ItemBuilders,
): Promise<RenamePair[]> {
  if (state.missing.length === 0) return [];
  const stored = await readDocuments(
    context.db,
    state.missing.map((record) => COLLECTIONS.sourceRecords.docPath(record.id)),
  );
  const created = new Set(state.created.map((row) => row.recordId));
  const candidates: { readonly gone: RenamePair["gone"]; readonly row: RecordedRow; readonly item: PlannedItem }[] = [];
  for (const gone of state.missing) {
    const raw = stored.get(COLLECTIONS.sourceRecords.docPath(gone.id))?.data.raw as Record<string, unknown> | undefined;
    if (raw === undefined) continue;
    const labels = Object.keys(raw).sort();
    for (const row of rows.get(gone.tabKey) ?? []) {
      if (row.rowClass !== "data" || row.cellLevel === true || row.rowKey === gone.rowKey) continue;
      if (canonicalJson([...row.labels].sort()) !== canonicalJson(labels)) continue;
      const differing = row.labels.filter(
        (label, index) => canonicalJson(raw[label] ?? null) !== canonicalJson(row.cells[index] ?? null),
      );
      if (differing.length !== 1) continue;
      const source = `${context.sourceKey}/${gone.tabKey}`;
      candidates.push({
        gone,
        row,
        item: items.missingFromSource({
          subject: `${source}/rename/${gone.id}`,
          claims: [
            { source: `${source}/gone`, value: gone.id, sourceRecordId: gone.id },
            { source: `${source}/renamedTo`, value: row.recordId, sourceRecordId: row.recordId },
          ],
        }),
      });
    }
  }
  // One row that could replace two, and two rows that could replace one, are no pair. Each is then treated by itself.
  const count = <Key>(keys: readonly Key[]) => {
    const counts = new Map<Key, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const perGone = count(candidates.map((candidate) => candidate.gone.id));
  const perRow = count(candidates.map((candidate) => candidate.row.recordId));
  const single = candidates.filter(
    (candidate) => perGone.get(candidate.gone.id) === 1 && perRow.get(candidate.row.recordId) === 1,
  );
  const standing = await readDocuments(
    context.db,
    single
      .filter((candidate) => !created.has(candidate.row.recordId))
      .map((candidate) => COLLECTIONS.reconciliationItems.docPath(candidate.item.fingerprint)),
  );
  return single.filter((candidate) => {
    if (created.has(candidate.row.recordId)) return true;
    const status = standing.get(COLLECTIONS.reconciliationItems.docPath(candidate.item.fingerprint))?.data.status;
    return status === "open" || status === "resolved";
  });
}

/**
 * Adds the items for what has gone from the source: a row that is absent from the reading, and a
 * document that an earlier revision of a row produced and that the plan no longer produces, as
 * an alias does whose value has changed. A row that has gone and the row that probably replaces
 * it are named in one item. Nothing is deleted. A person decides.
 */
async function withDepartures(
  context: RunContext,
  plan: ImportPlan,
  state: SnapshotState,
  items: ItemBuilders,
  renames: readonly RenamePair[],
): Promise<ImportPlan> {
  const gone = [...state.missing.map((record) => record.id), ...state.retired];
  if (gone.length === 0) return plan;
  const planned = new Set(plan.documents.map((document) => document.path));
  const itemsPrefix = `${COLLECTIONS.reconciliationItems.collectionPath()}/`;
  const derived = new Map<string, Set<string>>();
  // The change log names the source records behind every write, which gives the documents derived from a record.
  for (const piece of chunked(gone, 30)) {
    const entries = await context.db
      .collectionGroup("changes")
      .where("sourceRecordIds", "array-contains-any", piece)
      .get();
    for (const entry of entries.docs) {
      const path = entry.get("documentPath") as string;
      // The entry of a special-category document names its collection only, and no document.
      if (planned.has(path) || path.startsWith(itemsPrefix) || path.includes("{")) continue;
      for (const id of entry.get("sourceRecordIds") as string[]) {
        if (!piece.includes(id)) continue;
        const paths = derived.get(id) ?? new Set<string>();
        paths.add(path);
        derived.set(id, paths);
      }
    }
  }
  // A document that a rollback has removed since is no longer something the source produced.
  const stored = await readDocuments(
    context.db,
    [...derived.values()].flatMap((paths) => [...paths]),
  );
  for (const paths of derived.values()) {
    for (const path of paths) if (stored.get(path) === null) paths.delete(path);
  }
  const refOfPath = (path: string) => {
    const segments = path.split("/");
    const entry = Object.values(COLLECTIONS).find(
      (candidate) =>
        candidate.path.split("/").length === segments.length &&
        candidate.path.split("/").every((part, index) => part.startsWith("{") || part === segments[index]),
    );
    if (entry === undefined) return null;
    const ids = entry.path.split("/").flatMap((part, index) => (part.startsWith("{") ? [segments[index] ?? ""] : []));
    return entityRefOf(entry.key, ids);
  };
  const renamed = new Map(renames.map((pair) => [pair.gone.id, pair]));
  const additions = [];
  for (const record of state.missing) {
    const paths = [...(derived.get(record.id) ?? [])].sort();
    const pair = renamed.get(record.id);
    if (pair !== undefined) {
      // The two rows are one question. The records that the earlier row produced are named, and none is touched.
      additions.push({ ...pair.item, entityRefs: paths.flatMap((path) => refOfPath(path) ?? []) });
      continue;
    }
    additions.push(
      items.missingFromSource({
        subject: `${context.sourceKey}/${record.tabKey}/${record.id}`,
        entityRefs: paths.flatMap((path) => refOfPath(path) ?? []),
        claims: [
          { source: `${context.sourceKey}/${record.tabKey}`, value: record.id, sourceRecordId: record.id },
          ...paths.map((path) => ({ source: "document", value: path, valueSource: path, sourceRecordId: record.id })),
        ],
      }),
    );
  }
  for (const id of state.retired) {
    for (const path of [...(derived.get(id) ?? [])].sort()) {
      additions.push(
        items.missingFromSource({
          subject: path,
          entityRefs: [refOfPath(path)].flatMap((ref) => ref ?? []),
          claims: [{ source: "document", value: path, valueSource: path, sourceRecordId: id }],
        }),
      );
    }
  }
  const fingerprints = new Set(plan.items.map((item) => item.fingerprint));
  return { ...plan, items: [...plan.items, ...additions.filter((item) => !fingerprints.has(item.fingerprint))] };
}

/** Accounts for every row of every tab: its class and, for a data row, what became of it. */
export function accountRows(
  reading: SourceReading,
  rows: ReadonlyMap<string, readonly RecordedRow[]>,
  plan: ImportPlan,
  interpreted: boolean,
): TabAccount[] {
  const imported = new Set(plan.documents.flatMap((document) => document.sourceRecordIds));
  const queued = new Set(
    plan.items.flatMap((item) => item.candidates.flatMap((candidate) => candidate.sourceRecordId ?? [])),
  );
  return reading.tabs.map((tab) => {
    const counts: Record<RowClass, number> = {
      header: 0,
      banner: 0,
      data: 0,
      annotation: 0,
      derived: 0,
      placeholder: 0,
      filler: tab.fillerRows,
      blank: tab.blankRows,
    };
    const account = {
      imported: 0,
      queued: 0,
      unaccounted: 0,
      cellAnnotations: 0,
      rawOnly: {} as Record<string, number>,
    };
    for (const row of rows.get(tab.tabKey) ?? []) {
      if (row.cellLevel === true) {
        account.cellAnnotations += 1;
        continue;
      }
      counts[row.rowClass] += 1;
      if (row.rowClass !== "data") continue;
      const reason = plan.rawOnly.get(row.recordId);
      const waits = queued.has(row.recordId);
      if (waits && plan.held.has(row.recordId)) account.queued += 1;
      else if (imported.has(row.recordId)) account.imported += 1;
      else if (waits) account.queued += 1;
      else if (reason !== undefined) account.rawOnly[reason] = (account.rawOnly[reason] ?? 0) + 1;
      else if (!interpreted) account.rawOnly.blocked = (account.rawOnly.blocked ?? 0) + 1;
      else account.unaccounted += 1;
    }
    return { tabKey: tab.tabKey, rows: counts, ...account };
  });
}

function summarise(diff: PlanDiff): Pick<RunReport, "collections" | "items"> {
  const collections: Partial<Record<CollectionKey, CollectionAccount>> = {};
  const of = (collection: CollectionKey) => {
    collections[collection] ??= { created: 0, changed: 0, removed: 0, matched: 0, unchanged: 0, fields: {} };
    return collections[collection];
  };
  for (const change of diff.changes) {
    const account = of(change.collection);
    if (change.operation === "create") account.created += 1;
    else if (change.operation === "delete") account.removed += 1;
    else if (change.relation === "matched") account.matched += 1;
    else {
      account.changed += 1;
      // Which field of a special-category document changes is said to nobody: the count of documents is enough.
      if (entryOf(change.collection).dataClass === "special") continue;
      for (const field of change.changedFields) account.fields[field] = (account.fields[field] ?? 0) + 1;
    }
  }
  for (const [collection, count] of diff.unchanged) of(collection).unchanged = count;
  const items: Record<ItemAction, Partial<Record<ReconciliationKind, number>>> = {
    raise: {},
    reopen: {},
    supersede: {},
    clear: {},
  };
  for (const change of diff.itemChanges) {
    const kind = change.kind as ReconciliationKind;
    items[change.action][kind] = (items[change.action][kind] ?? 0) + 1;
  }
  return { collections, items: { ...items, standing: diff.itemsStanding } };
}

/** The counts of a report as the batch record stores them. */
function statsOf(report: Omit<RunReport, "status">): Record<string, number> {
  const stats: Record<string, number> = {
    changesCommitted: report.changesCommitted,
    documentsWritten: report.documentsWritten,
    blocking: report.blocking.length,
    conflicts: report.conflicts,
    specialCategoryDiscarded: report.specialCategoryDiscarded,
    "sourceRecords:created": report.sourceRecords.created,
    "sourceRecords:superseded": report.sourceRecords.superseded,
    "sourceRecords:missing": report.sourceRecords.missing,
    "sourceRecords:seen": report.sourceRecords.seen,
    "items:standing": report.items.standing,
  };
  for (const tab of report.tabs) {
    for (const [rowClass, count] of Object.entries(tab.rows))
      if (count > 0) stats[`rows:${tab.tabKey}:${rowClass}`] = count;
    if (tab.cellAnnotations > 0) stats[`rows:${tab.tabKey}:cellAnnotations`] = tab.cellAnnotations;
    stats[`rows:${tab.tabKey}:imported`] = tab.imported;
    stats[`rows:${tab.tabKey}:queued`] = tab.queued;
    for (const [reason, count] of Object.entries(tab.rawOnly)) stats[`rows:${tab.tabKey}:rawOnly:${reason}`] = count;
  }
  for (const [collection, account] of Object.entries(report.collections)) {
    for (const key of ["created", "changed", "removed", "matched", "unchanged"] as const) {
      if (account[key] > 0) stats[`${key}:${collection}`] = account[key];
    }
  }
  for (const action of ["raise", "reopen", "supersede", "clear"] as const) {
    for (const [kind, count] of Object.entries(report.items[action])) stats[`items:${action}:${kind}`] = count;
  }
  return stats;
}

/** What a run computes before it writes any change: the reading, the snapshot comparison, the plan and the diff. */
export interface Computation {
  readonly reading: SourceReading;
  readonly rows: Map<string, RecordedRow[]>;
  readonly state: SnapshotState;
  readonly plan: ImportPlan;
  readonly diff: PlanDiff;
  readonly tabs: TabAccount[];
}

/** Plans and compares. Reads only, so a verification can call it as well as a run. */
export async function compute(
  context: RunContext,
  importer: ImporterDefinition,
  input: ImportInput,
  secret: string,
  reading: SourceReading,
  rows: Map<string, RecordedRow[]>,
  state: SnapshotState,
  target: RunTarget = DEFAULT_TARGET,
): Promise<Computation> {
  const items = itemBuilders(secret);
  const interpreted = reading.issues.length === 0;
  // A row that probably replaces a row which has gone waits in the queue. The importer plans without it.
  const renames = interpreted ? await probableRenames(context, rows, state, items) : [];
  const waiting = new Set(renames.map((pair) => pair.row.recordId));
  const visible =
    waiting.size === 0
      ? rows
      : new Map([...rows].map(([tabKey, tab]) => [tabKey, tab.filter((row) => !waiting.has(row.recordId))]));
  const stated = interpreted
    ? await importer.plan({
        sourceKey: importer.sourceKey,
        input,
        rows: visible,
        secret,
        studies: new StudyResolver(context.db),
        identities: new IdentityResolver(context.db, secret),
        items,
        db: context.db,
        writes: (output) => writesWithheld(target, output),
      })
    : planOfIssues(importer.sourceKey, reading, items);
  // Nothing that fails the guard is compared with the database, let alone written.
  const drafted = interpreted ? withGuard(stated, guardPlan(stated, rows), importer.sourceKey, items) : stated;
  const departed =
    interpreted && drafted.blocking.length === 0
      ? await withDepartures(context, drafted, state, items, renames)
      : drafted;
  const plan: ImportPlan =
    waiting.size === 0 || departed.blocking.length > 0
      ? departed
      : { ...departed, held: new Set([...departed.held, ...waiting]) };
  const tabs = accountRows(reading, rows, plan, interpreted && plan.blocking.length === 0);
  const unaccounted = tabs.filter((tab) => tab.unaccounted > 0);
  if (unaccounted.length > 0) {
    throw new Error(
      `The importer of source ${importer.sourceKey} drops rows silently: ` +
        unaccounted.map((tab) => `${tab.unaccounted} data rows of tab ${tab.tabKey}`).join(", ") +
        " are named by no document, no item and no reason for keeping them raw.",
    );
  }
  const diff = await comparePlan(context, plan, {
    ownRecordIds: state.ownRecordIds,
    items,
    complete: plan.blocking.length === 0,
    specialRows: [...rows.values()].flat().filter((row) => Object.keys(row.special ?? {}).length > 0),
  });
  return { reading, rows, state, plan, diff, tabs };
}

/**
 * Refuses a run while a source that the plan puts ahead of this one has no applied batch
 * (docs/MIGRATION_PLAN.md, section 5). The order decides which source creates a record and which
 * source a shared field follows, so it is no choice of the operator.
 */
async function requireOrder(db: Firestore, importer: ImporterDefinition): Promise<void> {
  const waitingFor: string[] = [];
  for (const sourceKey of importer.after ?? []) {
    const applied = await db
      .collection(COLLECTIONS.importBatches.collectionPath())
      .where("sourceKey", "==", sourceKey)
      .where("mode", "==", "apply")
      .where("status", "==", "applied")
      .limit(1)
      .get();
    if (applied.empty) waitingFor.push(sourceKey);
  }
  if (waitingFor.length > 0) {
    throw new ToolRefusal(
      `Refusing to run: source ${importer.sourceKey} is imported after ${waitingFor.length === 1 ? "source" : "sources"} ` +
        `${waitingFor.join(", ")} (docs/MIGRATION_PLAN.md, section 5), and no applied batch of ${waitingFor.join(", ")} exists. ` +
        "Apply the earlier sources first.",
    );
  }
}

async function requireMatchingPreview(
  db: Firestore,
  previewBatchId: string,
  sourceKey: string,
  reading: SourceReading,
  diff: PlanDiff,
) {
  const preview = await db.doc(COLLECTIONS.importBatches.docPath(previewBatchId)).get();
  const problem = !preview.exists
    ? "it does not exist"
    : preview.get("mode") !== "preview" || preview.get("sourceKey") !== sourceKey
      ? "it is no preview of this source"
      : preview.get("contentHash") !== reading.contentHash
        ? "it read a different file"
        : preview.get("planHash") !== diff.planHash
          ? "the database or the plan has changed since it was computed"
          : null;
  if (problem !== null) {
    throw new ImportStopped(
      `The apply does not match the previewed batch ${previewBatchId}: ${problem}. Preview again.`,
    );
  }
}

export async function runImport(options: RunOptions): Promise<RunReport> {
  const { db, importer, input, mode, secret } = options;
  // A source of a family is registered by its importer, once the private configuration names it.
  const derived = importer.source?.key === importer.sourceKey ? importer.source : undefined;
  if (sourceDefinition(importer.sourceKey) === undefined && derived === undefined) {
    throw new ToolRefusal(
      `Refusing to run: the source registry lists no source "${importer.sourceKey}". A source is imported only if the registry lists it.`,
    );
  }
  const locations: PrivateLocations = {
    ...options.locations,
    ...(derived === undefined || importer.location === undefined ? {} : { [derived.key]: importer.location }),
  };
  if (importer.localExport === true) requireOutsideRepository(importer.sourceKey, input.path);
  const target = options.target ?? DEFAULT_TARGET;
  if (options.order !== "notChecked") await requireOrder(db, importer);
  if (mode === "apply" && importer.withheld !== undefined) {
    requireReleased(target, importer.withheld, importer.sourceKey);
  }
  const started = options.now ?? new Date();
  const confirmedHeaders = locations[importer.sourceKey]?.confirmedHeaders;
  const reading = await importer.read(input, {
    secret,
    ...(confirmedHeaders === undefined ? {} : { confirmedHeaders }),
  });
  const batchId = importBatchId(started, reading.contentHash);
  const context: RunContext = { db, sourceKey: importer.sourceKey, batchId, now: Timestamp.fromDate(started) };
  const batchEntry = entryOf("importBatches");
  const batchReference = db.doc(batchEntry.docPath(batchId));
  await batchReference.create(
    validated(batchEntry, batchReference.path, {
      ...createdFields(context.now),
      schemaVersion: batchEntry.schemaVersion,
      sourceKey: importer.sourceKey,
      mode,
      status: "running",
      contentHash: reading.contentHash,
      startedBy: IMPORT_ACTOR,
      startedAt: context.now,
      finishedAt: null,
      stats: {},
      observedOn: input.observedOn,
      inputFiles: [...reading.inputFiles],
      ...(input.commit === undefined ? {} : { sourceCommit: input.commit }),
      ...(options.previewBatchId === undefined ? {} : { previewBatchId: options.previewBatchId }),
    }),
  );

  try {
    let documentsWritten = await syncRegistry(
      context,
      importer.key,
      reading.tabs,
      locations,
      derived === undefined ? [] : [derived],
    );
    const rows = recordRows(importer.sourceKey, reading);
    const state = await compareSnapshot(context, rows);
    const snapshot = await writeSnapshot(context, state, input.observedOn);
    documentsWritten += snapshot.writes;
    const { plan, diff, tabs } = await compute(context, importer, input, secret, reading, rows, state, target);

    const blocked = plan.blocking.length > 0;
    let changesCommitted = 0;
    let discardedAtApply = 0;
    if (mode === "apply" && !blocked) {
      if (options.previewBatchId !== undefined)
        await requireMatchingPreview(db, options.previewBatchId, importer.sourceKey, reading, diff);
      const applied = await applyDiff(context, diff);
      changesCommitted = applied.committed;
      discardedAtApply = applied.discarded;
    } else if (blocked) {
      // An item that explains why the batch cannot be applied is written at once, so that a reviewer can act on it.
      changesCommitted = (await applyBlockingItems(context, diff)).committed;
    }
    // Each change is one document with one entry in the change log.
    documentsWritten += changesCommitted * 2;
    const messages = plan.blocking.map((check) => `Blocking check ${check.check}: ${check.message}`);
    for (const [index, message] of messages.entries()) {
      const path = COLLECTIONS.importBatchLog.docPath(batchId, sequenceId(index + 1));
      await db.doc(path).create(
        validated(entryOf("importBatchLog"), path, {
          ...appendOnlyFields(context.now),
          batchId,
          level: "error",
          message: message.slice(0, 2000),
        }),
      );
    }
    documentsWritten += messages.length;

    const status = mode === "preview" ? "previewed" : blocked ? "failed" : "applied";
    const report: RunReport = {
      batchId,
      sourceKey: importer.sourceKey,
      mode,
      status,
      blocking: plan.blocking,
      tabs,
      sourceRecords: {
        created: state.created.length,
        superseded: state.superseded.length,
        missing: state.missing.length,
        seen: state.seen.length,
      },
      ...summarise(diff),
      conflicts: diff.conflicts,
      // The values of a person whose consent ended between the plan and the write are discarded too.
      specialCategoryDiscarded: diff.specialDiscarded + discardedAtApply,
      changesCommitted,
      documentsWritten,
      planHash: diff.planHash,
    };
    await batchReference.update({
      status,
      finishedAt: Timestamp.now(),
      stats: statsOf(report),
      planHash: diff.planHash,
      manifestBatchId: snapshot.manifestBatchId,
      ...updatedFields(context.now),
    });
    return report;
  } catch (error) {
    await batchReference.update({ status: "failed", finishedAt: Timestamp.now(), ...updatedFields(context.now) });
    throw error;
  }
}
