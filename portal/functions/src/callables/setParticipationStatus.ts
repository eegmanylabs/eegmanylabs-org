import {
  COLLECTIONS,
  can,
  type ParticipationSide,
  parseStoredDocument,
  participationDetailDocSchema,
  participationDocSchema,
  participationTransition,
  setParticipationStatusContract,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";
import { writeParticipationHistory } from "../participations/history";

const NOT_A_MOVE_MESSAGE =
  "A participation cannot move from this status to that one. Choose one of the statuses the page offers.";
const NOT_APPROVED_MESSAGE =
  "Collection starts once the readiness of the laboratory is approved. Approve readiness on the checklist first.";

/**
 * Changes the status of a participation, which is the only way it changes (decision D-019).
 *
 * | Caller                                                                    | May change                     |
 * |---------------------------------------------------------------------------|--------------------------------|
 * | A holder of `participations.manage` for the laboratory                    | The moves that `PARTICIPATION_TRANSITIONS` gives the laboratory: its answer to an invitation, the start of its onboarding and its withdrawal |
 * | A holder of it for the replication: the leads, the core team and programme administrators | The moves the table gives the replication: everything from readiness onwards, and a withdrawal |
 *
 * A move that the table does not hold is refused, so nobody jumps over readiness. Collection
 * starts only while readiness is approved and its approval is signed in the restricted detail.
 * The call states the status the caller saw and a reason. In one transaction the function sets
 * `status` and `statusHistoryId`, creates the history entry and writes the audit entry. An
 * archived participation keeps its status.
 */
export const setParticipationStatus = defineCallable(setParticipationStatusContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const reference = db.doc(COLLECTIONS.participations.docPath(input.participationId));
    const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
    const detailReference = db.doc(COLLECTIONS.participationDetail.docPath(input.participationId));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const [snapshot, detail] = await transaction.getAll(reference, detailReference);
      if (snapshot === undefined || detail === undefined) throw new Error("The transaction returned no snapshot.");
      const parsed = snapshot.exists ? parseStoredDocument(participationDocSchema, snapshot.data()) : null;
      if (parsed === null || !parsed.success) {
        // A caller who may change nothing learns nothing about which participations exist.
        requireCapability(context, access, "participations.manage", "programme");
        throw new AppError("not-found", "This participation does not exist.");
      }
      const participation = parsed.data;
      const unit = { replicationId: participation.replicationId, laboratoryId: participation.laboratoryId };
      requireCapability(context, access, "participations.manage", unit);
      const sides: ParticipationSide[] = [
        ...(can(access, "participations.manage", { laboratoryId: participation.laboratoryId })
          ? (["laboratory"] as const)
          : []),
        ...(can(access, "participations.manage", { replicationId: participation.replicationId })
          ? (["replication"] as const)
          : []),
      ];
      const transition = participationTransition(input.fromStatus, input.toStatus);
      if (transition !== null && !transition.decidedBy.some((side) => sides.includes(side))) {
        throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      }
      if (participation.archivedAt !== null) {
        throw new AppError("failed-precondition", "This participation is archived, so its status cannot change.");
      }
      if (participation.status !== input.fromStatus) {
        throw new AppError(
          "failed-precondition",
          "The status of this participation has changed since you saw it, so nothing was changed. Reload the page and look at it again.",
        );
      }
      if (input.fromStatus === input.toStatus) {
        throw new AppError("failed-precondition", "The participation already has this status. Choose another status.");
      }
      if (transition === null) throw new AppError("failed-precondition", NOT_A_MOVE_MESSAGE);
      if (transition.requiresApprovedReadiness) {
        const parsedDetail = detail.exists ? parseStoredDocument(participationDetailDocSchema, detail.data()) : null;
        const signed = parsedDetail?.success === true && parsedDetail.data.readinessApprovedBy !== null;
        if (participation.readinessStatus !== "approved" || !signed) {
          throw new AppError("failed-precondition", NOT_APPROVED_MESSAGE);
        }
      }

      const auditEventId = writeAudit(
        transaction,
        {
          action: "participation.statusChanged",
          actor: { kind: "user", uid },
          entityType: "participation",
          entityId: input.participationId,
          changes: [
            { field: "status", before: input.fromStatus, after: input.toStatus },
            { field: "statusHistoryId", before: participation.statusHistoryId, after: historyReference.id },
            { field: "reason", after: input.reason },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      writeParticipationHistory(
        transaction,
        historyReference,
        {
          participationId: input.participationId,
          replicationId: participation.replicationId,
          laboratoryId: participation.laboratoryId,
          from: input.fromStatus,
          to: input.toStatus,
          reason: input.reason,
        },
        stamp,
      );
      transaction.update(reference, {
        status: input.toStatus,
        statusHistoryId: historyReference.id,
        ...touchedFields(stamp),
      });
      return { participationId: input.participationId, status: input.toStatus, statusHistoryId: historyReference.id };
    });
  },
});
