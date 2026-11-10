import { COLLECTIONS, personEmailIndexId, requestAccessContract } from "@eegml/shared";
import { readClaim, writeClaim } from "../claims/records";
import {
  AppError,
  callerStamp,
  defineCallable,
  identityHashKey,
  requireVerifiedEmail,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { holdersOf, notifyAll } from "../notifications/notify";

/**
 * Asks a reviewer for access, for a signed-in caller whose address matched nobody
 * (docs/SECURITY.md, section 4). The caller states a name, an affiliation and a short message,
 * which are stored for reviewers alone, as a claim that awaits review with the match basis
 * `manual`.
 *
 * | The caller's claim     | The call                                                       |
 * |------------------------|----------------------------------------------------------------|
 * | Awaits review after an address match, with no statement yet | Adds the statement to the review record for the reviewer, and changes nothing else |
 * | Awaits review otherwise | Is refused: one request may be open per account               |
 * | Is approved            | Is refused: the account is linked already                      |
 * | Was rejected, or none  | Opens a request, notifies the reviewers, answers `pendingReview` |
 *
 * Whoever carries the caller's verified address is noted for the reviewer as a candidate. The
 * caller is told nothing about it.
 */
export const requestAccess = defineCallable(requestAccessContract, {
  usesIdentityHashKey: true,
  handler: async (input, context) => {
    const { uid, db } = context;
    const emailLower = requireVerifiedEmail(context);
    const indexReference = db.doc(
      COLLECTIONS.personEmailIndex.docPath(personEmailIndexId(emailLower, identityHashKey())),
    );
    const userReference = db.doc(COLLECTIONS.users.docPath(uid));
    const at = context.clock.now();

    return db.runTransaction(async (transaction) => {
      const records = await readClaim(db, transaction, uid);
      const { claim, review } = records;
      if (
        claim?.status === "pendingReview" &&
        review !== null &&
        review.matchBasis !== "manual" &&
        review.evidence.statedName === undefined
      ) {
        // A claim that an address match sent to review: what the claimant says helps the reviewer
        // tell the candidates apart. The match, its candidates and its reason stay as they are.
        const auditEventId = writeAudit(
          transaction,
          {
            action: "claim.requested",
            actor: { kind: "user", uid },
            entityType: "user",
            entityId: uid,
            changes: withheldChanges(["evidence"]),
            at,
          },
          db,
        );
        transaction.update(records.reviewReference, {
          evidence: {
            ...review.evidence,
            statedName: input.statedName,
            affiliation: input.affiliation,
            message: input.message,
          },
          ...touchedFields(callerStamp(uid, at, auditEventId)),
        });
        return { status: "pendingReview" as const };
      }
      if (claim?.status === "pendingReview") {
        throw new AppError(
          "resource-exhausted",
          "A request of yours is waiting for review already. You will be notified when it has been decided.",
        );
      }
      if (records.claim?.status === "approved") {
        throw new AppError("failed-precondition", "Your account is linked to a profile already.");
      }
      const [user, index] = await transaction.getAll(userReference, indexReference);
      if (user?.exists !== true)
        throw new AppError("failed-precondition", "Start the portal before you ask for access.");
      const candidates: unknown = index?.get("personIds");
      const reviewers = await holdersOf(db, transaction, "claims.review");

      const auditEventId = writeAudit(
        transaction,
        {
          action: "claim.requested",
          actor: { kind: "user", uid },
          entityType: "user",
          entityId: uid,
          changes: withheldChanges(["status", "evidence", "matchBasis"]),
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      writeClaim(
        transaction,
        records,
        "attempt",
        {
          status: "pendingReview",
          personId: null,
          candidatePersonIds: Array.isArray(candidates)
            ? candidates.filter((id): id is string => typeof id === "string")
            : [],
          matchBasis: "manual",
          evidence: { statedName: input.statedName, affiliation: input.affiliation, message: input.message },
          reviewedBy: null,
        },
        stamp,
      );
      notifyAll(
        db,
        transaction,
        reviewers.filter((reviewer) => reviewer !== uid),
        {
          type: "claimDecision",
          entityType: "user",
          entityId: uid,
          eventId: auditEventId,
          payload: { kind: "accessRequestAwaitsReview" },
        },
        stamp,
      );
      return { status: "pendingReview" as const };
    });
  },
});
