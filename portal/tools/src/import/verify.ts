// Verification of an import (docs/MIGRATION_PLAN.md, section 8). The command reads the input
// again, plans again and compares with the database, and it writes nothing. A batch counts as
// verified only when every check passes.
//
// | Check              | What it proves                                                                  |
// |--------------------|---------------------------------------------------------------------------------|
// | `structure`        | The source has the structure the importer expects, and no check blocks it       |
// | `rowAccounting`    | Every row falls into one class, and every data row is imported, queued or kept raw for a stated reason |
// | `rawFidelity`      | The raw cells stored in the source records hash to the same values as a fresh parse of the file |
// | `secondRun`        | A second run would write nothing: no source record, no document, no item        |
// | `traceToSource`    | Every imported document names at least one existing source record, and every data row is named by a document, an open item or a reason |
// | `noOrphans`        | Every reference of an imported document resolves                                |
// | `noAddress`        | No imported document that members can read holds an email-shaped text, and no identifier holds an `@` |
import { COLLECTIONS, type CollectionKey, type EntityType, entityPath } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { chunked, entryOf, type RunContext, readDocuments } from "./context";
import type { ImporterDefinition, ImportInput } from "./model";
import { carriesProvenance } from "./ownership";
import { compute } from "./run";
import { compareSnapshot, recordRows } from "./snapshot";
import { canonicalJson, rowHash } from "./values";

export interface VerificationCheck {
  readonly key:
    | "structure"
    | "rowAccounting"
    | "rawFidelity"
    | "secondRun"
    | "traceToSource"
    | "noOrphans"
    | "noAddress";
  readonly passed: boolean;
  /** Counts and document paths. Never a value of a document. */
  readonly detail: string;
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

/** The shape of an email address anywhere in a text. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

export interface VerifyOptions {
  readonly db: Firestore;
  readonly importer: ImporterDefinition;
  readonly input: ImportInput;
  readonly secret: string;
}

export async function verifyImport(options: VerifyOptions): Promise<VerificationCheck[]> {
  const { db, importer, input, secret } = options;
  // The name sorts after every batch identifier, so the latest batch counts as the previous one.
  const context: RunContext = { db, sourceKey: importer.sourceKey, batchId: "verify", now: Timestamp.now() };
  const reading = await importer.read(input, { secret });
  const rows = recordRows(importer.sourceKey, reading);
  const state = await compareSnapshot(context, rows);
  const { plan, diff, tabs } = await compute(context, importer, input, secret, reading, rows, state);
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

  const current = [...rows.values()].flat();
  const stored = await readDocuments(
    db,
    current.map((row) => COLLECTIONS.sourceRecords.docPath(row.recordId)),
  );
  const unfaithful = current.filter((row) => {
    const record = stored.get(COLLECTIONS.sourceRecords.docPath(row.recordId));
    if (!record) return true;
    const raw = record.data.raw as Record<string, unknown>;
    return (
      record.data.rawHash !== row.rawHash || rowHash(row.labels.map((label) => raw[label] ?? null)) !== row.rawHash
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
      (exposed.length > 0 ? ` (first with one: ${exposed.slice(0, 5).join(", ")})` : ""),
  });
  return checks;
}
