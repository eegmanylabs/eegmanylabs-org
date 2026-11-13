// Integration tests of the functions of tasks, run against the emulators: lists and templates,
// tasks with their tree, dependencies, links and participants, moves, statuses and their
// history, the next occurrence of a recurring task, reminders, the hand-over of tasks when a
// person claims an account, and progress updates with their notifications.
// Fixtures are synthetic: fictitious accounts, people, laboratories and studies on the example.org domain.
import {
  COLLECTIONS,
  claimProfileContract,
  createTaskContract,
  createTaskListContract,
  dateOnlyInstant,
  moveTaskContract,
  postProgressUpdateContract,
  REMINDERS_PER_USER_MAX,
  setReminderContract,
  setTaskStatusContract,
  shiftIsoDate,
  statusDefinitionId,
  TASK_STATUSES,
  taskDocSchema,
  updateTaskListContract,
  updateTasksContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { createNextOccurrence, occurrenceId } from "../../functions/src/tasks/recurrence";
import { sendDueReminders } from "../../functions/src/tasks/reminders";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  dataOf,
  dataset,
  eventually,
  grantRole,
  laboratory,
  notificationsOf,
  person,
  refusal,
  replication,
  resetWorld,
  standard,
  withTriggers,
} from "./support";

withTriggers();
beforeEach(async () => {
  await resetWorld();
  for (const [position, status] of TASK_STATUSES.entries()) {
    await adminDb.doc(COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("task", status.key))).set({
      ...standard(),
      entityType: "task",
      key: status.key,
      label: status.label,
      category: status.category,
      position,
      isDefault: position === 0,
    });
  }
  await replication("StudyA2001");
  await replication("StudyB2002");
  await laboratory("lab-a");
});

/** A lead of a replication, who manages its task lists. */
async function leadOf(studyKey: string, uid: string): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "replication_lead", "replication", studyKey);
  return caller;
}

/** A member of the portal through a laboratory, who manages nothing. */
async function memberOf(uid: string): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "lab_member", "laboratory", "lab-a");
  return caller;
}

const taskOf = async (taskId: string) => taskDocSchema.parse(await dataOf(`tasks/${taskId}`));

async function projectList(lead: Caller, studyKey = "StudyA2001", name = "Synthetic plan"): Promise<string> {
  const { listId } = await call(lead, createTaskListContract, {
    name,
    kind: "project",
    scopeType: "replication",
    scopeId: studyKey,
  });
  return listId;
}

describe("task lists", () => {
  it("are created personal by any member and for a scope by those who manage it, and renamed and archived so", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const member = await memberOf("uid-member");

    const personal = await call(member, createTaskListContract, {
      name: "My week",
      kind: "personal",
      scopeType: "user",
      scopeId: "uid-member",
    });
    expect(await dataOf(`taskLists/${personal.listId}`)).toMatchObject({
      ownerUid: "uid-member",
      scopeKeys: ["user:uid-member"],
      kind: "personal",
    });
    const listId = await projectList(lead);
    expect(await dataOf(`taskLists/${listId}`)).toMatchObject({
      ownerUid: null,
      replicationId: "StudyA2001",
      scopeKeys: ["rep:StudyA2001"],
    });
    expect(await auditOf("taskList.created", listId)).toHaveLength(1);

    expect(
      await codeOf(
        call(member, createTaskListContract, {
          name: "Not mine",
          kind: "project",
          scopeType: "replication",
          scopeId: "StudyA2001",
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(member, createTaskListContract, {
          name: "Someone else's",
          kind: "personal",
          scopeType: "user",
          scopeId: "uid-lead",
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(lead, createTaskListContract, {
          name: "Nowhere",
          kind: "project",
          scopeType: "replication",
          scopeId: "NoSuchStudy1999",
        }),
      ),
    ).toBe("permission-denied");

    await call(lead, updateTaskListContract, { listId, name: "Renamed plan", archived: true });
    expect(await dataOf(`taskLists/${listId}`)).toMatchObject({ name: "Renamed plan" });
    expect((await dataOf(`taskLists/${listId}`))?.archivedAt).not.toBeNull();
    expect(
      await codeOf(call(lead, createTaskContract, { listId, parentId: null, fields: { title: "Too late" } })),
    ).toBe("failed-precondition");
    expect(await codeOf(call(member, updateTaskListContract, { listId, archived: false }))).toBe("not-found");
  });

  it("copy the tasks of a template with their tree, order, dependencies and reopened checklists", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const { listId: templateId } = await call(lead, createTaskListContract, {
      name: "Onboarding template",
      kind: "template",
      scopeType: "replication",
      scopeId: "StudyA2001",
    });
    const { taskId: parent } = await call(lead, createTaskContract, {
      listId: templateId,
      parentId: null,
      fields: {
        title: "Ethics",
        checklist: { submit: { label: "Submit the application", done: true, order: "i" } },
      },
    });
    const { taskId: child } = await call(lead, createTaskContract, {
      listId: templateId,
      parentId: parent,
      fields: { title: "Translate the consent form", estimateMinutes: 90 },
    });
    await call(lead, createTaskContract, {
      listId: templateId,
      parentId: null,
      fields: { title: "Pilot", dependsOn: { [child]: "finishToStart" } },
    });

    const created = await call(lead, createTaskListContract, {
      name: "Onboarding of StudyB",
      kind: "project",
      scopeType: "replication",
      scopeId: "StudyA2001",
      templateListId: templateId,
    });
    expect(created.copiedTasks).toBe(3);
    const copies = (await adminDb.collection("tasks").where("listId", "==", created.listId).get()).docs.map(
      (snapshot) => ({
        id: snapshot.id,
        data: taskDocSchema.parse(snapshot.data()),
      }),
    );
    const byTitle = new Map(copies.map((copy) => [copy.data.title, copy]));
    const ethics = byTitle.get("Ethics");
    const translate = byTitle.get("Translate the consent form");
    const pilot = byTitle.get("Pilot");
    expect(ethics?.data.checklist).toEqual({ submit: { label: "Submit the application", done: false, order: "i" } });
    expect(translate?.data).toMatchObject({ parentId: ethics?.id, ancestorIds: [ethics?.id], estimateMinutes: 90 });
    expect(pilot?.data.dependsOn).toEqual({ [translate?.id ?? ""]: "finishToStart" });
    expect(copies.every((copy) => copy.data.statusKey === "toDo" && copy.data.scopeKeys[0] === "rep:StudyA2001")).toBe(
      true,
    );
    expect((await dataOf(`taskLists/${created.listId}`))?.templateSourceId).toBe(templateId);
  });
});

describe("a task", () => {
  it("is created nested, with a deadline, a dependency, a link and an assignee, who is notified", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    await memberOf("uid-assignee");
    // The dataset the task links to is in the registry (acceptance scenario 6).
    await dataset("StudyA2001-lab-a-main", "StudyA2001", null);
    const listId = await projectList(lead);
    const { taskId: parent } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Prepare data collection" },
    });
    const { taskId: first } = await call(lead, createTaskContract, {
      listId,
      parentId: parent,
      fields: { title: "Order caps" },
    });
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: parent,
      fields: {
        title: "Run the pilot session",
        priority: "high",
        dueAt: dateOnlyInstant("2027-02-15"),
        assigneeUids: ["uid-assignee"],
        dependsOn: { [first]: "finishToStart" },
        links: [
          { entityType: "replication", entityId: "StudyA2001" },
          { entityType: "dataset", entityId: "StudyA2001-lab-a-main" },
        ],
      },
    });
    const task = await taskOf(taskId);
    expect(task).toMatchObject({
      listId,
      parentId: parent,
      ancestorIds: [parent],
      statusKey: "toDo",
      priority: "high",
      assigneeUids: ["uid-assignee"],
      dependsOn: { [first]: "finishToStart" },
      scopeKeys: ["rep:StudyA2001"],
      replicationId: "StudyA2001",
    });
    expect(task.dueAt?.toDate().toISOString()).toBe("2027-02-15T12:00:00.000Z");
    expect(task.order > (await taskOf(first)).order).toBe(true);
    const history = await dataOf(`statusHistory/${task.statusHistoryId}`);
    expect(history).toMatchObject({ entityType: "task", entityId: taskId, fromStatusKey: null, toStatusKey: "toDo" });
    expect(history?.scopeKeys).toEqual(["rep:StudyA2001", "user:uid-assignee"]);
    expect(await notificationsOf("uid-assignee")).toMatchObject([
      { type: "assignment", entityType: "task", entityId: taskId, payload: { kind: "taskAssigned" } },
    ]);
    expect(await notificationsOf("uid-lead")).toEqual([]);
    expect(await auditOf("task.created", taskId)).toHaveLength(1);
    // The history of the task, which its readers and participants read, names the creation.
    const activity = await adminDb.collection("activity").where("entityId", "==", taskId).get();
    expect(activity.docs.map((entry) => [entry.get("action"), entry.get("actorUid")])).toEqual([
      ["task.created", "uid-lead"],
    ]);
    expect(activity.docs[0]?.get("scopeKeys")).toEqual(["rep:StudyA2001", "user:uid-assignee"]);
  });

  it("refuses a dependency that closes a cycle, a link to nothing and a participant who is no member", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const listId = await projectList(lead);
    const { taskId: a } = await call(lead, createTaskContract, { listId, parentId: null, fields: { title: "A" } });
    const { taskId: b } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "B", dependsOn: { [a]: "finishToStart" } },
    });
    const { taskId: c } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "C", dependsOn: { [b]: "startToStart" } },
    });
    const cycle = await refusal(
      call(lead, updateTasksContract, { changes: [{ taskId: a, patch: { dependsOn: { [c]: "blocks" } } }] }),
    );
    expect(cycle.code).toBe("invalid-argument");
    expect(cycle.message).toContain("cycle");
    expect(
      await codeOf(
        call(lead, updateTasksContract, { changes: [{ taskId: a, patch: { dependsOn: { [a]: "blocks" } } }] }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(lead, updateTasksContract, {
          changes: [{ taskId: a, patch: { links: [{ entityType: "laboratory", entityId: "lab-nowhere" }] } }],
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(lead, updateTasksContract, { changes: [{ taskId: a, patch: { assigneeUids: ["uid-nobody"] } }] }),
      ),
    ).toBe("invalid-argument");
    expect((await taskOf(a)).dependsOn).toEqual({});
  });

  it("is changed in every field by a manager, in some by its participants, and followed by any reader", async () => {
    // A list of the laboratory: its coordinator manages it, and its members read it.
    const lead = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");
    const assignee = await memberOf("uid-assignee");
    const team = await memberOf("uid-team");
    await laboratory("lab-b");
    const outsider = await account("uid-outsider");
    await grantRole("uid-outsider", "lab_member", "laboratory", "lab-b");
    const { listId } = await call(lead, createTaskListContract, {
      name: "Laboratory plan",
      kind: "project",
      scopeType: "laboratory",
      scopeId: "lab-a",
    });
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Analyse the pilot", assigneeUids: ["uid-assignee"] },
    });
    const { taskId: second } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Write the report" },
    });

    await call(assignee, updateTasksContract, {
      changes: [
        {
          taskId,
          patch: { progressPercent: 40, checklist: { clean: { label: "Clean the data", done: true, order: "i" } } },
        },
      ],
    });
    expect(await taskOf(taskId)).toMatchObject({ progressPercent: 40 });
    expect(
      await codeOf(call(assignee, updateTasksContract, { changes: [{ taskId, patch: { title: "Renamed" } }] })),
    ).toBe("permission-denied");
    await call(team, updateTasksContract, { changes: [{ taskId, patch: { followerUids: ["uid-team"] } }] });
    expect((await taskOf(taskId)).followerUids).toEqual(["uid-team"]);
    expect(
      await codeOf(
        call(team, updateTasksContract, {
          changes: [{ taskId, patch: { followerUids: ["uid-team", "uid-outsider"] } }],
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(outsider, updateTasksContract, { changes: [{ taskId, patch: { followerUids: ["uid-outsider"] } }] }),
      ),
    ).toBe("not-found");

    // A bulk edit changes several tasks in one call.
    await call(lead, updateTasksContract, {
      changes: [
        { taskId, patch: { priority: "urgent", dueAt: dateOnlyInstant("2027-03-01") } },
        { taskId: second, patch: { priority: "urgent", dueAt: dateOnlyInstant("2027-03-01") } },
      ],
    });
    expect((await taskOf(taskId)).priority).toBe("urgent");
    expect((await taskOf(second)).priority).toBe("urgent");
    expect(await auditOf("task.updated", second)).toHaveLength(1);
  });
});

describe("moveTask", () => {
  it("moves a task with its subtasks to another list in one transaction, rewriting ancestors and scope", async () => {
    const lead = await account("uid-lead");
    await grantRole("uid-lead", "replication_lead", "replication", "StudyA2001");
    await grantRole("uid-lead", "replication_lead", "replication", "StudyB2002");
    const from = await projectList(lead, "StudyA2001");
    const to = await projectList(lead, "StudyB2002");
    const { taskId: target } = await call(lead, createTaskContract, {
      listId: to,
      parentId: null,
      fields: { title: "Target" },
    });
    const { taskId: root } = await call(lead, createTaskContract, {
      listId: from,
      parentId: null,
      fields: { title: "Root" },
    });
    const { taskId: child } = await call(lead, createTaskContract, {
      listId: from,
      parentId: root,
      fields: { title: "Child" },
    });
    const { taskId: grandchild } = await call(lead, createTaskContract, {
      listId: from,
      parentId: child,
      fields: { title: "Grandchild" },
    });

    expect(await call(lead, moveTaskContract, { taskId: root, listId: to, parentId: target, index: 0 })).toEqual({
      movedTasks: 3,
    });
    expect(await taskOf(root)).toMatchObject({
      listId: to,
      parentId: target,
      ancestorIds: [target],
      scopeKeys: ["rep:StudyB2002"],
    });
    expect(await taskOf(child)).toMatchObject({ listId: to, ancestorIds: [target, root], replicationId: "StudyB2002" });
    expect(await taskOf(grandchild)).toMatchObject({ listId: to, ancestorIds: [target, root, child] });
    expect(await auditOf("task.moved", root)).toHaveLength(1);
  });

  it("refuses a move beneath the task itself or one of its descendants, and a move by someone who manages neither list", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const other = await leadOf("StudyB2002", "uid-other");
    const listId = await projectList(lead);
    const { taskId: root } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Root" },
    });
    const { taskId: child } = await call(lead, createTaskContract, {
      listId,
      parentId: root,
      fields: { title: "Child" },
    });

    const beneath = await refusal(call(lead, moveTaskContract, { taskId: root, listId, parentId: child, index: 0 }));
    expect(beneath.code).toBe("invalid-argument");
    expect(await codeOf(call(lead, moveTaskContract, { taskId: root, listId, parentId: root, index: 0 }))).toBe(
      "invalid-argument",
    );
    expect(await codeOf(call(other, moveTaskContract, { taskId: child, listId, parentId: null, index: 0 }))).toBe(
      "permission-denied",
    );
    expect(await taskOf(root)).toMatchObject({ parentId: null, ancestorIds: [] });

    // Up a level, between two siblings: the order key falls between theirs.
    const { taskId: last } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Last" },
    });
    await call(lead, moveTaskContract, { taskId: child, listId, parentId: null, index: 1 });
    const [rootOrder, childOrder, lastOrder] = [
      (await taskOf(root)).order,
      (await taskOf(child)).order,
      (await taskOf(last)).order,
    ];
    expect(rootOrder < childOrder && childOrder < lastOrder).toBe(true);
    expect(await taskOf(child)).toMatchObject({ parentId: null, ancestorIds: [] });
  });
});

describe("setTaskStatus", () => {
  it("keeps a dated history, sets and clears the completion, tells the assignees and refuses a stale status", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const assignee = await memberOf("uid-assignee");
    const reader = await memberOf("uid-reader");
    const listId = await projectList(lead);
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Book the lab", assigneeUids: ["uid-assignee"], followerUids: ["uid-reader"] },
    });

    const { statusHistoryIds } = await call(assignee, setTaskStatusContract, {
      tasks: [{ taskId, fromStatusKey: "toDo" }],
      toStatusKey: "done",
      reason: "Booked for March.",
    });
    const task = await taskOf(taskId);
    expect(task).toMatchObject({ statusKey: "done", statusHistoryId: statusHistoryIds[0], progressPercent: 100 });
    expect(task.completedAt).not.toBeNull();
    expect(await dataOf(`statusHistory/${statusHistoryIds[0]}`)).toMatchObject({
      fromStatusKey: "toDo",
      toStatusKey: "done",
      changedBy: "uid-assignee",
      reason: "Booked for March.",
    });
    expect(await notificationsOf("uid-reader")).toMatchObject([
      { type: "statusChange", entityId: taskId, payload: { kind: "taskStatusChanged", statusLabel: "Done" } },
    ]);

    expect(
      await codeOf(
        call(lead, setTaskStatusContract, { tasks: [{ taskId, fromStatusKey: "toDo" }], toStatusKey: "inProgress" }),
      ),
    ).toBe("failed-precondition");
    expect(
      await codeOf(
        call(reader, setTaskStatusContract, { tasks: [{ taskId, fromStatusKey: "done" }], toStatusKey: "toDo" }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(lead, setTaskStatusContract, { tasks: [{ taskId, fromStatusKey: "done" }], toStatusKey: "unknown" }),
      ),
    ).toBe("invalid-argument");
    await call(lead, setTaskStatusContract, { tasks: [{ taskId, fromStatusKey: "done" }], toStatusKey: "inProgress" });
    expect((await taskOf(taskId)).completedAt).toBeNull();
    expect(await auditOf("task.statusChanged", taskId)).toHaveLength(2);
  });
});

describe("a recurring task", () => {
  it("is followed by its next occurrence when completed, once, by the trigger", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    await memberOf("uid-assignee");
    const listId = await projectList(lead);
    // The coming Monday, so that each occurrence falls within two weeks of today.
    const today = new Date().toISOString().slice(0, 10);
    const monday = shiftIsoDate(today, (1 - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7 || 7);
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: {
        title: "Weekly check of the recordings",
        dueAt: dateOnlyInstant(monday),
        startAt: dateOnlyInstant(shiftIsoDate(monday, -2)),
        assigneeUids: ["uid-assignee"],
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,TH;COUNT=3",
        checklist: { upload: { label: "Upload", done: false, order: "i" } },
      },
    });
    await call(lead, updateTasksContract, {
      changes: [{ taskId, patch: { checklist: { upload: { label: "Upload", done: true, order: "i" } } } }],
    });
    await call(lead, setTaskStatusContract, { tasks: [{ taskId, fromStatusKey: "toDo" }], toStatusKey: "done" });

    const secondId = occurrenceId(taskId, 2);
    const second = taskDocSchema.parse(await eventually(() => dataOf(`tasks/${secondId}`), "the second occurrence"));
    expect(second).toMatchObject({
      title: "Weekly check of the recordings",
      statusKey: "toDo",
      completedAt: null,
      recurrenceSourceTaskId: taskId,
      assigneeUids: ["uid-assignee"],
      checklist: { upload: { label: "Upload", done: false, order: "i" } },
      listId,
    });
    expect(second.dueAt?.toDate().toISOString()).toBe(`${shiftIsoDate(monday, 3)}T12:00:00.000Z`);
    expect(second.startAt?.toDate().toISOString()).toBe(`${shiftIsoDate(monday, 1)}T12:00:00.000Z`);

    // Delivered again, the event writes nothing new.
    const cause = { eventId: "event-again", at: new Date(), context: {} };
    expect(await createNextOccurrence(adminDb, taskId, cause)).toBeNull();
    // The third occurrence is the last that the count allows.
    await call(lead, setTaskStatusContract, {
      tasks: [{ taskId: secondId, fromStatusKey: "toDo" }],
      toStatusKey: "done",
    });
    const thirdId = occurrenceId(taskId, 3);
    await eventually(() => dataOf(`tasks/${thirdId}`), "the third occurrence");
    await call(lead, setTaskStatusContract, {
      tasks: [{ taskId: thirdId, fromStatusKey: "toDo" }],
      toStatusKey: "done",
    });
    expect(await createNextOccurrence(adminDb, thirdId, cause)).toBeNull();
    expect(await dataOf(`tasks/${occurrenceId(taskId, 4)}`)).toBeUndefined();
  });
});

describe("a recurring task completed far ahead of its dates", () => {
  it("brings no occurrence more than two intervals after today, so that no one runs a series ahead", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    await memberOf("uid-assignee");
    const listId = await projectList(lead);
    const today = new Date().toISOString().slice(0, 10);
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: {
        title: "Daily synthetic check",
        dueAt: dateOnlyInstant(shiftIsoDate(today, 30)),
        assigneeUids: ["uid-assignee"],
        recurrenceRule: "FREQ=DAILY",
      },
    });
    await call(lead, setTaskStatusContract, { tasks: [{ taskId, fromStatusKey: "toDo" }], toStatusKey: "done" });
    const cause = { eventId: "event-ahead", at: new Date(), context: {} };
    expect(await createNextOccurrence(adminDb, taskId, cause)).toBeNull();
    expect(await dataOf(`tasks/${occurrenceId(taskId, 2)}`)).toBeUndefined();
  });
});

describe("reminders", () => {
  it("are delivered in the portal once, when due, and only about records their owner still reads", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const member = await memberOf("uid-member");
    const listId = await projectList(lead);
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Send the consent forms", followerUids: [member.uid] },
    });
    const reminder = (uid: string, minutes: number, channel: "inApp" | "email") => ({
      ...standard(),
      uid,
      entityType: "task",
      entityId: taskId,
      remindAt: Timestamp.fromMillis(Date.now() + minutes * 60_000),
      sentAt: null,
      channel,
    });
    await adminDb.doc("reminders/due-own").set(reminder("uid-member", -5, "inApp"));
    await adminDb.doc("reminders/later").set(reminder("uid-member", 60, "inApp"));
    await adminDb.doc("reminders/email").set(reminder("uid-member", -5, "email"));
    await adminDb.doc("reminders/unread").set(reminder("uid-stranger", -5, "inApp"));

    expect(await sendDueReminders(adminDb, new Date())).toEqual({ delivered: 1, withdrawn: 1 });
    expect(await notificationsOf("uid-member")).toMatchObject([
      {
        type: "reminder",
        entityType: "task",
        entityId: taskId,
        payload: { kind: "reminderDue", title: "Send the consent forms" },
      },
    ]);
    expect((await dataOf("reminders/due-own"))?.sentAt).not.toBeNull();
    expect((await dataOf("reminders/unread"))?.sentAt).not.toBeNull();
    expect((await dataOf("reminders/later"))?.sentAt).toBeNull();
    expect((await dataOf("reminders/email"))?.sentAt).toBeNull();
    expect(await sendDueReminders(adminDb, new Date())).toEqual({ delivered: 0, withdrawn: 0 });
    expect(await notificationsOf("uid-member")).toHaveLength(1);
  });
});

describe("setReminder", () => {
  it("sets a reminder about a task its owner reads, with its audit entry, and refuses any other", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const member = await memberOf("uid-member");
    const listId = await projectList(lead);
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Send the consent forms", followerUids: [member.uid] },
    });
    const { listId: personal } = await call(lead, createTaskListContract, {
      name: "Synthetic personal list",
      kind: "personal",
      scopeType: "user",
      scopeId: lead.uid,
    });
    const { taskId: hidden } = await call(lead, createTaskContract, {
      listId: personal,
      parentId: null,
      fields: { title: "A private synthetic errand" },
    });
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    const set = (entityId: string, remindAt: string) =>
      call(member, setReminderContract, { entityType: "task", entityId, remindAt, channel: "inApp" });

    const { reminderId } = await set(taskId, inMinutes(60));
    expect(await dataOf(`reminders/${reminderId}`)).toMatchObject({
      uid: member.uid,
      entityType: "task",
      entityId: taskId,
      sentAt: null,
      channel: "inApp",
    });
    expect(await auditOf("reminder.set", taskId)).toHaveLength(1);
    // A task the member may not open is refused as one that does not exist.
    const unread = await refusal(set(hidden, inMinutes(60)));
    expect(unread.code).toBe("not-found");
    expect((await refusal(set("taskThatDoesNotExist", inMinutes(60)))).message).toBe(unread.message);
    // No reminder dated long ago, to stand before everyone else's, and none years ahead.
    expect(await codeOf(set(taskId, new Date(0).toISOString()))).toBe("invalid-argument");
    expect(await codeOf(set(taskId, inMinutes(800 * 24 * 60)))).toBe("invalid-argument");
  });

  it("refuses a reminder beyond the most a user holds that are not yet sent", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const listId = await projectList(lead);
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Book a room" },
    });
    for (let first = 0; first < REMINDERS_PER_USER_MAX; first += 250) {
      const batch = adminDb.batch();
      for (let index = first; index < Math.min(REMINDERS_PER_USER_MAX, first + 250); index += 1) {
        batch.set(adminDb.collection("reminders").doc(), {
          ...standard(),
          uid: lead.uid,
          entityType: "task",
          entityId: taskId,
          remindAt: Timestamp.fromMillis(Date.now() + 86_400_000),
          sentAt: null,
          channel: "inApp",
        });
      }
      await batch.commit();
    }
    expect(
      await codeOf(
        call(lead, setReminderContract, {
          entityType: "task",
          entityId: taskId,
          remindAt: new Date(Date.now() + 3_600_000).toISOString(),
          channel: "inApp",
        }),
      ),
    ).toBe("resource-exhausted");
  });
});

describe("a dependency or a link to a record the caller may not open", () => {
  it("is refused as a record that does not exist, so that nobody learns whether it does", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const other = await leadOf("StudyB2002", "uid-other-lead");
    const listId = await projectList(lead);
    const { taskId } = await call(lead, createTaskContract, { listId, parentId: null, fields: { title: "Mine" } });
    const otherList = await projectList(other, "StudyB2002", "Another plan");
    const { taskId: foreign } = await call(other, createTaskContract, {
      listId: otherList,
      parentId: null,
      fields: { title: "Not for StudyA2001" },
    });
    const missing = await refusal(
      call(lead, updateTasksContract, {
        changes: [{ taskId, patch: { dependsOn: { taskThatDoesNotExist: "blocks" } } }],
      }),
    );
    const unreadable = await refusal(
      call(lead, updateTasksContract, { changes: [{ taskId, patch: { dependsOn: { [foreign]: "blocks" } } }] }),
    );
    expect(unreadable.code).toBe("invalid-argument");
    expect(unreadable.message).toBe(missing.message);
    const linked = await refusal(
      call(lead, updateTasksContract, {
        changes: [{ taskId, patch: { links: [{ entityType: "task", entityId: foreign }] } }],
      }),
    );
    expect(linked.code).toBe("invalid-argument");
    expect((await taskOf(taskId)).dependsOn).toEqual({});
  });
});

describe("the claim of an account", () => {
  it("hands the person's tasks over to the account, in the role the task names", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    await person("person-new", [{ email: "new.member@example.org" }]);
    const listId = await projectList(lead);
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: {
        title: "Translate the instructions",
        unclaimedParticipants: [
          { personId: "person-new", role: "assignee" },
          { personId: "person-new", role: "follower" },
        ],
      },
    });
    const claimant = await account("uid-new", { email: "new.member@example.org" });

    expect(await call(claimant, claimProfileContract, {})).toEqual({ status: "linked", personId: "person-new" });
    expect(await taskOf(taskId)).toMatchObject({
      assigneeUids: ["uid-new"],
      followerUids: ["uid-new"],
      unclaimedParticipants: [],
    });
    expect(await auditOf("task.participantClaimed", taskId)).toHaveLength(1);
  });
});

describe("postProgressUpdate", () => {
  it("adds a dated update to the feed of a record and tells its followers and the members it mentions", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const follower = await memberOf("uid-follower");
    await memberOf("uid-mentioned");
    const outsider = await memberOf("uid-outsider");
    await adminDb.doc(COLLECTIONS.userSubscriptions.docPath(follower.uid, "replication__StudyA2001")).set({
      ...standard(),
      uid: follower.uid,
      entityType: "replication",
      entityId: "StudyA2001",
      level: "all",
    });

    const { updateId } = await call(lead, postProgressUpdateContract, {
      entityType: "replication",
      entityId: "StudyA2001",
      body: "Piloting is complete. @[Synthetic mentioned](uid-mentioned) will run the next session.",
      mentionUids: ["uid-mentioned"],
      pinned: true,
    });
    expect(await dataOf(`progressUpdates/${updateId}`)).toMatchObject({
      entityType: "replication",
      entityId: "StudyA2001",
      authorUid: "uid-lead",
      pinned: true,
      scopeKeys: ["rep:StudyA2001", "members"],
    });
    expect(await notificationsOf(follower.uid)).toMatchObject([
      { type: "progressUpdate", entityId: "StudyA2001", payload: { kind: "progressUpdatePosted" } },
    ]);
    expect(await notificationsOf("uid-mentioned")).toMatchObject([{ type: "mention", entityId: "StudyA2001" }]);
    expect(await notificationsOf("uid-lead")).toEqual([]);
    expect(await auditOf("progressUpdate.posted", "StudyA2001")).toHaveLength(1);

    expect(
      await codeOf(
        call(outsider, postProgressUpdateContract, {
          entityType: "replication",
          entityId: "StudyA2001",
          body: "Not my replication.",
          mentionUids: [],
          pinned: false,
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(lead, postProgressUpdateContract, {
          entityType: "replication",
          entityId: "StudyA2001",
          body: "A mention that is not in the text.",
          mentionUids: ["uid-outsider"],
          pinned: false,
        }),
      ),
    ).toBe("invalid-argument");
    // A member posts on their own record, and an administrator on anyone's.
    const admin = await administrator("uid-admin");
    await person("person-follower", [], { userId: "uid-follower" });
    await adminDb.doc("users/uid-follower").update({ personId: "person-follower" });
    expect(
      await codeOf(
        call(admin, postProgressUpdateContract, {
          entityType: "person",
          entityId: "person-follower",
          body: "Welcome to the programme.",
          mentionUids: [],
          pinned: false,
        }),
      ),
    ).toBe("(no error)");
  });

  it("tells only active members of a mention, and lets an author post on one record once a minute", async () => {
    const lead = await leadOf("StudyA2001", "uid-lead");
    const post = (body: string, mentionUids: string[]) =>
      call(lead, postProgressUpdateContract, {
        entityType: "replication",
        entityId: "StudyA2001",
        body,
        mentionUids,
        pinned: false,
      });
    await post("Synthetic news for @[Nobody](uid-nobody-at-all).", ["uid-nobody-at-all"]);
    expect(await notificationsOf("uid-nobody-at-all")).toEqual([]);
    expect(await codeOf(post("And again at once.", []))).toBe("resource-exhausted");
  });
});
