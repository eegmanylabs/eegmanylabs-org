// The tasks of a list as a tree, which follows the tree pattern of WAI-ARIA: one row takes focus
// at a time, the arrow keys move between rows and open and close a task's subtasks, and Enter
// opens a task. Those who manage the list move a task with Alt and an arrow: up and down among
// its siblings, right to nest it beneath the task above it, and left to lift it out of its
// parent. Every move goes through the function that keeps the tree, and every row also offers
// its actions as buttons, so nothing depends on the keys alone.
import { taskTree } from "@eegml/shared";
import { ChevronDown, ChevronRight, Diamond, Plus } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { dayOf, finishedStatus, statusesOf, type TaskData, type TaskRecord } from "@/registry/task-data";
import { cn } from "@/utils/cn";
import { Field } from "./TaskFields";
import { addTask, messageOf, moveTask } from "./task-writes";

/** The most rows the tree draws at once. A larger list is narrowed with the views. */
const TREE_ROWS_MAX = 1_000;

export interface TaskTreeProps {
  readonly data: TaskData;
  readonly listId: string;
  readonly tasks: readonly TaskRecord[];
  /** Whether the viewer manages the list, and so may add and move its tasks. */
  readonly manages: boolean;
  readonly selectedId: string | null;
  readonly onOpen: (taskId: string) => void;
}

const bySiblingOrder = (a: TaskRecord, b: TaskRecord) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1;

export function TaskTree({ data, listId, tasks, manages, selectedId, onOpen }: TaskTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [childOf, setChildOf] = useState<string | null>(null);
  const rows = useMemo(() => taskTree(tasks, collapsed).slice(0, TREE_ROWS_MAX), [tasks, collapsed]);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const childrenOf = (parentId: string | null) =>
    tasks.filter((task) => task.parentId === parentId).sort(bySiblingOrder);
  const container = useRef<HTMLDivElement>(null);
  const statuses = statusesOf(data);
  const current = focused ?? rows[0]?.task.id ?? null;

  const focusRow = (id: string) => {
    setFocused(id);
    requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(`[data-task-row="${id}"]`)?.focus());
  };
  // While a moved task's new place arrives, which can take more than one update of the list, the
  // focus stays with that task wherever its row is drawn, so the next Alt and arrow moves it again.
  const following = useRef<string | null>(null);
  useEffect(() => {
    const id = following.current;
    if (id === null || rows.length === 0) return;
    const row = container.current?.querySelector<HTMLElement>(`[data-task-row="${id}"]`);
    if (row != null && document.activeElement !== row) row.focus();
  }, [rows]);
  const follow = (id: string) => {
    following.current = id;
    focusRow(id);
    window.setTimeout(() => {
      if (following.current === id) following.current = null;
    }, 2_000);
  };
  const run = async (what: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
    } catch (failure) {
      setError(messageOf(failure, fallback));
    } finally {
      setBusy(false);
    }
  };

  /** Moves a task among its siblings, beneath the task above it, or out of its parent, and keeps the focus on it. */
  const shift = (task: TaskRecord, direction: "up" | "down" | "in" | "out") => {
    const siblings = childrenOf(task.parentId);
    const position = siblings.findIndex((sibling) => sibling.id === task.id);
    const move = (parentId: string | null, index: number) => {
      follow(task.id);
      void run(async () => {
        await moveTask(task.id, listId, parentId, index);
        follow(task.id);
      }, "The task was not moved.");
    };
    switch (direction) {
      case "up":
        if (position > 0) move(task.parentId, position - 1);
        return;
      case "down":
        if (position < siblings.length - 1) move(task.parentId, position + 1);
        return;
      case "in": {
        const above = siblings[position - 1];
        if (above === undefined) return;
        move(above.id, childrenOf(above.id).length);
        setCollapsed((open) => new Set([...open].filter((id) => id !== above.id)));
        return;
      }
      case "out": {
        const parent = task.parentId === null ? undefined : byId.get(task.parentId);
        if (parent === undefined) return;
        const place = childrenOf(parent.parentId).findIndex((sibling) => sibling.id === parent.id);
        move(parent.parentId, place + 1);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const row = rows[index];
    if (row === undefined) return;
    const { task, childCount } = row;
    const open = !collapsed.has(task.id);
    if (!event.altKey) following.current = null;
    if (event.altKey && manages) {
      const direction = { ArrowUp: "up", ArrowDown: "down", ArrowRight: "in", ArrowLeft: "out" } as const;
      const chosen = direction[event.key as keyof typeof direction];
      if (chosen !== undefined) {
        event.preventDefault();
        shift(task, chosen);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (rows[index + 1] !== undefined) focusRow((rows[index + 1] as (typeof rows)[number]).task.id);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (rows[index - 1] !== undefined) focusRow((rows[index - 1] as (typeof rows)[number]).task.id);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (childCount > 0 && !open) setCollapsed((set) => new Set([...set].filter((id) => id !== task.id)));
        else if (childCount > 0 && rows[index + 1] !== undefined) {
          focusRow((rows[index + 1] as (typeof rows)[number]).task.id);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (childCount > 0 && open) setCollapsed((set) => new Set([...set, task.id]));
        else if (task.parentId !== null && byId.has(task.parentId)) focusRow(task.parentId);
        break;
      case "Home":
        event.preventDefault();
        if (rows[0] !== undefined) focusRow(rows[0].task.id);
        break;
      case "End":
        event.preventDefault();
        if (rows.at(-1) !== undefined) focusRow((rows.at(-1) as (typeof rows)[number]).task.id);
        break;
      case "Enter":
        event.preventDefault();
        onOpen(task.id);
        break;
    }
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      setError("Give the task a title first.");
      return;
    }
    void run(async () => {
      const taskId = await addTask(listId, childOf, { title: trimmed });
      setTitle("");
      if (childOf !== null) setCollapsed((set) => new Set([...set].filter((id) => id !== childOf)));
      setFocused(taskId);
    }, "The task was not added.");
  };

  return (
    <div className="grid gap-3">
      {manages ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
          <Field
            label={childOf === null ? "New task" : `New subtask of ${byId.get(childOf)?.title ?? "the task"}`}
            className="grid min-w-0 basis-full gap-1 text-xs font-medium text-fg-secondary min-[400px]:basis-0 min-[400px]:flex-1"
          >
            {(id) => (
              <Input
                id={id}
                value={title}
                maxLength={300}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs doing"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            <Plus aria-hidden="true" strokeWidth={1.8} />
            {childOf === null ? "Add task" : "Add subtask"}
          </Button>
          {childOf === null ? null : (
            <Button variant="ghost" onClick={() => setChildOf(null)}>
              Add at the top instead
            </Button>
          )}
        </form>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-fg-accent">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="This list has no tasks yet"
          description={manages ? "Add the first task above." : "The managers of this list add its tasks."}
        />
      ) : (
        <div ref={container}>
          <p id="task-tree-help" className="mb-2 text-xs text-fg-muted">
            Arrow keys move between tasks and open or close their subtasks, Enter opens a task
            {manages
              ? ", and Alt with an arrow moves the task up, down, beneath the task above or out of its parent"
              : ""}
            .
          </p>
          <div role="tree" aria-label="Tasks of the list" aria-describedby="task-tree-help" className="grid">
            {rows.map(({ task, depth, childCount }, index) => {
              const open = !collapsed.has(task.id);
              const due = dayOf(task.dueAt);
              const done = finishedStatus(data, task.statusKey);
              return (
                <div
                  key={task.id}
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-selected={task.id === selectedId}
                  {...(childCount > 0 ? { "aria-expanded": open } : {})}
                  tabIndex={task.id === current ? 0 : -1}
                  data-task-row={task.id}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget) onKeyDown(event, index);
                  }}
                  onFocus={(event) => {
                    if (event.target === event.currentTarget) setFocused(task.id);
                  }}
                  className={cn(
                    "flex min-h-10 items-center gap-2 border-b border-border pr-2 focus-visible:outline-2 focus-visible:outline-accent",
                    task.id === selectedId && "bg-surface-accent",
                  )}
                  style={{ paddingLeft: `${0.5 + Math.min(depth, 12) * 1.25}rem` }}
                >
                  {childCount > 0 ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={open ? `Close the subtasks of ${task.title}` : `Open the subtasks of ${task.title}`}
                      className="grid size-6 place-items-center rounded-control text-fg-muted hover:bg-surface-muted"
                      onClick={() =>
                        setCollapsed((set) =>
                          open ? new Set([...set, task.id]) : new Set([...set].filter((id) => id !== task.id)),
                        )
                      }
                    >
                      {open ? (
                        <ChevronDown aria-hidden="true" size={16} />
                      ) : (
                        <ChevronRight aria-hidden="true" size={16} />
                      )}
                    </button>
                  ) : (
                    <span className="size-6" aria-hidden="true" />
                  )}
                  {task.kind === "milestone" ? (
                    <Diamond aria-label="Milestone" size={14} className="shrink-0 text-fg-accent" />
                  ) : null}
                  <button
                    type="button"
                    tabIndex={-1}
                    className={cn(
                      "min-w-0 flex-1 truncate text-left hover:underline",
                      done && "text-fg-muted line-through",
                    )}
                    onClick={() => onOpen(task.id)}
                  >
                    {task.title}
                  </button>
                  <Badge tone="outline">
                    {statuses.find((status) => status.key === task.statusKey)?.label ?? task.statusKey}
                  </Badge>
                  {due === null ? null : <span className="hidden text-xs text-fg-muted sm:inline">Due {due}</span>}
                  {manages ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      tabIndex={-1}
                      aria-label={`Add a subtask to ${task.title}`}
                      onClick={() => setChildOf(task.id)}
                    >
                      <Plus aria-hidden="true" size={14} />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {tasks.length > TREE_ROWS_MAX ? (
            <p className="mt-2 text-sm text-fg-muted">
              The first {TREE_ROWS_MAX} tasks are shown. Use the views to filter the list.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
