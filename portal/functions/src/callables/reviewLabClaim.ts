import {
  COLLECTIONS,
  labClaimDocSchema,
  labClaimReviewDocSchema,
  laboratoryMemberDocSchema,
  parseStoredDocument,
  type RoleScope,
  reviewLabClaimContract,
  withUnit,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { commitAccess, draftAccess, withAssignment } from "../access/maintain";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { writeNotification } from "../notifications/notify";
import { assignmentIdOf, nextAssignment, readAssignments } from "../roles/assignments";

const NOT_PENDING_MESSAGE = "This request is not waiting for review any more. Reload the list of requests.";

/**
 * Decides a request to represent a laboratory (docs/SECURITY.md, section 4). Capability:
 * `labs.claims.review` for the laboratory of the request, which programme administrators and
 * the core team hold everywhere and a coordinator holds for the laboratory, with the second
 * factor wherever the caller's access document requires one. Nobody decides their own request.
 *
 * An approval writes, in one transaction:
 *
 * | Requested role   | Role assignment, active | Member entry of the laboratory                          |
 * |------------------|-------------------------|---------------------------------------------------------|
 * | `coordinator`    | `lab_coordinator`       | Role `coordinator`, an authorised representative, confirmed |
 * | `representative` | `lab_member`            | Role `representative`, an authorised representative, confirmed |
 *
 * A laboratory may therefore have several authorised representatives. An entry that names the
 * person as principal investigator keeps that role. The request was made by the person
 * concerned, so the entry is confirmed, and the laboratory is put on the directory document of
 * the person in the same transaction.
 */
export const reviewLabClaim = defineCallable(reviewLabClaimContract, {
  handler: async (input, context) => {
    const { db } = context;
    const reviewer = context.uid;
    const at = context.clock.now();
    const claimReference = db.doc(COLLECTIONS.labClaims.docPath(input.claimId));
    const reviewReference = db.doc(COLLECTIONS.labClaimReview.docPath(input.claimId));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, reviewer, transaction);
      const [claimSnapshot, reviewSnapshot] = await transaction.getAll(claimReference, reviewReference);
      const claim = claimSnapshot?.exists ? parseStoredDocument(labClaimDocSchema, claimSnapshot.data()) : null;
      const review = reviewSnapshot?.exists
        ? parseStoredDocument(labClaimReviewDocSchema, reviewSnapshot.data())
        : null;
      if (claim?.success !== true || review?.success !== true) {
        // A caller who may decide nothing learns nothing about which requests exist.
        requireCapability(context, access, "labs.claims.review", "programme");
        throw new AppError("not-found", "This request does not exist.");
      }
      const { laboratoryId, uid: claimant, requestedRole, status } = claim.data;
      requireCapability(context, access, "labs.claims.review", { laboratoryId });
      if (claimant === reviewer) {
        throw new AppError("permission-denied", "You cannot decide your own request. Ask another reviewer.");
      }
      const decided = input.decision === "approve" ? "approved" : "rejected";
      if (status === decided) return { claimId: input.claimId, status: decided };
      if (status !== "pendingReview") throw new AppError("failed-precondition", NOT_PENDING_MESSAGE);

      const draft = input.decision === "approve" ? await draftAccess(db, transaction, claimant, at) : null;
      const personId = draft?.inputs.personId ?? null;
      const role: RoleScope = {
        role: requestedRole === "coordinator" ? "lab_coordinator" : "lab_member",
        scopeType: "laboratory",
        scopeId: laboratoryId,
      };
      const assignmentId = assignmentIdOf(claimant, role);
      const approval =
        input.decision === "approve"
          ? await (async () => {
              if (draft === null || personId === null) {
                throw new AppError(
                  "failed-precondition",
                  "The account of this request is not linked to a person any more. Reject the request.",
                );
              }
              const personReference = db.doc(COLLECTIONS.persons.docPath(personId));
              const entryReference = db.doc(COLLECTIONS.laboratoryMembers.docPath(laboratoryId, personId));
              const [laboratory, person, entry] = await transaction.getAll(
                db.doc(COLLECTIONS.laboratories.docPath(laboratoryId)),
                personReference,
                entryReference,
              );
              if (laboratory?.exists !== true || person?.exists !== true) {
                throw new AppError(
                  "failed-precondition",
                  "The laboratory or the person of this request no longer exists.",
                );
              }
              const assignment = (await readAssignments(db, transaction, [assignmentId])).get(assignmentId);
              return { draft, personId, personReference, person, entryReference, entry, assignment };
            })()
          : null;

      const auditEventId = writeAudit(
        transaction,
        {
          action: approval === null ? "labClaim.rejected" : "labClaim.approved",
          actor: { kind: "user", uid: reviewer },
          entityType: "laboratory",
          entityId: laboratoryId,
          changes: withheldChanges(["status", "reviewedBy", "reviewedAt", "decisionNote"]),
          at,
        },
        db,
      );
      const stamp = callerStamp(reviewer, at, auditEventId);
      const now = Timestamp.fromDate(at);
      transaction.update(claimReference, { status: decided, ...touchedFields(stamp) });
      transaction.update(reviewReference, {
        reviewedBy: reviewer,
        reviewedAt: now,
        ...(input.note === undefined ? {} : { decisionNote: input.note }),
        ...touchedFields(stamp),
      });

      if (approval !== null) {
        const { entry, person } = approval;
        const next = nextAssignment(
          approval.assignment?.data ?? null,
          { ...role, uid: claimant, status: "active" },
          stamp,
        );
        if (next !== null && approval.assignment !== undefined) {
          transaction.set(approval.assignment.reference, next);
          approval.draft.inputs = withAssignment(approval.draft.inputs, next);
          writeAudit(
            transaction,
            {
              action: "role.granted",
              actor: { kind: "user", uid: reviewer },
              entityType: "user",
              entityId: claimant,
              changes: [
                { field: "role", after: role.role },
                { field: "scopeType", after: role.scopeType },
                { field: "scopeId", after: role.scopeId },
                { field: "status", after: "active" },
              ],
              at,
              context: { causationId: auditEventId },
            },
            db,
          );
        }
        const storedEntry = entry?.exists === true ? entry.data() : undefined;
        transaction.set(
          approval.entryReference,
          laboratoryMemberDocSchema.parse({
            ...(storedEntry === undefined
              ? {
                  ...createdFields("laboratoryMembers", stamp),
                  laboratoryId,
                  personId: approval.personId,
                  earlierPeriods: [],
                }
              : { ...storedEntry, ...touchedFields(stamp), archivedAt: null }),
            role: storedEntry?.role === "pi" ? "pi" : requestedRole,
            isAuthorisedRepresentative: true,
            status: "confirmed",
          }),
        );
        const listed: unknown = person.get("laboratoryIds");
        const laboratoryIds = withUnit(
          Array.isArray(listed) ? listed.filter((id): id is string => typeof id === "string") : [],
          laboratoryId,
          true,
        );
        transaction.update(approval.personReference, { laboratoryIds, ...touchedFields(stamp) });
        commitAccess(db, transaction, approval.draft, stamp);
      }
      writeNotification(
        db,
        transaction,
        {
          uid: claimant,
          type: "claimDecision",
          entityType: "laboratory",
          entityId: laboratoryId,
          eventId: auditEventId,
          payload: { kind: approval === null ? "labClaimRejected" : "labClaimApproved", requestedRole },
        },
        stamp,
      );
      return { claimId: input.claimId, status: decided };
    });
  },
});
