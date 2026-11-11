// The programme's workspace (#/pages): the tree of its pages, its templates and its archived
// pages. Any member creates a page at its top, which every member reads and edits.
import { FilePlus2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { type RecordOf, retryFailedLiveData, setPageArchived, useLiveQuery } from "@/data";
import { pagePath } from "@/registry/paths";
import { useViewer, type Viewer } from "@/registry/viewer";
import { useMembers } from "./members";
import { NewMeetingDialog } from "./NewMeetingDialog";
import { NewPageDialog } from "./PageDialogs";
import { PageTree } from "./PageTree";
import { PageView } from "./PageView";
import { meetingPages, workspacePages } from "./queries";

function ArchivedPages({ pages, viewer }: { readonly pages: readonly RecordOf<"pages">[]; readonly viewer: Viewer }) {
  const toast = useToast();
  if (pages.length === 0) return <p className="text-fg-muted">No page is archived.</p>;
  return (
    <ul className="grid max-h-96 gap-1 overflow-y-auto" aria-label="Archived pages">
      {pages.map((page) => (
        <li key={page.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control px-2 py-1.5">
          <Link to={pagePath(page.id)} className="rounded-control text-fg-secondary hover:text-fg-accent">
            <span aria-hidden="true">{page.icon ?? "📄"}</span> {page.title}
            {page.archivedAt === null ? null : (
              <span className="ml-2 text-xs text-fg-muted">archived {formatDateTime(page.archivedAt.toDate())}</span>
            )}
          </Link>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setPageArchived(viewer.uid, page.id, false).then(
                () => toast.show({ title: "The page has been restored." }),
                () =>
                  toast.show({
                    tone: "error",
                    title: "The page was not restored.",
                    description: "Only whoever archived it, the core team and administrators can restore it.",
                  }),
              )
            }
          >
            Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function WorkspacePage() {
  const viewer = useViewer();
  const pages = useLiveQuery(viewer === null ? null : workspacePages(viewer));
  const meetings = useLiveQuery(viewer === null ? null : meetingPages(viewer));
  const members = useMembers(viewer !== null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Workspace"
        description="Pages of the programme that members write together: notes, minutes, plans and templates."
        actions={
          <>
            <NewMeetingDialog members={members.candidates} />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <FilePlus2 aria-hidden="true" strokeWidth={1.8} />
              New page
            </Button>
          </>
        }
      />
      <LiveView
        live={pages}
        loadingLabel="Loading the workspace"
        errorTitle="The workspace could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) => {
          const live = list.filter((page) => page.archivedAt === null);
          const templates = live.filter((page) => page.isTemplate);
          const archived = list.filter((page) => page.archivedAt !== null);
          return (
            <div className="grid gap-8">
              <section aria-labelledby="workspace-pages" className="grid gap-2">
                <h2 id="workspace-pages" className="text-lg text-fg">
                  Pages
                </h2>
                {live.length === 0 ? (
                  <EmptyState
                    title="No pages yet"
                    description="Create the first page of the workspace. Every member can read and edit it."
                    action={<Button onClick={() => setCreating(true)}>New page</Button>}
                  />
                ) : viewer === null ? null : (
                  <PageTree pages={live} reorderAs={viewer.uid} />
                )}
              </section>
              <section aria-labelledby="workspace-meetings" className="grid gap-2">
                <h2 id="workspace-meetings" className="text-lg text-fg">
                  Meetings
                </h2>
                {meetings.status !== "ready" ? null : meetings.data.filter((page) => page.archivedAt === null)
                    .length === 0 ? (
                  <p className="text-fg-muted">No meetings yet. Choose New meeting to start the page of one.</p>
                ) : (
                  <ul className="grid gap-1">
                    {meetings.data
                      .filter((page) => page.archivedAt === null)
                      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
                      .map((page) => (
                        <li key={page.id}>
                          <Link
                            to={pagePath(page.id)}
                            className="rounded-control text-fg-secondary hover:text-fg-accent"
                          >
                            {page.title}
                          </Link>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="workspace-templates" className="grid gap-2">
                <h2 id="workspace-templates" className="text-lg text-fg">
                  Templates
                </h2>
                {templates.length === 0 ? (
                  <p className="text-fg-muted">
                    No templates yet. Open a page and choose Use as a template from its menu: new pages can then start
                    from a copy of it.
                  </p>
                ) : (
                  <ul className="grid gap-1">
                    {templates.map((page) => (
                      <li key={page.id}>
                        <Link to={pagePath(page.id)} className="rounded-control text-fg-secondary hover:text-fg-accent">
                          <span aria-hidden="true">{page.icon ?? "📄"}</span> {page.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="workspace-archived" className="grid gap-2">
                <h2 id="workspace-archived" className="text-lg text-fg">
                  Archived pages
                </h2>
                {viewer === null ? null : <ArchivedPages pages={archived} viewer={viewer} />}
              </section>
              <NewPageDialog open={creating} onOpenChange={setCreating} parent={null} templates={templates} />
            </div>
          );
        }}
      </LiveView>
    </>
  );
}

/** The route of one page, #/pages/:pageId. */
export function PageRoute() {
  const { pageId = "" } = useParams();
  return <PageView pageId={pageId} />;
}
