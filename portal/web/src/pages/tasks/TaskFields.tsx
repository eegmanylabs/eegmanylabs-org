// The parts of a task that hold more than one value: its participants, its dependencies, its
// links, its checklist, its tags, its recurrence and the viewer's reminders. Each part shows
// what is stored and, for those who may, changes it through the functions of tasks.
import {
  describeRecurrence,
  type EntityType,
  formatRecurrenceRule,
  orderBetween,
  parseRecurrenceRule,
  type RecurrenceFrequency,
  type TaskPatch,
  WEEKDAYS,
  type Weekday,
  wouldCreateCycle,
} from "@eegml/shared";
import { X } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ensureTag, type RecordOf, removeReminder } from "@/data";
import type { TaskData, TaskRecord } from "@/registry/task-data";
import { addReminder, messageOf } from "./task-writes";

/** A part of the panel: a heading and what it holds. */
export function Part({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2 border-t border-border pt-3">
      <h3 id={id} className="text-sm font-medium text-fg">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A small labelled control: the label names the control that the children render with the given identifier. */
export function Field({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/** Runs a change and reports a refusal beside the part that asked for it. */
export function useChange(): {
  readonly error: string | null;
  readonly busy: boolean;
  run(change: () => Promise<void>, fallback?: string): void;
} {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    run(change, fallback = "The change was not saved.") {
      setBusy(true);
      setError(null);
      change()
        .catch((failure: unknown) => setError(messageOf(failure, fallback)))
        .finally(() => setBusy(false));
    },
  };
}

export function ChangeError({ error }: { readonly error: string | null }) {
  return error === null ? null : (
    <p role="alert" className="text-xs text-fg-accent">
      {error}
    </p>
  );
}

const remove = (label: string, onClick: () => void, disabled: boolean) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="grid size-6 place-items-center rounded-control text-fg-muted hover:bg-surface-muted"
  >
    <X aria-hidden="true" size={14} />
  </button>
);

export interface Person {
  readonly uid: string | null;
  readonly personId: string;
  readonly name: string;
}

const ROLES = [
  ["assigneeUids", "assignee", "Assignees"],
  ["collaboratorUids", "collaborator", "Collaborators"],
  ["followerUids", "follower", "Followers"],
] as const;

/**
 * The assignees, the collaborators and the followers. A person who has no account yet is named
 * by their person and joins the uid array when they claim an account.
 */
export function Participants({
  task,
  people,
  manages,
  onChange,
}: {
  readonly task: TaskRecord;
  readonly people: readonly Person[];
  readonly manages: boolean;
  readonly onChange: (patch: TaskPatch) => Promise<void>;
}) {
  const change = useChange();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const byUid = new Map(people.flatMap((person) => (person.uid === null ? [] : [[person.uid, person.name] as const])));
  const byPerson = new Map(people.map((person) => [person.personId, person.name]));
  return (
    <Part title="People">
      {ROLES.map(([field, role, label]) => {
        const uids = task[field];
        const unclaimed = task.unclaimedParticipants.filter((entry) => entry.role === role);
        const selection = chosen[field] ?? "";
        const add = () => {
          if (selection === "") return;
          const [kind, id] = selection.split(":") as ["uid" | "person", string];
          change.run(() =>
            kind === "uid"
              ? onChange({ [field]: [...uids, id] })
              : onChange({ unclaimedParticipants: [...task.unclaimedParticipants, { personId: id, role }] }),
          );
          setChosen({ ...chosen, [field]: "" });
        };
        return (
          <div key={field} className="grid gap-1">
            <span className="text-xs text-fg-muted">{label}</span>
            <ul className="flex flex-wrap gap-1">
              {uids.length === 0 && unclaimed.length === 0 ? <li className="text-xs text-fg-muted">None</li> : null}
              {uids.map((uid) => (
                <li key={uid} className="flex items-center gap-1 rounded-control border border-border px-2 text-xs">
                  {byUid.get(uid) ?? "A member"}
                  {manages
                    ? remove(
                        `Remove ${byUid.get(uid) ?? "the member"} from the ${label.toLowerCase()}`,
                        () => change.run(() => onChange({ [field]: uids.filter((other) => other !== uid) })),
                        change.busy,
                      )
                    : null}
                </li>
              ))}
              {unclaimed.map((entry) => (
                <li
                  key={entry.personId}
                  className="flex items-center gap-1 rounded-control border border-dashed border-border px-2 text-xs"
                >
                  {byPerson.get(entry.personId) ?? "A person"} (no account yet)
                  {manages
                    ? remove(
                        `Remove ${byPerson.get(entry.personId) ?? "the person"} from the ${label.toLowerCase()}`,
                        () =>
                          change.run(() =>
                            onChange({
                              unclaimedParticipants: task.unclaimedParticipants.filter(
                                (other) => !(other.personId === entry.personId && other.role === role),
                              ),
                            }),
                          ),
                        change.busy,
                      )
                    : null}
                </li>
              ))}
            </ul>
            {manages ? (
              <div className="flex gap-1">
                <Select
                  aria-label={`Add to the ${label.toLowerCase()}`}
                  className="h-8 min-w-0 flex-1"
                  value={selection}
                  onChange={(event) => setChosen({ ...chosen, [field]: event.target.value })}
                >
                  <option value="">Choose a person</option>
                  {people
                    .filter((person) =>
                      person.uid === null
                        ? !unclaimed.some((entry) => entry.personId === person.personId)
                        : !uids.includes(person.uid),
                    )
                    .map((person) => (
                      <option
                        key={person.personId}
                        value={person.uid === null ? `person:${person.personId}` : `uid:${person.uid}`}
                      >
                        {person.uid === null ? `${person.name} (no account yet)` : person.name}
                      </option>
                    ))}
                </Select>
                <Button size="sm" onClick={add} disabled={selection === "" || change.busy}>
                  Add
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
      <ChangeError error={change.error} />
    </Part>
  );
}

export const DEPENDENCY_LABELS: Readonly<Record<string, string>> = {
  finishToStart: "Starts after it finishes",
  startToStart: "Starts when it starts",
  finishToFinish: "Finishes when it finishes",
  blocks: "Is blocked by it",
};

/** The tasks this one depends on. A dependency that would close a cycle is not offered. */
export function Dependencies({
  task,
  data,
  manages,
  onOpen,
  onChange,
}: {
  readonly task: TaskRecord;
  readonly data: TaskData;
  readonly manages: boolean;
  readonly onOpen: (taskId: string) => void;
  readonly onChange: (patch: TaskPatch) => Promise<void>;
}) {
  const change = useChange();
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState("finishToStart");
  const byId = new Map(data.tasks.map((other) => [other.id, other]));
  const candidates = useMemo(
    () =>
      data.tasks
        .filter(
          (other) =>
            other.id !== task.id &&
            other.archivedAt === null &&
            !(other.id in task.dependsOn) &&
            !wouldCreateCycle(data.tasks, task.id, other.id),
        )
        .sort((a, b) => a.title.localeCompare(b.title, "en-GB")),
    [data.tasks, task],
  );
  const entries = Object.entries(task.dependsOn);
  return (
    <Part title="Depends on">
      {entries.length === 0 ? <p className="text-xs text-fg-muted">No dependencies.</p> : null}
      <ul className="grid gap-1">
        {entries.map(([id, dependency]) => {
          const other = byId.get(id);
          return (
            <li key={id} className="flex items-center gap-2 text-sm">
              {other === undefined ? (
                <span className="text-fg-muted">A task you may not open</span>
              ) : (
                <button type="button" className="truncate text-left hover:underline" onClick={() => onOpen(id)}>
                  {other.title}
                </button>
              )}
              <Badge tone="outline">{DEPENDENCY_LABELS[dependency] ?? dependency}</Badge>
              {manages
                ? remove(
                    "Remove the dependency",
                    () => {
                      const { [id]: _removed, ...rest } = task.dependsOn;
                      change.run(() => onChange({ dependsOn: rest }));
                    },
                    change.busy,
                  )
                : null}
            </li>
          );
        })}
      </ul>
      {manages ? (
        <div className="grid gap-1">
          <Select
            aria-label="Task this one depends on"
            className="h-8"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Choose a task</option>
            {candidates.map((other) => (
              <option key={other.id} value={other.id}>
                {other.title}
              </option>
            ))}
          </Select>
          <div className="flex gap-1">
            <Select
              aria-label="Kind of dependency"
              className="h-8 flex-1"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {Object.entries(DEPENDENCY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={target === "" || change.busy}
              onClick={() => {
                change.run(() => onChange({ dependsOn: { ...task.dependsOn, [target]: kind as "finishToStart" } }));
                setTarget("");
              }}
            >
              Add dependency
            </Button>
          </div>
          <p className="text-xs text-fg-muted">
            A task that already waits for this one is not offered, so no cycle can form.
          </p>
        </div>
      ) : null}
      <ChangeError error={change.error} />
    </Part>
  );
}

/** The kinds of record a task links to, and where each opens. */
const LINK_KINDS = [
  ["replication", "Replication"],
  ["laboratory", "Laboratory"],
  ["person", "Member"],
  ["page", "Page"],
  ["dataset", "Dataset"],
] as const satisfies readonly (readonly [EntityType, string])[];

export interface LinkTargets {
  readonly replication: readonly { readonly id: string; readonly name: string }[];
  readonly laboratory: readonly { readonly id: string; readonly name: string }[];
  readonly person: readonly { readonly id: string; readonly name: string }[];
  readonly page: readonly { readonly id: string; readonly name: string }[];
}

export function linkAddress(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "replication":
      return `/replications/${encodeURIComponent(entityId)}`;
    case "laboratory":
      return `/labs/${encodeURIComponent(entityId)}`;
    case "person":
      return `/members/${encodeURIComponent(entityId)}`;
    case "page":
      return `/pages/${encodeURIComponent(entityId)}`;
    default:
      return null;
  }
}

/**
 * The records a task links to. A dataset is linked by its identifier: the registry of datasets
 * does not exist yet, so the link is kept and opens once it does.
 */
export function Links({
  task,
  targets,
  manages,
  onChange,
}: {
  readonly task: TaskRecord;
  readonly targets: LinkTargets;
  readonly manages: boolean;
  readonly onChange: (patch: TaskPatch) => Promise<void>;
}) {
  const change = useChange();
  const [kind, setKind] = useState<(typeof LINK_KINDS)[number][0]>("replication");
  const [target, setTarget] = useState("");
  const nameOf = (entityType: string, entityId: string) =>
    entityType === "dataset"
      ? entityId
      : (targets[entityType as keyof LinkTargets]?.find((candidate) => candidate.id === entityId)?.name ?? entityId);
  const options = kind === "dataset" ? [] : targets[kind];
  return (
    <Part title="Links">
      {task.links.length === 0 ? <p className="text-xs text-fg-muted">No links.</p> : null}
      <ul className="grid gap-1">
        {task.links.map((link) => {
          const address = linkAddress(link.entityType, link.entityId);
          const label = LINK_KINDS.find(([key]) => key === link.entityType)?.[1] ?? link.entityType;
          return (
            <li key={`${link.entityType}:${link.entityId}`} className="flex items-center gap-2 text-sm">
              <Badge tone="outline">{label}</Badge>
              {address === null ? (
                <span className="truncate">
                  {nameOf(link.entityType, link.entityId)}
                  {link.entityType === "dataset" ? (
                    <span className="text-xs text-fg-muted"> (opens once the dataset registry exists)</span>
                  ) : null}
                </span>
              ) : (
                <Link to={address} className="truncate hover:underline">
                  {nameOf(link.entityType, link.entityId)}
                </Link>
              )}
              {manages
                ? remove(
                    `Remove the link to ${nameOf(link.entityType, link.entityId)}`,
                    () =>
                      change.run(() =>
                        onChange({
                          links: task.links.filter(
                            (other) => !(other.entityType === link.entityType && other.entityId === link.entityId),
                          ),
                        }),
                      ),
                    change.busy,
                  )
                : null}
            </li>
          );
        })}
      </ul>
      {manages ? (
        <form
          className="grid gap-1"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const entityId = target.trim();
            if (entityId === "") return;
            change.run(() => onChange({ links: [...task.links, { entityType: kind, entityId }] }));
            setTarget("");
          }}
        >
          <div className="flex gap-1">
            <Select
              aria-label="Kind of record to link"
              className="h-8 w-36"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                setTarget("");
              }}
            >
              {LINK_KINDS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            {kind === "dataset" ? (
              <Input
                aria-label="Identifier of the dataset"
                className="h-8 min-w-0 flex-1"
                value={target}
                maxLength={200}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="For example StudyA2001__lab-a__main"
              />
            ) : (
              <Select
                aria-label="Record to link"
                className="h-8 min-w-0 flex-1"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Choose a record</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {kind === "dataset" ? (
            <p className="text-xs text-fg-muted">
              The registry of datasets does not exist yet. The identifier is kept and the link opens once it does.
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={target.trim() === "" || change.busy}>
            Add link
          </Button>
        </form>
      ) : null}
      <ChangeError error={change.error} />
    </Part>
  );
}

/** The checklist, whose items its participants tick and its managers add and remove. */
export function Checklist({
  task,
  manages,
  ticks,
  onChange,
}: {
  readonly task: TaskRecord;
  readonly manages: boolean;
  readonly ticks: boolean;
  readonly onChange: (patch: TaskPatch) => Promise<void>;
}) {
  const change = useChange();
  const [label, setLabel] = useState("");
  const items = Object.entries(task.checklist).sort(([, a], [, b]) => (a.order < b.order ? -1 : 1));
  const done = items.filter(([, item]) => item.done).length;
  return (
    <Part title={`Checklist${items.length === 0 ? "" : `, ${done} of ${items.length} done`}`}>
      <ul className="grid gap-1">
        {items.map(([key, item]) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.done}
              disabled={!ticks || change.busy}
              aria-label={item.label}
              onChange={(event) =>
                change.run(() =>
                  onChange({ checklist: { ...task.checklist, [key]: { ...item, done: event.target.checked } } }),
                )
              }
              className="size-4 accent-accent-strong"
            />
            <span className={item.done ? "text-fg-muted line-through" : ""}>{item.label}</span>
            {manages
              ? remove(
                  `Remove ${item.label}`,
                  () => {
                    const { [key]: _removed, ...rest } = task.checklist;
                    change.run(() => onChange({ checklist: rest }));
                  },
                  change.busy,
                )
              : null}
          </li>
        ))}
      </ul>
      {ticks ? (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = label.trim();
            if (trimmed === "") return;
            const last = items.at(-1)?.[1].order ?? null;
            const key = `item${Date.now().toString(36)}`;
            change.run(() =>
              onChange({
                checklist: {
                  ...task.checklist,
                  [key]: { label: trimmed, done: false, order: orderBetween(last, null) },
                },
              }),
            );
            setLabel("");
          }}
        >
          <Input
            aria-label="New checklist item"
            className="h-8 min-w-0 flex-1"
            value={label}
            maxLength={300}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={change.busy}>
            Add item
          </Button>
        </form>
      ) : null}
      <ChangeError error={change.error} />
    </Part>
  );
}

/** The tags of a task. A name that no tag has yet becomes a new shared tag. */
export function Tags({
  task,
  data,
  uid,
  manages,
  onChange,
}: {
  readonly task: TaskRecord;
  readonly data: TaskData;
  readonly uid: string;
  readonly manages: boolean;
  readonly onChange: (patch: TaskPatch) => Promise<void>;
}) {
  const change = useChange();
  const [name, setName] = useState("");
  const names = new Map(data.tags.map((tag) => [tag.id, tag.name]));
  const listId = useId();
  return (
    <Part title="Tags">
      <ul className="flex flex-wrap gap-1">
        {task.tagIds.length === 0 ? <li className="text-xs text-fg-muted">No tags.</li> : null}
        {task.tagIds.map((id) => (
          <li key={id} className="flex items-center gap-1 rounded-control border border-border px-2 text-xs">
            {names.get(id) ?? "A tag"}
            {manages
              ? remove(
                  `Remove the tag ${names.get(id) ?? ""}`,
                  () => change.run(() => onChange({ tagIds: task.tagIds.filter((other) => other !== id) })),
                  change.busy,
                )
              : null}
          </li>
        ))}
      </ul>
      {manages ? (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed === "" || !/[A-Za-z0-9]/.test(trimmed)) return;
            change.run(async () => {
              const id = await ensureTag(uid, trimmed.slice(0, 100));
              if (!task.tagIds.includes(id)) await onChange({ tagIds: [...task.tagIds, id] });
            }, "The tag was not added.");
            setName("");
          }}
        >
          <Input
            aria-label="Tag to add"
            className="h-8 min-w-0 flex-1"
            list={listId}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
          <datalist id={listId}>
            {data.tags.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
          <Button type="submit" size="sm" disabled={change.busy}>
            Add tag
          </Button>
        </form>
      ) : null}
      <ChangeError error={change.error} />
    </Part>
  );
}

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** The recurrence of a task: when it is completed, the next occurrence is created. */
export function Recurrence({
  task,
  manages,
  onChange,
}: {
  readonly task: TaskRecord;
  readonly manages: boolean;
  readonly onChange: (patch: TaskPatch) => Promise<void>;
}) {
  const change = useChange();
  const stored = task.recurrenceRule === undefined ? null : parseRecurrenceRule(task.recurrenceRule);
  const [frequency, setFrequency] = useState<RecurrenceFrequency | "">(stored?.frequency ?? "");
  const [interval, setInterval] = useState(String(stored?.interval ?? 1));
  const [weekdays, setWeekdays] = useState<readonly Weekday[]>(stored?.weekdays ?? []);
  const [monthDay, setMonthDay] = useState(String(stored?.monthDay ?? ""));
  const [end, setEnd] = useState<"never" | "until" | "count">(
    stored?.until ? "until" : stored?.count ? "count" : "never",
  );
  const [until, setUntil] = useState(stored?.until ?? "");
  const [count, setCount] = useState(String(stored?.count ?? ""));
  if (task.kind === "milestone") return null;
  const save = () => {
    if (frequency === "") {
      change.run(() => onChange({ recurrenceRule: null }));
      return;
    }
    const rule = {
      frequency,
      interval: Math.max(1, Math.min(365, Number(interval) || 1)),
      weekdays: frequency === "weekly" ? weekdays : [],
      monthDay: frequency === "monthly" && monthDay !== "" ? Number(monthDay) : null,
      until: end === "until" && until !== "" ? until : null,
      count: end === "count" && count !== "" ? Math.max(1, Math.min(1000, Number(count) || 1)) : null,
    };
    change.run(() => onChange({ recurrenceRule: formatRecurrenceRule(rule) }));
  };
  return (
    <Part title="Repeats">
      <p className="text-sm">{stored === null ? "Does not repeat." : describeRecurrence(stored)}</p>
      {manages ? (
        <div className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="How often"
              className="h-8 w-36"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as typeof frequency)}
            >
              <option value="">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
            {frequency === "" ? null : (
              <div className="flex items-center gap-1">
                Every
                <Input
                  aria-label={`Every so many ${frequency === "daily" ? "days" : frequency === "weekly" ? "weeks" : "months"}`}
                  type="number"
                  min={1}
                  max={365}
                  className="h-8 w-16"
                  value={interval}
                  onChange={(event) => setInterval(event.target.value)}
                />
                {`${frequency === "daily" ? "day" : frequency === "weekly" ? "week" : "month"}${interval.trim() === "1" ? "" : "s"}`}
              </div>
            )}
          </div>
          {frequency === "weekly" ? (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">On these days</legend>
              {WEEKDAYS.map((day) => (
                <label key={day} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent-strong"
                    checked={weekdays.includes(day)}
                    onChange={(event) =>
                      setWeekdays(
                        event.target.checked
                          ? WEEKDAYS.filter((other) => other === day || weekdays.includes(other))
                          : weekdays.filter((other) => other !== day),
                      )
                    }
                  />
                  {WEEKDAY_LABELS[day]}
                </label>
              ))}
            </fieldset>
          ) : null}
          {frequency === "monthly" ? (
            <Select
              aria-label="Day of the month"
              className="h-8 w-48"
              value={monthDay}
              onChange={(event) => setMonthDay(event.target.value)}
            >
              <option value="">The same day as the task</option>
              {MONTH_DAYS.map((day) => (
                <option key={day} value={String(day)}>
                  Day {day}
                </option>
              ))}
              <option value="-1">The last day</option>
            </Select>
          ) : null}
          {frequency === "" ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Ends"
                className="h-8 w-40"
                value={end}
                onChange={(event) => setEnd(event.target.value as typeof end)}
              >
                <option value="never">Never ends</option>
                <option value="until">Ends on a date</option>
                <option value="count">Ends after a number</option>
              </Select>
              {end === "until" ? (
                <Input
                  aria-label="Last date"
                  type="date"
                  className="h-8 w-40"
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                />
              ) : null}
              {end === "count" ? (
                <Input
                  aria-label="Number of occurrences"
                  type="number"
                  min={1}
                  max={1000}
                  className="h-8 w-20"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                />
              ) : null}
            </div>
          )}
          <Button size="sm" onClick={save} disabled={change.busy}>
            Save the repetition
          </Button>
        </div>
      ) : null}
      <ChangeError error={change.error} />
    </Part>
  );
}

/** The viewer's own reminders about a task, delivered in the portal at their time. */
export function Reminders({
  task,
  reminders,
}: {
  readonly task: TaskRecord;
  readonly reminders: readonly RecordOf<"reminders">[];
}) {
  const change = useChange();
  const [at, setAt] = useState("");
  const now = Date.now();
  const mine = reminders
    .filter((reminder) => reminder.entityType === "task" && reminder.entityId === task.id)
    .sort((a, b) => a.remindAt.toMillis() - b.remindAt.toMillis());
  return (
    <Part title="Your reminders">
      {mine.length === 0 ? <p className="text-xs text-fg-muted">No reminders.</p> : null}
      <ul className="grid gap-1">
        {mine.map((reminder) => (
          <li key={reminder.id} className="flex flex-wrap items-center gap-2 text-sm">
            {reminder.remindAt.toDate().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            {reminder.sentAt !== null ? (
              <Badge tone="outline">Sent</Badge>
            ) : reminder.remindAt.toMillis() <= now ? (
              <Badge tone="outline">Due, not yet sent</Badge>
            ) : null}
            {remove("Remove the reminder", () => change.run(() => removeReminder(reminder.id)), change.busy)}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const when = new Date(at);
          if (at === "" || Number.isNaN(when.getTime())) return;
          change.run(() => addReminder(task.id, when), "The reminder was not set.");
          setAt("");
        }}
      >
        <Input
          aria-label="Remind me at"
          type="datetime-local"
          className="h-8 min-w-0 flex-1"
          value={at}
          onChange={(event) => setAt(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={change.busy}>
          Remind me
        </Button>
      </form>
      <p className="text-xs text-fg-muted">
        A reminder arrives among your notifications within five minutes of its time.
      </p>
      <ChangeError error={change.error} />
    </Part>
  );
}
