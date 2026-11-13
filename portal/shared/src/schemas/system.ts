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
 * | Action                          | Recorded when                                                      |
 * |---------------------------------|--------------------------------------------------------------------|
 * | `account.created`               | An account starts the portal for the first time and is registered |
 * | `account.secondFactorChanged`   | The profile of an account follows its enrolment of a second factor |
 * | `account.suspended`             | An administrator suspends an account                               |
 * | `account.reinstated`            | An administrator lifts the suspension of an account                |
 * | `account.sessionsEnded`         | An account ends every one of its sessions                          |
 * | `admin.bootstrapped`            | A bootstrap record makes its account a programme administrator     |
 * | `claim.approved`                | An account is linked to a person, by a match or by a reviewer      |
 * | `claim.sentToReview`            | A claim found several candidates or a person who is already claimed |
 * | `claim.requested`               | An account without a match asks for access                         |
 * | `claim.rejected`                | A reviewer rejects a claim                                         |
 * | `claim.unlinked`                | An administrator reverses a wrong link                             |
 * | `role.proposed`                 | A role implied by imported data is created and awaits approval     |
 * | `role.granted`                  | A role assignment becomes active                                   |
 * | `role.revoked`                  | A role assignment is revoked                                       |
 * | `role.expired`                  | The scheduled sweep ends a role assignment at its expiry time      |
 * | `capability.granted`            | A named capability is granted to an account                        |
 * | `capability.revoked`            | A named capability grant is revoked                                |
 * | `roleCapabilities.changed`      | An override of the capability matrix is set or cleared             |
 * | `labClaim.requested`            | A member asks to represent a laboratory                            |
 * | `labClaim.approved`             | A reviewer approves such a request                                 |
 * | `labClaim.rejected`             | A reviewer rejects such a request                                  |
 * | `labClaim.withdrawn`            | The member withdraws their own request while it waits for review    |
 * | `correction.resolved`           | A correction request is accepted or rejected                       |
 * | `demographics.read`             | Special-category data of a person is served to a caller            |
 * | `demographics.aggregateRead`    | Counts of a special-category field for a scope are served, with small cells suppressed |
 * | `person.orcidChanged`           | The ORCID iD of a person is set, changed or removed                |
 * | `laboratoryMember.confirmed`    | A member entry of a laboratory is confirmed                        |
 * | `replicationMembership.confirmed` | A membership of a replication is confirmed                       |
 * | `replication.statusChanged`     | The status of a replication is changed, with its history entry      |
 * | `replication.citationEdited`    | A checked citation is changed and returns to unverified            |
 * | `institution.created`           | An institution is created with a laboratory that is registered or created |
 * | `laboratory.created`            | A laboratory is created, on approval of a registration or by an administrator |
 * | `equipment.saved`               | An equipment configuration is opened, or replaces the current one   |
 * | `participation.created`         | A participation is created with its checklist and status history    |
 * | `participation.statusChanged`   | The status of a participation is changed, with its history entry    |
 * | `reconciliation.resolved`       | A reviewer decides an item of the reconciliation queue              |
 * | `reconciliation.dismissed`      | A reviewer dismisses an item of the reconciliation queue            |
 * | `person.merged`                 | Two records of one person are merged into one                       |
 * | `person.created`                | A reviewer admits someone whom no record names, with their account  |
 * | `importBatch.rolledBack`        | An import batch is rolled back from its change log                  |
 * | `page.created`                  | A page is created, at the top of the workspace, beneath another page, from a template or as the body of a record |
 * | `page.moved`                    | A page is moved beneath another page, with every page that inherits from it |
 * | `page.sharingChanged`           | The access mode or the permissions of a page change, with the audience of what inherits it |
 * | `page.versionSaved`             | A version of a page is saved: by name, after a quiet spell or when an earlier one is restored |
 * | `page.updateDiscarded`          | An update of a page that does not decode as a Yjs update is removed by trusted code |
 * | `database.created`              | A database is created beneath a page                                |
 * | `property.saved`                | A property of a database or a custom property of a core collection is added, changed or archived |
 * | `record.saved`                  | Values of a record are changed, or a row of a database is created or archived |
 * | `view.saved`                    | A view is created or changed                                        |
 * | `dashboard.saved`               | A dashboard is created or its widgets change                        |
 * | `taskList.created`              | A task list is created, empty or from a template with its tasks     |
 * | `taskList.updated`              | A task list is renamed, archived or restored                        |
 * | `task.created`                  | A task is created, by a person or by the recurrence of a completed task |
 * | `task.updated`                  | Fields of a task change, alone or in a bulk edit                    |
 * | `task.moved`                    | A task moves, with every task beneath it                            |
 * | `task.statusChanged`            | The status of a task changes, with its history entry                |
 * | `task.participantClaimed`       | A person named on a task claims an account and joins its participants |
 * | `progressUpdate.posted`         | A progress update is posted to the feed of a record                 |
 * | `reminder.set`                  | A user sets a reminder for themselves about a task                  |
 * | `recruitmentReport.filed`       | A recruitment report is filed: new, a correction, a void or a central verification |
 * | `countCategory.saved`           | A count category is created, changed, archived or restored         |
 * | `forecast.generated`            | A recruitment forecast is run and stored                            |
 * | `recruitment.inactivityFlagged` | The sweep finds a participation without reports and opens a follow-up task |
 * | `storageEndpoint.saved`         | A storage server is registered or changed, with its connection details |
 * | `storageEndpoint.checked`       | A storage server is checked, by a person or by the daily sweep      |
 * | `storageEndpoint.connectionViewed` | An administrator reads the connection details of a storage server |
 * | `dataset.registered`            | A dataset is registered, with its first state and any first storage reference |
 * | `dataset.updated`               | Fields of a dataset, its metadata or its BIDS mappings change      |
 * | `dataset.statusChanged`         | A dataset moves to another state of its workflow, with the history entry |
 * | `datasetWorkflow.saved`         | The workflow of datasets of a replication is defined or changed    |
 * | `storageRef.added`              | A storage reference is added to a dataset                           |
 * | `storageRef.changed`            | A storage reference changes, is retired or is relocated             |
 * | `storageRef.scanned`            | A storage reference is scanned, successfully or not                 |
 * | `manifest.recorded`             | An expected manifest or a listing is recorded by hand or by upload  |
 * | `storageLocation.viewed`        | Someone reads the location of a storage reference                   |
 * | `viewerLink.saved`              | A viewer link is saved for a storage reference                      |
 * | `viewerLink.opened`             | Someone asks for a viewer link                                      |
 * | `transfer.requested`            | A transfer between storage references is requested                 |
 * | `transfer.advanced`             | A transfer is approved, refused, started, completed, failed or verified |
 * | `bidsReport.imported`           | A bids-validator report is imported                                 |
 * | `qcAssessment.recorded`         | A quality-control assessment is recorded                            |
 * | `dataset.qcTaskOpened`          | The arrival of data opens the quality-control task of a dataset     |
 * | `hypothesis.findingRecorded`    | An original statistic or a result of a hypothesis is recorded with its provenance |
 * | `analysisRun.saved`             | An analysis run is recorded or changed                              |
 * | `decision.recorded`             | An entry of the methodological decision log is recorded            |
 * | `incident.reported`             | An incident is reported                                             |
 * | `incident.actionRecorded`       | A corrective action, a change of status or a correction of an incident is recorded |
 * | `authorship.saved`              | The leads save the authorship list of a manuscript                  |
 * | `authorship.answered`           | A person confirms their entry on an authorship list or asks for a change |
 * | `manuscript.saved`              | A manuscript is created or changed through a callable function      |
 * | `manuscript.eventRecorded`      | A submission, a review round, a decision or another event of a manuscript is recorded |
 * | `manuscript.milestonePlanned`   | A milestone of a manuscript is planned as a task                    |
 * | `documentLink.osfChecked`       | An OSF link is checked against OSF                                  |
 * | `publication.prepared`          | A public export is assembled and compared with the website's files  |
 * | `publication.approved`          | An administrator approves a public export, and its pull request is opened |
 * | `publication.refreshed`         | The state of a publication's pull request is read again             |
 * | `publication.withdrawn`         | A public export is withdrawn before it is published                 |
 * | `publication.rollbackProposed`  | A pull request that restores the files a publication replaced is opened |
 * | `automationRule.saved`          | An automation rule is created, changed, switched on or off          |
 * | `automationRule.run`            | An administrator runs an automation rule by hand                    |
 * | `automation.acted`              | An automation rule acted on a record                                |
 * | `scheduledReport.saved`         | A scheduled report is created or changed                            |
 * | `document.created`              | The audit trigger saw a document created outside a callable function |
 * | `document.updated`              | The audit trigger saw a document changed outside a callable function |
 * | `document.deleted`              | The audit trigger saw a document deleted                           |
 */
export const AUDIT_ACTIONS = [
  "account.created",
  "account.secondFactorChanged",
  "account.suspended",
  "account.reinstated",
  "account.sessionsEnded",
  "admin.bootstrapped",
  "claim.approved",
  "claim.sentToReview",
  "claim.requested",
  "claim.rejected",
  "claim.unlinked",
  "role.proposed",
  "role.granted",
  "role.revoked",
  "role.expired",
  "capability.granted",
  "capability.revoked",
  "roleCapabilities.changed",
  "labClaim.requested",
  "labClaim.approved",
  "labClaim.rejected",
  "labClaim.withdrawn",
  "correction.resolved",
  "demographics.read",
  "demographics.aggregateRead",
  "person.orcidChanged",
  "laboratoryMember.confirmed",
  "replicationMembership.confirmed",
  "replication.statusChanged",
  "replication.citationEdited",
  "institution.created",
  "laboratory.created",
  "equipment.saved",
  "participation.created",
  "participation.statusChanged",
  "reconciliation.resolved",
  "reconciliation.dismissed",
  "person.merged",
  "person.created",
  "importBatch.rolledBack",
  "page.created",
  "page.moved",
  "page.sharingChanged",
  "page.versionSaved",
  "page.updateDiscarded",
  "database.created",
  "property.saved",
  "record.saved",
  "view.saved",
  "dashboard.saved",
  "taskList.created",
  "taskList.updated",
  "task.created",
  "task.updated",
  "task.moved",
  "task.statusChanged",
  "task.participantClaimed",
  "progressUpdate.posted",
  "reminder.set",
  "recruitmentReport.filed",
  "countCategory.saved",
  "forecast.generated",
  "recruitment.inactivityFlagged",
  "document.created",
  "document.updated",
  "document.deleted",
  "integration.paused",
  "integration.resumed",
  "integration.tested",
  "integration.channelRenewed",
  "integration.credentialNamed",
  "driveLink.created",
  "driveLink.checked",
  "syncMapping.saved",
  "syncMapping.paused",
  "syncMapping.resumed",
  "syncMapping.liveApproved",
  "syncMapping.liveWithdrawn",
  "syncRun.requested",
  "syncRun.retried",
  "syncRun.cancelled",
  "syncRun.deadLettered",
  "syncConflict.resolved",
  "syncReviewItem.resolved",
  "sync.recordUpdated",
  "sync.sheetUpdated",
  "documentTemplate.saved",
  "generatedDocument.requested",
  "generatedDocument.sectionTaken",
  "storageEndpoint.saved",
  "storageEndpoint.checked",
  "storageEndpoint.connectionViewed",
  "dataset.registered",
  "dataset.updated",
  "dataset.statusChanged",
  "datasetWorkflow.saved",
  "storageRef.added",
  "storageRef.changed",
  "storageRef.scanned",
  "manifest.recorded",
  "storageLocation.viewed",
  "viewerLink.saved",
  "viewerLink.opened",
  "transfer.requested",
  "transfer.advanced",
  "bidsReport.imported",
  "qcAssessment.recorded",
  "dataset.qcTaskOpened",
  "hypothesis.findingRecorded",
  "analysisRun.saved",
  "decision.recorded",
  "incident.reported",
  "incident.actionRecorded",
  "authorship.saved",
  "authorship.answered",
  "manuscript.saved",
  "manuscript.eventRecorded",
  "manuscript.milestonePlanned",
  "documentLink.osfChecked",
  "publication.prepared",
  "publication.approved",
  "publication.refreshed",
  "publication.withdrawn",
  "publication.rollbackProposed",
  "automationRule.saved",
  "automationRule.run",
  "automation.acted",
  "scheduledReport.saved",
] as const;
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

/** The text that stands in an audit entry where a value is withheld. */
export const AUDIT_WITHHELD_MARKER = "[withheld]";

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
    /**
     * The record the entry is about. An entry of the audit trigger names the document itself
     * where it is a record of the entity registry, and otherwise the nearest record above it.
     * Both are null for a document that belongs to no such record, such as a lookup.
     */
    entityType: entityRefShape.entityType.nullable(),
    entityId: entityRefShape.entityId.nullable(),
    changes: z.array(auditChangeSchema).max(LIMITS.list),
    context: auditContextSchema,
  })
  .refine((event) => (event.actorKind === "user") === (event.actorUid !== null), {
    error: "An entry names an account exactly when a person made the change",
    path: ["actorUid"],
  })
  .refine((event) => (event.entityType === null) === (event.entityId === null), {
    error: "An entry names the type and the identifier of a record together",
    path: ["entityId"],
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
export type AutomationTriggerType = z.output<typeof automationTriggerTypeSchema>;
export const automationScopeTypeSchema = z.enum(["programme", "replication", "laboratory", "group"]);

/**
 * The events an automation can start on, each with the kind of trigger it belongs to
 * (requirement R16.9). The list is fixed: an administrator chooses among these and never writes
 * a trigger of their own.
 *
 * | Event                  | Trigger type    | Happens when                                                 |
 * |------------------------|-----------------|--------------------------------------------------------------|
 * | `dataset.dataArrived`  | `recordUpdated` | The first listing of a dataset finds files                   |
 * | `laboratory.activated` | `statusChanged` | A laboratory becomes active: its registration is approved    |
 * | `recruitment.targetMet`| `recordUpdated` | The usable participants of a replication reach its target    |
 * | `schedule.daily`       | `schedule`      | Once a day, at night in London                               |
 * | `schedule.weekly`      | `schedule`      | Once a week, on Monday morning in London                     |
 * | `manual`               | `manual`        | An administrator runs the rule from its page                 |
 */
export const AUTOMATION_EVENTS = {
  "dataset.dataArrived": "recordUpdated",
  "laboratory.activated": "statusChanged",
  "recruitment.targetMet": "recordUpdated",
  "schedule.daily": "schedule",
  "schedule.weekly": "schedule",
  manual: "manual",
} as const satisfies Record<string, AutomationTriggerType>;
export type AutomationEventKey = keyof typeof AUTOMATION_EVENTS;
export const AUTOMATION_EVENT_KEYS = Object.keys(AUTOMATION_EVENTS) as [AutomationEventKey, ...AutomationEventKey[]];
export const automationEventSchema = z.enum(AUTOMATION_EVENT_KEYS);

/**
 * The actions an automation can take, a fixed list, each with the events it may follow.
 *
 * | Action                      | Does                                                                  | After |
 * |-----------------------------|-----------------------------------------------------------------------|-------|
 * | `createOnboardingChecklist` | Opens the onboarding task list of a laboratory from the onboarding checklist | `laboratory.activated` |
 * | `createQcTask`              | Opens the quality-control task of a dataset                           | `dataset.dataArrived` |
 * | `notifyLeads`               | Notifies the leads of the replication concerned in the portal         | Any event about one replication |
 * | `generateProgressReport`    | Queues an update of the progress reports generated from a template    | A schedule, a target met, or a manual run |
 * | `flagOverdueUpdates`        | Flags collecting participations without a recent report, with a follow-up task | A schedule or a manual run |
 */
export const AUTOMATION_ACTIONS = {
  createOnboardingChecklist: ["laboratory.activated"],
  createQcTask: ["dataset.dataArrived"],
  notifyLeads: ["dataset.dataArrived", "recruitment.targetMet"],
  generateProgressReport: ["schedule.weekly", "schedule.daily", "recruitment.targetMet", "manual"],
  flagOverdueUpdates: ["schedule.daily", "schedule.weekly", "manual"],
} as const satisfies Record<string, readonly AutomationEventKey[]>;
export type AutomationActionKind = keyof typeof AUTOMATION_ACTIONS;
export const AUTOMATION_ACTION_KINDS = Object.keys(AUTOMATION_ACTIONS) as [
  AutomationActionKind,
  ...AutomationActionKind[],
];
export const automationActionKindSchema = z.enum(AUTOMATION_ACTION_KINDS);

/** The facts of an event a condition may test. */
export const AUTOMATION_CONDITION_FIELDS = ["replicationId", "laboratoryId", "modality", "status"] as const;
export const automationConditionSchema = z.strictObject({
  field: z.enum(AUTOMATION_CONDITION_FIELDS),
  operator: z.enum(["equals", "notEquals", "in"]),
  /** One value for `equals` and `notEquals`, and up to fifty for `in`. */
  values: z.array(z.string().min(1).max(LIMITS.identifier)).min(1).max(50),
});
export type AutomationCondition = z.output<typeof automationConditionSchema>;

export const automationActionSchema = z.strictObject({
  kind: automationActionKindSchema,
  /** For `generateProgressReport`: the template whose documents are updated. */
  templateKey: keySchema.exactOptional(),
});
export type AutomationAction = z.output<typeof automationActionSchema>;

/**
 * `automationRules/{id}`: a rule that acts when a record changes, on a schedule or on request.
 * The rules that ship with the portal are defined in code (`BUILT_IN_AUTOMATION_RULES`) under a
 * fixed key, and a stored document under that key overrides one, which is how an administrator
 * switches it off. Written by a callable function for holders of `automations.manage`.
 */
export const automationRuleDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  enabled: z.boolean(),
  /** Whether the rule ships with the portal. Its trigger and actions are fixed; only `enabled` and `conditions` change. */
  builtIn: z.boolean(),
  triggerType: automationTriggerTypeSchema,
  triggerConfig: z.strictObject({ event: automationEventSchema }),
  conditions: z.array(automationConditionSchema).max(20),
  actions: z.array(automationActionSchema).min(1).max(10),
  scopeType: automationScopeTypeSchema,
  scopeId: idSchema,
});
export type AutomationRuleDoc = z.output<typeof automationRuleDocSchema>;

export const automationRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "skipped"]);
export type AutomationRunStatus = z.output<typeof automationRunStatusSchema>;

/** The most log entries a run keeps: the last ones. */
export const AUTOMATION_RUN_LOG_MAX = 50;

/**
 * `automationRuns/{idempotencyKey}`: one run of a rule for one event. The identifier is the
 * idempotency key, so a rule runs once for an event however often the event is delivered.
 * `chain` names the rules whose runs led to this one, so that a rule never runs again in a chain
 * it started, and `depth` is the depth of the event's write context.
 */
export const automationRunDocSchema = documentBaseSchema.extend({
  ruleId: idSchema,
  eventId: idSchema,
  idempotencyKey: idSchema,
  event: automationEventSchema,
  entityType: entityRefShape.entityType.nullable(),
  entityId: entityRefShape.entityId.nullable(),
  status: automationRunStatusSchema,
  attempts: z.number().int().min(0),
  depth: z.number().int().min(0),
  correlationId: z.string().min(1).max(200),
  chain: z.array(idSchema).max(20),
  log: z.array(z.string().max(2_000)).max(AUTOMATION_RUN_LOG_MAX),
  error: longTextSchema.exactOptional(),
  /** The job of the queue that carries out the actions, which retries them. */
  syncRunId: idSchema.exactOptional(),
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
  /** The account the message is for, where it is for one. */
  uid: uidSchema.exactOptional(),
  /** The earliest time the message may be sent: the end of the recipient's quiet hours. */
  notBefore: timestampSchema.exactOptional(),
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

export const scheduledReportScheduleSchema = z.enum(["weekly", "monthly"]);
export type ScheduledReportSchedule = z.output<typeof scheduledReportScheduleSchema>;

/**
 * `scheduledReports/{id}`: a progress report that is produced on a schedule into the generated
 * documents of phase 6 and announced to its recipients in the portal. The definition names the
 * template and the record the report is about. Written by a callable function for holders of
 * `automations.manage`.
 */
export const scheduledReportDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  definition: z.strictObject({
    templateKey: keySchema,
    entityType: entityRefShape.entityType,
    entityId: entityRefShape.entityId,
  }),
  schedule: scheduledReportScheduleSchema,
  /** The accounts that are told in the portal when the report is updated. */
  recipients: z.array(uidSchema).max(200),
  lastRunAt: timestampSchema.nullable(),
  /** The period of the last run, such as `2026-W46` or `2026-11`, so a period runs once. */
  lastPeriod: z.string().min(1).max(20).nullable(),
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
  /** For a comment or a document link: the record it belongs to, which a result opens. */
  targetEntityType: entityRefShape.entityType.exactOptional(),
  targetEntityId: entityRefShape.entityId.exactOptional(),
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
  /**
   * Whether holders of a programme role or of a named grant must enrol and present a second
   * factor. Absent means true, and so does a missing settings document. `seed:demo` switches it
   * off in the Local Emulator Suite, which cannot run a time-based one-time password.
   */
  requireSecondFactor: z.boolean().exactOptional(),
  /**
   * The days without a recruitment report after which a collecting participation is flagged and
   * given a follow-up task. Absent means 30.
   */
  recruitmentInactivityDays: z.number().int().min(7).max(365).exactOptional(),
});
export type SystemSettingsDoc = z.output<typeof systemSettingsDocSchema>;
