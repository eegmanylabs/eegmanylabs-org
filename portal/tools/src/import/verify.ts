// Verification of an import (docs/MIGRATION_PLAN.md, section 8). The command reads the input
// again, plans again and compares with the database. It writes one thing: its report, on the
// latest applied batch of the source, which counts as verified only while every check has passed.
//
// | Check              | What it proves                                                                  |
// |--------------------|---------------------------------------------------------------------------------|
// | `structure`        | The source has the structure the importer expects, and no check blocks it, the privacy guard included |
// | `rowAccounting`    | Every row falls into one class, and every data row is imported, queued or kept raw for a stated reason |
// | `rowBaseline`      | The rows of each class in each tab equal the baseline that the operator has stated |
// | `rawFidelity`      | The raw cells stored in the source records hash to the same values as a fresh parse of the file |
// | `secondRun`        | A second run would write nothing: no source record, no document, no item        |
// | `traceToSource`    | Every imported document names at least one existing source record, and every data row is named by a document, an open item or a reason |
// | `noOrphans`        | Every reference of an imported document resolves                                |
// | `studyRegistry`    | The identifiers of the replications stay distinct after folding, each has one DOI across the sources, and their number is the stated one once the list of studies has been applied |
// | `derivedValues`    | Every value that the source computes from its rows equals its recomputation, or the difference is in the queue |
// | `blankAndZero`     | Every blank numeric cell is absent in the database and every number, zero included, is stored as that number |
// | `noAddress`        | No imported document that members can read holds an email-shaped text, and no identifier holds an `@` |
//
// The rollback rehearsal of section 8 is no check of this command: it is proved by the tests of
// the framework on synthetic data, and on staging once that project exists.
import { COLLECTIONS, type CollectionKey, type EntityType, entityPath, lookupFold } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { chunked, entryOf, type RunContext, readDocuments, updatedFields } from "./context";
import { requireOutsideRepository } from "./local-export";
import type { ImporterDefinition, ImportInput, ImportPlan, RowClass } from "./model";
import { carriesProvenance } from "./ownership";
import { EMAIL_SHAPED } from "./privacy-guard";
import { compute, type TabAccount } from "./run";
import { compareSnapshot, recordRows } from "./snapshot";
import { IDENTIFIER_SCHEMES } from "./studies";
import { canonicalJson, rowHash } from "./values";
import { DEFAULT_TARGET, type RunTarget } from "./withheld";

export interface VerificationCheck {
  readonly key:
    | "structure"
    | "rowAccounting"
    | "rowBaseline"
    | "rawFidelity"
    | "secondRun"
    | "traceToSource"
    | "noOrphans"
    | "studyRegistry"
    | "derivedValues"
    | "blankAndZero"
    | "noAddress";
  readonly passed: boolean;
  /** Counts and document paths. Never a value of a document. */
  readonly detail: string;
}

/** The rows of each class that a tab is expected to hold. A class that is not named is not compared. */
export type TabBaseline = Readonly<Partial<Record<RowClass, number>>>;

/**
 * What the operator states about a source before its import is verified: the rows that each tab
 * holds, by the title or the key of the tab, and the number of studies of the programme. A
 * difference fails the check until the operator has explained it by stating the new numbers.
 */
export interface VerificationBaseline {
  readonly rows?: Readonly<Record<string, TabBaseline>>;
  readonly studies?: number;
}

/** Where a field that names another document points. */
const REFERENCE_FIELDS: Readonly<Record<string, CollectionKey>> = {
  replicationId: "replications",
  replicationIds: "replications",
  personId: "persons",
  leadPersonIds: "persons",
  programmeId: "programmes",
  institutionId: "institutions",
  laboratoryId: "laboratories",
  laboratoryIds: "laboratories",
  sourceRecordId: "sourceRecords",
  sourceRecordIds: "sourceRecords",
};

/** The paths of the documents that a stored document refers to. */
export function referencesOf(data: Readonly<Record<string, unknown>>): string[] {
  const paths: string[] = [];
  const one = (collection: CollectionKey, id: unknown) => {
    if (typeof id === "string" && id !== "")
      paths.push((COLLECTIONS[collection].docPath as (id: string) => string)(id));
  };
  for (const [field, collection] of Object.entries(REFERENCE_FIELDS)) {
    const value = data[field];
    for (const id of Array.isArray(value) ? value : [value]) one(collection, id);
  }
  for (const id of Object.values((data.fieldSources as Record<string, unknown>) ?? {})) one("sourceRecords", id);
  for (const link of Array.isArray(data.vocabulary) ? (data.vocabulary as { termId?: unknown }[]) : [])
    one("vocabularyTerms", link.termId);
  if (typeof data.entityType === "string") {
    const ids = Array.isArray(data.entityIds)
      ? data.entityIds
      : typeof data.entityId === "string"
        ? [data.entityId]
        : [];
    for (const id of ids) if (typeof id === "string") paths.push(entityPath(data.entityType as EntityType, id));
  }
  return paths;
}

export interface VerifyOptions {
  readonly db: Firestore;
  readonly importer: ImporterDefinition;
  readonly input: ImportInput;
  readonly secret: string;
  /** Where the import was applied, so that the plan is the plan of that run. */
  readonly target?: RunTarget;
  readonly baseline?: VerificationBaseline;
  /** True where a missing baseline fails the check, as it does on the command line. */
  readonly requireBaseline?: boolean;
  /** True where the report is stored on the latest applied batch of the source. */
  readonly record?: boolean;
  /** The header lists that a maintainer has confirmed, as the run that is verified was given them. */
  readonly confirmedHeaders?: Readonly<Record<string, readonly string[]>>;
  readonly now?: Date;
}

/** Compares the rows of each class with the baseline that the operator has stated. */
function baselineCheck(
  tabs: readonly TabAccount[],
  titles: ReadonlyMap<string, string>,
  baseline: VerificationBaseline | undefined,
  required: boolean,
): VerificationCheck {
  const stated = baseline?.rows;
  if (stated === undefined) {
    return {
      key: "rowBaseline",
      passed: !required,
      detail:
        "no baseline of rows is stated for this source" +
        (required ? ". State the rows of each tab in the private configuration once a preview has been checked" : ""),
    };
  }
  const differences: string[] = [];
  let compared = 0;
  const known = new Set<string>();
  for (const tab of tabs) {
    const expected = stated[titles.get(tab.tabKey) ?? ""] ?? stated[tab.tabKey];
    if (expected === undefined) {
      differences.push(`${tab.tabKey}: no baseline`);
      continue;
    }
    known.add(tab.tabKey);
    for (const [rowClass, count] of Object.entries(expected) as [RowClass, number][]) {
      compared += 1;
      if (tab.rows[rowClass] !== count) {
        differences.push(`${tab.tabKey}: ${tab.rows[rowClass]} ${rowClass} rows where ${count} are stated`);
      }
    }
  }
  const absent = Object.keys(stated).length - known.size;
  if (absent > 0) differences.push(`${absent} tabs of the baseline are not in the source`);
  return {
    key: "rowBaseline",
    passed: differences.length === 0,
    detail:
      `${compared} counts of ${tabs.length} tabs compared with the stated baseline` +
      (differences.length > 0 ? `; differences: ${differences.slice(0, 20).join("; ")}` : ", all equal"),
  };
}

/**
 * The registry of studies: identifiers that stay distinct after folding, one DOI for each study
 * across the sources and, once the list of studies has been applied, the stated number of studies
 * that carry a programme identifier.
 */
async function studyRegistryCheck(db: Firestore, expected: number | undefined): Promise<VerificationCheck> {
  const replications = await db.collection(COLLECTIONS.replications.collectionPath()).select("originalDoi").get();
  const folds = new Map<string, string[]>();
  for (const doc of replications.docs) {
    const folded = lookupFold(doc.id);
    folds.set(folded, [...(folds.get(folded) ?? []), doc.id]);
  }
  const colliding = [...folds.values()].filter((ids) => ids.length > 1).flat();
  const lookups = await db
    .collection(COLLECTIONS.integrationMappings.collectionPath())
    .where("system", "==", "doi")
    .where("entityType", "==", "replication")
    .get();
  const doisOf = new Map<string, Set<string>>();
  for (const lookup of lookups.docs) {
    const id = String(lookup.get("entityId"));
    doisOf.set(id, (doisOf.get(id) ?? new Set()).add(String(lookup.get("externalId")).toLowerCase()));
  }
  const disagreeing = replications.docs
    .filter((doc) => {
      const own = doc.get("originalDoi") as unknown;
      const seen = new Set(doisOf.get(doc.id) ?? []);
      if (typeof own === "string") seen.add(own.trim().toLowerCase());
      return seen.size > 1;
    })
    .map((doc) => doc.id);
  const aliases = await db.collectionGroup("aliases").where("isCanonical", "==", true).get();
  const identified = new Set(
    aliases.docs
      .filter((alias) => alias.get("scheme") === "programme" && IDENTIFIER_SCHEMES.has("programme"))
      .map((alias) => String(alias.get("replicationId"))),
  );
  const listApplied = !(
    await db
      .collection(COLLECTIONS.importBatches.collectionPath())
      .where("sourceKey", "==", "d")
      .where("mode", "==", "apply")
      .where("status", "==", "applied")
      .limit(1)
      .get()
  ).empty;
  const counted = expected === undefined || !listApplied || identified.size === expected;
  return {
    key: "studyRegistry",
    passed: colliding.length === 0 && disagreeing.length === 0 && counted,
    detail:
      `${replications.size} replications, ${identified.size} with a programme identifier` +
      (expected === undefined
        ? ", no number of studies stated"
        : listApplied
          ? `, ${expected} stated`
          : `, ${expected} stated and not yet comparable: the list of studies is not applied`) +
      `; ${colliding.length} identifiers collide after folding` +
      (colliding.length > 0 ? ` (${colliding.slice(0, 6).join(", ")})` : "") +
      `; ${disagreeing.length} studies have more than one DOI across the sources` +
      (disagreeing.length > 0 ? ` (${disagreeing.slice(0, 6).join(", ")})` : ""),
  };
}

/** The values that the source computes from its rows: each equals its recomputation, or the difference is in the queue. */
async function derivedCheck(db: Firestore, plan: ImportPlan): Promise<VerificationCheck> {
  const differing = plan.derivedValues.filter((value) => !value.matches);
  const reported = await readDocuments(
    db,
    differing.flatMap((value) =>
      value.reportedBy === undefined ? [] : [COLLECTIONS.reconciliationItems.docPath(value.reportedBy)],
    ),
  );
  const silent = differing.filter(
    (value) =>
      value.reportedBy === undefined || !reported.get(COLLECTIONS.reconciliationItems.docPath(value.reportedBy)),
  );
  return {
    key: "derivedValues",
    passed: silent.length === 0,
    detail:
      plan.derivedValues.length === 0
        ? "the importer of this source recomputes no derived value"
        : `${plan.derivedValues.length} derived values recomputed: ${plan.derivedValues.length - differing.length} equal the ` +
          `stored value, ${differing.length - silent.length} differ and are in the queue, ${silent.length} differ unreported`,
  };
}

/** Blank and zero: a blank numeric cell is absent in the database, and a number is stored as that number. */
async function blankAndZeroCheck(db: Firestore, plan: ImportPlan): Promise<VerificationCheck> {
  const stored = await readDocuments(
    db,
    plan.numericCells.map((cell) => cell.path),
  );
  const wrong = plan.numericCells.filter((cell) => {
    const value = stored.get(cell.path)?.data[cell.field];
    return cell.state === "number" ? value !== cell.value : value !== undefined;
  });
  const count = (test: (cell: ImportPlan["numericCells"][number]) => boolean) => plan.numericCells.filter(test).length;
  return {
    key: "blankAndZero",
    passed: wrong.length === 0,
    detail:
      plan.numericCells.length === 0
        ? "the importer of this source states no numeric cell"
        : `${count((cell) => cell.state === "blank")} blank cells are absent, ` +
          `${count((cell) => cell.state === "number" && cell.value === 0)} explicit zeros are stored as 0, ` +
          `${count((cell) => cell.state === "number" && cell.value !== 0)} other numbers are stored as written, ` +
          `${count((cell) => cell.state === "held")} cells wait in the queue and are absent; ${wrong.length} cells are stored otherwise`,
  };
}

export async function verifyImport(options: VerifyOptions): Promise<VerificationCheck[]> {
  const { db, importer, input, secret } = options;
  if (importer.localExport === true) requireOutsideRepository(importer.sourceKey, input.path);
  const checkedAt = Timestamp.fromDate(options.now ?? new Date());
  // The name sorts after every batch identifier, so the latest batch counts as the previous one.
  const context: RunContext = { db, sourceKey: importer.sourceKey, batchId: "verify", now: checkedAt };
  const reading = await importer.read(input, {
    secret,
    ...(options.confirmedHeaders === undefined ? {} : { confirmedHeaders: options.confirmedHeaders }),
  });
  const rows = recordRows(importer.sourceKey, reading);
  const state = await compareSnapshot(context, rows);
  const { plan, diff, tabs } = await compute(
    context,
    importer,
    input,
    secret,
    reading,
    rows,
    state,
    options.target ?? DEFAULT_TARGET,
  );
  const checks: VerificationCheck[] = [];
  const blocked = plan.blocking.length;
  checks.push({
    key: "structure",
    passed: blocked === 0,
    detail:
      blocked === 0
        ? `${reading.tabs.length} tabs read`
        : `${blocked} blocking checks failed: ${plan.blocking.map((check) => check.check).join(", ")}`,
  });

  const dataRows = tabs.reduce((sum, tab) => sum + tab.rows.data, 0);
  const accounted = tabs.reduce(
    (sum, tab) => sum + tab.imported + tab.queued + Object.values(tab.rawOnly).reduce((a, b) => a + b, 0),
    0,
  );
  checks.push({
    key: "rowAccounting",
    passed: blocked === 0 && tabs.every((tab) => tab.unaccounted === 0) && accounted === dataRows,
    detail: tabs
      .map((tab) => {
        const raw = Object.values(tab.rawOnly).reduce((a, b) => a + b, 0);
        return `${tab.tabKey}: ${tab.rows.data} data rows = ${tab.imported} imported + ${tab.queued} queued + ${raw} raw only`;
      })
      .join("; "),
  });

  checks.push(
    baselineCheck(
      tabs,
      new Map(reading.tabs.map((tab) => [tab.tabKey, tab.name])),
      options.baseline,
      options.requireBaseline === true,
    ),
  );

  const current = [...rows.values()].flat();
  const stored = await readDocuments(
    db,
    current.map((row) => COLLECTIONS.sourceRecords.docPath(row.recordId)),
  );
  const unfaithful = current.filter((row) => {
    const record = stored.get(COLLECTIONS.sourceRecords.docPath(row.recordId));
    if (!record) return true;
    const raw = record.data.raw as Record<string, unknown>;
    // The hash is taken with the row in which the record was first seen, as it was when the record was written.
    const storedRow = typeof record.data.rowNumber === "number" ? record.data.rowNumber : row.rowNumber;
    return (
      record.data.rawHash !== row.rawHash ||
      rowHash(
        row.labels.map((label) => raw[label] ?? null),
        storedRow,
      ) !== row.rawHash
    );
  });
  checks.push({
    key: "rawFidelity",
    passed: unfaithful.length === 0,
    detail: `${current.length - unfaithful.length} of ${current.length} stored rows hash to the value of a fresh parse`,
  });

  const pending = state.created.length + state.superseded.length + diff.changes.length + diff.itemChanges.length;
  checks.push({
    key: "secondRun",
    passed: pending === 0,
    detail:
      `a second run would write ${state.created.length} source records, ${diff.changes.length} documents ` +
      `and ${diff.itemChanges.length} items`,
  });

  // Trace: from every imported document to a source record, and from every data row to what became of it.
  const documents = await readDocuments(
    db,
    plan.documents.map((document) => document.path),
  );
  const untraced: string[] = [];
  const named = new Set<string>(plan.rawOnly.keys());
  const referenced = new Set<string>();
  for (const document of plan.documents) {
    const found = documents.get(document.path);
    if (!found) {
      untraced.push(document.path);
      continue;
    }
    for (const path of referencesOf(found.data)) referenced.add(path);
    if (!carriesProvenance(entryOf(document.collection))) {
      for (const id of document.sourceRecordIds) named.add(id);
      continue;
    }
    const ids = (found.data.sourceRecordIds as string[] | undefined) ?? [];
    if (ids.length === 0) untraced.push(document.path);
    for (const id of ids) named.add(id);
  }
  const open = await db
    .collection(COLLECTIONS.reconciliationItems.collectionPath())
    .where("sourceKey", "==", importer.sourceKey)
    .where("status", "==", "open")
    .get();
  for (const item of open.docs) {
    for (const candidate of item.get("candidates") as { sourceRecordId?: string }[]) {
      if (candidate.sourceRecordId !== undefined) named.add(candidate.sourceRecordId);
    }
  }
  const unnamed = current.filter(
    (row) => row.rowClass === "data" && row.cellLevel !== true && !named.has(row.recordId),
  );
  checks.push({
    key: "traceToSource",
    passed: untraced.length === 0 && unnamed.length === 0,
    detail:
      `${plan.documents.length - untraced.length} of ${plan.documents.length} documents name a source record` +
      (untraced.length > 0 ? ` (first without: ${untraced.slice(0, 5).join(", ")})` : "") +
      `; ${unnamed.length} data rows are named by no document, open item or reason`,
  });

  const orphans: string[] = [];
  for (const piece of chunked([...referenced].sort())) {
    const snapshots = await db.getAll(...piece.map((path) => db.doc(path)));
    for (const snapshot of snapshots) if (!snapshot.exists) orphans.push(snapshot.ref.path);
  }
  checks.push({
    key: "noOrphans",
    passed: orphans.length === 0,
    detail:
      `${referenced.size - orphans.length} of ${referenced.size} references resolve` +
      (orphans.length > 0 ? ` (first missing: ${orphans.slice(0, 5).join(", ")})` : ""),
  });
  checks.push(await studyRegistryCheck(db, options.baseline?.studies));
  checks.push(await derivedCheck(db, plan));
  checks.push(await blankAndZeroCheck(db, plan));
  // Addresses belong in restricted documents. A document that every member can read holds none.
  const exposed = plan.documents
    .filter((document) => {
      const readable = ["public", "member"].includes(entryOf(document.collection).dataClass);
      const stored = documents.get(document.path);
      return (
        document.path.includes("@") ||
        (readable && stored !== null && stored !== undefined && EMAIL_SHAPED.test(canonicalJson(stored.data)))
      );
    })
    .map((document) => document.path);
  checks.push({
    key: "noAddress",
    passed: exposed.length === 0,
    detail:
      `${plan.documents.length - exposed.length} of ${plan.documents.length} documents are free of addresses where members can read` +
      // A path that holds an address is never printed: the collection says where to look.
      (exposed.length > 0
        ? ` (first with one: ${exposed
            .slice(0, 5)
            .map((path) => (path.includes("@") ? path.split("/")[0] : path))
            .join(", ")})`
        : ""),
  });
  if (options.record === true) await recordVerification(db, importer.sourceKey, checks, checkedAt);
  return checks;
}

/** Stores the report on the latest applied batch of the source. A source that was never applied has no batch to verify. */
async function recordVerification(
  db: Firestore,
  sourceKey: string,
  checks: readonly VerificationCheck[],
  checkedAt: Timestamp,
): Promise<void> {
  const batches = await db
    .collection(COLLECTIONS.importBatches.collectionPath())
    .where("sourceKey", "==", sourceKey)
    .where("mode", "==", "apply")
    .where("status", "==", "applied")
    .get();
  const latest = batches.docs.sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (latest === undefined) return;
  await latest.ref.update({
    verification: {
      checkedAt,
      passed: checks.every((check) => check.passed),
      checks: checks.map((check) => ({ key: check.key, passed: check.passed, detail: check.detail.slice(0, 2_000) })),
    },
    ...updatedFields(checkedAt),
  });
}
