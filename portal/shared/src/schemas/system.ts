// Events, audit, automation, notifications and search (docs/DATA_MODEL.md, section 13): the
// audit trail (D-007), activity entries, automation, the outbound mail outbox, the search index,
// integrity reports and the settings of the portal.
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  appendOnlyBaseSchema,
  boundedRecord,
  countMapSchema,
  documentBaseSchema,
  entityRefShape,
  freeMapSchema,
  idSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  mapKeySchema,
  scopeFieldsShape,
  shortTextSchema,
  uidSchema,
  writeOriginSchema,
} from "./base";

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
export const auditChangeSchema = z.strictObject({
  field: z.string().min(1).max(LIMITS.shortText),
  before: z.unknown().exactOptional(),
  after: z.unknown().exactOptional(),
  withheld: z.literal(true).exactOptional(),
});
export type AuditChange = z.output<typeof auditChangeSchema>;

/** The write context of the change, with what is known about the request that made it. */
export const auditContextSchema = z.strictObject({
  origin: writeOriginSchema,
  depth: z.number().int().min(0),
  correlationId: z.string().min(1).max(200).nullable(),
  causationId: z.string().min(1).max(200).nullable(),
  /** Identifier of the request, when the platform supplies one. */
  requestId: z.string().min(1).max(200).nullable(),
  /** The caller's network address as a keyed hash, never the address itself. */
  ipHash: z.string().min(1).max(128).nullable(),
  userAgent: z.string().min(1).max(500).nullable(),
});
export type AuditContext = z.output<typeof auditContextSchema>;

/**
 * `auditEvents/{eventId}`: one entry in the audit trail. Entries are written by trusted code,
 * are never changed afterwards and are never readable by a client.
 */
export const auditEventSchema = appendOnlyBaseSchema
  .extend({
    /** The account that made the change, or null when no person did. */
    actorUid: uidSchema.nullable(),
    actorKind: auditActorKindSchema,
    action: auditActionSchema,
    /** Path of the document the entry is about. */
    documentPath: z.string().min(1).max(1_500),
    ...entityRefShape,
    changes: z.array(auditChangeSchema).max(LIMITS.list),
    context: auditContextSchema,
  })
  .refine((event) => (event.actorKind === "user") === (event.actorUid !== null), {
    error: "An entry names an account exactly when a person made the change",
    path: ["actorUid"],
  });
export type AuditEvent = z.output<typeof auditEventSchema>;

/**
 * `activity/{eventId}`: what happened to a record that members work with: the actor, the record
 * and the changed fields without their values. It carries the audience of the record as scope
 * fields and is the source of activity feeds.
 */
export const activityDocSchema = appendOnlyBaseSchema.extend({
  actorUid: uidSchema.nullable(),
  action: z.string().min(1).max(100),
  ...entityRefShape,
  title: shortTextSchema.exactOptional(),
  changedFields: z.array(mapKeySchema).max(LIMITS.list),
  ...scopeFieldsShape,
});
export type ActivityDoc = z.output<typeof activityDocSchema>;

export const automationTriggerTypeSchema = z.enum([
  "recordCreated",
  "recordUpdated",
  "statusChanged",
  "schedule",
  "manual",
]);
export const automationScopeTypeSchema = z.enum(["programme", "replication", "laboratory", "group"]);

/** `automationRules/{id}`: a rule that acts when a record changes, on a schedule or on request. */
export const automationRuleDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  enabled: z.boolean(),
  triggerType: automationTriggerTypeSchema,
  triggerConfig: freeMapSchema,
  conditions: z.array(freeMapSchema).max(50),
  actions: z.array(freeMapSchema).max(50),
  scopeType: automationScopeTypeSchema,
  scopeId: idSchema,
});
export type AutomationRuleDoc = z.output<typeof automationRuleDocSchema>;

export const automationRunStatusSchema = z.enum(["running", "succeeded", "failed", "skipped"]);

/** The most log entries a run keeps: the last ones. */
export const AUTOMATION_RUN_LOG_MAX = 50;

/**
 * `automationRuns/{idempotencyKey}`: one run of a rule for one event. The identifier is the
 * idempotency key, so a rule runs once for an event however often the event is delivered.
 */
export const automationRunDocSchema = documentBaseSchema.extend({
  ruleId: idSchema,
  eventId: idSchema,
  idempotencyKey: idSchema,
  status: automationRunStatusSchema,
  attempts: z.number().int().min(0),
  log: z.array(z.string().max(2_000)).max(AUTOMATION_RUN_LOG_MAX),
  error: longTextSchema.exactOptional(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
});
export type AutomationRunDoc = z.output<typeof automationRunDocSchema>;

export const mailStatusSchema = z.enum(["queued", "sending", "sent", "failed"]);

/**
 * `mail/{id}`: one message of the outbound email outbox. No client can read it. Under the
 * emulator it is shown as a development mailbox.
 */
export const mailDocSchema = documentBaseSchema.extend({
  toAddress: z.email().max(320),
  subject: z.string().min(1).max(998),
  textBody: z.string().min(1).max(LIMITS.richTextBytes),
  htmlBody: z.string().min(1).max(LIMITS.richTextBytes).exactOptional(),
  /** The template the message was made from. Templates are defined in code beside the function that sends them. */
  templateKey: keySchema,
  eventId: idSchema.exactOptional(),
  status: mailStatusSchema,
  attempts: z.number().int().min(0),
  sentAt: timestampSchema.nullable(),
  error: longTextSchema.exactOptional(),
});
export type MailDoc = z.output<typeof mailDocSchema>;

/** `eventFailures/{consumer__eventId}`: an event that a consumer could not handle after its retries. */
export const eventFailureDocSchema = documentBaseSchema.extend({
  consumer: keySchema,
  eventId: idSchema,
  documentPath: z.string().min(1).max(1_500),
  attempts: z.number().int().min(1),
  error: longTextSchema,
  failedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
});
export type EventFailureDoc = z.output<typeof eventFailureDocSchema>;

/** `scheduledReports/{id}`: a report that is produced on a schedule and sent to its recipients. */
export const scheduledReportDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  definition: freeMapSchema,
  /** When the report runs, as a schedule expression. */
  schedule: z.string().min(1).max(200),
  /** The accounts that receive the report. */
  recipients: z.array(uidSchema).max(200),
  lastRunAt: timestampSchema.nullable(),
  enabled: z.boolean(),
});
export type ScheduledReportDoc = z.output<typeof scheduledReportDocSchema>;

/** The most distinct folded tokens one part of a search entry holds. A longer text continues in the next part. */
export const SEARCH_TOKENS_PER_PART = 5_000;

/**
 * `searchIndex/{entityType__entityId__part}`: folded tokens drawn from the title and body of a
 * record. No client reads the index: search is a callable function, which returns the entries
 * whose `scopeKeys` the caller holds. The content of `private/` and `special/` documents is
 * never indexed.
 */
export const searchIndexDocSchema = documentBaseSchema.extend({
  ...entityRefShape,
  part: z.number().int().min(0),
  title: z.string().max(1_000),
  tokens: z.array(z.string().min(1).max(100)).max(SEARCH_TOKENS_PER_PART),
  kind: keySchema,
  ...scopeFieldsShape,
});
export type SearchIndexDoc = z.output<typeof searchIndexDocSchema>;

export const integrityRunStatusSchema = z.enum(["running", "completed", "failed"]);

/** `integrityReports/{runId}`: one run of the scheduled referential-integrity checker. */
export const integrityReportDocSchema = documentBaseSchema.extend({
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  status: integrityRunStatusSchema,
  /** Check to number of findings. */
  counts: countMapSchema,
});
export type IntegrityReportDoc = z.output<typeof integrityReportDocSchema>;

/** `integrityReports/{runId}/findings/{n}`: one finding of a run. */
export const integrityFindingDocSchema = appendOnlyBaseSchema.extend({
  runId: idSchema,
  check: keySchema,
  documentPath: z.string().min(1).max(1_500),
  field: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  detail: longTextSchema.exactOptional(),
});
export type IntegrityFindingDoc = z.output<typeof integrityFindingDocSchema>;

/** `system/settings`: non-secret configuration of the portal. */
export const systemSettingsDocSchema = documentBaseSchema.extend({
  featureFlags: boundedRecord(mapKeySchema, z.boolean(), 200),
  maintenanceMode: z.boolean(),
  bannerText: z.string().min(1).max(1_000).exactOptional(),
  /** The most documents a list query may ask for. */
  listLimit: z.number().int().min(1).max(1_000),
  /** Collection to the number of days its documents are kept. */
  retention: boundedRecord(mapKeySchema, z.number().int().min(1), 200),
});
export type SystemSettingsDoc = z.output<typeof systemSettingsDocSchema>;
