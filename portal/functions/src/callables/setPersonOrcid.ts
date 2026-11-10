import {
  COLLECTIONS,
  identityKeyDocSchema,
  identityKeyId,
  parseStoredDocument,
  personEvidenceKey,
  setPersonOrcidContract,
} from "@eegml/shared";
import { FieldValue } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  identityHashKey,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

const HELD_MESSAGE =
  "Another person record holds this ORCID iD. Check the iD, or ask a programme administrator to look at the two records.";

/**
 * Sets, changes or removes the ORCID iD of a person. The security rules let no client write
 * the iD, because imports find a person again by it and a rule cannot tell whose an iD is.
 *
 * | Caller                           | May change                                                    |
 * |----------------------------------|---------------------------------------------------------------|
 * | The person concerned             | The iD of their own record, once they state that it is theirs |
 * | A holder of `people.manage`      | The iD of any person, with the second factor where required   |
 *
 * The iD is reserved as an identity key in the transaction of the change, under the keyed
 * hash that the importers use, so two persons can never hold one iD: a key that names another
 * person, or that is the tombstone of a merged or erased record, refuses the change. The key
 * of the earlier iD is released in the same transaction.
 */
export const setPersonOrcid = defineCallable(setPersonOrcidContract, {
  usesIdentityHashKey: true,
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const orcid = input.orcid === null ? null : input.orcid.toUpperCase();
    const secret = identityHashKey();
    const keyReference = (value: string) =>
      db.doc(
        COLLECTIONS.identityKeys.docPath(identityKeyId("person", "orcid", personEvidenceKey.orcid(value), secret)),
      );
    const personReference = db.doc(COLLECTIONS.persons.docPath(input.personId));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const person = await transaction.get(personReference);
      const own = person.exists && person.get("userId") === uid && access.member;
      if (own && !input.confirmedOwn) {
        throw new AppError("failed-precondition", "Confirm that this ORCID iD is your own before it is saved.");
      }
      if (!own) requireCapability(context, access, "people.manage", "programme");
      if (!person.exists) throw new AppError("not-found", "This person does not exist.");
      if (person.get("archivedAt") != null) {
        throw new AppError("failed-precondition", "This person is archived. Restore the record before you change it.");
      }
      const stored: unknown = person.get("orcid");
      const before = typeof stored === "string" && stored !== "" ? stored.toUpperCase() : null;
      if (before === orcid) return { personId: input.personId, orcid };

      const [next, previous] = await Promise.all([
        orcid === null ? null : transaction.get(keyReference(orcid)),
        before === null ? null : transaction.get(keyReference(before)),
      ]);
      const holder = next?.exists === true ? parseStoredDocument(identityKeyDocSchema, next.data()) : null;
      if (holder !== null) {
        if (!holder.success) throw holder.error;
        const others = holder.data.entityIds.filter((id) => id !== input.personId);
        const mergedIntoSelf = holder.data.status === "merged" && holder.data.mergedIntoId === input.personId;
        if (
          others.length > 0 ||
          holder.data.entityType !== "person" ||
          (holder.data.status !== "active" && !mergedIntoSelf)
        ) {
          throw new AppError("already-exists", HELD_MESSAGE);
        }
      }

      const auditEventId = writeAudit(
        transaction,
        {
          action: "person.orcidChanged",
          actor: { kind: "user", uid },
          entityType: "person",
          entityId: input.personId,
          changes: [{ field: "orcid", before, after: orcid }],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      transaction.update(personReference, { orcid: orcid ?? FieldValue.delete(), ...touchedFields(stamp) });
      if (orcid !== null && next !== null) {
        transaction.set(
          next.ref,
          identityKeyDocSchema.parse({
            ...createdFields("identityKeys", stamp),
            ...(holder === null ? {} : { createdAt: holder.data.createdAt, createdBy: holder.data.createdBy }),
            entityType: "person",
            keyKind: "orcid",
            entityIds: [input.personId],
            status: "active",
            mergedIntoId: null,
          }),
        );
      }
      if (previous?.exists === true) {
        const listed: unknown = previous.get("entityIds");
        const remaining = Array.isArray(listed) ? listed.filter((id) => id !== input.personId) : [];
        // A key that names nobody is removed, so the iD is free again. A tombstone stays.
        if (remaining.length === 0 && previous.get("status") === "active") transaction.delete(previous.ref);
        else if (remaining.length > 0)
          transaction.update(previous.ref, { entityIds: remaining, ...touchedFields(stamp) });
      }
      return { personId: input.personId, orcid };
    });
  },
});
