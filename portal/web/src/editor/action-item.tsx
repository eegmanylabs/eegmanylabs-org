// An action item of a meeting in the page editor: a line of the page that was turned into a
// task. The block holds the identifier of the task and shows the task itself, live: its title,
// its assignees, its due date and its status, and a link that opens it. A reader who may not
// open the task sees the title it was given.
import { useLiveDocument, useLiveQuery } from "@/data";
import { dayOf, TASK_STATUS_QUERY } from "@/registry/task-data";

export function ActionItemBlock({ taskId, title }: { readonly taskId: string; readonly title: string }) {
  const task = useLiveDocument("tasks", taskId === "" ? null : [taskId]);
  const statuses = useLiveQuery(TASK_STATUS_QUERY);
  const stored = task.status === "ready" ? task.data : null;
  const status =
    stored === null || statuses.status !== "ready"
      ? null
      : (statuses.data.find((candidate) => candidate.key === stored.statusKey)?.label ?? stored.statusKey);
  const address = `#/tasks?task=${encodeURIComponent(taskId)}`;
  return (
    <div
      className="flex w-full flex-wrap items-center gap-2 rounded-control border border-border bg-surface px-2 py-1 text-sm"
      data-action-item={taskId}
    >
      <span className="text-xs font-medium text-fg-accent">Action item</span>
      <a href={address} className="min-h-6 min-w-0 flex-1 truncate leading-6 font-medium text-fg-accent underline">
        {stored?.title ?? title}
      </a>
      {stored === null ? (
        task.status === "loading" ? null : (
          <span className="text-xs text-fg-muted">You may not open this task</span>
        )
      ) : (
        <>
          {status === null ? null : <span className="rounded-control border border-border px-1 text-xs">{status}</span>}
          {dayOf(stored.dueAt) === null ? null : (
            <span className="text-xs text-fg-muted">Due {dayOf(stored.dueAt)}</span>
          )}
          {stored.assigneeUids.length === 0 ? null : (
            <span className="text-xs text-fg-muted">
              {stored.assigneeUids.length === 1 ? "1 assignee" : `${stored.assigneeUids.length} assignees`}
            </span>
          )}
        </>
      )}
    </div>
  );
}
