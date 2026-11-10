import { timestampSchema } from "../timestamp";
import { z } from "../zod";

export const AUDIT_SCHEMA_VERSION = 1;

/**
 * Registry of audit event types. Add a row here when a function starts recording a new kind of
 * event.
 *
 * | Type              | Recorded when                                              |
 * |-------------------|------------------------------------------------------------|
 * | `account.created` | An account signs in for the first time and gets its access document |
 */
export const AUDIT_EVENT_TYPES = ["account.created"] as const;
export const auditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export type AuditEventType = z.output<typeof auditEventTypeSchema>;

export const SYSTEM_ACTOR_ID = "system";

/** The actor recorded for changes made by trusted code with no signed-in caller. */
export const SYSTEM_ACTOR = { kind: "system", id: SYSTEM_ACTOR_ID } as const;

export const auditActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), uid: z.string().min(1) }),
  z.object({ kind: z.literal("system"), id: z.literal(SYSTEM_ACTOR_ID) }),
]);
export type AuditActor = z.output<typeof auditActorSchema>;

/**
 * `auditEvents/{eventId}`: one entry in the audit trail. Entries are written by functions and
 * are never changed afterwards. `details` holds identifiers and non-sensitive facts only:
 * special-category values are never written here.
 */
export const auditEventSchema = z.object({
  schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
  type: auditEventTypeSchema,
  actor: auditActorSchema,
  /** Path of the document the event is about. */
  targetPath: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
  /** Present when the identifier of the entry was derived from this key. */
  idempotencyKey: z.string().min(1).max(500).nullable(),
  occurredAt: timestampSchema,
});
export type AuditEvent = z.output<typeof auditEventSchema>;
