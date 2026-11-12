// One run of a sheet mapping (docs/INTEGRATIONS.md, section 3.3), in the fixed order the design
// gives: take the lease of the spreadsheet, read the Drive version, read the tab in one request,
// resolve columns and anchors, load the records and their bases, plan, and, in a live run,
// repair anchors, write the cells, check what reads back, write the portal in transactions that
// require each field still to hold what the plan read, set the bases, and release the lease.
// A dry run stops after the plan and writes nothing to either side.
import {
  type AppFieldWrite,
  type AuditChange,
  type CellBase,
  COLLECTIONS,
  canonicalFromSheet,
  cellKey,
  displayCanonical,
  isSyncTargetKey,
  type MappedColumn,
  parseStoredDocument,
  planSync,
  type SheetCell,
  type SheetRow,
  type SheetSnapshot,
  type SyncMappingDoc,
  type SyncPlan,
  type SyncPlanEntry,
  type SyncReviewKind,
  syncCellStateDocSchema,
  syncCellStateId,
  syncMappingDocSchema,
  syncTargetField,
  systemWriteContext,
} from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "../../framework";
import { createdFields } from "../../framework/documents";
import { retrying } from "../google/retry";
import {
  ExternalServiceError,
  METADATA_BUDGET,
  type RowWrite,
  SHEETS_MIME_TYPE,
  type SheetsRequest,
  type TabGrid,
} from "../google/types";
import { type JobDependencies, JobFailure, type JobOutcome, SYNC_ACTOR } from "./context";
import type { ClaimedRun } from "./queue";
import { resolveClearedReviewItems, settleConflicts, upsertConflict, upsertReviewItems } from "./records";
import { TARGET_ADAPTERS, type TargetRecord } from "./targets";

/** The developer metadata keys the engine writes. They hold keys and field names, never personal data. */
export const ROW_KEY_METADATA = "eegml.row";
export const COLUMN_METADATA = "eegml.column";
export const FILE_METADATA = "eegml.file";

/** How long a lease holds a spreadsheet, beyond which a run that died is taken to have let it go. */
const LEASE_MS = 9 * 60 * 1000;

interface MappingSource {
  readonly spreadsheetId: string;
  readonly sheetId: number;
}

async function readMapping(db: Firestore, mappingId: string): Promise<SyncMappingDoc> {
  const parsed = parseStoredDocument(
    syncMappingDocSchema,
    (await db.doc(COLLECTIONS.syncMappings.docPath(mappingId)).get()).data(),
  );
  if (!parsed.success) throw new JobFailure("guard", false, "The mapping of this run no longer exists.");
  return parsed.data;
}

/** Where the mapped tab is: the registered source's private location and its tab. Never an address in the mapping. */
export async function mappingSource(
  db: Firestore,
  mapping: Pick<SyncMappingDoc, "sourceKey" | "tabKey">,
): Promise<MappingSource> {
  const [location, tab] = await Promise.all([
    db.doc(COLLECTIONS.sourceLocation.docPath(mapping.sourceKey)).get(),
    db.doc(COLLECTIONS.sourceTabs.docPath(mapping.sourceKey, mapping.tabKey)).get(),
  ]);
  const spreadsheetId: unknown = location.get("externalId");
  const sheetId = Number(tab.get("sheetId"));
  if (typeof spreadsheetId !== "string" || !Number.isInteger(sheetId)) {
    throw new JobFailure("guard", false, "The source of this mapping has no registered spreadsheet or tab.");
  }
  return { spreadsheetId, sheetId };
}

/** The columns of a mapping with the type of each field. */
export function mappedColumns(mapping: SyncMappingDoc): MappedColumn[] {
  if (!isSyncTargetKey(mapping.collectionKey)) return [];
  const key = mapping.collectionKey;
  return mapping.columnMap.flatMap((column) => {
    const field = syncTargetField(key, column.field);
    return field === undefined
      ? []
      : [{ field: column.field, column: column.column, direction: column.direction, spec: field.spec }];
  });
}

/** The grid as the planner reads it: header, rows with their anchors, and whether the metadata budget is spent. */
export function snapshotOf(grid: TabGrid): SheetSnapshot {
  const [header = [], ...data] = grid.rows;
  const anchors = new Map<number, string>();
  const tags = new Map<number, string>();
  for (const meta of grid.metadata) {
    if (meta.location.kind === "row" && meta.metadataKey === ROW_KEY_METADATA)
      anchors.set(meta.location.index, meta.metadataValue);
    if (meta.location.kind === "column" && meta.metadataKey === COLUMN_METADATA)
      tags.set(meta.location.index, meta.metadataValue);
  }
  return {
    header: header.map((cell, index) => ({
      index,
      text: cell === undefined ? "" : String(cell.value ?? ""),
      tag: tags.get(index) ?? null,
    })),
    rows: data.map(
      (cells, offset): SheetRow => ({
        position: offset + 2,
        anchor: anchors.get(offset + 1) ?? null,
        cells: cells.map((cell): SheetCell | undefined => cell),
      }),
    ),
    // A little room is kept for the anchors of new rows.
    anchorBudgetExceeded: grid.metadataCharacters > METADATA_BUDGET - 2_000,
  };
}

/** The plan as the run record keeps it, for a person to read. */
export function planEntries(plan: SyncPlan): SyncPlanEntry[] {
  const text = (value: string | null | undefined) => displayCanonical(value) ?? null;
  return [
    ...plan.sheetWrites.map((write) => ({
      action: "writeSheet" as const,
      rowKey: write.rowKey,
      field: write.field,
      before: text(write.replaced),
      after: text(write.canonical),
      ...(write.overwroteExternalEdit
        ? { detail: "The value a person had entered in the sheet is replaced and kept in this log." }
        : {}),
    })),
    ...plan.appWrites.map((write) => ({
      action: "writeApp" as const,
      rowKey: write.rowKey,
      field: write.field,
      before: text(write.expected),
      after: text(write.canonical),
      ...(write.overwroteAppEdit
        ? { detail: "The value edited in the portal is replaced by the sheet, which owns the field." }
        : {}),
    })),
    ...plan.appends.map((append) => ({ action: "appendRow" as const, rowKey: append.rowKey })),
    ...plan.anchorRepairs.map((repair) => ({
      action: "repairAnchor" as const,
      rowKey: repair.rowKey,
      detail: `Row ${repair.position} is anchored to its key.`,
    })),
    ...plan.conflicts.map((conflict) => ({
      action: "conflict" as const,
      rowKey: conflict.rowKey,
      field: conflict.field,
      before: text(conflict.app),
      after: text(conflict.external),
      detail: "Both sides changed since they last agreed. Neither is written until a person decides.",
    })),
    ...plan.settledConflicts.map((settled) => ({
      action: "settle" as const,
      rowKey: settled.rowKey,
      field: settled.field,
    })),
    ...plan.issues.map((issue) => ({
      action: "issue" as const,
      ...(issue.rowKey === undefined ? {} : { rowKey: issue.rowKey }),
      ...(issue.field === undefined ? {} : { field: issue.field }),
      detail: issue.detail,
    })),
  ];
}

/** How often a run asks again for a lease that another run holds, before it gives up and waits in the queue. */
const LEASE_ATTEMPTS = 30;

async function takeLease(
  db: Firestore,
  sourceKey: string,
  runId: string,
  dependencies: Pick<JobDependencies, "clock" | "sleep">,
): Promise<void> {
  const reference = db.doc(COLLECTIONS.syncLeases.docPath(sourceKey));
  for (let attempt = 1; ; attempt += 1) {
    const at = dependencies.clock.now();
    const holder = await db.runTransaction(async (transaction) => {
      const lease = await transaction.get(reference);
      const expiresAt: unknown = lease.get("expiresAt");
      if (
        lease.exists &&
        lease.get("runId") !== runId &&
        expiresAt instanceof Timestamp &&
        expiresAt.toMillis() > at.getTime()
      ) {
        return expiresAt.toDate();
      }
      transaction.set(reference, {
        ...createdFields("syncLeases", { at, actor: SYNC_ACTOR, writeContext: systemWriteContext() }),
        sourceKey,
        runId,
        expiresAt: Timestamp.fromMillis(at.getTime() + LEASE_MS),
      });
      return null;
    });
    if (holder === null) return;
    // A run lasts seconds, so the lease is asked for again a little later before the run waits in the queue.
    if (attempt >= LEASE_ATTEMPTS)
      throw new JobFailure("internal", true, "Another run is working on this spreadsheet.", holder);
    await dependencies.sleep(1_000);
  }
}

async function releaseLease(db: Firestore, sourceKey: string, runId: string): Promise<void> {
  const reference = db.doc(COLLECTIONS.syncLeases.docPath(sourceKey));
  await db.runTransaction(async (transaction) => {
    const lease = await transaction.get(reference);
    if (lease.get("runId") === runId) transaction.delete(reference);
  });
}

/** Marks a mapping as needing a person, with the reason. */
export async function mappingNeedsAttention(
  db: Firestore,
  mappingId: string,
  reason: string,
  at: Date,
  paused = false,
): Promise<void> {
  await db.doc(COLLECTIONS.syncMappings.docPath(mappingId)).update({
    status: paused ? "paused" : "needsAttention",
    statusReason: reason,
    updatedAt: Timestamp.fromDate(at),
    updatedBy: SYNC_ACTOR,
    writeContext: systemWriteContext(),
  });
}

/** How a failure names the system that answered: Google, or the synthetic fake that stands for it in the emulator. */
export function googleNameOf(kind: "fake" | "real" | null): { readonly name: string; readonly possessive: string } {
  return kind === "fake"
    ? { name: "The synthetic Google fake", possessive: "The synthetic Google fake's" }
    : { name: "Google", possessive: "Google's" };
}

/** Turns the answer of a Google interface that no retry clears into the failure of the run. */
export function failureOf(error: unknown, kind: "fake" | "real" | null = "real"): JobFailure {
  if (error instanceof JobFailure) return error;
  const { name, possessive } = googleNameOf(kind);
  if (error instanceof ExternalServiceError) {
    if (
      error.status === 404 ||
      (error.status === 403 && error.reason !== "userRateLimitExceeded" && error.reason !== "rateLimitExceeded")
    ) {
      return new JobFailure(
        "accessLost",
        false,
        "The portal's Google account can no longer open the file: it was deleted or is no longer shared.",
      );
    }
    if (error.status === 429 || error.status === 403) {
      return new JobFailure("quota", true, `${possessive} quota was exceeded (${error.status}).`);
    }
    if (error.status >= 500) return new JobFailure("outage", true, `${name} did not answer (${error.status}).`);
    return new JobFailure("guard", false, `${name} refused the request (${error.status}).`);
  }
  return new JobFailure("internal", true, "The run failed for a reason of the portal.");
}

/** Runs one sheet synchronisation. Throws a `JobFailure` for the queue to retry or end. */
export async function runSheetSync(run: ClaimedRun, dependencies: JobDependencies): Promise<JobOutcome> {
  const { db, clock } = dependencies;
  const mappingId = run.mappingId;
  if (mappingId === undefined) throw new JobFailure("guard", false, "A synchronisation run names no mapping.");
  const mapping = await readMapping(db, mappingId);
  if (mapping.status === "paused") return { status: "skipped", stats: {}, note: "The mapping is paused." };
  if (mapping.status === "needsAttention" && run.trigger !== "manual") {
    return { status: "skipped", stats: {}, note: "The mapping needs a person before it runs again." };
  }
  if (!isSyncTargetKey(mapping.collectionKey))
    throw new JobFailure("guard", false, "The mapping names a collection the portal cannot synchronise.");
  if (dependencies.adapters === null) throw new JobFailure("guard", false, "Not connected: credentials not supplied.");
  const retry = {
    sleep: dependencies.sleep,
    random: dependencies.random,
  };
  const drive = retrying(dependencies.adapters.drive, retry);
  const sheets = retrying(dependencies.adapters.sheets, retry);
  const source = await mappingSource(db, mapping);
  const live = run.mode === "live";
  if (live) await takeLease(db, mapping.sourceKey, run.id, dependencies);
  try {
    return await synchronise(run, mappingId, mapping, source, { ...dependencies, drive, sheets }, live);
  } catch (error) {
    const failure = failureOf(error, dependencies.adapters?.kind ?? null);
    if (failure.kind === "accessLost") {
      await mappingNeedsAttention(db, mappingId, failure.message, clock.now());
      await upsertReviewItems(db, [{ mappingId, kind: "accessLost", detail: failure.message }], clock.now());
    }
    throw failure;
  } finally {
    if (live) await releaseLease(db, mapping.sourceKey, run.id);
  }
}

interface Services extends JobDependencies {
  readonly drive: NonNullable<JobDependencies["adapters"]>["drive"];
  readonly sheets: NonNullable<JobDependencies["adapters"]>["sheets"];
}

async function synchronise(
  run: ClaimedRun,
  mappingId: string,
  mapping: SyncMappingDoc,
  source: MappingSource,
  services: Services,
  live: boolean,
): Promise<JobOutcome> {
  const { db, clock, drive, sheets } = services;
  const targetKey = mapping.collectionKey as keyof typeof TARGET_ADAPTERS;
  const file = await drive.getFile(source.spreadsheetId);
  if (file.mimeType !== SHEETS_MIME_TYPE) {
    throw new JobFailure(
      "guard",
      false,
      "The file is not a native Google Sheet. A workbook kept in Drive can be imported, never synchronised.",
    );
  }
  // The version is read before the grid, so an edit made during the run is never skipped.
  const driveVersion = file.version;
  if (run.requestedBy === "system:driveChanges" && driveVersion === mapping.lastDriveVersion) {
    return { status: "skipped", stats: {}, driveVersion, note: "The spreadsheet has not changed since the last run." };
  }
  const info = await sheets.getSpreadsheet(source.spreadsheetId);
  const fileTag = info.metadata.find((meta) => meta.metadataKey === FILE_METADATA);
  if (fileTag !== undefined && fileTag.metadataValue !== source.spreadsheetId) {
    const detail = "The spreadsheet carries the tag of another file, so it is taken to be a copy and is left alone.";
    if (live) {
      await mappingNeedsAttention(db, mappingId, detail, clock.now());
      await upsertReviewItems(db, [{ mappingId, kind: "copiedFile", detail }], clock.now());
    }
    throw new JobFailure("guard", false, detail);
  }
  const grid = await sheets.readTab(source.spreadsheetId, source.sheetId);
  const snapshot = snapshotOf(grid);
  const target = TARGET_ADAPTERS[targetKey];
  const records = await target.load(db);
  const recordByKey = new Map(records.map((record) => [record.key, record]));
  const states = await db.collection(COLLECTIONS.syncMappingCellState.collectionPath(mappingId)).get();
  const bases = new Map<string, CellBase>();
  for (const document of states.docs) {
    const state = parseStoredDocument(syncCellStateDocSchema, document.data());
    if (state.success)
      bases.set(cellKey(state.data.rowKey, state.data.field), {
        value: state.data.appValue,
        unstable: state.data.unstable,
      });
  }
  const conflicts = await db
    .collection(COLLECTIONS.syncConflicts.collectionPath())
    .where("mappingId", "==", mappingId)
    .get();
  const openConflicts = new Set(
    conflicts.docs
      .filter((document) => document.get("status") === "open")
      .map((document) => cellKey(String(document.get("rowKey")), String(document.get("field")))),
  );
  const columns = mappedColumns(mapping);
  const plan = planSync({
    mapping: {
      keyColumn: mapping.keyColumn,
      columns,
      sheetOnly: mapping.sheetOnlyRows,
      appOnly: mapping.appOnlyRecords,
      cellCeiling: mapping.cellCeiling,
    },
    sheet: snapshot,
    records,
    bases,
    openConflicts,
  });
  const entries = planEntries(plan);
  const stats: Record<string, number> = { ...plan.stats };
  if (!live) {
    // A dry run is recorded on the mapping too, so its row says what the plan found, and is
    // never taken for a live success.
    const at = clock.now();
    await db.doc(COLLECTIONS.syncMappings.docPath(mappingId)).update({
      lastRunId: run.id,
      lastRunAt: Timestamp.fromDate(at),
      lastRunDry: true,
      lastStats: stats,
      updatedAt: Timestamp.fromDate(at),
      updatedBy: SYNC_ACTOR,
      writeContext: systemWriteContext(),
    });
    return {
      status: "succeeded",
      stats,
      plan: entries,
      driveVersion,
      note: "Dry run: the plan was computed and nothing was written.",
    };
  }

  const at = clock.now();
  const reviewSpecs = plan.issues.map((issue) => ({
    mappingId,
    kind: issue.kind as SyncReviewKind,
    ...(issue.rowKey === undefined ? {} : { rowKey: issue.rowKey }),
    ...(issue.field === undefined ? {} : { field: issue.field }),
    detail: issue.detail,
  }));
  if (plan.halted !== null) {
    await upsertReviewItems(db, reviewSpecs, at);
    const reason =
      plan.halted === "ceilingExceeded"
        ? "The run would write more cells than the ceiling allows."
        : "The key column of the tab cannot be found.";
    await mappingNeedsAttention(db, mappingId, reason, at, plan.halted === "ceilingExceeded");
    throw new JobFailure("guard", false, `${reason} Nothing was written.`);
  }

  // 1. Anchors, column tags and the file's own tag, in one request: the one-time set-up and its repairs.
  const requests: SheetsRequest[] = [];
  for (const repair of plan.anchorRepairs) {
    const existing = grid.metadata.find(
      (meta) =>
        meta.metadataKey === ROW_KEY_METADATA &&
        meta.location.kind === "row" &&
        meta.location.index === repair.position - 1,
    );
    requests.push(
      existing === undefined
        ? {
            createDeveloperMetadata: {
              metadataKey: ROW_KEY_METADATA,
              metadataValue: repair.rowKey,
              location: { kind: "row", sheetId: source.sheetId, index: repair.position - 1 },
            },
          }
        : { updateDeveloperMetadata: { metadataId: existing.metadataId, metadataValue: repair.rowKey } },
    );
  }
  for (const { field, index } of plan.columns) {
    if (snapshot.header[index]?.tag === null) {
      requests.push({
        createDeveloperMetadata: {
          metadataKey: COLUMN_METADATA,
          metadataValue: field,
          location: { kind: "column", sheetId: source.sheetId, index },
        },
      });
    }
  }
  if (fileTag === undefined) {
    requests.push({
      createDeveloperMetadata: {
        metadataKey: FILE_METADATA,
        metadataValue: source.spreadsheetId,
        location: { kind: "spreadsheet" },
      },
    });
  }
  if (requests.length > 0) await sheets.batchUpdate(source.spreadsheetId, requests);

  // 2. The cells, one row write for each row, with a null for every cell the plan leaves alone.
  const keyIndex = plan.keyColumnIndex ?? 0;
  const baseWrites: { rowKey: string; recordId: string; field: string; value: string | null; unstable: boolean }[] = [];
  const sheetChanges: AuditChange[] = [];
  const byRow = new Map<string, typeof plan.sheetWrites>();
  for (const write of plan.sheetWrites) byRow.set(write.rowKey, [...(byRow.get(write.rowKey) ?? []), write]);
  let keyMoved: string | null = null;
  if (byRow.size > 0) {
    const writes: RowWrite[] = [...byRow.values()].map((cells) => {
      const first = cells[0];
      const width = Math.max(...cells.map((cell) => cell.columnIndex)) + 1;
      const values: (string | number | boolean | null)[] = Array.from({ length: width }, () => null);
      for (const cell of cells) values[cell.columnIndex] = cell.value;
      return {
        sheetId: source.sheetId,
        row:
          first?.byAnchor === false
            ? { kind: "position", index: (first?.position ?? 2) - 1 }
            : { kind: "metadata", metadataKey: ROW_KEY_METADATA, metadataValue: first?.rowKey ?? "" },
        values,
      };
    });
    const results = await sheets.writeRows(source.spreadsheetId, writes);
    const restore: RowWrite[] = [];
    [...byRow.entries()].forEach(([rowKey, cells], index) => {
      const after = results[index] ?? [];
      const keyAfter = after[keyIndex]?.value ?? null;
      if (keyAfter === null || String(keyAfter).trim() !== rowKey) {
        // The write landed on a row with another key: put back what was there and stop.
        keyMoved = rowKey;
        const values: (string | number | boolean | null)[] = Array.from(
          { length: (writes[index]?.values ?? []).length },
          () => null,
        );
        for (const cell of cells) {
          const original =
            snapshot.rows.find((row) => row.position === cell.position)?.cells[cell.columnIndex]?.value ?? "";
          values[cell.columnIndex] = original;
        }
        const address = writes[index]?.row;
        if (address !== undefined) restore.push({ sheetId: source.sheetId, row: address, values });
        return;
      }
      for (const cell of cells) {
        const spec = columns.find((column) => column.field === cell.field)?.spec;
        const read = spec === undefined ? null : canonicalFromSheet(spec, after[cell.columnIndex]?.value ?? null);
        // The read-back check: a value that Sheets rewrote is marked unstable and written no more.
        const stable = read?.ok === true && read.value === cell.canonical;
        baseWrites.push({
          rowKey,
          recordId: cell.recordId,
          field: cell.field,
          value: cell.canonical,
          unstable: !stable,
        });
        sheetChanges.push({
          field: `${rowKey} ${cell.field}`,
          before: displayCanonical(cell.replaced),
          after: displayCanonical(cell.canonical),
        });
      }
    });
    if (restore.length > 0) await sheets.writeRows(source.spreadsheetId, restore);
  }
  if (keyMoved !== null) {
    const detail = `A write meant for the row "${keyMoved}" landed on another row. The cells were put back and the mapping stopped.`;
    await upsertReviewItems(db, [{ mappingId, kind: "keyMoved", rowKey: keyMoved, detail }], at);
    await mappingNeedsAttention(db, mappingId, detail, at);
    throw new JobFailure("guard", false, detail);
  }

  // 3. New rows, and their anchors.
  if (plan.appends.length > 0) {
    const first = await sheets.appendRows(
      source.spreadsheetId,
      source.sheetId,
      plan.appends.map((append) => append.cells),
    );
    if (first >= 0) {
      await sheets.batchUpdate(
        source.spreadsheetId,
        plan.appends.map((append, offset) => ({
          createDeveloperMetadata: {
            metadataKey: ROW_KEY_METADATA,
            metadataValue: append.rowKey,
            location: { kind: "row" as const, sheetId: source.sheetId, index: first + offset },
          },
        })),
      );
    }
    for (const append of plan.appends) {
      for (const base of append.bases) baseWrites.push({ ...base, unstable: false });
      sheetChanges.push({ field: `${append.rowKey}`, before: null, after: "A row was appended." });
    }
  }

  // 4. The portal, record by record, each field required still to hold what the plan read.
  const appByRecord = new Map<string, AppFieldWrite[]>();
  for (const write of plan.appWrites)
    appByRecord.set(write.recordId, [...(appByRecord.get(write.recordId) ?? []), write]);
  let stale = 0;
  const invalid: { rowKey: string; field: string; reason: string }[] = [];
  for (const [recordId, writes] of appByRecord) {
    const record = [...recordByKey.values()].find((candidate) => candidate.recordId === recordId) as TargetRecord;
    const result = await target.write(db, record, writes, { mappingId, runId: run.id, at });
    if (result.kind === "written") {
      for (const write of writes)
        baseWrites.push({
          rowKey: write.rowKey,
          recordId,
          field: write.field,
          value: write.canonical,
          unstable: false,
        });
    } else if (result.kind === "stale") {
      stale += writes.length;
    } else {
      for (const write of writes) invalid.push({ rowKey: write.rowKey, field: write.field, reason: result.reason });
    }
  }

  // 5. The bases, then the conflicts and the review items.
  for (const update of [...plan.baseUpdates, ...plan.settledConflicts]) baseWrites.push({ ...update, unstable: false });
  const batch = db.batch();
  for (const base of baseWrites) {
    batch.set(
      db.doc(COLLECTIONS.syncMappingCellState.docPath(mappingId, syncCellStateId(base.recordId, base.field))),
      syncCellStateDocSchema.parse({
        ...createdFields("syncMappingCellState", { at, actor: SYNC_ACTOR, writeContext: systemWriteContext() }),
        mappingId,
        recordId: base.recordId,
        rowKey: base.rowKey,
        field: base.field,
        appValue: base.value,
        sheetValue: base.value,
        sheetRevisionId: driveVersion,
        syncedAt: Timestamp.fromDate(at),
        unstable: base.unstable,
      }),
    );
  }
  if (sheetChanges.length > 0) {
    writeAudit(
      batch,
      {
        action: "sync.sheetUpdated",
        actor: { kind: "sync" },
        entityType: "syncMapping",
        entityId: mappingId,
        changes: sheetChanges.slice(0, 500),
        at,
        context: { correlationId: mappingId, causationId: run.id, depth: 1 },
      },
      db,
    );
  }
  await batch.commit();
  await settleConflicts(db, mappingId, plan.settledConflicts, at);
  for (const conflict of plan.conflicts) {
    const record = recordByKey.get(conflict.rowKey);
    if (record === undefined) continue;
    const label = syncTargetField(targetKey, conflict.field);
    await upsertConflict(
      db,
      {
        origin: "sheet",
        mappingId,
        entityType: record.entityType,
        entityId: record.entityId,
        recordId: record.recordId,
        rowKey: conflict.rowKey,
        field: conflict.field,
        label: `${label?.label ?? conflict.field} of ${record.label}`,
        base: conflict.base,
        app: conflict.app,
        external: conflict.external,
        sheetRevisionId: driveVersion,
        externalModifiedAt: new Date(file.modifiedTime),
        ...(file.lastModifyingUser === undefined || file.lastModifyingUser.me
          ? {}
          : { externalModifiedBy: file.lastModifyingUser.displayName }),
      },
      at,
    );
  }
  const unstable = baseWrites.filter((base) => base.unstable);
  const raised = await upsertReviewItems(
    db,
    [
      ...reviewSpecs,
      ...unstable.map((base) => ({
        mappingId,
        kind: "unstableCell" as const,
        rowKey: base.rowKey,
        field: base.field,
        detail:
          "The value read back after the write differs from what was written: a formula, a validation rule or an add-on changed it.",
      })),
      ...invalid.map((item) => ({
        mappingId,
        kind: "invalidValue" as const,
        rowKey: item.rowKey,
        field: item.field,
        detail: item.reason,
      })),
    ],
    at,
  );
  await resolveClearedReviewItems(db, mappingId, raised, at);

  stats.staleFields = stale;
  stats.unstableCells = unstable.length;
  await db.doc(COLLECTIONS.syncMappings.docPath(mappingId)).update({
    lastRunId: run.id,
    lastRunAt: Timestamp.fromDate(at),
    lastRunDry: false,
    lastSuccessAt: Timestamp.fromDate(at),
    lastDriveVersion: driveVersion,
    lastStats: stats,
    ...(mapping.status === "needsAttention" ? { status: "active", statusReason: FieldValue.delete() } : {}),
    updatedAt: Timestamp.fromDate(at),
    updatedBy: SYNC_ACTOR,
    writeContext: systemWriteContext(),
  });
  const partial = plan.conflicts.length + plan.issues.length + unstable.length + invalid.length > 0;
  return { status: partial ? "partial" : "succeeded", stats, plan: entries, driveVersion };
}
