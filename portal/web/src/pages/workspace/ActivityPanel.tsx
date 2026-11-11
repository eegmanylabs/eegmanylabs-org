// Who edited a page and when (R3.23): one entry for each spell of editing of a member, which the
// trigger of an editor's update records from the update documents. It holds no content.
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { EmptyState } from "@/components/ui/empty-state";
import { retryFailedLiveData, useLiveQuery } from "@/data";
import type { Viewer } from "@/registry/viewer";
import type { Members } from "./members";
import { activityOfPage } from "./queries";

export function ActivityPanel({
  pageId,
  viewer,
  members,
}: {
  readonly pageId: string;
  readonly viewer: Viewer;
  readonly members: Members;
}) {
  const activity = useLiveQuery(activityOfPage(viewer, pageId));
  return (
    <section aria-labelledby="activity-heading" className="grid gap-3">
      <h2 id="activity-heading" className="text-lg text-fg">
        Activity
      </h2>
      <LiveView
        live={activity}
        loadingLabel="Loading the activity"
        errorTitle="The activity could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(entries) => {
          const edits = entries.filter((entry) => entry.entityType === "page");
          return edits.length === 0 ? (
            <EmptyState
              title="No edits yet"
              description="Each spell of editing appears here, with who edited and when."
            />
          ) : (
            <ol className="grid gap-2" aria-label="Edits, newest first">
              {edits.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-tile border border-border bg-surface px-3 py-2"
                  data-testid="activity"
                >
                  <span className="font-medium text-fg">
                    {(entry.actorUid === null ? null : members.nameOf(entry.actorUid)) ?? "A member"}
                  </span>{" "}
                  edited the page
                  <span className="block text-xs text-fg-secondary">
                    <time dateTime={entry.createdAt.toDate().toISOString()}>
                      {formatDateTime(entry.createdAt.toDate())}
                    </time>
                  </span>
                </li>
              ))}
            </ol>
          );
        }}
      </LiveView>
    </section>
  );
}
