import {
  asciiLowerCase,
  COLLECTIONS,
  LIMITS,
  labClaimDocSchema,
  labClaimId,
  labClaimReviewDocSchema,
  parseStoredDocument,
  requestLabClaimContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireVerifiedEmail,
  withheldChanges,
  writeAudit,
} from "../framework";
import { holdersOf, notifyAll } from "../notifications/notify";

const NOT_LINKED_MESSAGE =
  "Claim your profile first. Only a member with a linked profile can ask to represent a laboratory.";

/** Whether an address lies in one of the email domains of an institution, or in a subdomain of one. */
export function addressInDomains(emailLower: string, domains: readonly unknown[]): boolean {
  const domain = emailLower.slice(emailLower.lastIndexOf("@") + 1);
  return domains.some(
    (candidate) =>
      typeof candidate === "string" &&
      candidate !== "" &&
      (domain === asciiLowerCase(candidate) || domain.endsWith(`.${asciiLowerCase(candidate)}`)),
  );
}

/**
 * Asks to represent a laboratory, as its coordinator or as an authorised representative
 * (docs/SECURITY.md, section 4). For a member whose account is linked to a person.
 *
 * The evidence is computed here and never taken from the caller:
 *
 * | Evidence                        | Meaning                                                          |
 * |---------------------------------|------------------------------------------------------------------|
 * | `personListsLaboratory`         | The directory document of the person names the laboratory        |
 * | `memberEntry`                   | The status and the role of the person's member entry there, if any |
 * | `emailDomainMatchesInstitution` | The caller's verified address lies in an email domain of the laboratory's institution. Null where the laboratory names no institution |
 *
 * It is stored with the request for whoever decides it: the holders of `labs.claims.review`,
 * which are programme administrators, the core team and the coordinators of that laboratory.
 * The address itself is not stored. One request per account and laboratory may be open.
 */
export const requestLabClaim = defineCallable(requestLabClaimContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const emailLower = requireVerifiedEmail(context);
    const at = context.clock.now();
    const now = Timestamp.fromDate(at);
    const claimId = labClaimId(uid, input.laboratoryId);
    const claimReference = db.doc(COLLECTIONS.labClaims.docPath(claimId));
    const reviewReference = db.doc(COLLECTIONS.labClaimReview.docPath(claimId));
    const laboratoryReference = db.doc(COLLECTIONS.laboratories.docPath(input.laboratoryId));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const personId = access.personId;
      if (!access.member || personId === null)
        throw new AppError("failed-precondition", NOT_LINKED_MESSAGE, "notLinked");
      const [laboratory, claimSnapshot, reviewSnapshot, person, entry] = await transaction.getAll(
        laboratoryReference,
        claimReference,
        reviewReference,
        db.doc(COLLECTIONS.persons.docPath(personId)),
        db.doc(COLLECTIONS.laboratoryMembers.docPath(input.laboratoryId, personId)),
      );
      if (laboratory?.exists !== true || laboratory.get("archivedAt") != null) {
        throw new AppError("not-found", "This laboratory does not exist.");
      }
      const stored = claimSnapshot?.exists ? parseStoredDocument(labClaimDocSchema, claimSnapshot.data()) : null;
      const storedReview = reviewSnapshot?.exists
        ? parseStoredDocument(labClaimReviewDocSchema, reviewSnapshot.data())
        : null;
      if ((stored !== null && !stored.success) || (storedReview !== null && !storedReview.success)) {
        throw new Error("A stored laboratory claim does not fit its schema.");
      }
      if (stored?.data.status === "pendingReview") {
        throw new AppError(
          "resource-exhausted",
          "Your request for this laboratory is waiting for review already. You will be notified when it has been decided.",
        );
      }
      if (stored?.data.status === "approved") {
        throw new AppError("failed-precondition", "Your request for this laboratory has been approved already.");
      }
      const institutionId: unknown = laboratory.get("institutionId");
      const institution =
        typeof institutionId === "string" && institutionId !== ""
          ? await transaction.get(db.doc(COLLECTIONS.institutions.docPath(institutionId)))
          : null;
      const domains: unknown = institution?.get("emailDomains");
      const reviewers = await holdersOf(db, transaction, "labs.claims.review", { laboratoryId: input.laboratoryId });

      const listed: unknown = person?.get("laboratoryIds");
      const evidence = {
        personListsLaboratory: Array.isArray(listed) && listed.includes(input.laboratoryId),
        memberEntry:
          entry?.exists === true
            ? {
                status: entry.get("status") ?? null,
                role: entry.get("role") ?? null,
                archived: entry.get("archivedAt") != null,
              }
            : null,
        emailDomainMatchesInstitution:
          institution?.exists === true ? addressInDomains(emailLower, Array.isArray(domains) ? domains : []) : null,
        ...(input.message === undefined ? {} : { message: input.message }),
      };

      const auditEventId = writeAudit(
        transaction,
        {
          action: "labClaim.requested",
          actor: { kind: "user", uid },
          entityType: "laboratory",
          entityId: input.laboratoryId,
          changes: withheldChanges(["status", "requestedRole", "evidence"]),
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const kept = (document: { createdAt: unknown; createdBy: unknown } | undefined) =>
        document === undefined ? {} : { createdAt: document.createdAt, createdBy: document.createdBy };
      transaction.set(
        claimReference,
        labClaimDocSchema.parse({
          ...createdFields("labClaims", stamp),
          ...kept(stored?.data),
          laboratoryId: input.laboratoryId,
          uid,
          requestedRole: input.requestedRole,
          status: "pendingReview",
          submittedAt: now,
        }),
      );
      const earlier =
        stored?.data !== undefined && storedReview?.data !== undefined
          ? [
              {
                status: stored.data.status,
                requestedRole: stored.data.requestedRole,
                reviewedBy: storedReview.data.reviewedBy,
                reviewedAt: storedReview.data.reviewedAt,
                ...(storedReview.data.decisionNote === undefined
                  ? {}
                  : { decisionNote: storedReview.data.decisionNote }),
              },
            ]
          : [];
      transaction.set(
        reviewReference,
        labClaimReviewDocSchema.parse({
          ...createdFields("labClaimReview", stamp),
          ...kept(storedReview?.data),
          evidence,
          reviewedBy: null,
          reviewedAt: null,
          history: [...(storedReview?.data.history ?? []), ...earlier].slice(-LIMITS.list),
        }),
      );
      notifyAll(
        db,
        transaction,
        reviewers.filter((reviewer) => reviewer !== uid),
        {
          type: "claimDecision",
          entityType: "laboratory",
          entityId: input.laboratoryId,
          eventId: auditEventId,
          payload: { kind: "labClaimAwaitsReview", requestedRole: input.requestedRole },
        },
        stamp,
      );
      return { claimId, status: "pendingReview" as const };
    });
  },
});
