import { formatDateTime } from "@/app/labels";
import { Unknown } from "@/components/registry/unknown";
import type { RecordOf } from "@/data";

const SOURCE_LABELS = {
  manual: "Changed in the portal",
  import: "Imported from a programme record",
  automation: "Changed by an automation",
  sheetSync: "Synchronised from a sheet",
} as const;

/** The status history of the replication, latest first. */
export function ActivityTab({
  entries,
  statusLabel,
}: {
  entries: readonly RecordOf<"statusHistory">[];
  statusLabel: (key: string) => string;
}) {
  return (
    <ol className="grid gap-2" aria-label="Status history">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="grid gap-1 rounded-tile border border-border bg-surface px-4 py-3"
          data-testid="status-entry"
        >
          <p className="font-medium text-fg-strong">
            {entry.fromStatusKey === null
              ? `Status set to ${statusLabel(entry.toStatusKey)}`
              : `${statusLabel(entry.fromStatusKey)} to ${statusLabel(entry.toStatusKey)}`}
          </p>
          <p className="text-fg-secondary">
            <time dateTime={entry.effectiveAt.toDate().toISOString()}>
              {formatDateTime(entry.effectiveAt.toDate())}
            </time>
            {" · "}
            {SOURCE_LABELS[entry.source]}
          </p>
          <p>{entry.reason === undefined ? <Unknown>No reason recorded</Unknown> : entry.reason}</p>
        </li>
      ))}
    </ol>
  );
}
