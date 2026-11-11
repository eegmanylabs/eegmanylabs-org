// The linked view block of a page (D-011): a live view of a collection inside the page, from a
// saved view or with a configuration of its own, which the block keeps as JSON text in its props
// so that it travels with the page. The records are never copied into the page: they are the
// documents of the collection, read through the same listeners as every other view.
import { CORE_SOURCE_KEYS, CORE_SOURCES } from "@eegml/shared";
import { Table2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useLiveDocument, useLiveQuery } from "@/data";
import { useProvidedViewHost, type ViewHost } from "@/views/host";
import { settingsOf, type ViewSettings, ViewSurface } from "@/views/ViewSurface";

export interface LinkedViewProps {
  readonly viewId: string;
  readonly title: string;
  readonly collectionKey: string;
  readonly viewType: string;
  readonly config: string;
}

export interface LinkedViewBlockProps {
  readonly props: LinkedViewProps;
  readonly editable: boolean;
  readonly onChange: (next: Partial<LinkedViewProps>) => void;
}

function parsedConfig(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

/** Where an editor chooses what the block shows: a collection, and a saved view of it or none. */
function Picker({ host, onChange }: { readonly host: ViewHost; readonly onChange: LinkedViewBlockProps["onChange"] }) {
  const [collectionKey, setCollectionKey] = useState("core:participations");
  const [viewId, setViewId] = useState("");
  const [title, setTitle] = useState("");
  const databases = useLiveQuery({
    collection: "databases",
    within: [],
    ...(host.viewer.staff
      ? {}
      : { where: [["scopeKeys", "array-contains-any", [...host.viewer.queryScopeKeys]]] as const }),
    limit: 1_000,
  });
  const views = useLiveQuery({
    collection: "views",
    within: [],
    where: [
      ["collectionKey", "==", collectionKey],
      ["isShared", "==", true],
    ],
    limit: 200,
  });
  const own = useLiveQuery({
    collection: "views",
    within: [],
    where: [
      ["collectionKey", "==", collectionKey],
      ["ownerUid", "==", host.viewer.uid],
    ],
    limit: 200,
  });
  const savedViews = [
    ...(own.status === "ready" ? own.data : []),
    ...(views.status === "ready" ? views.data.filter((view) => view.ownerUid !== host.viewer.uid) : []),
  ];
  const collections = [
    ...CORE_SOURCE_KEYS.filter((key) => CORE_SOURCES[key].selectable).map((key) => ({
      key,
      label: CORE_SOURCES[key].label,
    })),
    ...(databases.status === "ready"
      ? databases.data
          .filter((database) => database.archivedAt === null)
          .map((database) => ({ key: `db:${database.id}`, label: database.name }))
      : []),
  ];
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const chosen = savedViews.find((view) => view.id === viewId);
        onChange({
          collectionKey,
          viewId,
          title:
            title.trim() ||
            chosen?.name ||
            collections.find((candidate) => candidate.key === collectionKey)?.label ||
            "Linked view",
          viewType: chosen?.type ?? "table",
          config: JSON.stringify(chosen?.config ?? {}),
        });
      }}
    >
      <div className="grid gap-1">
        <span className="text-sm font-medium">Records</span>
        <Select aria-label="Records" value={collectionKey} onChange={(event) => setCollectionKey(event.target.value)}>
          {collections.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1">
        <span className="text-sm font-medium">Saved view</span>
        <Select aria-label="Saved view" value={viewId} onChange={(event) => setViewId(event.target.value)}>
          <option value="">None: set the view here</option>
          {savedViews.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <span className="text-sm font-medium">Title</span>
        <Input aria-label="Title of the linked view" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <Button type="submit" variant="primary" className="justify-self-start">
        Show the view
      </Button>
    </form>
  );
}

/** A view of the block's own configuration, which an editor's changes are written back into. */
function OwnView({
  host,
  block,
  editable,
  onChange,
}: {
  readonly host: ViewHost;
  readonly block: LinkedViewProps;
  readonly editable: boolean;
  readonly onChange: LinkedViewBlockProps["onChange"];
}) {
  const [settings, setSettings] = useState<ViewSettings>(() => settingsOf(block.viewType, parsedConfig(block.config)));
  const [viewId, setViewId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incoming = `${block.viewType}|${block.config}`;
  // A change made by a collaborator reaches this block through the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the props are text, so they are compared by value
  useEffect(() => {
    setSettings(settingsOf(block.viewType, parsedConfig(block.config)));
  }, [incoming]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ViewSurface
      collectionKey={block.collectionKey}
      viewer={host.viewer}
      secondFactor={host.secondFactor}
      settings={settings}
      onSettings={(next) => {
        setSettings(next);
        if (!editable) return;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange({ viewType: next.type, config: JSON.stringify(next.config) }), 800);
      }}
      scope={null}
      viewId={viewId}
      onViewId={setViewId}
      caption={block.title || "Linked view"}
      height={360}
    />
  );
}

/** A view of a saved view, which follows the saved view as its owner changes it. */
function SavedView({ host, block }: { readonly host: ViewHost; readonly block: LinkedViewProps }) {
  const view = useLiveDocument("views", [block.viewId]);
  const [settings, setSettings] = useState<ViewSettings | null>(null);
  if (view.status === "error" || (view.status === "ready" && view.data === null)) {
    return (
      <p className="text-fg-muted">The saved view of this block is no longer there, or your account may not open it.</p>
    );
  }
  if (view.status !== "ready" || view.data === null) return <p className="text-fg-muted">Loading the view</p>;
  const stored = view.data;
  return (
    <ViewSurface
      collectionKey={stored.collectionKey}
      viewer={host.viewer}
      secondFactor={host.secondFactor}
      settings={settings ?? settingsOf(stored.type, stored.config)}
      onSettings={setSettings}
      scope={null}
      viewId={stored.id}
      onViewId={() => setSettings(null)}
      caption={block.title || stored.name}
      height={360}
    />
  );
}

export function LinkedViewBlock({ props, editable, onChange }: LinkedViewBlockProps) {
  const host = useProvidedViewHost();
  const configured = props.viewId !== "" || props.collectionKey !== "";
  return (
    <section
      className="portal-linked-view grid gap-3 rounded-tile border border-border bg-surface p-3"
      aria-label={props.title === "" ? "Linked view" : props.title}
      data-view-id={props.viewId}
      data-collection-key={props.collectionKey}
      data-testid="linked-view"
    >
      <div className="flex items-center gap-2">
        <Table2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
        <span className="font-medium">{props.title === "" ? "Linked view" : props.title}</span>
        {editable && configured ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => onChange({ viewId: "", collectionKey: "", config: "{}" })}
          >
            Choose other records
          </Button>
        ) : null}
      </div>
      {host === null ? (
        <p className="text-fg-muted">This view is shown to signed-in members.</p>
      ) : !configured ? (
        editable ? (
          <Picker host={host} onChange={onChange} />
        ) : (
          <p className="text-fg-muted">This linked view has not been set up yet.</p>
        )
      ) : props.viewId !== "" ? (
        <SavedView host={host} block={props} />
      ) : (
        <OwnView host={host} block={props} editable={editable} onChange={onChange} />
      )}
    </section>
  );
}
