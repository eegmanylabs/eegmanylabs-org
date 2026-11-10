import { COLLECTIONS, unlinkAccountClaimContract } from "@eegml/shared";
import { commitAccess, draftAccess, withAssignment } from "../access/maintain";
import { createdAssignmentIdsOf, readClaim, writeClaim } from "../claims/records";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";
import { writeNotification } from "../notifications/notify";
import { readAssignments, revokedAssignment } from "../roles/assignments";

/**
 * Reverses a wrong link between an account and a person. Capability: `roles.manage`, with the
 * second factor wherever the caller's access document requires one.
 *
 * One transaction clears the link on both sides, revokes the role assignments that the claim
 * created, which its review document lists, and writes the access document. A role that an
 * administrator granted apart from the claim stays as it is. The claim ends as `rejected`
 * with the reason as its note, so the next sign-in does not link the account to the same
 * person again: the account asks for access, and a reviewer chooses the right person.
 */
export const unlinkAccountClaim = defineCallable(unlinkAccountClaimContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();

    return db.runTransaction(async (transaction) => {
      requireCapability(context, await readAccessDocument(db, actor, transaction), "roles.manage", "programme");
      const records = await readClaim(db, transaction, input.uid);
      const { claim, review } = records;
      const personId = claim?.personId ?? null;
      if (claim === null || review === null || claim.status !== "approved" || personId === null) {
        throw new AppError("failed-precondition", "This account is not linked to a person.");
      }
      const personReference = db.doc(COLLECTIONS.persons.docPath(personId));
      const userReference = db.doc(COLLECTIONS.users.docPath(input.uid));
      const [person, assignments, draft] = await Promise.all([
        transaction.get(personReference),
        readAssignments(db, transaction, createdAssignmentIdsOf(review)),
        draftAccess(db, transaction, input.uid, at),
      ]);
      if (draft === null) throw new AppError("failed-precondition", "This account has no profile.");

      const auditEventId = writeAudit(
        transaction,
        {
          action: "claim.unlinked",
          actor: { kind: "user", uid: actor },
          entityType: "person",
          entityId: personId,
          changes: [
            { field: "userId", before: input.uid, after: null },
            { field: "reason", after: input.reason },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      // The person is cleared only while it still names this account.
      if (person.get("userId") === input.uid) {
        transaction.update(personReference, { userId: null, claimedAt: null, ...touchedFields(stamp) });
      }
      transaction.update(userReference, { personId: null, ...touchedFields(stamp) });

      let inputs = draft.inputs;
      let revoked = 0;
      for (const stored of assignments.values()) {
        const next = stored.data === null ? null : revokedAssignment(stored.data, input.reason, stamp);
        if (next === null) continue;
        transaction.set(stored.reference, next);
        inputs = withAssignment(inputs, next);
        revoked += 1;
        writeAudit(
          transaction,
          {
            action: "role.revoked",
            actor: { kind: "user", uid: actor },
            entityType: "user",
            entityId: input.uid,
            changes: [
              { field: "role", before: next.role },
              { field: "scopeType", before: next.scopeType },
              { field: "scopeId", before: next.scopeId },
              { field: "status", after: "revoked" },
            ],
            at,
            context: { causationId: auditEventId },
          },
          db,
        );
      }
      draft.inputs = { ...inputs, personId: null, confirmedReplicationIds: [] };
      commitAccess(db, transaction, draft, stamp);

      writeClaim(
        transaction,
        records,
        "reversal",
        {
          status: "rejected",
          personId: null,
          candidatePersonIds: review.candidatePersonIds,
          matchBasis: review.matchBasis,
          evidence: { ...review.evidence, createdRoleAssignmentIds: [] },
          reviewedBy: actor,
          decisionNote: input.reason,
        },
        stamp,
      );
      if (input.uid !== actor) {
        writeNotification(
          db,
          transaction,
          {
            uid: input.uid,
            type: "claimDecision",
            entityType: "user",
            entityId: input.uid,
            eventId: auditEventId,
            payload: { kind: "accountUnlinked" },
          },
          stamp,
        );
      }
      return { personId, revokedRoleAssignments: revoked };
    });
  },
});
