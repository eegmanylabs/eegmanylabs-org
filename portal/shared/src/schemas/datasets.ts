// Datasets (docs/DATA_MODEL.md, section 10). The portal is a registry of where data lives:
// raw EEG never has to pass through it. Storage paths and server details are restricted, and
// the location of a storage reference, the connection of an endpoint and the viewer links of a
// dataset are held where no client can read them.
import { dataOriginSchema } from "../data-origin";
import { normaliseStoragePath } from "../datasets/paths";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  boundedRecord,
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
import { statusCategorySchema } from "./replications";

export const storageProtocolSchema = z.enum(["sftp", "ftps", "filesystem", "s3", "webdav", "gin", "osf", "other"]);
export type StorageProtocol = z.output<typeof storageProtocolSchema>;
export const storageEndpointStatusSchema = z.enum(["active", "unreachable", "retired"]);
/**
 * How the files of an endpoint are listed: by a metadata scan from the portal, or by a manifest
 * produced inside the institution and uploaded, for a server that the cloud cannot reach.
 */
export const storageScanModeSchema = z.enum(["remote", "uploadedManifest"]);

/** `storageEndpoints/{key}`: a storage server or service. Its connection details are in a document no client reads. */
export const storageEndpointDocSchema = documentBaseSchema.extend({
  key: keySchema,
  name: shortTextSchema,
  institutionId: idSchema.exactOptional(),
  protocol: storageProtocolSchema,
  ownerPersonId: idSchema.exactOptional(),
  /** What the server is and who runs it, in words. Never a host, a path or a credential. */
  description: longTextSchema.exactOptional(),
  scanMode: storageScanModeSchema,
  status: storageEndpointStatusSchema,
  statusReason: shortTextSchema.exactOptional(),
  lastCheckedAt: timestampSchema.nullable(),
  /** The last time a check or a scan reached the endpoint. */
  lastSeenAt: timestampSchema.nullable(),
  /** The scopes whose datasets use the endpoint, kept by the function that adds a storage reference. */
  scopeKeys: scopeKeysSchema,
});
export type StorageEndpointDoc = z.output<typeof storageEndpointDocSchema>;

/**
 * The name of the secret that holds the credential of a storage server. It is confined to the
 * names that begin with `STORAGE_`, so that it can never name another secret or setting of the
 * functions.
 */
export const storageSecretNameSchema = z
  .string()
  .min(9)
  .max(100)
  .regex(/^STORAGE_[A-Z0-9_]+$/, { error: "Expected the name of a secret that begins with STORAGE_" });

/** A folder below the base path of a server, in the normal form of `normaliseStoragePath`. */
const storageFolderSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((path) => normaliseStoragePath(path) === path, {
    error: "Expected a folder below the base path, with single slashes and none at either end",
  });

/** The folder of each replication or laboratory on a server, by scope key. */
export const storageAllowedPrefixesSchema = boundedRecord(
  z
    .string()
    .max(LIMITS.identifier + 6)
    .regex(/^(?:rep|lab):[^/]+$/, { error: "Expected the scope key of a replication or a laboratory" }),
  storageFolderSchema,
  200,
);

/**
 * `storageEndpoints/{key}/private/connection`: how to reach an endpoint. `credentialRef` names
 * a secret held in the secret store and is never the secret.
 */
export const storageEndpointConnectionDocSchema = documentBaseSchema.extend({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535).exactOptional(),
  basePath: z.string().min(1).max(1_024).exactOptional(),
  credentialRef: storageSecretNameSchema.exactOptional(),
  /**
   * The folder below the base path in which each replication (`rep:`) or laboratory (`lab:`)
   * may name copies. A holder of `datasets.manage` for one of them names a copy only inside its
   * folder; a holder for the programme names any folder. Absent, no unit has a folder there.
   */
  allowedPrefixes: storageAllowedPrefixesSchema.exactOptional(),
  lastCheckResult: longTextSchema.exactOptional(),
});
export type StorageEndpointConnectionDoc = z.output<typeof storageEndpointConnectionDocSchema>;

export const datasetModalitySchema = z.enum(["main", "rest", "mixed"]);
export const bidsStatusSchema = z.enum(["notStarted", "inProgress", "invalid", "valid"]);
export const bidsConversionStatusSchema = z.enum(["notStarted", "inProgress", "completed", "failed"]);
export const qcStatusSchema = z.enum(["notStarted", "pending", "passed", "flagged", "failed"]);
export type QcStatus = z.output<typeof qcStatusSchema>;
/**
 * The availability of a dataset as a whole, from its current storage references: every one
 * available, some, none, none known yet, or no reference at all.
 */
export const datasetAvailabilitySchema = z.enum(["available", "partial", "unavailable", "unknown", "noStorage"]);

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
  /** The session, wave or other grouping the dataset holds, where the replication has one. */
  groupingLabel: shortTextSchema.exactOptional(),
  /** The institution where the data was recorded. */
  sourceInstitutionId: idSchema.exactOptional(),
  /** The person responsible for the stored copies. */
  storageOwnerPersonId: idSchema.exactOptional(),
  protocolId: idSchema.exactOptional(),
  protocolVersionId: idSchema.exactOptional(),
  expectedFileCount: countSchema.exactOptional(),
  /** The latest expected manifest, with which every listing is compared, or null while there is none. */
  expectedManifestId: idSchema.nullable(),
  /** The files of the latest listing that the expected manifest names and that were found. */
  receivedFileCount: countSchema.exactOptional(),
  expectedParticipants: countSchema.exactOptional(),
  receivedAt: timestampSchema.exactOptional(),
  sizeBytes: countSchema.exactOptional(),
  availability: datasetAvailabilitySchema,
  /** The latest time any storage reference of the dataset was reached, or null while none has been. */
  lastSeenAt: timestampSchema.nullable(),
  workflowStatusKey: keySchema,
  statusHistoryId: idSchema.nullable(),
  bidsConversionStatus: bidsConversionStatusSchema,
  bidsStatus: bidsStatusSchema,
  bidsVersion: z.string().min(1).max(32).exactOptional(),
  bidsSummary: z
    .strictObject({
      errorCount: countSchema,
      warningCount: countSchema,
      validatorVersion: z.string().min(1).max(64),
      validatedAt: timestampSchema,
      /** The issues of the report that say required metadata is missing. */
      missingMetadataCount: countSchema.exactOptional(),
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
  /** The condensed report of the last validation: each issue code with its severity, count and first locations. */
  bidsReport: freeMapSchema.exactOptional(),
  metadata: freeMapSchema.exactOptional(),
  /** What the BIDS conversion still lacks, one item for each missing field or file. */
  bidsMissingMetadata: z.array(shortTextSchema).max(LIMITS.list).exactOptional(),
  /** How the names used at the laboratory map to BIDS names, which can hold participant labels. */
  bidsNamingMap: z
    .array(z.strictObject({ source: shortTextSchema, bids: shortTextSchema }))
    .max(LIMITS.list)
    .exactOptional(),
});
export type DatasetDetailDoc = z.output<typeof datasetDetailDocSchema>;

export const storageRefRoleSchema = z.enum(["primary", "mirror", "backup", "processingCopy"]);
export const storageAvailabilitySchema = z.enum(["available", "unavailable", "unknown"]);
/** The outcome of the last scan of a storage reference. */
export const storageScanStatusSchema = z.enum([
  "never",
  "ok",
  "unreachable",
  "permissionDenied",
  "timeout",
  "notFound",
  "failed",
]);
export type StorageScanStatus = z.output<typeof storageScanStatusSchema>;
/** The viewers that a storage reference can declare support for. A viewer is optional and never needed for access. */
export const viewerToolSchema = z.enum(["electroTag"]);
export type ViewerTool = z.output<typeof viewerToolSchema>;

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
  /** The last time a scan or a check reached the reference, which stays when the server is down. */
  lastSeenAt: timestampSchema.nullable(),
  lastScanAt: timestampSchema.nullable(),
  lastScanStatus: storageScanStatusSchema,
  /** The latest listing of the reference. */
  latestManifestId: idSchema.nullable(),
  /** The viewers the copy can be opened in. Viewer links are offered only where this names the tool. */
  viewerSupport: z.array(viewerToolSchema).max(5),
  /** The viewers for which a link has been saved, whose addresses only a callable function serves. */
  viewerLinkTools: z.array(viewerToolSchema).max(5),
  note: longTextSchema.exactOptional(),
  ...scopeFieldsShape,
});
export type DatasetStorageRefDoc = z.output<typeof datasetStorageRefDocSchema>;

/** `datasets/{datasetKey}/storageRefs/{id}/private/location`: served by a callable function, which records each view. */
export const datasetStorageRefLocationDocSchema = documentBaseSchema.extend({
  uri: z.string().min(1).max(LIMITS.url),
});
export type DatasetStorageRefLocationDoc = z.output<typeof datasetStorageRefLocationDocSchema>;

export const manifestOriginSchema = z.enum(["scan", "upload", "manual"]);
/** An expected manifest states the files a dataset should hold; a listing states what a storage reference held. */
export const manifestKindSchema = z.enum(["expected", "listing"]);
export const manifestFileStatusSchema = z.enum([
  "expected",
  "present",
  "missing",
  "unexpected",
  "duplicate",
  "mismatch",
]);
export type ManifestFileStatus = z.output<typeof manifestFileStatusSchema>;

/**
 * `datasets/{datasetKey}/manifests/{id}`: a listing of one storage reference at one time. Its
 * chunks are written first and the manifest, which states their number, last.
 */
export const datasetManifestDocSchema = appendOnlyBaseSchema.extend({
  datasetId: idSchema,
  kind: manifestKindSchema,
  /** The storage reference that was listed, or null for an expected manifest. */
  storageRefId: idSchema.nullable(),
  listedAt: timestampSchema,
  origin: manifestOriginSchema,
  fileCount: countSchema,
  totalSizeBytes: countSchema,
  chunkCount: countSchema.max(10_000),
  /** The expected manifest that a listing was compared with, or null where there was none. */
  expectedManifestId: idSchema.nullable(),
  /** The files of each status, after the comparison. */
  counts: z.partialRecord(manifestFileStatusSchema, countSchema),
  /** The files that carry a checksum. */
  checksumCount: countSchema,
  ...scopeFieldsShape,
});
export type DatasetManifestDoc = z.output<typeof datasetManifestDocSchema>;

export const manifestFileSchema = z.strictObject({
  relativePath: z.string().min(1).max(1_024),
  sizeBytes: countSchema.exactOptional(),
  checksumAlgorithm: z.string().min(1).max(32).exactOptional(),
  checksum: z.string().min(1).max(256).exactOptional(),
  modifiedAt: timestampSchema.exactOptional(),
  status: manifestFileStatusSchema,
  /** For a file whose size or checksum differs from the expected manifest: what was expected. */
  expectedSizeBytes: countSchema.exactOptional(),
  expectedChecksum: z.string().min(1).max(256).exactOptional(),
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
export type TransferStatus = z.output<typeof transferStatusSchema>;
/** Raw research data moves only once someone other than the requester has approved it. */
export const transferApprovalSchema = z.enum(["pending", "approved", "rejected"]);

/** `datasets/{datasetKey}/transfers/{id}`: a transfer between two storage references. It changes only by moving through its statuses. */
export const datasetTransferDocSchema = documentBaseSchema.extend({
  datasetId: idSchema,
  fromRefId: idSchema,
  toRefId: idSchema,
  status: transferStatusSchema,
  approval: transferApprovalSchema,
  reason: longTextSchema,
  initiatedBy: actorSchema,
  initiatedAt: timestampSchema,
  decidedBy: actorSchema.nullable(),
  decidedAt: timestampSchema.nullable(),
  decisionNote: longTextSchema.exactOptional(),
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
 * One recording or participant that an assessment excludes. `reasonTermId` is a term of the
 * exclusion reasons that recruitment reports use, and `recruitmentReportId` names the report
 * that counted the exclusion, where there is one.
 */
export const qcExclusionSchema = z.strictObject({
  recordingLabel: shortTextSchema,
  reasonTermId: idSchema.exactOptional(),
  recruitmentReportId: idSchema.exactOptional(),
  note: shortTextSchema.exactOptional(),
});
export type QcExclusion = z.output<typeof qcExclusionSchema>;

/**
 * `datasets/{datasetKey}/qcAssessments/{id}`: one quality-control assessment, never changed. A
 * corrected assessment is a new one that names the assessment it replaces.
 */
export const datasetQcAssessmentDocSchema = appendOnlyBaseSchema.extend({
  datasetId: idSchema,
  level: qcLevelSchema,
  recordingLabel: shortTextSchema.exactOptional(),
  assessedBy: actorSchema,
  /** The name of the pipeline or tool. */
  tool: shortTextSchema.exactOptional(),
  toolVersion: z.string().min(1).max(64).exactOptional(),
  pipelineVersion: z.string().min(1).max(64).exactOptional(),
  parameters: freeMapSchema.exactOptional(),
  outcome: qcOutcomeSchema,
  metrics: freeMapSchema.exactOptional(),
  /** What the assessment excludes, each with its reason. */
  exclusions: z.array(qcExclusionSchema).max(LIMITS.list).exactOptional(),
  /** The deviations of the participation that the assessment takes into account. */
  deviationIds: idListSchema.exactOptional(),
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
  /** The storage reference whose copy the viewer opens, which declares support for the tool. */
  storageRefId: idSchema,
  tool: viewerToolSchema,
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

/** One state of the workflow of datasets. Its category says what the state means for progress. */
export const datasetWorkflowStateSchema = z.strictObject({
  key: keySchema,
  label: shortTextSchema,
  category: statusCategorySchema,
  /** Whether a dataset in this state is ready for analysis. */
  analysisReady: z.boolean(),
});
export type DatasetWorkflowState = z.output<typeof datasetWorkflowStateSchema>;

/** The most states a workflow holds. */
export const DATASET_WORKFLOW_MAX_STATES = 30;

/**
 * `datasetWorkflows/{studyKey}`: the states through which the datasets of one replication move,
 * and which state may follow which. A replication without one uses the default workflow of the
 * shared package.
 */
export const datasetWorkflowDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  states: z.array(datasetWorkflowStateSchema).min(2).max(DATASET_WORKFLOW_MAX_STATES),
  /** For each state, the states that may follow it. */
  transitions: boundedRecord(
    keySchema,
    z.array(keySchema).max(DATASET_WORKFLOW_MAX_STATES),
    DATASET_WORKFLOW_MAX_STATES,
  ),
  initialKey: keySchema,
});
export type DatasetWorkflowDoc = z.output<typeof datasetWorkflowDocSchema>;
