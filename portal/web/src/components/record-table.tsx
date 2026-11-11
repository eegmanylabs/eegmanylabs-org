// A dense table of records that is read and operated by keyboard: Tab enters the table at one
// row, the arrow keys, Home and End move between rows, and Enter opens the row. With
// `rowHeight` and `viewportHeight` it renders only the rows that are in view, so a list of
// thousands of rows scrolls without delay.
import {
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRememberedScroll } from "@/components/remembered-scroll";
import { type SortDirection, SortHeader } from "@/components/ui/sort-header";
import { TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/utils/cn";

export interface RecordColumn<T, K extends string> {
  readonly id: string;
  readonly header: string;
  /** The sort key of the column, where it sorts. */
  readonly sortKey?: K;
  readonly cell: (row: T) => ReactNode;
  readonly className?: string;
}

export interface Virtualisation {
  /** The fixed height of a row, in pixels. Every row has exactly this height. */
  readonly rowHeight: number;
  /** The height of the scrolling region, in pixels. */
  readonly viewportHeight: number;
}

export interface RecordTableProps<T, K extends string> {
  /** Names the table for assistive technology. */
  caption: string;
  rows: readonly T[];
  columns: readonly RecordColumn<T, K>[];
  rowKey: (row: T) => string;
  /** What a row is called, for example its identifier and title. */
  rowLabel: (row: T) => string;
  sortKey: K;
  direction: SortDirection;
  onSort: (key: K) => void;
  /** Opens the row, for example in a side panel. */
  onOpen: (row: T) => void;
  /** The key of the row that is open, which is marked. */
  openKey: string | null;
  virtualise?: Virtualisation;
  /** Rows of the table that are rendered beyond the visible ones, above and below. */
  overscan?: number;
  /** Keeps the scroll position for the address, and puts it back when the list is shown again. */
  rememberScroll?: boolean;
  "data-testid"?: string;
}

/** The first and last index of the rows to render for a scroll position. */
export function visibleWindow(
  scrollTop: number,
  total: number,
  virtualise: Virtualisation | undefined,
  overscan: number,
): { first: number; last: number } {
  if (virtualise === undefined) return { first: 0, last: total - 1 };
  const first = Math.max(0, Math.floor(scrollTop / virtualise.rowHeight) - overscan);
  const visible = Math.ceil(virtualise.viewportHeight / virtualise.rowHeight);
  return { first, last: Math.min(total - 1, first + visible + 2 * overscan) };
}

export function RecordTable<T, K extends string>({
  caption,
  rows,
  columns,
  rowKey,
  rowLabel,
  sortKey,
  direction,
  onSort,
  onOpen,
  openKey,
  virtualise,
  overscan = 8,
  rememberScroll = false,
  "data-testid": testId,
}: RecordTableProps<T, K>) {
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  useRememberedScroll(rememberScroll ? scrollElement : null, rows.length > 0);
  const body = useRef<HTMLTableSectionElement>(null);
  // The row to focus once it is rendered, after a key has moved the focus.
  const pendingFocus = useRef<number | null>(null);

  const activeIndex = Math.min(active, Math.max(0, rows.length - 1));
  const { first, last } = visibleWindow(scrollTop, rows.length, virtualise, overscan);
  const shown = useMemo(() => rows.slice(first, last + 1), [rows, first, last]);

  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    const element = body.current?.querySelector<HTMLTableRowElement>(`tr[data-index="${index}"]`);
    if (element) {
      pendingFocus.current = null;
      element.focus({ preventScroll: virtualise !== undefined });
    }
  });

  const moveTo = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(rows.length - 1, index));
      setActive(target);
      pendingFocus.current = target;
      const region = scroller.current;
      if (virtualise !== undefined && region !== null) {
        // Keep the row in view below the sticky header, which is one row high.
        const top = target * virtualise.rowHeight;
        const bottom = top + virtualise.rowHeight;
        const visibleTop = region.scrollTop;
        const visibleBottom = region.scrollTop + region.clientHeight - virtualise.rowHeight;
        if (top < visibleTop) region.scrollTop = top;
        else if (bottom > visibleBottom) region.scrollTop = bottom - region.clientHeight + virtualise.rowHeight;
        setScrollTop(region.scrollTop);
      }
    },
    [rows.length, virtualise],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number, row: T) => {
    const page =
      virtualise === undefined ? 10 : Math.max(1, Math.floor(virtualise.viewportHeight / virtualise.rowHeight) - 1);
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: rows.length - 1,
      PageDown: index + page,
      PageUp: index - page,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      moveTo(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(row);
    }
  };

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (virtualise !== undefined) setScrollTop(event.currentTarget.scrollTop);
  };

  const spacer = (height: number, key: string) =>
    height > 0 ? (
      // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the spacer row is not focusable; it only holds the height of the rows that are not rendered
      <tr aria-hidden="true" key={key}>
        <td colSpan={columns.length} className="p-0" style={{ height }} />
      </tr>
    ) : null;

  return (
    <div
      ref={(element) => {
        scroller.current = element;
        setScrollElement(element);
      }}
      onScroll={onScroll}
      className="relative overflow-auto rounded-tile border border-border bg-surface"
      style={virtualise === undefined ? undefined : { height: virtualise.viewportHeight }}
      data-testid={testId}
    >
      <table aria-label={caption} aria-rowcount={rows.length + 1} className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface-muted text-micro text-fg-muted">
          <tr aria-rowindex={1} className="h-10 border-b border-border">
            {columns.map((column) =>
              column.sortKey === undefined ? (
                <TableHeaderCell key={column.id} className={column.className}>
                  {column.header}
                </TableHeaderCell>
              ) : (
                <SortHeader
                  key={column.id}
                  direction={column.sortKey === sortKey ? direction : null}
                  onSort={() => onSort(column.sortKey as K)}
                >
                  {column.header}
                </SortHeader>
              ),
            )}
          </tr>
        </thead>
        <tbody ref={body}>
          {virtualise === undefined ? null : spacer(first * virtualise.rowHeight, "before")}
          {shown.map((row, offset) => {
            const index = first + offset;
            const key = rowKey(row);
            const open = key === openKey;
            return (
              <tr
                key={key}
                data-index={index}
                aria-rowindex={index + 2}
                aria-label={rowLabel(row)}
                aria-current={open ? "true" : undefined}
                tabIndex={index === activeIndex ? 0 : -1}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => onKeyDown(event, index, row)}
                onClick={(event) => {
                  // A link inside the row goes where it points; the rest of the row opens it.
                  if ((event.target as HTMLElement).closest("a, button")) return;
                  setActive(index);
                  onOpen(row);
                }}
                className={cn(
                  "cursor-pointer border-b border-border hover:bg-surface-muted",
                  virtualise === undefined ? "h-10" : "overflow-hidden",
                  open && "bg-surface-accent hover:bg-surface-accent",
                )}
                style={virtualise === undefined ? undefined : { height: virtualise.rowHeight }}
              >
                {columns.map((column) => (
                  <td key={column.id} className={cn("px-3 py-1.5 align-middle text-fg", column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
          {virtualise === undefined ? null : spacer((rows.length - 1 - last) * virtualise.rowHeight, "after")}
        </tbody>
      </table>
    </div>
  );
}
