import { COLLECTIONS, setTaskStatusContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireSecondFactor,
  touchedFields,
  writeAudit,
} from "../framework";
import { notifyAll } from "../notifications/notify";
import {
  isFinished,
  readList,
  readTask,
  recordHistory,
  requireOpen,
  roleOn,
  type StoredList,
  type StoredTask,
  statusHistoryEntry,
  TASK_NOT_FOUND_MESSAGE,
  taskStatuses,
} from "../tasks/model";

const CHANGED_MESSAGE =
  "The status of a task has changed since you saw it, so nothing was changed. Look at the task again.";

/**
 * Changes the status of tasks, each from the status the caller saw (D-019). Capability: the
 * managers of the list of each task, and its assignees and collaborators. The new status is a
 * status of tasks that is not archived, and differs from the current one. A finished status,
 * done or cancelled, sets `completedAt` to now, and any other clears it. In one transaction each
 * task gets its status, a dated entry of the status history, an audit entry and an entry in its
 * history, and its assignees and followers are told, apart from the caller. A recurring task
 * that is completed is followed by its next occurrence, which a trigger creates.
 */
export const setTaskStatus = defineCallable(setTaskStatusContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const ids = input.tasks.map((entry) => entry.taskId);
    if (new Set(ids).size !== ids.length) throw new AppError("invalid-argument", "Each task is named once in a call.");
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
      const statuses = await taskStatuses(db, transaction);
      const target = statuses.get(input.toStatusKey);
      if (target === undefined || target.archivedAt !== null) {
        throw new AppError("invalid-argument", "This status is not one the programme uses for tasks. Choose again.");
      }
      const lists = new Map<string, StoredList>();
      const reads: StoredTask[] = [];
      for (const entry of input.tasks) {
        const task = await readTask(db, transaction, entry.taskId);
        if (task === null) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
        const list = lists.get(task.data.listId) ?? (await readList(db, transaction, task.data.listId));
        if (list === null) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
        lists.set(list.id, list);
        const role = roleOn(access, context.secondFactorVerified, uid, list, task.data);
        if (role === "reader") throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
        if (role === "manager" && list.data.scopeType !== "user") requireSecondFactor(context, access);
        requireOpen(list, task.data);
        if (task.data.statusKey !== entry.fromStatusKey) throw new AppError("failed-precondition", CHANGED_MESSAGE);
        if (task.data.statusKey === input.toStatusKey) {
          throw new AppError(
            "failed-precondition",
            "A task already has this status. Choose another status to change it.",
          );
        }
        reads.push(task);
      }

      const historyIds: string[] = [];
      const finished = isFinished(target);
      for (const task of reads) {
        const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
        const completedAt = finished ? at.toISOString() : null;
        const auditEventId = writeAudit(
          transaction,
          {
            action: "task.statusChanged",
            actor: { kind: "user", uid },
            entityType: "task",
            entityId: task.id,
            changes: [
              { field: "statusKey", before: task.data.statusKey, after: input.toStatusKey },
              { field: "statusHistoryId", before: task.data.statusHistoryId, after: historyReference.id },
              { field: "completedAt", after: completedAt },
              ...(input.reason === undefined ? [] : [{ field: "reason", after: input.reason }]),
            ],
            at,
          },
          db,
        );
        const stamp = callerStamp(uid, at, auditEventId);
        transaction.set(
          historyReference,
          statusHistoryEntry(task, task.data.statusKey, input.toStatusKey, uid, stamp, input.reason),
        );
        transaction.update(task.reference, {
          statusKey: input.toStatusKey,
          statusHistoryId: historyReference.id,
          completedAt: finished ? Timestamp.fromDate(at) : null,
          ...(finished && task.data.kind === "task" ? { progressPercent: 100 } : {}),
          ...touchedFields(stamp),
        });
        recordHistory(db, transaction, auditEventId, uid, "task.statusChanged", task, ["statusKey"], stamp);
        notifyAll(
          db,
          transaction,
          [...task.data.assigneeUids, ...task.data.followerUids].filter((other) => other !== uid),
          {
            type: task.data.kind === "milestone" && finished ? "milestone" : "statusChange",
            entityType: "task",
            entityId: task.id,
            eventId: auditEventId,
            payload: {
              kind: "taskStatusChanged",
              title: task.data.title,
              statusLabel: target.label,
              actorUid: uid,
            },
          },
          stamp,
        );
        historyIds.push(historyReference.id);
      }
      return { statusHistoryIds: historyIds };
    });
  },
});
