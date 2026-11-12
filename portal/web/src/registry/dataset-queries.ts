// The live reads of the dataset registry beneath one dataset. The registry documents and the
// storage servers are whole directories (`ALL_DATASETS`, `ALL_STORAGE_ENDPOINTS` of queries.ts).
// What sits beneath a dataset is read within its scope, so each query states the clause that the
// security rules check: the keys of the dataset's scope that the viewer holds, or, for listings
// and the record of reads, the replication or the laboratory in which the viewer holds
// `datasets.paths.read`.
import { MEMBERS_SCOPE_KEY } from "@eegml/shared";
import type { LiveQuery } from "@/data";

type Scope = "all" | readonly string[] | null;

const scoped = (scope: "all" | readonly string[]) =>
  scope === "all" ? {} : { where: [["scopeKeys", "array-contains-any", [...scope]]] as const };

/** The copies of a dataset, current and closed. */
export function storageRefsOf(datasetKey: string, scope: Scope): LiveQuery<"datasetStorageRefs"> | null {
  return scope === null
    ? null
    : { collection: "datasetStorageRefs", within: [datasetKey], ...scoped(scope), limit: 200 };
}

/** The transfers of a dataset. */
export function transfersOf(datasetKey: string, scope: Scope): LiveQuery<"datasetTransfers"> | null {
  return scope === null ? null : { collection: "datasetTransfers", within: [datasetKey], ...scoped(scope), limit: 200 };
}

/** The quality assessments of a dataset. */
export function qcAssessmentsOf(datasetKey: string, scope: Scope): LiveQuery<"datasetQcAssessments"> | null {
  return scope === null
    ? null
    : { collection: "datasetQcAssessments", within: [datasetKey], ...scoped(scope), limit: 500 };
}

/** The unit by which a reader of paths limits a list: the replication where it holds the right there, else the laboratory. */
export type PathsUnit = { readonly field: "replicationId" | "laboratoryId"; readonly value: string } | null;

/** The manifests of a dataset, for a reader of paths. */
export function manifestsOf(datasetKey: string, unit: PathsUnit): LiveQuery<"datasetManifests"> | null {
  return unit === null
    ? null
    : { collection: "datasetManifests", within: [datasetKey], where: [[unit.field, "==", unit.value]], limit: 500 };
}

/** The chunks of one manifest, for a reader of paths. */
export function fileChunksOf(
  datasetKey: string,
  manifestId: string,
  unit: PathsUnit,
): LiveQuery<"datasetManifestFileChunks"> | null {
  return unit === null
    ? null
    : {
        collection: "datasetManifestFileChunks",
        within: [datasetKey, manifestId],
        where: [[unit.field, "==", unit.value]],
        limit: 1_000,
      };
}

/** The record of who read the locations of a dataset, for a reader of paths. */
export function accessEventsOf(datasetKey: string, unit: PathsUnit): LiveQuery<"datasetAccessEvents"> | null {
  return unit === null
    ? null
    : { collection: "datasetAccessEvents", within: [datasetKey], where: [[unit.field, "==", unit.value]], limit: 500 };
}

/** The status history of a dataset, latest first, which every member reads. */
export function statusHistoryOfDataset(datasetKey: string): LiveQuery<"statusHistory"> {
  return {
    collection: "statusHistory",
    within: [],
    where: [
      ["entityType", "==", "dataset"],
      ["entityId", "==", datasetKey],
      ["scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: 200,
  };
}

/** The deviations of the participation a dataset belongs to, which a quality assessment can name. */
export function deviationsOfParticipation(
  participationId: string | null,
  scope: Scope,
): LiveQuery<"participationDeviations"> | null {
  return participationId === null || scope === null
    ? null
    : { collection: "participationDeviations", within: [participationId], ...scoped(scope), limit: 200 };
}

/** The documents linked to a dataset that the caller may read. `scopeKeys` are the caller's own, at most 30. */
export function documentLinksOfDataset(datasetKey: string, scopeKeys: readonly string[]): LiveQuery<"documentLinks"> {
  return {
    collection: "documentLinks",
    within: [],
    where: [
      ["entityType", "==", "dataset"],
      ["entityId", "==", datasetKey],
      ["scopeKeys", "array-contains-any", scopeKeys],
    ],
    limit: 200,
  };
}
