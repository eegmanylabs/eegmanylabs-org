// A database of the workspace (D-011): its name, the page it belongs to, and its rows in any of
// the six kinds of view. Its editors rename it, describe it, add and archive rows and define its
// properties; every value goes through the function that checks it.
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { retryFailedLiveData, updateDatabaseFields, useLiveDocument } from "@/data";
import { useViewHost, type ViewHost } from "@/views/host";
import { useViewData } from "@/views/use-view-data";
import { VIEW_TYPES, type ViewSettings, ViewSurface, type ViewType } from "@/views/ViewSurface";

export function DatabasePage() {
  const host = useViewHost();
  if (host === null) return <LoadingState label="Loading the database" />;
  return <DatabaseContent host={host} />;
}

function DatabaseContent({ host }: { readonly host: ViewHost }) {
  const { databaseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const database = useLiveDocument("databases", [databaseId]);
  const requested = params.get("view");
  const [settings, setSettings] = useState<ViewSettings>({
    type: (VIEW_TYPES as readonly string[]).includes(requested ?? "") ? (requested as ViewType) : "table",
    config: {},
  });
  const [viewId, setViewId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = useViewData(`db:${databaseId}`, host.viewer, host.secondFactor);
  const editor = data.status === "ready" && data.data.canAddRows;
  return (
    <LiveView
      live={database}
      loadingLabel="Loading the database"
      errorTitle="The database could not be loaded"
      onRetry={retryFailedLiveData}
    >
      {(stored) =>
        stored === null ? (
          <p>This database does not exist, or your account may not open it.</p>
        ) : (
          <div className="grid gap-4">
            <PageHeader
              title={stored.name}
              description={stored.description}
              actions={
                <Button asChild variant="ghost">
                  <Link to={`/pages/${stored.parentPageId}`}>Open its page</Link>
                </Button>
              }
            />
            {stored.archivedAt !== null ? <p className="text-fg-muted">This database is archived.</p> : null}
            {editor ? (
              <div className="flex flex-wrap items-center gap-2">
                {renaming === null ? (
                  <Button size="sm" onClick={() => setRenaming(stored.name)}>
                    Rename
                  </Button>
                ) : (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (renaming.trim() === "") return;
                      updateDatabaseFields(host.viewer.uid, databaseId, { name: renaming.trim() })
                        .then(() => setRenaming(null))
                        .catch(() => setError("The database was not renamed."));
                    }}
                  >
                    <Input
                      aria-label="Name of the database"
                      value={renaming}
                      onChange={(event) => setRenaming(event.target.value)}
                    />
                    <Button size="sm" type="submit" variant="primary">
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </form>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    updateDatabaseFields(host.viewer.uid, databaseId, { archived: true }).catch(() =>
                      setError("The database was not archived."),
                    )
                  }
                >
                  Archive the database
                </Button>
              </div>
            ) : null}
            {stored.archivedAt !== null && data.status === "ready" ? (
              <Button
                size="sm"
                className="justify-self-start"
                onClick={() =>
                  updateDatabaseFields(host.viewer.uid, databaseId, { archived: false }).catch(() =>
                    setError("Only the account that archived the database, or the programme, restores it."),
                  )
                }
              >
                Restore the database
              </Button>
            ) : null}
            {error === null ? null : (
              <p role="alert" className="text-sm text-fg-accent">
                {error}
              </p>
            )}
            <ViewSurface
              collectionKey={`db:${databaseId}`}
              viewer={host.viewer}
              secondFactor={host.secondFactor}
              settings={settings}
              onSettings={(next) => {
                setSettings(next);
                if (next.type !== settings.type) {
                  const updated = new URLSearchParams(params);
                  updated.set("view", next.type);
                  setParams(updated, { replace: true });
                }
              }}
              scope={null}
              viewId={viewId}
              onViewId={setViewId}
              caption={stored.name}
              height={560}
              pageId={stored.parentPageId}
            />
          </div>
        )
      }
    </LiveView>
  );
}
