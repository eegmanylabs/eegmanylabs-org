import {
  COLLECTIONS,
  MILESTONE_LABELS,
  managesTaskList,
  planManuscriptMilestoneContract,
  readsTaskList,
  taskDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  touchedFields,
  writeAudit,
} from "../framework";
import { readManuscript, requireNotArchived, requireOutputManager, startOfDay } from "../scientific/model";
import {
  initialStatusKey,
  LIST_NOT_FOUND_MESSAGE,
  placeAmong,
  readList,
  readTask,
  recordHistory,
  requireOpen,
  siblingsOf,
  statusHistoryEntry,
  taskStatuses,
} from "../tasks/model";

/**
 * Plans the submission, the acceptance or the publication of a manuscript as a milestone in a
 * task list of its replication (requirements R12.4 and R8): a task of the kind `milestone`, due
 * on the date given and linked to the manuscript, so that it appears on the timelines and in the
 * summary of milestones of the replication. Capability: `replications.manage` for the replication
 * and the right to manage the list. A milestone that is planned already is moved to the new date
 * instead of being planned twice. The event that reaches the step completes the milestone
 * (`recordManuscriptEvent`).
 */
export const planManuscriptMilestone = defineCallable(planManuscriptMilestoneContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const manuscript = await readManuscript(db, transaction, input.manuscriptId);
      const replicationId = manuscript.data.replicationId ?? null;
      if (replicationId === null) {
        throw new AppError("failed-precondition", "Milestones are planned in the task lists of a replication.");
      }
      requireOutputManager(context, access, replicationId);
      requireNotArchived(manuscript.data, "output");
      const session = { secondFactorVerified: context.secondFactorVerified };
      const list = await readList(db, transaction, input.listId);
      if (list === null || !readsTaskList(access, session, uid, list.data)) {
        throw new AppError("not-found", LIST_NOT_FOUND_MESSAGE);
      }
      if (list.data.replicationId !== replicationId || list.data.scopeType !== "replication") {
        throw new AppError("invalid-argument", "Choose a task list of the output's replication.");
      }
      if (!managesTaskList(access, session, uid, list.data)) {
        throw new AppError("permission-denied", "You may not add tasks to this list.");
      }
      requireOpen(list, null);
      const plannedId = manuscript.data.milestoneTaskIds?.[input.milestone];
      const planned = plannedId === undefined ? null : await readTask(db, transaction, plannedId);
      const dueAt = Timestamp.fromDate(startOfDay(input.dueDate));
      const title = `${MILESTONE_LABELS[input.milestone]}: ${manuscript.data.title}`.slice(0, 300);

      if (planned !== null && planned.data.archivedAt === null) {
        const auditEventId = writeAudit(
          transaction,
          {
            action: "manuscript.milestonePlanned",
            actor: { kind: "user", uid },
            entityType: "manuscript",
            entityId: manuscript.id,
            changes: [
              { field: "milestone", after: input.milestone },
              { field: "taskId", after: planned.id },
              { field: "dueAt", before: planned.data.dueAt?.toDate().toISOString() ?? null, after: input.dueDate },
            ],
            at,
          },
          db,
        );
        const stamp = callerStamp(uid, at, auditEventId);
        transaction.update(planned.reference, { dueAt, ...touchedFields(stamp) });
        recordHistory(db, transaction, auditEventId, uid, "task.updated", planned, ["dueAt"], stamp);
        return { taskId: planned.id };
      }

      const siblings = await siblingsOf(db, transaction, list.id, null, null);
      const statusKey = initialStatusKey(await taskStatuses(db, transaction));
      const taskReference = db.collection(COLLECTIONS.tasks.collectionPath()).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "manuscript.milestonePlanned",
          actor: { kind: "user", uid },
          entityType: "manuscript",
          entityId: manuscript.id,
          changes: [
            { field: "milestone", after: input.milestone },
            { field: "taskId", after: taskReference.id },
            { field: "dueAt", after: input.dueDate },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const order = placeAmong(transaction, siblings, siblings.length, stamp);
      const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
      const task = {
        id: taskReference.id,
        data: taskDocSchema.parse({
          ...createdFields("tasks", stamp),
          listId: list.id,
          ownerUid: list.data.ownerUid,
          parentId: null,
          ancestorIds: [],
          order,
          kind: "milestone",
          title,
          mentionUids: [],
          statusKey,
          statusHistoryId: historyReference.id,
          priority: "none",
          dueAt,
          completedAt: null,
          assigneeUids: [],
          collaboratorUids: [],
          followerUids: [],
          unclaimedParticipants: [],
          dependsOn: {},
          links: [{ entityType: "manuscript", entityId: manuscript.id }],
          checklist: {},
          tagIds: [],
          custom: {},
          replicationId: list.data.replicationId,
          laboratoryId: list.data.laboratoryId,
          scopeKeys: list.data.scopeKeys,
        }),
      };
      transaction.set(taskReference, task.data);
      transaction.set(historyReference, statusHistoryEntry(task, null, statusKey, uid, stamp, undefined));
      recordHistory(db, transaction, auditEventId, uid, "task.created", task, ["title"], stamp);
      transaction.update(manuscript.reference, {
        [`milestoneTaskIds.${input.milestone}`]: taskReference.id,
        ...touchedFields(stamp),
      });
      return { taskId: taskReference.id };
    });
  },
});
