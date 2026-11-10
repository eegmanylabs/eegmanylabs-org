// The audit helper. Every function that changes state calls writeAudit with the same
// transaction or batch as the change, so the entry and the change succeed or fail together,
// and names the entry in the `writeContext.auditEventId` of each document it writes.
import { createHash } from "node:crypto";
import {
  AUDIT_SCHEMA_VERSION,
  type AuditAction,
  type AuditActorKind,
  type AuditChange,
  type AuditContext,
  auditEventSchema,
  COLLECTIONS,
  type EntityType,
  entityPath,
  paths,
  systemActor,
} from "@eegml/shared";
import {
  type DocumentData,
  type Firestore,
  Timestamp,
  type Transaction,
  type WriteBatch,
} from "firebase-admin/firestore";
import { firestore } from "./admin";

/** Who made a change: a signed-in person, or trusted code of one of the other kinds. */
export type AuditActor =
  | { readonly kind: "user"; readonly uid: string }
  | { readonly kind: Exclude<AuditActorKind, "user"> };

export interface AuditEntry {
  readonly action: AuditAction;
  readonly actor: AuditActor;
  /** The record the entry is about. Its document path is taken from the entity registry. */
  readonly entityType: EntityType;
  readonly entityId: string;
  /**
   * The fields that changed. Give values only for documents that members can read. For any
   * other document use `withheldChanges`, and never give a special-category value.
   */
  readonly changes?: readonly AuditChange[];
  /** When the change was made. Use the same instant as the documents written with it. */
  readonly at: Date;
  /** What is known about the chain of writes and about the request. Absent parts are stored as null. */
  readonly context?: Partial<Omit<AuditContext, "origin">>;
  /**
   * Names the operation being recorded. When present, the entry's identifier is derived from
   * it, so recording the same operation again rewrites the same entry and never adds a second.
   */
  readonly idempotencyKey?: string;
}

/** The document identifier that an idempotency key always maps to. */
export function auditEventId(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
}

/** Changes that name their fields and carry no value, for documents that members cannot read. */
export function withheldChanges(fields: readonly string[]): AuditChange[] {
  return [...fields].sort().map((field) => ({ field, withheld: true }));
}

/**
 * Adds an audit entry to a transaction or batch and returns the entry's identifier, which the
 * caller puts in the write context of the documents it writes. Nothing is written until the
 * caller's transaction or batch commits. In a transaction, call it after the last read.
 */
export function writeAudit(writer: Transaction | WriteBatch, entry: AuditEntry, db: Firestore = firestore()): string {
  const reference =
    entry.idempotencyKey === undefined
      ? db.collection(COLLECTIONS.auditEvents).doc()
      : db.doc(paths.auditEvent(auditEventId(entry.idempotencyKey)));
  const chain = {
    origin: entry.actor.kind,
    depth: entry.context?.depth ?? 0,
    correlationId: entry.context?.correlationId ?? null,
    causationId: entry.context?.causationId ?? null,
  };

  const data = auditEventSchema.parse({
    schemaVersion: AUDIT_SCHEMA_VERSION,
    createdAt: Timestamp.fromDate(entry.at),
    createdBy: entry.actor.kind === "user" ? entry.actor.uid : systemActor(entry.actor.kind),
    writeContext: { ...chain, auditEventId: reference.id },
    actorUid: entry.actor.kind === "user" ? entry.actor.uid : null,
    actorKind: entry.actor.kind,
    action: entry.action,
    documentPath: entityPath(entry.entityType, entry.entityId),
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: [...(entry.changes ?? [])],
    context: {
      ...chain,
      requestId: entry.context?.requestId ?? null,
      ipHash: entry.context?.ipHash ?? null,
      userAgent: entry.context?.userAgent ?? null,
    },
  }) satisfies DocumentData;

  // Transaction and WriteBatch share these two methods but not a common type.
  const target = writer as Pick<WriteBatch, "set" | "create">;
  if (entry.idempotencyKey === undefined) target.create(reference, data);
  else target.set(reference, data);
  return reference.id;
}
