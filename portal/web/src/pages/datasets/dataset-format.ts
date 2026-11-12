// The words the pages of the dataset registry use for its states, in one place, and the small
// decisions about what a reader may see, which the security rules and the functions make again.
import type {
  DatasetDoc,
  DatasetStorageRefDoc,
  DatasetTransferDoc,
  ManifestFileStatus,
  StorageEndpointDoc,
  StorageProtocol,
  StorageScanStatus,
} from "@eegml/shared";
import type { PathsUnit } from "@/registry/dataset-queries";
import type { Viewer } from "@/registry/viewer";

export const MODALITY_LABELS: Readonly<Record<DatasetDoc["modality"], string>> = {
  main: "Main experiment",
  rest: "Resting state",
  mixed: "Main experiment and resting state",
};

export const BIDS_STATUS_LABELS: Readonly<Record<DatasetDoc["bidsStatus"], string>> = {
  notStarted: "Not validated",
  inProgress: "Validation in progress",
  invalid: "Invalid",
  valid: "Valid",
};

export const BIDS_CONVERSION_LABELS: Readonly<Record<DatasetDoc["bidsConversionStatus"], string>> = {
  notStarted: "Not started",
  inProgress: "In progress",
  completed: "Completed",
  failed: "Failed",
};

export const QC_STATUS_LABELS: Readonly<Record<DatasetDoc["qcStatus"], string>> = {
  notStarted: "Not started",
  pending: "Pending",
  passed: "Passed",
  flagged: "Flagged",
  failed: "Failed",
};

export const AVAILABILITY_LABELS: Readonly<Record<DatasetDoc["availability"], string>> = {
  available: "Available",
  partial: "Partly available",
  unavailable: "Unavailable",
  unknown: "Not yet checked",
  noStorage: "No copy registered",
};

export const REF_AVAILABILITY_LABELS: Readonly<Record<DatasetStorageRefDoc["availability"], string>> = {
  available: "Available",
  unavailable: "Unavailable",
  unknown: "Not yet checked",
};

export const ROLE_LABELS: Readonly<Record<DatasetStorageRefDoc["role"], string>> = {
  primary: "Primary",
  mirror: "Mirror",
  backup: "Backup",
  processingCopy: "Processing copy",
};

export const SCAN_STATUS_LABELS: Readonly<Record<StorageScanStatus, string>> = {
  never: "Never scanned",
  ok: "Listed",
  unreachable: "Server did not answer",
  permissionDenied: "Account refused",
  timeout: "Server too slow",
  notFound: "Path not found",
  failed: "Scan failed",
};

export const PROTOCOL_LABELS: Readonly<Record<StorageProtocol, string>> = {
  sftp: "SFTP",
  ftps: "FTPS",
  filesystem: "Institutional file system",
  s3: "Object storage",
  webdav: "WebDAV",
  gin: "GIN",
  osf: "OSF",
  other: "Other",
};

export const ENDPOINT_STATUS_LABELS: Readonly<Record<StorageEndpointDoc["status"], string>> = {
  active: "Active",
  unreachable: "Unreachable",
  retired: "Retired",
};

export const FILE_STATUS_LABELS: Readonly<Record<ManifestFileStatus, string>> = {
  expected: "Expected",
  present: "Present",
  missing: "Missing",
  unexpected: "Unexpected",
  duplicate: "Duplicate",
  mismatch: "Different size or checksum",
};

export const TRANSFER_STATUS_LABELS: Readonly<Record<DatasetTransferDoc["status"], string>> = {
  initiated: "Requested",
  inProgress: "In progress",
  completed: "Completed",
  failed: "Failed",
  verified: "Verified",
};

export const APPROVAL_LABELS: Readonly<Record<DatasetTransferDoc["approval"], string>> = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Refused",
};

/** The file statuses that a comparison found wrong, in the order a reader looks at them. */
export const PROBLEM_STATUSES = [
  "missing",
  "mismatch",
  "unexpected",
  "duplicate",
] as const satisfies readonly ManifestFileStatus[];

/** The counts of a listing in words, for example "12 present, 1 missing". Statuses with no file are left out. */
export function countsText(counts: Readonly<Partial<Record<ManifestFileStatus, number>>>): string {
  const order: readonly ManifestFileStatus[] = ["present", "expected", ...PROBLEM_STATUSES];
  const parts = order
    .filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => `${counts[status]} ${FILE_STATUS_LABELS[status].toLowerCase()}`);
  return parts.length === 0 ? "No files" : parts.join(", ");
}

/** A number of bytes for a reader: bytes, kilobytes, megabytes or gigabytes, in decimal units. */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "kB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${bytes} bytes` : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** A key for a dataset that `registerDataset` accepts, suggested from its replication, laboratory and modality. */
export function suggestedDatasetKey(replicationId: string, laboratorySlug: string | null, modality: string): string {
  const parts = [replicationId, laboratorySlug ?? "", modality]
    .map((part) =>
      part
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter((part) => part !== "");
  return parts.join("-").slice(0, 100).replace(/-+$/, "");
}

/** The unit of a dataset as a capability asks for it. */
const unitOf = (dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">) =>
  dataset.laboratoryId === null
    ? { replicationId: dataset.replicationId }
    : { replicationId: dataset.replicationId, laboratoryId: dataset.laboratoryId };

/** Whether the viewer may change a dataset, as `datasets.manage` decides it. */
export const managesDataset = (viewer: Viewer, dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">) =>
  viewer.can("datasets.manage", unitOf(dataset));

/** Whether the viewer may read paths, listings and the BIDS report, as `datasets.paths.read` decides it. */
export const readsPaths = (viewer: Viewer, dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">) =>
  viewer.can("datasets.paths.read", unitOf(dataset));

/**
 * How the viewer may list what is scoped to a dataset (its copies, transfers and assessments):
 * `all` for programme staff, the keys it holds of the dataset's scope, or null where it holds none.
 */
export function datasetScope(
  viewer: Viewer,
  dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">,
): "all" | readonly string[] | null {
  if (viewer.staff) return "all";
  const held = [
    `rep:${dataset.replicationId}`,
    ...(dataset.laboratoryId === null ? [] : [`lab:${dataset.laboratoryId}`]),
  ].filter((key) => viewer.queryScopeKeys.includes(key));
  return held.length === 0 ? null : held;
}

/** The unit by which the viewer lists listings and reads of a dataset, or null where it may read neither. */
export function pathsUnit(viewer: Viewer, dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">): PathsUnit {
  if (viewer.can("datasets.paths.read", { replicationId: dataset.replicationId })) {
    return { field: "replicationId", value: dataset.replicationId };
  }
  if (dataset.laboratoryId !== null && viewer.can("datasets.paths.read", { laboratoryId: dataset.laboratoryId })) {
    return { field: "laboratoryId", value: dataset.laboratoryId };
  }
  return null;
}
