// Source I: Quire (docs/MIGRATION_PLAN.md, section 4.10, and docs/INTEGRATIONS.md, section 4).
//
// The input is the dump of a read-only pull through Quire's REST interface, in the layout that
// quire-dump.ts describes. No real Quire export or token existed when this importer was written,
// so it is built to the documented record shapes and tested against synthetic fixtures alone.
// A file of another layout stops the import with a report of where it differs.
//
// | Quire record | Becomes                                                                       |
// |--------------|-------------------------------------------------------------------------------|
// | Project      | A project list of the programme, `taskLists/quire__project__<hash>`           |
// | Task         | A task or a milestone of that list, `tasks/quire__task__<hash>`, nested by its parent |
// | Tag          | A shared tag, keyed by the hash of its folded name                            |
// | Comment      | A comment in the thread of its task, `threads/quire__thread__<hash>`          |
// | User         | Nothing of its own: an assignee or a follower is linked to a person through the identity key of their address |
//
// Every identifier is derived from the hash of the Quire object identifier, which the plan of
// INTEGRATIONS.md allows, so that no identifier ever holds a word of a source value. Every list
// and task keeps `source` with the system `quire`, the object identifier and the address of the
// record in Quire, and every document names its source records. A person who has claimed an
// account is named by the account in the uid arrays; a person without one in
// `unclaimedParticipants`, from which the claim of the account moves them; and a user that no
// person matches is left off the task and raised in the review queue. Every run writes a
// missing-fields report beside the input (`report`).
//
// | Reason for a raw record | The row                                                        |
// |-------------------------|----------------------------------------------------------------|
// | `userLinksPerson`       | A user that a person matches: it links tasks to the person and is no record of its own |
// | `projectNotImported`    | A task whose project is not in the dump                         |
// | `taskNotImported`       | A comment whose task is not in the dump                         |
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  breakDependencyCycles,
  COLLECTIONS,
  lookupFold,
  MEMBERS_SCOPE_KEY,
  PROGRAMME_KEY,
  PROGRAMME_SCOPE_KEY,
  resolveParents,
  shortHash,
  type TaskDoc,
  tagId,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { personEvidence } from "../identity";
import type {
  ImporterDefinition,
  ImportInput,
  ImportPlan,
  PlanContext,
  RecordedRow,
  SourceReading,
  SourceRow,
  StructureIssue,
} from "../model";
import { PlanBuilder } from "../plan";
import {
  isApplication,
  listValue,
  missingFieldsReport,
  parentOf,
  parseDump,
  priorityOf,
  type QuireRecord,
  quireInstant,
  recurrenceRuleOf,
  reportSummary,
  statusKeyOf,
  textValue,
} from "../quire-dump";
import { sha256OfBytes } from "../values";
import { inputFileOf } from "../workbook-rows";

const SOURCE_KEY = "i";
const SYSTEM = "quire";
const TABS = { users: "users", projects: "projects", tasks: "tasks", comments: "comments" } as const;

/** The identifier of an imported record: its kind and the hash of its object identifier. */
export const quireId = (kind: "project" | "task" | "thread" | "comment", oid: string) =>
  `quire__${kind}__${shortHash(oid)}`;

const json = (value: unknown) => JSON.stringify(value);
const recordOf = (row: Pick<SourceRow, "cells" | "labels">): QuireRecord => {
  const index = row.labels.indexOf("record");
  const cell = row.cells[index];
  return JSON.parse(typeof cell === "string" ? cell : "{}") as QuireRecord;
};

async function read(input: ImportInput): Promise<SourceReading> {
  const issues: StructureIssue[] = [];
  if (!existsSync(input.path) || !statSync(input.path).isFile()) {
    issues.push({
      check: "input",
      tabKey: null,
      message: "The input is not a file. Name the JSON dump of the Quire pull.",
      expected: "a file",
      found: "something else",
    });
    return { contentHash: sha256OfBytes(new Uint8Array()), inputFiles: [], tabs: [], issues };
  }
  const bytes = readFileSync(input.path);
  const contentHash = sha256OfBytes(bytes);
  const inputFiles = [inputFileOf(input.path, contentHash)];
  const { dump, problems } = parseDump(bytes.toString("utf8"));
  if (dump === null) {
    for (const problem of problems) {
      issues.push({
        check: "layout",
        tabKey: null,
        message: `The file differs from the documented layout of a Quire pull at ${problem.at}.`,
        expected: problem.expected,
        found: problem.found,
      });
    }
    return { contentHash, inputFiles, tabs: [], issues };
  }
  const row = (rowNumber: number, rowKey: string, record: unknown, personal?: Record<string, unknown>): SourceRow => {
    const labels = [...Object.keys(personal ?? {}), "record"];
    const cells = [
      ...Object.values(personal ?? {}).map((value) => (typeof value === "string" ? value : null)),
      json(record),
    ];
    return {
      rowClass: "data",
      rowNumber,
      rowKey,
      cells,
      labels,
      ...(personal === undefined ? {} : { personal: Object.keys(personal) }),
    };
  };
  const users = dump.users.map((user, index) => {
    const { name, nameText, email, ...rest } = user;
    return row(index + 1, String(user.oid), rest, { name: name ?? nameText ?? null, email: email ?? null });
  });
  const projects = dump.projects.map((entry, index) =>
    row(index + 1, String(entry.project.oid), { project: entry.project, statuses: entry.statuses, tags: entry.tags }),
  );
  let taskNumber = 0;
  const tasks = dump.projects.flatMap((entry) =>
    entry.tasks.map((task, position) => {
      taskNumber += 1;
      return row(taskNumber, String(task.oid), { projectOid: entry.project.oid, position, task });
    }),
  );
  let commentNumber = 0;
  const comments = dump.projects.flatMap((entry) =>
    Object.entries(entry.comments).flatMap(([taskOid, list]) =>
      list.map((comment, position) => {
        commentNumber += 1;
        return row(commentNumber, String(comment.oid), { taskOid, position, comment });
      }),
    ),
  );
  const tab = (tabKey: string, rows: readonly SourceRow[]) => ({
    tabKey,
    name: tabKey,
    visibility: "visible" as const,
    rows,
    fillerRows: 0,
    blankRows: 0,
  });
  const duplicates = [users, projects, tasks, comments].flatMap((rows) => {
    const keys = rows.map((entry) => entry.rowKey);
    return keys.filter((key, index) => keys.indexOf(key) !== index);
  });
  for (const key of new Set(duplicates)) {
    issues.push({
      check: "duplicateOid",
      tabKey: null,
      message: `The object identifier ${key} occurs twice in one kind of record, so the records cannot be told apart.`,
      expected: "each oid once",
      found: "an oid twice",
    });
  }
  return {
    contentHash,
    inputFiles,
    tabs: [tab(TABS.users, users), tab(TABS.projects, projects), tab(TABS.tasks, tasks), tab(TABS.comments, comments)],
    issues,
  };
}

/** Who a Quire user is in the portal: an account, a person without an account, or nobody yet. */
type Participant = { readonly uid: string } | { readonly personId: string } | null;

async function plan(context: PlanContext): Promise<ImportPlan> {
  const builder = new PlanBuilder();
  const rows = (tabKey: string): readonly RecordedRow[] => context.rows.get(tabKey) ?? [];
  const scope = { replicationId: null, laboratoryId: null, scopeKeys: [MEMBERS_SCOPE_KEY, PROGRAMME_SCOPE_KEY] };

  // Users: each to the person whose address it carries, where exactly one person holds it.
  const participants = new Map<string, Participant>();
  for (const row of rows(TABS.users)) {
    const address = row.cells[row.labels.indexOf("email")];
    const evidence = typeof address === "string" ? personEvidence.email(address) : null;
    const resolution =
      evidence === null ? { status: "unresolved" as const } : await context.identities.resolvePerson([evidence]);
    if (resolution.status === "existing") {
      const person = await context.db.doc(COLLECTIONS.persons.docPath(resolution.personId)).get();
      const userId = person.get("userId");
      participants.set(
        row.rowKey,
        typeof userId === "string" && userId !== "" ? { uid: userId } : { personId: resolution.personId },
      );
      builder.rawOnly(row.recordId, "userLinksPerson");
      continue;
    }
    participants.set(row.rowKey, null);
    const claim = { source: `${SOURCE_KEY}/users`, value: row.rowKey, sourceRecordId: row.recordId };
    builder.item(
      resolution.status === "ambiguous"
        ? context.items.ambiguousEmail({
            subject: `${SOURCE_KEY}/users/${row.rowKey}`,
            entityRefs: resolution.personIds.map((personId) => ({ entityType: "person", entityId: personId })),
            claims: [claim],
          })
        : context.items.unmatchedIdentifier({
            subject: `${SOURCE_KEY}/users/${row.rowKey}`,
            field: "email",
            claims: [claim],
          }),
    );
  }

  // Projects: one list of the programme each.
  const lists = new Map<string, string>();
  const tagRecords = new Map<string, string>();
  for (const row of rows(TABS.projects)) {
    const entry = recordOf(row);
    const project = entry.project as QuireRecord;
    const listId = quireId("project", row.rowKey);
    lists.set(row.rowKey, listId);
    builder.document({
      collection: "taskLists",
      ids: [listId],
      fixed: {
        kind: "project",
        ownerUid: null,
        scopeType: "programme",
        scopeId: PROGRAMME_KEY,
        ...scope,
        source: { system: SYSTEM, id: row.rowKey, ...(textValue(project.url) === null ? {} : { url: project.url }) },
      },
      owned: { name: textValue(project.nameText) ?? textValue(project.name) ?? `Quire project ${project.id}` },
      sourceRecordIds: [row.recordId],
    });
    for (const tag of listValue(entry.tags) ?? []) {
      const name = typeof tag === "object" && tag !== null ? textValue((tag as QuireRecord).name) : null;
      if (name === null || lookupFold(name) === "") continue;
      tagRecords.set(name, row.recordId);
    }
  }
  for (const [name, recordId] of tagRecords) {
    builder.document({
      collection: "tags",
      ids: [tagId(name)],
      fixed: { name, nameFolded: lookupFold(name) },
      sourceRecordIds: [recordId],
    });
  }

  // Tasks: first every identifier, so that a parent or a dependency resolves whatever the order.
  const tasks = rows(TABS.tasks).map((row) => ({ row, entry: recordOf(row) }));
  const taskIds = new Map(tasks.map(({ row }) => [row.rowKey, quireId("task", row.rowKey)]));
  const parents = new Map(tasks.map(({ row, entry }) => [row.rowKey, parentOf(entry.task as QuireRecord).oid]));
  const listByOid = new Map(tasks.map(({ row, entry }) => [row.rowKey, lists.get(String(entry.projectOid))]));
  const imported = tasks.filter(({ row }) => listByOid.get(row.rowKey) !== undefined);
  // The importer writes past the functions, so it keeps their promises itself: the parents form
  // a tree within one list, `ancestorIds` follows the parent written, and no dependency closes a
  // cycle. What it has to change is raised for review and named in the missing-fields report.
  const tree = resolveParents(
    imported.map(({ row }) => {
      const parentOid = parents.get(row.rowKey) ?? null;
      const sameList = parentOid !== null && listByOid.get(parentOid) === listByOid.get(row.rowKey);
      return { id: row.rowKey, parentId: sameList ? parentOid : null };
    }),
  );
  const graph = breakDependencyCycles(
    imported.map(({ row, entry }) => {
      const dependsOn: Record<string, string> = {};
      for (const ref of listValue((entry.task as QuireRecord).predecessorRefs) ?? []) {
        const oid = typeof ref === "object" && ref !== null ? (ref as QuireRecord).oid : null;
        if (typeof oid === "string" && listByOid.get(oid) !== undefined && oid !== row.rowKey) {
          dependsOn[oid] = "finishToStart";
        }
      }
      return { id: row.rowKey, dependsOn };
    }),
  );
  for (const { row } of imported) {
    const defect = tree.get(row.rowKey)?.defect ?? null;
    if (defect === null) continue;
    builder.item(
      context.items.unparsedValue({
        subject: `${SOURCE_KEY}/tasks/${row.rowKey}`,
        field: "parent",
        claims: [
          {
            source: `${SOURCE_KEY}/tasks`,
            value: `${defect} ${String(parents.get(row.rowKey))}`,
            sourceRecordId: row.recordId,
          },
        ],
      }),
    );
  }
  for (const edge of graph.dropped) {
    const recordId = tasks.find(({ row }) => row.rowKey === edge.from)?.row.recordId;
    builder.item(
      context.items.unparsedValue({
        subject: `${SOURCE_KEY}/tasks/${edge.from}`,
        field: "predecessorRefs",
        claims: [
          {
            source: `${SOURCE_KEY}/tasks`,
            value: `dependencyCycle ${edge.to}`,
            ...(recordId === undefined ? {} : { sourceRecordId: recordId }),
          },
        ],
      }),
    );
  }
  const taskOrder = new Map<string, string>();
  for (const { row, entry } of tasks) {
    const task = entry.task as QuireRecord;
    const listId = lists.get(String(entry.projectOid));
    if (listId === undefined) {
      builder.rawOnly(row.recordId, "projectNotImported");
      continue;
    }
    const id = taskIds.get(row.rowKey) as string;
    const placed = tree.get(row.rowKey);
    const parentId = placed?.parentId == null ? null : (taskIds.get(placed.parentId) ?? null);
    const ancestors = (placed?.ancestorIds ?? []).map((oid) => taskIds.get(oid) as string);
    // The position in the returned list, which the documentation does not promise is the display order.
    const order = `${String(Number(entry.position) + 1).padStart(6, "0")}1`;
    taskOrder.set(id, order);
    const assigneeUids: string[] = [];
    const followerUids: string[] = [];
    const unclaimed: { personId: string; role: "assignee" | "follower" }[] = [];
    for (const [field, uids, role] of [
      ["assignees", assigneeUids, "assignee"],
      ["followers", followerUids, "follower"],
    ] as const) {
      for (const member of listValue(task[field]) ?? []) {
        if (typeof member !== "object" || member === null || isApplication(member as QuireRecord)) continue;
        const who = participants.get(String((member as QuireRecord).oid));
        if (who == null) continue;
        if ("uid" in who) uids.push(who.uid);
        else unclaimed.push({ personId: who.personId, role });
      }
    }
    const dependsOn: Record<string, string> = Object.fromEntries(
      Object.entries(graph.dependsOn.get(row.rowKey) ?? {}).map(([oid, kind]) => [taskIds.get(oid) as string, kind]),
    );
    const status = statusKeyOf(task.status) ?? "toDo";
    const start = quireInstant(task.start);
    const due = quireInstant(task.due);
    const completed = status === "done" ? (quireInstant(task.toggledAt) ?? quireInstant(task.editedAt)) : null;
    const milestone = task.milestone === true;
    const recurrence = recurrenceRuleOf(task.recurrence);
    const description = textValue(task.description) ?? textValue(task.descriptionText);
    const created = quireInstant(task.createdAt);
    const fields: Partial<Record<keyof TaskDoc, unknown>> = {
      title: (textValue(task.nameText) ?? textValue(task.name) ?? `Quire task ${task.id}`).slice(0, 300),
      kind: milestone ? "milestone" : "task",
      statusKey: status,
      priority: priorityOf(task.priority),
      completedAt: completed === null ? null : Timestamp.fromDate(new Date(completed.instant)),
      assigneeUids: [...new Set(assigneeUids)],
      followerUids: [...new Set(followerUids)],
      unclaimedParticipants: unclaimed,
      dependsOn,
      tagIds: [
        ...new Set(
          (listValue(task.tags) ?? []).flatMap((tag) => {
            const name = typeof tag === "object" && tag !== null ? textValue((tag as QuireRecord).name) : null;
            return name !== null && lookupFold(name) !== "" ? [tagId(name)] : [];
          }),
        ),
      ],
      ...(description === null ? {} : { description: description.slice(0, 100_000) }),
      ...(due === null ? {} : { dueAt: Timestamp.fromDate(new Date(due.instant)) }),
      ...(start === null || milestone ? {} : { startAt: Timestamp.fromDate(new Date(start.instant)) }),
      ...(typeof task.etc === "number" && !milestone && task.etc >= 0
        ? { estimateMinutes: Math.round(task.etc / 60) }
        : {}),
      ...(recurrence !== null && "rule" in recurrence && !milestone ? { recurrenceRule: recurrence.rule } : {}),
    };
    builder.document({
      collection: "tasks",
      ids: [id],
      fixed: {
        listId,
        ownerUid: null,
        mentionUids: [],
        statusHistoryId: null,
        collaboratorUids: [],
        links: [],
        checklist: {},
        custom: {},
        ...scope,
        source: { system: SYSTEM, id: row.rowKey, ...(textValue(task.url) === null ? {} : { url: task.url }) },
        ...(created === null ? {} : { sourceCreatedAt: Timestamp.fromDate(new Date(created.instant)) }),
      },
      owned: { ...fields, parentId, ancestorIds: ancestors, order },
      sourceRecordIds: [row.recordId],
    });
  }

  // Comments: a thread for each task that has any, which the task's readers read.
  const threads = new Set<string>();
  for (const row of rows(TABS.comments)) {
    const entry = recordOf(row);
    const taskId = taskIds.get(String(entry.taskOid));
    if (taskId === undefined) {
      builder.rawOnly(row.recordId, "taskNotImported");
      continue;
    }
    const comment = entry.comment as QuireRecord;
    const threadId = quireId("thread", String(entry.taskOid));
    if (!threads.has(threadId)) {
      threads.add(threadId);
      builder.document({
        collection: "threads",
        ids: [threadId],
        fixed: {
          targetType: "task",
          targetId: taskId,
          restricted: false,
          resolvedAt: null,
          resolvedBy: null,
          ...scope,
        },
        sourceRecordIds: [row.recordId],
      });
    }
    const author = comment.createdBy;
    const authorOid = typeof author === "object" && author !== null ? String((author as QuireRecord).oid) : "";
    const who = participants.get(authorOid);
    const authorName =
      typeof author === "object" && author !== null ? (textValue((author as QuireRecord).name) ?? "") : "";
    const text = textValue(comment.description) ?? textValue(comment.descriptionText);
    const created = quireInstant(comment.createdAt);
    const edited = quireInstant(comment.editedAt);
    builder.document({
      collection: "threadComments",
      ids: [threadId, quireId("comment", row.rowKey)],
      fixed: {
        threadId,
        mentionUids: [],
        deletedAt: null,
        ...scope,
        ...(who != null && "uid" in who
          ? { authorUid: who.uid }
          : {
              sourceAuthor: {
                personId: who != null && "personId" in who ? who.personId : null,
                nameSource: authorName,
              },
            }),
        ...(created === null ? {} : { sourceCreatedAt: Timestamp.fromDate(new Date(created.instant)) }),
      },
      owned: {
        body: text ?? "This comment held attachments only. They are listed in the missing-fields report.",
        editedAt: edited === null ? null : Timestamp.fromDate(new Date(edited.instant)),
      },
      sourceRecordIds: [row.recordId],
    });
  }
  return builder.build();
}

/** The missing-fields report of a dump, as data and as text. Null where the file is no dump. */
export function quireReport(input: ImportInput): { readonly data: unknown; readonly summary: string } | null {
  if (!existsSync(input.path)) return null;
  const bytes = readFileSync(input.path);
  const { dump } = parseDump(bytes.toString("utf8"));
  if (dump === null) return null;
  const data = missingFieldsReport(dump, sha256OfBytes(bytes));
  return { data, summary: reportSummary(data) };
}

export const importer: ImporterDefinition = {
  key: "quire",
  // An exported file that an administrator supplies, read from outside the repository alone (decision 7).
  localExport: true,
  sourceKey: SOURCE_KEY,
  summary: "Quire: projects, nested tasks, assignees, dates, statuses, tags and comments",
  inputDescription: "the JSON dump of a read-only pull through the Quire interface",
  after: ["h"],
  read,
  plan,
  report: async (input) => quireReport(input),
};
