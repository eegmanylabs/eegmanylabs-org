// A task beside its list: what it is, who works on it, when, how far it has come, what it depends
// on and links to, and its history. Those who manage the list change everything; its assignees
// and collaborators change its status, progress, estimate and checklist; and anyone who reads it
// follows it, sets reminders and comments in its description. The description is the body page
// of the task, in the editor of the workspace, with its files and comments.
import { commentSegments, openEntityPageContract, type TaskPatch } from "@eegml/shared";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { SidePanel } from "@/components/registry/side-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { type RecordOf, useCallResult, useLiveQuery } from "@/data";
import { PageView } from "@/pages/workspace/PageView";
import { activityOfPage, commentsOfThread, threadsOfPage } from "@/pages/workspace/queries";
import { activityVerb, changedFieldsText } from "@/registry/activity-text";
import { orEmpty } from "@/registry/combine";
import {
  dayOf,
  finishedStatus,
  managesList,
  roleOnTask,
  statusesOf,
  type TaskData,
  type TaskRecord,
} from "@/registry/task-data";
import type { Viewer } from "@/registry/viewer";
import {
  ChangeError,
  Checklist,
  Dependencies,
  Field,
  Links,
  type LinkTargets,
  Part,
  Participants,
  type Person,
  Recurrence,
  Reminders,
  Tags,
  useChange,
} from "./TaskFields";
import { changeTask, instantOfDay, moveTask, setStatus } from "./task-writes";

export interface TaskPanelProps {
  readonly task: TaskRecord;
  readonly data: TaskData;
  readonly viewer: Viewer;
  readonly people: readonly Person[];
  readonly targets: LinkTargets;
  readonly reminders: readonly RecordOf<"reminders">[];
  readonly onOpen: (taskId: string) => void;
  readonly onClose: () => void;
}

const PRIORITIES = [
  ["none", "No priority"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["urgent", "Urgent"],
] as const;

/** The description, files and comments of a task: its body page, opened on first use. */
function TaskBody({ taskId }: { readonly taskId: string }) {
  const opened = useCallResult(openEntityPageContract, { entityType: "task", entityId: taskId }, `task/${taskId}`);
  switch (opened.live.status) {
    case "idle":
    case "loading":
      return <LoadingState label="Opening the description" />;
    case "error":
      return (
        <ErrorState
          title="The description could not be opened."
          description={opened.live.error.message}
          action={<Button onClick={opened.reload}>Try again</Button>}
        />
      );
    case "ready":
      return <PageView pageId={opened.live.data.pageId} embedded />;
  }
}

/** Comments imported from the former task manager, in the thread of the task itself. */
function ImportedComments({
  viewer,
  taskId,
  nameOf,
}: {
  readonly viewer: Viewer;
  readonly taskId: string;
  readonly nameOf: (uid: string) => string;
}) {
  const threads = orEmpty(useLiveQuery(threadsOfPage(viewer, taskId)));
  const thread =
    threads.status === "ready" ? threads.data.find((candidate) => candidate.targetType === "task") : undefined;
  const comments = orEmpty(useLiveQuery(thread === undefined ? null : commentsOfThread(thread.id)));
  if (thread === undefined || comments.status !== "ready" || comments.data.length === 0) return null;
  return (
    <Part title="Comments from Quire">
      <ul className="grid gap-2">
        {[...comments.data]
          .sort((a, b) => (a.sourceCreatedAt?.toMillis() ?? 0) - (b.sourceCreatedAt?.toMillis() ?? 0))
          .map((comment) => (
            <li key={comment.id} className="rounded-control border border-border p-2 text-sm">
              <p className="text-xs text-fg-muted">
                {comment.authorUid === undefined
                  ? (comment.sourceAuthor?.nameSource ?? "Unknown author")
                  : nameOf(comment.authorUid)}
                {comment.sourceCreatedAt === undefined
                  ? null
                  : `, ${comment.sourceCreatedAt.toDate().toLocaleDateString("en-GB", { dateStyle: "medium" })}`}
              </p>
              <p className="whitespace-pre-wrap">
                {commentSegments(comment.body)
                  .map((segment) => (segment.kind === "text" ? segment.text : `@${segment.label}`))
                  .join("")}
              </p>
            </li>
          ))}
      </ul>
    </Part>
  );
}

/** The history of a task: who changed which fields, and when. */
function History({
  viewer,
  taskId,
  nameOf,
}: {
  readonly viewer: Viewer;
  readonly taskId: string;
  readonly nameOf: (uid: string) => string;
}) {
  const activity = useLiveQuery(activityOfPage(viewer, taskId));
  return (
    <Part title="History">
      {activity.status === "loading" ? <LoadingState label="Loading the history" /> : null}
      {activity.status === "error" ? <p className="text-xs text-fg-muted">The history could not be loaded.</p> : null}
      {activity.status === "ready" ? (
        activity.data.length === 0 ? (
          <p className="text-xs text-fg-muted">No changes have been recorded in the portal.</p>
        ) : (
          <ol className="grid gap-1 text-xs">
            {activity.data.map((entry) => (
              <li key={entry.id}>
                <span className="text-fg-muted">
                  {entry.createdAt.toDate().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </span>{" "}
                {entry.actorUid === null ? "The portal" : nameOf(entry.actorUid)}{" "}
                {entry.action === "task.updated"
                  ? `changed ${changedFieldsText(entry.changedFields)}`
                  : `${activityVerb(entry.action)} the task`}
              </li>
            ))}
          </ol>
        )
      ) : null}
    </Part>
  );
}

export function TaskPanel({ task, data, viewer, people, targets, reminders, onOpen, onClose }: TaskPanelProps) {
  const change = useChange();
  const [showBody, setShowBody] = useState(false);
  // What is wrong with a number typed into the estimate or the progress, said beside the field.
  const [invalid, setInvalid] = useState<{
    readonly estimate?: string | undefined;
    readonly progress?: string | undefined;
  }>({});
  const list = data.lists.find((candidate) => candidate.id === task.listId);
  const role = roleOnTask(viewer, list, task);
  const manages = role === "manager" && list?.archivedAt === null && task.archivedAt === null;
  const works = (role === "manager" || role === "participant") && task.archivedAt === null;
  const statuses = statusesOf(data);
  const names = new Map(people.flatMap((person) => (person.uid === null ? [] : [[person.uid, person.name] as const])));
  const nameOf = (uid: string) => names.get(uid) ?? "A member";
  const save = (patch: TaskPatch) => changeTask(task.id, patch);
  const following = task.followerUids.includes(viewer.uid);
  const ancestors = task.ancestorIds
    .map((id) => data.tasks.find((other) => other.id === id))
    .filter((other) => other !== undefined);
  const [moveList, setMoveList] = useState(task.listId);
  const [moveParent, setMoveParent] = useState(task.parentId ?? "");
  const subtree = new Set([
    task.id,
    ...data.tasks.filter((other) => other.ancestorIds.includes(task.id)).map((other) => other.id),
  ]);
  const managedLists = data.lists.filter(
    (candidate) => candidate.archivedAt === null && managesList(viewer, candidate),
  );

  const dateField = (field: "startAt" | "dueAt", label: string) => (
    <Field label={label} className="grid gap-1 text-xs text-fg-muted">
      {(id) => (
        <Input
          id={id}
          type="date"
          className="h-8"
          disabled={!manages || change.busy}
          defaultValue={dayOf(task[field]) ?? ""}
          key={`${field}:${dayOf(task[field]) ?? ""}`}
          onBlur={(event) => {
            const day = event.target.value;
            if (day === (dayOf(task[field]) ?? "")) return;
            change.run(() => save({ [field]: day === "" ? null : instantOfDay(day) }));
          }}
        />
      )}
    </Field>
  );

  return (
    <SidePanel
      title={task.title}
      fullPage={`/tasks?list=${encodeURIComponent(task.listId)}&task=${encodeURIComponent(task.id)}`}
      onClose={onClose}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {task.kind === "milestone" ? <Badge tone="accent">Milestone</Badge> : null}
        {task.archivedAt === null ? null : <Badge tone="accent">Archived</Badge>}
        <span>In {list?.name ?? "a list you may not open"}</span>
        {ancestors.length > 0 ? (
          <span>
            beneath{" "}
            {ancestors.map((ancestor, index) => (
              <span key={ancestor.id}>
                {index > 0 ? " / " : ""}
                <button type="button" className="hover:underline" onClick={() => onOpen(ancestor.id)}>
                  {ancestor.title}
                </button>
              </span>
            ))}
          </span>
        ) : null}
        {task.source === undefined ? null : (
          <span>
            Imported from {task.source.system === "quire" ? "Quire" : task.source.system}
            {task.source.url === undefined ? null : (
              <>
                {" "}
                (
                <a href={task.source.url} target="_blank" rel="noreferrer" className="underline">
                  original
                </a>
                )
              </>
            )}
          </span>
        )}
      </div>
      {manages ? (
        <Field label="Title" className="grid gap-1 text-xs text-fg-muted">
          {(id) => (
            <Input
              id={id}
              className="h-8"
              defaultValue={task.title}
              key={task.title}
              maxLength={300}
              onBlur={(event) => {
                const title = event.target.value.trim();
                if (title !== "" && title !== task.title) change.run(() => save({ title }));
              }}
            />
          )}
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Status" className="grid gap-1 text-xs text-fg-muted">
          {(id) => (
            <Select
              id={id}
              className="h-8"
              value={task.statusKey}
              disabled={!works || change.busy}
              onChange={(event) =>
                change.run(() => setStatus([task], event.target.value), "The status was not changed.")
              }
            >
              {statuses.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority" className="grid gap-1 text-xs text-fg-muted">
          {(id) => (
            <Select
              id={id}
              className="h-8"
              value={task.priority}
              disabled={!manages || change.busy}
              onChange={(event) => change.run(() => save({ priority: event.target.value as TaskPatch["priority"] }))}
            >
              {PRIORITIES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Kind" className="grid gap-1 text-xs text-fg-muted">
          {(id) => (
            <Select
              id={id}
              className="h-8"
              value={task.kind}
              disabled={!manages || change.busy}
              onChange={(event) => change.run(() => save({ kind: event.target.value as "task" | "milestone" }))}
            >
              <option value="task">Task</option>
              <option value="milestone">Milestone</option>
            </Select>
          )}
        </Field>
        {task.kind === "task" ? dateField("startAt", "Start") : <span />}
        {dateField("dueAt", task.kind === "milestone" ? "Planned date" : "Due")}
        {task.completedAt === null ? null : (
          <p className="self-end text-xs text-fg-muted">
            {finishedStatus(data, task.statusKey) ? "Completed" : "Last completed"} {dayOf(task.completedAt)}
          </p>
        )}
        {task.kind === "task" ? (
          <>
            <Field label="Estimate in hours" className="grid gap-1 text-xs text-fg-muted">
              {(id) => (
                <>
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    step={0.25}
                    className="h-8"
                    disabled={!works || change.busy}
                    defaultValue={task.estimateMinutes === undefined ? "" : String(task.estimateMinutes / 60)}
                    key={`estimate:${task.estimateMinutes ?? ""}`}
                    aria-invalid={invalid.estimate !== undefined}
                    {...(invalid.estimate === undefined ? {} : { "aria-describedby": `${id}-error` })}
                    onBlur={(event) => {
                      const hours = event.target.value.trim();
                      const minutes = hours === "" ? null : Math.round(Number(hours) * 60);
                      if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
                        setInvalid({ ...invalid, estimate: "Give the estimate as a number of hours, 0 or more." });
                        event.target.value =
                          task.estimateMinutes === undefined ? "" : String(task.estimateMinutes / 60);
                        return;
                      }
                      setInvalid({ ...invalid, estimate: undefined });
                      if (minutes === (task.estimateMinutes ?? null)) return;
                      change.run(() => save({ estimateMinutes: minutes }));
                    }}
                  />
                  {invalid.estimate === undefined ? null : (
                    <span id={`${id}-error`} className="text-fg-accent">
                      {invalid.estimate}
                    </span>
                  )}
                </>
              )}
            </Field>
            <Field label="Progress in per cent" className="grid gap-1 text-xs text-fg-muted">
              {(id) => (
                <>
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="h-8"
                    disabled={!works || change.busy}
                    defaultValue={task.progressPercent === undefined ? "" : String(task.progressPercent)}
                    key={`progress:${task.progressPercent ?? ""}`}
                    aria-invalid={invalid.progress !== undefined}
                    {...(invalid.progress === undefined ? {} : { "aria-describedby": `${id}-error` })}
                    onBlur={(event) => {
                      const text = event.target.value.trim();
                      const progress = text === "" ? null : Math.round(Number(text));
                      if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
                        setInvalid({ ...invalid, progress: "Give the progress as a whole number from 0 to 100." });
                        event.target.value = task.progressPercent === undefined ? "" : String(task.progressPercent);
                        return;
                      }
                      setInvalid({ ...invalid, progress: undefined });
                      if (progress === (task.progressPercent ?? null)) return;
                      change.run(() => save({ progressPercent: progress }));
                    }}
                  />
                  {invalid.progress === undefined ? null : (
                    <span id={`${id}-error`} role="alert" className="text-fg-accent">
                      {invalid.progress}
                    </span>
                  )}
                </>
              )}
            </Field>
          </>
        ) : null}
      </div>
      <ChangeError error={change.error} />
      <div className="flex flex-wrap gap-2">
        {task.archivedAt === null ? (
          <Button
            size="sm"
            variant="outline"
            disabled={change.busy}
            onClick={() =>
              change.run(() =>
                save({
                  followerUids: following
                    ? task.followerUids.filter((uid) => uid !== viewer.uid)
                    : [...task.followerUids, viewer.uid],
                }),
              )
            }
          >
            {following ? "Stop following" : "Follow"}
          </Button>
        ) : null}
        {role === "manager" && list?.archivedAt === null ? (
          <Button
            size="sm"
            variant="outline"
            disabled={change.busy}
            onClick={() => change.run(() => save({ archived: task.archivedAt === null }))}
          >
            {task.archivedAt === null ? "Archive the task" : "Restore the task"}
          </Button>
        ) : null}
      </div>
      {task.description === undefined ? null : (
        <Part title="Description from Quire">
          <p className="whitespace-pre-wrap text-sm">{task.description}</p>
        </Part>
      )}
      <Part title="Description, files and comments">
        {showBody ? (
          <TaskBody taskId={task.id} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowBody(true)}>
            Open the description
          </Button>
        )}
      </Part>
      <Participants task={task} people={people} manages={manages} onChange={save} />
      <Dependencies task={task} data={data} manages={manages} onOpen={onOpen} onChange={save} />
      <Links task={task} targets={targets} manages={manages} onChange={save} />
      {task.kind === "task" ? <Checklist task={task} manages={manages} ticks={works} onChange={save} /> : null}
      <Tags task={task} data={data} uid={viewer.uid} manages={manages} onChange={save} />
      <Recurrence task={task} manages={manages} onChange={save} />
      <Reminders task={task} reminders={reminders} />
      {manages && managedLists.length > 0 ? (
        <Part title="Move">
          <div className="grid gap-1">
            <Select
              aria-label="List to move to"
              className="h-8"
              value={moveList}
              onChange={(event) => {
                setMoveList(event.target.value);
                setMoveParent("");
              }}
            >
              {managedLists.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Beneath"
              className="h-8"
              value={moveParent}
              onChange={(event) => setMoveParent(event.target.value)}
            >
              <option value="">At the top of the list</option>
              {data.tasks
                .filter((other) => other.listId === moveList && !subtree.has(other.id) && other.archivedAt === null)
                .map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.title}
                  </option>
                ))}
            </Select>
            <Button
              size="sm"
              disabled={change.busy || (moveList === task.listId && moveParent === (task.parentId ?? ""))}
              onClick={() =>
                change.run(
                  () =>
                    moveTask(
                      task.id,
                      moveList,
                      moveParent === "" ? null : moveParent,
                      data.tasks.filter(
                        (other) =>
                          other.listId === moveList && other.parentId === (moveParent === "" ? null : moveParent),
                      ).length,
                    ),
                  "The task was not moved.",
                )
              }
            >
              Move the task with its subtasks
            </Button>
          </div>
        </Part>
      ) : null}
      <ImportedComments viewer={viewer} taskId={task.id} nameOf={nameOf} />
      <History viewer={viewer} taskId={task.id} nameOf={nameOf} />
    </SidePanel>
  );
}
