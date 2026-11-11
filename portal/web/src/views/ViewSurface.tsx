// A view of a collection (D-011): its toolbar, the layout of its type, and its saved views. The
// engine of the shared package computes what is shown from the documents the viewer may load,
// so a view of participations on a dashboard, on a replication and on a laboratory shows the
// same documents, and an edit in one reaches the others through the shared listeners.
import {
  CORE_SOURCES,
  computeView,
  type DerivedRecord,
  isCoreSourceKey,
  type PropertyValue,
  saveViewContract,
  type ViewConfig,
  type ViewProperty,
  type ViewScope,
  viewConfigSchema,
  viewScopeSchema,
  visibleProperties,
} from "@eegml/shared";
import { Columns3, Filter, Group, Layers, Plus, Search, Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { CallableError, callFunction, deleteView, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import type { Viewer } from "@/registry/viewer";
import { BoardView, CalendarView, GalleryView, ListView, TimelineView } from "./layouts";
import { PropertyDialog } from "./PropertyDialog";
import { RecordDialog, type RecordEditing } from "./RecordDialog";
import { TableView } from "./TableView";
import { FilterEditor, GroupingEditor, PropertiesEditor, SortEditor } from "./toolbar";
import { useViewData, type ViewData } from "./use-view-data";
import { type RecordChange, saveRecordChanges, saveTaskValues } from "./writes";

export const VIEW_TYPES = ["table", "list", "board", "calendar", "timeline", "gallery"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const VIEW_TYPE_LABELS: Readonly<Record<ViewType, string>> = {
  table: "Table",
  list: "List",
  board: "Board",
  calendar: "Calendar",
  timeline: "Timeline",
  gallery: "Gallery",
};

/** What a view shows, as it is held while a person works with it and as a saved view stores it. */
export interface ViewSettings {
  readonly type: ViewType;
  readonly config: ViewConfig;
}

export interface ViewSurfaceProps {
  readonly collectionKey: string;
  readonly viewer: Viewer;
  readonly secondFactor: boolean;
  readonly settings: ViewSettings;
  /** Called whenever the view changes, for a holder that keeps it, such as a linked view block. */
  readonly onSettings: (settings: ViewSettings) => void;
  /** A fixed condition, such as one replication, which the toolbar does not offer to change. */
  readonly scope: ViewScope | null;
  /** The saved view the settings came from, if any. */
  readonly viewId: string | null;
  readonly onViewId: (viewId: string | null) => void;
  /** Names the view for assistive technology. */
  readonly caption: string;
  /** The height of the scrolling region of a table, in pixels. */
  readonly height?: number;
  /** Leaves out the saved views, for a widget that has a configuration of its own. */
  readonly compact?: boolean;
  /** The page a view saved from here belongs to. */
  readonly pageId?: string | null;
  /**
   * Opens a record in place of the dialog of record values, where the record has a page of its
   * own. A task opens in its own panel whatever holds the view: without this, the view goes to
   * the task on the page of tasks.
   */
  readonly onOpenRecord?: (record: DerivedRecord) => void;
}

/** Saves values of records and reports a failure in words. */
function editingFor(collectionKey: string): RecordEditing & {
  readonly saveMany: (records: readonly DerivedRecord[], property: ViewProperty, value: PropertyValue) => Promise<void>;
} {
  const changeOf = (record: DerivedRecord, property: ViewProperty, value: PropertyValue): RecordChange =>
    property.source === "title"
      ? { recordId: record.id, title: typeof value === "string" && value !== "" ? value : "Untitled", values: {} }
      : { recordId: record.id, values: { [property.id]: value } };
  const failed = (failure: unknown) =>
    new Error(failure instanceof CallableError ? failure.message : "The change was not saved.");
  const run = async (changes: RecordChange[]) => {
    try {
      await saveRecordChanges(collectionKey, changes);
    } catch (failure) {
      throw failed(failure);
    }
  };
  if (collectionKey === "core:tasks") {
    // A task changes through the functions of tasks, which keep its history and its tree.
    const saveTasks = async (records: readonly DerivedRecord[], property: ViewProperty, value: PropertyValue) => {
      try {
        await saveTaskValues(records, property.id, value);
      } catch (failure) {
        throw failure instanceof CallableError ? failed(failure) : failure;
      }
    };
    return { save: (record, property, value) => saveTasks([record], property, value), saveMany: saveTasks };
  }
  return {
    save: (record, property, value) => run([changeOf(record, property, value)]),
    saveMany: (records, property, value) => run(records.map((record) => changeOf(record, property, value))),
  };
}

/** The properties a person defined, which may be changed: every one of a database but its title, and the custom ones of a core collection. */
function definedProperties(data: ViewData): readonly ViewProperty[] {
  const key = data.collection.key;
  if (!isCoreSourceKey(key)) return data.collection.properties.filter((property) => property.source !== "title");
  const builtIn = new Set(
    CORE_SOURCES[key].fields({ laboratoryName: () => null, replicationStatuses: [] }).map((field) => field.id),
  );
  return data.collection.properties.filter((property) => !builtIn.has(property.id));
}

function ToolbarPopover({
  label,
  icon,
  active,
  children,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={active ? "outline" : "ghost"} aria-label={label}>
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={label} align="start" className="w-[min(40rem,calc(100vw-2rem))]">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** The saved views of a collection: the viewer's own and those shared with every member. */
function SavedViews({
  collectionKey,
  viewer,
  settings,
  scope,
  viewId,
  onViewId,
  onSettings,
  pageId,
}: Pick<
  ViewSurfaceProps,
  "collectionKey" | "viewer" | "settings" | "scope" | "viewId" | "onViewId" | "onSettings" | "pageId"
>) {
  const own = useLiveQuery({
    collection: "views",
    within: [],
    where: [
      ["collectionKey", "==", collectionKey],
      ["ownerUid", "==", viewer.uid],
    ],
    limit: 200,
  });
  const shared = useLiveQuery({
    collection: "views",
    within: [],
    where: [
      ["collectionKey", "==", collectionKey],
      ["isShared", "==", true],
    ],
    limit: 200,
  });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadingViews = own.status === "loading" || shared.status === "loading";
  const views = useMemo(() => {
    const all = new Map<string, RecordOf<"views">>();
    for (const list of [own, shared]) if (list.status === "ready") for (const view of list.data) all.set(view.id, view);
    return [...all.values()]
      .filter((view) => view.archivedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  }, [own, shared]);
  const current = views.find((view) => view.id === viewId) ?? null;
  const mayChange = current !== null && (current.ownerUid === viewer.uid || (current.isShared && viewer.staff));

  const open = (id: string) => {
    const view = views.find((candidate) => candidate.id === id);
    onViewId(view?.id ?? null);
    if (view === undefined) return;
    const config = viewConfigSchema.safeParse(view.config);
    onSettings({ type: view.type, config: config.success ? config.data : {} });
  };
  const save = async (asNew: boolean, isShared: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { viewId: saved } = await callFunction(saveViewContract, {
        ...(asNew || current === null ? {} : { viewId: current.id }),
        collectionKey,
        name: asNew || current === null ? name.trim() : current.name,
        type: settings.type,
        config: settings.config,
        scope,
        isShared,
        pageId: asNew || current === null ? (pageId ?? null) : current.pageId,
      });
      onViewId(saved);
      setName("");
    } catch (failure) {
      setError(failure instanceof CallableError ? failure.message : "The view was not saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="text-sm font-medium">Saved view</span>
        <Select
          aria-label="Saved view"
          aria-busy={loadingViews}
          disabled={loadingViews}
          value={viewId ?? ""}
          onChange={(event) => open(event.target.value)}
        >
          <option value="">{loadingViews ? "Loading the saved views" : "Not saved"}</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
              {view.isShared ? " (shared)" : " (yours)"}
            </option>
          ))}
        </Select>
      </div>
      {current !== null && mayChange ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void save(false, current.isShared)}>
            Save changes to {current.name}
          </Button>
          {current.ownerUid === viewer.uid || viewer.staff ? (
            <Button size="sm" disabled={busy} onClick={() => void save(false, !current.isShared)}>
              {current.isShared ? "Stop sharing" : "Share with every member"}
            </Button>
          ) : null}
          {current.ownerUid === viewer.uid ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                deleteView(current.id)
                  .then(() => onViewId(null))
                  .catch(() => setError("The view was not deleted."));
              }}
            >
              Delete the view
            </Button>
          ) : null}
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() !== "") void save(true, false);
        }}
      >
        <div className="grid flex-1 gap-1">
          <span className="text-sm font-medium">Save as a new view</span>
          <Input
            aria-label="Name of the new view"
            value={name}
            placeholder="Name of the view"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
          Save
        </Button>
      </form>
      <p className="text-xs text-fg-muted">A new view is yours alone until you share it.</p>
      {error === null ? null : (
        <p role="alert" className="text-xs text-fg-accent">
          {error}
        </p>
      )}
    </div>
  );
}

function Surface(props: ViewSurfaceProps & { readonly data: ViewData }) {
  const { data, settings, onSettings, scope, caption, onOpenRecord } = props;
  const { config, type } = settings;
  const [open, setOpen] = useState<DerivedRecord | null>(null);
  const [property, setProperty] = useState<ViewProperty | null | "new">(null);
  const [adding, setAdding] = useState<string | null>(null);
  const result = useMemo(() => computeView(data.collection, config, scope, data.context), [data, config, scope]);
  const properties = useMemo(() => visibleProperties(data.collection, config), [data.collection, config]);
  const editing = useMemo(() => editingFor(data.collection.key), [data.collection.key]);
  const setConfig = (next: ViewConfig) => onSettings({ type, config: next });
  // A record that is open follows its document, so the dialog shows what was saved.
  const current = open === null ? null : (result.records.find((record) => record.id === open.id) ?? open);
  const filterable = data.collection.properties.filter(
    (candidate) => scope === null || candidate.id !== scope.property,
  );
  const filtered = config.filter !== null && config.filter !== undefined;

  const layoutProps = {
    data,
    records: result.records,
    properties,
    config,
    onConfig: setConfig,
    editing,
    onOpen: (record: DerivedRecord) => {
      if (onOpenRecord !== undefined) onOpenRecord(record);
      // A view can be drawn outside the router, in a block of a page, so it goes there by the address.
      else if (data.collection.key === "core:tasks")
        window.location.hash = `#/tasks?task=${encodeURIComponent(record.id)}`;
      else setOpen(record);
    },
    caption,
  };
  let body: ReactNode;
  if (result.records.length === 0) {
    body = (
      <EmptyState
        title={result.total === 0 ? "Nothing here yet" : "No record matches"}
        description={
          result.total === 0
            ? data.canAddRows
              ? "Add the first row with New row."
              : "Records appear here as soon as there are any that your account may read."
            : "Change the search or the filter to see more."
        }
      />
    );
  } else if (type === "table") {
    body = (
      <TableView
        {...layoutProps}
        groups={result.groups}
        height={props.height ?? 480}
        onBulkSave={editing.saveMany}
        onArchive={
          data.canAddRows
            ? async (records) => {
                try {
                  await saveRecordChanges(
                    data.collection.key,
                    [],
                    records.map((record) => record.id),
                  );
                } catch (failure) {
                  throw new Error(failure instanceof CallableError ? failure.message : "The rows were not archived.");
                }
              }
            : null
        }
      />
    );
  } else if (type === "list") body = <ListView {...layoutProps} />;
  else if (type === "gallery") body = <GalleryView {...layoutProps} />;
  else if (type === "board") body = <BoardView {...layoutProps} />;
  else if (type === "calendar") body = <CalendarView {...layoutProps} />;
  else body = <TimelineView {...layoutProps} />;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-testid="view-surface" data-view-type={type}>
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={`View settings of ${caption}`}>
        <div className="flex items-center gap-2">
          <span className="sr-only">Show as</span>
          <Select
            className="h-8.5 w-auto"
            aria-label="Show as"
            value={type}
            onChange={(event) => onSettings({ type: event.target.value as ViewType, config })}
          >
            {VIEW_TYPES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {VIEW_TYPE_LABELS[candidate]}
              </option>
            ))}
          </Select>
        </div>
        <div className="relative flex items-center">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 size-4 text-fg-muted"
            strokeWidth={1.8}
          />
          <Input
            className="h-8.5 w-44 pl-8"
            aria-label="Search the records"
            placeholder="Search"
            value={config.search ?? ""}
            onChange={(event) => setConfig({ ...config, search: event.target.value })}
          />
        </div>
        <ToolbarPopover
          label={filtered ? "Filter (on)" : "Filter"}
          icon={<Filter aria-hidden="true" />}
          active={filtered}
        >
          <FilterEditor
            config={config}
            properties={filterable}
            onChange={(filter) => setConfig({ ...config, filter })}
          />
        </ToolbarPopover>
        <ToolbarPopover label="Sort" icon={<Layers aria-hidden="true" />} active={(config.sorts ?? []).length > 0}>
          <SortEditor
            config={config}
            properties={data.collection.properties}
            onChange={(sorts) => setConfig({ ...config, sorts })}
          />
        </ToolbarPopover>
        <ToolbarPopover
          label="Group"
          icon={<Group aria-hidden="true" />}
          active={config.group !== null && config.group !== undefined}
        >
          <GroupingEditor
            config={config}
            properties={data.collection.properties}
            onChange={(group) => setConfig({ ...config, group })}
          />
        </ToolbarPopover>
        <ToolbarPopover
          label="Properties"
          icon={<Columns3 aria-hidden="true" />}
          active={(config.hidden ?? []).length > 0}
        >
          <PropertiesEditor
            config={config}
            properties={data.collection.properties}
            titleProperty={data.collection.titleProperty}
            onChange={(next) => setConfig({ ...config, ...next })}
          />
          {data.canManageProperties ? (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <Button size="sm" onClick={() => setProperty("new")}>
                <Plus aria-hidden="true" />
                Add a property
              </Button>
              <Select
                className="h-8.5 w-auto"
                aria-label="Change a property"
                value=""
                onChange={(event) =>
                  setProperty(
                    data.collection.properties.find((candidate) => candidate.id === event.target.value) ?? null,
                  )
                }
              >
                <option value="">Change a property</option>
                {definedProperties(data).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </ToolbarPopover>
        {props.compact === true ? null : (
          <ToolbarPopover label="Views" icon={<Settings2 aria-hidden="true" />} active={props.viewId !== null}>
            <SavedViews {...props} />
          </ToolbarPopover>
        )}
        {data.canAddRows ? (
          <form
            className="ml-auto flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              const title = adding?.trim() ?? "";
              saveRecordChanges(data.collection.key, [{ title: title === "" ? "Untitled" : title, values: {} }])
                .then(() => setAdding(null))
                .catch(() => setAdding(title));
            }}
          >
            {adding === null ? (
              <Button size="sm" variant="primary" onClick={() => setAdding("")}>
                <Plus aria-hidden="true" />
                New row
              </Button>
            ) : (
              <>
                <Input
                  className="h-8.5 w-48"
                  aria-label="Name of the new row"
                  autoFocus
                  value={adding}
                  onChange={(event) => setAdding(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setAdding(null);
                  }}
                />
                <Button size="sm" type="submit" variant="primary">
                  Add
                </Button>
              </>
            )}
          </form>
        ) : null}
      </div>
      <p className="text-xs text-fg-muted" aria-live="polite">
        {result.records.length === result.total
          ? `${result.total} ${result.total === 1 ? "record" : "records"}`
          : `${result.records.length} of ${result.total} records`}
        {data.truncated ? ". Some records could not be loaded: narrow the view." : ""}
      </p>
      {body}
      <RecordDialog
        data={data}
        record={current}
        properties={data.collection.properties}
        editing={editing}
        onClose={() => setOpen(null)}
      />
      {property === null ? null : (
        <PropertyDialog data={data} property={property === "new" ? null : property} onClose={() => setProperty(null)} />
      )}
    </div>
  );
}

export function ViewSurface(props: ViewSurfaceProps) {
  const live = useViewData(props.collectionKey, props.viewer, props.secondFactor);
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the view"
      errorTitle="The view could not be loaded"
      onRetry={retryFailedLiveData}
    >
      {(data) => <Surface {...props} data={data} />}
    </LiveView>
  );
}

/** The settings a stored configuration gives, or a plain table where it no longer parses. */
export function settingsOf(type: string, config: unknown): ViewSettings {
  const parsed = viewConfigSchema.safeParse(config);
  return {
    type: (VIEW_TYPES as readonly string[]).includes(type) ? (type as ViewType) : "table",
    config: parsed.success ? parsed.data : {},
  };
}

/** A fixed scope as a view or a widget stores it, or null. */
export function scopeOf(stored: unknown): ViewScope | null {
  const parsed = viewScopeSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/** Keeps the settings of a view in state, starting from what a holder gives. */
export function useViewSettings(initial: ViewSettings): [ViewSettings, (next: ViewSettings) => void] {
  const [settings, setSettings] = useState(initial);
  const key = JSON.stringify(initial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the settings start again only when what the holder gives changes
  useEffect(() => setSettings(initial), [key]);
  return [settings, setSettings];
}
