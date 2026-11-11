// The tasks of a replication, a laboratory or a member, on the page of the record: the task lists
// of a replication or a laboratory, the tasks that link to the record, and the tasks assigned to
// a member, of those the viewer may read. Those who manage a list of the record add a task to it
// here, linked to the record.
import type { CallableInput, createTaskContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { retryFailedLiveData } from "@/data";
import { dayOf, managesList, statusesOf, type TaskData, useTaskData } from "@/registry/task-data";
import type { Viewer } from "@/registry/viewer";
import { addTask, messageOf } from "./task-writes";

export interface EntityTasksProps {
  readonly viewer: Viewer;
  readonly entityType: "replication" | "laboratory" | "person";
  readonly entityId: string;
  /** For a member: the account of the person, whose assigned tasks are shown. */
  readonly userId?: string | null;
}

function AddLinkedTask({
  data,
  viewer,
  entityType,
  entityId,
}: Omit<EntityTasksProps, "userId"> & { readonly data: TaskData }) {
  const lists = data.lists.filter(
    (list) =>
      list.archivedAt === null &&
      list.scopeType === entityType &&
      list.scopeId === entityId &&
      list.kind !== "template" &&
      managesList(viewer, list),
  );
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (lists.length === 0) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "" || listId === "") {
      setError("Give the task a title and choose its list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fields: CallableInput<typeof createTaskContract>["fields"] = {
        title: trimmed,
        links: [{ entityType, entityId }],
      };
      await addTask(listId, null, fields);
      setTitle("");
      setDone(trimmed);
    } catch (failure) {
      setError(messageOf(failure, "The task was not added."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid gap-3 rounded-tile border border-border bg-surface p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
    >
      <FormField label="New task linked here" error={error}>
        {(control) => (
          <Input {...control} value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
        )}
      </FormField>
      <FormField label="In the list">
        {(control) => (
          <Select {...control} value={listId} onChange={(event) => setListId(event.target.value)}>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Add task
      </Button>
      {done === null ? null : (
        <p role="status" className="text-xs text-fg-muted sm:col-span-3">
          The task {done} was added.
        </p>
      )}
    </form>
  );
}

function EntityTasks({ data, viewer, entityType, entityId, userId }: EntityTasksProps & { readonly data: TaskData }) {
  const lists = data.lists.filter(
    (list) => list.archivedAt === null && list.scopeType === entityType && list.scopeId === entityId,
  );
  const statuses = statusesOf(data);
  const tasks = data.tasks
    .filter(
      (task) =>
        task.archivedAt === null &&
        (task.links.some((link) => link.entityType === entityType && link.entityId === entityId) ||
          lists.some((list) => list.id === task.listId) ||
          (userId != null && (task.assigneeUids.includes(userId) || task.collaboratorUids.includes(userId)))),
    )
    .sort((a, b) => (dayOf(a.dueAt) ?? "9999").localeCompare(dayOf(b.dueAt) ?? "9999"));
  const listName = new Map(data.lists.map((list) => [list.id, list.name]));
  return (
    <div className="grid gap-4">
      {lists.length === 0 ? null : (
        <section aria-labelledby="entity-task-lists" className="grid gap-2">
          <h2 id="entity-task-lists" className="text-md font-medium">
            Task lists
          </h2>
          <ul className="flex flex-wrap gap-2">
            {lists.map((list) => (
              <li key={list.id}>
                <Link
                  className="rounded-control border border-border px-2 py-1 text-sm hover:border-accent"
                  to={`/tasks?list=${encodeURIComponent(list.id)}`}
                >
                  {list.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <AddLinkedTask data={data} viewer={viewer} entityType={entityType} entityId={entityId} />
      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks here yet"
          description={
            entityType === "person"
              ? "Tasks assigned to this member, or linked to them, appear here when you may read them."
              : "Tasks of the lists of this record, and tasks linked to it, appear here when you may read them."
          }
          action={
            <Button asChild variant="outline">
              <Link to="/tasks">Go to the tasks</Link>
            </Button>
          }
        />
      ) : (
        <Table caption="Tasks of this record">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Task</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Due</TableHeaderCell>
              <TableHeaderCell>List</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <Link
                    className="hover:underline"
                    to={`/tasks?list=${encodeURIComponent(task.listId)}&task=${encodeURIComponent(task.id)}`}
                  >
                    {task.title}
                  </Link>
                  {task.kind === "milestone" ? (
                    <Badge tone="outline" className="ml-2">
                      Milestone
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  {statuses.find((status) => status.key === task.statusKey)?.label ?? task.statusKey}
                </TableCell>
                <TableCell>{dayOf(task.dueAt) ?? "No date"}</TableCell>
                <TableCell>{listName.get(task.listId) ?? "A list"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function EntityTasksTab(props: EntityTasksProps) {
  const data = useTaskData(props.viewer);
  return (
    <LiveView
      live={data}
      loadingLabel="Loading the tasks"
      errorTitle="The tasks could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(loaded) => <EntityTasks {...props} data={loaded} />}
    </LiveView>
  );
}
