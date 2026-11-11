// The layout of a Quire pull and what it holds (docs/INTEGRATIONS.md, section 4, and
// docs/MIGRATION_PLAN.md, section 4.10).
//
// Nothing here has been verified against a real Quire workspace. The records are written to the
// documented shapes of the REST interface, which is the contract (INTEGRATIONS.md, section 4.2),
// and the dump is the snapshot bundle that the read-only pull of step 3 of section 4.4 saves: one
// JSON file of the raw responses, grouped by project.
//
// | Key           | Holds                                                                         |
// |---------------|-------------------------------------------------------------------------------|
// | `format`      | `eegml-quire-api-dump`                                                        |
// | `formatVersion` | 1                                                                           |
// | `pulledAt`    | When the pull finished, as an ISO instant                                     |
// | `organizations` | The `OrganizationWithPlan` records, as the pull read them                  |
// | `users`       | The `User` records of the organisations, with addresses where contacts were granted |
// | `projects`    | One entry for each project: `project`, `statuses`, `tags`, `tasks` and `comments` |
//
// The tasks of a project are the `TaskWithParentInfo` records in the order the interface returned
// them, and `comments` maps the object identifier of a task to its `Comment` records. A file of
// another layout, such as Quire's own JSON export, whose inner fields the documentation does not
// state, is refused with a report of what was expected and what was found.
import { breakDependencyCycles, type ParentDefect, resolveParents, TASK_MAX_ANCESTORS } from "@eegml/shared";

/** The documented fields of a task record (the `Task` schema), and `parent` of `TaskWithParentInfo`. */
export const TASK_KEYS = [
  "tags",
  "successors",
  "predecessors",
  "successorRefs",
  "predecessorRefs",
  "oid",
  "id",
  "nameText",
  "nameHtml",
  "name",
  "description",
  "descriptionText",
  "descriptionHtml",
  "recurrence",
  "etc",
  "timelogs",
  "status",
  "due",
  "start",
  "priority",
  "partner",
  "assignors",
  "partnerBy",
  "assignees",
  "order",
  "attachments",
  "cover",
  "childCount",
  "peekaboo",
  "section",
  "milestone",
  "url",
  "followers",
  "mutes",
  "favorites",
  "sourceRef",
  "toggledAt",
  "toggledBy",
  "editedAt",
  "commentedAt",
  "approval",
  "archivedAt",
  "archivedBy",
  "reshowAt",
  "yourField",
  "createdAt",
  "createdBy",
  "parent",
  "cropped",
] as const;

/** The documented fields of a project, a comment and a user. */
export const PROJECT_KEYS = [
  "activeCount",
  "taskCount",
  "url",
  "organization",
  "nameText",
  "nameHtml",
  "rootCount",
  "name",
  "id",
  "description",
  "descriptionText",
  "descriptionHtml",
  "iconColor",
  "image",
  "oid",
  "due",
  "archivedAt",
  "start",
  "editedAt",
  "publicAt",
  "followers",
  "attachments",
  "approvalCategories",
  "fields",
  "createdAt",
  "createdBy",
] as const;

export const COMMENT_KEYS = [
  "oid",
  "description",
  "descriptionText",
  "descriptionHtml",
  "attachments",
  "emojis",
  "url",
  "editedAt",
  "pinAt",
  "pinBy",
  "editedBy",
  "owner",
  "createdAt",
  "createdBy",
] as const;

export const USER_KEYS = [
  "locale",
  "timeZone",
  "url",
  "nameText",
  "nameHtml",
  "name",
  "id",
  "email",
  "website",
  "description",
  "descriptionText",
  "descriptionHtml",
  "iconColor",
  "image",
  "oid",
] as const;

/** The fields that the import maps. Every other documented field is recorded in the missing-fields report. */
export const MAPPED_TASK_KEYS: readonly string[] = [
  "oid",
  "id",
  "name",
  "nameText",
  "description",
  "status",
  "priority",
  "start",
  "due",
  "etc",
  "assignees",
  "followers",
  "tags",
  "predecessorRefs",
  "predecessors",
  "recurrence",
  "milestone",
  "section",
  "url",
  "toggledAt",
  "createdAt",
  "createdBy",
  "editedAt",
  "parent",
  "archivedAt",
];

export const DUMP_FORMAT = "eegml-quire-api-dump";
export const DUMP_FORMAT_VERSION = 1;
const TOP_KEYS = ["format", "formatVersion", "pulledAt", "organizations", "users", "projects"] as const;
const PROJECT_ENTRY_KEYS = ["project", "statuses", "tags", "tasks", "comments"] as const;

export type QuireRecord = Readonly<Record<string, unknown>>;

export interface QuireProject {
  readonly project: QuireRecord;
  readonly statuses: readonly QuireRecord[];
  readonly tags: readonly QuireRecord[];
  readonly tasks: readonly QuireRecord[];
  readonly comments: Readonly<Record<string, readonly QuireRecord[]>>;
}

export interface QuireDump {
  readonly pulledAt: string;
  readonly organizations: readonly QuireRecord[];
  readonly users: readonly QuireRecord[];
  readonly projects: readonly QuireProject[];
}

/** A difference between the file and the layout, which stops the import. */
export interface LayoutProblem {
  /** Where in the file, as a path such as `projects[0].tasks[3]`. */
  readonly at: string;
  readonly expected: string;
  readonly found: string;
}

const isRecord = (value: unknown): value is QuireRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const describe = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "a list" : isRecord(value) ? "an object" : `a ${typeof value}`;

const keysOf = (value: unknown): string =>
  isRecord(value) ? Object.keys(value).sort().join(", ") || "none" : describe(value);

/**
 * Reads the text of a dump and checks its layout. Every problem is reported with its place in
 * the file, what the layout expects and what the file holds there, so that the first real file
 * shows at once where it differs. Values are never quoted, only keys and kinds.
 */
export function parseDump(text: string): {
  readonly dump: QuireDump | null;
  readonly problems: readonly LayoutProblem[];
} {
  const problems: LayoutProblem[] = [];
  const problem = (at: string, expected: string, found: string) => problems.push({ at, expected, found });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    problem("(file)", "JSON text", "text that is no JSON");
    return { dump: null, problems };
  }
  if (!isRecord(parsed)) {
    problem("(file)", "an object at the top", describe(parsed));
    return { dump: null, problems };
  }
  if (parsed.format !== DUMP_FORMAT || parsed.formatVersion !== DUMP_FORMAT_VERSION) {
    problem(
      "(top)",
      `the keys ${TOP_KEYS.join(", ")}, with format ${DUMP_FORMAT} and formatVersion ${DUMP_FORMAT_VERSION}`,
      `the keys ${keysOf(parsed)}`,
    );
    return { dump: null, problems };
  }
  const listAt = (value: unknown, at: string): readonly QuireRecord[] => {
    if (!Array.isArray(value)) {
      problem(at, "a list of objects", describe(value));
      return [];
    }
    value.forEach((member, index) => {
      if (!isRecord(member)) problem(`${at}[${index}]`, "an object", describe(member));
    });
    return value.filter(isRecord);
  };
  if (typeof parsed.pulledAt !== "string" || Number.isNaN(Date.parse(parsed.pulledAt))) {
    problem("pulledAt", "an ISO instant", describe(parsed.pulledAt));
  }
  const organizations = listAt(parsed.organizations, "organizations");
  const users = listAt(parsed.users, "users");
  users.forEach((user, index) => {
    if (typeof user.oid !== "string" || user.oid === "") problem(`users[${index}].oid`, "a text", describe(user.oid));
  });
  const projects: QuireProject[] = [];
  listAt(parsed.projects, "projects").forEach((entry, index) => {
    const at = `projects[${index}]`;
    const missing = PROJECT_ENTRY_KEYS.filter((key) => !(key in entry));
    if (missing.length > 0) {
      problem(at, `the keys ${PROJECT_ENTRY_KEYS.join(", ")}`, `the keys ${keysOf(entry)}`);
      return;
    }
    const project = entry.project;
    if (!isRecord(project) || typeof project.oid !== "string" || typeof project.id !== "string") {
      problem(
        `${at}.project`,
        "a project with the texts oid and id",
        isRecord(project) ? `the keys ${keysOf(project)}` : describe(project),
      );
      return;
    }
    const tasks = listAt(entry.tasks, `${at}.tasks`);
    tasks.forEach((task, position) => {
      const where = `${at}.tasks[${position}]`;
      if (typeof task.oid !== "string" || task.oid === "") problem(`${where}.oid`, "a text", describe(task.oid));
      if (typeof task.id !== "number" || !Number.isInteger(task.id))
        problem(`${where}.id`, "a whole number", describe(task.id));
      if (typeof task.name !== "string" && typeof task.nameText !== "string") {
        problem(`${where}.name`, "a text in name or nameText", describe(task.name));
      }
      if (!("parent" in task)) problem(`${where}.parent`, "the parent of TaskWithParentInfo, or null", "no such key");
    });
    const comments: Record<string, readonly QuireRecord[]> = {};
    if (!isRecord(entry.comments)) {
      problem(`${at}.comments`, "an object keyed by the oid of a task", describe(entry.comments));
    } else {
      for (const [taskOid, list] of Object.entries(entry.comments)) {
        const listed = listAt(list, `${at}.comments.${taskOid}`);
        listed.forEach((comment, position) => {
          if (typeof comment.oid !== "string") {
            problem(`${at}.comments.${taskOid}[${position}].oid`, "a text", describe(comment.oid));
          }
        });
        comments[taskOid] = listed;
      }
    }
    projects.push({
      project,
      statuses: listAt(entry.statuses, `${at}.statuses`),
      tags: listAt(entry.tags, `${at}.tags`),
      tasks,
      comments,
    });
  });
  if (problems.length > 0) return { dump: null, problems };
  return {
    dump: { pulledAt: String(parsed.pulledAt), organizations, users, projects },
    problems,
  };
}

// ===== Values =====

/**
 * A list field that the interface documents as a list, which the documented examples also show
 * encoded as JSON text: `"[1,3]"` for `[1, 3]`. Either form is read; anything else is null.
 */
export function listValue(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const decoded = JSON.parse(value) as unknown;
      return Array.isArray(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }
  return null;
}

export const textValue = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * A date of Quire as an instant: a date without a time is noon in UTC of that day, which the
 * portal stores for a date without a time (`dateOnlyInstant`), and a timed value is the instant
 * it names. Returns null for a value that is neither.
 */
export function quireInstant(value: unknown): { readonly instant: string; readonly dateOnly: boolean } | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const instant = `${value}T12:00:00.000Z`;
    return Number.isNaN(Date.parse(instant)) ? null : { instant, dateOnly: true };
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : { instant: new Date(parsed).toISOString(), dateOnly: false };
}

/** The status of a task in the portal: Quire's 0 is the initial status and 100 or more is completed. */
export function statusKeyOf(value: unknown): "toDo" | "inProgress" | "done" | null {
  const number = isRecord(value) ? value.value : null;
  if (typeof number !== "number" || number < 0) return null;
  if (number >= 100) return "done";
  return number === 0 ? "toDo" : "inProgress";
}

/** The priority of a task in the portal from Quire's -1 (low) to 2 (urgent). */
export function priorityOf(value: unknown): "low" | "medium" | "high" | "urgent" | "none" {
  const number = isRecord(value) ? value.value : null;
  switch (number) {
    case -1:
      return "low";
    case 0:
      return "medium";
    case 1:
      return "high";
    case 2:
      return "urgent";
    default:
      return "none";
  }
}

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * The recurrence of a task as a rule of the portal's subset of RFC 5545, or the reason it has no
 * equivalent: a yearly rule, a day in a week of the month, a repetition from the last completion.
 * Quire numbers the days of the week from 0 for Monday.
 */
export function recurrenceRuleOf(value: unknown): { readonly rule: string } | { readonly lossy: string } | null {
  if (!isRecord(value)) return null;
  const interval = typeof value.interval === "number" && value.interval > 1 ? `;INTERVAL=${value.interval}` : "";
  const until =
    typeof value.until === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.until)
      ? `;UNTIL=${value.until.slice(0, 10).replaceAll("-", "")}`
      : "";
  if (value.sincelatest === true) return { lossy: "a repetition from the last completion" };
  switch (value.freq) {
    case "daily":
      return { rule: `FREQ=DAILY${interval}${until}` };
    case "weekly": {
      const days = listValue(value.byweekday);
      if (days === null || days.length === 0 || days.some((day) => typeof day !== "number" || day < 0 || day > 6)) {
        return { lossy: "a weekly rule without days of the week" };
      }
      const codes = [...new Set(days as number[])].sort().map((day) => WEEKDAY_CODES[day]);
      return { rule: `FREQ=WEEKLY${interval};BYDAY=${codes.join(",")}${until}` };
    }
    case "monthly":
      if (value.byweekno !== undefined && value.byweekno !== null) {
        return { lossy: "a monthly rule on a day of a week of the month" };
      }
      if (typeof value.bydayno === "number" && value.bydayno >= 1 && value.bydayno <= 31) {
        return { rule: `FREQ=MONTHLY${interval};BYMONTHDAY=${value.bydayno === 31 ? -1 : value.bydayno}${until}` };
      }
      return { lossy: "a monthly rule without a day" };
    case "yearly":
      return { lossy: "a yearly rule" };
    default:
      return { lossy: "a frequency the documentation does not name" };
  }
}

/**
 * The object identifier of the parent of a task, or null at the top, and whether the chain of its
 * ancestors was cut: past ten ancestors the interface names the eleventh by its oid alone.
 */
export function parentOf(task: QuireRecord): { readonly oid: string | null; readonly cutOff: boolean } {
  const parent = task.parent;
  if (!isRecord(parent)) return { oid: null, cutOff: false };
  let cutOff = false;
  let level: unknown = parent;
  for (let depth = 0; isRecord(level) && depth < 20; depth += 1) {
    if (typeof level.parent === "string") cutOff = true;
    level = level.parent;
  }
  return { oid: typeof parent.oid === "string" ? parent.oid : null, cutOff };
}

/** Whether a TaskUser is an application, which the interface names as a follower or an assignee but no person is. */
export function isApplication(user: QuireRecord): boolean {
  return typeof user.id === "string" && user.id.startsWith("app:");
}

// ===== The missing-fields report (INTEGRATIONS.md, section 4.5) =====

/** What cannot be recovered by any documented route (INTEGRATIONS.md, section 4.1). */
export const UNRECOVERABLE = [
  "The activity history: who changed what, and when. The application keeps it for 5 days on the Free plan, 90 on Professional, 365 on Premium and without limit on Enterprise, and no documented operation returns it.",
  "Earlier values of any field, and the times of assignments, tag changes and date changes.",
  "Who last edited a task: a task carries the time of its last edit and no editor.",
  "Deleted tasks and deleted comments.",
  "The content of attachments: no download operation is documented. Each attachment is listed with its name, kind and size, and its address is kept in the source record only.",
  "The roles and permissions of members.",
  "The email addresses of colleagues, unless the authorising user granted access to contacts.",
  "Folder structure, and the conditions of a sublist built from a filter.",
  "The position of a task among its siblings as a number: it is taken from the order of the returned list.",
  "Anything the authorising user cannot see.",
  "Approval history, the edit history of comments, and comment threads: comments are a flat list.",
  "Read state, notification state, view settings, saved filters and the contents of dashboards.",
] as const;

/** The kinds of record that may be hidden from the operator (INTEGRATIONS.md, section 4.5). */
export const VISIBILITY_GAPS = [
  "Sublists, documents and chats limited to selected members.",
  "Restricted custom fields.",
  "Time logs hidden from guests.",
] as const;

const ATTACHMENT_STORAGE: Readonly<Record<number, string>> = {
  1: "Google Drive",
  2: "Quire storage",
  3: "OneDrive",
  4: "Dropbox",
  5: "Box",
};

export interface MissingFieldsReport {
  readonly runFacts: {
    readonly pulledAt: string;
    readonly fileSha256: string;
    readonly plans: readonly { readonly organization: string; readonly plan: string }[];
  };
  readonly counts: readonly {
    readonly project: string;
    readonly tasks: number;
    readonly comments: number;
    readonly taskCountOnProject: number | null;
    readonly tasksDiffer: boolean;
  }[];
  readonly unrecoverable: readonly string[];
  readonly unmappedKeys: readonly {
    readonly record: string;
    readonly key: string;
    readonly count: number;
    readonly example: string;
  }[];
  readonly absentEverywhere: readonly string[];
  readonly unresolvedReferences: readonly { readonly kind: string; readonly count: number; readonly example: string }[];
  readonly truncation: readonly { readonly kind: string; readonly at: string }[];
  readonly attachments: readonly {
    readonly at: string;
    readonly storage: string;
    readonly bytes: number | null;
    readonly outcome: string;
  }[];
  readonly lossyConversions: readonly { readonly kind: string; readonly count: number; readonly example: string }[];
  readonly visibilityGaps: readonly string[];
}

class Tally {
  readonly #entries = new Map<string, { count: number; example: string }>();
  add(key: string, example: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) this.#entries.set(key, { count: 1, example });
    else entry.count += 1;
  }
  list<T>(build: (key: string, count: number, example: string) => T): T[] {
    return [...this.#entries]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, { count, example }]) => build(key, count, example));
  }
}

/** How the missing-fields report names a parent that the importer cannot keep. */
const PARENT_DEFECT_LOSSES: Readonly<Record<ParentDefect, string>> = {
  ownParent: "a task named as its own parent, imported at the top and raised for review",
  parentCycle: "a task in a cycle of parents, imported at the top and raised for review",
  tooDeep: `a task nested more than ${TASK_MAX_ANCESTORS} levels deep, imported at the top and raised for review`,
};

/**
 * The missing-fields report of a dump. It names keys, counts and object identifiers, never a
 * value: no name, address, title or text of a record.
 */
export function missingFieldsReport(dump: QuireDump, fileSha256: string): MissingFieldsReport {
  const unmapped = new Tally();
  const unresolved = new Tally();
  const lossy = new Tally();
  const truncation: { kind: string; at: string }[] = [];
  const attachments: MissingFieldsReport["attachments"][number][] = [];
  const present = new Set<string>();
  const users = new Map(dump.users.map((user) => [String(user.oid), user]));
  const taskOids = new Set(dump.projects.flatMap((entry) => entry.tasks.map((task) => String(task.oid))));
  const documented = (record: string, keys: readonly string[], value: QuireRecord, at: string) => {
    for (const key of Object.keys(value)) if (!keys.includes(key)) unmapped.add(`${record} ${key}`, at);
  };
  const attachment = (value: unknown, at: string) => {
    for (const file of listValue(value) ?? []) {
      if (!isRecord(file)) continue;
      const type = typeof file.type === "number" ? file.type : 0;
      attachments.push({
        at,
        storage: ATTACHMENT_STORAGE[type] ?? "an unknown storage",
        bytes: typeof file.length === "number" ? file.length : null,
        outcome: type === 2 ? "not copied: no documented download" : "kept as a link in the source record",
      });
    }
  };
  for (const user of dump.users) {
    documented("user", USER_KEYS, user, String(user.oid));
    if (textValue(user.email) === null) unresolved.add("a user with no address", String(user.oid));
  }
  for (const entry of dump.projects) {
    const projectOid = String(entry.project.oid);
    documented("project", PROJECT_KEYS, entry.project, projectOid);
    const tagNames = new Set(entry.tags.map((tag) => String(tag.name)));
    for (const task of entry.tasks) {
      const at = String(task.oid);
      documented("task", TASK_KEYS, task, at);
      for (const key of Object.keys(task)) present.add(key);
      if (isRecord(task.yourField) && Object.keys(task.yourField).length > 0) {
        unmapped.add("task yourField (custom fields)", at);
      }
      const parent = parentOf(task);
      if (parent.cutOff) truncation.push({ kind: "a parent chain cut at its tenth ancestor", at });
      if (parent.oid !== null && !taskOids.has(parent.oid)) unresolved.add("a parent outside the import", at);
      if (task.cropped === true) truncation.push({ kind: "a subtree marked as cropped", at });
      for (const ref of listValue(task.predecessorRefs) ?? []) {
        if (isRecord(ref) && typeof ref.oid === "string" && !taskOids.has(ref.oid)) {
          unresolved.add("a dependency target outside the import", at);
        }
      }
      for (const field of ["assignees", "followers"] as const) {
        for (const member of listValue(task[field]) ?? []) {
          if (!isRecord(member)) continue;
          if (isApplication(member)) unresolved.add(`an application among the ${field}`, at);
          else if (!users.has(String(member.oid))) unresolved.add(`one of the ${field} missing from the user list`, at);
        }
      }
      for (const tag of listValue(task.tags) ?? []) {
        if (isRecord(tag) && !tagNames.has(String(tag.name))) unresolved.add("a tag with no definition", at);
      }
      const recurrence = recurrenceRuleOf(task.recurrence);
      if (recurrence !== null && "lossy" in recurrence)
        lossy.add(`a recurrence with no equivalent: ${recurrence.lossy}`, at);
      for (const field of ["start", "due"] as const) {
        const instant = quireInstant(task[field]);
        if (instant !== null)
          lossy.add(instant.dateOnly ? `a date without a time in ${field}` : `a timed value in ${field}`, at);
      }
      if (task.status !== undefined) lossy.add("a status name, which depends on the language of the project", at);
      if (task.section === true) lossy.add("a section, imported as a task", at);
      if (typeof task.descriptionHtml === "string" && task.descriptionHtml !== "") {
        lossy.add("a description kept as Markdown, its HTML form left in the source record", at);
      }
      if (listValue(task.timelogs) !== null) lossy.add("time logs, kept in the source record only", at);
      attachment(task.attachments, at);
    }
    // What the importer changes to keep the tree and the dependencies of a project free of cycles.
    const projectOids = new Set(entry.tasks.map((task) => String(task.oid)));
    const tree = resolveParents(
      entry.tasks.map((task) => {
        const parent = parentOf(task).oid;
        return { id: String(task.oid), parentId: parent !== null && projectOids.has(parent) ? parent : null };
      }),
    );
    for (const [at, placed] of tree) {
      if (placed.defect !== null) lossy.add(PARENT_DEFECT_LOSSES[placed.defect], at);
    }
    const graph = breakDependencyCycles(
      entry.tasks.map((task) => ({
        id: String(task.oid),
        dependsOn: Object.fromEntries(
          (listValue(task.predecessorRefs) ?? []).flatMap((ref) =>
            isRecord(ref) && typeof ref.oid === "string" && projectOids.has(ref.oid) && ref.oid !== String(task.oid)
              ? [[ref.oid, "finishToStart"]]
              : [],
          ),
        ),
      })),
    );
    for (const edge of graph.dropped) {
      lossy.add("a dependency that would close a cycle, left out and raised for review", edge.from);
    }
    for (const [taskOid, comments] of Object.entries(entry.comments)) {
      if (!taskOids.has(taskOid)) unresolved.add("comments of a task outside the import", taskOid);
      for (const comment of comments) {
        documented("comment", COMMENT_KEYS, comment, String(comment.oid));
        attachment(comment.attachments, String(comment.oid));
        if (textValue(comment.description) === null && textValue(comment.descriptionText) === null) {
          lossy.add(
            "a comment that holds attachments only, imported with a note in place of text",
            String(comment.oid),
          );
        }
      }
    }
  }
  return {
    runFacts: {
      pulledAt: dump.pulledAt,
      fileSha256,
      plans: dump.organizations.map((organization) => ({
        organization: String(organization.oid ?? organization.id ?? "(unknown)"),
        plan:
          textValue(organization.plan) ??
          (isRecord(organization.plan) ? String(organization.plan.name ?? "(unnamed)") : "not reported"),
      })),
    },
    counts: dump.projects.map((entry) => {
      const taskCount = typeof entry.project.taskCount === "number" ? entry.project.taskCount : null;
      return {
        project: String(entry.project.oid),
        tasks: entry.tasks.length,
        comments: Object.values(entry.comments).reduce((total, list) => total + list.length, 0),
        taskCountOnProject: taskCount,
        tasksDiffer: taskCount !== null && taskCount !== entry.tasks.length,
      };
    }),
    unrecoverable: [...UNRECOVERABLE],
    unmappedKeys: unmapped.list((key, count, example) => {
      const [record = "", ...rest] = key.split(" ");
      return { record, key: rest.join(" "), count, example };
    }),
    absentEverywhere: TASK_KEYS.filter((key) => !present.has(key) && key !== "cropped"),
    unresolvedReferences: unresolved.list((kind, count, example) => ({ kind, count, example })),
    truncation,
    attachments,
    lossyConversions: lossy.list((kind, count, example) => ({ kind, count, example })),
    visibilityGaps: [...VISIBILITY_GAPS],
  };
}

/** The report as readable text, for the operator. */
export function reportSummary(report: MissingFieldsReport): string {
  const lines: string[] = ["Quire missing-fields report", ""];
  const section = (title: string, entries: readonly string[]) => {
    lines.push(title, ...(entries.length === 0 ? ["  None."] : entries.map((entry) => `  - ${entry}`)), "");
  };
  section("Run facts", [
    `Pulled at ${report.runFacts.pulledAt}`,
    `File SHA-256 ${report.runFacts.fileSha256}`,
    ...report.runFacts.plans.map((plan) => `Organisation ${plan.organization}: plan ${plan.plan}`),
  ]);
  section(
    "Counts",
    report.counts.map(
      (count) =>
        `Project ${count.project}: ${count.tasks} tasks read, ${count.comments} comments read` +
        (count.taskCountOnProject === null
          ? ", no total on the project record"
          : `, ${count.taskCountOnProject} on the project record${count.tasksDiffer ? " (they differ)" : ""}`),
    ),
  );
  section("Known unrecoverable items", report.unrecoverable);
  section(
    "Unmapped source keys",
    report.unmappedKeys.map((entry) => `${entry.record} ${entry.key}: ${entry.count}, for example ${entry.example}`),
  );
  section("Documented task fields absent everywhere", report.absentEverywhere);
  section(
    "Unresolved references",
    report.unresolvedReferences.map((entry) => `${entry.kind}: ${entry.count}, for example ${entry.example}`),
  );
  section(
    "Truncation and paging signals",
    report.truncation.map((entry) => `${entry.kind} at ${entry.at}`),
  );
  section(
    "Attachments",
    report.attachments.map(
      (entry) =>
        `${entry.at}: ${entry.storage}, ${entry.bytes === null ? "size unknown" : `${entry.bytes} bytes`}, ${entry.outcome}`,
    ),
  );
  section(
    "Lossy conversions",
    report.lossyConversions.map((entry) => `${entry.kind}: ${entry.count}, for example ${entry.example}`),
  );
  section("Visibility gaps", report.visibilityGaps);
  return lines.join("\n");
}
