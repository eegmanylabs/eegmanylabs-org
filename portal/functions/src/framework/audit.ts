// The audit helper. Every function that changes state calls writeAudit with the same
// transaction or batch as the change, so the entry and the change succeed or fail together.
import { createHash } from "node:crypto";
import { type AuditActor, type AuditEventType, auditEventSchema, COLLECTIONS, paths } from "@eegml/shared";
import {
  type DocumentData,
  type Firestore,
  Timestamp,
  type Transaction,
  type WriteBatch,
} from "firebase-admin/firestore";
import { firestore } from "./admin";

export { SYSTEM_ACTOR } from "@eegml/shared";

export interface AuditEntry {
  readonly type: AuditEventType;
  /** Who made the change: a signed-in user, or SYSTEM_ACTOR for trusted code acting by itself. */
  readonly actor: AuditActor;
  /** Path of the document the event is about. */
  readonly targetPath: string;
  /** Identifiers and non-sensitive facts. Never special-category values. */
  readonly details?: Record<string, unknown>;
  readonly occurredAt: Date;
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

/**
 * Adds an audit entry to a transaction or batch and returns the entry's identifier.
 * Nothing is written until the caller's transaction or batch commits.
 */
export function writeAudit(writer: Transaction | WriteBatch, entry: AuditEntry, db: Firestore = firestore()): string {
  const data = auditEventSchema.parse({
    schemaVersion: 1,
    type: entry.type,
    actor: entry.actor,
    targetPath: entry.targetPath,
    details: entry.details ?? {},
    idempotencyKey: entry.idempotencyKey ?? null,
    occurredAt: Timestamp.fromDate(entry.occurredAt),
  }) satisfies DocumentData;

  // Transaction and WriteBatch share these two methods but not a common type.
  const target = writer as Pick<WriteBatch, "set" | "create">;
  if (entry.idempotencyKey !== undefined) {
    const reference = db.doc(paths.auditEvent(auditEventId(entry.idempotencyKey)));
    target.set(reference, data);
    return reference.id;
  }
  const reference = db.collection(COLLECTIONS.auditEvents).doc();
  target.create(reference, data);
  return reference.id;
}
