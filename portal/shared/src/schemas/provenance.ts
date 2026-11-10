// Provenance, migration and integrations (docs/DATA_MODEL.md, section 12): the source registry,
// import batches and the verbatim rows they stored (D-012), the reconciliation queue, and the
// records of synchronisation, generated documents and publishing.
import { entityTypeSchema } from "../entities";
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
});
export type ImportBatchDoc = z.output<typeof importBatchDocSchema>;

export const changeOperationSchema = z.enum(["create", "update", "delete"]);
export const changeRelationSchema = z.enum(["created", "updated", "matched"]);

/** The state of the fields an import owns, or null where the document did not exist. */
const importedStateSchema = freeMapSchema.nullable();

/**
 * `importBatches/{batchId}/changes/{n}`: one write a batch made to an entity, with the state of
 * the imported fields before and after it, which makes a batch reversible. For a
 * special-category document the two states hold a marker and a hash.
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

/** `importBatches/{batchId}/changes/{n}/special/state`: the two states of a special-category document. */
export const importBatchChangeStateDocSchema = appendOnlyBaseSchema.extend({
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

/** The key of an external system, such as `quire`, `google` or `doi`. */
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

export const integrationConnectionStatusSchema = z.enum(["notConfigured", "connected", "error", "disabled"]);

/** `integrationConnections/{system}`: the state of one integration. `credentialRef` names a secret and is never the secret. */
export const integrationConnectionDocSchema = documentBaseSchema.extend({
  system: systemKeySchema,
  status: integrationConnectionStatusSchema,
  /** Non-secret configuration. */
  config: freeMapSchema,
  credentialRef: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  lastSuccessAt: timestampSchema.nullable(),
  lastError: longTextSchema.exactOptional(),
  lastErrorAt: timestampSchema.nullable(),
});
export type IntegrationConnectionDoc = z.output<typeof integrationConnectionDocSchema>;

export const syncDirectionSchema = z.enum(["appAuthoritative", "sheetAuthoritative", "bidirectional", "generated"]);

export const syncColumnSchema = z.strictObject({
  field: mapKeySchema,
  /** The header of the column in the sheet, as written. */
  column: z.string().min(1).max(LIMITS.shortText),
  direction: syncDirectionSchema,
});

/**
 * `syncMappings/{id}`: how one tab of a registered source maps to one collection. A mapping
 * names its source and tab and never an address, and a special-category field is never mapped.
 */
export const syncMappingDocSchema = documentBaseSchema.extend({
  connectionId: idSchema,
  sourceKey: sourceKeySchema,
  tabKey: keySchema,
  collectionKey: collectionKeySchema,
  keyStrategy: keySchema,
  columnMap: z.array(syncColumnSchema).max(200),
  enabled: z.boolean(),
});
export type SyncMappingDoc = z.output<typeof syncMappingDocSchema>;

/** `syncMappings/{id}/cellState/{cellHash}`: the last value synchronised on each side of one mapped cell. */
export const syncCellStateDocSchema = documentBaseSchema.extend({
  mappingId: idSchema,
  recordId: idSchema,
  field: mapKeySchema,
  appValue: z.unknown().exactOptional(),
  sheetValue: z.unknown().exactOptional(),
  appUpdatedAt: timestampSchema.exactOptional(),
  sheetRevisionId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  syncedAt: timestampSchema,
});
export type SyncCellStateDoc = z.output<typeof syncCellStateDocSchema>;

export const syncTriggerSchema = z.enum(["event", "schedule", "manual"]);
export const syncRunStatusSchema = z.enum(["running", "succeeded", "partial", "failed"]);

/** `syncRuns/{id}`: one run of a synchronisation mapping. */
export const syncRunDocSchema = documentBaseSchema.extend({
  mappingId: idSchema,
  trigger: syncTriggerSchema,
  status: syncRunStatusSchema,
  attempts: z.number().int().min(0),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  stats: countMapSchema,
  /** The last error. */
  error: longTextSchema.exactOptional(),
});
export type SyncRunDoc = z.output<typeof syncRunDocSchema>;

export const syncConflictStatusSchema = z.enum(["open", "resolved"]);
export const syncResolutionSchema = z.enum(["keepApp", "keepSheet", "merged"]);

/** `syncConflicts/{id}`: a conflicting cell, held until an authorised user resolves it through a callable function. */
export const syncConflictDocSchema = documentBaseSchema.extend({
  mappingId: idSchema,
  recordId: idSchema,
  field: mapKeySchema,
  baseValue: z.unknown().exactOptional(),
  appValue: z.unknown().exactOptional(),
  sheetValue: z.unknown().exactOptional(),
  appUpdatedAt: timestampSchema.exactOptional(),
  sheetRevisionId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  detectedAt: timestampSchema,
  status: syncConflictStatusSchema,
  resolution: syncResolutionSchema.exactOptional(),
  resolvedValue: z.unknown().exactOptional(),
  resolvedBy: actorSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
});
export type SyncConflictDoc = z.output<typeof syncConflictDocSchema>;

/** `documentTemplates/{key}`: a template from which documents are generated. */
export const documentTemplateDocSchema = documentBaseSchema.extend({
  key: keySchema,
  name: shortTextSchema,
  entityType: entityTypeSchema,
  externalDocumentId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  /** The names of the sections that the generator manages. */
  managedSections: z.array(keySchema).max(100),
  enabled: z.boolean(),
});
export type DocumentTemplateDoc = z.output<typeof documentTemplateDocSchema>;

export const generatedDocumentStatusSchema = z.enum(["pending", "current", "stale", "failed"]);

/**
 * `generatedDocuments/{templateKey__entityType__entityId}`: a document generated once for a
 * template and a record, and updated in place. It carries the audience of its record.
 */
export const generatedDocumentDocSchema = documentBaseSchema.extend({
  templateKey: keySchema,
  ...entityRefShape,
  externalDocumentId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  /** The named ranges that the generator manages, by section name. */
  managedSections: boundedRecord(keySchema, z.unknown(), 100),
  lastGeneratedAt: timestampSchema.nullable(),
  lastRevisionId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  status: generatedDocumentStatusSchema,
  restricted: z.boolean(),
  ...scopeFieldsShape,
});
export type GeneratedDocumentDoc = z.output<typeof generatedDocumentDocSchema>;

export const publicationBatchStatusSchema = z.enum([
  "draft",
  "previewed",
  "staged",
  "approved",
  "published",
  "rolledBack",
]);

const storagePathSchema = z.string().min(1).max(1_024);

/** `publicationBatches/{id}`: one entry of the public publishing log. The export itself is a file in Cloud Storage. */
export const publicationBatchDocSchema = documentBaseSchema.extend({
  kind: keySchema,
  payloadPath: storagePathSchema.exactOptional(),
  payloadSha256: z
    .string()
    .max(64)
    .regex(/^[0-9a-f]{64}$/, { error: "Expected a SHA-256 hash in hexadecimal" })
    .exactOptional(),
  diffPath: storagePathSchema.exactOptional(),
  diffSummary: countMapSchema.exactOptional(),
  status: publicationBatchStatusSchema,
  requestedBy: actorSchema,
  requestedAt: timestampSchema,
  approvedBy: actorSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
  publishedAt: timestampSchema.nullable(),
  rolledBackBy: actorSchema.nullable(),
  rolledBackAt: timestampSchema.nullable(),
  commitRef: z.string().min(1).max(200).exactOptional(),
  pullRequestUrl: urlSchema.exactOptional(),
});
export type PublicationBatchDoc = z.output<typeof publicationBatchDocSchema>;
