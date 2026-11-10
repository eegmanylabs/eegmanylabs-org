import { reviewAccountClaimContract } from "@eegml/shared";
import { linkObstacle, readLink, writeLink } from "../claims/link";
import { readClaim, writeClaim } from "../claims/records";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  withheldChanges,
  writeAudit,
} from "../framework";
import { holdersOf, notifyAll, writeNotification } from "../notifications/notify";

const NOT_PENDING_MESSAGE = "This claim is not waiting for review any more. Reload the review queue.";
const OWN_CLAIM_MESSAGE = "You cannot decide the claim of your own account. Ask another reviewer.";
const NO_EVIDENCE_MESSAGE =
  "This account's address is not on this person's record, so only a programme administrator can link them. Ask a programme administrator.";

/**
 * Decides a claim that awaits review (docs/SECURITY.md, section 4). Capability:
 * `claims.review`, with the second factor wherever the caller's access document requires one.
 *
 * An approval links the account to the person the reviewer chose, exactly as a match would:
 * the same transaction sets the link on both sides, creates the role assignments that the
 * records about the person imply, with the management roles awaiting approval, and writes the
 * access document. It is refused for a person whom another account has claimed, and for a
 * person who is missing or archived. A rejection needs a note, which only reviewers read.
 *
 * Two rules hold whatever the capability matrix says. Nobody decides the claim of their own
 * account. And a link to a person who is not among the claim's candidates, whose records do
 * not carry the account's verified address, rests on the reviewer's judgement alone: it makes
 * the account the person concerned, with sight of the person's contact and special-category
 * data, so it is for programme administrators only. `evidence.candidate` records which kind
 * of link an approval made.
 *
 * The claimant is notified of the decision and never of the note. A decision that has been
 * recorded already is answered again without a second change.
 */
export const reviewAccountClaim = defineCallable(reviewAccountClaimContract, {
  handler: async (input, context) => {
    const { db } = context;
    const reviewer = context.uid;
    const at = context.clock.now();

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, reviewer, transaction);
      requireCapability(context, access, "claims.review", "programme");
      if (input.uid === reviewer) throw new AppError("permission-denied", OWN_CLAIM_MESSAGE);
      const records = await readClaim(db, transaction, input.uid);
      const { claim, review } = records;
      if (claim === null || review === null) throw new AppError("not-found", "This claim does not exist.");

      if (input.decision === "reject") {
        if (claim.status === "rejected") return { status: "rejected" as const, personId: null };
        if (claim.status !== "pendingReview") throw new AppError("failed-precondition", NOT_PENDING_MESSAGE);
        const auditEventId = writeAudit(
          transaction,
          {
            action: "claim.rejected",
            actor: { kind: "user", uid: reviewer },
            entityType: "user",
            entityId: input.uid,
            changes: withheldChanges(["status", "reviewedBy", "reviewedAt", "decisionNote"]),
            at,
          },
          db,
        );
        const stamp = callerStamp(reviewer, at, auditEventId);
        writeClaim(
          transaction,
          records,
          "decision",
          {
            status: "rejected",
            personId: null,
            candidatePersonIds: review.candidatePersonIds,
            matchBasis: review.matchBasis,
            evidence: review.evidence,
            reviewedBy: reviewer,
            decisionNote: input.note,
          },
          stamp,
        );
        writeNotification(
          db,
          transaction,
          {
            uid: input.uid,
            type: "claimDecision",
            entityType: "user",
            entityId: input.uid,
            eventId: auditEventId,
            payload: { kind: "accountClaimRejected" },
          },
          stamp,
        );
        return { status: "rejected" as const, personId: null };
      }

      if (claim.status === "approved" && claim.personId === input.personId) {
        return { status: "approved" as const, personId: input.personId };
      }
      if (claim.status !== "pendingReview") throw new AppError("failed-precondition", NOT_PENDING_MESSAGE);
      const candidate = review.candidatePersonIds.includes(input.personId);
      if (!candidate) requireProgrammeAdministrator(access, NO_EVIDENCE_MESSAGE);
      const link = await readLink(db, transaction, input.uid, input.personId, at);
      const obstacle = linkObstacle(link);
      if (obstacle === "missing") throw new AppError("not-found", "This person does not exist.");
      if (obstacle === "archived") {
        throw new AppError(
          "failed-precondition",
          "This person is archived. Restore the record first, or choose another person.",
        );
      }
      if (obstacle === "claimed") {
        throw new AppError(
          "failed-precondition",
          "Another account has claimed this person already. Unlink that account first, or choose another person.",
        );
      }
      if (link.user === null || link.access === null) {
        throw new AppError("failed-precondition", "This account has not started the portal yet.");
      }
      const roleManagers = link.implied.some((role) => role.status === "pendingApproval")
        ? await holdersOf(db, transaction, "roles.manage")
        : [];

      const auditEventId = writeAudit(
        transaction,
        {
          action: "claim.approved",
          actor: { kind: "user", uid: reviewer },
          entityType: "person",
          entityId: input.personId,
          changes: [{ field: "userId", before: null, after: input.uid }],
          at,
        },
        db,
      );
      const stamp = callerStamp(reviewer, at, auditEventId);
      const linked = writeLink(db, transaction, link, stamp);
      writeClaim(
        transaction,
        records,
        "decision",
        {
          status: "approved",
          personId: input.personId,
          candidatePersonIds: candidate ? review.candidatePersonIds : [...review.candidatePersonIds, input.personId],
          matchBasis: review.matchBasis,
          evidence: {
            ...review.evidence,
            automatic: false,
            candidate,
            createdRoleAssignmentIds: linked.createdAssignmentIds,
          },
          reviewedBy: reviewer,
          decisionNote: input.note,
        },
        stamp,
      );
      writeNotification(
        db,
        transaction,
        {
          uid: input.uid,
          type: "claimDecision",
          entityType: "person",
          entityId: input.personId,
          eventId: auditEventId,
          payload: { kind: "accountClaimApproved" },
        },
        stamp,
      );
      if (linked.pendingRoles.length > 0) {
        notifyAll(
          db,
          transaction,
          roleManagers.filter((manager) => manager !== reviewer && manager !== input.uid),
          {
            type: "roleDecision",
            entityType: "user",
            entityId: input.uid,
            eventId: auditEventId,
            payload: { kind: "rolesAwaitApproval", count: linked.pendingRoles.length },
          },
          stamp,
        );
      }
      return { status: "approved" as const, personId: input.personId };
    });
  },
});
