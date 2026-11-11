// Who reads and who changes tasks (docs/DATA_MODEL.md, section 8). A task list belongs to the
// programme, a replication, a laboratory or a group, or to one user, and its tasks copy its
// scope fields. The callable functions decide every change with `taskRole`, and the interface
// asks the same function to decide what to offer, which the functions decide again.
import { type AccessDocument, programmePowersInEffect, type SecondFactorFacts, sessionScopeKeys } from "./access";
import { capabilityField } from "./capabilities";
import {
  groupScopeKey,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  PROGRAMME_SCOPE_KEY,
  replicationScopeKey,
  userScopeKey,
} from "./ids";
import type { TaskDoc, TaskListDoc } from "./schemas/tasks";

export type TaskScopeType = TaskListDoc["scopeType"];

export interface TaskListScope {
  readonly replicationId: string | null;
  readonly laboratoryId: string | null;
  readonly scopeKeys: string[];
}

/**
 * The scope fields of a list, which its tasks copy.
 *
 * | Scope         | Read by                                                  |
 * |---------------|----------------------------------------------------------|
 * | `programme`   | Every member: the programme's plan and roadmap           |
 * | `replication` | Its team, which holds its scope key                      |
 * | `laboratory`  | Its members                                              |
 * | `group`       | Its members                                              |
 * | `user`        | The user alone                                           |
 *
 * Programme administrators and the core team read every list in a session that holds their powers.
 */
export function taskListScope(scopeType: TaskScopeType, scopeId: string): TaskListScope {
  switch (scopeType) {
    case "programme":
      return { replicationId: null, laboratoryId: null, scopeKeys: [MEMBERS_SCOPE_KEY, PROGRAMME_SCOPE_KEY] };
    case "replication":
      return { replicationId: scopeId, laboratoryId: null, scopeKeys: [replicationScopeKey(scopeId)] };
    case "laboratory":
      return { replicationId: null, laboratoryId: scopeId, scopeKeys: [laboratoryScopeKey(scopeId)] };
    case "group":
      return { replicationId: null, laboratoryId: null, scopeKeys: [groupScopeKey(scopeId)] };
    case "user":
      return { replicationId: null, laboratoryId: null, scopeKeys: [userScopeKey(scopeId)] };
  }
}

/** The participants of a task, who read it whatever its list. */
export function taskParticipantUids(
  task: Pick<TaskDoc, "assigneeUids" | "collaboratorUids" | "followerUids">,
): string[] {
  return [...new Set([...task.assigneeUids, ...task.collaboratorUids, ...task.followerUids])].sort();
}

/**
 * Everyone who reads a task, as scope keys: the keys of its list and the participants. The
 * history of a task, its body page and the activity about it carry this audience, so that a
 * participant reads them as they read the task.
 */
export function taskAudienceKeys(
  task: Pick<TaskDoc, "scopeKeys" | "assigneeUids" | "collaboratorUids" | "followerUids">,
): string[] {
  return [...new Set([...task.scopeKeys, ...taskParticipantUids(task).map(userScopeKey)])].sort();
}

type AccessFacts = Pick<
  AccessDocument,
  "member" | "suspended" | "capabilities" | "scopeKeys" | "programmeRoles" | "mfaEnrolled" | "secondFactorRequired"
>;

/**
 * Whether an account manages the tasks of a list: its owner for a personal list, and the holders
 * of `tasks.manage` for its scope. A holding for the programme as a whole counts only in a
 * session that holds the programme powers, as everywhere else.
 */
export function managesTaskList(
  access: AccessFacts,
  session: SecondFactorFacts,
  uid: string,
  list: Pick<TaskListDoc, "ownerUid" | "scopeType" | "scopeId">,
): boolean {
  if (access.suspended || !access.member) return false;
  if (list.scopeType === "user") return list.ownerUid === uid && list.scopeId === uid;
  const held: readonly string[] = access.capabilities[capabilityField("tasks.manage")] ?? [];
  if (held.includes(PROGRAMME_SCOPE_KEY) && programmePowersInEffect(access, session)) return true;
  switch (list.scopeType) {
    case "programme":
      return false;
    case "replication":
      return held.includes(replicationScopeKey(list.scopeId));
    case "laboratory":
      return held.includes(laboratoryScopeKey(list.scopeId));
    case "group":
      return held.includes(groupScopeKey(list.scopeId));
  }
}

/** Whether an account reads a task, as the security rules decide it. */
export function readsTask(
  access: AccessFacts,
  session: SecondFactorFacts,
  uid: string,
  task: Pick<TaskDoc, "scopeKeys" | "ownerUid" | "assigneeUids" | "collaboratorUids" | "followerUids">,
): boolean {
  if (access.suspended || !access.member) return false;
  if (task.ownerUid === uid || taskParticipantUids(task).includes(uid)) return true;
  if (access.programmeRoles.length > 0 && programmePowersInEffect(access, session)) return true;
  const held = sessionScopeKeys(access, session);
  return task.scopeKeys.some((key) => held.includes(key));
}

/** Whether an account reads a task list, as the security rules decide it. */
export function readsTaskList(
  access: AccessFacts,
  session: SecondFactorFacts,
  uid: string,
  list: Pick<TaskListDoc, "scopeKeys" | "ownerUid">,
): boolean {
  return readsTask(access, session, uid, { ...list, assigneeUids: [], collaboratorUids: [], followerUids: [] });
}

/**
 * What an account may do with a task.
 *
 * | Role           | Who                                       | May                                               |
 * |----------------|-------------------------------------------|---------------------------------------------------|
 * | `manager`      | The managers of the list                  | Everything                                        |
 * | `participant`  | An assignee or a collaborator             | Change the status, the progress, the estimate and the checklist, and follow |
 * | `reader`       | Anyone else who reads the task            | Follow or stop following it                       |
 * | `none`         | Anyone else                               | Nothing                                           |
 */
export type TaskRole = "manager" | "participant" | "reader" | "none";

export function taskRole(
  access: AccessFacts,
  session: SecondFactorFacts,
  uid: string,
  list: Pick<TaskListDoc, "ownerUid" | "scopeType" | "scopeId">,
  task: Pick<TaskDoc, "scopeKeys" | "ownerUid" | "assigneeUids" | "collaboratorUids" | "followerUids">,
): TaskRole {
  if (managesTaskList(access, session, uid, list)) return "manager";
  if (task.assigneeUids.includes(uid) || task.collaboratorUids.includes(uid)) return "participant";
  return readsTask(access, session, uid, task) ? "reader" : "none";
}

/** The fields of a task that a participant may change, beside the status, which goes through its own function. */
export const PARTICIPANT_TASK_FIELDS = ["progressPercent", "estimateMinutes", "checklist", "followerUids"] as const;

/** The fields of a task that a reader may change: following it, which adds or removes the reader alone. */
export const READER_TASK_FIELDS = ["followerUids"] as const;

/**
 * The instant at which a calendar date is stored where a task has a date and no time: noon in
 * UTC, which falls on the same calendar day in every time zone from UTC-11 to UTC+11.
 */
export function dateOnlyInstant(isoDate: string): string {
  return `${isoDate}T12:00:00.000Z`;
}
