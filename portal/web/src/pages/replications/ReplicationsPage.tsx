import { useMemo } from "react";
import { Link } from "react-router";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { type RecordColumn, RecordTable } from "@/components/record-table";
import { OriginBadge } from "@/components/registry/origin-badge";
import { SidePanel } from "@/components/registry/side-panel";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { retryFailedLiveData } from "@/data";
import { formatCount, MANUSCRIPT_STATUS_LABELS } from "@/registry/labels";
import { useReplicationStatuses } from "@/registry/queries";
import { useSearchText, useUrlState } from "@/registry/url-state";
import { useViewer } from "@/registry/viewer";
import { ReplicationPreview } from "./ReplicationPreview";
import { LeadsText, replicationPath } from "./replication-display";
import {
  DEFAULT_REPLICATION_STATE,
  filterOptions,
  filterReplications,
  LISTINGS,
  type Listing,
  NO_STATUS,
  parseReplicationState,
  type ReplicationRow,
  type ReplicationSortKey,
  serialiseReplicationState,
  sortReplications,
  stageText,
} from "./replication-list";
import { useReplicationRows } from "./use-replication-rows";

const MANUSCRIPT_STATUSES = Object.keys(MANUSCRIPT_STATUS_LABELS) as (keyof typeof MANUSCRIPT_STATUS_LABELS)[];

const LISTING_LABELS: Readonly<Record<Listing, string>> = {
  all: "All replications",
  listed: "Listed on the public website",
  withdrawn: "Removed from the public website",
};

const COLUMNS: readonly RecordColumn<ReplicationRow, ReplicationSortKey>[] = [
  {
    id: "studyKey",
    header: "Study",
    sortKey: "studyKey",
    className: "whitespace-nowrap",
    cell: (row) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <Link
          to={replicationPath(row.studyKey)}
          tabIndex={-1}
          className="rounded-control font-medium text-fg-strong hover:text-fg-accent"
        >
          {row.studyKey}
        </Link>
        <OriginBadge origin={row.dataOrigin} />
        {row.withdrawn ? <Badge tone="outline">Not on website</Badge> : null}
      </span>
    ),
  },
  {
    id: "original",
    header: "Original study",
    sortKey: "original",
    className: "min-w-40",
    cell: (row) =>
      row.originalAuthors === null && row.originalYear === null ? (
        <Unknown />
      ) : (
        <>
          {row.originalAuthors ?? <Unknown>Authors not recorded</Unknown>}
          {row.originalYear === null ? null : ` (${row.originalYear})`}
        </>
      ),
  },
  {
    id: "title",
    header: "Title",
    sortKey: "title",
    className: "min-w-56",
    cell: (row) => row.title ?? <Unknown />,
  },
  {
    id: "status",
    header: "Status",
    sortKey: "status",
    className: "whitespace-nowrap",
    cell: (row) => row.statusLabel ?? <Unknown />,
  },
  {
    id: "stage",
    header: "Public stage",
    sortKey: "stage",
    className: "whitespace-nowrap",
    cell: (row) => stageText(row) ?? <Unknown />,
  },
  { id: "theme", header: "Theme", sortKey: "theme", cell: (row) => row.theme ?? <Unknown /> },
  { id: "construct", header: "Construct", sortKey: "construct", cell: (row) => row.construct ?? <Unknown /> },
  { id: "leads", header: "Leads", sortKey: "leads", className: "min-w-36", cell: (row) => <LeadsText row={row} /> },
  {
    id: "laboratories",
    header: "Laboratories",
    sortKey: "laboratories",
    className: "text-right tabular-nums",
    cell: (row) => (row.laboratoryCount === 0 ? <Unknown>None linked</Unknown> : formatCount(row.laboratoryCount)),
  },
  {
    id: "publications",
    header: "Publications",
    sortKey: "publications",
    className: "text-right tabular-nums",
    cell: (row) => (row.publicationCount === 0 ? <Unknown>None</Unknown> : formatCount(row.publicationCount)),
  },
];

const rowLabel = (row: ReplicationRow) => (row.title === null ? row.studyKey : `${row.studyKey}, ${row.title}`);

export function ReplicationsPage() {
  const viewer = useViewer();
  const rows = useReplicationRows(viewer);
  const statuses = useReplicationStatuses();
  const [state, update] = useUrlState(parseReplicationState, serialiseReplicationState);
  const [searchText, setSearchText] = useSearchText(state.query, (query) => update({ query }));
  const filtered =
    state.query !== "" ||
    state.status !== null ||
    state.stage !== null ||
    state.theme !== null ||
    state.listing !== "all" ||
    state.publication !== null;
  const clearFilters = () =>
    update({ ...DEFAULT_REPLICATION_STATE, sort: state.sort, direction: state.direction, open: state.open });
  usePaletteActions(
    [
      ...(filtered ? [{ id: "clear", label: "Clear the search and filters", run: clearFilters }] : []),
      ...(state.open === null ? [] : [{ id: "close", label: "Close the preview", run: () => update({ open: null }) }]),
    ],
    `${filtered}:${state.open}`,
  );

  const configuredStatuses = useMemo(
    () =>
      statuses.status === "ready"
        ? statuses.data
            .filter((status) => status.archivedAt === null)
            .sort((a, b) => a.position - b.position)
            .map((status) => ({ key: status.key, label: status.label }))
        : [],
    [statuses],
  );

  return (
    <>
      <PageHeader
        title="Replications"
        description="Every replication of the programme. Select a row to preview it beside the list, or open its full page."
      />
      <LiveView
        live={rows}
        loadingLabel="Loading the replications"
        errorTitle="The replications could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(all) => {
          const options = filterOptions(all);
          const statusChoices = [
            ...configuredStatuses,
            ...options.statuses.filter((status) => !configuredStatuses.some((known) => known.key === status.key)),
          ];
          const shown = sortReplications(filterReplications(all, state), state.sort, state.direction);
          const open = state.open === null ? undefined : all.find((row) => row.studyKey === state.open);
          const publicationStatuses = [...new Set(all.flatMap((row) => row.publicationStatuses))];
          return (
            <div className="grid gap-4 *:min-w-0">
              <div className="grid gap-3 *:min-w-0 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_repeat(5,minmax(8rem,1fr))]">
                <FormField label="Search replications" hint="Identifier, other spellings, title or authors">
                  {(control) => (
                    <Input
                      {...control}
                      type="search"
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Status">
                  {(control) => (
                    <Select
                      {...control}
                      value={state.status ?? ""}
                      onChange={(event) => update({ status: event.target.value || null })}
                    >
                      <option value="">Every status</option>
                      {statusChoices.map((status) => (
                        <option key={status.key} value={status.key}>
                          {status.label}
                        </option>
                      ))}
                      <option value={NO_STATUS}>No status recorded</option>
                    </Select>
                  )}
                </FormField>
                <FormField label="Public stage">
                  {(control) => (
                    <Select
                      {...control}
                      value={state.stage ?? ""}
                      onChange={(event) => update({ stage: event.target.value || null })}
                    >
                      <option value="">Every stage</option>
                      {options.stages.map((stage) => (
                        <option key={stage.number} value={String(stage.number)}>
                          {stageText({ stageNumber: stage.number, stageName: stage.name })}
                        </option>
                      ))}
                      <option value={NO_STATUS}>No stage recorded</option>
                    </Select>
                  )}
                </FormField>
                <FormField label="Theme">
                  {(control) => (
                    <Select
                      {...control}
                      value={state.theme ?? ""}
                      onChange={(event) => update({ theme: event.target.value || null })}
                    >
                      <option value="">Every theme</option>
                      {options.themes.map((theme) => (
                        <option key={theme} value={theme}>
                          {theme}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="Public website">
                  {(control) => (
                    <Select
                      {...control}
                      value={state.listing}
                      onChange={(event) => update({ listing: event.target.value as Listing })}
                    >
                      {LISTINGS.map((listing) => (
                        <option key={listing} value={listing}>
                          {LISTING_LABELS[listing]}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="Publications">
                  {(control) => (
                    <Select
                      {...control}
                      value={state.publication ?? ""}
                      onChange={(event) => update({ publication: event.target.value || null })}
                    >
                      <option value="">With or without</option>
                      {MANUSCRIPT_STATUSES.filter(
                        (status) => publicationStatuses.includes(status) || status === state.publication,
                      ).map((status) => (
                        <option key={status} value={status}>
                          Has a publication: {MANUSCRIPT_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p aria-live="polite" className="text-fg-secondary" data-testid="result-count">
                  Showing {formatCount(shown.length)} of {formatCount(all.length)} replications
                </p>
                {filtered ? (
                  <Button size="sm" variant="ghost" onClick={clearFilters}>
                    Clear the search and filters
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-fg-muted">
                In the table, the arrow keys move between rows and Enter opens a preview.
              </p>
              {shown.length === 0 ? (
                <EmptyState
                  title={all.length === 0 ? "No replications yet" : "No replication matches"}
                  description={
                    all.length === 0
                      ? "Replications appear here once an administrator imports or creates them."
                      : "Change the search or clear the filters to see more."
                  }
                />
              ) : (
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <RecordTable
                      rememberScroll
                      caption="Replications"
                      rows={shown}
                      columns={COLUMNS}
                      rowKey={(row) => row.studyKey}
                      rowLabel={rowLabel}
                      sortKey={state.sort}
                      direction={state.direction}
                      onSort={(key) =>
                        update({
                          sort: key,
                          direction: key === state.sort && state.direction === "asc" ? "desc" : "asc",
                        })
                      }
                      onOpen={(row) => update({ open: row.studyKey })}
                      openKey={state.open}
                      data-testid="replications-table"
                    />
                  </div>
                  {open === undefined ? null : (
                    <SidePanel
                      title={open.studyKey}
                      fullPage={replicationPath(open.studyKey)}
                      onClose={() => {
                        update({ open: null });
                        document.querySelector<HTMLElement>(`tr[aria-current="true"]`)?.focus();
                      }}
                    >
                      <ReplicationPreview row={open} />
                    </SidePanel>
                  )}
                </div>
              )}
            </div>
          );
        }}
      </LiveView>
    </>
  );
}
