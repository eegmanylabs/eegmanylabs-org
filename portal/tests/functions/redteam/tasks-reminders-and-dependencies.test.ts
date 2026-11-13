// Red-team attacks on the functions of tasks (docs/DATA_MODEL.md, section 8), made through the
// functions emulator and the reminder sweep as members who try to read what their scope does not
// give them, or to break what the functions promise to keep:
//
// - a member sets a reminder about another member's personal task list, which the rules accept
//   for any record of any entity type, and the sweep tells them its name;
// - a member floods the reminder queue with reminders dated long ago, which the rules accept, and
//   the reminders of everyone else wait behind them;
// - a manager closes a cycle of dependencies in one call that changes both tasks, each change
//   being checked against the stored tasks and not against the other change.
//
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, laboratories and studies on the example.org domain.
import {
  COLLECTIONS,
  createTaskContract,
  createTaskListContract,
  dependencyCycles,
  statusDefinitionId,
  TASK_STATUSES,
  taskDocSchema,
  updateTasksContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { REMINDERS_PER_RUN, sendDueReminders } from "../../../functions/src/tasks/reminders";
import { adminDb } from "../../support/admin";
import {
  account,
  type Caller,
  call,
  codeOf,
  grantRole,
  laboratory,
  notificationsOf,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "../support";

withoutTriggers();
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
  await replication("RedTeamTasks2001");
  await laboratory("lab-redteam-tasks");
});

async function memberOf(uid: string): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "lab_member", "laboratory", "lab-redteam-tasks");
  return caller;
}

/** A reminder exactly as the rules accept it from its owner's client. */
const reminder = (uid: string, entityType: string, entityId: string, remindAt: Timestamp) => ({
  ...standard(),
  uid,
  entityType,
  entityId,
  remindAt,
  sentAt: null,
  channel: "inApp",
});

describe("reminders", () => {
  it("never tell their owner the name of a record the owner may not read", async () => {
    const owner = await memberOf("uid-redteam-owner");
    await memberOf("uid-redteam-snoop");
    const { listId } = await call(owner, createTaskListContract, {
      name: "Appointments with the synthetic clinic",
      kind: "personal",
      scopeType: "user",
      scopeId: owner.uid,
    });
    // The rules check only that the entity type is known and the identifier well formed.
    await adminDb
      .doc("reminders/redteamSnoopList00001")
      .set(reminder("uid-redteam-snoop", "taskList", listId, Timestamp.fromMillis(Date.now() - 60_000)));

    await sendDueReminders(adminDb, new Date());

    const told = await notificationsOf("uid-redteam-snoop");
    expect(JSON.stringify(told)).not.toContain("synthetic clinic");
    expect(told).toEqual([]);
  });

  it("are delivered when due however many reminders another member dates in the past", async () => {
    await memberOf("uid-redteam-flooder");
    const victim = await memberOf("uid-redteam-victim");
    const lead = await account("uid-redteam-lead");
    await grantRole("uid-redteam-lead", "replication_lead", "replication", "RedTeamTasks2001");
    const { listId } = await call(lead, createTaskListContract, {
      name: "Synthetic plan",
      kind: "project",
      scopeType: "replication",
      scopeId: "RedTeamTasks2001",
    });
    const { taskId } = await call(lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Book the synthetic EEG room", followerUids: [victim.uid] },
    });
    // The flooder's own reminders, about the flooder's own user record, dated in 1970.
    const batch = adminDb.batch();
    for (let index = 0; index < REMINDERS_PER_RUN; index += 1) {
      batch.set(
        adminDb.doc(`reminders/redteamFlood${String(index).padStart(9, "0")}`),
        reminder("uid-redteam-flooder", "user", "uid-redteam-flooder", Timestamp.fromMillis(index)),
      );
    }
    await batch.commit();
    await adminDb
      .doc("reminders/redteamVictim00000001")
      .set(reminder(victim.uid, "task", taskId, Timestamp.fromMillis(Date.now() - 5 * 60_000)));

    await sendDueReminders(adminDb, new Date());

    expect(await notificationsOf(victim.uid)).toMatchObject([
      { type: "reminder", entityType: "task", entityId: taskId },
    ]);
  });
});

describe("dependencies", () => {
  it("never close a cycle through one call that changes both tasks", async () => {
    const lead = await account("uid-redteam-lead");
    await grantRole("uid-redteam-lead", "replication_lead", "replication", "RedTeamTasks2001");
    const { listId } = await call(lead, createTaskListContract, {
      name: "Synthetic plan",
      kind: "project",
      scopeType: "replication",
      scopeId: "RedTeamTasks2001",
    });
    const { taskId: a } = await call(lead, createTaskContract, { listId, parentId: null, fields: { title: "A" } });
    const { taskId: b } = await call(lead, createTaskContract, { listId, parentId: null, fields: { title: "B" } });

    const code = await codeOf(
      call(lead, updateTasksContract, {
        changes: [
          { taskId: a, patch: { dependsOn: { [b]: "finishToStart" } } },
          { taskId: b, patch: { dependsOn: { [a]: "finishToStart" } } },
        ],
      }),
    );
    const stored = await Promise.all(
      [a, b].map(async (id) => ({
        id,
        dependsOn: taskDocSchema.parse((await adminDb.doc(COLLECTIONS.tasks.docPath(id)).get()).data()).dependsOn,
      })),
    );
    expect(dependencyCycles(stored)).toEqual([]);
    expect(code).toBe("invalid-argument");
  });
});
