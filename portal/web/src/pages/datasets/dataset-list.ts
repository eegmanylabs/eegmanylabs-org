// The list of datasets as rows: what each row shows, how the list is searched, filtered and sorted,
// how that state is written into the address, and the counts of the pipeline of datasets that the
// list and the dashboards show. Pure, so that it is tested by itself. It follows the lists of
// laboratories and replications.
import { type DatasetDoc, type DatasetWorkflowState, matchesSearch, searchWords } from "@eegml/shared";
import type { SortDirection } from "@/components/ui/sort-header";

export type DatasetSource = Pick<
  DatasetDoc,
  | "datasetKey"
  | "title"
  | "replicationId"
  | "laboratoryId"
  | "modality"
  | "groupingLabel"
  | "workflowStatusKey"
  | "bidsStatus"
  | "qcStatus"
  | "availability"
  | "analysisReady"
  | "dataOrigin"
  | "archivedAt"
> & { readonly id: string; readonly lastSeenAt: { toDate(): Date } | null };

export interface DatasetRow {
  readonly id: string;
  readonly datasetKey: string;
  readonly title: string;
  readonly replicationId: string;
  readonly laboratoryId: string | null;
  readonly laboratory: string | null;
  readonly modality: DatasetDoc["modality"];
  readonly groupingLabel: string | null;
  readonly statusKey: string;
  readonly status: string;
  readonly bidsStatus: DatasetDoc["bidsStatus"];
  readonly qcStatus: DatasetDoc["qcStatus"];
  readonly availability: DatasetDoc["availability"];
  readonly analysisReady: boolean;
  readonly lastSeenAt: Date | null;
  readonly dataOrigin: DatasetDoc["dataOrigin"];
}

export function buildDatasetRows(
  datasets: readonly DatasetSource[],
  laboratoryNames: ReadonlyMap<string, string>,
  statusLabel: (replicationId: string, key: string) => string,
): DatasetRow[] {
  return datasets
    .filter((dataset) => dataset.archivedAt === null)
    .map((dataset) => ({
      id: dataset.id,
      datasetKey: dataset.datasetKey,
      title: dataset.title,
      replicationId: dataset.replicationId,
      laboratoryId: dataset.laboratoryId,
      laboratory:
        dataset.laboratoryId === null ? null : (laboratoryNames.get(dataset.laboratoryId) ?? dataset.laboratoryId),
      modality: dataset.modality,
      groupingLabel: dataset.groupingLabel ?? null,
      statusKey: dataset.workflowStatusKey,
      status: statusLabel(dataset.replicationId, dataset.workflowStatusKey),
      bidsStatus: dataset.bidsStatus,
      qcStatus: dataset.qcStatus,
      availability: dataset.availability,
      analysisReady: dataset.analysisReady,
      lastSeenAt: dataset.lastSeenAt === null ? null : dataset.lastSeenAt.toDate(),
      dataOrigin: dataset.dataOrigin,
    }));
}

export const DATASET_SORT_KEYS = ["key", "replication", "laboratory", "status", "qc", "lastSeen"] as const;
export type DatasetSortKey = (typeof DATASET_SORT_KEYS)[number];

export interface DatasetListState {
  readonly query: string;
  readonly replication: string | null;
  readonly laboratory: string | null;
  readonly status: string | null;
  readonly qc: DatasetDoc["qcStatus"] | null;
  readonly sort: DatasetSortKey;
  readonly direction: SortDirection;
  readonly open: string | null;
}

export const DEFAULT_DATASET_STATE: DatasetListState = {
  query: "",
  replication: null,
  laboratory: null,
  status: null,
  qc: null,
  sort: "key",
  direction: "asc",
  open: null,
};

const QC_VALUES: readonly DatasetDoc["qcStatus"][] = ["notStarted", "pending", "passed", "flagged", "failed"];

export function parseDatasetState(params: URLSearchParams): DatasetListState {
  const sort = params.get("sort");
  const qc = params.get("qc");
  return {
    query: params.get("q") ?? "",
    replication: params.get("replication"),
    laboratory: params.get("laboratory"),
    status: params.get("status"),
    qc: QC_VALUES.find((value) => value === qc) ?? null,
    sort: DATASET_SORT_KEYS.find((key) => key === sort) ?? "key",
    direction: params.get("direction") === "desc" ? "desc" : "asc",
    open: params.get("open"),
  };
}

export function serialiseDatasetState(state: DatasetListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query !== "") params.set("q", state.query);
  if (state.replication !== null) params.set("replication", state.replication);
  if (state.laboratory !== null) params.set("laboratory", state.laboratory);
  if (state.status !== null) params.set("status", state.status);
  if (state.qc !== null) params.set("qc", state.qc);
  if (state.sort !== "key") params.set("sort", state.sort);
  if (state.direction !== "asc") params.set("direction", state.direction);
  if (state.open !== null) params.set("open", state.open);
  return params;
}

export function filterDatasets(rows: readonly DatasetRow[], state: DatasetListState): DatasetRow[] {
  const words = searchWords(state.query);
  return rows.filter(
    (row) =>
      (state.replication === null || row.replicationId === state.replication) &&
      (state.laboratory === null || row.laboratoryId === state.laboratory) &&
      (state.status === null || row.statusKey === state.status) &&
      (state.qc === null || row.qcStatus === state.qc) &&
      matchesSearch(words, [row.datasetKey, row.title, row.replicationId, row.laboratory, row.groupingLabel]),
  );
}

const compareText = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, "en");

export function sortDatasets(rows: readonly DatasetRow[], key: DatasetSortKey, direction: SortDirection): DatasetRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const value = (row: DatasetRow): string | null => {
    switch (key) {
      case "key":
        return row.datasetKey;
      case "replication":
        return row.replicationId;
      case "laboratory":
        return row.laboratory;
      case "status":
        return row.status;
      case "qc":
        return row.qcStatus;
      case "lastSeen":
        return row.lastSeenAt === null ? null : row.lastSeenAt.toISOString();
    }
  };
  return [...rows].sort((a, b) => {
    const first = value(a);
    const second = value(b);
    // A missing value stays last whichever way the list is sorted.
    if (first === null || second === null) return compareText(first, second);
    return sign * compareText(first, second) || a.datasetKey.localeCompare(b.datasetKey, "en");
  });
}

/** One stage of the pipeline of datasets: a state of the workflow and how many datasets are in it. */
export interface PipelineStage {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

/**
 * The datasets in each state, in the order of the default workflow, with any state that only a
 * replication's own workflow knows after them, and the datasets by QC status.
 */
export function pipelineOf(
  rows: readonly Pick<DatasetRow, "statusKey" | "status" | "qcStatus">[],
  states: readonly Pick<DatasetWorkflowState, "key" | "label">[],
): { readonly stages: readonly PipelineStage[]; readonly qc: Readonly<Record<DatasetDoc["qcStatus"], number>> } {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    counts.set(row.statusKey, (counts.get(row.statusKey) ?? 0) + 1);
    labels.set(row.statusKey, row.status);
  }
  const known = states.map((state) => ({ key: state.key, label: state.label, count: counts.get(state.key) ?? 0 }));
  const others = [...counts.keys()]
    .filter((key) => !states.some((state) => state.key === key))
    .sort()
    .map((key) => ({ key, label: labels.get(key) ?? key, count: counts.get(key) ?? 0 }));
  const qc = { notStarted: 0, pending: 0, passed: 0, flagged: 0, failed: 0 };
  for (const row of rows) qc[row.qcStatus] += 1;
  return { stages: [...known, ...others], qc };
}
