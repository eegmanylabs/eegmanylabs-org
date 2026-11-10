// The trigger that derives `laboratoryIds` and `replicationIds` of a person (docs/DATA_MODEL.md,
// section 14) from the member entries of laboratories and the memberships of replications.
//
// The two arrays decide who reads the contact details of a person: the leads and the
// coordinators of the units they name. Only an entry that is confirmed and not archived, and a
// membership that is confirmed, current and not archived, puts a unit there (see
// `memberEntryCounts` and `membershipCounts` of the shared package), so nobody gains sight of
// an address by adding a person to their own unit, and an archived entry gives none.
//
// A handler reads the entry and the person as they are now, in one transaction, and sets the
// one unit of the event present or absent. A delivery that arrives twice, late or out of order
// therefore ends in the same arrays. A function that confirmed an entry has written the person
// in its own transaction, and its event finds nothing left to do.
import { COLLECTIONS, memberEntryCounts, membershipCounts, sameUnits, withUnit } from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/firestore";
import { firestore } from "../framework/admin";
import { reactionStamp, touchedFields } from "../framework/documents";
import { documentTrigger } from "../framework/trigger";

interface Cause {
  readonly eventId: string;
  readonly at: Date;
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

/**
 * Brings one unit of one person in line. `counts` reads, inside the transaction, whether the
 * unit belongs on the person now. Returns whether the person was written.
 */
async function syncUnit(
  db: Firestore,
  personId: string,
  field: "laboratoryIds" | "replicationIds",
  unitId: string,
  counts: (transaction: Transaction) => Promise<boolean>,
  cause: Cause,
): Promise<boolean> {
  const personReference = db.doc(COLLECTIONS.persons.docPath(personId));
  return db.runTransaction(async (transaction) => {
    const person = await transaction.get(personReference);
    if (!person.exists) return false;
    const stored = ids(person.get(field));
    const next = withUnit(stored, unitId, await counts(transaction));
    if (sameUnits(stored, next) && stored.length === next.length) return false;
    transaction.update(personReference, {
      [field]: next,
      ...touchedFields(reactionStamp("personUnits", cause.at, cause.eventId)),
    });
    return true;
  });
}

/** Sets a laboratory present on a person exactly while the person's member entry there counts. */
export function syncPersonLaboratory(
  db: Firestore,
  laboratoryId: string,
  personId: string,
  cause: Cause,
): Promise<boolean> {
  const entryReference = db.doc(COLLECTIONS.laboratoryMembers.docPath(laboratoryId, personId));
  return syncUnit(
    db,
    personId,
    "laboratoryIds",
    laboratoryId,
    async (transaction) => memberEntryCounts((await transaction.get(entryReference)).data()),
    cause,
  );
}

/** Sets a replication present on a person exactly while one of the person's memberships there counts. */
export function syncPersonReplication(
  db: Firestore,
  replicationId: string,
  personId: string,
  cause: Cause,
): Promise<boolean> {
  const memberships = db
    .collection(COLLECTIONS.replicationMemberships.collectionPath(replicationId))
    .where("personId", "==", personId);
  return syncUnit(
    db,
    personId,
    "replicationIds",
    replicationId,
    async (transaction) =>
      (await transaction.get(memberships)).docs.some((membership) => membershipCounts(membership.data())),
    cause,
  );
}

/** A member entry of a laboratory was created, changed or removed. */
export const personUnitsOnLaboratoryMemberWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.laboratoryMembers.path),
  async (event) => {
    await syncPersonLaboratory(firestore(), event.params.laboratoryId, event.params.personId, {
      eventId: event.id,
      at: new Date(event.time),
    });
  },
);

/** A membership of a replication was created, changed or removed. Both states can name a person. */
export const personUnitsOnReplicationMembershipWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.replicationMemberships.path),
  async (event) => {
    const named = [event.data?.before.get("personId"), event.data?.after.get("personId")];
    const personIds = new Set(named.filter((id): id is string => typeof id === "string" && id !== ""));
    for (const personId of personIds) {
      await syncPersonReplication(firestore(), event.params.studyKey, personId, {
        eventId: event.id,
        at: new Date(event.time),
      });
    }
  },
);
