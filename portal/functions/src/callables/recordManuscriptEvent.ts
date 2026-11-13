import {
  COLLECTIONS,
  documentLinkDocSchema,
  type ManuscriptStatus,
  manuscriptEventDocSchema,
  milestoneReachedBy,
  parseStoredDocument,
  recordManuscriptEventContract,
  STATUSES_AFTER_EVENT,
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
import { isFinished, readTask, recordHistory, statusHistoryEntry, taskStatuses } from "../tasks/model";

/** The date field that a status sets the first time a manuscript reaches it. */
const DATE_OF_STATUS: Partial<Record<ManuscriptStatus, "submittedAt" | "acceptedAt" | "publishedAt">> = {
  submitted: "submittedAt",
  inPrincipleAcceptance: "acceptedAt",
  accepted: "acceptedAt",
  published: "publishedAt",
};

/**
 * Records an event of a manuscript (requirements R12.4 and R12.10): a submission, a review round,
 * a decision with its outcome, a revision, an acceptance, a publication or another step, with
 * the documents it concerns. Capability: `replications.manage` for the replication, or for the
 * programme for an output of the programme.
 *
 * Where the event moves the manuscript to another status, in one transaction the status and its
 * history entry change, the date of submission, acceptance or publication is set where it was
 * not, and the milestone task that stands for that step is completed with its own history entry.
 * A document named is a link of the manuscript.
 */
export const recordManuscriptEvent = defineCallable(recordManuscriptEventContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    if ((input.kind === "decision") !== (input.outcome !== null)) {
      throw new AppError("invalid-argument", "A decision states its outcome, and only a decision does.");
    }
    if (input.status !== null && !STATUSES_AFTER_EVENT[input.kind].includes(input.status)) {
      throw new AppError("invalid-argument", "This kind of event cannot move the output to that status.");
    }
    if (input.dueAt !== null && input.dueAt < input.occurredAt) {
      throw new AppError("invalid-argument", "A due date comes after the event.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const manuscript = await readManuscript(db, transaction, input.manuscriptId);
      requireOutputManager(context, access, manuscript.data.replicationId);
      requireNotArchived(manuscript.data, "output");
      for (const linkId of input.documentLinkIds) {
        const link = parseStoredDocument(
          documentLinkDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.documentLinks.docPath(linkId)))).data(),
        );
        if (!link.success || link.data.entityType !== "manuscript" || link.data.entityId !== manuscript.id) {
          throw new AppError("invalid-argument", "A document named is not linked to this output.");
        }
      }
      const from = manuscript.data.status;
      const to = input.status ?? from;
      const moves = to !== from;
      const milestone = moves ? milestoneReachedBy(to) : null;
      const milestoneId = milestone === null ? undefined : manuscript.data.milestoneTaskIds?.[milestone];
      const milestoneTask = milestoneId === undefined ? null : await readTask(db, transaction, milestoneId);
      const statuses = milestoneTask === null ? null : await taskStatuses(db, transaction);
      const completes =
        milestoneTask !== null &&
        statuses !== null &&
        milestoneTask.data.archivedAt === null &&
        !isFinished(statuses.get(milestoneTask.data.statusKey)) &&
        statuses.get("done")?.archivedAt === null;

      const eventReference = db.collection(COLLECTIONS.manuscriptEvents.collectionPath(manuscript.id)).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "manuscript.eventRecorded",
          actor: { kind: "user", uid },
          entityType: "manuscript",
          entityId: manuscript.id,
          changes: [
            { field: "eventId", after: eventReference.id },
            { field: "kind", after: input.kind },
            ...(input.outcome === null ? [] : [{ field: "outcome", after: input.outcome }]),
            ...(moves ? [{ field: "status", before: from, after: to }] : []),
            ...(completes ? [{ field: "milestoneCompleted", after: milestoneTask.id }] : []),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const scope = {
        replicationId: manuscript.data.replicationId ?? null,
        laboratoryId: null,
        scopeKeys: manuscript.data.scopeKeys,
      };
      transaction.create(
        eventReference,
        manuscriptEventDocSchema.parse({
          ...createdFields("manuscriptEvents", stamp),
          manuscriptId: manuscript.id,
          kind: input.kind,
          ...(input.round === null ? {} : { round: input.round }),
          occurredAt: Timestamp.fromDate(startOfDay(input.occurredAt)),
          ...(input.dueAt === null ? {} : { dueAt: Timestamp.fromDate(startOfDay(input.dueAt)) }),
          ...(input.outcome === null ? {} : { outcome: input.outcome }),
          ...(input.summary === null ? {} : { summary: input.summary }),
          documentLinkIds: input.documentLinkIds,
          ...scope,
        }),
      );
      if (moves) {
        const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
        const now = Timestamp.fromDate(at);
        transaction.create(
          historyReference,
          COLLECTIONS.statusHistory.schema.parse({
            schemaVersion: COLLECTIONS.statusHistory.schemaVersion,
            createdAt: now,
            createdBy: uid,
            writeContext: stamp.writeContext,
            entityType: "manuscript",
            entityId: manuscript.id,
            fromStatusKey: from,
            toStatusKey: to,
            effectiveAt: Timestamp.fromDate(startOfDay(input.occurredAt)),
            recordedAt: now,
            changedBy: uid,
            ...(input.summary === null ? {} : { reason: input.summary }),
            source: "manual",
            ...scope,
          }),
        );
        const dateField = DATE_OF_STATUS[to];
        transaction.update(manuscript.reference, {
          status: to,
          statusHistoryId: historyReference.id,
          ...(dateField === undefined || manuscript.data[dateField] !== undefined
            ? {}
            : { [dateField]: Timestamp.fromDate(startOfDay(input.occurredAt)) }),
          ...touchedFields(stamp),
        });
      }
      if (completes && milestoneTask !== null) {
        const history = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
        transaction.set(
          history,
          statusHistoryEntry(
            milestoneTask,
            milestoneTask.data.statusKey,
            "done",
            uid,
            stamp,
            `The output reached this step: ${to}.`,
            "automation",
          ),
        );
        transaction.update(milestoneTask.reference, {
          statusKey: "done",
          statusHistoryId: history.id,
          completedAt: Timestamp.fromDate(startOfDay(input.occurredAt)),
          ...touchedFields(stamp),
        });
        recordHistory(
          db,
          transaction,
          auditEventId,
          uid,
          "manuscript.eventRecorded",
          milestoneTask,
          ["statusKey"],
          stamp,
        );
      }
      return { eventId: eventReference.id, status: to };
    });
  },
});
