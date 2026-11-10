import { entityTypeSchema } from "../entities";
import { z } from "../zod";
import { appendOnlyBaseSchema, writeOriginSchema } from "./base";

export const AUDIT_SCHEMA_VERSION = 1;

/**
 * Registry of audit actions. Add a row here when a function starts recording a new kind of
 * change.
 *
 * | Action            | Recorded when                                                      |
 * |-------------------|--------------------------------------------------------------------|
 * | `account.created` | An account starts the portal for the first time and is registered |
 */
export const AUDIT_ACTIONS = ["account.created"] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.output<typeof auditActionSchema>;

/**
 * | Actor kind   | The change was made by                                  |
 * |--------------|---------------------------------------------------------|
 * | `user`       | A signed-in person. `actorUid` names the account        |
 * | `system`     | Trusted code acting by itself                           |
 * | `import`     | An importer                                             |
 * | `sync`       | A synchronisation with an external system               |
 * | `automation` | An automation rule                                      |
 */
export const AUDIT_ACTOR_KINDS = ["user", "system", "import", "sync", "automation"] as const;
export const auditActorKindSchema = z.enum(AUDIT_ACTOR_KINDS);
export type AuditActorKind = z.output<typeof auditActorKindSchema>;

/**
 * One changed field. `before` and `after` are present only for documents that members can
 * read. For every other document, and always for special-category fields, the entry names the
 * field, sets `withheld` and carries no value.
 */
export const auditChangeSchema = z.object({
  field: z.string().min(1),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  withheld: z.literal(true).optional(),
});
export type AuditChange = z.output<typeof auditChangeSchema>;

/** The write context of the change, with what is known about the request that made it. */
export const auditContextSchema = z.object({
  origin: writeOriginSchema,
  depth: z.number().int().min(0),
  correlationId: z.string().min(1).nullable(),
  causationId: z.string().min(1).nullable(),
  /** Identifier of the request, when the platform supplies one. */
  requestId: z.string().min(1).nullable(),
  /** The caller's network address as a keyed hash, never the address itself. */
  ipHash: z.string().min(1).nullable(),
  userAgent: z.string().min(1).max(500).nullable(),
});
export type AuditContext = z.output<typeof auditContextSchema>;

/**
 * `auditEvents/{eventId}`: one entry in the audit trail. Entries are written by trusted code,
 * are never changed afterwards and are never readable by a client.
 */
export const auditEventSchema = appendOnlyBaseSchema
  .extend({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    /** The account that made the change, or null when no person did. */
    actorUid: z.string().min(1).nullable(),
    actorKind: auditActorKindSchema,
    action: auditActionSchema,
    /** Path of the document the entry is about. */
    documentPath: z.string().min(1),
    entityType: entityTypeSchema,
    entityId: z.string().min(1),
    changes: z.array(auditChangeSchema),
    context: auditContextSchema,
  })
  .refine((event) => (event.actorKind === "user") === (event.actorUid !== null), {
    error: "An entry names an account exactly when a person made the change",
    path: ["actorUid"],
  });
export type AuditEvent = z.output<typeof auditEventSchema>;
