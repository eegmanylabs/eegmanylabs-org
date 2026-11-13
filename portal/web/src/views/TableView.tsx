// The table of a view: virtualised, so that thousands of rows scroll without delay; grouped
// into sections that fold; with columns that are resized and reordered by pointer and by
// keyboard; with values changed in place where the viewer may; and with a selection of rows
// that is changed in bulk.
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  type DerivedRecord,
  type PropertyValue,
  type ViewConfig,
  type ViewGroup,
  type ViewProperty,
} from "@eegml/shared";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type UIEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { cn } from "@/utils/cn";
import { CellValue, ValueEditor } from "./cells";
import type { RecordEditing } from "./RecordDialog";
import type { ViewData } from "./use-view-data";

/** The height of a row, which every row has exactly, so that the table renders only what is in view. */
export const ROW_HEIGHT = 36;
const DEFAULT_WIDTH = 180;
const OVERSCAN = 10;

type Line =
  | { readonly kind: "group"; readonly group: ViewGroup }
  | { readonly kind: "record"; readonly record: DerivedRecord };

/** One cell: its value, and for a viewer who may change it, an editor that opens on Enter or a double click. */
function Cell({
  data,
  record,
  property,
  editing,
  width,
}: {
  readonly data: ViewData;
  readonly record: DerivedRecord;
  readonly property: ViewProperty;
  readonly editing: RecordEditing;
  readonly width: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = record.values[property.id];
  const editable = data.canEdit(record, property);
  const save = (next: PropertyValue) => {
    setError(null);
    editing
      .save(record, property, next)
      .then(() => setOpen(false))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "The change was not saved."));
  };
  const shown = (
    <CellValue property={property} value={value} error={record.errors[property.id]} context={data.context} />
  );
  return (
    <td className="overflow-hidden border-r border-border px-2 align-middle" style={{ width, maxWidth: width }}>
      {!editable ? (
        <div className="truncate">{shown}</div>
      ) : property.type === "checkbox" ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label={`${property.name} of ${String(record.values[data.collection.titleProperty] ?? record.id)}`}
            checked={value === true}
            onChange={(event) => save(event.target.checked)}
          />
          {value === true ? "Yes" : "No"}
        </label>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "block h-8 w-full cursor-text truncate rounded-control px-1 text-left hover:bg-surface-muted",
                error !== null && "outline outline-accent",
              )}
              onDoubleClick={() => setOpen(true)}
              data-cell-editor
            >
              <span className="sr-only">
                {`${property.name} of ${String(record.values[data.collection.titleProperty] ?? record.id)}: `}
              </span>
              {shown}
            </button>
          </PopoverTrigger>
          <PopoverContent aria-label={`Change ${property.name}`} align="start">
            <ValueEditor
              property={property}
              value={value}
              context={data.context}
              people={data.people}
              onCancel={() => setOpen(false)}
              onCommit={save}
            />
            {error === null ? null : (
              <p role="alert" className="mt-2 text-xs text-fg-accent">
                {error}
              </p>
            )}
          </PopoverContent>
        </Popover>
      )}
    </td>
  );
}

/** The header of a column: its menu, and the handle that resizes it with the pointer or the arrow keys. */
function ColumnHeader({
  property,
  width,
  index,
  count,
  config,
  onConfig,
  onWidth,
}: {
  readonly property: ViewProperty;
  readonly width: number;
  readonly index: number;
  readonly count: number;
  readonly config: ViewConfig;
  readonly onConfig: (next: ViewConfig) => void;
  readonly onWidth: (width: number, done: boolean) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const sortedBy = (config.sorts ?? []).find((sort) => sort.property === property.id);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // The handle sits in a header that drags to reorder: holding the handle resizes instead, so
    // neither a drag of the header nor a selection of text may begin from it.
    event.preventDefault();
    event.currentTarget.focus();
    start.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const clamp = (value: number) => Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, Math.round(value)));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0;
    if (by === 0) return;
    event.preventDefault();
    onWidth(clamp(width + by), true);
  };
  const move = (by: number) => {
    const ids = [...(config.order ?? [])];
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + by, 0, moved);
    onConfig({ ...config, order: ids });
  };
  return (
    <th
      scope="col"
      aria-sort={sortedBy === undefined ? undefined : sortedBy.direction}
      className="relative border-r border-border px-2 text-left font-medium"
      style={{ width, maxWidth: width }}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/x-view-column", String(index))}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        // Only a header carries a column: anything else dropped here moves nothing.
        const carried = event.dataTransfer.getData("text/x-view-column");
        const from = carried === "" ? Number.NaN : Number(carried);
        if (!Number.isInteger(from) || from === index) return;
        const ids = [...(config.order ?? [])];
        const [moved] = ids.splice(from, 1);
        if (moved !== undefined) ids.splice(index, 0, moved);
        onConfig({ ...config, order: ids });
      }}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate">{property.name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 px-0" aria-label={`Column ${property.name}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => onConfig({ ...config, sorts: [{ property: property.id, direction: "ascending" }] })}
            >
              Sort ascending
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onConfig({ ...config, sorts: [{ property: property.id, direction: "descending" }] })}
            >
              Sort descending
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={index === 0} onSelect={() => move(-1)}>
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => move(1)}>
              Move right
            </DropdownMenuItem>
            {index === 0 ? null : (
              <DropdownMenuItem
                onSelect={() => onConfig({ ...config, hidden: [...new Set([...(config.hidden ?? []), property.id])] })}
              >
                Hide
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a resize handle is a focusable separator, which no native element is */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Width of ${property.name}`}
        aria-valuenow={width}
        aria-valuemin={COLUMN_MIN_WIDTH}
        aria-valuemax={COLUMN_MAX_WIDTH}
        tabIndex={0}
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-border-strong focus-visible:bg-accent"
        onPointerDown={onPointerDown}
        onMouseDown={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          if (start.current !== null) onWidth(clamp(start.current.width + event.clientX - start.current.x), false);
        }}
        onPointerUp={(event) => {
          if (start.current === null) return;
          onWidth(clamp(start.current.width + event.clientX - start.current.x), true);
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        onKeyDown={onKeyDown}
      />
    </th>
  );
}

/** Changes one property of every selected record. */
function BulkEditDialog({
  data,
  properties,
  records,
  onSave,
  onClose,
}: {
  readonly data: ViewData;
  readonly properties: readonly ViewProperty[];
  readonly records: readonly DerivedRecord[];
  readonly onSave: (property: ViewProperty, value: PropertyValue) => Promise<void>;
  readonly onClose: () => void;
}) {
  const editable = properties.filter((property) => records.every((record) => data.canEdit(record, property)));
  const [propertyId, setPropertyId] = useState(editable[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const property = editable.find((candidate) => candidate.id === propertyId);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={`Change ${records.length} ${records.length === 1 ? "record" : "records"}`}>
        {editable.length === 0 ? (
          <p className="mt-4">Your account may not change any property of every selected record.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-1">
              <span className="text-sm font-medium">Property</span>
              <Select aria-label="Property" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
                {editable.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </div>
            {property === undefined ? null : (
              <ValueEditor
                key={property.id}
                property={property}
                value={null}
                context={data.context}
                people={data.people}
                onCancel={onClose}
                onCommit={(value) => {
                  setError(null);
                  onSave(property, value)
                    .then(onClose)
                    .catch((failure: unknown) =>
                      setError(failure instanceof Error ? failure.message : "The changes were not saved."),
                    );
                }}
              />
            )}
            {error === null ? null : (
              <p role="alert" className="text-xs text-fg-accent">
                {error}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface TableViewProps {
  readonly data: ViewData;
  readonly records: readonly DerivedRecord[];
  readonly groups: readonly ViewGroup[] | null;
  readonly properties: readonly ViewProperty[];
  readonly config: ViewConfig;
  readonly onConfig: (next: ViewConfig) => void;
  readonly editing: RecordEditing;
  /** Saves one value for many records at once. */
  readonly onBulkSave: (
    records: readonly DerivedRecord[],
    property: ViewProperty,
    value: PropertyValue,
  ) => Promise<void>;
  /** Archives rows of a database, where the viewer may. */
  readonly onArchive: ((records: readonly DerivedRecord[]) => Promise<void>) | null;
  readonly height: number;
  readonly caption: string;
}

export function TableView({
  data,
  records,
  groups,
  properties,
  config,
  onConfig,
  editing,
  onBulkSave,
  onArchive,
  height,
  caption,
}: TableViewProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const [dragWidths, setDragWidths] = useState<Readonly<Record<string, number>>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const lines = useMemo((): Line[] => {
    if (groups === null) return records.map((record) => ({ kind: "record", record }));
    return groups.flatMap((group): Line[] => [
      { kind: "group", group },
      ...(group.collapsed ? [] : group.records.map((record): Line => ({ kind: "record", record }))),
    ]);
  }, [records, groups]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(lines.length - 1, first + Math.ceil(height / ROW_HEIGHT) + 2 * OVERSCAN);
  const shown = lines.slice(first, last + 1);
  const widthOf = (property: ViewProperty) => dragWidths[property.id] ?? config.widths?.[property.id] ?? DEFAULT_WIDTH;
  const ordered = properties.map((property) => property.id);
  const selectedRecords = records.filter((record) => selected.has(record.id));
  const allSelected = records.length > 0 && selectedRecords.length === records.length;

  const toggleGroup = (group: ViewGroup) => {
    const grouping = config.group;
    if (grouping === null || grouping === undefined) return;
    const collapsed = new Set(grouping.collapsed);
    if (collapsed.has(group.key)) collapsed.delete(group.key);
    else collapsed.add(group.key);
    onConfig({ ...config, group: { ...grouping, collapsed: [...collapsed] } });
  };

  const totalWidth = 44 + properties.reduce((sum, property) => sum + widthOf(property), 0);
  return (
    <div className="grid gap-2">
      {selected.size > 0 ? (
        <section
          className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface-muted p-2"
          aria-label="Selected records"
        >
          <span>{selectedRecords.length} selected</span>
          <Button size="sm" onClick={() => setBulk(true)}>
            Change a property
          </Button>
          {onArchive === null ? null : (
            <Button
              size="sm"
              onClick={() => {
                setFailure(null);
                onArchive(selectedRecords)
                  .then(() => setSelected(new Set()))
                  .catch((error: unknown) =>
                    setFailure(error instanceof Error ? error.message : "The rows were not archived."),
                  );
              }}
            >
              Archive
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear the selection
          </Button>
          {failure === null ? null : (
            <p role="alert" className="text-xs text-fg-accent">
              {failure}
            </p>
          )}
        </section>
      ) : null}
      <div
        className="relative overflow-auto rounded-tile border border-border bg-surface"
        style={{ height }}
        onScroll={(event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)}
        data-testid="view-table"
      >
        <table
          aria-label={caption}
          aria-rowcount={lines.length + 1}
          className="table-fixed border-collapse text-sm"
          style={{ width: totalWidth }}
        >
          <thead className="sticky top-0 z-10 bg-surface-muted text-fg-secondary">
            <tr className="border-b border-border" style={{ height: ROW_HEIGHT }}>
              <th scope="col" className="w-11 border-r border-border px-2">
                <input
                  type="checkbox"
                  aria-label="Select every record shown"
                  checked={allSelected}
                  onChange={(event) =>
                    setSelected(event.target.checked ? new Set(records.map((record) => record.id)) : new Set())
                  }
                />
              </th>
              {properties.map((property, index) => (
                <ColumnHeader
                  key={property.id}
                  property={property}
                  width={widthOf(property)}
                  index={index}
                  count={properties.length}
                  config={{ ...config, order: ordered }}
                  onConfig={onConfig}
                  onWidth={(width, done) => {
                    if (done) {
                      setDragWidths({});
                      onConfig({ ...config, widths: { ...(config.widths ?? {}), [property.id]: width } });
                    } else {
                      setDragWidths({ [property.id]: width });
                    }
                  }}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 ? (
              // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the spacer row is not focusable; it only holds the height of the rows that are not rendered
              <tr aria-hidden="true">
                <td colSpan={properties.length + 1} style={{ height: first * ROW_HEIGHT, padding: 0 }} />
              </tr>
            ) : null}
            {shown.map((line, offset) =>
              line.kind === "group" ? (
                <tr
                  key={`group-${line.group.key}`}
                  aria-rowindex={first + offset + 2}
                  className="border-b border-border bg-surface-muted"
                  style={{ height: ROW_HEIGHT }}
                >
                  <td colSpan={properties.length + 1} className="px-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={!line.group.collapsed}
                      onClick={() => toggleGroup(line.group)}
                    >
                      {line.group.collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                      {line.group.label}
                      <span className="text-fg-muted">{line.group.records.length}</span>
                    </Button>
                  </td>
                </tr>
              ) : (
                <tr
                  key={line.record.id}
                  aria-rowindex={first + offset + 2}
                  className={cn("border-b border-border", selected.has(line.record.id) && "bg-surface-accent")}
                  style={{ height: ROW_HEIGHT }}
                  data-record-id={line.record.id}
                >
                  <td className="w-11 border-r border-border px-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${String(line.record.values[data.collection.titleProperty] ?? line.record.id)}`}
                      checked={selected.has(line.record.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(line.record.id);
                        else next.delete(line.record.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  {properties.map((property) => (
                    <Cell
                      key={property.id}
                      data={data}
                      record={line.record}
                      property={property}
                      editing={editing}
                      width={widthOf(property)}
                    />
                  ))}
                </tr>
              ),
            )}
            {last < lines.length - 1 ? (
              // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the spacer row is not focusable; it only holds the height of the rows that are not rendered
              <tr aria-hidden="true">
                <td
                  colSpan={properties.length + 1}
                  style={{ height: (lines.length - 1 - last) * ROW_HEIGHT, padding: 0 }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {bulk ? (
        <BulkEditDialog
          data={data}
          properties={data.collection.properties}
          records={selectedRecords}
          onClose={() => setBulk(false)}
          onSave={(property, value) => onBulkSave(selectedRecords, property, value)}
        />
      ) : null}
    </div>
  );
}
