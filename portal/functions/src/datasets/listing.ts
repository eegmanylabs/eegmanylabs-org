// A listing of one copy of a dataset, from a scan or from a manifest made inside the
// institution, and the failure of a scan (docs/INTEGRATIONS.md, section 7). A listing is compared
// with the latest expected manifest and stored in chunks; it marks the copy available and seen,
// and verified where it matches the expected manifest exactly; it updates the counts and the
// availability of the dataset; and the first one that finds files sets the time the data was
// received and opens the quality-control task. A failed scan writes no listing: the copy keeps
// its last one and the time it was last seen, and is marked unavailable with the reason.
import {
  compareManifest,
  type DatasetDoc,
  type ManifestFileStatus,
  manifestMatches,
  receivedCount,
  type StorageScanStatus,
} from "@eegml/shared";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { touchedFields, type WriteStamp } from "../framework/documents";
import type { ListedFile } from "../integrations/storage/types";
import {
  availabilityOf,
  isCurrent,
  readManifestFiles,
  readRefs,
  type StoredDataset,
  type StoredRef,
  writeManifest,
} from "./model";
import { prepareQcTask, type QcParticipants, type QcTaskPlan, writeQcTask } from "./qc-task";

/** What a listing needs to have read in its transaction before the first write. */
export interface ListingReads {
  readonly refs: readonly StoredRef[];
  readonly expected: readonly { readonly relativePath: string }[] | null;
  readonly qc: QcTaskPlan | null;
}

export async function readForListing(
  db: Firestore,
  transaction: Transaction,
  dataset: StoredDataset,
): Promise<ListingReads> {
  const refs = await readRefs(db, transaction, dataset.id);
  const expected =
    dataset.data.expectedManifestId === null
      ? null
      : await readManifestFiles(db, transaction, dataset.id, dataset.data.expectedManifestId);
  const qc = await prepareQcTask(db, transaction, dataset.id, dataset.data.replicationId);
  return { refs, expected, qc };
}

export interface ListingResult {
  readonly manifestId: string;
  readonly counts: Readonly<Partial<Record<ManifestFileStatus, number>>>;
  readonly taskId: string | null;
}

/** Stores a listing of a copy and everything that follows from it, after `readForListing`. */
export function applyListing(
  db: Firestore,
  transaction: Transaction,
  input: {
    readonly dataset: StoredDataset;
    readonly ref: StoredRef;
    readonly reads: ListingReads;
    readonly files: readonly (
      | ListedFile
      | (Omit<ListedFile, "sizeBytes" | "modifiedAt"> & { sizeBytes?: number; modifiedAt?: string | null })
    )[];
    readonly origin: "scan" | "upload" | "manual";
    readonly participants: QcParticipants;
    readonly auditEventId: string;
    readonly stamp: WriteStamp;
  },
): ListingResult {
  const { dataset, ref, reads, stamp } = input;
  const comparison = compareManifest(input.files, reads.expected);
  const manifestId = writeManifest(
    db,
    transaction,
    dataset,
    {
      kind: "listing",
      storageRefId: ref.id,
      origin: input.origin,
      expectedManifestId: dataset.data.expectedManifestId,
      files: comparison.files,
      counts: comparison.counts,
    },
    stamp,
  );
  const now = Timestamp.fromDate(stamp.at);
  const verified = reads.expected !== null && manifestMatches(comparison.counts);
  const refChanges = {
    availability: "available" as const,
    lastSeenAt: now,
    lastScanAt: now,
    lastScanStatus: "ok" as const,
    latestManifestId: manifestId,
    ...(verified ? { verifiedAt: now, verifiedBy: stamp.actor, verificationManifestId: manifestId } : {}),
  };
  transaction.update(ref.reference, { ...refChanges, ...touchedFields(stamp) });
  const refs = reads.refs.map((candidate) =>
    candidate.id === ref.id ? { ...candidate.data, ...refChanges } : candidate.data,
  );
  const countsForDataset =
    ref.data.role === "primary" ||
    !reads.refs.some((candidate) => candidate.data.role === "primary" && isCurrent(candidate.data));
  const listedCount = comparison.files.filter((file) => file.status !== "missing").length;
  const arrived = listedCount > 0 && dataset.data.receivedAt === undefined;
  const qcStarts = listedCount > 0 && reads.qc !== null;
  const datasetChanges: Partial<Record<keyof DatasetDoc, unknown>> = {
    ...availabilityOf(refs),
    // The received files are those of the primary copy, or of any copy while there is no primary,
    // so a listing of a mirror never stands for what the dataset holds.
    ...(reads.expected === null || !countsForDataset ? {} : { receivedFileCount: receivedCount(comparison.counts) }),
    ...(ref.data.role === "primary"
      ? {
          sizeBytes: comparison.files
            .filter((file) => file.status !== "missing")
            .reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
        }
      : {}),
    ...(arrived ? { receivedAt: now } : {}),
    ...(qcStarts && dataset.data.qcStatus === "notStarted" ? { qcStatus: "pending" } : {}),
  };
  transaction.update(dataset.reference, { ...datasetChanges, ...touchedFields(stamp) });
  const taskId =
    qcStarts && reads.qc !== null
      ? writeQcTask(db, transaction, reads.qc, dataset, input.participants, input.auditEventId, stamp)
      : null;
  return { manifestId, counts: comparison.counts, taskId };
}

/** Records a scan that failed: the copy unavailable with the reason, its last listing and last sighting kept. */
export function applyScanFailure(
  transaction: Transaction,
  input: {
    readonly dataset: StoredDataset;
    readonly ref: StoredRef;
    readonly refs: readonly StoredRef[];
    readonly status: Exclude<StorageScanStatus, "ok" | "never">;
    readonly stamp: WriteStamp;
  },
): void {
  const now = Timestamp.fromDate(input.stamp.at);
  const refChanges = { availability: "unavailable" as const, lastScanAt: now, lastScanStatus: input.status };
  transaction.update(input.ref.reference, { ...refChanges, ...touchedFields(input.stamp) });
  const refs = input.refs.map((candidate) =>
    candidate.id === input.ref.id ? { ...candidate.data, ...refChanges } : candidate.data,
  );
  transaction.update(input.dataset.reference, { ...availabilityOf(refs), ...touchedFields(input.stamp) });
}
