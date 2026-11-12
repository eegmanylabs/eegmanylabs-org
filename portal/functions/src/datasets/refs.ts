// Creating a copy of a dataset: the storage reference that every holder of the dataset's scope
// reads, its location in a document that no client reads, and the endpoint's audience, which
// gains the dataset's scope so that its owner and administrators see where it is used.
import {
  COLLECTIONS,
  can,
  type DatasetDoc,
  type DatasetStorageRefDoc,
  datasetStorageRefDocSchema,
  laboratoryScopeKey,
  normaliseStoragePath,
  parseStoredDocument,
  type ResolvedAccess,
  replicationScopeKey,
  type StorageEndpointConnectionDoc,
  type StorageEndpointDoc,
  storagePathProblem,
  storagePathsOverlap,
  storagePathWithin,
  unitScopeKeys,
  type ViewerTool,
} from "@eegml/shared";
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { AppError } from "../framework";
import { createdFields, touchedFields, type WriteStamp } from "../framework/documents";
import { isCurrent, type StoredDataset, scopeFieldsOf } from "./model";

/**
 * Whether two copies of a dataset name the same folder of the same server, so that nothing can
 * move between them. A copy whose recorded path is not in normal form counts as the same.
 */
export async function sameFolder(
  db: Firestore,
  transaction: Transaction,
  datasetKey: string,
  a: { readonly id: string; readonly data: Pick<DatasetStorageRefDoc, "endpointKey"> },
  b: { readonly id: string; readonly data: Pick<DatasetStorageRefDoc, "endpointKey"> },
): Promise<boolean> {
  if (a.data.endpointKey !== b.data.endpointKey) return false;
  const [first, second] = await transaction.getAll(
    db.doc(COLLECTIONS.datasetStorageRefLocation.docPath(datasetKey, a.id)),
    db.doc(COLLECTIONS.datasetStorageRefLocation.docPath(datasetKey, b.id)),
  );
  const pathOf = (snapshot: typeof first) => {
    const uri = snapshot?.get("uri");
    return typeof uri === "string" ? normaliseStoragePath(uri) : null;
  };
  const one = pathOf(first);
  const other = pathOf(second);
  return one === null || other === null || one === other;
}

/** The most current copies of one server that a placement is compared with. */
const PLACEMENT_SCAN_LIMIT = 2_000;

/**
 * Decides where a new copy may be named on a server, and gives its path in normal form. The
 * scanning account of a server reads every folder below its base path, so the path of a copy is
 * what binds a listing to the dataset whose readers will see it:
 *
 * | Check                     | Refused when                                                                 |
 * |---------------------------|------------------------------------------------------------------------------|
 * | Form                      | The path is empty, `.`, holds `..` or a control character, or starts with a slash |
 * | Folder of the caller      | The caller manages datasets for the replication or laboratory only, and the path lies outside the folder the server's connection names for each of them. A holder of `datasets.manage` for the programme names any folder |
 * | Another dataset's copy    | A current copy of another dataset on the same server is in the same folder, inside it or around it |
 * | A copy of the same dataset| A current copy of the same dataset on the same server names the same folder |
 *
 * `replacing` names a copy that the new one closes, which a relocation leaves out of the comparison.
 */
export async function placeCopy(
  db: Firestore,
  transaction: Transaction,
  access: ResolvedAccess,
  dataset: { readonly id: string; readonly data: Pick<DatasetDoc, "replicationId" | "laboratoryId"> },
  endpoint: { readonly key: string; readonly connection: StorageEndpointConnectionDoc | null },
  path: string,
  replacing: string | null,
): Promise<string> {
  const problem = storagePathProblem(path);
  const normalised = normaliseStoragePath(path);
  if (problem !== null || normalised === null)
    throw new AppError("invalid-argument", problem ?? "The path is not valid.");
  if (!can(access, "datasets.manage", "programme")) {
    const prefixes = endpoint.connection?.allowedPrefixes ?? {};
    const keys = [
      ...(can(access, "datasets.manage", { replicationId: dataset.data.replicationId })
        ? [replicationScopeKey(dataset.data.replicationId)]
        : []),
      ...(dataset.data.laboratoryId !== null &&
      can(access, "datasets.manage", { laboratoryId: dataset.data.laboratoryId })
        ? [laboratoryScopeKey(dataset.data.laboratoryId)]
        : []),
    ];
    const folders = keys.flatMap((key) => {
      const folder = prefixes[key];
      return folder === undefined ? [] : [folder];
    });
    if (!folders.some((folder) => storagePathWithin(normalised, folder))) {
      throw new AppError(
        "permission-denied",
        folders.length === 0
          ? "This server has no folder for your replication or laboratory. Ask an administrator to name one."
          : `A copy on this server goes inside ${folders.map((folder) => `"${folder}"`).join(" or ")}.`,
      );
    }
  }
  const found = await transaction.get(
    db
      .collectionGroup(COLLECTIONS.datasetStorageRefs.collectionId)
      .where("endpointKey", "==", endpoint.key)
      .limit(PLACEMENT_SCAN_LIMIT),
  );
  const current = found.docs.flatMap((snapshot) => {
    const parsed = parseStoredDocument(datasetStorageRefDocSchema, snapshot.data());
    return parsed.success && isCurrent(parsed.data) && snapshot.id !== replacing
      ? [{ id: snapshot.id, datasetId: parsed.data.datasetId }]
      : [];
  });
  if (current.length === 0) return normalised;
  const locations = await transaction.getAll(
    ...current.map((ref) => db.doc(COLLECTIONS.datasetStorageRefLocation.docPath(ref.datasetId, ref.id))),
  );
  locations.forEach((location, index) => {
    const ref = current[index];
    const stored = location.get("uri");
    const other = typeof stored === "string" ? normaliseStoragePath(stored) : null;
    if (ref === undefined || other === null) return;
    if (ref.datasetId === dataset.id && other === normalised) {
      throw new AppError(
        "failed-precondition",
        "This dataset already has a current copy in this folder of the server.",
      );
    }
    if (ref.datasetId !== dataset.id && storagePathsOverlap(normalised, other)) {
      throw new AppError(
        "failed-precondition",
        "A copy of another dataset is held in this folder, inside it or around it. Each dataset needs a folder of its own.",
      );
    }
  });
  return normalised;
}

/** Refuses a server that is retired: no new copy goes there. */
export function requireOpenEndpoint(endpoint: Pick<StorageEndpointDoc, "status">): void {
  if (endpoint.status === "retired") {
    throw new AppError("failed-precondition", "This storage server is retired. Choose another one.");
  }
}

export interface NewRef {
  readonly endpointKey: string;
  readonly endpointReference: DocumentReference;
  readonly role: "primary" | "mirror" | "backup" | "processingCopy";
  readonly uri: string;
  readonly viewerSupport: readonly ViewerTool[];
  readonly note: string | null;
  readonly relocatedFromRefId: string | null;
}

/** Writes a new storage reference and its location. Gives its identifier. */
export function createRef(
  db: Firestore,
  transaction: Transaction,
  dataset: Pick<StoredDataset, "id" | "data">,
  ref: NewRef,
  stamp: WriteStamp,
): string {
  const reference = db.collection(COLLECTIONS.datasetStorageRefs.collectionPath(dataset.id)).doc();
  transaction.create(
    reference,
    COLLECTIONS.datasetStorageRefs.schema.parse({
      ...createdFields("datasetStorageRefs", stamp),
      datasetId: dataset.id,
      endpointKey: ref.endpointKey,
      role: ref.role,
      availability: "unknown",
      verifiedAt: null,
      verifiedBy: null,
      verificationManifestId: null,
      validFrom: Timestamp.fromDate(stamp.at),
      validTo: null,
      relocatedFromRefId: ref.relocatedFromRefId,
      lastSeenAt: null,
      lastScanAt: null,
      lastScanStatus: "never",
      latestManifestId: null,
      viewerSupport: [...new Set(ref.viewerSupport)],
      viewerLinkTools: [],
      ...(ref.note === null ? {} : { note: ref.note }),
      ...scopeFieldsOf(dataset.data),
    }),
  );
  transaction.create(
    db.doc(COLLECTIONS.datasetStorageRefLocation.docPath(dataset.id, reference.id)),
    COLLECTIONS.datasetStorageRefLocation.schema.parse({
      ...createdFields("datasetStorageRefLocation", stamp),
      uri: ref.uri,
    }),
  );
  transaction.update(ref.endpointReference, {
    scopeKeys: FieldValue.arrayUnion(...unitScopeKeys(dataset.data.replicationId, dataset.data.laboratoryId)),
    ...touchedFields(stamp),
  });
  return reference.id;
}
