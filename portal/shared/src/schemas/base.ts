// The fields every stored document carries (docs/DATA_MODEL.md, sections 1 and 13), and the
// field types that the document schemas share.
//
// A schema in this directory extends `documentBaseSchema`, or `appendOnlyBaseSchema` for a
// collection whose documents are never updated. Every object is strict: a key the schema does
// not name is refused, so a misspelt field cannot be written. A reader that must tolerate a
// newer writer uses `parseStoredDocument`. An architecture test fails when a schema leaves a
// standard field out.
import { entityTypeSchema } from "../entities";
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
export const writeContextSchema = z.strictObject({
  origin: writeOriginSchema,
  /** 0 for a write that starts a chain. Trusted code that reacts to an event adds one. */
  depth: z.number().int().min(0),
  /** Shared by every write of one chain, or null for a write that starts one. */
  correlationId: z.string().min(1).max(200).nullable(),
  /** The event that caused this write, or null for a write that starts a chain. */
  causationId: z.string().min(1).max(200).nullable(),
  /** The audit entry a callable function wrote for this change in the same transaction. */
  auditEventId: z.string().min(1).max(200).nullable(),
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

/** The version every document schema starts at. A schema that changes shape states its own. */
export const INITIAL_SCHEMA_VERSION = 1;

/** Fields of every document that can be updated. */
export const documentBaseSchema = z.strictObject({
  schemaVersion: z.literal(INITIAL_SCHEMA_VERSION),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdBy: actorSchema,
  updatedBy: actorSchema,
  /** Set when the document is archived. Major entities are archived and never hard deleted. */
  archivedAt: timestampSchema.nullable(),
  writeContext: writeContextSchema,
});

/** Fields of every document in an append-only collection. */
export const appendOnlyBaseSchema = z.strictObject({
  schemaVersion: z.literal(INITIAL_SCHEMA_VERSION),
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

/**
 * The caps on what a user can extend (docs/DATA_MODEL.md, section 1). The security rules
 * enforce the same numbers with `size()`.
 *
 * | Limit           | Applies to                                                        |
 * |-----------------|-------------------------------------------------------------------|
 * | `shortText`     | A name, a title, a label or a key, in characters                  |
 * | `longText`      | A description, a note or a verbatim source value, in characters   |
 * | `richTextBytes` | Rich text held in a field, in bytes of UTF-8. More belongs in a page |
 * | `url`           | An address, in characters                                         |
 * | `identifier`    | A document identifier, in characters                              |
 * | `list`          | The elements of an array                                          |
 * | `map`           | The entries of a map                                              |
 */
export const LIMITS = {
  shortText: 300,
  longText: 10_000,
  richTextBytes: 100 * 1024,
  url: 2_048,
  identifier: 500,
  list: 500,
  map: 500,
} as const;

/** The number of bytes a text takes in UTF-8. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * The identifier of a document: no slash, never `.` or `..`, and never the form `__x__` that
 * Firestore reserves.
 */
export const idSchema = z
  .string()
  .min(1)
  .max(LIMITS.identifier)
  .regex(/^(?!\.{1,2}$)(?!__.*__$)[^/]+$/, { error: "Expected a document identifier" });

/** The uid of a Firebase Authentication account. */
export const uidSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/, { error: "Expected a uid" });

/** A calendar date as ISO 8601 text, for example `2026-03-31`. It sorts as text and has no time zone. */
export const isoDateSchema = z.iso.date().max(10);

/** A name, a title or a label. */
export const shortTextSchema = z.string().min(1).max(LIMITS.shortText);

/** A description or a note in plain text. */
export const longTextSchema = z.string().min(1).max(LIMITS.longText);

/** Rich text held in a field. */
export const richTextSchema = z
  .string()
  .max(LIMITS.richTextBytes)
  .refine((text) => utf8ByteLength(text) <= LIMITS.richTextBytes, {
    error: "Rich text in a field is limited to 100 KiB. Longer text belongs in a page.",
  });

/**
 * A value exactly as a source gave it. It is never trimmed, folded or converted, and an empty
 * text is a value like any other. Fields that hold one end in `Source`.
 */
export const verbatimSchema = z.string().max(LIMITS.longText);

/** A web address. Only `http` and `https` are accepted, so a stored address is safe to link to. */
export const urlSchema = z.url({ protocol: /^https?$/ }).max(LIMITS.url);

/** An ISO 3166-1 alpha-2 country code in upper case. */
export const countryCodeSchema = z
  .string()
  .max(2)
  .regex(/^[A-Z]{2}$/, { error: "Expected a two-letter country code" });

/** A bare ORCID iD, for example `0000-0002-1825-0097`. */
export const orcidSchema = z
  .string()
  .max(19)
  .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, { error: "Expected an ORCID iD" });

/** A digital object identifier without a resolver prefix, for example `10.1000/example`. */
export const doiSchema = z
  .string()
  .max(LIMITS.shortText)
  .regex(/^10\.\d{4,9}\/\S+$/, { error: "Expected a DOI" });

/**
 * The key of a map entry. A full stop separates the segments of a Firestore field path, so a
 * key never contains one.
 */
export const mapKeySchema = z
  .string()
  .min(1)
  .max(LIMITS.shortText)
  .regex(/^[^./]+$/, { error: "A map key holds no full stop and no slash" });

/** A stable key chosen by an administrator or by code: a status key, a category key, a template key. */
export const keySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]|_(?![_]|$))*$/, {
    error: "A key holds letters, digits, hyphens and single underscores, and ends with none",
  });

/** A map with at most `LIMITS.map` entries. */
export function boundedRecord<Key extends z.ZodType<string, string>, Value extends z.ZodType>(
  keySchemaOfMap: Key,
  valueSchema: Value,
  maximum: number = LIMITS.map,
) {
  return z.record(keySchemaOfMap, valueSchema).refine((map) => Object.keys(map).length <= maximum, {
    error: `A map holds at most ${maximum} entries`,
  });
}

/** A free-form map whose content the model leaves open, such as `evidence`, `config` or `metadata`. */
export const freeMapSchema = boundedRecord(z.string().min(1).max(LIMITS.shortText), z.unknown());

/** Counts by name, such as the statistics of a batch. */
export const countMapSchema = boundedRecord(mapKeySchema, z.number().int().min(0));

/** An array of document identifiers that is added to and removed from whole. */
export const idListSchema = z.array(idSchema).max(LIMITS.list);
export const uidListSchema = z.array(uidSchema).max(LIMITS.list);

/**
 * One of the scopes a document belongs to, or one of the scopes an account holds
 * (docs/DATA_MODEL.md, section 1).
 *
 * | Form               | Scope                                                         |
 * |--------------------|---------------------------------------------------------------|
 * | `programme`        | The programme as a whole: programme administrators, core team |
 * | `members`          | Every approved member                                         |
 * | `rep:<studyKey>`   | One replication                                               |
 * | `lab:<id>`         | One laboratory                                                |
 * | `group:<groupKey>` | One group                                                     |
 * | `user:<uid>`       | One account                                                   |
 * | `role:<role>`      | Every holder of a role                                        |
 */
export const scopeKeySchema = z
  .string()
  .max(LIMITS.identifier + 6)
  .regex(/^(?:programme|members|(?:rep|lab|group|user|role):[^/]+)$/, { error: "Expected a scope key" });
export const scopeKeysSchema = z.array(scopeKeySchema).max(LIMITS.list);

/**
 * The scope fields of a document whose audience follows a record of any kind: the replication
 * and the laboratory it belongs to, null where it belongs to none, and the keys of its scopes.
 */
export const scopeFieldsShape = {
  replicationId: idSchema.nullable(),
  laboratoryId: idSchema.nullable(),
  scopeKeys: scopeKeysSchema,
};

/** The scope fields of a document that belongs to one replication and one laboratory. */
export const unitScopeFieldsShape = {
  replicationId: idSchema,
  laboratoryId: idSchema,
  scopeKeys: scopeKeysSchema,
};

/** A polymorphic reference: the kind of a record and its identifier. */
export const entityRefShape = {
  entityType: entityTypeSchema,
  entityId: idSchema,
};
export const entityRefSchema = z.strictObject(entityRefShape);
export type EntityRef = z.output<typeof entityRefSchema>;

/** A span of calendar dates. An open end is absent. */
export const datePeriodSchema = z.strictObject({
  startDate: isoDateSchema.exactOptional(),
  endDate: isoDateSchema.exactOptional(),
});

/**
 * The provenance of a record that an importer created or updated (docs/DATA_MODEL.md,
 * section 1). A record made in the portal carries none of these fields.
 */
export const provenanceShape = {
  /** The current revision of each source row behind the document. */
  sourceRecordIds: idListSchema.exactOptional(),
  /** For reconciled fields: top-level field name to the source record that supplied the value. */
  fieldSources: boundedRecord(mapKeySchema, idSchema).exactOptional(),
  /** The value last imported for each field the import owns. An edit made in the portal is never overwritten. */
  importedValues: boundedRecord(mapKeySchema, z.unknown()).exactOptional(),
  sourceCreatedAt: timestampSchema.exactOptional(),
  sourceUpdatedAt: timestampSchema.exactOptional(),
  sourceAuthor: z
    .strictObject({
      personId: idSchema.nullable(),
      nameSource: verbatimSchema,
    })
    .exactOptional(),
};
export const PROVENANCE_FIELDS = Object.keys(provenanceShape) as readonly string[];

/** The provenance of a record in an append-only collection, which no later import can update. */
export const appendOnlyProvenanceShape = {
  sourceRecordIds: provenanceShape.sourceRecordIds,
};

/** The values of custom properties with the audience `member`, keyed by property identifier. */
export const customValuesSchema = boundedRecord(mapKeySchema, z.unknown());

interface UnrecognisedKeysIssue {
  readonly code: "unrecognized_keys";
  readonly keys: readonly string[];
  readonly path: readonly PropertyKey[];
}

function isUnrecognisedKeysIssue(issue: { readonly code?: string }): issue is UnrecognisedKeysIssue {
  return issue.code === "unrecognized_keys";
}

function withoutKeys(value: unknown, path: readonly PropertyKey[], keys: readonly string[]): unknown {
  if (typeof value !== "object" || value === null) return value;
  const [head, ...rest] = path;
  if (head === undefined) {
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of keys) delete copy[key];
    return copy;
  }
  if (Array.isArray(value)) {
    return value.map((element, index) => (index === head ? withoutKeys(element, rest, keys) : element));
  }
  const container = value as Record<PropertyKey, unknown>;
  return { ...container, [head]: withoutKeys(container[head], rest, keys) };
}

/**
 * Validates a document that was read from the database. Fields the schema does not know are
 * left out, so a writer that is one version ahead does not break a reader, and everything the
 * schema does know is validated as strictly as on a write. Use the schema itself, which refuses
 * unknown fields, for a document that is about to be written.
 */
export function parseStoredDocument<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
): z.ZodSafeParseResult<z.output<Schema>> {
  const strict = schema.safeParse(data);
  if (strict.success) return strict;
  let pruned = data;
  for (const issue of strict.error.issues) {
    if (!isUnrecognisedKeysIssue(issue)) return strict;
    pruned = withoutKeys(pruned, issue.path, issue.keys);
  }
  return schema.safeParse(pruned);
}
