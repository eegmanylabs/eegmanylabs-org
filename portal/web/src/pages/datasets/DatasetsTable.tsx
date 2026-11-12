// The table of datasets, shared by the registry and the tabs of a replication and a laboratory.
// It is virtualised, so that a registry of thousands of datasets scrolls without delay, and is
// read and operated by keyboard as every record table is.
import { Link } from "react-router";
import { formatDateTime } from "@/app/labels";
import { type RecordColumn, RecordTable } from "@/components/record-table";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import type { SortDirection } from "@/components/ui/sort-header";
import { datasetPath } from "@/registry/paths";
import { AVAILABILITY_LABELS, QC_STATUS_LABELS } from "./dataset-format";
import type { DatasetRow, DatasetSortKey } from "./dataset-list";

const ROW_HEIGHT = 48;

const COLUMNS: readonly RecordColumn<DatasetRow, DatasetSortKey>[] = [
  {
    id: "key",
    header: "Dataset",
    sortKey: "key",
    className: "min-w-56",
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <Link
          to={datasetPath(row.id)}
          tabIndex={-1}
          className="truncate rounded-control font-medium text-fg-strong hover:text-fg-accent"
          title={row.title}
        >
          {row.datasetKey}
        </Link>
        <OriginBadge origin={row.dataOrigin} />
      </span>
    ),
  },
  { id: "replication", header: "Replication", sortKey: "replication", cell: (row) => row.replicationId },
  {
    id: "laboratory",
    header: "Laboratory",
    sortKey: "laboratory",
    className: "min-w-36",
    cell: (row) =>
      row.laboratory === null ? <Unknown>None</Unknown> : <span className="truncate">{row.laboratory}</span>,
  },
  {
    id: "status",
    header: "State",
    sortKey: "status",
    className: "min-w-36",
    cell: (row) => (
      <span className="flex items-center gap-1.5">
        {row.status}
        {row.analysisReady && !/analysis ready/i.test(row.status) ? (
          <Badge tone="solid">Ready for analysis</Badge>
        ) : null}
      </span>
    ),
  },
  { id: "qc", header: "QC", sortKey: "qc", cell: (row) => QC_STATUS_LABELS[row.qcStatus] },
  {
    id: "availability",
    header: "Availability",
    cell: (row) =>
      row.availability === "unavailable" || row.availability === "partial" ? (
        <Badge tone="accent">{AVAILABILITY_LABELS[row.availability]}</Badge>
      ) : (
        AVAILABILITY_LABELS[row.availability]
      ),
  },
  {
    id: "lastSeen",
    header: "Last seen",
    sortKey: "lastSeen",
    className: "min-w-36",
    cell: (row) => (row.lastSeenAt === null ? <Unknown>Never</Unknown> : formatDateTime(row.lastSeenAt)),
  },
];

export function DatasetsTable({
  rows,
  caption,
  sortKey,
  direction,
  onSort,
  onOpen,
  openKey,
}: {
  rows: readonly DatasetRow[];
  caption: string;
  sortKey: DatasetSortKey;
  direction: SortDirection;
  onSort: (key: DatasetSortKey) => void;
  onOpen: (row: DatasetRow) => void;
  openKey: string | null;
}) {
  return (
    <RecordTable
      caption={caption}
      rows={rows}
      columns={COLUMNS}
      rowKey={(row) => row.id}
      rowLabel={(row) => `${row.datasetKey}, ${row.title}`}
      sortKey={sortKey}
      direction={direction}
      onSort={onSort}
      onOpen={onOpen}
      openKey={openKey}
      virtualise={rows.length > 50 ? { rowHeight: ROW_HEIGHT, viewportHeight: 560 } : undefined}
      data-testid="datasets-table"
    />
  );
}
