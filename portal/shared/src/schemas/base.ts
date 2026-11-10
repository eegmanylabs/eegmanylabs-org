// The fields every stored document carries (docs/DATA_MODEL.md, sections 1 and 13).
//
// A schema in this directory extends `documentBaseSchema`, or `appendOnlyBaseSchema` for a
// collection whose documents are never updated. An architecture test fails when one does not.
import { timestampSchema } from "../timestamp";
import { z } from "../zod";

/**
 * Who or what caused a write.
 *
 * | Origin       | Written by                                              |
 * |--------------|---------------------------------------------------------|
 * | `user`       | A person, directly or through a callable function       |
 * | `import`     | An importer                                             |
 * | `sync`       | A synchronisation with an external system               |
 * | `automation` | An automation rule                                      |
 * | `system`     | Other trusted code, such as a seeding command or a job  |
 */
export const WRITE_ORIGINS = ["user", "import", "sync", "automation", "system"] as const;
export const writeOriginSchema = z.enum(WRITE_ORIGINS);
export type WriteOrigin = z.output<typeof writeOriginSchema>;

/**
 * The context of the write that last changed a document. A write event carries only the
 * document before and after the change, so the context of a chain of writes travels on the
 * document itself. Loop prevention and the audit trigger read it.
 */
export const writeContextSchema = z.object({
  origin: writeOriginSchema,
  /** 0 for a write that starts a chain. Trusted code that reacts to an event adds one. */
  depth: z.number().int().min(0),
  /** Shared by every write of one chain, or null for a write that starts one. */
  correlationId: z.string().min(1).nullable(),
  /** The event that caused this write, or null for a write that starts a chain. */
  causationId: z.string().min(1).nullable(),
  /** The audit entry a callable function wrote for this change in the same transaction. */
  auditEventId: z.string().min(1).nullable(),
});
export type WriteContext = z.output<typeof writeContextSchema>;

const SYSTEM_ACTOR_PREFIX = "system:";

/** The actor string of trusted code that acts with no signed-in caller, for example `system:import`. */
export function systemActor(name: string): string {
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
    throw new RangeError("A system actor name starts with a lower-case letter and holds letters and digits only.");
  }
  return `${SYSTEM_ACTOR_PREFIX}${name}`;
}

export function isSystemActor(actor: string): boolean {
  return actor.startsWith(SYSTEM_ACTOR_PREFIX);
}

/** A uid, or a system actor string made by `systemActor`. */
export const actorSchema = z.string().min(1).max(128);

/** Fields of every document that can be updated. */
export const documentBaseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdBy: actorSchema,
  updatedBy: actorSchema,
  /** Set when the document is archived. Major entities are archived and never hard deleted. */
  archivedAt: timestampSchema.nullable(),
  writeContext: writeContextSchema,
});

/** Fields of every document in an append-only collection. */
export const appendOnlyBaseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  createdAt: timestampSchema,
  createdBy: actorSchema,
  writeContext: writeContextSchema,
});

export const DOCUMENT_BASE_FIELDS = Object.keys(documentBaseSchema.shape) as readonly string[];
export const APPEND_ONLY_BASE_FIELDS = Object.keys(appendOnlyBaseSchema.shape) as readonly string[];

/** The write context of a change that a person starts, optionally naming its audit entry. */
export function userWriteContext(auditEventId: string | null = null): WriteContext {
  return { origin: "user", depth: 0, correlationId: null, causationId: null, auditEventId };
}

/** The write context of a change that trusted code starts by itself. */
export function systemWriteContext(
  origin: Exclude<WriteOrigin, "user"> = "system",
  auditEventId: string | null = null,
): WriteContext {
  return { origin, depth: 0, correlationId: null, causationId: null, auditEventId };
}
