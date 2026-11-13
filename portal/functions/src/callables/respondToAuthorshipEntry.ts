import {
  authorshipEntryDocSchema,
  authorshipListDocSchema,
  COLLECTIONS,
  parseStoredDocument,
  respondToAuthorshipEntryContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";

const NO_ENTRY_MESSAGE = "You have no entry on the authorship list of this output.";

/**
 * Confirms the caller's own entry on the authorship list of a manuscript, or asks the leads for
 * a change with a note (requirement R12.9). The caller is the person of the entry, through the
 * account linked to that person, and nobody answers for another. The answer names the revision of
 * the entry it answers: an answer to an entry that the leads changed meanwhile is refused, so a
 * confirmation always covers what the person saw. Answers are taken while the list is in review.
 */
export const respondToAuthorshipEntry = defineCallable(respondToAuthorshipEntryContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    if (input.response === "changesRequested" && input.note === null) {
      throw new AppError("invalid-argument", "Say what should change.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      if (!access.member || access.personId === null) throw new AppError("not-found", NO_ENTRY_MESSAGE);
      const list = parseStoredDocument(
        authorshipListDocSchema,
        (await transaction.get(db.doc(COLLECTIONS.authorshipLists.docPath(input.manuscriptId)))).data(),
      );
      const reference = db.doc(COLLECTIONS.authorshipEntries.docPath(input.manuscriptId, access.personId));
      const entry = parseStoredDocument(authorshipEntryDocSchema, (await transaction.get(reference)).data());
      if (!list.success || !entry.success) throw new AppError("not-found", NO_ENTRY_MESSAGE);
      if (list.data.status !== "inReview") {
        throw new AppError(
          "failed-precondition",
          list.data.status === "draft"
            ? "The leads have not sent this list for review yet."
            : "This list is final. Ask the leads of the replication to reopen it.",
        );
      }
      if (entry.data.entryRevision !== input.entryRevision) {
        throw new AppError(
          "failed-precondition",
          "The leads changed your entry after you opened it. Read it again before you answer.",
        );
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "authorship.answered",
          actor: { kind: "user", uid: context.uid },
          entityType: "manuscript",
          entityId: input.manuscriptId,
          changes: [
            { field: "personId", after: access.personId },
            { field: "response", before: entry.data.confirmation.status, after: input.response },
            { field: "entryRevision", after: input.entryRevision },
          ],
          at,
        },
        db,
      );
      transaction.update(reference, {
        confirmation: {
          status: input.response,
          revision: input.entryRevision,
          respondedAt: Timestamp.fromDate(at),
          ...(input.note === null ? {} : { note: input.note }),
        },
        ...touchedFields(callerStamp(context.uid, at, auditEventId)),
      });
      return { manuscriptId: input.manuscriptId };
    });
  },
});
