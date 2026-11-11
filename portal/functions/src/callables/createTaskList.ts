import {
  COLLECTIONS,
  createTaskListContract,
  dependencyCycles,
  managesTaskList,
  PROGRAMME_KEY,
  readsTaskList,
  resolveParents,
  TASK_TEMPLATE_MAX,
  type TaskDoc,
  taskDocSchema,
  taskListDocSchema,
  taskListScope,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireSecondFactor,
  writeAudit,
} from "../framework";
import { initialStatusKey, LIST_NOT_FOUND_MESSAGE, readList, taskStatuses } from "../tasks/model";

/**
 * Creates a task list. Capability: membership for a personal list of the caller's own, and
 * `tasks.manage` for the scope of any other: the programme, a replication, a laboratory or a
 * group. The scope must exist. A list made from a template copies its tasks, with their tree,
 * their order, their dependencies within the template and their checklists, every item open
 * again; each copy starts in the first status of tasks, with no dates, participants or
 * recurrence, because those belong to the work at hand. The list, its tasks and one audit entry
 * are written in one transaction.
 */
export const createTaskList = defineCallable(createTaskListContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const personal = input.kind === "personal";
      if (personal !== (input.scopeType === "user")) {
        throw new AppError("invalid-argument", "A personal list belongs to a user, and only a personal list does.");
      }
      if (personal && input.scopeId !== uid) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      if (input.scopeType !== "user") requireSecondFactor(context, access);
      const list = { ownerUid: personal ? uid : null, scopeType: input.scopeType, scopeId: input.scopeId };
      if (!managesTaskList(access, { secondFactorVerified: context.secondFactorVerified }, uid, list)) {
        throw new AppError("permission-denied", "You may not create task lists here.");
      }
      const scopePath = {
        programme: input.scopeId === PROGRAMME_KEY ? COLLECTIONS.programmes.docPath(PROGRAMME_KEY) : null,
        replication: COLLECTIONS.replications.docPath(input.scopeId),
        laboratory: COLLECTIONS.laboratories.docPath(input.scopeId),
        group: COLLECTIONS.groups.docPath(input.scopeId),
        user: COLLECTIONS.users.docPath(input.scopeId),
      }[input.scopeType];
      if (scopePath === null || !(await transaction.get(db.doc(scopePath))).exists) {
        throw new AppError("not-found", "The programme, replication, laboratory or group of the list does not exist.");
      }

      let templateTasks: { id: string; data: TaskDoc }[] = [];
      if (input.templateListId !== undefined) {
        const template = await readList(db, transaction, input.templateListId);
        if (
          template === null ||
          template.data.kind !== "template" ||
          template.data.archivedAt !== null ||
          !readsTaskList(access, { secondFactorVerified: context.secondFactorVerified }, uid, template.data)
        ) {
          throw new AppError("not-found", LIST_NOT_FOUND_MESSAGE);
        }
        const found = await transaction.get(
          db
            .collection(COLLECTIONS.tasks.collectionPath())
            .where("listId", "==", template.id)
            .limit(TASK_TEMPLATE_MAX + 1),
        );
        if (found.size > TASK_TEMPLATE_MAX) {
          throw new AppError("resource-exhausted", "This template holds too many tasks to copy at once.");
        }
        templateTasks = found.docs
          .map((snapshot) => ({ id: snapshot.id, data: taskDocSchema.parse(snapshot.data()) }))
          .filter((task) => task.data.archivedAt === null);
        // The copies are written past the checks of a change, so the template is checked here.
        if (
          dependencyCycles(templateTasks.map((task) => ({ id: task.id, dependsOn: task.data.dependsOn }))).length > 0
        ) {
          throw new AppError(
            "failed-precondition",
            "Some tasks of this template depend on one another in a cycle. Remove one of those dependencies from the template first.",
          );
        }
      }
      const tree = resolveParents(templateTasks.map((task) => ({ id: task.id, parentId: task.data.parentId })));
      const statusKey = templateTasks.length > 0 ? initialStatusKey(await taskStatuses(db, transaction)) : null;

      const listReference = db.collection(COLLECTIONS.taskLists.collectionPath()).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "taskList.created",
          actor: { kind: "user", uid },
          entityType: "taskList",
          entityId: listReference.id,
          changes: [
            { field: "name", after: input.name },
            { field: "kind", after: input.kind },
            { field: "scopeType", after: input.scopeType },
            { field: "scopeId", after: input.scopeId },
            ...(input.templateListId === undefined ? [] : [{ field: "templateSourceId", after: input.templateListId }]),
            { field: "copiedTasks", after: templateTasks.length },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const scope = taskListScope(input.scopeType, input.scopeId);
      transaction.set(
        listReference,
        taskListDocSchema.parse({
          ...createdFields("taskLists", stamp),
          name: input.name,
          kind: input.kind,
          ownerUid: list.ownerUid,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          ...(input.templateListId === undefined ? {} : { templateSourceId: input.templateListId }),
          ...scope,
        }),
      );

      // Each copy takes a new identifier, and the tree and the dependencies are mapped onto them.
      const copies = new Map(
        templateTasks.map((task) => [task.id, db.collection(COLLECTIONS.tasks.collectionPath()).doc().id]),
      );
      const copyOf = (id: string) => copies.get(id);
      for (const task of templateTasks) {
        const id = copyOf(task.id) as string;
        // The parents form a tree among the copies, and the ancestors follow the parent written.
        const placed = tree.get(task.id);
        const parentId = placed?.parentId == null ? null : (copyOf(placed.parentId) ?? null);
        const ancestorIds = (placed?.ancestorIds ?? []).map((ancestor) => copyOf(ancestor) as string);
        transaction.set(
          db.doc(COLLECTIONS.tasks.docPath(id)),
          taskDocSchema.parse({
            ...createdFields("tasks", stamp),
            listId: listReference.id,
            ownerUid: list.ownerUid,
            parentId,
            ancestorIds,
            order: task.data.order,
            kind: task.data.kind,
            title: task.data.title,
            ...(task.data.description === undefined ? {} : { description: task.data.description }),
            mentionUids: [],
            statusKey,
            statusHistoryId: null,
            priority: task.data.priority,
            completedAt: null,
            ...(task.data.estimateMinutes === undefined ? {} : { estimateMinutes: task.data.estimateMinutes }),
            assigneeUids: [],
            collaboratorUids: [],
            followerUids: [],
            unclaimedParticipants: [],
            dependsOn: Object.fromEntries(
              Object.entries(task.data.dependsOn).flatMap(([target, kind]) => {
                const mapped = copyOf(target);
                return mapped === undefined ? [] : [[mapped, kind]];
              }),
            ),
            links: task.data.links,
            checklist: Object.fromEntries(
              Object.entries(task.data.checklist).map(([key, item]) => [key, { ...item, done: false }]),
            ),
            tagIds: task.data.tagIds,
            custom: {},
            ...scope,
          }),
        );
      }
      return { listId: listReference.id, copiedTasks: templateTasks.length };
    });
  },
});
