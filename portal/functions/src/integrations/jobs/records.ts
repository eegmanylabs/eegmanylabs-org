// The records a run keeps for people: conflicts and review items. Both take identifiers derived
// from what they are about, so a question seen on ten runs is one record, and neither is ever
// reopened once a person has decided it.
import {
  type Canonical,
  COLLECTIONS,
  type EntityType,
  parseStoredDocument,
  type SyncReviewKind,
  syncConflictDocSchema,
  syncConflictId,
  syncReviewItemDocSchema,
  syncReviewItemId,
  systemWriteContext,
} from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { createdFields } from "../../framework/documents";
import { SYNC_ACTOR } from "./context";

export interface ConflictSpec {
  readonly origin: "sheet" | "document";
  readonly mappingId?: string;
  readonly generatedDocumentId?: string;
  readonly section?: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly recordId: string;
  readonly rowKey?: string;
  readonly field?: string;
  readonly label: string;
  readonly base: Canonical | undefined;
  readonly app: Canonical;
  readonly external: Canonical;
  readonly sheetRevisionId?: string;
  readonly externalModifiedAt?: Date;
  readonly externalModifiedBy?: string;
}

export function conflictIdOf(
  spec: Pick<ConflictSpec, "mappingId" | "generatedDocumentId" | "rowKey" | "section" | "field" | "base">,
): string {
  return syncConflictId(
    spec.mappingId ?? spec.generatedDocumentId ?? "",
    spec.rowKey ?? spec.section ?? "",
    spec.field ?? "",
    spec.base,
  );
}

/** Records a conflict, or refreshes the values of the open one for the same cell and base. */
export async function upsertConflict(db: Firestore, spec: ConflictSpec, at: Date): Promise<string> {
  const id = conflictIdOf(spec);
  const reference = db.doc(COLLECTIONS.syncConflicts.docPath(id));
  const now = Timestamp.fromDate(at);
  await db.runTransaction(async (transaction) => {
    const existing = parseStoredDocument(syncConflictDocSchema, (await transaction.get(reference)).data());
    const external = {
      ...(spec.sheetRevisionId === undefined ? {} : { sheetRevisionId: spec.sheetRevisionId }),
      ...(spec.externalModifiedAt === undefined
        ? {}
        : { externalModifiedAt: Timestamp.fromDate(spec.externalModifiedAt) }),
      ...(spec.externalModifiedBy === undefined ? {} : { externalModifiedBy: spec.externalModifiedBy }),
    };
    if (existing.success) {
      if (existing.data.status !== "open") return;
      transaction.update(reference, {
        appValue: spec.app,
        sheetValue: spec.external,
        entityId: spec.entityId,
        lastSeenAt: now,
        ...external,
        updatedAt: now,
        updatedBy: SYNC_ACTOR,
        writeContext: systemWriteContext(),
      });
      return;
    }
    transaction.create(
      reference,
      syncConflictDocSchema.parse({
        ...createdFields("syncConflicts", { at, actor: SYNC_ACTOR, writeContext: systemWriteContext() }),
        origin: spec.origin,
        ...(spec.mappingId === undefined ? {} : { mappingId: spec.mappingId }),
        ...(spec.generatedDocumentId === undefined ? {} : { generatedDocumentId: spec.generatedDocumentId }),
        ...(spec.section === undefined ? {} : { section: spec.section }),
        entityType: spec.entityType,
        entityId: spec.entityId,
        recordId: spec.recordId,
        ...(spec.rowKey === undefined ? {} : { rowKey: spec.rowKey }),
        ...(spec.field === undefined ? {} : { field: spec.field }),
        label: spec.label.slice(0, 300),
        ...(spec.base === undefined ? {} : { baseValue: spec.base }),
        appValue: spec.app,
        sheetValue: spec.external,
        ...external,
        detectedAt: now,
        lastSeenAt: now,
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
      }),
    );
  });
  return id;
}

/** Closes the open conflicts of cells whose two sides came to agree without a person. */
export async function settleConflicts(
  db: Firestore,
  mappingId: string,
  cells: readonly { readonly rowKey: string; readonly field: string }[],
  at: Date,
): Promise<void> {
  if (cells.length === 0) return;
  const open = await db
    .collection(COLLECTIONS.syncConflicts.collectionPath())
    .where("mappingId", "==", mappingId)
    .get();
  const now = Timestamp.fromDate(at);
  const batch = db.batch();
  for (const document of open.docs) {
    if (document.get("status") !== "open") continue;
    if (!cells.some((cell) => cell.rowKey === document.get("rowKey") && cell.field === document.get("field"))) continue;
    batch.update(document.ref, {
      status: "resolved",
      resolvedBy: SYNC_ACTOR,
      resolvedAt: now,
      note: "Both sides came to hold the same value.",
      updatedAt: now,
      updatedBy: SYNC_ACTOR,
      writeContext: systemWriteContext(),
    });
  }
  await batch.commit();
}

export interface ReviewSpec {
  readonly mappingId: string;
  readonly kind: SyncReviewKind;
  readonly rowKey?: string;
  readonly field?: string;
  readonly detail: string;
}

export function reviewItemIdOf(spec: Pick<ReviewSpec, "mappingId" | "kind" | "rowKey" | "field">): string {
  return syncReviewItemId(spec.mappingId, spec.kind, spec.rowKey ?? "", spec.field ?? "");
}

/** Records review items, or refreshes the open ones. A dismissed or resolved item is left as a person decided it. */
export async function upsertReviewItems(db: Firestore, specs: readonly ReviewSpec[], at: Date): Promise<string[]> {
  const now = Timestamp.fromDate(at);
  const ids: string[] = [];
  for (const spec of specs) {
    const id = reviewItemIdOf(spec);
    ids.push(id);
    const reference = db.doc(COLLECTIONS.syncReviewItems.docPath(id));
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        if (snapshot.get("status") === "open") {
          transaction.update(reference, {
            detail: spec.detail,
            lastSeenAt: now,
            updatedAt: now,
            updatedBy: SYNC_ACTOR,
          });
        }
        return;
      }
      transaction.create(
        reference,
        syncReviewItemDocSchema.parse({
          ...createdFields("syncReviewItems", { at, actor: SYNC_ACTOR, writeContext: systemWriteContext() }),
          mappingId: spec.mappingId,
          kind: spec.kind,
          ...(spec.rowKey === undefined ? {} : { rowKey: spec.rowKey }),
          ...(spec.field === undefined ? {} : { field: spec.field }),
          detail: spec.detail.slice(0, 10_000),
          status: "open",
          detectedAt: now,
          lastSeenAt: now,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );
    });
  }
  return ids;
}

/** The kinds of review item that a run raises again whenever their cause remains. */
const RECURRING_KINDS: readonly SyncReviewKind[] = [
  "missingKeyColumn",
  "missingColumn",
  "duplicateKey",
  "unknownRow",
  "missingRow",
  "archivedRecord",
  "formulaCell",
  "invalidValue",
  "anchorBudgetExceeded",
];

/** Resolves the open items of a mapping that a full run no longer raises: their cause has gone. */
export async function resolveClearedReviewItems(
  db: Firestore,
  mappingId: string,
  stillRaised: readonly string[],
  at: Date,
): Promise<void> {
  const items = await db
    .collection(COLLECTIONS.syncReviewItems.collectionPath())
    .where("mappingId", "==", mappingId)
    .get();
  const now = Timestamp.fromDate(at);
  const batch = db.batch();
  for (const document of items.docs) {
    const kind = document.get("kind") as SyncReviewKind;
    if (document.get("status") !== "open" || stillRaised.includes(document.id) || !RECURRING_KINDS.includes(kind))
      continue;
    batch.update(document.ref, {
      status: "resolved",
      resolvedBy: SYNC_ACTOR,
      resolvedAt: now,
      note: "The cause was no longer found on a later run.",
      resolution: FieldValue.delete(),
      updatedAt: now,
      updatedBy: SYNC_ACTOR,
    });
  }
  await batch.commit();
}
