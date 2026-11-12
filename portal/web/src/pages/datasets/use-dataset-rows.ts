// The live rows of the dataset registry, shared by the list of datasets, the tabs of replications
// and laboratories and the pipeline: the registry documents, the names of laboratories and the
// workflow of each replication, which names the states.
import { type DatasetWorkflow, DEFAULT_DATASET_WORKFLOW } from "@eegml/shared";
import { useMemo } from "react";
import type { Live, RecordOf } from "@/data";
import { combineLive } from "@/registry/combine";
import { useDatasets, useDatasetWorkflows, useLaboratories } from "@/registry/queries";
import { buildDatasetRows, type DatasetRow } from "./dataset-list";

export interface DatasetRows {
  readonly rows: readonly DatasetRow[];
  readonly records: readonly RecordOf<"datasets">[];
  readonly laboratories: readonly RecordOf<"laboratories">[];
  /** The workflow of each replication: its own where it defines one, and the default otherwise. */
  readonly workflowOf: (replicationId: string) => DatasetWorkflow;
}

export function useDatasetRows(): Live<DatasetRows> {
  const datasets = useDatasets();
  const workflows = useDatasetWorkflows();
  const laboratories = useLaboratories();
  return useMemo(
    () =>
      combineLive([datasets, workflows, laboratories] as const, (records, defined, labs) => {
        const byReplication = new Map(
          defined
            .filter((workflow) => workflow.archivedAt === null)
            .map((workflow) => [workflow.replicationId, workflow]),
        );
        const workflowOf = (replicationId: string): DatasetWorkflow =>
          byReplication.get(replicationId) ?? DEFAULT_DATASET_WORKFLOW;
        const statusLabel = (replicationId: string, key: string) =>
          workflowOf(replicationId).states.find((state) => state.key === key)?.label ?? key;
        return {
          rows: buildDatasetRows(records, new Map(labs.map((lab) => [lab.id, lab.name])), statusLabel),
          records,
          laboratories: labs,
          workflowOf,
        };
      }),
    [datasets, workflows, laboratories],
  );
}
