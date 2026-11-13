import { isIsoDate, statusAt } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { formatDate, formatDateTime } from "@/app/labels";
import { Unknown } from "@/components/registry/unknown";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { RecordOf } from "@/data";
import { formatDay } from "@/pages/recruitment/dates";

const SOURCE_LABELS = {
  manual: "Changed in the portal",
  import: "Imported from a programme record",
  automation: "Changed by an automation",
  sheetSync: "Synchronised from a sheet",
  programmeDecision: "Decided by the programme",
} as const;

/** The first moment after a calendar day in the reader's time zone. */
function endOfDay(isoDate: string): Date {
  return new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)) + 1);
}

/**
 * The status as it stood at the end of a chosen day (R7.6), reconstructed from the history below:
 * the change that took effect last before then, and of two at the same time the one recorded
 * later. A change entered afterwards with an earlier effective time is said to be so.
 */
function StatusOnDate({
  entries,
  statusLabel,
}: {
  entries: readonly RecordOf<"statusHistory">[];
  statusLabel: (key: string) => string;
}) {
  const [day, setDay] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isIsoDate(day)) {
      setError("Enter a date.");
      return;
    }
    setError(null);
    setShown(day);
  };
  const result =
    shown === null
      ? null
      : statusAt(
          entries.map((entry) => ({
            toStatusKey: entry.toStatusKey,
            effectiveAt: entry.effectiveAt.toDate(),
            recordedAt: entry.recordedAt.toDate(),
          })),
          endOfDay(shown),
        );
  return (
    <section aria-labelledby="status-on-date" className="grid gap-2 rounded-tile border border-border px-4 py-3">
      <h3 id="status-on-date" className="text-base text-fg-strong">
        Status on a date
      </h3>
      <form className="grid gap-2" onSubmit={submit} noValidate>
        <FormField label="Date" error={error} hint="The status at the end of this day.">
          {(control) => (
            <Input
              {...control}
              type="date"
              className="w-full max-w-48"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          )}
        </FormField>
        <Button type="submit" className="justify-self-start">
          Show the status
        </Button>
      </form>
      {shown === null || result === null ? null : (
        <p role="status" data-testid="status-on-date">
          {result.kind === "none"
            ? `No status had been recorded by the end of ${formatDay(shown)}.`
            : `At the end of ${formatDay(shown)} the status was ${statusLabel(result.statusKey)}, since ${formatDate(result.entry.effectiveAt)}.`}
          {result.kind === "status" && result.recordedLater
            ? ` This change was recorded later, on ${formatDate(result.entry.recordedAt)}.`
            : ""}
        </p>
      )}
    </section>
  );
}

/** The status history of the replication, latest first, with its status on any chosen date. */
export function ActivityTab({
  entries,
  statusLabel,
}: {
  entries: readonly RecordOf<"statusHistory">[];
  statusLabel: (key: string) => string;
}) {
  return (
    <div className="grid gap-3">
      <StatusOnDate entries={entries} statusLabel={statusLabel} />
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
    </div>
  );
}
