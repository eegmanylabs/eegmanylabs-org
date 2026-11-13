// A page of the workspace (D-010): its title, icon and place, the collaborative editor, the
// pages inside it, and its comments, versions, activity and sharing. The same view serves the
// route #/pages/:pageId and the Notes tab of a record, where the page is the record's body.
import { savePageVersionContract } from "@eegml/shared";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FilePlus2,
  History,
  Keyboard,
  ListTodo,
  ListTree,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Share2,
  Smile,
  Stamp,
  Undo2,
} from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { FavouriteButton } from "@/components/registry/favourite-button";
import { FollowButton } from "@/components/registry/follow-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  CallableError,
  callFunction,
  type RecordOf,
  readPageVersion,
  retryFailedLiveData,
  type SaveState,
  setPageArchived,
  type ThreadAnchor,
  updatePageFields,
  useLiveDocument,
  useLiveDocuments,
  useLiveQuery,
} from "@/data";
import type { PageEditorApi } from "@/editor/PageEditor";
import { pagePath } from "@/registry/paths";
import { useRecordVisit } from "@/registry/use-record-visit";
import { useViewer, type Viewer } from "@/registry/viewer";
import { cn } from "@/utils/cn";
import { useViewHost } from "@/views/host";
import { ActionItemDialog } from "./ActionItemDialog";
import { ActivityPanel } from "./ActivityPanel";
import { CommentsPanel, useAnchorStore } from "./CommentsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { type Members, useMembers } from "./members";
import { PageDatabases } from "./PageDatabases";
import { IconDialog, MovePageDialog, NewPageDialog, SaveVersionDialog, ShortcutsDialog } from "./PageDialogs";
import { holds, usePageLevel } from "./page-level";
import { threadsOfPage, workspacePages } from "./queries";
import { ShareDialog } from "./ShareDialog";

const PageEditorHost = lazy(() => import("@/editor/host"));
const VersionPreview = lazy(async () => ({ default: (await import("@/editor/VersionPreview")).VersionPreview }));

type Panel = "comments" | "history" | "activity";
type Dialog = "new" | "move" | "icon" | "share" | "shortcuts" | "version" | null;

/** Whether the page has saved what was typed, as the bar of the page says it. */
function SaveIndicator({ state, editable }: { readonly state: SaveState; readonly editable: boolean }) {
  const text = !editable
    ? "Read only"
    : state.failed
      ? "Not saved: your changes are kept here and sent again"
      : state.saving
        ? "Saving"
        : "Saved";
  return (
    <span
      role="status"
      data-testid="save-state"
      data-saved={editable && !state.saving && !state.failed}
      className={cn("text-xs", state.failed ? "text-fg-accent" : "text-fg-muted")}
    >
      {text}
    </span>
  );
}

/** The pages around this one: the ancestors as a path, with links. */
function PagePath({ page }: { readonly page: RecordOf<"pages"> }) {
  const ancestors = useLiveDocuments("pages", page.ancestorPageIds);
  if (page.ancestorPageIds.length === 0) return null;
  const titles = ancestors.status === "ready" ? ancestors.data : new Map<string, RecordOf<"pages">>();
  return (
    <nav aria-label="Page path">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
        {page.ancestorPageIds.map((id) => (
          <li key={id} className="flex items-center gap-1">
            <Link to={pagePath(id)} className="rounded-control hover:text-fg-accent">
              {titles.get(id)?.title ?? "A page"}
            </Link>
            <ChevronRight aria-hidden="true" className="size-3" strokeWidth={1.8} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PageBody({
  page,
  viewer,
  members,
  embedded,
}: {
  readonly page: RecordOf<"pages">;
  readonly viewer: Viewer;
  readonly members: Members;
  readonly embedded: boolean;
}) {
  const toast = useToast();
  const viewHost = useViewHost();
  const level = usePageLevel(page);
  const archived = page.archivedAt !== null;
  const editable = holds(level, "edit") && !archived;
  const [params, setParams] = useSearchParams();
  const [panel, setPanel] = useState<Panel | null>(params.get("thread") === null ? null : "comments");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(params.get("thread"));
  const [draft, setDraft] = useState<{ readonly anchor: ThreadAnchor | null } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ saving: false, failed: false });
  const [others, setOthers] = useState<readonly string[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [preview, setPreview] = useState<{
    readonly version: RecordOf<"pageVersions">;
    readonly state: Uint8Array;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionLine, setActionLine] = useState<{ readonly blockId: string; readonly text: string } | null>(null);
  const editorApi = useRef<PageEditorApi | null>(null);

  const threads = useLiveQuery(threadsOfPage(viewer, page.id));
  const threadList = useMemo(() => (threads.status === "ready" ? threads.data : []), [threads]);
  const workspace = useLiveQuery(workspacePages(viewer));
  const all = workspace.status === "ready" ? workspace.data : [];
  const children = all
    .filter((candidate) => candidate.parentPageId === page.id && candidate.archivedAt === null)
    .sort((a, b) => (a.order < b.order ? -1 : 1));
  const templates = all.filter((candidate) => candidate.isTemplate && candidate.archivedAt === null);

  // Selecting a thread in the panel leaves the panel as it is: a thread created there is selected
  // when the server confirms it, which may come after the person has opened another panel.
  const selectThread = useCallback(
    (threadId: string | null) => {
      setSelectedThreadId(threadId);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (threadId === null) next.delete("thread");
          else next.set("thread", threadId);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  // Choosing an anchor in the text shows its thread.
  const selectAnchoredThread = useCallback(
    (threadId: string) => {
      selectThread(threadId);
      setPanel("comments");
    },
    [selectThread],
  );
  const anchors = useAnchorStore(threadList, selectedThreadId, selectAnchoredThread);
  // A new meeting starts with its sections, written once by the person who created it, who
  // arrives here from the dialog of a new meeting with its date and attendees in the address.
  const meetingStart =
    page.kind === "meeting" && params.get("start") === "meeting" && page.createdBy === viewer.uid ? params : null;
  const onReady = useCallback(
    (api: PageEditorApi) => {
      editorApi.current = api;
      // The attendees are named as the directory names them, so the sections wait for it.
      if (meetingStart === null || members.candidates.length === 0) return;
      if (api.isEmpty()) {
        const attendees = (meetingStart.get("attendees") ?? "")
          .split(",")
          .filter((uid) => uid !== "")
          .map((uid) => ({ uid, name: members.nameOf(uid) ?? "A member" }));
        api.insertMeetingSections({ date: meetingStart.get("date") ?? "", attendees });
      }
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const key of ["start", "date", "attendees"]) next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [meetingStart, members, setParams],
  );
  /** Offers a line as an action item, unless it is the instruction that earlier meeting pages held. */
  const offerActionItem = useCallback(
    (line: { readonly blockId: string; readonly text: string }) => {
      if (line.text.startsWith(FORMER_MEETING_INSTRUCTION)) {
        toast.show({
          title: "This line explains action items.",
          description: "Write the task on a line of its own, then choose Action item.",
        });
        return;
      }
      setActionLine(line);
    },
    [toast],
  );
  const startActionItem = () => {
    const line = editorApi.current?.currentLine() ?? null;
    if (line === null) {
      toast.show({ title: "Put the cursor on a line with text first.", description: "That line becomes the task." });
      return;
    }
    offerActionItem(line);
  };
  const startComment = useCallback((anchor: ThreadAnchor | null) => {
    setPanel("comments");
    setDraft({ anchor });
  }, []);
  const commentOnSelection = () => {
    const anchor = editorApi.current?.selectionAnchor() ?? null;
    if (anchor === null) {
      toast.show({ title: "Select some text first.", description: "Or comment on the page as a whole." });
      setPanel("comments");
      return;
    }
    startComment(anchor);
  };
  const onIdleAfterEdit = useCallback(() => {
    callFunction(savePageVersionContract, { pageId: page.id, kind: "auto" }).catch(() => undefined);
  }, [page.id]);
  const onFileError = useCallback(
    (message: string) => toast.show({ tone: "error", title: "The file was not added.", description: message }),
    [toast],
  );

  /** Saves a version, by the name given or without one. Returns whether it was saved. */
  const saveVersion = async (label: string | undefined): Promise<boolean> => {
    setBusy(true);
    try {
      await callFunction(savePageVersionContract, {
        pageId: page.id,
        kind: "manual",
        ...(label === undefined ? {} : { label }),
      });
      toast.show({ title: "A version has been saved." });
      return true;
    } catch (error) {
      toast.show({
        tone: "error",
        title: "The version was not saved.",
        description: error instanceof CallableError ? error.message : "Try again.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openVersion = async (version: RecordOf<"pageVersions">) => {
    try {
      setPreview({ version, state: await readPageVersion(page.id, version.id) });
    } catch {
      toast.show({ tone: "error", title: "The version could not be opened.", description: "Try again." });
    }
  };

  const restore = async () => {
    if (preview === null || editorApi.current === null) return;
    setBusy(true);
    try {
      const label = preview.version.label ?? formatDateTime(preview.version.createdAt.toDate());
      await callFunction(savePageVersionContract, {
        pageId: page.id,
        kind: "manual",
        label: `Before restoring “${label}”`.slice(0, 300),
      });
      editorApi.current.restore(preview.state);
      setPreview(null);
      // The restored content travels as a change of this editor; the version records it once it is stored.
      setTimeout(() => {
        callFunction(savePageVersionContract, {
          pageId: page.id,
          kind: "restore",
          label: `Restored “${label}”`.slice(0, 300),
          restoredFromVersionId: preview.version.id,
        }).catch(() => undefined);
      }, 3_000);
      toast.show({ title: "The version has been restored as a new change." });
    } catch (error) {
      toast.show({
        tone: "error",
        title: "The version was not restored.",
        description: error instanceof CallableError ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    const next = title.trim();
    setRenaming(false);
    if (next === "" || next === page.title) {
      setTitle(page.title);
      return;
    }
    try {
      await updatePageFields(viewer.uid, page.id, { title: next });
    } catch {
      setTitle(page.title);
      toast.show({ tone: "error", title: "The page was not renamed.", description: "Try again." });
    }
  };

  const archive = async (archive: boolean) => {
    try {
      await setPageArchived(viewer.uid, page.id, archive);
      toast.show({ title: archive ? "The page has been archived." : "The page has been restored." });
    } catch {
      toast.show({
        tone: "error",
        title: archive ? "The page was not archived." : "The page was not restored.",
        description: archive
          ? "Try again."
          : "Only whoever archived it, the core team and administrators can restore it.",
      });
    }
  };

  const Heading = embedded ? "h2" : "h1";
  const aside = useRef<HTMLElement>(null);
  /**
   * Opens a panel beside the page, or closes it. Below the wide layout the panel stands above
   * the page, and focus moves into it, so that the reader sees and hears what opened.
   */
  const togglePanel = (next: Panel) => {
    const opening = panel !== next;
    setPanel(opening ? next : null);
    if (opening && !window.matchMedia("(min-width: 63.75rem)").matches) {
      requestAnimationFrame(() => {
        aside.current?.focus();
        aside.current?.scrollIntoView({ block: "start" });
      });
    }
  };
  return (
    <div className="grid gap-4" data-testid="page-view" data-page-id={page.id}>
      <header className="grid gap-2">
        <PagePath page={page} />
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <button
              type="button"
              onClick={() => setDialog("icon")}
              aria-label={page.icon === undefined ? "Add an icon" : `Icon ${page.icon}. Change the icon`}
              className="flex size-10 cursor-pointer items-center justify-center rounded-control border border-transparent text-2xl hover:border-border"
            >
              {page.icon ?? <Smile aria-hidden="true" className="size-5 text-fg-muted" strokeWidth={1.8} />}
            </button>
          ) : page.icon === undefined ? null : (
            <span aria-hidden="true" className="text-2xl">
              {page.icon}
            </span>
          )}
          {renaming ? (
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <Input
                aria-label="Title of the page"
                value={title}
                maxLength={300}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void rename()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setTitle(page.title);
                    setRenaming(false);
                  }
                }}
                className="text-xl"
              />
            </form>
          ) : (
            <Heading className={cn("min-w-0 break-words text-fg", embedded ? "text-xl" : "text-2xl")}>
              {page.title}
            </Heading>
          )}
          <div className="flex flex-wrap gap-1">
            {page.isTemplate ? <Badge tone="neutral">Template</Badge> : null}
            {page.kind === "meeting" ? <Badge tone="outline">Meeting</Badge> : null}
            {page.accessMode === "restricted" ? <Badge tone="outline">Restricted</Badge> : null}
            {archived ? <Badge tone="accent">Archived</Badge> : null}
          </div>
          {page.kind === "meeting" && editable ? (
            <p className="text-xs text-fg-muted" data-testid="action-item-help">
              To make a line a task, put the cursor on it and choose Action item, above the page or in the menu of
              blocks.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Page actions">
          {others.length === 0 ? null : (
            <span className="text-xs text-fg-secondary" data-testid="also-here">
              Also here: {others.join(", ")}
            </span>
          )}
          <SaveIndicator state={saveState} editable={editable} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {editable ? (
            <Button size="sm" variant="ghost" onClick={startActionItem}>
              <ListTodo aria-hidden="true" strokeWidth={1.8} />
              Action item
            </Button>
          ) : null}
          {holds(level, "comment") && !archived ? (
            <Button size="sm" variant="ghost" onClick={commentOnSelection} aria-keyshortcuts="Control+Alt+M">
              <MessageSquarePlus aria-hidden="true" strokeWidth={1.8} />
              Comment
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" aria-pressed={panel === "comments"} onClick={() => togglePanel("comments")}>
            <MessageSquare aria-hidden="true" strokeWidth={1.8} />
            Comments
            {threadList.filter((thread) => thread.resolvedAt === null).length > 0 ? (
              <Badge tone="accent">{threadList.filter((thread) => thread.resolvedAt === null).length}</Badge>
            ) : null}
          </Button>
          <Button size="sm" variant="ghost" aria-pressed={panel === "history"} onClick={() => togglePanel("history")}>
            <History aria-hidden="true" strokeWidth={1.8} />
            History
          </Button>
          {viewer.access.member ? (
            <FollowButton uid={viewer.uid} entityType="page" entityId={page.id} label="Follow" />
          ) : null}
          {viewer.access.member ? (
            <FavouriteButton uid={viewer.uid} entityType="page" entityId={page.id} name={page.title} variant="ghost" />
          ) : null}
          <Button size="sm" variant="ghost" aria-pressed={panel === "activity"} onClick={() => togglePanel("activity")}>
            <ListTree aria-hidden="true" strokeWidth={1.8} />
            Activity
          </Button>
          {holds(level, "full") ? (
            <Button size="sm" variant="ghost" onClick={() => setDialog("share")}>
              <Share2 aria-hidden="true" strokeWidth={1.8} />
              Share
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="More actions for this page">
                <MoreHorizontal aria-hidden="true" strokeWidth={1.8} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {editable ? (
                <DropdownMenuItem onSelect={() => setDialog("new")}>
                  <FilePlus2 aria-hidden="true" strokeWidth={1.8} />
                  Add a page inside
                </DropdownMenuItem>
              ) : null}
              {editable ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setTitle(page.title);
                    setRenaming(true);
                  }}
                >
                  <Pencil aria-hidden="true" strokeWidth={1.8} />
                  Rename
                </DropdownMenuItem>
              ) : null}
              {editable ? (
                <DropdownMenuItem onSelect={() => setDialog("icon")}>
                  <Smile aria-hidden="true" strokeWidth={1.8} />
                  Change the icon
                </DropdownMenuItem>
              ) : null}
              {editable && page.kind !== "entity" ? (
                <DropdownMenuItem onSelect={() => setDialog("move")}>
                  <ListTree aria-hidden="true" strokeWidth={1.8} />
                  Move
                </DropdownMenuItem>
              ) : null}
              {editable && page.kind !== "entity" ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void updatePageFields(viewer.uid, page.id, { isTemplate: !page.isTemplate }).catch(() =>
                      toast.show({ tone: "error", title: "The page was not changed.", description: "Try again." }),
                    )
                  }
                >
                  <Stamp aria-hidden="true" strokeWidth={1.8} />
                  {page.isTemplate ? "Stop using as a template" : "Use as a template"}
                </DropdownMenuItem>
              ) : null}
              {embedded ? (
                <DropdownMenuItem asChild>
                  <Link to={pagePath(page.id)}>
                    <FilePlus2 aria-hidden="true" strokeWidth={1.8} />
                    Open as a full page
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setDialog("shortcuts")}>
                <Keyboard aria-hidden="true" strokeWidth={1.8} />
                Keyboard shortcuts
              </DropdownMenuItem>
              {holds(level, "edit") && page.kind !== "entity" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void archive(!archived)}>
                    {archived ? (
                      <ArchiveRestore aria-hidden="true" strokeWidth={1.8} />
                    ) : (
                      <Archive aria-hidden="true" strokeWidth={1.8} />
                    )}
                    {archived ? "Restore the page" : "Archive the page"}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {archived ? (
        <ErrorState
          title="This page is archived."
          description="It is kept as it was and can no longer be changed. Restore it to work on it again."
          action={
            holds(level, "edit") ? (
              <Button onClick={() => void archive(false)}>
                <ArchiveRestore aria-hidden="true" strokeWidth={1.8} />
                Restore the page
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <div className={cn("grid gap-6", panel !== null && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
        <div className="grid min-w-0 content-start gap-6">
          {preview === null ? null : (
            <section aria-labelledby="preview-heading" className="grid gap-3 rounded-card border border-accent p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="preview-heading" className="text-lg text-fg">
                  {preview.version.label ?? "A saved version"}, as it was
                </h2>
                <div className="flex gap-2">
                  {editable ? (
                    <Button size="sm" variant="primary" onClick={() => void restore()} disabled={busy}>
                      <Undo2 aria-hidden="true" strokeWidth={1.8} />
                      Restore this version
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
                    Back to the current page
                  </Button>
                </div>
              </div>
              <Suspense fallback={<LoadingState label="Loading the version" />}>
                <VersionPreview state={preview.state} />
              </Suspense>
            </section>
          )}
          <div className={cn(preview !== null && "hidden")}>
            <Suspense fallback={<LoadingState label="Loading the editor" />}>
              <PageEditorHost
                pageId={page.id}
                uid={viewer.uid}
                userName={members.nameOf(viewer.uid) ?? "A member"}
                editable={editable}
                members={members.candidates}
                anchors={anchors}
                onComment={startComment}
                onFileError={onFileError}
                onReady={onReady}
                onSaveState={setSaveState}
                onIdleAfterEdit={onIdleAfterEdit}
                onPresence={setOthers}
                viewHost={viewHost}
                onActionItem={offerActionItem}
              />
            </Suspense>
          </div>
          <PageDatabases page={page} viewer={viewer} editable={editable} />
          {actionLine === null ? null : (
            <ActionItemDialog
              viewer={viewer}
              pageId={page.id}
              line={actionLine}
              members={members.candidates}
              onClose={() => setActionLine(null)}
              onCreated={(blockId, taskId, title) => {
                editorApi.current?.makeActionItem(blockId, taskId, title);
                setActionLine(null);
                toast.show({
                  title: "The action item has been created.",
                  description: "It is a task in its list now.",
                });
              }}
            />
          )}
          <section aria-labelledby={`children-${page.id}`} className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`children-${page.id}`} className="text-lg text-fg">
                Pages inside
              </h2>
              {editable ? (
                <Button size="sm" variant="outline" onClick={() => setDialog("new")}>
                  <FilePlus2 aria-hidden="true" strokeWidth={1.8} />
                  Add a page inside
                </Button>
              ) : null}
            </div>
            {workspace.status === "loading" ? (
              <LoadingState label="Loading the pages inside" />
            ) : children.length === 0 ? (
              <p className="text-fg-muted">No pages inside yet.</p>
            ) : (
              <ul className="grid gap-1">
                {children.map((child) => (
                  <li key={child.id}>
                    <Link
                      to={pagePath(child.id)}
                      className="flex items-center gap-2 rounded-control px-2 py-1.5 text-fg-secondary hover:bg-surface-muted hover:text-fg"
                    >
                      <span aria-hidden="true">{child.icon ?? "📄"}</span>
                      {child.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        {panel === null ? null : (
          <aside
            ref={aside}
            tabIndex={-1}
            aria-label="Beside the page"
            className="order-first grid content-start gap-4 lg:order-none"
          >
            {panel === "comments" ? (
              <CommentsPanel
                page={page}
                viewer={viewer}
                level={level}
                threads={threadList}
                members={members}
                selectedThreadId={selectedThreadId}
                onSelectThread={selectThread}
                draft={draft}
                onDraft={setDraft}
              />
            ) : panel === "history" ? (
              <HistoryPanel
                pageId={page.id}
                members={members}
                canSave={editable}
                previewing={preview?.version.id ?? null}
                busy={busy}
                onSave={() => setDialog("version")}
                onPreview={(version) => void openVersion(version)}
              />
            ) : (
              <ActivityPanel pageId={page.id} viewer={viewer} members={members} editor={editorApi} />
            )}
          </aside>
        )}
      </div>

      <NewPageDialog
        open={dialog === "new"}
        onOpenChange={(open) => setDialog(open ? "new" : null)}
        parent={{ id: page.id, title: page.title }}
        templates={templates}
      />
      <MovePageDialog
        open={dialog === "move"}
        onOpenChange={(open) => setDialog(open ? "move" : null)}
        page={page}
        candidates={all}
      />
      <IconDialog
        open={dialog === "icon"}
        onOpenChange={(open) => setDialog(open ? "icon" : null)}
        page={page}
        uid={viewer.uid}
      />
      {holds(level, "full") ? (
        <ShareDialog
          open={dialog === "share"}
          onOpenChange={(open) => setDialog(open ? "share" : null)}
          pageId={page.id}
          uid={viewer.uid}
          members={members}
        />
      ) : null}
      <ShortcutsDialog open={dialog === "shortcuts"} onOpenChange={(open) => setDialog(open ? "shortcuts" : null)} />
      <SaveVersionDialog
        open={dialog === "version"}
        onOpenChange={(open) => setDialog(open ? "version" : null)}
        busy={busy}
        onSave={saveVersion}
      />
    </div>
  );
}

/** A page, live, with the standard loading and error states. */
/** The start of the instruction that meeting pages held as a line before it moved beside the page. */
const FORMER_MEETING_INSTRUCTION = "Write a line, then choose Action item";

export function PageView({ pageId, embedded = false }: { readonly pageId: string; readonly embedded?: boolean }) {
  const viewer = useViewer();
  const page = useLiveDocument("pages", pageId === "" ? null : [pageId]);
  const members = useMembers(viewer !== null);
  const exists = page.status === "ready" && page.data !== null;
  useRecordVisit(
    !embedded && exists && viewer !== null ? viewer.uid : null,
    "page",
    exists && !embedded ? pageId : null,
  );
  return (
    <LiveView
      live={page}
      loadingLabel="Loading the page"
      errorTitle="The page could not be loaded."
      onRetry={retryFailedLiveData}
      denied={
        <ErrorState
          title="You no longer have access to this page"
          description="Its sharing may have changed. Ask someone with full access to the page to share it with you."
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/pages">Go to the workspace</Link>
              </Button>
              <Button variant="outline" onClick={retryFailedLiveData}>
                Try again
              </Button>
            </div>
          }
        />
      }
    >
      {(record) =>
        record === null ? (
          <EmptyState
            title="This page does not exist"
            description="It may have been mistyped, or it was never created."
            action={
              <Button asChild>
                <Link to="/pages">Go to the workspace</Link>
              </Button>
            }
          />
        ) : viewer === null ? (
          <LoadingState label="Checking your access" />
        ) : (
          <PageBody key={record.id} page={record} viewer={viewer} members={members} embedded={embedded} />
        )
      }
    </LiveView>
  );
}
