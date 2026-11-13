// Provenance, migration and integrations (docs/DATA_MODEL.md, section 12): the source registry,
// import batches and the verbatim rows they stored (D-012), the reconciliation queue, and the
// records of synchronisation, generated documents and publishing.

import { MANAGED_SECTION_STATUSES } from "../docs/plan";
import { DOCUMENT_TEMPLATE_KINDS } from "../docs/templates";
import { entityTypeSchema } from "../entities";
import { ROW_POLICIES, SYNC_DIRECTIONS, SYNC_ISSUE_KINDS } from "../sync/planner";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  boundedRecord,
  countMapSchema,
  documentBaseSchema,
  entityRefSchema,
  entityRefShape,
  freeMapSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  mapKeySchema,
  provenanceShape,
  scopeFieldsShape,
  shortTextSchema,
  urlSchema,
  verbatimSchema,
} from "./base";
import { linkAccessStatusSchema } from "./outputs";
import { collectionKeySchema } from "./workspace";

/** The key of a source: its letter in the source registry, or a hash for an unlettered source. Never an address. */
export const sourceKeySchema = keySchema;

export const sourceKindSchema = z.enum(["googleSheet", "driveFile", "repositoryTsv", "quire", "osf", "other"]);
export const sourceAuthoritySchema = z.enum(["historical", "live", "reference"]);
export const sourceSyncPolicySchema = z.enum(["oneOff", "repeatable", "scheduledPull", "twoWay"]);

/**
 * `sources/{key}`: one entry of the source registry. The address and the external identifier of
 * the source document are in a document that no client can read, and are never committed.
 */
export const sourceDocSchema = documentBaseSchema.extend({
  key: sourceKeySchema,
  title: shortTextSchema,
  kind: sourceKindSchema,
  owner: shortTextSchema.exactOptional(),
  authority: sourceAuthoritySchema,
  syncPolicy: sourceSyncPolicySchema,
  cadence: shortTextSchema.exactOptional(),
  accessStatus: linkAccessStatusSchema,
  lastFetchedAt: timestampSchema.nullable(),
  notes: longTextSchema.exactOptional(),
});
export type SourceDoc = z.output<typeof sourceDocSchema>;

/** `sources/{key}/private/location`: where the source document is. */
export const sourceLocationDocSchema = documentBaseSchema.extend({
  url: urlSchema.exactOptional(),
  externalId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
});
export type SourceLocationDoc = z.output<typeof sourceLocationDocSchema>;

export const tabVisibilitySchema = z.enum(["visible", "hidden", "veryHidden"]);

/**
 * `sources/{key}/tabs/{tabKey}`: one tab of a source, keyed by the hash of its exact title. It
 * records the identifier that the source itself gives the tab, so that a renamed tab is recognised.
 */
export const sourceTabDocSchema = documentBaseSchema.extend({
  sourceKey: sourceKeySchema,
  tabKey: keySchema,
  /** The title exactly as the source writes it. */
  name: verbatimSchema,
  sheetId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  visibility: tabVisibilitySchema,
  headerRow: z.number().int().min(1).exactOptional(),
  rowCount: z.number().int().min(0).exactOptional(),
  importerKey: keySchema.exactOptional(),
  lastSeenAt: timestampSchema,
});
export type SourceTabDoc = z.output<typeof sourceTabDocSchema>;

export const importModeSchema = z.enum(["preview", "apply"]);

const sha256Schema = z
  .string()
  .max(64)
  .regex(/^[0-9a-f]{64}$/, { error: "Expected a SHA-256 hash in hexadecimal" });
export const importBatchStatusSchema = z.enum(["running", "previewed", "applied", "failed", "rolledBack"]);

/** `importBatches/{batchId}`: one run of an importer. A preview and an apply of one file are different batches. */
export const importBatchDocSchema = documentBaseSchema.extend({
  sourceKey: sourceKeySchema,
  mode: importModeSchema,
  status: importBatchStatusSchema,
  contentHash: sha256Schema,
  startedBy: actorSchema,
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  stats: countMapSchema,
  /** The date of the export, as the operator states it. */
  observedOn: isoDateSchema.exactOptional(),
  /** The files that were read, each with its SHA-256. `contentHash` covers them all. */
  inputFiles: z
    .array(z.strictObject({ name: z.string().min(1).max(LIMITS.shortText), sha256: sha256Schema }))
    .max(100)
    .exactOptional(),
  /** The commit at which a source held in a repository was read. */
  sourceCommit: z
    .string()
    .min(7)
    .max(64)
    .regex(/^[0-9a-f]+$/, { error: "Expected a commit hash" })
    .exactOptional(),
  /** A hash of the planned writes and items, by which an apply is matched to the preview it carries out. */
  planHash: sha256Schema.exactOptional(),
  /** The previewed batch that an apply carries out, where the operator named one. */
  previewBatchId: idSchema.exactOptional(),
  /**
   * The batch whose `seenRecords` list what this batch saw: the batch itself, or an earlier
   * batch of the same source when the set of records has not changed since.
   */
  manifestBatchId: idSchema.exactOptional(),
  /**
   * The report of the last verification of the batch: when it ran, whether every check passed,
   * and each check with what it counted. A batch counts as verified only while `passed` is true.
   * A detail holds counts and paths of documents and never a value of one.
   */
  verification: z
    .strictObject({
      checkedAt: timestampSchema,
      passed: z.boolean(),
      checks: z
        .array(
          z.strictObject({
            key: z.string().min(1).max(LIMITS.shortText),
            passed: z.boolean(),
            detail: z.string().max(2_000),
          }),
        )
        .max(50),
    })
    .exactOptional(),
});
export type ImportBatchDoc = z.output<typeof importBatchDocSchema>;

export const changeOperationSchema = z.enum(["create", "update", "delete"]);
export const changeRelationSchema = z.enum(["created", "updated", "matched"]);

/** The state of the fields an import owns, or null where the document did not exist. */
const importedStateSchema = freeMapSchema.nullable();

/**
 * `importBatches/{batchId}/changes/{n}`: one write a batch made to an entity, with the state of
 * the imported fields before and after it, which makes a batch reversible. For a
 * special-category document the two states hold a marker alone, and `documentPath` names the
 * collection and no document.
 */
export const importBatchChangeDocSchema = appendOnlyBaseSchema.extend({
  batchId: idSchema,
  documentPath: z.string().min(1).max(1_500),
  operation: changeOperationSchema,
  relation: changeRelationSchema,
  sourceRecordIds: z.array(idSchema).max(LIMITS.list),
  before: importedStateSchema,
  after: importedStateSchema,
});
export type ImportBatchChangeDoc = z.output<typeof importBatchChangeDocSchema>;

/**
 * `importBatches/{batchId}/changes/{n}/special/state`: the two states of a special-category
 * document, and its path, which the entry that clients can read replaces by the path of the
 * collection so that it does not say whose document was written.
 */
export const importBatchChangeStateDocSchema = appendOnlyBaseSchema.extend({
  documentPath: z.string().min(1).max(1_500).exactOptional(),
  before: importedStateSchema,
  after: importedStateSchema,
});
export type ImportBatchChangeStateDoc = z.output<typeof importBatchChangeStateDocSchema>;

/** The most source record identifiers that one chunk of a batch lists. */
export const SEEN_RECORDS_CHUNK_MAX = 10_000;

/** `importBatches/{batchId}/seenRecords/{n}`: one chunk of the records a batch saw. */
export const importBatchSeenRecordsDocSchema = appendOnlyBaseSchema.extend({
  batchId: idSchema,
  index: z.number().int().min(0),
  sourceRecordIds: z.array(idSchema).max(SEEN_RECORDS_CHUNK_MAX),
});
export type ImportBatchSeenRecordsDoc = z.output<typeof importBatchSeenRecordsDocSchema>;

export const logLevelSchema = z.enum(["info", "warning", "error"]);

/** `importBatches/{batchId}/log/{n}`: one log entry. Messages carry identifiers and counts and never a personal value. */
export const importBatchLogDocSchema = appendOnlyBaseSchema.extend({
  batchId: idSchema,
  level: logLevelSchema,
  message: z.string().min(1).max(2_000),
  documentPath: z.string().min(1).max(1_500).exactOptional(),
});
export type ImportBatchLogDoc = z.output<typeof importBatchLogDocSchema>;

/** The cells of a row exactly as the source holds them: values, formulas and the formatting flags that carry meaning. */
const rawRowSchema = boundedRecord(z.string().max(1_000), z.unknown(), 5_000);

const shortHashSchema = z
  .string()
  .min(12)
  .max(64)
  .regex(/^[0-9a-f]+$/, { error: "Expected a hash in hexadecimal" });

/**
 * `sourceRecords/{id}`: one revision of an imported row, stored once and verbatim. Its raw
 * content never changes. Only `lastSeenBatchId`, which is written when the row goes missing or
 * reappears, and `supersededById` are written later.
 */
export const sourceRecordDocSchema = documentBaseSchema.extend({
  sourceKey: sourceKeySchema,
  tabKey: keySchema,
  /** A stable identity derived from natural keys, never from the row number alone. */
  rowKey: z.string().min(1).max(LIMITS.shortText),
  rowNumber: z.number().int().min(1).exactOptional(),
  raw: rawRowSchema,
  /** The number of `rawChunks` documents in which a row too large for one document continues. */
  rawChunkCount: z.number().int().min(1).max(1_000).exactOptional(),
  rawHash: shortHashSchema,
  /** The date of the export. */
  observedOn: isoDateSchema,
  firstSeenBatchId: idSchema,
  lastSeenBatchId: idSchema,
  /** The next revision of the same row. */
  supersededById: idSchema.nullable(),
});
export type SourceRecordDoc = z.output<typeof sourceRecordDocSchema>;

/** `sourceRecords/{id}/special/raw`: the special-category cells of the row, verbatim, where no client can read them. */
export const sourceRecordSpecialDocSchema = documentBaseSchema.extend({
  sourceRecordId: idSchema,
  raw: rawRowSchema,
});
export type SourceRecordSpecialDoc = z.output<typeof sourceRecordSpecialDocSchema>;

/** `sourceRecords/{id}/rawChunks/{n}`: the continuation of a row too large for one document. */
export const sourceRecordRawChunkDocSchema = appendOnlyBaseSchema.extend({
  sourceRecordId: idSchema,
  index: z.number().int().min(0),
  raw: rawRowSchema,
});
export type SourceRecordRawChunkDoc = z.output<typeof sourceRecordRawChunkDocSchema>;

/**
 * The kinds of reconciliation item. The first six are the kinds of the data model, and the
 * others are those that discovery found a need for (docs/MIGRATION_PLAN.md, section 7).
 */
export const reconciliationKindSchema = z.enum([
  "duplicatePerson",
  "conflictingLead",
  "ambiguousLaboratory",
  "valueConflict",
  "unmatchedIdentifier",
  "ambiguousEmail",
  "aliasConfirmation",
  "statusQuestion",
  "unverifiedLabel",
  "identifierDefect",
  "institutionMatch",
  "candidateLink",
  "structureChange",
  "unparsedValue",
  "formattingSignal",
  "annotationReview",
  "vocabularyReview",
  "linkDefect",
  "privacyReview",
  "missingFromSource",
]);
export type ReconciliationKind = z.output<typeof reconciliationKindSchema>;

export const reconciliationStatusSchema = z.enum([
  "open",
  "resolved",
  "dismissed",
  "superseded",
  "cleared",
  "withdrawn",
]);

/** One candidate of a conflict, with the source record behind it. It never holds a special-category value. */
export const reconciliationCandidateSchema = z.strictObject({
  /** The key that entered the fingerprint: the claim source and the hash of the normalised value. */
  key: z.string().min(1).max(LIMITS.shortText),
  valueSource: verbatimSchema.exactOptional(),
  /** The source record behind the value. Absent for a value that was edited in the portal. */
  sourceRecordId: idSchema.exactOptional(),
});

/**
 * `reconciliationItems/{fingerprint}`: one item of the human review queue. A repeated import
 * addresses the same item and never reopens or overwrites it, and a resolution is a stored
 * decision that later imports apply again.
 */
export const reconciliationItemDocSchema = documentBaseSchema.extend({
  kind: reconciliationKindSchema,
  /** The records the conflict is about. */
  entityRefs: z.array(entityRefSchema).max(50),
  /** The source the conflict arose in, where it is about a source and not about a record. */
  sourceKey: sourceKeySchema.exactOptional(),
  /** The field in conflict. A conflict in a special-category field names the field and the source records only. */
  field: mapKeySchema.exactOptional(),
  candidates: z.array(reconciliationCandidateSchema).max(100),
  status: reconciliationStatusSchema,
  resolution: freeMapSchema.exactOptional(),
  resolvedBy: actorSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
  /** The batch that raised the item. */
  batchId: idSchema,
  /**
   * The key of the question itself, for a question that several sources of one family each state
   * as far as they know it: the fingerprint of the item without its candidates. When a source
   * states the question with further candidates, the earlier statements are superseded.
   */
  subjectKey: idSchema.exactOptional(),
});
export type ReconciliationItemDoc = z.output<typeof reconciliationItemDocSchema>;

/** The key of an external system, such as `quire`, `googleSheets` or `doi`. */
export const systemKeySchema = keySchema;

/** `integrationMappings/{system__entityType__hashOfExternalId}`: the identifier of a record in an external system. */
export const integrationMappingDocSchema = documentBaseSchema.extend({
  ...entityRefShape,
  system: systemKeySchema,
  externalId: z.string().min(1).max(LIMITS.url),
  externalUrl: urlSchema.exactOptional(),
  ...provenanceShape,
});
export type IntegrationMappingDoc = z.output<typeof integrationMappingDocSchema>;

/** The Google services the portal connects to, each through an adapter of its own. */
export const GOOGLE_SYSTEMS = ["googleDrive", "googleSheets", "googleDocs"] as const;
export const googleSystemSchema = z.enum(GOOGLE_SYSTEMS);
export type GoogleSystem = z.output<typeof googleSystemSchema>;

/**
 * The state of a connection (docs/INTEGRATIONS.md, section 9).
 *
 * | State            | Meaning                                                              |
 * |------------------|----------------------------------------------------------------------|
 * | `notConfigured`  | No credential or identity exists for the system                      |
 * | `dryRun`         | The connection reads and plans, and nothing it serves writes externally |
 * | `live`           | At least one approved mapping or template writes externally           |
 * | `degraded`       | The last attempt failed and retries are under way, or a quota is respected |
 * | `needsAttention` | Retries are exhausted, access was lost, or a guard stopped a write   |
 * | `paused`         | An administrator stopped the connection                              |
 */
export const integrationConnectionStatusSchema = z.enum([
  "notConfigured",
  "dryRun",
  "live",
  "degraded",
  "needsAttention",
  "paused",
]);
export type IntegrationConnectionStatus = z.output<typeof integrationConnectionStatusSchema>;

/** Which implementation serves a connection: none, the in-memory fake of the emulator, or the real adapter. */
export const integrationAdapterSchema = z.enum(["none", "fake", "real"]);

/**
 * The name of a secret in the secret store, such as `GOOGLE_DOCS_REFRESH_TOKEN`. A document
 * names a secret and never holds one.
 */
export const secretNameSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[A-Z][A-Z0-9_]+$/, { error: "Expected the name of a secret, in capitals and underscores" });

/** `integrationConnections/{system}`: the state of one integration. `credentialRef` names a secret and is never the secret. */
export const integrationConnectionDocSchema = documentBaseSchema.extend({
  system: systemKeySchema,
  status: integrationConnectionStatusSchema,
  adapter: integrationAdapterSchema,
  /** The account the connection acts as, which file owners share files with. */
  identity: shortTextSchema.exactOptional(),
  /** Non-secret configuration. */
  config: freeMapSchema,
  credentialRef: secretNameSchema.exactOptional(),
  /** Why the connection is in its state, in words, where the state needs a reason. */
  statusReason: longTextSchema.exactOptional(),
  lastSuccessAt: timestampSchema.nullable(),
  lastError: longTextSchema.exactOptional(),
  lastErrorAt: timestampSchema.nullable(),
  /** For Drive: the page token from which the change feed is read next. It never expires. */
  changesPageToken: z.string().min(1).max(200).exactOptional(),
  lastPolledAt: timestampSchema.nullable().exactOptional(),
});
export type IntegrationConnectionDoc = z.output<typeof integrationConnectionDocSchema>;

/**
 * `driveChannels/{channelId}`: one push channel on the Drive change log. A channel lasts a week
 * at most and cannot be renewed, so a replacement is opened before it expires. The channel
 * token itself is never stored, only its hash, which a notification is compared with.
 */
export const driveChannelDocSchema = documentBaseSchema.extend({
  channelId: z.string().min(1).max(64),
  resourceId: z.string().min(1).max(LIMITS.shortText),
  tokenHash: z
    .string()
    .max(64)
    .regex(/^[0-9a-f]{64}$/, { error: "Expected a SHA-256 hash in hexadecimal" }),
  expiresAt: timestampSchema,
  /** The highest message number handled, so that a repeated or older message is ignored. */
  lastMessageNumber: z.number().int().min(0),
  lastMessageAt: timestampSchema.nullable(),
  stoppedAt: timestampSchema.nullable(),
});
export type DriveChannelDoc = z.output<typeof driveChannelDocSchema>;

export const syncDirectionSchema = z.enum(SYNC_DIRECTIONS);

export const syncColumnSchema = z.strictObject({
  field: mapKeySchema,
  /** The header of the column in the sheet, as written. */
  column: z.string().min(1).max(LIMITS.shortText),
  direction: syncDirectionSchema,
});
export type SyncColumn = z.output<typeof syncColumnSchema>;

/** Whether an external write is made, or only planned and shown (docs/INTEGRATIONS.md, section 1). */
export const integrationModeSchema = z.enum(["dryRun", "live"]);
export type IntegrationMode = z.output<typeof integrationModeSchema>;

export const syncMappingStatusSchema = z.enum(["active", "paused", "needsAttention"]);

/** A value in the canonical form of the synchronisation planner, or null for no value. */
export const canonicalValueSchema = z.string().max(LIMITS.longText).nullable();

/** The most cells one run of a mapping may write before it stops for review. */
export const MAX_CELL_CEILING = 5_000;

/**
 * `syncMappings/{id}`: how one tab of a registered source maps to one collection. A mapping
 * names its source and tab and never an address, and a special-category field is never mapped.
 */
export const syncMappingDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  connectionId: idSchema,
  sourceKey: sourceKeySchema,
  tabKey: keySchema,
  collectionKey: collectionKeySchema,
  keyStrategy: z.enum(["keyColumn"]),
  /** The header of the column that holds the row key. */
  keyColumn: z.string().min(1).max(LIMITS.shortText),
  columnMap: z.array(syncColumnSchema).max(100),
  sheetOnlyRows: z.enum(ROW_POLICIES.sheetOnly),
  appOnlyRecords: z.enum(ROW_POLICIES.appOnly),
  cellCeiling: z.number().int().min(1).max(MAX_CELL_CEILING),
  mode: integrationModeSchema,
  status: syncMappingStatusSchema,
  statusReason: longTextSchema.exactOptional(),
  approvedBy: actorSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
  lastRunId: idSchema.nullable(),
  lastRunAt: timestampSchema.nullable(),
  /** Whether the last run was a dry run, which computed a plan and wrote nothing. */
  lastRunDry: z.boolean().exactOptional(),
  lastSuccessAt: timestampSchema.nullable(),
  /** The Drive version read before the grid on the last successful live run. */
  lastDriveVersion: z.string().min(1).max(40).exactOptional(),
  lastStats: countMapSchema.exactOptional(),
});
export type SyncMappingDoc = z.output<typeof syncMappingDocSchema>;

/** `syncMappings/{id}/cellState/{cellHash}`: the last value synchronised on each side of one mapped cell. */
export const syncCellStateDocSchema = documentBaseSchema.extend({
  mappingId: idSchema,
  recordId: idSchema,
  rowKey: z.string().min(1).max(LIMITS.shortText),
  field: mapKeySchema,
  appValue: canonicalValueSchema,
  sheetValue: canonicalValueSchema,
  appUpdatedAt: timestampSchema.exactOptional(),
  /** The Drive version of the spreadsheet when the cell last agreed. */
  sheetRevisionId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  syncedAt: timestampSchema,
  /** Set when a written value read back differently. The cell is written no more until it is cleared. */
  unstable: z.boolean(),
});
export type SyncCellStateDoc = z.output<typeof syncCellStateDocSchema>;

/** `syncLeases/{sourceKey}`: the lease that lets one run at a time touch a spreadsheet. */
export const syncLeaseDocSchema = documentBaseSchema.extend({
  sourceKey: sourceKeySchema,
  runId: idSchema,
  expiresAt: timestampSchema,
});
export type SyncLeaseDoc = z.output<typeof syncLeaseDocSchema>;

/**
 * | Kind             | The job                                                              |
 * |------------------|----------------------------------------------------------------------|
 * | `sheetSync`      | One run of a mapping                                                 |
 * | `documentUpdate` | Creating or updating one generated document                          |
 * | `driveChanges`   | Reading the Drive change feed and starting the runs it calls for     |
 * | `automation`     | Carrying out the actions of one run of an automation rule            |
 */
export const syncJobKindSchema = z.enum(["sheetSync", "documentUpdate", "driveChanges", "automation"]);
export type SyncJobKind = z.output<typeof syncJobKindSchema>;
export const syncTriggerSchema = z.enum(["event", "schedule", "manual"]);

/**
 * | Status       | Meaning                                                                |
 * |--------------|------------------------------------------------------------------------|
 * | `queued`     | Waiting to start. The run record is written when the job is enqueued   |
 * | `running`    | Started, and holding the lease of its file                             |
 * | `succeeded`  | Finished, and wrote what it planned (or planned only, in a dry run)    |
 * | `partial`    | Finished, with some cells left for review                              |
 * | `skipped`    | Nothing had changed since the last run, or the mapping is paused       |
 * | `retrying`   | Failed for a reason that passes, and waits for its next attempt        |
 * | `failed`     | Failed for a reason that a retry cannot clear, such as lost access     |
 * | `deadLetter` | Failed on every attempt. A person retries it once the cause is cleared |
 * | `cancelled`  | Cancelled by an administrator before it started                        |
 */
export const syncRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "partial",
  "skipped",
  "retrying",
  "failed",
  "deadLetter",
  "cancelled",
]);
export type SyncRunStatus = z.output<typeof syncRunStatusSchema>;

/**
 * | Kind          | The cause of a failed attempt                                       |
 * |---------------|---------------------------------------------------------------------|
 * | `quota`       | A quota was exceeded and the backoff ran out                        |
 * | `outage`      | The service answered with a server error or did not answer          |
 * | `accessLost`  | The portal's account can no longer open the file                    |
 * | `guard`       | A guard stopped a write: a moved key, a copied file, a missing column |
 * | `internal`    | A fault of the portal                                               |
 */
export const syncErrorKindSchema = z.enum(["quota", "outage", "accessLost", "guard", "internal"]);
export type SyncErrorKind = z.output<typeof syncErrorKindSchema>;

/** One line of the plan a run stores, for a person to read: what it would do, or did, to one cell, row or section. */
export const syncPlanEntrySchema = z.strictObject({
  action: z.enum([
    "writeSheet",
    "writeApp",
    "appendRow",
    "repairAnchor",
    "conflict",
    "settle",
    "issue",
    "adoptSection",
    "writeSection",
  ]),
  rowKey: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  field: mapKeySchema.exactOptional(),
  before: canonicalValueSchema.exactOptional(),
  after: canonicalValueSchema.exactOptional(),
  detail: longTextSchema.exactOptional(),
});
export type SyncPlanEntry = z.output<typeof syncPlanEntrySchema>;

/** The most plan entries a run stores. A longer plan says how many were left out. */
export const MAX_PLAN_ENTRIES = 200;

/** `syncRuns/{id}`: one job of an integration, written when it is enqueued. */
export const syncRunDocSchema = documentBaseSchema.extend({
  kind: syncJobKindSchema,
  mappingId: idSchema.exactOptional(),
  generatedDocumentId: idSchema.exactOptional(),
  /** For a job of the kind `automation`: the run of the rule whose actions it carries out. */
  automationRunId: idSchema.exactOptional(),
  mode: integrationModeSchema,
  trigger: syncTriggerSchema,
  status: syncRunStatusSchema,
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1).max(20),
  nextAttemptAt: timestampSchema.nullable(),
  requestedBy: actorSchema,
  queuedAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  stats: countMapSchema,
  /** The last error, in words, without any value of a record. */
  error: longTextSchema.exactOptional(),
  errorKind: syncErrorKindSchema.exactOptional(),
  plan: z.array(syncPlanEntrySchema).max(MAX_PLAN_ENTRIES).exactOptional(),
  planOmitted: z.number().int().min(0).exactOptional(),
  /** The Drive version of the file the run read, before it read the content. */
  driveVersion: z.string().min(1).max(40).exactOptional(),
});
export type SyncRunDoc = z.output<typeof syncRunDocSchema>;

export const syncConflictStatusSchema = z.enum(["open", "resolved"]);
/** Keep the portal value, keep the value of the sheet or document, or keep a value the resolver entered. */
export const syncResolutionSchema = z.enum(["keepApp", "keepSheet", "merged"]);
export type SyncResolution = z.output<typeof syncResolutionSchema>;
export const syncConflictOriginSchema = z.enum(["sheet", "document"]);

/**
 * `syncConflicts/{id}`: a conflicting cell of a sheet, or a hand-edited section of a generated
 * document, held until an authorised user resolves it through a callable function. The
 * identifier is derived from the mapping or document, the row or section, the field and the
 * base, so a conflict seen on ten runs is one record, and a cell has one open conflict at most.
 */
export const syncConflictDocSchema = documentBaseSchema.extend({
  origin: syncConflictOriginSchema,
  mappingId: idSchema.exactOptional(),
  generatedDocumentId: idSchema.exactOptional(),
  /** For a document: the managed section. */
  section: keySchema.exactOptional(),
  ...entityRefShape,
  recordId: idSchema,
  rowKey: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  /** The field in conflict. Absent for a hand-edited section that no designated field is bound to. */
  field: mapKeySchema.exactOptional(),
  /** What the conflict is about, in words, for the resolution screen. */
  label: shortTextSchema,
  /** The value both sides last agreed on. Absent when the cell was linked with two different values. */
  baseValue: canonicalValueSchema.exactOptional(),
  appValue: canonicalValueSchema,
  /** The value of the sheet, or the text of the document section. */
  sheetValue: canonicalValueSchema,
  appUpdatedAt: timestampSchema.exactOptional(),
  /** The Drive version of the file when the conflict was last seen. */
  sheetRevisionId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  externalModifiedAt: timestampSchema.exactOptional(),
  /** The file's last modifying user, which attributes the external change only approximately. */
  externalModifiedBy: shortTextSchema.exactOptional(),
  detectedAt: timestampSchema,
  lastSeenAt: timestampSchema,
  status: syncConflictStatusSchema,
  resolution: syncResolutionSchema.exactOptional(),
  resolvedValue: canonicalValueSchema.exactOptional(),
  resolvedBy: actorSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
  note: longTextSchema.exactOptional(),
});
export type SyncConflictDoc = z.output<typeof syncConflictDocSchema>;

/** The kinds of review item: what the planner raises about a row, and what a run finds about its file. */
export const SYNC_REVIEW_KINDS = [...SYNC_ISSUE_KINDS, "accessLost", "copiedFile", "keyMoved"] as const;
export const syncReviewKindSchema = z.enum(SYNC_REVIEW_KINDS);
export type SyncReviewKind = z.output<typeof syncReviewKindSchema>;
export const syncReviewStatusSchema = z.enum(["open", "dismissed", "resolved"]);
export const syncReviewResolutionSchema = z.enum(["dismissed", "rowForgotten", "markCleared"]);

/**
 * `syncReviewItems/{id}`: a question a run could not settle about a row, a column or the file:
 * a key with no record, a row that has gone, a duplicated key, a formula or an unstable cell.
 * Nothing on either side is ever deleted in response: a person decides.
 */
export const syncReviewItemDocSchema = documentBaseSchema.extend({
  mappingId: idSchema,
  kind: syncReviewKindSchema,
  rowKey: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  field: mapKeySchema.exactOptional(),
  detail: longTextSchema,
  status: syncReviewStatusSchema,
  detectedAt: timestampSchema,
  lastSeenAt: timestampSchema,
  resolution: syncReviewResolutionSchema.exactOptional(),
  resolvedBy: actorSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
  note: longTextSchema.exactOptional(),
});
export type SyncReviewItemDoc = z.output<typeof syncReviewItemDocSchema>;

/** `documentTemplates/{key}`: a template from which documents are generated, and where its copies go. */
export const documentTemplateDocSchema = documentBaseSchema.extend({
  key: keySchema,
  name: shortTextSchema,
  kind: z.enum(DOCUMENT_TEMPLATE_KINDS),
  entityType: entityTypeSchema,
  /** The identifier of the template document in Drive. Never committed for a real document. */
  externalDocumentId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  /** The folder of a shared drive where copies are created. */
  targetFolderId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  /** The names of the sections that the generator manages. */
  managedSections: z.array(keySchema).max(100),
  enabled: z.boolean(),
  mode: integrationModeSchema,
  approvedBy: actorSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
});
export type DocumentTemplateDoc = z.output<typeof documentTemplateDocSchema>;

export const generatedDocumentStatusSchema = z.enum(["pending", "current", "stale", "edited", "failed"]);

/** One managed section of a generated document, anchored by a named range. */
export const managedSectionSchema = z.strictObject({
  rangeName: z.string().min(1).max(LIMITS.shortText),
  status: z.enum(MANAGED_SECTION_STATUSES),
  textHash: z.string().min(1).max(64),
  /** For a section bound to a designated field: the field value it was last generated from. */
  base: canonicalValueSchema.exactOptional(),
  generatedAt: timestampSchema,
});
export type ManagedSection = z.output<typeof managedSectionSchema>;

/**
 * `generatedDocuments/{templateKey__entityType__entityId}`: a document generated once for a
 * template and a record, and updated in place. It carries the audience of its record.
 */
export const generatedDocumentDocSchema = documentBaseSchema.extend({
  templateKey: keySchema,
  /** The kind of its template, which decides its audience (`DOCUMENT_TEMPLATES`). */
  templateKind: z.enum(DOCUMENT_TEMPLATE_KINDS).exactOptional(),
  ...entityRefShape,
  title: shortTextSchema,
  externalDocumentId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  /** Google's own address of the document, which applies the reader's own permissions. */
  url: urlSchema.exactOptional(),
  /** The managed sections, by section name. */
  managedSections: boundedRecord(keySchema, managedSectionSchema, 100),
  lastGeneratedAt: timestampSchema.nullable(),
  reportDate: isoDateSchema.exactOptional(),
  lastRevisionId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  lastDriveVersion: z.string().min(1).max(40).exactOptional(),
  status: generatedDocumentStatusSchema,
  statusReason: longTextSchema.exactOptional(),
  restricted: z.boolean(),
  ...scopeFieldsShape,
});
export type GeneratedDocumentDoc = z.output<typeof generatedDocumentDocSchema>;

/**
 * The states of a public export (docs/INTEGRATIONS.md, section 6).
 *
 * | State        | What has happened                                                              |
 * |--------------|--------------------------------------------------------------------------------|
 * | `previewed`  | The approved public fields were assembled into files and compared with the website's files, row by row. Nothing has left the portal |
 * | `verified`   | The site was built from the files in a scratch copy with its own build command, and the result passed its checks |
 * | `staged`     | An administrator approved the live write with a second factor; a branch, a commit and a pull request were made, which deploys the shared staging site |
 * | `published`  | A maintainer merged the pull request                                           |
 * | `rolledBack` | A pull request that restores the files the publication replaced was merged     |
 * | `withdrawn`  | An administrator withdrew the export before it was published, or its pull request was closed unmerged |
 * | `failed`     | A check failed: the build, the privacy guard, or the website adapter. The reason is stated |
 */
export const publicationBatchStatusSchema = z.enum([
  "previewed",
  "verified",
  "staged",
  "published",
  "rolledBack",
  "withdrawn",
  "failed",
]);
export type PublicationBatchStatus = z.output<typeof publicationBatchStatusSchema>;

const sha256HexSchema = z
  .string()
  .max(64)
  .regex(/^[0-9a-f]{64}$/, { error: "Expected a SHA-256 hash in hexadecimal" });

export const publicationCheckSchema = z.strictObject({
  key: keySchema,
  passed: z.boolean(),
  /** Counts and paths only, never a value of a record. */
  detail: z.string().max(1_000),
});

/**
 * `publicationBatches/{id}`: one entry of the public publishing log. The files of the export
 * are documents beneath it, so the log keeps exactly what was proposed.
 */
export const publicationBatchDocSchema = documentBaseSchema.extend({
  /** The target of the export: the website's data files. */
  kind: z.literal("website"),
  /** The candidate outputs the export holds. */
  outputs: z
    .array(z.enum(["members", "laboratories", "replications", "publications", "milestones", "recruitment"]))
    .min(1)
    .max(6),
  /** Whether the export was made from demonstration data in the emulator, which it says on every page and in its pull request. */
  syntheticData: z.boolean(),
  /** The commit of the website's main branch the files were compared with. */
  baseCommit: z.string().min(1).max(200),
  /** The SHA-256 of the files, in the order of their paths, which the approval and the commit must match. */
  payloadSha256: sha256HexSchema,
  /** File key to the counts of its difference: added, removed and changed rows. */
  diffSummary: boundedRecord(mapKeySchema, countMapSchema, 20),
  /** What the generator left out and why, naming records and never a value. */
  notes: z.array(z.string().max(500)).max(200),
  status: publicationBatchStatusSchema,
  statusReason: longTextSchema.exactOptional(),
  requestedBy: actorSchema,
  requestedAt: timestampSchema,
  /** The report of the build in a scratch copy. */
  verification: z
    .strictObject({
      checkedAt: timestampSchema,
      passed: z.boolean(),
      payloadSha256: sha256HexSchema,
      buildCommand: z.string().min(1).max(200),
      checks: z.array(publicationCheckSchema).max(50),
    })
    .nullable(),
  approvedBy: actorSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
  branch: z.string().min(1).max(200).exactOptional(),
  commitRef: z.string().min(1).max(200).exactOptional(),
  pullRequestNumber: z.number().int().min(1).exactOptional(),
  pullRequestUrl: urlSchema.exactOptional(),
  publishedAt: timestampSchema.nullable(),
  /** The pull request that restores the files this export replaced, once proposed. */
  rollbackPullRequestNumber: z.number().int().min(1).exactOptional(),
  rollbackPullRequestUrl: urlSchema.exactOptional(),
  rolledBackBy: actorSchema.nullable(),
  rolledBackAt: timestampSchema.nullable(),
});
export type PublicationBatchDoc = z.output<typeof publicationBatchDocSchema>;

/** The most rows of a file's difference that the log keeps for the preview. */
export const PUBLICATION_DIFF_ROWS_MAX = 500;

/**
 * `publicationBatches/{id}/files/{fileKey}`: one file of an export: its full text, the text it
 * replaces on the main branch, and the difference between the two, row by row and field by field.
 */
export const publicationFileDocSchema = documentBaseSchema.extend({
  batchId: idSchema,
  fileKey: keySchema,
  path: z.string().min(1).max(200),
  content: z.string().max(900_000),
  sha256: sha256HexSchema,
  /** The text on the main branch, or null for a file that does not exist there yet. */
  baseContent: z.string().max(900_000).nullable(),
  baseSha256: sha256HexSchema.nullable(),
  diff: z.strictObject({
    created: z.boolean(),
    bytesChanged: z.boolean(),
    columnsChanged: z.boolean(),
    counts: z.strictObject({
      added: z.number().int().min(0),
      removed: z.number().int().min(0),
      changed: z.number().int().min(0),
      unchanged: z.number().int().min(0),
    }),
    rows: z
      .array(
        z.strictObject({
          key: z.string().max(500),
          kind: z.enum(["added", "removed", "changed"]),
          fields: z
            .array(
              z.strictObject({
                column: z.string().max(100),
                before: z.string().max(10_000),
                after: z.string().max(10_000),
              }),
            )
            .max(50),
        }),
      )
      .max(PUBLICATION_DIFF_ROWS_MAX),
    rowsOmitted: z.number().int().min(0),
  }),
});
export type PublicationFileDoc = z.output<typeof publicationFileDocSchema>;
