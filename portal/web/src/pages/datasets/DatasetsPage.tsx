// The registry of datasets: every dataset of the programme, where it is held and how far it has
// come, with a preview beside the list and the registration of a new one. Every member reads the
// registry; paths and listings stay on the record page, for those who may read them.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatDateTime } from "@/app/labels";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { Detail, Details } from "@/components/registry/details";
import { SidePanel } from "@/components/registry/side-panel";
import { Unknown } from "@/components/registry/unknown";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { retryFailedLiveData } from "@/data";
import { combineLive } from "@/registry/combine";
import { formatCount } from "@/registry/labels";
import { datasetPath, laboratoryPath, replicationPath, STORAGE_SERVERS_PATH } from "@/registry/paths";
import { useParticipations, useStorageEndpoints } from "@/registry/queries";
import { useSearchText, useUrlState } from "@/registry/url-state";
import { useViewer } from "@/registry/viewer";
import { DatasetPipeline } from "./DatasetPipeline";
import { DatasetsTable } from "./DatasetsTable";
import { AVAILABILITY_LABELS, BIDS_STATUS_LABELS, MODALITY_LABELS, QC_STATUS_LABELS } from "./dataset-format";
import {
  type DatasetRow,
  DEFAULT_DATASET_STATE,
  filterDatasets,
  parseDatasetState,
  serialiseDatasetState,
  sortDatasets,
} from "./dataset-list";
import { RegisterDatasetDialog, registrationUnits } from "./RegisterDatasetDialog";
import { useDatasetRows } from "./use-dataset-rows";

function DatasetPreview({ row }: { row: DatasetRow }) {
  return (
    <Details>
      <Detail term="Title">{row.title}</Detail>
      <Detail term="Replication">
        <Link to={replicationPath(row.replicationId)} className="text-fg-accent underline">
          {row.replicationId}
        </Link>
      </Detail>
      <Detail term="Laboratory">
        {row.laboratoryId === null ? (
          <Unknown>None</Unknown>
        ) : (
          <Link to={laboratoryPath(row.laboratoryId)} className="text-fg-accent underline">
            {row.laboratory}
          </Link>
        )}
      </Detail>
      <Detail term="Modality">{MODALITY_LABELS[row.modality]}</Detail>
      <Detail term="Session or grouping">{row.groupingLabel ?? <Unknown />}</Detail>
      <Detail term="State">{row.status}</Detail>
      <Detail term="BIDS validation">{BIDS_STATUS_LABELS[row.bidsStatus]}</Detail>
      <Detail term="QC">{QC_STATUS_LABELS[row.qcStatus]}</Detail>
      <Detail term="Availability">{AVAILABILITY_LABELS[row.availability]}</Detail>
      <Detail term="Last seen">
        {row.lastSeenAt === null ? <Unknown>Never</Unknown> : formatDateTime(row.lastSeenAt)}
      </Detail>
    </Details>
  );
}

export function DatasetsPage() {
  const viewer = useViewer();
  const toast = useToast();
  const navigate = useNavigate();
  const datasets = useDatasetRows();
  const participations = useParticipations();
  const endpoints = useStorageEndpoints();
  const live = useMemo(
    () =>
      combineLive([datasets, participations, endpoints] as const, (data, parts, servers) => ({ data, parts, servers })),
    [datasets, participations, endpoints],
  );
  const [state, update] = useUrlState(parseDatasetState, serialiseDatasetState);
  const [searchText, setSearchText] = useSearchText(state.query, (query) => update({ query }));
  const [registering, setRegistering] = useState(false);
  const registers = viewer !== null && live.status === "ready" && registrationUnits(viewer, live.data.parts).size > 0;
  const filtered = state.query !== "" || state.replication !== null || state.status !== null || state.qc !== null;
  const clearFilters = () => update({ ...DEFAULT_DATASET_STATE, sort: state.sort, direction: state.direction });
  usePaletteActions(
    [
      ...(registers ? [{ id: "register-dataset", label: "Register a dataset", run: () => setRegistering(true) }] : []),
      { id: "storage-servers", label: "Show the storage servers", run: () => navigate(STORAGE_SERVERS_PATH) },
    ],
    `${registers}`,
  );

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Where every dataset of the programme is held and how far it has come. Data stays on the institutions' servers; the registry records where."
        actions={
          <div className="flex flex-wrap gap-2">
            {registers ? (
              <Button variant="primary" onClick={() => setRegistering(true)}>
                Register a dataset
              </Button>
            ) : null}
            <Button asChild>
              <Link to={STORAGE_SERVERS_PATH}>Storage servers</Link>
            </Button>
          </div>
        }
      />
      <LiveView
        live={live}
        loadingLabel="Loading the datasets"
        errorTitle="The datasets could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ data, parts, servers }) => {
          const rows = data.rows;
          const shown = sortDatasets(filterDatasets(rows, state), state.sort, state.direction);
          const open = state.open === null ? undefined : rows.find((row) => row.id === state.open);
          const replications = [...new Set(rows.map((row) => row.replicationId))].sort();
          const statuses = [...new Map(rows.map((row) => [row.statusKey, row.status])).entries()].sort((a, b) =>
            a[1].localeCompare(b[1], "en"),
          );
          return (
            <div className="grid gap-4 *:min-w-0">
              {rows.length === 0 ? null : <DatasetPipeline rows={rows} title="Pipeline of datasets" />}
              {rows.length === 0 ? null : (
                <>
                  <div className="grid gap-3 *:min-w-0 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_repeat(3,minmax(9rem,1fr))]">
                    <FormField label="Search datasets" hint="Key, title, replication, laboratory or session">
                      {(control) => (
                        <Input
                          {...control}
                          type="search"
                          value={searchText}
                          onChange={(event) => setSearchText(event.target.value)}
                        />
                      )}
                    </FormField>
                    <FormField label="Replication">
                      {(control) => (
                        <Select
                          {...control}
                          value={state.replication ?? ""}
                          onChange={(event) => update({ replication: event.target.value || null })}
                        >
                          <option value="">Every replication</option>
                          {replications.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                    <FormField label="State">
                      {(control) => (
                        <Select
                          {...control}
                          value={state.status ?? ""}
                          onChange={(event) => update({ status: event.target.value || null })}
                        >
                          <option value="">Every state</option>
                          {statuses.map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                    <FormField label="QC">
                      {(control) => (
                        <Select
                          {...control}
                          value={state.qc ?? ""}
                          onChange={(event) => update({ qc: (event.target.value || null) as typeof state.qc })}
                        >
                          <option value="">Every QC status</option>
                          {(Object.keys(QC_STATUS_LABELS) as (keyof typeof QC_STATUS_LABELS)[]).map((key) => (
                            <option key={key} value={key}>
                              {QC_STATUS_LABELS[key]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p aria-live="polite" className="text-fg-secondary" data-testid="result-count">
                      Showing {formatCount(shown.length)} of {formatCount(rows.length)} datasets
                    </p>
                    {filtered ? (
                      <Button size="sm" variant="ghost" onClick={clearFilters}>
                        Clear the search and filters
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
              {rows.length === 0 ? (
                <EmptyState
                  title="No datasets yet"
                  description={
                    registers
                      ? "Register the first dataset: say where its data is held, and the registry keeps track of it from there."
                      : "The leads of a replication and the coordinators of its laboratories register its datasets."
                  }
                  action={
                    registers ? (
                      <Button variant="primary" onClick={() => setRegistering(true)}>
                        Register a dataset
                      </Button>
                    ) : undefined
                  }
                />
              ) : shown.length === 0 ? (
                <EmptyState
                  title="No dataset matches"
                  description="Change the search or clear the filters to see more."
                />
              ) : (
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <DatasetsTable
                      rows={shown}
                      caption="Datasets"
                      sortKey={state.sort}
                      direction={state.direction}
                      onSort={(key) =>
                        update({
                          sort: key,
                          direction: key === state.sort && state.direction === "asc" ? "desc" : "asc",
                        })
                      }
                      onOpen={(row) => update({ open: row.id })}
                      openKey={state.open}
                    />
                  </div>
                  {open === undefined ? null : (
                    <SidePanel
                      title={open.datasetKey}
                      fullPage={datasetPath(open.id)}
                      onClose={() => {
                        update({ open: null });
                        document.querySelector<HTMLElement>(`tr[aria-current="true"]`)?.focus();
                      }}
                    >
                      <DatasetPreview row={open} />
                    </SidePanel>
                  )}
                </div>
              )}
              {registering && viewer !== null ? (
                <RegisterDatasetDialog
                  open
                  onOpenChange={setRegistering}
                  viewer={viewer}
                  participations={parts}
                  laboratories={data.laboratories}
                  endpoints={servers}
                  onRegistered={(key) => {
                    toast.show({ title: "The dataset has been registered." });
                    navigate(datasetPath(key));
                  }}
                />
              ) : null}
            </div>
          );
        }}
      </LiveView>
    </>
  );
}
