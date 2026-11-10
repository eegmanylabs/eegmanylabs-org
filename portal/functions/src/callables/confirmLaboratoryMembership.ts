import { COLLECTIONS, confirmLaboratoryMembershipContract, rolesOfMemberEntry, withUnit } from "@eegml/shared";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";
import { confirmingAs, personPath, readAccountOfPerson, storedIds, writeAccountOfPerson } from "../people/confirmation";

const CHANGED_MESSAGE =
  "This entry has changed since you saw it, so nothing was confirmed. Reload the page and look at it again.";

/**
 * Confirms a member entry of a laboratory. The security rules let a coordinator propose an
 * entry and never confirm one, because a confirmed entry puts the laboratory on the directory
 * document of the person, which gives the coordinators of that laboratory sight of the
 * person's contact details.
 *
 * | Caller                                        | May confirm                                      |
 * |-----------------------------------------------|--------------------------------------------------|
 * | The person concerned                          | Their own entry                                  |
 * | A holder of `labs.manage` for the programme   | Any entry, with the second factor where required |
 *
 * The call states the role and the mark of an authorised representative that it confirms.
 * The stored entry must say exactly that, and must be proposed and not archived: a
 * confirmation never covers a role that its giver did not see. In the same transaction the
 * laboratory is put on the person, and the account of the person, if there is one, receives
 * what the entry implies: membership of the laboratory at once, and its coordination, for a
 * coordinator or a principal investigator, as a role that awaits approval (decision D-005).
 */
export const confirmLaboratoryMembership = defineCallable(confirmLaboratoryMembershipContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const entryReference = db.doc(COLLECTIONS.laboratoryMembers.docPath(input.laboratoryId, input.personId));
    const personReference = db.doc(personPath(input.personId));
    const answer = { laboratoryId: input.laboratoryId, personId: input.personId, status: "confirmed" as const };

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, actor, transaction);
      const [entry, person] = await transaction.getAll(entryReference, personReference);
      if (person === undefined || entry === undefined) throw new Error("The transaction returned no snapshot.");
      confirmingAs(context, access, person, "labs.manage", { personMayConfirm: true });
      if (!entry.exists || !person.exists) throw new AppError("not-found", "This member entry does not exist.");
      if (
        entry.get("archivedAt") != null ||
        entry.get("role") !== input.role ||
        entry.get("isAuthorisedRepresentative") !== input.isAuthorisedRepresentative
      ) {
        throw new AppError("failed-precondition", CHANGED_MESSAGE);
      }
      if (entry.get("status") === "confirmed") return answer;
      if (entry.get("status") !== "proposed") throw new AppError("failed-precondition", CHANGED_MESSAGE);

      const confirmed = { ...entry.data(), status: "confirmed" };
      const account = await readAccountOfPerson(
        db,
        transaction,
        person,
        rolesOfMemberEntry(input.laboratoryId, confirmed),
        at,
      );

      const auditEventId = writeAudit(
        transaction,
        {
          action: "laboratoryMember.confirmed",
          actor: { kind: "user", uid: actor },
          entityType: "laboratory",
          entityId: input.laboratoryId,
          changes: [
            { field: "personId", after: input.personId },
            { field: "role", after: input.role },
            { field: "isAuthorisedRepresentative", after: input.isAuthorisedRepresentative },
            { field: "status", before: "proposed", after: "confirmed" },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      transaction.update(entryReference, { status: "confirmed", ...touchedFields(stamp) });
      transaction.update(personReference, {
        laboratoryIds: withUnit(storedIds(person, "laboratoryIds"), input.laboratoryId, true),
        ...touchedFields(stamp),
      });
      if (account !== null) {
        writeAccountOfPerson(
          db,
          transaction,
          account,
          {
            notification: {
              entityType: "laboratory",
              entityId: input.laboratoryId,
              kind: "laboratoryMembershipConfirmed",
            },
          },
          stamp,
        );
      }
      return answer;
    });
  },
});
