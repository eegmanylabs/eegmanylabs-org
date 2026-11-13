// The actions an automation can take, a fixed list (requirement R16.9). Each acts on the record
// of its run, writes with the write context of an automation (one step deeper than its event,
// with the run as the cause), writes an audit entry of the automation in the same transaction,
// and is idempotent: a task, a list or a notification takes an identifier derived from what it is
// about, so an action that is retried after a failure creates nothing twice.
import {
  type AutomationAction,
  type AutomationRunDoc,
  COLLECTIONS,
  checklistTemplateDocSchema,
  datasetDocSchema,
  dateOnlyInstant,
  documentTemplateDocSchema,
  laboratoryDocSchema,
  ONBOARDING_CHECKLIST_TEMPLATE,
  onboardingListId,
  orderKeysAfter,
  PROGRAMME_KEY,
  parseStoredDocument,
  replicationDocSchema,
  shiftIsoDate,
  systemSettingsDocSchema,
  taskDocSchema,
  taskListDocSchema,
  taskListScope,
  type WriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { prepareQcTask, qcParticipants, writeQcTask } from "../datasets/qc-task";
import { writeAudit } from "../framework";
import { createdFields, type WriteStamp } from "../framework/documents";
import { requestGeneration } from "../integrations/jobs/generation";
import { notifyAll } from "../notifications/notify";
import { accountsListing, DEFAULT_INACTIVITY_DAYS, flagInactiveParticipations } from "../recruitment/inactivity";
import { initialStatusKey, statusHistoryEntry, taskStatuses } from "../tasks/model";
import { AUTOMATION_ACTOR } from "./dispatch";

/** The run an action belongs to, as the action needs it. */
export interface ActionContext {
  readonly db: Firestore;
  readonly runId: string;
  readonly run: AutomationRunDoc;
  readonly at: Date;
}

/** An action that cannot succeed however often it is tried, such as one about a record that has gone. */
export class ActionRefusal extends Error {
  override readonly name = "ActionRefusal";
}

/** The write context of what an action writes: one step deeper than its event, caused by its run. */
function automationContext(context: ActionContext, auditEventId: string | null): WriteContext {
  return {
    origin: "automation",
    depth: context.run.depth + 1,
    correlationId: context.run.correlationId,
    causationId: context.runId,
    auditEventId,
  };
}

function stampOf(context: ActionContext, auditEventId: string): WriteStamp {
  return { at: context.at, actor: AUTOMATION_ACTOR, writeContext: automationContext(context, auditEventId) };
}

function audit(
  context: ActionContext,
  transaction: Transaction,
  entityType: "dataset" | "laboratory" | "replication" | "programme",
  entityId: string,
  action: AutomationAction["kind"],
): string {
  return writeAudit(
    transaction,
    {
      action: "automation.acted",
      actor: { kind: "automation" },
      entityType,
      entityId,
      changes: [
        { field: "action", after: action },
        { field: "ruleId", after: context.run.ruleId },
      ],
      at: context.at,
      context: {
        depth: context.run.depth + 1,
        correlationId: context.run.correlationId,
        causationId: context.runId,
      },
      idempotencyKey: `automation:${context.runId}:${action}:${entityId}`,
    },
    context.db,
  );
}

/** Opens the quality-control task of the dataset of the run. */
async function createQcTask(context: ActionContext): Promise<string> {
  const { db } = context;
  if (context.run.entityType !== "dataset" || context.run.entityId === null) {
    throw new ActionRefusal("A quality-control task follows the arrival of the data of a dataset.");
  }
  const datasetId = context.run.entityId;
  const reference = db.doc(COLLECTIONS.datasets.docPath(datasetId));
  const before = parseStoredDocument(datasetDocSchema, (await reference.get()).data());
  if (!before.success) throw new ActionRefusal("The dataset no longer exists.");
  const participants = await qcParticipants(db, before.data);
  return db.runTransaction(async (transaction) => {
    const parsed = parseStoredDocument(datasetDocSchema, (await transaction.get(reference)).data());
    if (!parsed.success) throw new ActionRefusal("The dataset no longer exists.");
    const plan = await prepareQcTask(db, transaction, datasetId, parsed.data.replicationId);
    if (plan === null) return "The quality-control task of the dataset exists already.";
    const auditEventId = audit(context, transaction, "dataset", datasetId, "createQcTask");
    const taskId = writeQcTask(
      db,
      transaction,
      plan,
      { id: datasetId, data: parsed.data },
      participants,
      auditEventId,
      stampOf(context, auditEventId),
    );
    return `Opened the quality-control task ${taskId}.`;
  });
}

/** The days an onboarding task gives the coordinators. */
const ONBOARDING_DAYS = 30;

/** Creates the onboarding task list of the laboratory of the run, one task for each item of the onboarding checklist. */
async function createOnboardingChecklist(context: ActionContext): Promise<string> {
  const { db } = context;
  if (context.run.entityType !== "laboratory" || context.run.entityId === null) {
    throw new ActionRefusal("An onboarding checklist follows the approval of a laboratory.");
  }
  const laboratoryId = context.run.entityId;
  const coordinators = await accountsListing(db, "coordinatorLaboratoryIds", laboratoryId);
  const listReference = db.doc(COLLECTIONS.taskLists.docPath(onboardingListId(laboratoryId)));
  return db.runTransaction(async (transaction) => {
    const laboratory = parseStoredDocument(
      laboratoryDocSchema,
      (await transaction.get(db.doc(COLLECTIONS.laboratories.docPath(laboratoryId)))).data(),
    );
    if (!laboratory.success) throw new ActionRefusal("The laboratory no longer exists.");
    if ((await transaction.get(listReference)).exists) return "The onboarding checklist exists already.";
    // The checklist as the programme configures it, or as it ships where it was never installed.
    const stored = parseStoredDocument(
      checklistTemplateDocSchema,
      (await transaction.get(db.doc(COLLECTIONS.checklistTemplates.docPath(ONBOARDING_CHECKLIST_TEMPLATE.key)))).data(),
    );
    const items = stored.success ? stored.data.items : ONBOARDING_CHECKLIST_TEMPLATE.items;
    const statusKey = initialStatusKey(await taskStatuses(db, transaction));
    const auditEventId = audit(context, transaction, "laboratory", laboratoryId, "createOnboardingChecklist");
    const stamp = stampOf(context, auditEventId);
    const scope = taskListScope("laboratory", laboratoryId);
    transaction.create(
      listReference,
      taskListDocSchema.parse({
        ...createdFields("taskLists", stamp),
        name: `Onboarding of ${laboratory.data.name}`.slice(0, 200),
        kind: "project",
        ownerUid: null,
        scopeType: "laboratory",
        scopeId: laboratoryId,
        ...scope,
      }),
    );
    const orders = orderKeysAfter(null, items.length);
    const due = Timestamp.fromDate(
      new Date(dateOnlyInstant(shiftIsoDate(context.at.toISOString().slice(0, 10), ONBOARDING_DAYS))),
    );
    items.forEach((item, index) => {
      const taskReference = db.doc(COLLECTIONS.tasks.docPath(`${listReference.id}__${item.key}`));
      const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
      const data = taskDocSchema.parse({
        ...createdFields("tasks", stamp),
        listId: listReference.id,
        ownerUid: null,
        parentId: null,
        ancestorIds: [],
        order: orders[index],
        kind: "task",
        title: item.label,
        mentionUids: [],
        statusKey,
        statusHistoryId: historyReference.id,
        priority: "medium",
        dueAt: due,
        completedAt: null,
        assigneeUids: coordinators,
        collaboratorUids: [],
        followerUids: [],
        unclaimedParticipants: [],
        dependsOn: {},
        links: [{ entityType: "laboratory", entityId: laboratoryId }],
        checklist: {},
        tagIds: [],
        custom: {},
        ...scope,
      });
      transaction.create(taskReference, data);
      transaction.set(
        historyReference,
        statusHistoryEntry(
          { id: taskReference.id, data },
          null,
          statusKey,
          stamp.actor,
          stamp,
          undefined,
          "automation",
        ),
      );
    });
    notifyAll(
      db,
      transaction,
      coordinators,
      {
        type: "assignment",
        entityType: "laboratory",
        entityId: laboratoryId,
        eventId: auditEventId,
        payload: { kind: "onboardingChecklistCreated", title: laboratory.data.name, laboratoryId },
      },
      stamp,
    );
    return `Created the onboarding checklist ${listReference.id} with ${items.length} tasks.`;
  });
}

/** The replication of the record of a run, or null. */
async function replicationOfRun(context: ActionContext): Promise<string | null> {
  const { run, db } = context;
  if (run.entityType === "replication") return run.entityId;
  if (run.entityType === "dataset" && run.entityId !== null) {
    const dataset = parseStoredDocument(
      datasetDocSchema,
      (await db.doc(COLLECTIONS.datasets.docPath(run.entityId)).get()).data(),
    );
    return dataset.success ? dataset.data.replicationId : null;
  }
  return null;
}

/** Notifies the leads of the replication of the run in the portal. */
async function notifyLeads(context: ActionContext): Promise<string> {
  const { db, run } = context;
  const replicationId = await replicationOfRun(context);
  if (replicationId === null) throw new ActionRefusal("The event concerns no replication whose leads could be told.");
  const leads = await accountsListing(db, "leadReplicationIds", replicationId);
  if (leads.length === 0) return `Replication ${replicationId} has no lead with an account to tell.`;
  await db.runTransaction(async (transaction) => {
    const replication = parseStoredDocument(
      replicationDocSchema,
      (await transaction.get(db.doc(COLLECTIONS.replications.docPath(replicationId)))).data(),
    );
    const auditEventId = audit(context, transaction, "replication", replicationId, "notifyLeads");
    const title = replication.success ? (replication.data.shortTitle ?? replicationId) : replicationId;
    notifyAll(
      db,
      transaction,
      leads,
      run.event === "recruitment.targetMet"
        ? {
            type: "milestone",
            entityType: "replication",
            entityId: replicationId,
            eventId: auditEventId,
            payload: { kind: "recruitmentTargetMet", title, replicationId },
          }
        : {
            type: "statusChange",
            entityType: run.entityType ?? "replication",
            entityId: run.entityId ?? replicationId,
            eventId: auditEventId,
            payload: { kind: "datasetArrived", title, datasetId: run.entityId, replicationId },
          },
      stampOf(context, auditEventId),
    );
  });
  return `Told ${leads.length} ${leads.length === 1 ? "lead" : "leads"} of replication ${replicationId}.`;
}

/** Queues an update of the progress reports generated from a template. */
async function generateProgressReport(context: ActionContext, action: AutomationAction): Promise<string> {
  const { db, run, at } = context;
  const templateKey = action.templateKey;
  if (templateKey === undefined) throw new ActionRefusal("The action names no template.");
  const template = parseStoredDocument(
    documentTemplateDocSchema,
    (await db.doc(COLLECTIONS.documentTemplates.docPath(templateKey)).get()).data(),
  );
  if (!template.success) throw new ActionRefusal(`The template ${templateKey} is not registered.`);
  if (!template.data.enabled || template.data.archivedAt !== null) {
    return `The template ${templateKey} is switched off, so no report was queued.`;
  }
  const entityType = template.data.entityType;
  if (entityType !== "programme" && entityType !== "replication" && entityType !== "laboratory") {
    throw new ActionRefusal(`The template ${templateKey} is for a kind of record that has no progress report.`);
  }
  const subjects: { id: string; name: string }[] = [];
  if (entityType === "programme") subjects.push({ id: PROGRAMME_KEY, name: "#EEGManyLabs" });
  else if (run.entityType === entityType && run.entityId !== null)
    subjects.push({ id: run.entityId, name: run.entityId });
  else {
    const collection = entityType === "replication" ? COLLECTIONS.replications : COLLECTIONS.laboratories;
    const found = await db.collection(collection.collectionPath()).where("archivedAt", "==", null).limit(200).get();
    for (const document of found.docs) {
      const name = document.get(entityType === "replication" ? "shortTitle" : "name");
      subjects.push({ id: document.id, name: typeof name === "string" ? name : document.id });
    }
  }
  let queued = 0;
  for (const subject of subjects) {
    const result = await requestGeneration(db, {
      template: { key: templateKey, data: template.data },
      entityType,
      entityId: subject.id,
      name: subject.name,
      actor: { kind: "automation" },
      trigger: run.event.startsWith("schedule.") ? "schedule" : "event",
      eventKey: `automation:${context.runId}`,
      writeContext: automationContext(context, null),
      at,
    });
    if (result.created) queued += 1;
  }
  return `Queued ${queued} ${queued === 1 ? "report" : "reports"} from the template ${templateKey}.`;
}

/** Flags collecting participations without a recent report, with a follow-up task each. */
async function flagOverdueUpdates(context: ActionContext): Promise<string> {
  const settings = parseStoredDocument(
    systemSettingsDocSchema,
    (await context.db.doc(COLLECTIONS.systemSettings.docPath()).get()).data(),
  );
  const days = (settings.success ? settings.data.recruitmentInactivityDays : undefined) ?? DEFAULT_INACTIVITY_DAYS;
  const summary = await flagInactiveParticipations(context.db, context.at, days);
  return `Checked recruitment updates older than ${days} days: ${JSON.stringify(summary)}.`;
}

/** Carries out one action of a run, and answers what it did, in words for the log. */
export function runAction(context: ActionContext, action: AutomationAction): Promise<string> {
  switch (action.kind) {
    case "createQcTask":
      return createQcTask(context);
    case "createOnboardingChecklist":
      return createOnboardingChecklist(context);
    case "notifyLeads":
      return notifyLeads(context);
    case "generateProgressReport":
      return generateProgressReport(context, action);
    case "flagOverdueUpdates":
      return flagOverdueUpdates(context);
  }
}
