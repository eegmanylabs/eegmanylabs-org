// A dashboard: a grid of twelve columns on which widgets are placed, moved and resized with the
// pointer or with the keyboard. Each change of the layout is saved through the function that
// checks every widget, and the widgets that did not change are left alone, so that two people
// who arrange different widgets at once both keep their change.
import {
  CORE_SOURCE_KEYS,
  CORE_SOURCES,
  type DashboardWidget,
  dashboardWidgetInputSchema,
  GRID_COLUMNS,
  moveWidget,
  nextPlacement,
  type Placement,
  placeWidget,
  resizeWidget,
  saveDashboardContract,
} from "@eegml/shared";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CallableError, callFunction, type RecordOf, useLiveQuery } from "@/data";
import type { Viewer } from "@/registry/viewer";
import { cn } from "@/utils/cn";
import { WidgetBody } from "./widgets";

/** The height of one row of the grid, in pixels. */
const ROW = 88;

/** Whether the viewer may change a dashboard, as the function that saves it decides. */
export function mayArrange(viewer: Viewer, dashboard: RecordOf<"dashboards">): boolean {
  switch (dashboard.scopeType) {
    case "user":
      return dashboard.ownerUid === viewer.uid;
    case "programme":
      return viewer.can("pages.manage", "programme");
    case "replication":
      return viewer.can("pages.manage", { replicationId: dashboard.scopeId });
    case "laboratory":
      return viewer.can("pages.manage", { laboratoryId: dashboard.scopeId });
    case "group":
      return false;
  }
}

/** The widgets of a stored dashboard that its schema accepts, in reading order. */
function widgetsOf(dashboard: RecordOf<"dashboards">): [string, DashboardWidget][] {
  return Object.entries(dashboard.widgets)
    .flatMap(([id, stored]): [string, DashboardWidget][] => {
      const parsed = dashboardWidgetInputSchema.safeParse(stored);
      return parsed.success ? [[id, parsed.data]] : [];
    })
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x);
}

type WidgetKind = "view" | "kpi" | "chart" | "activity" | "note";

const KIND_LABELS: Readonly<Record<WidgetKind, string>> = {
  view: "A view of records",
  kpi: "A figure",
  chart: "A chart",
  activity: "Recent activity",
  note: "A note",
};

/** Builds a new widget from what a person chose, at the place given. */
function newWidget(
  kind: WidgetKind,
  title: string,
  collectionKey: string,
  text: string,
  place: Placement,
): DashboardWidget {
  const position = { x: place.x, y: place.y, w: place.w, h: place.h };
  switch (kind) {
    case "view":
      return { type: "view", config: { title, collectionKey, type: "table", config: {}, scope: null }, ...position };
    case "kpi":
      return {
        type: "kpi",
        config: { title, collectionKey, config: {}, scope: null, measure: { kind: "count" } },
        ...position,
      };
    case "chart":
      return {
        type: "chart",
        config: {
          title,
          collectionKey,
          config: {},
          scope: null,
          groupBy: collectionKey === "core:participations" ? "status" : "title",
          measure: { kind: "count" },
        },
        ...position,
      };
    case "activity":
      return { type: "activity", config: { title, limit: 10 }, ...position };
    case "note":
      return { type: "note", config: { title, text }, ...position };
  }
}

/**
 * The collections a widget may show: the core sources, and the databases the viewer reads, as the
 * linked view of a page offers them.
 */
function useWidgetSources(viewer: Viewer): readonly { readonly key: string; readonly label: string }[] {
  const databases = useLiveQuery({
    collection: "databases",
    within: [],
    ...(viewer.staff ? {} : { where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]] as const }),
    limit: 1_000,
  });
  return useMemo(
    () => [
      ...CORE_SOURCE_KEYS.filter((key) => CORE_SOURCES[key].selectable).map((key) => ({
        key,
        label: CORE_SOURCES[key].label,
      })),
      ...(databases.status === "ready"
        ? databases.data
            .filter((database) => database.archivedAt === null)
            .map((database) => ({ key: `db:${database.id}`, label: database.name }))
            .sort((a, b) => a.label.localeCompare(b.label, "en-GB"))
        : []),
    ],
    [databases],
  );
}

function AddWidgetDialog({
  viewer,
  layout,
  onAdd,
  onClose,
}: {
  readonly viewer: Viewer;
  readonly layout: readonly Placement[];
  readonly onAdd: (id: string, widget: DashboardWidget) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [kind, setKind] = useState<WidgetKind>("view");
  const [title, setTitle] = useState("");
  const [collectionKey, setCollectionKey] = useState("core:participations");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sources = useWidgetSources(viewer);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "") {
      setError("Give the widget a title.");
      return;
    }
    const id = `w${Date.now().toString(36)}`;
    const size = kind === "kpi" ? [3, 2] : kind === "view" ? [12, 5] : [6, 4];
    const place = nextPlacement(layout, id, size[0] ?? 6, size[1] ?? 4);
    onAdd(id, newWidget(kind, title.trim(), collectionKey, text, place))
      .then(onClose)
      .catch((failure: unknown) =>
        setError(failure instanceof CallableError ? failure.message : "The widget was not added."),
      );
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title="Add a widget">
        <form className="mt-4 grid gap-4" onSubmit={submit}>
          <FormField label="Kind">
            {(control) => (
              <Select {...control} value={kind} onChange={(event) => setKind(event.target.value as WidgetKind)}>
                {(Object.keys(KIND_LABELS) as WidgetKind[]).map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {KIND_LABELS[candidate]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Title">
            {(control) => <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} />}
          </FormField>
          {kind === "view" || kind === "kpi" || kind === "chart" ? (
            <FormField label="Records" hint="The widget's own view of them is set on the dashboard.">
              {(control) => (
                <Select {...control} value={collectionKey} onChange={(event) => setCollectionKey(event.target.value)}>
                  {sources.map((source) => (
                    <option key={source.key} value={source.key}>
                      {source.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {kind === "note" ? (
            <FormField label="Text">
              {(control) => (
                <Textarea {...control} rows={4} value={text} onChange={(event) => setText(event.target.value)} />
              )}
            </FormField>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="text-sm text-fg-accent">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="justify-self-end">
            Add the widget
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DashboardView({
  dashboard,
  viewer,
  secondFactor,
}: {
  readonly dashboard: RecordOf<"dashboards">;
  readonly viewer: Viewer;
  readonly secondFactor: boolean;
}) {
  const editable = mayArrange(viewer, dashboard);
  const stored = useMemo(() => widgetsOf(dashboard), [dashboard]);
  // The layout while a person arranges it, before the stored dashboard has caught up.
  const [draft, setDraft] = useState<readonly Placement[] | null>(null);
  const [arranging, setArranging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // What the keyboard did, and whether the change has been saved, for assistive technology.
  const [placement, setPlacement] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; mode: "move" | "resize"; base: readonly Placement[] } | null>(
    null,
  );

  const layout: readonly Placement[] =
    draft ?? stored.map(([id, widget]) => ({ id, x: widget.x, y: widget.y, w: widget.w, h: widget.h }));
  const placeOf = (id: string) => layout.find((placement) => placement.id === id);

  const save = async (changes: Record<string, DashboardWidget | null>) => {
    setStatus("Saving");
    try {
      await callFunction(saveDashboardContract, { dashboardId: dashboard.id, widgets: changes });
      setStatus("Saved");
    } catch (failure) {
      setDraft(null);
      setStatus(failure instanceof CallableError ? failure.message : "The dashboard was not saved.");
      throw failure;
    }
  };

  // The arranged layout stays on screen until the stored dashboard has caught up with it.
  const storedKey = JSON.stringify(stored.map(([id, widget]) => [id, widget.x, widget.y, widget.w, widget.h]));
  useEffect(() => {
    if (draft === null) return;
    const placed = JSON.parse(storedKey) as [string, number, number, number, number][];
    const same = draft.every((placement) =>
      placed.some(
        ([id, x, y, w, h]) =>
          id === placement.id && x === placement.x && y === placement.y && w === placement.w && h === placement.h,
      ),
    );
    if (same && drag.current === null) setDraft(null);
  }, [storedKey, draft]);

  /** Saves the widgets whose place a new layout changed. */
  const commit = (next: readonly Placement[]) => {
    setDraft(next);
    const changes: Record<string, DashboardWidget> = {};
    for (const placement of next) {
      const widget = stored.find(([id]) => id === placement.id)?.[1];
      if (widget === undefined) continue;
      if (
        widget.x !== placement.x ||
        widget.y !== placement.y ||
        widget.w !== placement.w ||
        widget.h !== placement.h
      ) {
        changes[placement.id] = { ...widget, x: placement.x, y: placement.y, w: placement.w, h: placement.h };
      }
    }
    if (Object.keys(changes).length > 0) save(changes).catch(() => undefined);
    else setDraft(null);
  };

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, id: string, title: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setArranging(arranging === id ? null : id);
      setStatus("");
      setPlacement(
        arranging === id
          ? `${title} placed.`
          : `Arranging ${title}. Arrow keys move it, Shift and the arrow keys resize it, Escape ends.`,
      );
      return;
    }
    if (arranging !== id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setArranging(null);
      setPlacement(`${title} placed.`);
      return;
    }
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = event.shiftKey
      ? resizeWidget(layout, id, delta[0], delta[1])
      : moveWidget(layout, id, delta[0], delta[1]);
    const placed = next.find((placement) => placement.id === id);
    if (placed !== undefined) {
      setPlacement(`${title}: column ${placed.x + 1}, row ${placed.y + 1}, ${placed.w} wide and ${placed.h} high.`);
    }
    commit(next);
  };

  const cellOf = (event: PointerEvent) => {
    const box = grid.current?.getBoundingClientRect();
    const width = (box?.width ?? 1) / GRID_COLUMNS;
    return {
      x: Math.round((event.clientX - (drag.current?.x ?? 0)) / width),
      y: Math.round((event.clientY - (drag.current?.y ?? 0)) / ROW),
    };
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>, id: string, mode: "move" | "resize") => {
    if (event.button !== 0) return;
    drag.current = { id, x: event.clientX, y: event.clientY, mode, base: layout };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (current === null) return;
    const { x, y } = cellOf(event);
    const origin = current.base.find((placement) => placement.id === current.id);
    if (origin === undefined) return;
    setDraft(
      current.mode === "move"
        ? placeWidget(current.base, current.id, origin.x + x, origin.y + y)
        : resizeWidget(current.base, current.id, x, y),
    );
  };
  const onPointerUp = () => {
    if (drag.current === null) return;
    drag.current = null;
    if (draft !== null) commit(draft);
  };

  // The handle of the widget being arranged keeps the focus when the widget moves in the page.
  useEffect(() => {
    if (arranging === null) return;
    const handle = grid.current?.querySelector<HTMLButtonElement>(`[data-arrange-handle="${arranging}"]`);
    if (handle !== null && handle !== undefined && document.activeElement !== handle) handle.focus();
  });

  const ordered = [...stored].sort(([a], [b]) => {
    const left = placeOf(a);
    const right = placeOf(b);
    return (left?.y ?? 0) - (right?.y ?? 0) || (left?.x ?? 0) - (right?.x ?? 0);
  });

  return (
    <div className="grid gap-3">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add a widget
          </Button>
          <p className="text-xs text-fg-muted">
            To rearrange a widget, focus its handle and press Enter, then use the arrow keys to move it and Shift with
            the arrow keys to resize it.
          </p>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="text-xs text-fg-muted" data-testid="dashboard-status">
        {[placement, status].filter((part) => part !== "").join(" ")}
      </p>
      {ordered.length === 0 ? (
        <EmptyState
          title="This dashboard has no widgets"
          description={editable ? "Add a widget to start." : "Those who manage it have not added any yet."}
        />
      ) : (
        <div
          ref={grid}
          className="grid grid-cols-1 gap-3 sm:grid-cols-12"
          style={{ gridAutoRows: `${ROW - 12}px` }}
          data-testid="dashboard-grid"
        >
          {ordered.map(([id, widget]) => {
            const place = placeOf(id) ?? widget;
            const title = widget.config.title;
            return (
              <section
                key={id}
                aria-label={title}
                data-widget-id={id}
                data-place={`${place.x},${place.y},${place.w},${place.h}`}
                className={cn(
                  "flex min-h-0 flex-col overflow-hidden rounded-tile border border-border bg-surface sm:[grid-column:var(--column)] sm:[grid-row:var(--row)]",
                  arranging === id && "border-accent",
                )}
                style={
                  {
                    "--column": `${place.x + 1} / span ${place.w}`,
                    "--row": `${place.y + 1} / span ${place.h}`,
                    gridRow: `span ${place.h}`,
                  } as React.CSSProperties
                }
              >
                <header className="flex items-center gap-1 border-b border-border px-2 py-1">
                  {editable ? (
                    <button
                      type="button"
                      className="flex h-7 w-7 cursor-grab items-center justify-center rounded-control hover:bg-surface-muted"
                      aria-label={`Rearrange ${title}`}
                      aria-pressed={arranging === id}
                      onKeyDown={(event) => onHandleKey(event, id, title)}
                      data-arrange-handle={id}
                      onBlur={(event) => {
                        // Moving the widget moves its element, which takes the focus away with no new
                        // target: arranging ends only when the person moves the focus elsewhere.
                        if (event.relatedTarget !== null) setArranging((current) => (current === id ? null : current));
                      }}
                      onPointerDown={(event) => onPointerDown(event, id, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                    >
                      <GripVertical aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                  <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${title}`}
                      onClick={() => save({ [id]: null }).catch(() => undefined)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </header>
                <div
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a widget that scrolls must be reachable by keyboard
                  tabIndex={0}
                  className="min-h-0 flex-1 overflow-auto p-3 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <WidgetBody
                    widget={widget}
                    viewer={viewer}
                    scope={dashboard}
                    secondFactor={secondFactor}
                    onChange={editable ? (next) => save({ [id]: next }).catch(() => undefined) : null}
                  />
                </div>
                {editable ? (
                  <div
                    aria-hidden="true"
                    className="h-2 cursor-ns-resize self-stretch hover:bg-border"
                    onPointerDown={(event) => onPointerDown(event, id, "resize")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      )}
      {adding ? (
        <AddWidgetDialog
          viewer={viewer}
          layout={layout}
          onClose={() => setAdding(false)}
          onAdd={(id, widget) => save({ [id]: widget })}
        />
      ) : null}
    </div>
  );
}
