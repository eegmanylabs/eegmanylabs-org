import { type TaskPatch, taskDocSchema, updateTasksContract } from "@eegml/shared";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireSecondFactor,
  touchedFields,
  writeAudit,
} from "../framework";
import { notifyAll } from "../notifications/notify";
import {
  auditChangesOf,
  changedFieldsOf,
  checkDependencies,
  checkLinks,
  checkParticipants,
  newlyNamed,
  patchedTask,
  readList,
  readTask,
  recordHistory,
  requireOpen,
  requirePatchAllowed,
  roleOn,
  type StoredList,
  type StoredTask,
  storedPatch,
  TASK_NOT_FOUND_MESSAGE,
} from "../tasks/model";

/**
 * Changes tasks, one or many at once, in one transaction. Capability: the managers of the list
 * of each task change every field; an assignee or a collaborator changes the progress, the
 * estimate and the checklist; and anyone who reads a task follows it or stops following it. A
 * change that a role does not cover refuses the whole call. Links must name records that exist,
 * new dependencies tasks that exist and close no cycle, and new participants members of the
 * portal. Each task gets an audit entry and an entry in its history, and newly named assignees
 * are notified, apart from the caller.
 */
export const updateTasks = defineCallable(updateTasksContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const ids = input.changes.map((change) => change.taskId);
    if (new Set(ids).size !== ids.length)
      throw new AppError("invalid-argument", "Each task is changed once in a call.");
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
      const caller = { uid, access, session: { secondFactorVerified: context.secondFactorVerified } };
      // The dependencies that this call gives each task, which the check of every other change counts.
      const pending = new Map(
        input.changes.flatMap(({ taskId, patch }) =>
          patch.dependsOn === undefined ? [] : [[taskId, patch.dependsOn]],
        ),
      );
      const lists = new Map<string, StoredList>();
      const reads: { task: StoredTask; patch: TaskPatch }[] = [];
      for (const { taskId, patch } of input.changes) {
        const task = await readTask(db, transaction, taskId);
        if (task === null) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
        let list = lists.get(task.data.listId);
        if (list === undefined) {
          const read = await readList(db, transaction, task.data.listId);
          if (read === null) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
          list = read;
          lists.set(list.id, list);
        }
        const role = roleOn(access, context.secondFactorVerified, uid, list, task.data);
        if (role === "manager" && list.data.scopeType !== "user") requireSecondFactor(context, access);
        requirePatchAllowed(role, uid, task.data, patch);
        requireOpen(list, task.data, patch);
        if (patch.links !== undefined) await checkLinks(db, transaction, caller, patch.links, task.data.links);
        if (patch.dependsOn !== undefined) {
          await checkDependencies(db, transaction, caller, task.id, patch.dependsOn, task.data.dependsOn, pending);
        }
        await checkParticipants(db, transaction, {
          assigneeUids: newlyNamed(task.data.assigneeUids, patch.assigneeUids, ""),
          collaboratorUids: newlyNamed(task.data.collaboratorUids, patch.collaboratorUids, ""),
          followerUids: newlyNamed(task.data.followerUids, patch.followerUids, ""),
          ...(patch.unclaimedParticipants === undefined ? {} : { unclaimedParticipants: patch.unclaimedParticipants }),
        });
        reads.push({ task, patch });
      }

      for (const { task, patch } of reads) {
        const fields = changedFieldsOf(patch);
        if (fields.length === 0) continue;
        const auditEventId = writeAudit(
          transaction,
          {
            action: "task.updated",
            actor: { kind: "user", uid },
            entityType: "task",
            entityId: task.id,
            changes: auditChangesOf(patch, task.data),
            at,
          },
          db,
        );
        const stamp = callerStamp(uid, at, auditEventId);
        const stored = storedPatch(patch, at, task.data.kind);
        const next = taskDocSchema.safeParse(patchedTask(task.data, stored));
        if (!next.success) {
          throw new AppError(
            "invalid-argument",
            "A task does not fit after the change: check its dates, sizes and lists.",
          );
        }
        transaction.update(task.reference, { ...stored, ...touchedFields(stamp) });
        recordHistory(
          db,
          transaction,
          auditEventId,
          uid,
          "task.updated",
          { id: task.id, data: next.data },
          fields,
          stamp,
        );
        notifyAll(
          db,
          transaction,
          newlyNamed(task.data.assigneeUids, patch.assigneeUids, uid),
          {
            type: "assignment",
            entityType: "task",
            entityId: task.id,
            eventId: auditEventId,
            payload: { kind: "taskAssigned", title: next.data.title, actorUid: uid },
          },
          stamp,
        );
      }
      return { taskIds: reads.map((read) => read.task.id) };
    });
  },
});
