import {
  ancestorIdsBeneath,
  COLLECTIONS,
  createTaskContract,
  managesTaskList,
  readsTaskList,
  TASK_MAX_ANCESTORS,
  taskDocSchema,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireSecondFactor,
  writeAudit,
} from "../framework";
import { notifyAll } from "../notifications/notify";
import {
  auditChangesOf,
  checkDependencies,
  checkLinks,
  checkParticipants,
  initialStatusKey,
  LIST_NOT_FOUND_MESSAGE,
  patchedTask,
  placeAmong,
  readList,
  readTask,
  recordHistory,
  requireOpen,
  siblingsOf,
  statusHistoryEntry,
  storedPatch,
  TASK_NOT_FOUND_MESSAGE,
  taskStatuses,
} from "../tasks/model";

/**
 * Creates a task, or a milestone, in a list: at the top of the list or beneath one of its tasks,
 * at `index` among its siblings or after the last. Capability: the owner of a personal list, and
 * `tasks.manage` for the scope of any other. The task copies the scope fields of its list and
 * starts in the first status of tasks with its first history entry. Links must name records that
 * exist, dependencies tasks that exist and close no cycle, and participants members of the
 * portal. The assignees are notified, apart from the caller. One audit entry records it all.
 */
export const createTask = defineCallable(createTaskContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const list = await readList(db, transaction, input.listId);
      const session = { secondFactorVerified: context.secondFactorVerified };
      if (list === null || !readsTaskList(access, session, uid, list.data)) {
        throw new AppError("not-found", LIST_NOT_FOUND_MESSAGE);
      }
      if (list.data.scopeType !== "user") requireSecondFactor(context, access);
      if (!managesTaskList(access, session, uid, list.data)) {
        throw new AppError("permission-denied", "You may not add tasks to this list.");
      }
      requireOpen(list, null);
      const parent = input.parentId === null ? null : await readTask(db, transaction, input.parentId);
      if (input.parentId !== null) {
        if (parent === null || parent.data.listId !== list.id) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
        if (parent.data.archivedAt !== null) {
          throw new AppError("failed-precondition", "The parent task is archived. Restore it before adding subtasks.");
        }
        if (parent.data.ancestorIds.length + 1 > TASK_MAX_ANCESTORS) {
          throw new AppError("invalid-argument", "Tasks cannot be nested this deeply.");
        }
      }
      const taskReference = db.collection(COLLECTIONS.tasks.collectionPath()).doc();
      const { fields } = input;
      const caller = { uid, access, session };
      await checkLinks(db, transaction, caller, fields.links ?? []);
      await checkDependencies(db, transaction, caller, taskReference.id, fields.dependsOn ?? {}, {});
      await checkParticipants(db, transaction, fields);
      const siblings = await siblingsOf(db, transaction, list.id, input.parentId, null);
      const statusKey = initialStatusKey(await taskStatuses(db, transaction));

      const auditEventId = writeAudit(
        transaction,
        {
          action: "task.created",
          actor: { kind: "user", uid },
          entityType: "task",
          entityId: taskReference.id,
          changes: [
            { field: "listId", after: list.id },
            { field: "parentId", after: input.parentId },
            ...auditChangesOf(fields, null),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const order = placeAmong(transaction, siblings, input.index ?? siblings.length, stamp);
      const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
      const base = taskDocSchema.parse({
        ...createdFields("tasks", stamp),
        listId: list.id,
        ownerUid: list.data.ownerUid,
        parentId: input.parentId,
        ancestorIds: ancestorIdsBeneath(
          parent === null ? null : { id: parent.id, ancestorIds: parent.data.ancestorIds },
        ),
        order,
        kind: fields.kind ?? "task",
        title: fields.title,
        mentionUids: [],
        statusKey,
        statusHistoryId: historyReference.id,
        priority: "none",
        completedAt: null,
        assigneeUids: [],
        collaboratorUids: [],
        followerUids: [],
        unclaimedParticipants: [],
        dependsOn: {},
        links: [],
        checklist: {},
        tagIds: [],
        custom: {},
        replicationId: list.data.replicationId,
        laboratoryId: list.data.laboratoryId,
        scopeKeys: list.data.scopeKeys,
      });
      const parsed = taskDocSchema.safeParse(patchedTask(base, storedPatch(fields, at, base.kind)));
      if (!parsed.success) {
        throw new AppError("invalid-argument", "The task does not fit: check its dates, sizes and lists.");
      }
      const task = { id: taskReference.id, data: parsed.data };
      transaction.set(taskReference, parsed.data);
      transaction.set(historyReference, statusHistoryEntry(task, null, statusKey, uid, stamp, undefined));
      recordHistory(db, transaction, auditEventId, uid, "task.created", task, ["title"], stamp);
      notifyAll(
        db,
        transaction,
        task.data.assigneeUids.filter((assignee) => assignee !== uid),
        {
          type: "assignment",
          entityType: "task",
          entityId: task.id,
          eventId: auditEventId,
          payload: { kind: "taskAssigned", title: task.data.title, actorUid: uid },
        },
        stamp,
      );
      return { taskId: task.id };
    });
  },
});
