import {
  type Canonical,
  COLLECTIONS,
  canonicalFromApp,
  canonicalFromSheet,
  findColumn,
  generatedDocumentDocSchema,
  isSyncTargetKey,
  keyOf,
  laboratoryDocSchema,
  normaliseText,
  parseStoredDocument,
  resolveSyncConflictContract,
  type SyncConflictDoc,
  type SyncResolution,
  sheetValueOf,
  syncCellStateDocSchema,
  syncCellStateId,
  syncConflictDocSchema,
  syncMappingDocSchema,
  systemWriteContext,
  withoutProvenance,
} from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  type AuthenticatedContext,
  callerStamp,
  createdFields,
  defineCallable,
  touchedFields,
  writeAudit,
} from "../framework";
import type { WorkspaceAdapters } from "../integrations/google/types";
import { SYNC_ACTOR } from "../integrations/jobs/context";
import { currentSectionText, sectionTextNow, settleSection } from "../integrations/jobs/documents";
import { liveDependencies } from "../integrations/jobs/live";
import { mappedColumns, mappingSource, ROW_KEY_METADATA, snapshotOf } from "../integrations/jobs/sheet-sync";
import { TARGET_ADAPTERS } from "../integrations/jobs/targets";
import { interactiveAdapters, requireIntegrationsManager } from "../integrations/support";

const STOPPED =
  "The value could not be written safely, so nothing changed. Run the mapping again and look at the conflict once more.";

/** Refreshes a conflict with the values the two sides hold now, because one changed after it was recorded. */
async function refresh(
  db: Firestore,
  conflictId: string,
  app: Canonical,
  external: Canonical,
  at: Date,
): Promise<{ status: "refreshed" }> {
  await db.doc(COLLECTIONS.syncConflicts.docPath(conflictId)).update({
    appValue: app,
    sheetValue: external,
    lastSeenAt: Timestamp.fromDate(at),
    updatedAt: Timestamp.fromDate(at),
    updatedBy: SYNC_ACTOR,
    writeContext: systemWriteContext(),
  });
  return { status: "refreshed" };
}

/** Closes the conflict with the resolver, the decision and the audit entry, in one transaction. */
async function close(
  db: Firestore,
  context: AuthenticatedContext,
  conflict: SyncConflictDoc,
  conflictId: string,
  resolution: SyncResolution,
  value: Canonical,
  note: string | undefined,
  at: Date,
): Promise<{ status: "resolved" }> {
  const reference = db.doc(COLLECTIONS.syncConflicts.docPath(conflictId));
  await db.runTransaction(async (transaction) => {
    const current = parseStoredDocument(syncConflictDocSchema, (await transaction.get(reference)).data());
    if (!current.success || current.data.status !== "open")
      throw new AppError("failed-precondition", "This conflict has been resolved already.");
    const auditEventId = writeAudit(
      transaction,
      {
        action: "syncConflict.resolved",
        actor: { kind: "user", uid: context.uid },
        entityType: "syncConflict",
        entityId: conflictId,
        changes: [
          { field: "resolution", after: resolution },
          { field: conflict.field ?? conflict.section ?? "section", before: conflict.appValue, after: value },
          { field: "external", before: conflict.sheetValue, after: value },
          ...(note === undefined ? [] : [{ field: "note", after: note }]),
        ],
        at,
      },
      db,
    );
    transaction.update(reference, {
      status: "resolved",
      resolution,
      resolvedValue: value,
      resolvedBy: context.uid,
      resolvedAt: Timestamp.fromDate(at),
      ...(note === undefined ? {} : { note }),
      ...touchedFields(callerStamp(context.uid, at, auditEventId)),
    });
  });
  return { status: "resolved" };
}

/** The value a person typed as the merged value, read as the field's type. */
function mergedValue(spec: Parameters<typeof canonicalFromSheet>[0], typed: string | undefined): Canonical {
  if (typed === undefined) throw new AppError("invalid-argument", "Enter the value to keep.");
  const read = canonicalFromSheet(spec, typed);
  if (!read.ok) throw new AppError("invalid-argument", `The value cannot be kept: ${read.reason}`);
  return read.value;
}

async function resolveSheetConflict(
  db: Firestore,
  context: AuthenticatedContext,
  adapters: WorkspaceAdapters,
  conflictId: string,
  conflict: SyncConflictDoc,
  input: { resolution: SyncResolution; mergedValue?: string; note?: string },
  at: Date,
) {
  const mapping = parseStoredDocument(
    syncMappingDocSchema,
    (await db.doc(COLLECTIONS.syncMappings.docPath(conflict.mappingId ?? "")).get()).data(),
  );
  if (
    !mapping.success ||
    !isSyncTargetKey(mapping.data.collectionKey) ||
    conflict.rowKey === undefined ||
    conflict.field === undefined
  ) {
    throw new AppError("failed-precondition", "The mapping of this conflict no longer exists.");
  }
  if (mapping.data.mode !== "live") {
    throw new AppError(
      "failed-precondition",
      "This mapping is a dry run, so the sheet cannot be written. Approve live writes first.",
    );
  }
  const mappingId = conflict.mappingId ?? "";
  const column = mappedColumns(mapping.data).find((candidate) => candidate.field === conflict.field);
  if (column === undefined)
    throw new AppError("failed-precondition", "The field of this conflict is no longer mapped.");
  const target = TARGET_ADAPTERS[mapping.data.collectionKey];
  const record = (await target.load(db)).find((candidate) => candidate.key === conflict.rowKey);
  if (record === undefined || record.archived)
    throw new AppError("failed-precondition", "The record of this conflict no longer exists.");

  // Both sides as they are now. If either moved on, the conflict is refreshed and nothing is written.
  const source = await mappingSource(db, mapping.data);
  const snapshot = snapshotOf(await adapters.sheets.readTab(source.spreadsheetId, source.sheetId));
  const fold = (text: string) => text.trim().toLowerCase();
  const keyIndex = snapshot.header.find((cell) => fold(cell.text) === fold(mapping.data.keyColumn))?.index ?? null;
  const columnIndex = findColumn(snapshot.header, column);
  const row =
    keyIndex === null ? undefined : snapshot.rows.find((candidate) => keyOf(candidate, keyIndex) === conflict.rowKey);
  if (keyIndex === null || columnIndex === null || row === undefined) {
    throw new AppError(
      "failed-precondition",
      "The row or the column of this conflict can no longer be found in the sheet.",
    );
  }
  const app = canonicalFromApp(column.spec, record.values[conflict.field]);
  const sheet = canonicalFromSheet(column.spec, row.cells[columnIndex]?.value ?? null);
  if (!app.ok || !sheet.ok) throw new AppError("failed-precondition", STOPPED);
  if (app.value !== conflict.appValue || sheet.value !== conflict.sheetValue)
    return refresh(db, conflictId, app.value, sheet.value, at);

  const value =
    input.resolution === "keepApp"
      ? app.value
      : input.resolution === "keepSheet"
        ? sheet.value
        : mergedValue(column.spec, input.mergedValue);

  // The one cell, addressed by its row's anchor, and checked as it reads back.
  if (value !== sheet.value) {
    const values: (string | number | boolean | null)[] = Array.from({ length: columnIndex + 1 }, () => null);
    values[columnIndex] = value === null ? "" : sheetValueOf(column.spec, value);
    const [after = []] = await adapters.sheets.writeRows(source.spreadsheetId, [
      {
        sheetId: source.sheetId,
        row:
          row.anchor === conflict.rowKey
            ? { kind: "metadata", metadataKey: ROW_KEY_METADATA, metadataValue: conflict.rowKey }
            : { kind: "position", index: row.position - 1 },
        values,
      },
    ]);
    const keyAfter = after[keyIndex]?.value ?? null;
    const readBack = canonicalFromSheet(column.spec, after[columnIndex]?.value ?? null);
    if (keyAfter === null || String(keyAfter).trim() !== conflict.rowKey || !readBack.ok || readBack.value !== value) {
      throw new AppError("failed-precondition", STOPPED);
    }
  }
  if (value !== app.value) {
    const written = await target.write(db, record, [{ field: conflict.field, canonical: value, expected: app.value }], {
      mappingId,
      runId: `resolution-${conflictId}`,
      at,
    });
    if (written.kind === "invalid") throw new AppError("invalid-argument", written.reason);
    if (written.kind === "stale") return refresh(db, conflictId, app.value, value, at);
  }
  // The base of the cell is the value both sides now hold.
  await db
    .doc(COLLECTIONS.syncMappingCellState.docPath(mappingId, syncCellStateId(record.recordId, conflict.field)))
    .set(
      syncCellStateDocSchema.parse({
        ...createdFields("syncMappingCellState", { at, actor: SYNC_ACTOR, writeContext: systemWriteContext() }),
        mappingId,
        recordId: record.recordId,
        rowKey: conflict.rowKey,
        field: conflict.field,
        appValue: value,
        sheetValue: value,
        syncedAt: Timestamp.fromDate(at),
        unstable: false,
      }),
    );
  return close(db, context, conflict, conflictId, input.resolution, value, input.note, at);
}

async function resolveDocumentConflict(
  db: Firestore,
  context: AuthenticatedContext,
  adapters: WorkspaceAdapters,
  conflictId: string,
  conflict: SyncConflictDoc,
  input: { resolution: SyncResolution; mergedValue?: string; note?: string },
  at: Date,
) {
  const generatedId = conflict.generatedDocumentId;
  const section = conflict.section;
  if (generatedId === undefined || section === undefined)
    throw new AppError("failed-precondition", "The document of this conflict no longer exists.");
  const generated = await db.doc(COLLECTIONS.generatedDocuments.docPath(generatedId)).get();
  const externalId: unknown = generated.get("externalDocumentId");
  if (typeof externalId !== "string")
    throw new AppError("failed-precondition", "The document of this conflict no longer exists.");
  const text = await sectionTextNow(adapters.docs, externalId, section);
  if (text === null) throw new AppError("failed-precondition", "The section has gone from the document.");
  const designated = conflict.field;
  const laboratoryReference = db.doc(COLLECTIONS.laboratories.docPath(conflict.entityId));
  const documentValue = designated === undefined ? normaliseText(text) : normaliseText(withoutProvenance(text));
  let app: Canonical = null;
  if (designated !== undefined) {
    const laboratory = parseStoredDocument(laboratoryDocSchema, (await laboratoryReference.get()).data());
    if (!laboratory.success) throw new AppError("failed-precondition", "The record of this conflict no longer exists.");
    const stored: unknown = (laboratory.data as Record<string, unknown>)[designated];
    app = typeof stored === "string" ? normaliseText(stored) : null;
  }
  if (documentValue !== conflict.sheetValue || app !== conflict.appValue)
    return refresh(db, conflictId, app, documentValue, at);
  if (designated === undefined && input.resolution === "merged") {
    throw new AppError(
      "invalid-argument",
      "This section is bound to no field, so keep either the generated text or the text in the document.",
    );
  }
  const portalUrl = liveDependencies().portalUrl;
  const generatedDoc = parseStoredDocument(generatedDocumentDocSchema, generated.data());
  if (!generatedDoc.success)
    throw new AppError("failed-precondition", "The document of this conflict no longer exists.");

  let kept: Canonical;
  if (designated !== undefined && input.resolution !== "keepApp") {
    // The designated field takes the document's text, or the merged one, with an audit entry of the person.
    kept = input.resolution === "keepSheet" ? documentValue : normaliseText(input.mergedValue ?? "");
    if (kept === null) throw new AppError("invalid-argument", "Enter the text to keep.");
    await db.runTransaction(async (transaction) => {
      const laboratory = parseStoredDocument(laboratoryDocSchema, (await transaction.get(laboratoryReference)).data());
      if (!laboratory.success)
        throw new AppError("failed-precondition", "The record of this conflict no longer exists.");
      const before: unknown = (laboratory.data as Record<string, unknown>)[designated];
      const next = laboratoryDocSchema.safeParse({ ...laboratory.data, [designated]: kept });
      if (!next.success) throw new AppError("invalid-argument", "The laboratory record does not accept this text.");
      const auditEventId = writeAudit(
        transaction,
        {
          action: "generatedDocument.sectionTaken",
          actor: { kind: "user", uid: context.uid },
          entityType: "laboratory",
          entityId: conflict.entityId,
          changes: [{ field: designated, before: before ?? null, after: kept }],
          at,
        },
        db,
      );
      transaction.update(laboratoryReference, {
        [designated]: kept ?? FieldValue.delete(),
        ...touchedFields(callerStamp(context.uid, at, auditEventId)),
      });
    });
    await settleSection(
      db,
      adapters.docs,
      generatedId,
      section,
      {
        kind: "rewrite",
        text: await currentSectionText(db, generatedDoc.data, section, portalUrl, at),
        base: kept,
      },
      at,
    );
  } else if (input.resolution === "keepApp") {
    kept = designated === undefined ? null : app;
    await settleSection(
      db,
      adapters.docs,
      generatedId,
      section,
      {
        kind: "rewrite",
        text: await currentSectionText(db, generatedDoc.data, section, portalUrl, at),
        ...(designated === undefined ? {} : { base: app }),
      },
      at,
    );
  } else {
    kept = documentValue;
    await settleSection(db, adapters.docs, generatedId, section, { kind: "detach" }, at);
  }
  return close(db, context, conflict, conflictId, input.resolution, kept, input.note, at);
}

/**
 * Resolves a conflict (docs/INTEGRATIONS.md, section 3.3), for holders of `integrations.manage`.
 *
 * | Origin   | Keep the portal value   | Keep the sheet or document  | Merged                       |
 * |----------|-------------------------|-----------------------------|------------------------------|
 * | Sheet    | Written to the one cell | Written to the record       | Written to both              |
 * | Document, designated field | The section is generated again | The field takes the section's text | The field takes the merged text |
 * | Document, other section | The section is generated again | The section keeps the human text and is generated no more | Refused |
 *
 * The function first reads both sides again. If either changed after the conflict was
 * recorded, nothing is written and the conflict is refreshed with the new values. Otherwise the
 * write, the base and the closing of the conflict follow, and the audit trail names the resolver.
 */
export const resolveSyncConflict = defineCallable(resolveSyncConflictContract, {
  handler: async (input, context) => {
    const { db } = context;
    await requireIntegrationsManager(db, context);
    const conflict = parseStoredDocument(
      syncConflictDocSchema,
      (await db.doc(COLLECTIONS.syncConflicts.docPath(input.conflictId)).get()).data(),
    );
    if (!conflict.success) throw new AppError("not-found", "This conflict does not exist.");
    if (conflict.data.status !== "open")
      throw new AppError("failed-precondition", "This conflict has been resolved already.");
    const { adapters } = interactiveAdapters();
    const at = context.clock.now();
    const options = {
      resolution: input.resolution,
      ...(input.mergedValue === undefined ? {} : { mergedValue: input.mergedValue }),
      ...(input.note === undefined ? {} : { note: input.note }),
    };
    return conflict.data.origin === "sheet"
      ? resolveSheetConflict(db, context, adapters, input.conflictId, conflict.data, options, at)
      : resolveDocumentConflict(db, context, adapters, input.conflictId, conflict.data, options, at);
  },
});
