import {
  COLLECTIONS,
  confirmReplicationMembershipContract,
  membershipCounts,
  replicationMembershipId,
  rolesOfMembership,
  withUnit,
} from "@eegml/shared";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";
import { confirmingAs, personPath, readAccountOfPerson, storedIds, writeAccountOfPerson } from "../people/confirmation";

const CHANGED_MESSAGE =
  "This membership has changed since you saw it, so nothing was confirmed. Reload the page and look at it again.";

/** The roles in which a membership says who leads a replication. Only the programme settles those. */
const LEADING_ROLES: readonly string[] = ["lead", "coLead"];

/**
 * Confirms a membership of a replication, which the security rules leave to this function:
 * a lead proposes a membership and never sets its review status.
 *
 * | Caller                                               | May confirm                                      |
 * |------------------------------------------------------|--------------------------------------------------|
 * | The person concerned                                 | Their own membership, except as `lead` or `coLead` |
 * | A holder of `replications.manage` for the programme  | Any membership, with the second factor where required |
 *
 * Who leads a replication is settled by the programme, because the sources can disagree about
 * it, so nobody confirms their own lead. The call states the role and whether the membership
 * is current, and the stored membership must say exactly that and must not be archived. In the
 * same transaction the replication is put on the person where the membership is current, and
 * the account of the person, if there is one, reads the workspace of the replication as a
 * member of its team. A confirmed lead implies the role of a replication lead, which awaits
 * approval (decision D-005).
 */
export const confirmReplicationMembership = defineCallable(confirmReplicationMembershipContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const memberships = db.collection(COLLECTIONS.replicationMemberships.collectionPath(input.replicationId));
    const membershipReference = memberships.doc(replicationMembershipId(input.personId, input.role));
    const personReference = db.doc(personPath(input.personId));
    const answer = {
      replicationId: input.replicationId,
      personId: input.personId,
      role: input.role,
      reviewStatus: "confirmed" as const,
    };

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, actor, transaction);
      const [membership, person] = await transaction.getAll(membershipReference, personReference);
      if (person === undefined || membership === undefined) throw new Error("The transaction returned no snapshot.");
      confirmingAs(context, access, person, "replications.manage", {
        personMayConfirm: !LEADING_ROLES.includes(input.role),
      });
      if (!membership.exists || !person.exists) throw new AppError("not-found", "This membership does not exist.");
      if (membership.get("archivedAt") != null || membership.get("isCurrent") !== input.isCurrent) {
        throw new AppError("failed-precondition", CHANGED_MESSAGE);
      }
      if (membership.get("reviewStatus") === "confirmed") return answer;

      // The replication stays on the person while any of the person's memberships there counts.
      const siblings = await transaction.get(memberships.where("personId", "==", input.personId));
      const confirmed = { ...membership.data(), reviewStatus: "confirmed" };
      const counts =
        membershipCounts(confirmed) ||
        siblings.docs.some((sibling) => sibling.id !== membership.id && membershipCounts(sibling.data()));
      const replicationIds = withUnit(storedIds(person, "replicationIds"), input.replicationId, counts);
      const account = await readAccountOfPerson(
        db,
        transaction,
        person,
        rolesOfMembership(input.replicationId, confirmed),
        at,
      );

      const auditEventId = writeAudit(
        transaction,
        {
          action: "replicationMembership.confirmed",
          actor: { kind: "user", uid: actor },
          entityType: "replication",
          entityId: input.replicationId,
          changes: [
            { field: "personId", after: input.personId },
            { field: "role", after: input.role },
            { field: "isCurrent", after: input.isCurrent },
            { field: "reviewStatus", before: "needsReview", after: "confirmed" },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      transaction.update(membershipReference, { reviewStatus: "confirmed", ...touchedFields(stamp) });
      transaction.update(personReference, { replicationIds, ...touchedFields(stamp) });
      if (account !== null) {
        writeAccountOfPerson(
          db,
          transaction,
          account,
          {
            confirmedReplicationIds: replicationIds,
            notification: {
              entityType: "replication",
              entityId: input.replicationId,
              kind: "replicationMembershipConfirmed",
            },
          },
          stamp,
        );
      }
      return answer;
    });
  },
});
