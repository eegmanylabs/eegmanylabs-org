import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Unknown } from "@/components/registry/unknown";
import { byText, type TableSpec, useTableControls } from "@/components/table-controls";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SortHeader } from "@/components/ui/sort-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type LiveQuery, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { AdminPage } from "@/pages/admin/AdminPage";
import { combineLive } from "@/registry/combine";
import {
  BATCH_STATUS_LABELS,
  DOCUMENT_ACCESS_LABELS,
  SOURCE_AUTHORITY_LABELS,
  SOURCE_SYNC_LABELS,
} from "@/registry/labels";
import { ActorName, countEntries, durationText, statLabel } from "./import-format";

type Batch = RecordOf<"importBatches">;
type Source = RecordOf<"sources">;

const SOURCES: LiveQuery<"sources"> = { collection: "sources", within: [], limit: 200 };
const BATCHES: LiveQuery<"importBatches"> = {
  collection: "importBatches",
  within: [],
  orderBy: [["startedAt", "desc"]],
  limit: 500,
};

export const batchPath = (batchId: string) => `/admin/imports/batches/${encodeURIComponent(batchId)}`;

type BatchSort = "started" | "source" | "status";
const BATCH_SPEC: TableSpec<Batch, BatchSort> = {
  searchText: (batch) => [batch.id, batch.sourceKey, batch.status, batch.mode],
  sorters: {
    started: (a, b) => a.startedAt.toMillis() - b.startedAt.toMillis(),
    source: (a, b) => byText(a.sourceKey, b.sourceKey),
    status: (a, b) => byText(a.status, b.status),
  },
  initialSort: { key: "started", direction: "desc" },
  pageSize: 25,
};

function SourcesTable({ sources, batches }: { sources: readonly Source[]; batches: readonly Batch[] }) {
  if (sources.length === 0) {
    return (
      <EmptyState
        title="No source is registered"
        description="A source is registered when the import tools first read it from a trusted machine."
      />
    );
  }
  const latest = new Map<string, Batch>();
  for (const batch of batches) {
    const known = latest.get(batch.sourceKey);
    if (known === undefined || known.startedAt.toMillis() < batch.startedAt.toMillis())
      latest.set(batch.sourceKey, batch);
  }
  return (
    <div className="relative overflow-x-auto">
      <Table caption="Registered sources">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Source</TableHeaderCell>
            <TableHeaderCell>Authority</TableHeaderCell>
            <TableHeaderCell>Synchronisation</TableHeaderCell>
            <TableHeaderCell>Access</TableHeaderCell>
            <TableHeaderCell>Last import</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {[...sources]
            .sort((a, b) => byText(a.key, b.key))
            .map((source) => {
              const batch = latest.get(source.key);
              return (
                <TableRow key={source.id}>
                  <TableCell>
                    <span className="font-medium text-fg-strong">{source.key}</span>
                    <span className="block text-fg-secondary">{source.title}</span>
                  </TableCell>
                  <TableCell>{SOURCE_AUTHORITY_LABELS[source.authority]}</TableCell>
                  <TableCell>{SOURCE_SYNC_LABELS[source.syncPolicy]}</TableCell>
                  <TableCell>{DOCUMENT_ACCESS_LABELS[source.accessStatus]}</TableCell>
                  <TableCell>
                    {batch === undefined ? (
                      <Unknown>No batch recorded</Unknown>
                    ) : (
                      <Link to={batchPath(batch.id)} className="text-fg-accent underline">
                        {formatDateTime(batch.startedAt.toDate())}, {BATCH_STATUS_LABELS[batch.status].toLowerCase()}
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}

function BatchesTable({ batches }: { batches: readonly Batch[] }) {
  const table = useTableControls(batches, BATCH_SPEC);
  if (batches.length === 0) {
    return (
      <EmptyState
        title="No import has run"
        description="Each run of an importer, a preview or an apply, is listed here."
      />
    );
  }
  return (
    <div className="grid gap-3">
      <div className="relative overflow-x-auto">
        <Table caption="Import batches, latest first">
          <TableHead>
            <TableRow>
              <SortHeader direction={table.directionOf("started")} onSort={() => table.sortBy("started")}>
                Started
              </SortHeader>
              <SortHeader direction={table.directionOf("source")} onSort={() => table.sortBy("source")}>
                Source
              </SortHeader>
              <TableHeaderCell>Mode</TableHeaderCell>
              <SortHeader direction={table.directionOf("status")} onSort={() => table.sortBy("status")}>
                Status
              </SortHeader>
              <TableHeaderCell>Counts</TableHeaderCell>
              <TableHeaderCell>Started by</TableHeaderCell>
              <TableHeaderCell>Duration</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {table.page.map((batch) => (
              <TableRow key={batch.id} className="align-top">
                <TableCell>
                  <Link to={batchPath(batch.id)} className="text-fg-accent underline">
                    {formatDateTime(batch.startedAt.toDate())}
                  </Link>
                </TableCell>
                <TableCell>{batch.sourceKey}</TableCell>
                <TableCell>{batch.mode === "apply" ? "Apply" : "Preview"}</TableCell>
                <TableCell>
                  <Badge tone={batch.status === "failed" ? "accent" : "neutral"}>
                    {BATCH_STATUS_LABELS[batch.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {countEntries(batch.stats).length === 0 ? (
                    <Unknown>None recorded</Unknown>
                  ) : (
                    <ul className="text-fg-secondary">
                      {countEntries(batch.stats).map(([key, count]) => (
                        <li key={key}>
                          {statLabel(key)}: <span className="tabular-nums">{count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell>
                  <ActorName actor={batch.startedBy} />
                </TableCell>
                <TableCell>
                  {durationText(batch.startedAt.toDate(), batch.finishedAt?.toDate() ?? null) ?? (
                    <Unknown>Running</Unknown>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        offset={table.offset}
        pageSize={table.pageSize}
        total={table.total}
        label="batches"
        onChange={table.setOffset}
      />
    </div>
  );
}

function ImportsConsole() {
  const sources = useLiveQuery(SOURCES);
  const batches = useLiveQuery(BATCHES);
  const live = useMemo(() => combineLive([sources, batches] as const, (s, b) => ({ s, b })), [sources, batches]);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "batches" ? "batches" : "sources";
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the imports"
      errorTitle="The imports could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {({ s, b }) => (
        <Tabs
          className="min-w-0"
          value={tab}
          onValueChange={(value) =>
            setParams(value === "batches" ? new URLSearchParams({ tab: "batches" }) : new URLSearchParams(), {
              replace: true,
            })
          }
        >
          <TabsList aria-label="Sections of the imports console">
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="batches">Batches</TabsTrigger>
          </TabsList>
          <TabsContent value="sources">
            <SourcesTable sources={s} batches={b} />
          </TabsContent>
          <TabsContent value="batches">
            <BatchesTable batches={b} />
          </TabsContent>
        </Tabs>
      )}
    </LiveView>
  );
}

/** The sources and the import batches, for holders of `imports.run`. */
export function ImportsPage() {
  return (
    <AdminPage
      entryId="admin-imports"
      description="The registered sources, by letter and title, and every run of the importers. The addresses of the source documents stay in private configuration and are never shown."
    >
      <ImportsConsole />
    </AdminPage>
  );
}
