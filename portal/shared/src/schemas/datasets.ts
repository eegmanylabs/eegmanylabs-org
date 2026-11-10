// Datasets (docs/DATA_MODEL.md, section 10). The portal is a registry of where data lives:
// raw EEG never has to pass through it. Storage paths and server details are restricted, and
// the location of a storage reference, the connection of an endpoint and the viewer links of a
// dataset are held where no client can read them.
import { dataOriginSchema } from "../data-origin";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  customValuesSchema,
  documentBaseSchema,
  freeMapSchema,
  idListSchema,
  idSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  provenanceShape,
  scopeFieldsShape,
  scopeKeysSchema,
  shortTextSchema,
  uidSchema,
  urlSchema,
} from "./base";

export const storageProtocolSchema = z.enum(["sftp", "ftps", "filesystem", "s3", "webdav", "gin", "osf", "other"]);
export const storageEndpointStatusSchema = z.enum(["active", "unreachable", "retired"]);

/** `storageEndpoints/{key}`: a storage server or service. Its connection details are in a document no client reads. */
export const storageEndpointDocSchema = documentBaseSchema.extend({
  key: keySchema,
  name: shortTextSchema,
  institutionId: idSchema.exactOptional(),
  protocol: storageProtocolSchema,
  ownerPersonId: idSchema.exactOptional(),
  status: storageEndpointStatusSchema,
  lastCheckedAt: timestampSchema.nullable(),
  /** The scopes whose datasets use the endpoint, derived by a trigger. */
  scopeKeys: scopeKeysSchema,
});
export type StorageEndpointDoc = z.output<typeof storageEndpointDocSchema>;

/**
 * `storageEndpoints/{key}/private/connection`: how to reach an endpoint. `credentialRef` names
 * a secret held in the secret store and is never the secret.
 */
export const storageEndpointConnectionDocSchema = documentBaseSchema.extend({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535).exactOptional(),
  basePath: z.string().min(1).max(1_024).exactOptional(),
  credentialRef: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  lastCheckResult: longTextSchema.exactOptional(),
});
export type StorageEndpointConnectionDoc = z.output<typeof storageEndpointConnectionDocSchema>;

export const datasetModalitySchema = z.enum(["main", "rest", "mixed"]);
export const bidsStatusSchema = z.enum(["notStarted", "inProgress", "invalid", "valid"]);
export const qcStatusSchema = z.enum(["notStarted", "pending", "passed", "flagged", "failed"]);

const countSchema = z.number().int().min(0);

/**
 * `datasets/{datasetKey}`: the registry document of a dataset, readable by every member.
 * `workflowStatusKey` and `statusHistoryId` change through a callable function, and `qcStatus`
 * is derived from the latest assessment at the level `dataset`.
 */
export const datasetDocSchema = documentBaseSchema.extend({
  datasetKey: keySchema,
  replicationId: idSchema,
  laboratoryId: idSchema.nullable(),
  participationId: idSchema.nullable(),
  scopeKeys: scopeKeysSchema,
  title: shortTextSchema,
  modality: datasetModalitySchema,
  groupingLabel: shortTextSchema.exactOptional(),
  protocolId: idSchema.exactOptional(),
  protocolVersionId: idSchema.exactOptional(),
  expectedFileCount: countSchema.exactOptional(),
  expectedParticipants: countSchema.exactOptional(),
  receivedAt: timestampSchema.exactOptional(),
  sizeBytes: countSchema.exactOptional(),
  workflowStatusKey: keySchema,
  statusHistoryId: idSchema.nullable(),
  bidsStatus: bidsStatusSchema,
  bidsVersion: z.string().min(1).max(32).exactOptional(),
  bidsSummary: z
    .strictObject({
      errorCount: countSchema,
      warningCount: countSchema,
      validatorVersion: z.string().min(1).max(64),
      validatedAt: timestampSchema,
    })
    .exactOptional(),
  qcStatus: qcStatusSchema,
  analysisReady: z.boolean(),
  custom: customValuesSchema,
  dataOrigin: dataOriginSchema,
  ...provenanceShape,
});
export type DatasetDoc = z.output<typeof datasetDocSchema>;

/**
 * `datasets/{datasetKey}/private/detail`: the validator report and the free metadata of a
 * dataset, which can name files and participant labels.
 */
export const datasetDetailDocSchema = documentBaseSchema.extend({
  bidsReport: freeMapSchema.exactOptional(),
  metadata: freeMapSchema.exactOptional(),
});
export type DatasetDetailDoc = z.output<typeof datasetDetailDocSchema>;

export const storageRefRoleSchema = z.enum(["primary", "mirror", "backup", "processingCopy"]);
export const storageAvailabilitySchema = z.enum(["available", "unavailable", "unknown"]);

/** `datasets/{datasetKey}/storageRefs/{id}`: one place where a dataset is held. Its location is in a document no client reads. */
export const datasetStorageRefDocSchema = documentBaseSchema.extend({
  datasetId: idSchema,
  endpointKey: keySchema,
  role: storageRefRoleSchema,
  availability: storageAvailabilitySchema,
  verifiedAt: timestampSchema.nullable(),
  verifiedBy: actorSchema.nullable(),
  verificationManifestId: idSchema.nullable(),
  validFrom: timestampSchema,
  validTo: timestampSchema.nullable(),
  relocatedFromRefId: idSchema.nullable(),
  ...scopeFieldsShape,
});
export type DatasetStorageRefDoc = z.output<typeof datasetStorageRefDocSchema>;

/** `datasets/{datasetKey}/storageRefs/{id}/private/location`: served by a callable function, which records each view. */
export const datasetStorageRefLocationDocSchema = documentBaseSchema.extend({
  uri: z.string().min(1).max(LIMITS.url),
});
export type DatasetStorageRefLocationDoc = z.output<typeof datasetStorageRefLocationDocSchema>;

export const manifestOriginSchema = z.enum(["scan", "upload", "manual"]);

/**
 * `datasets/{datasetKey}/manifests/{id}`: a listing of one storage reference at one time. Its
 * chunks are written first and the manifest, which states their number, last.
 */
export const datasetManifestDocSchema = appendOnlyBaseSchema.extend({
  datasetId: idSchema,
  storageRefId: idSchema,
  listedAt: timestampSchema,
  origin: manifestOriginSchema,
  fileCount: countSchema,
  totalSizeBytes: countSchema,
  chunkCount: countSchema.max(10_000),
  ...scopeFieldsShape,
});
export type DatasetManifestDoc = z.output<typeof datasetManifestDocSchema>;

export const manifestFileStatusSchema = z.enum(["expected", "present", "missing", "unexpected", "duplicate"]);

export const manifestFileSchema = z.strictObject({
  relativePath: z.string().min(1).max(1_024),
  sizeBytes: countSchema.exactOptional(),
  checksumAlgorithm: z.string().min(1).max(32).exactOptional(),
  checksum: z.string().min(1).max(256).exactOptional(),
  modifiedAt: timestampSchema.exactOptional(),
  status: manifestFileStatusSchema,
});

/** The most files one chunk of a manifest holds. A chunk also stays below 500 KiB. */
export const MANIFEST_CHUNK_MAX_FILES = 2_000;

/** `datasets/{datasetKey}/manifests/{id}/fileChunks/{n}`: one chunk of the files of a manifest. */
export const datasetManifestFileChunkDocSchema = appendOnlyBaseSchema.extend({
  datasetId: idSchema,
  manifestId: idSchema,
  index: countSchema,
  files: z.array(manifestFileSchema).max(MANIFEST_CHUNK_MAX_FILES),
  ...scopeFieldsShape,
});
export type DatasetManifestFileChunkDoc = z.output<typeof datasetManifestFileChunkDocSchema>;

export const transferStatusSchema = z.enum(["initiated", "inProgress", "completed", "failed", "verified"]);

/** `datasets/{datasetKey}/transfers/{id}`: a transfer between two storage references. It changes only by moving through its statuses. */
export const datasetTransferDocSchema = documentBaseSchema.extend({
  datasetId: idSchema,
  fromRefId: idSchema,
  toRefId: idSchema,
  status: transferStatusSchema,
  initiatedBy: actorSchema,
  initiatedAt: timestampSchema,
  startedAt: timestampSchema.exactOptional(),
  completedAt: timestampSchema.exactOptional(),
  verifiedAt: timestampSchema.exactOptional(),
  bytesTransferred: countSchema.exactOptional(),
  error: longTextSchema.exactOptional(),
  verificationManifestId: idSchema.exactOptional(),
  ...scopeFieldsShape,
});
export type DatasetTransferDoc = z.output<typeof datasetTransferDocSchema>;

export const qcLevelSchema = z.enum(["dataset", "recording"]);
export const qcOutcomeSchema = z.enum(["pass", "flag", "fail"]);

/**
 * `datasets/{datasetKey}/qcAssessments/{id}`: one quality-control assessment, never changed. A
 * corrected assessment is a new one that names the assessment it replaces.
 */
export const datasetQcAssessmentDocSchema = appendOnlyBaseSchema.extend({
  datasetId: idSchema,
  level: qcLevelSchema,
  recordingLabel: shortTextSchema.exactOptional(),
  assessedBy: actorSchema,
  tool: shortTextSchema.exactOptional(),
  toolVersion: z.string().min(1).max(64).exactOptional(),
  pipelineVersion: z.string().min(1).max(64).exactOptional(),
  parameters: freeMapSchema.exactOptional(),
  outcome: qcOutcomeSchema,
  metrics: freeMapSchema.exactOptional(),
  /** What the assessment excludes, each with its reason. */
  exclusions: z.array(freeMapSchema).max(LIMITS.list).exactOptional(),
  notes: longTextSchema.exactOptional(),
  assessedAt: timestampSchema,
  supersedesAssessmentId: idSchema.exactOptional(),
  ...scopeFieldsShape,
});
export type DatasetQcAssessmentDoc = z.output<typeof datasetQcAssessmentDocSchema>;

export const datasetAccessActionSchema = z.enum(["viewLocation", "viewConnection", "requestViewerLink"]);

/** `datasets/{datasetKey}/accessEvents/{id}`: who viewed a storage location or connection or asked for a viewer link, and when. */
export const datasetAccessEventDocSchema = appendOnlyBaseSchema.extend({
  datasetId: idSchema,
  uid: uidSchema,
  action: datasetAccessActionSchema,
  /** The storage reference, the endpoint or the viewer link that was served. */
  targetId: idSchema,
  ...scopeFieldsShape,
});
export type DatasetAccessEventDoc = z.output<typeof datasetAccessEventDocSchema>;

/** `datasets/{datasetKey}/viewerLinks/{id}`: a link to a viewer. Entirely optional and never required for access. */
export const datasetViewerLinkDocSchema = documentBaseSchema.extend({
  datasetId: idSchema,
  tool: shortTextSchema,
  url: urlSchema,
});
export type DatasetViewerLinkDoc = z.output<typeof datasetViewerLinkDocSchema>;

export const processingRunKindSchema = z.enum(["preprocessing", "analysis", "qualityControl", "other"]);
export const processingRunStatusSchema = z.enum(["planned", "running", "succeeded", "failed", "cancelled"]);

/** `processingRuns/{id}`: a preprocessing or analysis run, with what it read and what it produced. */
export const processingRunDocSchema = documentBaseSchema.extend({
  kind: processingRunKindSchema,
  pipelineName: shortTextSchema,
  codeUrl: urlSchema.exactOptional(),
  codeCommit: z.string().min(1).max(64).exactOptional(),
  version: z.string().min(1).max(64).exactOptional(),
  parameters: freeMapSchema.exactOptional(),
  environment: freeMapSchema.exactOptional(),
  status: processingRunStatusSchema,
  startedAt: timestampSchema.exactOptional(),
  finishedAt: timestampSchema.exactOptional(),
  runBy: actorSchema.exactOptional(),
  inputDatasetIds: idListSchema,
  outputDatasetIds: idListSchema,
  /** Hypotheses of `replicationId`. */
  hypothesisIds: idListSchema,
  /** Document links. */
  outputLinkIds: idListSchema,
  reproducibilityNotes: longTextSchema.exactOptional(),
  ...scopeFieldsShape,
});
export type ProcessingRunDoc = z.output<typeof processingRunDocSchema>;
