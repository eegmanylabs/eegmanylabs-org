// What the functions of the dataset registry share (docs/DATA_MODEL.md, section 10): reading a
// dataset and its workflow, deciding who may act on it, the scope fields its subcollections
// repeat, the availability of a dataset from its copies, and manifests written in chunks.
import {
  type Capability,
  COLLECTIONS,
  type ComparedEntry,
  chunkManifest,
  type DatasetDoc,
  type DatasetStorageRefDoc,
  type DatasetWorkflow,
  DEFAULT_DATASET_WORKFLOW,
  datasetDocSchema,
  datasetManifestFileChunkDocSchema,
  datasetStorageRefDocSchema,
  datasetWorkflowDocSchema,
  MANIFEST_CHUNK_MAX_FILES,
  type ManifestEntry,
  type ManifestFileStatus,
  parseStoredDocument,
  type ResolvedAccess,
  sequenceId,
  storageEndpointConnectionDocSchema,
  storageEndpointDocSchema,
  unitScopeKeys,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { AppError, type AuthenticatedContext, requireCapability } from "../framework";
import type { WriteStamp } from "../framework/documents";
import type { StorageTarget } from "../integrations/storage/types";

export const DATASET_NOT_FOUND_MESSAGE = "This dataset does not exist.";
export const REFERENCE_NOT_FOUND_MESSAGE = "This copy of the dataset does not exist.";
export const ENDPOINT_NOT_FOUND_MESSAGE = "This storage server is not registered in the portal.";

export interface StoredDataset {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: DatasetDoc;
}

export interface StoredRef {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: DatasetStorageRefDoc;
}

/** Reads a dataset in a transaction, or refuses with the message that it does not exist. */
export async function readDataset(db: Firestore, transaction: Transaction, datasetKey: string): Promise<StoredDataset> {
  const reference = db.doc(COLLECTIONS.datasets.docPath(datasetKey));
  const parsed = parseStoredDocument(datasetDocSchema, (await transaction.get(reference)).data());
  if (!parsed.success) throw new AppError("not-found", DATASET_NOT_FOUND_MESSAGE);
  return { id: datasetKey, reference, data: parsed.data };
}

/** Refuses a change to an archived dataset. */
export function requireActive(dataset: StoredDataset): void {
  if (dataset.data.archivedAt !== null) {
    throw new AppError("failed-precondition", "This dataset is archived. Restore it before changing it.");
  }
}

/** The replication and the laboratory a capability is asked for. */
export function unitOf(dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">): {
  readonly replicationId: string;
  readonly laboratoryId?: string;
} {
  return dataset.laboratoryId === null
    ? { replicationId: dataset.replicationId }
    : { replicationId: dataset.replicationId, laboratoryId: dataset.laboratoryId };
}

/** Refuses a caller who does not hold a capability for the dataset's replication or laboratory. */
export function requireForDataset(
  context: AuthenticatedContext,
  access: ResolvedAccess,
  capability: Capability,
  dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">,
): void {
  requireCapability(context, access, capability, unitOf(dataset));
}

/** The scope fields that every subcollection of a dataset repeats: its replication and laboratory alone. */
export function scopeFieldsOf(dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">) {
  return {
    replicationId: dataset.replicationId,
    laboratoryId: dataset.laboratoryId,
    scopeKeys: unitScopeKeys(dataset.replicationId, dataset.laboratoryId),
  };
}

/** The workflow of a replication's datasets: the one it defines, or the default. */
export async function readWorkflow(
  db: Firestore,
  transaction: Transaction,
  replicationId: string,
): Promise<DatasetWorkflow> {
  const parsed = parseStoredDocument(
    datasetWorkflowDocSchema,
    (await transaction.get(db.doc(COLLECTIONS.datasetWorkflows.docPath(replicationId)))).data(),
  );
  return parsed.success && parsed.data.archivedAt === null ? parsed.data : DEFAULT_DATASET_WORKFLOW;
}

/** Every storage reference of a dataset, current and closed. */
export async function readRefs(db: Firestore, transaction: Transaction, datasetKey: string): Promise<StoredRef[]> {
  const found = await transaction.get(
    db.collection(COLLECTIONS.datasetStorageRefs.collectionPath(datasetKey)).limit(200),
  );
  return found.docs.flatMap((snapshot) => {
    const parsed = parseStoredDocument(datasetStorageRefDocSchema, snapshot.data());
    return parsed.success ? [{ id: snapshot.id, reference: snapshot.ref, data: parsed.data }] : [];
  });
}

/** A storage reference that is current: neither closed by a relocation nor retired. */
export const isCurrent = (ref: Pick<DatasetStorageRefDoc, "validTo" | "archivedAt">) =>
  ref.validTo === null && ref.archivedAt === null;

/** The availability of a dataset from its current copies, and the latest time any copy was reached. */
export function availabilityOf(
  refs: readonly Pick<DatasetStorageRefDoc, "availability" | "lastSeenAt" | "validTo" | "archivedAt">[],
): {
  availability: DatasetDoc["availability"];
  lastSeenAt: Timestamp | null;
} {
  const current = refs.filter(isCurrent);
  const lastSeen = refs
    .map((ref) => ref.lastSeenAt)
    .filter((instant): instant is NonNullable<typeof instant> => instant !== null)
    .sort((a, b) => b.toMillis() - a.toMillis())[0];
  const lastSeenAt = lastSeen === undefined ? null : Timestamp.fromMillis(lastSeen.toMillis());
  if (current.length === 0) return { availability: "noStorage", lastSeenAt };
  const available = current.filter((ref) => ref.availability === "available").length;
  const unavailable = current.filter((ref) => ref.availability === "unavailable").length;
  if (available === current.length) return { availability: "available", lastSeenAt };
  if (available > 0) return { availability: "partial", lastSeenAt };
  if (unavailable > 0) return { availability: "unavailable", lastSeenAt };
  return { availability: "unknown", lastSeenAt };
}

/** A storage endpoint with its connection details, read in a transaction. */
export async function readEndpoint(db: Firestore, transaction: Transaction, key: string) {
  const [endpoint, connection] = await transaction.getAll(
    db.doc(COLLECTIONS.storageEndpoints.docPath(key)),
    db.doc(COLLECTIONS.storageEndpointConnection.docPath(key)),
  );
  const parsed = parseStoredDocument(storageEndpointDocSchema, endpoint?.data());
  if (!parsed.success) throw new AppError("not-found", ENDPOINT_NOT_FOUND_MESSAGE);
  const details = parseStoredDocument(storageEndpointConnectionDocSchema, connection?.data());
  return {
    reference: endpoint?.ref as DocumentReference,
    data: parsed.data,
    connection: details.success ? details.data : null,
  };
}

/** Where a copy is, for an adapter. */
export function targetOf(
  endpoint: { readonly protocol: StorageTarget["protocol"] },
  connection: {
    readonly host: string;
    readonly port?: number;
    readonly basePath?: string;
    readonly credentialRef?: string;
  } | null,
  uri: string,
): StorageTarget | null {
  if (connection === null) return null;
  return {
    protocol: endpoint.protocol,
    host: connection.host,
    port: connection.port ?? null,
    basePath: connection.basePath ?? null,
    path: uri,
    credentialRef: connection.credentialRef ?? null,
  };
}

/** A file as a chunk of a manifest stores it. */
export type StoredFile = ComparedEntry<ManifestEntry> & { readonly modifiedAt?: string | null };

/** The files of a manifest as they were stored, chunk by chunk, read in a transaction. */
export async function readManifestFiles(
  db: Firestore,
  transaction: Transaction,
  datasetKey: string,
  manifestId: string,
): Promise<ManifestEntry[]> {
  const found = await transaction.get(
    db.collection(COLLECTIONS.datasetManifestFileChunks.collectionPath(datasetKey, manifestId)).limit(1_000),
  );
  return found.docs
    .flatMap((snapshot) => {
      const parsed = parseStoredDocument(datasetManifestFileChunkDocSchema, snapshot.data());
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) =>
      chunk.files.map((file) => ({
        relativePath: file.relativePath,
        ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
        ...(file.checksum === undefined || file.checksumAlgorithm === undefined
          ? {}
          : { checksumAlgorithm: file.checksumAlgorithm, checksum: file.checksum }),
      })),
    );
}

export interface ManifestToWrite {
  readonly kind: "expected" | "listing";
  readonly storageRefId: string | null;
  readonly origin: "scan" | "upload" | "manual";
  readonly expectedManifestId: string | null;
  readonly files: readonly StoredFile[];
  readonly counts: Readonly<Partial<Record<ManifestFileStatus, number>>>;
}

/**
 * Writes a manifest in a transaction: its chunks first and the manifest, which states their
 * number, last. Gives the identifier of the manifest.
 */
export function writeManifest(
  db: Firestore,
  transaction: Transaction,
  dataset: StoredDataset,
  manifest: ManifestToWrite,
  stamp: WriteStamp,
): string {
  const reference = db.collection(COLLECTIONS.datasetManifests.collectionPath(dataset.id)).doc();
  const appended = {
    createdAt: Timestamp.fromDate(stamp.at),
    createdBy: stamp.actor,
    writeContext: stamp.writeContext,
  };
  const scope = scopeFieldsOf(dataset.data);
  const stored = manifest.files.map((file) => ({
    relativePath: file.relativePath,
    ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
    ...(file.checksum === undefined || file.checksumAlgorithm === undefined
      ? {}
      : { checksumAlgorithm: file.checksumAlgorithm.toLowerCase(), checksum: file.checksum.toLowerCase() }),
    ...(file.modifiedAt === undefined || file.modifiedAt === null
      ? {}
      : { modifiedAt: Timestamp.fromDate(new Date(file.modifiedAt)) }),
    status: file.status,
    ...(file.expectedSizeBytes === undefined ? {} : { expectedSizeBytes: file.expectedSizeBytes }),
    ...(file.expectedChecksum === undefined ? {} : { expectedChecksum: file.expectedChecksum }),
  }));
  const chunks = chunkManifest(stored, MANIFEST_CHUNK_MAX_FILES);
  chunks.forEach((files, index) => {
    transaction.create(
      db.doc(COLLECTIONS.datasetManifestFileChunks.docPath(dataset.id, reference.id, sequenceId(index))),
      COLLECTIONS.datasetManifestFileChunks.schema.parse({
        schemaVersion: COLLECTIONS.datasetManifestFileChunks.schemaVersion,
        ...appended,
        datasetId: dataset.id,
        manifestId: reference.id,
        index,
        files,
        ...scope,
      }),
    );
  });
  transaction.create(
    reference,
    COLLECTIONS.datasetManifests.schema.parse({
      schemaVersion: COLLECTIONS.datasetManifests.schemaVersion,
      ...appended,
      datasetId: dataset.id,
      kind: manifest.kind,
      storageRefId: manifest.storageRefId,
      listedAt: Timestamp.fromDate(stamp.at),
      origin: manifest.origin,
      fileCount: manifest.files.filter((file) => file.status !== "missing").length,
      totalSizeBytes: manifest.files
        .filter((file) => file.status !== "missing")
        .reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
      chunkCount: chunks.length,
      expectedManifestId: manifest.expectedManifestId,
      counts: manifest.counts,
      checksumCount: manifest.files.filter((file) => file.checksum !== undefined).length,
      ...scope,
    }),
  );
  return reference.id;
}
