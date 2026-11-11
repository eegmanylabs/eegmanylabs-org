// The list, the gallery, the board, the calendar and the timeline of a view. Each shows the
// records that the engine computed, opens a record in its dialog, and the board moves a record
// between its columns by pointer or by keyboard.
import {
  addDays,
  type DerivedRecord,
  dayOfValue,
  formatDate,
  groupRecords,
  isDateRange,
  monthName,
  type PropertyValue,
  type ViewConfig,
  type ViewProperty,
} from "@eegml/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { cn } from "@/utils/cn";
import { CellValue } from "./cells";
import { type RecordEditing, titleOf } from "./RecordDialog";
import { todayIso, type ViewData } from "./use-view-data";

export interface LayoutProps {
  readonly data: ViewData;
  readonly records: readonly DerivedRecord[];
  readonly properties: readonly ViewProperty[];
  readonly config: ViewConfig;
  readonly onConfig: (next: ViewConfig) => void;
  readonly editing: RecordEditing;
  readonly onOpen: (record: DerivedRecord) => void;
  readonly caption: string;
}

/** The values of a record beside its title, as a card or a line shows them. */
function Facts({
  data,
  record,
  properties,
}: {
  readonly data: ViewData;
  readonly record: DerivedRecord;
  readonly properties: readonly ViewProperty[];
}) {
  const shown = properties.filter((property) => property.id !== data.collection.titleProperty).slice(0, 4);
  return (
    <dl className="grid gap-1 text-xs">
      {shown.map((property) => (
        <div key={property.id} className="flex min-w-0 gap-2">
          <dt className="shrink-0 text-fg-muted">{property.name}</dt>
          <dd className="min-w-0 truncate">
            <CellValue
              property={property}
              value={record.values[property.id]}
              error={record.errors[property.id]}
              context={data.context}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ListView({ data, records, properties, onOpen, caption }: LayoutProps) {
  return (
    <ul aria-label={caption} className="divide-y divide-border rounded-tile border border-border bg-surface">
      {records.slice(0, 500).map((record) => (
        <li key={record.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <button
            type="button"
            className="truncate text-left font-medium text-fg hover:underline"
            onClick={() => onOpen(record)}
          >
            {titleOf(data, record)}
          </button>
          <Facts data={data} record={record} properties={properties} />
        </li>
      ))}
      {records.length > 500 ? (
        <li className="p-3 text-fg-muted">
          The first 500 of {records.length} records are listed. Narrow the view with a filter or the search.
        </li>
      ) : null}
    </ul>
  );
}

export function GalleryView({ data, records, properties, onOpen, caption }: LayoutProps) {
  return (
    <ul aria-label={caption} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {records.slice(0, 300).map((record) => (
        <li key={record.id} className="grid gap-2 rounded-tile border border-border bg-surface p-3">
          <button
            type="button"
            className="truncate text-left font-medium hover:underline"
            onClick={() => onOpen(record)}
          >
            {titleOf(data, record)}
          </button>
          <Facts data={data} record={record} properties={properties} />
        </li>
      ))}
      {records.length > 300 ? (
        <li className="text-fg-muted">The first 300 of {records.length} records are shown.</li>
      ) : null}
    </ul>
  );
}

/** The select and status properties that a board can be drawn by. */
export const boardProperties = (properties: readonly ViewProperty[]) =>
  properties.filter((property) => property.type === "status" || property.type === "select");

export function BoardView({ data, records, properties, config, onConfig, editing, onOpen, caption }: LayoutProps) {
  const candidates = boardProperties(data.collection.properties);
  const property = candidates.find((candidate) => candidate.id === config.boardProperty) ?? candidates[0];
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  if (property === undefined) {
    return <EmptyState title="Nothing to draw a board by" description="A board needs a status or a select property." />;
  }
  const columns = groupRecords(records, { property: property.id, collapsed: [] }, property, data.context, true);
  const move = (record: DerivedRecord, key: string) => {
    setError(null);
    const value: PropertyValue = key === "" ? null : key;
    editing
      .save(record, property, value)
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "The record was not moved."));
  };
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 text-sm">
        Columns by
        <Select
          aria-label="Columns by"
          className="w-auto"
          value={property.id}
          onChange={(event) => onConfig({ ...config, boardProperty: event.target.value })}
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-fg-accent">
          {error}
        </p>
      )}
      <ul className="flex gap-3 overflow-x-auto pb-2" aria-label={caption}>
        {columns.map((column) => (
          <li
            key={column.key}
            aria-label={`${column.label}, ${column.records.length}`}
            className={cn(
              "grid w-64 shrink-0 content-start gap-2 rounded-tile border border-border bg-surface-muted p-2",
              dragged !== null && "border-dashed",
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const record = records.find(
                (candidate) => candidate.id === event.dataTransfer.getData("text/x-view-record"),
              );
              setDragged(null);
              if (record !== undefined && record.values[property.id] !== (column.key === "" ? null : column.key))
                move(record, column.key);
            }}
            data-column={column.key}
          >
            <h3 className="flex items-center justify-between px-1 text-sm font-medium">
              {column.label}
              <span className="text-fg-muted">{column.records.length}</span>
            </h3>
            {column.records.slice(0, 200).map((record) => {
              const editable = data.canEdit(record, property);
              return (
                <article
                  key={record.id}
                  draggable={editable}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/x-view-record", record.id);
                    setDragged(record.id);
                  }}
                  onDragEnd={() => setDragged(null)}
                  className="grid gap-2 rounded-control border border-border bg-surface p-2"
                  data-record-id={record.id}
                >
                  <button
                    type="button"
                    className="truncate text-left font-medium hover:underline"
                    onClick={() => onOpen(record)}
                  >
                    {titleOf(data, record)}
                  </button>
                  <Facts
                    data={data}
                    record={record}
                    properties={properties.filter((candidate) => candidate.id !== property.id)}
                  />
                  {editable ? (
                    <div className="flex items-center gap-2 text-xs">
                      Move to
                      <Select
                        aria-label={`Move ${titleOf(data, record)} to`}
                        className="h-8"
                        value={column.key}
                        onChange={(event) => move(record, event.target.value)}
                      >
                        {columns.map((target) => (
                          <option key={target.key} value={target.key}>
                            {target.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The date and range properties that a calendar or a timeline can be drawn by. */
export const dateProperties = (properties: readonly ViewProperty[]) =>
  properties.filter((property) => ["date", "dateRange", "createdTime", "editedTime"].includes(property.type));

/** The first and last day a record covers on a property, or null for a record without a date. */
function spanOf(
  record: DerivedRecord,
  start: ViewProperty,
  end: ViewProperty | undefined,
  data: ViewData,
): readonly [string, string] | null {
  const value = record.values[start.id];
  const dayOf = (text: string | null) => (text === null ? null : dayOfValue(text, data.context));
  let first: string | null = null;
  let last: string | null = null;
  if (isDateRange(value)) {
    first = dayOf(value.start) ?? dayOf(value.end);
    last = dayOf(value.end) ?? first;
  } else if (typeof value === "string") {
    first = dayOf(value);
    const until = end === undefined ? null : record.values[end.id];
    last = typeof until === "string" ? (dayOf(until) ?? first) : first;
  }
  if (first === null || last === null) return null;
  return last < first ? [first, first] : [first, last];
}

function DateSettings({
  data,
  config,
  onConfig,
  withEnd,
}: Pick<LayoutProps, "data" | "config" | "onConfig"> & { readonly withEnd: boolean }) {
  const candidates = dateProperties(data.collection.properties);
  const start = candidates.find((candidate) => candidate.id === config.dateProperty) ?? candidates[0];
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <div className="flex items-center gap-2">
        By
        <Select
          aria-label="Placed by"
          className="w-auto"
          value={start?.id ?? ""}
          onChange={(event) => onConfig({ ...config, dateProperty: event.target.value })}
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </div>
      {withEnd && start?.type !== "dateRange" ? (
        <div className="flex items-center gap-2">
          Ending
          <Select
            aria-label="Ending"
            className="w-auto"
            value={config.endDateProperty ?? ""}
            onChange={(event) => {
              const { endDateProperty: _end, ...rest } = config;
              onConfig(event.target.value === "" ? rest : { ...rest, endDateProperty: event.target.value });
            }}
          >
            <option value="">The same day</option>
            {candidates
              .filter((candidate) => candidate.id !== start?.id && candidate.type !== "dateRange")
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </Select>
        </div>
      ) : null}
    </div>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function CalendarView({ data, records, config, onConfig, onOpen, caption }: LayoutProps) {
  const candidates = dateProperties(data.collection.properties);
  const property = candidates.find((candidate) => candidate.id === config.dateProperty) ?? candidates[0];
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const byDay = useMemo(() => {
    const days = new Map<string, DerivedRecord[]>();
    if (property === undefined) return days;
    for (const record of records) {
      const span = spanOf(record, property, undefined, data);
      if (span === null) continue;
      for (let day = span[0], count = 0; day <= span[1] && count < 62; day = addDays(day, 1), count += 1) {
        const list = days.get(day) ?? [];
        list.push(record);
        days.set(day, list);
      }
    }
    return days;
  }, [records, property, data]);
  if (property === undefined) {
    return <EmptyState title="Nothing to place on a calendar" description="A calendar needs a date property." />;
  }
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -weekday);
  const cells = Array.from({ length: 42 }, (_value, index) => addDays(start, index));
  const shift = (by: number) => {
    const [year, number] = month.split("-").map(Number);
    const moved = new Date(Date.UTC(year ?? 2026, (number ?? 1) - 1 + by, 1));
    setMonth(moved.toISOString().slice(0, 7));
  };
  const title = `${monthName(Number(month.slice(5, 7)))} ${month.slice(0, 4)}`;
  const today = todayIso();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateSettings data={data} config={config} onConfig={onConfig} withEnd={false} />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h3 className="min-w-36 text-center font-medium" aria-live="polite">
            {title}
          </h3>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button size="sm" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table aria-label={`${caption}, ${title}`} className="w-full min-w-[42rem] table-fixed border-collapse text-xs">
          <thead>
            <tr>
              {WEEKDAYS.map((day) => (
                <th key={day} scope="col" className="border border-border bg-surface-muted p-1 font-medium">
                  <abbr title={day}>{day.slice(0, 3)}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_week, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the weeks of a month grid are positions
              <tr key={row}>
                {cells.slice(row * 7, row * 7 + 7).map((day) => {
                  const entries = byDay.get(day) ?? [];
                  return (
                    <td
                      key={day}
                      className={cn(
                        "h-24 border border-border p-1 align-top",
                        day.slice(0, 7) !== month && "bg-surface-muted text-fg-muted",
                      )}
                    >
                      <div className={cn("mb-1", day === today && "font-semibold text-fg-accent")}>
                        <span className="sr-only">{formatDate(day, data.context)}</span>
                        <span aria-hidden="true">{Number(day.slice(8))}</span>
                      </div>
                      <ul className="grid gap-0.5">
                        {entries.slice(0, 3).map((record) => (
                          <li key={record.id}>
                            <button
                              type="button"
                              className="w-full truncate rounded-control border border-border bg-surface px-1 text-left hover:border-accent"
                              onClick={() => onOpen(record)}
                            >
                              {titleOf(data, record)}
                            </button>
                          </li>
                        ))}
                        {entries.length > 3 ? <li className="text-fg-muted">and {entries.length - 3} more</li> : null}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DAY_WIDTH = 12;

export function TimelineView({ data, records, config, onConfig, onOpen, caption }: LayoutProps) {
  const candidates = dateProperties(data.collection.properties);
  const start = candidates.find((candidate) => candidate.id === config.dateProperty) ?? candidates[0];
  const end = candidates.find((candidate) => candidate.id === config.endDateProperty);
  const bars = useMemo(() => {
    if (start === undefined) return [];
    return records
      .map((record) => ({ record, span: spanOf(record, start, end, data) }))
      .filter((bar): bar is { record: DerivedRecord; span: readonly [string, string] } => bar.span !== null)
      .slice(0, 300);
  }, [records, start, end, data]);
  if (start === undefined) {
    return (
      <EmptyState
        title="Nothing to place on a timeline"
        description="A timeline needs a date or a date range property."
      />
    );
  }
  const today = todayIso();
  const from = [addDays(today, -14), ...bars.map((bar) => bar.span[0])].sort()[0] ?? today;
  const until = [addDays(today, 14), ...bars.map((bar) => bar.span[1])].sort().at(-1) ?? today;
  const days = Math.min(730, Math.round((Date.parse(until) - Date.parse(from)) / 86_400_000) + 1);
  const offset = (day: string) => Math.round((Date.parse(day) - Date.parse(from)) / 86_400_000);
  const months: { key: string; left: number; label: string }[] = [];
  for (
    let day = `${from.slice(0, 7)}-01`;
    day <= until;
    day = `${addDays(`${day.slice(0, 7)}-28`, 4).slice(0, 7)}-01`
  ) {
    months.push({
      key: day,
      left: Math.max(0, offset(day)) * DAY_WIDTH,
      label: `${monthName(Number(day.slice(5, 7))).slice(0, 3)} ${day.slice(0, 4)}`,
    });
  }
  return (
    <div className="grid gap-2">
      <DateSettings data={data} config={config} onConfig={onConfig} withEnd />
      {bars.length === 0 ? (
        <EmptyState
          title="No record has a date here"
          description={`Give records a value of ${start.name} to place them on the timeline.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-tile border border-border bg-surface">
          <div className="relative" style={{ width: 224 + days * DAY_WIDTH }}>
            <div className="sticky top-0 flex h-8 border-b border-border bg-surface-muted text-xs" aria-hidden="true">
              <div className="w-56 shrink-0 border-r border-border" />
              <div className="relative flex-1">
                {months.map((entry) => (
                  <span
                    key={entry.key}
                    className="absolute top-2 border-l border-border pl-1"
                    style={{ left: entry.left }}
                  >
                    {entry.label}
                  </span>
                ))}
                <span className="absolute top-0 h-full w-px bg-accent" style={{ left: offset(today) * DAY_WIDTH }} />
              </div>
            </div>
            <ul aria-label={caption}>
              {bars.map(({ record, span }) => (
                <li key={record.id} className="flex h-9 items-center border-b border-border">
                  <button
                    type="button"
                    className="w-56 shrink-0 truncate border-r border-border px-2 text-left hover:underline"
                    onClick={() => onOpen(record)}
                  >
                    {titleOf(data, record)}
                  </button>
                  <div className="relative h-full flex-1">
                    <span
                      className="absolute top-2 h-5 rounded-control border border-accent-strong bg-surface-accent"
                      style={{
                        left: offset(span[0]) * DAY_WIDTH,
                        width: Math.max(1, offset(span[1]) - offset(span[0]) + 1) * DAY_WIDTH,
                      }}
                      title={`${formatDate(span[0], data.context)} to ${formatDate(span[1], data.context)}`}
                    >
                      <span className="sr-only">
                        {span[0] === span[1]
                          ? `On ${formatDate(span[0], data.context)}`
                          : `From ${formatDate(span[0], data.context)} to ${formatDate(span[1], data.context)}`}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
