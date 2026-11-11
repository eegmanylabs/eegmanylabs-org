import {
  ancestorIdsBeneath,
  COLLECTIONS,
  managesTaskList,
  moveRefusal,
  moveTaskContract,
  subtreeHeight,
  TASK_SUBTREE_MAX,
  taskDocSchema,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireSecondFactor,
  touchedFields,
  writeAudit,
} from "../framework";
import {
  LIST_NOT_FOUND_MESSAGE,
  placeAmong,
  readList,
  readTask,
  recordHistory,
  requireOpen,
  siblingsOf,
  TASK_NOT_FOUND_MESSAGE,
} from "../tasks/model";

/**
 * Moves a task, with every task beneath it, beneath another task or to the top of a list, which
 * may be another list, at `index` among its new siblings. Capability: the managers of the list
 * the task leaves and of the list it joins. A move beneath the task itself or one of its
 * descendants is refused, and so is one that would nest a task beyond the cap of its ancestors.
 * In one transaction the task takes its new parent, ancestors and order, and every task of the
 * subtree takes its new ancestors and, in another list, the owner and the scope fields of that
 * list, with one audit entry.
 */
export const moveTask = defineCallable(moveTaskContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
      const session = { secondFactorVerified: context.secondFactorVerified };
      const task = await readTask(db, transaction, input.taskId);
      if (task === null) throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
      const from = await readList(db, transaction, task.data.listId);
      const to = input.listId === task.data.listId ? from : await readList(db, transaction, input.listId);
      if (from === null || to === null) throw new AppError("not-found", LIST_NOT_FOUND_MESSAGE);
      if (from.data.scopeType !== "user" || to.data.scopeType !== "user") requireSecondFactor(context, access);
      if (!managesTaskList(access, session, uid, from.data) || !managesTaskList(access, session, uid, to.data)) {
        throw new AppError("permission-denied", "You may move tasks only between lists that you manage.");
      }
      requireOpen(from, task.data);
      requireOpen(to, null);
      const parent = input.parentId === null ? null : await readTask(db, transaction, input.parentId);
      if (input.parentId !== null && (parent === null || parent.data.listId !== to.id)) {
        throw new AppError("not-found", "The new parent task does not exist in that list.");
      }
      const found = await transaction.get(
        db
          .collection(COLLECTIONS.tasks.collectionPath())
          .where("ancestorIds", "array-contains", task.id)
          .limit(TASK_SUBTREE_MAX),
      );
      if (found.size >= TASK_SUBTREE_MAX) {
        throw new AppError("resource-exhausted", "This task holds too many subtasks to move at once.");
      }
      const descendants = found.docs.map((snapshot) => ({
        reference: snapshot.ref,
        data: taskDocSchema.parse(snapshot.data()),
      }));
      const refusal = moveRefusal(
        task.id,
        parent === null ? null : { id: parent.id, ancestorIds: parent.data.ancestorIds },
        subtreeHeight(
          task.id,
          task.data.ancestorIds.length,
          descendants.map((descendant) => descendant.data),
        ),
      );
      if (refusal === "beneathItself") {
        throw new AppError("invalid-argument", "A task cannot move beneath itself or one of its own subtasks.");
      }
      if (refusal === "tooDeep") throw new AppError("invalid-argument", "Tasks cannot be nested this deeply.");
      const siblings = await siblingsOf(db, transaction, to.id, input.parentId, task.id);

      const ancestorIds = ancestorIdsBeneath(
        parent === null ? null : { id: parent.id, ancestorIds: parent.data.ancestorIds },
      );
      const auditEventId = writeAudit(
        transaction,
        {
          action: "task.moved",
          actor: { kind: "user", uid },
          entityType: "task",
          entityId: task.id,
          changes: [
            { field: "listId", before: from.id, after: to.id },
            { field: "parentId", before: task.data.parentId, after: input.parentId },
            { field: "subtasks", after: descendants.length },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const order = placeAmong(transaction, siblings, input.index, stamp);
      const scope = {
        listId: to.id,
        ownerUid: to.data.ownerUid,
        replicationId: to.data.replicationId,
        laboratoryId: to.data.laboratoryId,
        scopeKeys: to.data.scopeKeys,
      };
      transaction.update(task.reference, {
        ...scope,
        parentId: input.parentId,
        ancestorIds,
        order,
        ...touchedFields(stamp),
      });
      for (const descendant of descendants) {
        const below = descendant.data.ancestorIds.slice(descendant.data.ancestorIds.indexOf(task.id));
        transaction.update(descendant.reference, {
          ...scope,
          ancestorIds: [...ancestorIds, ...below],
          ...touchedFields(stamp),
        });
      }
      recordHistory(
        db,
        transaction,
        auditEventId,
        uid,
        "task.moved",
        { id: task.id, data: { ...task.data, ...scope } },
        ["listId", "parentId", "order"],
        stamp,
      );
      return { movedTasks: descendants.length + 1 };
    });
  },
});
