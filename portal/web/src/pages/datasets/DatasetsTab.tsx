// The datasets of one replication or of one laboratory, on its record page: the pipeline, the
// table of datasets and their registration, and, for a replication, its workflow of datasets,
// which its leads define. The same registry documents as the registry itself (D-011).
import { useState } from "react";
import { useNavigate } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { retryFailedLiveData } from "@/data";
import { Section } from "@/pages/replications/tabs/OverviewTab";
import { combineLive } from "@/registry/combine";
import { datasetPath } from "@/registry/paths";
import { useParticipations, useStorageEndpoints } from "@/registry/queries";
import type { Viewer } from "@/registry/viewer";
import { DatasetPipeline } from "./DatasetPipeline";
import { DatasetsTable } from "./DatasetsTable";
import { type DatasetSortKey, sortDatasets } from "./dataset-list";
import { RegisterDatasetDialog, registrationUnits } from "./RegisterDatasetDialog";
import { useDatasetRows } from "./use-dataset-rows";
import { WorkflowDialog } from "./WorkflowDialog";

export function DatasetsTab({
  viewer,
  replicationId,
  laboratoryId,
}: {
  viewer: Viewer;
  /** The replication whose datasets are shown, or the laboratory's. */
  replicationId?: string;
  laboratoryId?: string;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const datasets = useDatasetRows();
  const participations = useParticipations();
  const endpoints = useStorageEndpoints();
  const live = combineLive([datasets, participations, endpoints] as const, (data, parts, servers) => ({
    data,
    parts,
    servers,
  }));
  const [sort, setSort] = useState<{ key: DatasetSortKey; direction: "asc" | "desc" }>({
    key: "key",
    direction: "asc",
  });
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"register" | "workflow" | null>(null);
  const definesWorkflow =
    replicationId !== undefined && viewer.access.member && viewer.can("replications.manage", { replicationId });
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the datasets"
      errorTitle="The datasets could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {({ data, parts, servers }) => {
        const rows = data.rows.filter(
          (row) =>
            (replicationId === undefined || row.replicationId === replicationId) &&
            (laboratoryId === undefined || row.laboratoryId === laboratoryId),
        );
        const units = registrationUnits(viewer, parts);
        const registers = [...units.entries()].some(
          ([replication, labs]) =>
            (replicationId === undefined || replication === replicationId) &&
            (laboratoryId === undefined || labs.includes(laboratoryId)),
        );
        const workflow = replicationId === undefined ? null : data.workflowOf(replicationId);
        return (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {registers ? (
                <Button variant="primary" onClick={() => setDialog("register")}>
                  Register a dataset
                </Button>
              ) : null}
              {definesWorkflow ? <Button onClick={() => setDialog("workflow")}>Define the workflow</Button> : null}
            </div>
            {rows.length === 0 ? (
              <EmptyState
                title="No datasets yet"
                description="A dataset is registered where its data is held, such as on an institutional server. No central copy is needed."
              />
            ) : (
              <>
                <DatasetPipeline rows={rows} title="Pipeline of the datasets" />
                <DatasetsTable
                  rows={sortDatasets(rows, sort.key, sort.direction)}
                  caption="Datasets"
                  sortKey={sort.key}
                  direction={sort.direction}
                  onSort={(key) =>
                    setSort({ key, direction: key === sort.key && sort.direction === "asc" ? "desc" : "asc" })
                  }
                  onOpen={(row) => {
                    setOpen(row.id);
                    navigate(datasetPath(row.id));
                  }}
                  openKey={open}
                />
              </>
            )}
            {workflow === null ? null : (
              <Section title="Workflow of the datasets">
                <ol className="flex flex-wrap gap-1.5 text-sm" aria-label="States of the workflow">
                  {workflow.states.map((state) => (
                    <li key={state.key} className="rounded-pill border border-border px-2.5 py-0.5">
                      {state.label}
                      {state.key === workflow.initialKey ? ", first" : ""}
                      {state.analysisReady ? ", ready for analysis" : ""}
                    </li>
                  ))}
                </ol>
              </Section>
            )}
            {dialog === "register" ? (
              <RegisterDatasetDialog
                open
                onOpenChange={(next) => setDialog(next ? "register" : null)}
                viewer={viewer}
                participations={parts}
                laboratories={data.laboratories}
                endpoints={servers}
                {...(replicationId === undefined ? {} : { fixedReplication: replicationId })}
                {...(laboratoryId === undefined ? {} : { fixedLaboratory: laboratoryId })}
                onRegistered={(key) => {
                  toast.show({ title: "The dataset has been registered." });
                  navigate(datasetPath(key));
                }}
              />
            ) : null}
            {dialog === "workflow" && workflow !== null && replicationId !== undefined ? (
              <WorkflowDialog replicationId={replicationId} workflow={workflow} onClose={() => setDialog(null)} />
            ) : null}
          </div>
        );
      }}
    </LiveView>
  );
}
