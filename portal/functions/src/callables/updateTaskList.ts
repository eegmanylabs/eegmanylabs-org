import { managesTaskList, readsTaskList, updateTaskListContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireSecondFactor,
  touchedFields,
  writeAudit,
} from "../framework";
import { LIST_NOT_FOUND_MESSAGE, readList } from "../tasks/model";

/**
 * Renames a task list, or archives or restores it. Capability: the owner of a personal list, and
 * `tasks.manage` for the scope of any other. An archived list keeps its tasks, which stay
 * readable and take no change until the list is restored.
 */
export const updateTaskList = defineCallable(updateTaskListContract, {
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
        throw new AppError("permission-denied", "You may not change this task list.");
      }
      const archived = list.data.archivedAt !== null;
      if (archived && input.archived !== false) {
        throw new AppError("failed-precondition", "This task list is archived. Restore it before changing it.");
      }
      const changes = [
        ...(input.name === undefined ? [] : [{ field: "name", before: list.data.name, after: input.name }]),
        ...(input.archived === undefined || input.archived === archived
          ? []
          : [{ field: "archivedAt", before: archived, after: input.archived }]),
      ];
      if (changes.length === 0) return {};
      const auditEventId = writeAudit(
        transaction,
        {
          action: "taskList.updated",
          actor: { kind: "user", uid },
          entityType: "taskList",
          entityId: list.id,
          changes,
          at,
        },
        db,
      );
      transaction.update(list.reference, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.archived === undefined ? {} : { archivedAt: input.archived ? Timestamp.fromDate(at) : null }),
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
      return {};
    });
  },
});
