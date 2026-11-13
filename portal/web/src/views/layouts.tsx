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
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { cn } from "@/utils/cn";
import { CellValue } from "./cells";
import { type RecordEditing, titleOf } from "./RecordDialog";
import { todayIso, type ViewData } from "./use-view-data";

/** How many records the list and the gallery draw on one page (R18.13). */
export const LIST_PAGE = 100;
export const GALLERY_PAGE = 60;
/** How many cards a column of a board draws at first, and how many more each Show more adds. */
export const BOARD_PAGE = 50;

/** The first record of the last page of a list, so that a list that shrank shows its last page. */
export function lastPageStart(total: number, pageSize: number): number {
  return total === 0 ? 0 : Math.floor((total - 1) / pageSize) * pageSize;
}

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

/** The identifier of the first record that a relation value of a record names, or null. */
function relatedId(value: PropertyValue | undefined): string | null {
  if (!Array.isArray(value)) return null;
  const [first] = value as readonly unknown[];
  return typeof first === "object" && first !== null && "entityId" in first ? String(first.entityId) : null;
}

/** The identifiers that a relation value of a record names. */
function relatedIds(value: PropertyValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return (value as readonly unknown[]).flatMap((entry) =>
    typeof entry === "object" && entry !== null && "entityId" in entry ? [String(entry.entityId)] : [],
  );
}

/**
 * The records of a list in their order, each with its depth: where the view nests records by a
 * relation to their parent, a record follows its parent, and a record whose parent the view
 * does not show stands at the top. Without such a relation every record stands at the top.
 */
function nestedRecords(
  records: readonly DerivedRecord[],
  parentProperty: string | undefined,
): { readonly record: DerivedRecord; readonly depth: number }[] {
  if (parentProperty === undefined) return records.map((record) => ({ record, depth: 0 }));
  const shown = new Set(records.map((record) => record.id));
  const children = new Map<string | null, DerivedRecord[]>();
  for (const record of records) {
    const parent = relatedId(record.values[parentProperty]);
    const key = parent !== null && shown.has(parent) ? parent : null;
    children.set(key, [...(children.get(key) ?? []), record]);
  }
  const ordered: { record: DerivedRecord; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const record of children.get(parent) ?? []) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      ordered.push({ record, depth });
      walk(record.id, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

export function ListView({ data, records, properties, config, onOpen, caption }: LayoutProps) {
  const parent = data.collection.properties.find(
    (property) => property.id === config.parentProperty && property.type === "relation",
  );
  const rows = nestedRecords(records, parent?.id);
  const [offset, setOffset] = useState(0);
  const start = Math.min(offset, lastPageStart(rows.length, LIST_PAGE));
  return (
    <div className="grid gap-1">
      <ul aria-label={caption} className="divide-y divide-border rounded-tile border border-border bg-surface">
        {rows.slice(start, start + LIST_PAGE).map(({ record, depth }) => (
          <li
            key={record.id}
            className="grid gap-2 p-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]"
            style={depth === 0 ? undefined : { paddingLeft: `${0.75 + Math.min(depth, 10) * 1.25}rem` }}
            data-depth={depth}
          >
            <button
              type="button"
              className="truncate text-left font-medium text-fg hover:underline"
              onClick={() => onOpen(record)}
            >
              {depth === 0 ? null : <span className="sr-only">Beneath the record above, level {depth + 1}: </span>}
              {titleOf(data, record)}
            </button>
            <Facts
              data={data}
              record={record}
              properties={properties.filter((property) => property.id !== parent?.id)}
            />
          </li>
        ))}
      </ul>
      <Pagination offset={start} pageSize={LIST_PAGE} total={rows.length} label="records" onChange={setOffset} />
    </div>
  );
}

export function GalleryView({ data, records, properties, onOpen, caption }: LayoutProps) {
  const [offset, setOffset] = useState(0);
  const start = Math.min(offset, lastPageStart(records.length, GALLERY_PAGE));
  return (
    <div className="grid gap-1">
      <ul aria-label={caption} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {records.slice(start, start + GALLERY_PAGE).map((record) => (
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
      </ul>
      <Pagination offset={start} pageSize={GALLERY_PAGE} total={records.length} label="records" onChange={setOffset} />
    </div>
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
  const [shown, setShown] = useState<Readonly<Record<string, number>>>({});
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
  const shownIn = (key: string) => shown[key] ?? BOARD_PAGE;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
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
            {column.records.slice(0, shownIn(column.key)).map((record) => {
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
            {column.records.length > shownIn(column.key) ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShown({ ...shown, [column.key]: shownIn(column.key) + BOARD_PAGE })}
              >
                Show {Math.min(BOARD_PAGE, column.records.length - shownIn(column.key))} more in {column.label}
              </Button>
            ) : null}
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
  } else {
    const until = end === undefined ? null : record.values[end.id];
    const finish = typeof until === "string" ? dayOf(until) : null;
    // A record that has an end and no start is placed on its end, as a task with a due date alone.
    first = typeof value === "string" ? dayOf(value) : finish;
    last = finish ?? first;
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
  const daysOfMonth = cells.filter((day) => day.slice(0, 7) === month && (byDay.get(day) ?? []).length > 0);
  return (
    <div className="grid min-w-0 gap-2">
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
      {/* Below the width of a small tablet the month is a list of the days that hold records. */}
      <div className="sm:hidden">
        {daysOfMonth.length === 0 ? (
          <p className="text-fg-muted">Nothing is placed in {title}.</p>
        ) : (
          <ol aria-label={`${caption}, ${title}`} className="grid gap-2">
            {daysOfMonth.map((day) => (
              <li key={day} className="rounded-control border border-border p-2">
                <h4 className={cn("mb-1 text-sm font-medium", day === today && "text-fg-accent")}>
                  {formatDate(day, data.context)}
                </h4>
                <ul className="grid gap-1">
                  {(byDay.get(day) ?? []).map((record) => (
                    <li key={record.id}>
                      <button
                        type="button"
                        className="min-h-8 w-full truncate rounded-control border border-border bg-surface px-2 text-left hover:border-accent"
                        onClick={() => onOpen(record)}
                      >
                        {titleOf(data, record)}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="hidden min-w-0 overflow-x-auto sm:block">
        <table aria-label={`${caption}, ${title}`} className="w-full min-w-[36rem] table-fixed border-collapse text-xs">
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
/** The height of a row of the timeline and of its header, and the width of its labels, in pixels. */
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 32;
const LABEL_WIDTH = 224;

export function TimelineView({ data, records, config, onConfig, onOpen, caption }: LayoutProps) {
  const candidates = dateProperties(data.collection.properties);
  const start = candidates.find((candidate) => candidate.id === config.dateProperty) ?? candidates[0];
  const end = candidates.find((candidate) => candidate.id === config.endDateProperty);
  const dependency = data.collection.properties.find(
    (property) => property.id === config.dependencyProperty && property.type === "relation",
  );
  const milestone = data.collection.properties.find(
    (property) => property.id === config.milestoneProperty && property.type === "checkbox",
  );
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
  const row = new Map(bars.map((bar, index) => [bar.record.id, index]));
  const titles = new Map(bars.map((bar) => [bar.record.id, titleOf(data, bar.record)]));
  // Each dependency on a record that the timeline also shows is drawn as a line from the end of
  // that record's bar to the start of the bar that depends on it.
  const lines =
    dependency === undefined
      ? []
      : bars.flatMap((bar, index) =>
          relatedIds(bar.record.values[dependency.id]).flatMap((id) => {
            const at = row.get(id);
            const before = at === undefined ? undefined : bars[at];
            if (at === undefined || before === undefined) return [];
            const x1 = LABEL_WIDTH + (offset(before.span[1]) + 1) * DAY_WIDTH;
            const x2 = LABEL_WIDTH + offset(bar.span[0]) * DAY_WIDTH;
            const y1 = HEADER_HEIGHT + at * ROW_HEIGHT + ROW_HEIGHT / 2;
            const y2 = HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
            const bend = Math.max(x1, x2 - 6) + 4;
            return [{ key: `${id}>${bar.record.id}`, d: `M${x1} ${y1} H${bend} V${y2} H${x2}` }];
          }),
        );
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
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <DateSettings data={data} config={config} onConfig={onConfig} withEnd />
      {bars.length === 0 ? (
        <EmptyState
          title="No record has a date here"
          description={`Give records a value of ${start.name} to place them on the timeline.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-tile border border-border bg-surface">
          <div className="relative" style={{ width: LABEL_WIDTH + days * DAY_WIDTH }}>
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
                    {milestone !== undefined && record.values[milestone.id] === true ? (
                      <span
                        className="absolute top-2.5 size-4 rotate-45 border border-accent-strong bg-accent"
                        style={{ left: offset(span[1]) * DAY_WIDTH + DAY_WIDTH / 2 - 8 }}
                        title={`Milestone on ${formatDate(span[1], data.context)}`}
                        data-milestone="true"
                      >
                        <span className="sr-only">Milestone on {formatDate(span[1], data.context)}</span>
                      </span>
                    ) : (
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
                    )}
                    {dependency === undefined ? null : (
                      <span className="sr-only">
                        {relatedIds(record.values[dependency.id])
                          .flatMap((id) => {
                            const title = titles.get(id);
                            return title === undefined ? [] : [`Depends on ${title}.`];
                          })
                          .join(" ")}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {lines.length === 0 ? null : (
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-0 text-fg-accent"
                width={LABEL_WIDTH + days * DAY_WIDTH}
                height={HEADER_HEIGHT + bars.length * ROW_HEIGHT}
                data-testid="timeline-dependencies"
              >
                {lines.map((line) => (
                  <path
                    key={line.key}
                    d={line.d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    data-dependency={line.key}
                  />
                ))}
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
