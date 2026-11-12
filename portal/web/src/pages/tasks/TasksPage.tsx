// The tasks of the programme (docs/DATA_MODEL.md, section 8): the lists the viewer reads, beside
// the tasks of the chosen list as a tree, as views of the view engine, and as the planning views
// of workload, risks and blockers, roadmap and dependencies across replications. "My tasks"
// gathers every task assigned to the viewer, whatever its list. A task opens beside the list.
import { CORE_SOURCES, type PlannedTask, updateTaskListContract, type ViewScope } from "@eegml/shared";
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { callFunction, retryFailedLiveData, useLiveQuery } from "@/data";
import { meetingPages, workspacePages } from "@/pages/workspace/queries";
import { ALL_PERSONS, useDatasets, useDirectoryItems, useLaboratories, useReplications } from "@/registry/queries";
import {
  finishedStatus,
  managesList,
  plannedTask,
  type TaskData,
  type TaskListRecord,
  useTaskData,
} from "@/registry/task-data";
import { useViewer, type Viewer } from "@/registry/viewer";
import { useViewHost } from "@/views/host";
import { todayIso } from "@/views/use-view-data";
import { useViewSettings, ViewSurface } from "@/views/ViewSurface";
import { NewListDialog, scopesOf } from "./NewListDialog";
import { CrossDependenciesView, RisksView, RoadmapView, WorkloadView } from "./Planning";
import type { LinkTargets, Person } from "./TaskFields";
import { TaskPanel } from "./TaskPanel";
import { TaskTree } from "./TaskTree";
import { messageOf } from "./task-writes";

/** The lists that are no list: the viewer's tasks across lists, and every task the viewer reads. */
const MINE = "mine";
const ALL = "all";

const TABS = [
  ["tree", "Tree"],
  ["views", "Views"],
  ["workload", "Workload"],
  ["risks", "Risks and blockers"],
  ["roadmap", "Roadmap"],
  ["dependencies", "Dependencies"],
] as const;
type TabId = (typeof TABS)[number][0];

const GROUPS = [
  ["user", "Personal lists"],
  ["programme", "Programme"],
  ["replication", "Replications"],
  ["laboratory", "Laboratories"],
  ["group", "Groups"],
] as const;

/** The people a task may name: members by their account, and people without one by their person. */
function usePeople(): readonly Person[] {
  const persons = useDirectoryItems(ALL_PERSONS);
  return useMemo(
    () =>
      persons.status === "ready"
        ? persons.data
            .filter((person) => person.archivedAt === null)
            .map((person) => ({ uid: person.userId, personId: person.id, name: person.displayName }))
            .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
        : [],
    [persons],
  );
}

/** The records a task may link to, by kind. */
function useLinkTargets(viewer: Viewer, people: readonly Person[]): LinkTargets {
  const replications = useReplications();
  const laboratories = useLaboratories();
  const pages = useLiveQuery(workspacePages(viewer));
  const meetings = useLiveQuery(meetingPages(viewer));
  const datasets = useDatasets();
  return useMemo(
    () => ({
      replication:
        replications.status === "ready"
          ? replications.data.map((replication) => ({ id: replication.id, name: replication.studyKey }))
          : [],
      laboratory:
        laboratories.status === "ready"
          ? laboratories.data.map((laboratory) => ({ id: laboratory.id, name: laboratory.name }))
          : [],
      person: people.map((person) => ({ id: person.personId, name: person.name })),
      page: [pages, meetings].flatMap((live) =>
        live.status === "ready"
          ? live.data.filter((page) => page.archivedAt === null).map((page) => ({ id: page.id, name: page.title }))
          : [],
      ),
      dataset:
        datasets.status === "ready"
          ? datasets.data
              .filter((dataset) => dataset.archivedAt === null)
              .map((dataset) => ({ id: dataset.id, name: `${dataset.datasetKey}, ${dataset.title}` }))
              .sort((a, b) => a.name.localeCompare(b.name, "en"))
          : [],
    }),
    [replications, laboratories, pages, meetings, people, datasets],
  );
}

function ListNavigation({
  data,
  selected,
  onSelect,
}: {
  readonly data: TaskData;
  readonly selected: string;
  readonly onSelect: (list: string) => void;
}) {
  const lists = data.lists.filter((list) => list.archivedAt === null);
  const item = (value: string, label: string, extra?: string) => (
    <li key={value}>
      <button
        type="button"
        aria-current={selected === value ? "page" : undefined}
        onClick={() => onSelect(value)}
        className="flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-surface-muted aria-[current=page]:bg-surface-accent aria-[current=page]:font-medium"
      >
        <span className="truncate">{label}</span>
        {extra === undefined ? null : <span className="text-xs text-fg-muted">{extra}</span>}
      </button>
    </li>
  );
  const open = (list: TaskListRecord) =>
    String(data.tasks.filter((task) => task.listId === list.id && task.archivedAt === null).length);
  return (
    <nav aria-label="Task lists" className="grid content-start gap-3">
      <ul className="grid gap-0.5">
        {item(MINE, "My tasks")}
        {item(ALL, "Every task I can read")}
      </ul>
      {GROUPS.map(([scopeType, heading]) => {
        const group = lists
          .filter((list) => list.scopeType === scopeType && list.kind !== "template")
          .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
        if (group.length === 0) return null;
        return (
          <div key={scopeType} className="grid gap-1">
            <h2 className="px-2 text-xs font-medium text-fg-muted">{heading}</h2>
            <ul className="grid gap-0.5">{group.map((list) => item(list.id, list.name, open(list)))}</ul>
          </div>
        );
      })}
      {lists.some((list) => list.kind === "template") ? (
        <div className="grid gap-1">
          <h2 className="px-2 text-xs font-medium text-fg-muted">Templates</h2>
          <ul className="grid gap-0.5">
            {lists.filter((list) => list.kind === "template").map((list) => item(list.id, list.name, open(list)))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

function TaskViews({
  viewer,
  scope,
  caption,
  onOpen,
}: {
  readonly viewer: Viewer;
  readonly scope: ViewScope | null;
  readonly caption: string;
  readonly onOpen: (taskId: string) => void;
}) {
  const host = useViewHost();
  const [settings, setSettings] = useViewSettings({ type: "list", config: CORE_SOURCES["core:tasks"].defaultConfig });
  const [viewId, setViewId] = useState<string | null>(null);
  if (host === null) return <LoadingState label="Checking your access" />;
  return (
    <ViewSurface
      collectionKey="core:tasks"
      viewer={viewer}
      secondFactor={host.secondFactor}
      settings={settings}
      onSettings={setSettings}
      scope={scope}
      viewId={viewId}
      onViewId={setViewId}
      caption={caption}
      height={560}
      onOpenRecord={(record) => onOpen(record.id)}
    />
  );
}

function RenameList({ list }: { readonly list: TaskListRecord }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  if (name === null) {
    return (
      <Button size="sm" variant="outline" onClick={() => setName(list.name)}>
        Rename
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") return;
        setBusy(true);
        callFunction(updateTaskListContract, { listId: list.id, name: trimmed })
          .then(() => setName(null))
          .catch((failure: unknown) => setError(messageOf(failure, "The list was not renamed.")))
          .finally(() => setBusy(false));
      }}
    >
      <input
        aria-label="New name of the list"
        className="h-8 rounded-control border border-border-strong bg-background px-2 text-sm"
        value={name}
        maxLength={300}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={busy}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setName(null)}>
        Cancel
      </Button>
      {error === null ? null : (
        <span role="alert" className="text-xs text-fg-accent">
          {error}
        </span>
      )}
    </form>
  );
}

function Tasks({ viewer, data }: { readonly viewer: Viewer; readonly data: TaskData }) {
  const [params, setParams] = useSearchParams();
  const people = usePeople();
  const targets = useLinkTargets(viewer, people);
  const replications = useReplications();
  const laboratories = useLaboratories();
  const reminders = useLiveQuery({
    collection: "reminders",
    within: [],
    where: [["uid", "==", viewer.uid]],
    limit: 200,
  });
  const selected = params.get("list") ?? MINE;
  const list = data.lists.find((candidate) => candidate.id === selected);
  const special = selected === MINE || selected === ALL;
  const requested = params.get("tab") as TabId | null;
  const tab: TabId =
    requested !== null && TABS.some(([id]) => id === requested) && !(special && requested === "tree")
      ? requested
      : special
        ? "views"
        : "tree";
  const openTaskId = params.get("task");
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  // The control that opened the panel, to which the focus returns when the panel closes.
  const opener = useRef<HTMLElement | null>(null);
  const open = (taskId: string) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) opener.current = active;
    set({ task: taskId });
  };
  const close = () => {
    const target = opener.current;
    set({ task: null });
    requestAnimationFrame(() => {
      // The row that opened it, or the row of the tree that holds the focus, or the heading of the list.
      const fallback =
        document.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ??
        document.getElementById("task-list-title");
      (target?.isConnected === true ? target : fallback)?.focus();
    });
  };
  const names = new Map(people.flatMap((person) => (person.uid === null ? [] : [[person.uid, person.name] as const])));
  const listNames = new Map(data.lists.map((candidate) => [candidate.id, candidate.name]));
  const shown = data.tasks.filter((task) => {
    if (task.archivedAt !== null) return false;
    if (selected === MINE) return task.assigneeUids.includes(viewer.uid);
    if (selected === ALL) return true;
    return task.listId === selected;
  });
  const planned: PlannedTask[] = shown.map((task) => plannedTask(task, finishedStatus(data, task.statusKey)));
  const scopes = scopesOf(viewer, {
    replications: replications.status === "ready" ? replications.data.map((replication) => replication.id) : [],
    laboratories: new Map(
      laboratories.status === "ready"
        ? laboratories.data.map((laboratory) => [laboratory.id, laboratory.name] as const)
        : [],
    ),
  });
  const openTask = openTaskId === null ? undefined : data.tasks.find((task) => task.id === openTaskId);
  const planning = {
    tasks: planned,
    today: todayIso(),
    nameOf: (uid: string) => names.get(uid) ?? "A member",
    personName: (personId: string) => people.find((person) => person.personId === personId)?.name ?? "A person",
    listName: (listId: string) => listNames.get(listId) ?? "A list",
    onOpen: open,
  };
  const scope: ViewScope | null =
    selected === MINE
      ? { property: "assignees", value: viewer.uid }
      : selected === ALL
        ? null
        : { property: "list", value: selected };
  const title = selected === MINE ? "My tasks" : selected === ALL ? "Every task I can read" : (list?.name ?? "A list");

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Plans of the programme, its replications, laboratories and groups, and your own."
        actions={
          <NewListDialog
            scopes={scopes}
            templates={data.lists.filter((candidate) => candidate.kind === "template" && candidate.archivedAt === null)}
            onCreated={(listId) => set({ list: listId, tab: null, task: null })}
          />
        }
      />
      {data.truncated ? (
        <p className="mb-3 text-sm text-fg-muted">
          More tasks exist than one read brings back, so some may be missing here. Open a list to see all of its tasks.
        </p>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="lg:w-60 lg:shrink-0">
          <ListNavigation
            data={data}
            selected={selected}
            onSelect={(value) => set({ list: value, tab: null, task: null })}
          />
        </div>
        <section aria-labelledby="task-list-title" className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="task-list-title" tabIndex={-1} className="text-lg font-medium text-fg">
              {title}
            </h2>
            {list?.kind === "template" ? <Badge tone="outline">Template</Badge> : null}
            {list?.source?.system === "quire" ? <Badge tone="outline">Imported from Quire</Badge> : null}
            {list !== undefined && managesList(viewer, list) ? <RenameList list={list} /> : null}
            {list?.scopeType === "replication" ? (
              <Link className="text-sm underline" to={`/replications/${encodeURIComponent(list.scopeId)}`}>
                Open the replication
              </Link>
            ) : null}
          </div>
          {!special && list === undefined ? (
            <EmptyState
              title="This list does not exist"
              description="It may have been archived, or you may not read it."
            />
          ) : (
            <Tabs value={tab} onValueChange={(value) => set({ tab: value })}>
              <HorizontalScroll>
                <TabsList aria-label="Ways to see the tasks" className="min-w-max">
                  {TABS.filter(([id]) => !(special && id === "tree")).map(([id, label]) => (
                    <TabsTrigger key={id} value={id} className="whitespace-nowrap">
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </HorizontalScroll>
              <TabsContent value="tree" className="mt-3">
                {list === undefined ? null : (
                  <TaskTree
                    data={data}
                    listId={list.id}
                    tasks={shown}
                    manages={managesList(viewer, list) && list.archivedAt === null}
                    selectedId={openTaskId}
                    onOpen={open}
                  />
                )}
              </TabsContent>
              <TabsContent value="views" className="mt-3">
                <TaskViews viewer={viewer} scope={scope} caption={title} onOpen={open} />
              </TabsContent>
              <TabsContent value="workload" className="mt-3">
                <WorkloadView {...planning} />
              </TabsContent>
              <TabsContent value="risks" className="mt-3">
                <RisksView {...planning} />
              </TabsContent>
              <TabsContent value="roadmap" className="mt-3">
                <RoadmapView {...planning} />
              </TabsContent>
              <TabsContent value="dependencies" className="mt-3">
                <CrossDependenciesView {...planning} />
              </TabsContent>
            </Tabs>
          )}
        </section>
        {openTask === undefined ? null : (
          <TaskPanel
            key={openTask.id}
            task={openTask}
            data={data}
            viewer={viewer}
            people={people}
            targets={targets}
            reminders={reminders.status === "ready" ? reminders.data : []}
            onOpen={open}
            onClose={close}
          />
        )}
      </div>
    </>
  );
}

export function TasksPage() {
  const viewer = useViewer();
  const data = useTaskData(viewer);
  if (viewer === null) return <LoadingState label="Checking your access" />;
  return (
    <LiveView
      live={data}
      loadingLabel="Loading the tasks"
      errorTitle="The tasks could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(loaded) => <Tasks viewer={viewer} data={loaded} />}
    </LiveView>
  );
}
