// Home: the member's own work in one place (requirement R15.4): the open tasks assigned to them
// with their deadlines, the mentions they have not read, and the pages they opened last. Each
// item opens its record. Everything here is the member's own or read within their scope.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDate } from "@/app/labels";
import { describeNotification } from "@/app/shell/notification-text";
import { LiveView } from "@/components/feedback/live-view";
import { PageTitle } from "@/components/record-names";
import { type LiveQuery, retryFailedLiveData, useLiveQuery } from "@/data";
import { combineLive } from "@/registry/combine";
import { pagePath } from "@/registry/paths";
import { recentsOf } from "@/registry/queries";
import { finishedStatus, useTaskData } from "@/registry/task-data";
import { useViewer } from "@/registry/viewer";

/** The most items of each list. */
const SHOWN = 8;

function List({ title, empty, children }: { title: string; empty: string; children: readonly ReactNode[] }) {
  return (
    <div className="grid content-start gap-2">
      <h3 className="text-md font-medium text-fg-strong">{title}</h3>
      {children.length === 0 ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="grid gap-1 text-sm">{children}</ul>
      )}
    </div>
  );
}

export function YourWorkPanel() {
  const viewer = useViewer();
  const tasks = useTaskData(viewer);
  const notifications = useLiveQuery<"userNotifications">(
    viewer === null
      ? null
      : ({
          collection: "userNotifications",
          within: [viewer.uid],
          orderBy: [["createdAt", "desc"]],
          limit: 50,
        } satisfies LiveQuery<"userNotifications">),
  );
  const recents = useLiveQuery(viewer === null ? null : recentsOf(viewer.uid));
  if (viewer === null || !viewer.access.member) return null;
  const live = combineLive([tasks, notifications, recents] as const, (taskData, notes, visits) => ({
    taskData,
    notes,
    visits,
  }));
  return (
    <section
      aria-labelledby="your-work-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
      data-testid="your-work"
    >
      <h2 id="your-work-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Your work
      </h2>
      <LiveView
        live={live}
        loadingLabel="Loading your work"
        errorTitle="Your work could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ taskData, notes, visits }) => {
          const assigned = taskData.tasks
            .filter(
              (task) =>
                task.archivedAt === null &&
                task.assigneeUids.includes(viewer.uid) &&
                !finishedStatus(taskData, task.statusKey),
            )
            .sort(
              (a, b) =>
                (a.dueAt?.toMillis() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.toMillis() ?? Number.MAX_SAFE_INTEGER),
            )
            .slice(0, SHOWN);
          const mentions = notes.filter((note) => note.type === "mention" && note.readAt === null).slice(0, SHOWN);
          const pages = visits.filter((visit) => visit.entityType === "page").slice(0, SHOWN);
          return (
            <div className="grid gap-4 md:grid-cols-3">
              <List title="Assigned to you" empty="No open task is assigned to you.">
                {assigned.map((task) => (
                  <li key={task.id}>
                    <Link className="text-fg-accent underline" to={`/tasks?task=${encodeURIComponent(task.id)}`}>
                      {task.title}
                    </Link>
                    {task.dueAt === null || task.dueAt === undefined ? null : (
                      <span className="text-fg-secondary">, due {formatDate(task.dueAt.toDate())}</span>
                    )}
                  </li>
                ))}
              </List>
              <List title="Mentions to read" empty="Nobody has mentioned you since you last looked.">
                {mentions.map((note) => {
                  const text = describeNotification({
                    entityType: note.entityType,
                    entityId: note.entityId,
                    ...note.payload,
                  });
                  return (
                    <li key={note.id}>
                      {text.to === null ? (
                        text.title
                      ) : (
                        <Link className="text-fg-accent underline" to={text.to}>
                          {text.title}
                        </Link>
                      )}
                      {text.detail === null ? null : <span className="text-fg-secondary">: {text.detail}</span>}
                    </li>
                  );
                })}
              </List>
              <List title="Pages you opened last" empty="The pages you open appear here.">
                {pages.map((visit) => (
                  <li key={visit.id}>
                    <Link className="text-fg-accent underline" to={pagePath(visit.entityId)}>
                      <PageTitle id={visit.entityId} />
                    </Link>
                  </li>
                ))}
              </List>
            </div>
          );
        }}
      </LiveView>
    </section>
  );
}
