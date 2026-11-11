// The merge of two records of one person, decided by a reviewer of the reconciliation queue
// (docs/DATA_MODEL.md, sections 3 and 14). Everything happens in the caller's transaction.
//
// | What refers to the merged record          | What the merge does                                          |
// |-------------------------------------------|--------------------------------------------------------------|
// | Identity keys                             | A key of the merged record alone becomes its tombstone, `merged` into the kept one, so an import resolves it to the kept record and never recreates the merged one. A key shared with others names the kept record in its place |
// | The email index                           | Each entry names the kept record in place of the merged one  |
// | The contact document                      | Its addresses, with their source records, are added to the kept record's |
// | Member entries of laboratories, memberships of replications, team entries of participations | Each is copied to the kept record, unless the kept record has one already, and the merged one is archived |
// | Affiliations                              | Each is copied beneath the kept record                        |
// | `piPersonId`, `localLeadPersonId`, `leadPersonIds`, `personId` of contributors and outreach contacts | Name the kept record |
// | The merged directory document             | Its source records join the kept record's, so no source link is lost, and it is archived |
//
// A record that an account has claimed is never merged away, because its link to the account
// would be lost: the reviewer keeps that record instead, or unlinks the account first. When the
// kept record is linked to an account, which only a programme administrator decides, the
// member entries and memberships it gains await confirmation again (`proposed` and
// `needsReview`), so that no role and no scope reaches the account unconfirmed, the kept record
// keeps its own `laboratoryIds` and `replicationIds`, the merged record is taken out of
// `leadPersonIds` in place of being replaced, and the account is told.
// The audit entry of the merge names the identity keys and the email index entries it moved by
// their identifiers, which are keyed hashes, and never by the addresses behind them.
import {
  type AuditChange,
  COLLECTIONS,
  identityKeyDocSchema,
  parseStoredDocument,
  personContactDocSchema,
  personDocSchema,
} from "@eegml/shared";
import {
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { AppError, createdFields, touchedFields, type WriteStamp } from "../framework";
import { writeNotification } from "../notifications/notify";

/** What the reads of a merge found, before anything is written. */
export interface MergePlan {
  readonly keepId: string;
  readonly mergeId: string;
  /** What the merge moves, for its audit entry: identifiers only, never an address. */
  auditChanges(): AuditChange[];
  /** Applies the merge. Call it after the last read of the transaction. Returns the number of documents written. */
  apply(stamp: WriteStamp): number;
}

/** The fields of a copied entry that ask for its confirmation again. */
function unconfirmed(data: DocumentData): DocumentData {
  if (typeof data.reviewStatus === "string") return { reviewStatus: "needsReview" };
  if (data.status === "confirmed") return { status: "proposed" };
  return {};
}

const replaced = (ids: unknown, from: string, to: string): string[] =>
  [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .filter((id): id is string => typeof id === "string")
        .map((id) => (id === from ? to : id)),
    ),
  ].sort();

const union = (left: unknown, right: unknown): string[] =>
  [
    ...new Set(
      [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].filter(
        (id): id is string => typeof id === "string",
      ),
    ),
  ].sort();

/** Reads everything a merge changes and refuses one that would lose a link. */
export async function planPersonMerge(
  db: Firestore,
  transaction: Transaction,
  keepId: string,
  mergeId: string,
): Promise<MergePlan> {
  if (keepId === mergeId) throw new AppError("invalid-argument", "Choose two different records to merge.");
  const keepReference = db.doc(COLLECTIONS.persons.docPath(keepId));
  const mergeReference = db.doc(COLLECTIONS.persons.docPath(mergeId));
  const keepContactReference = db.doc(COLLECTIONS.personContact.docPath(keepId));
  const mergeContactReference = db.doc(COLLECTIONS.personContact.docPath(mergeId));
  const [keepSnapshot, mergeSnapshot, keepContact, mergeContact] = await transaction.getAll(
    keepReference,
    mergeReference,
    keepContactReference,
    mergeContactReference,
  );
  const keep = keepSnapshot?.exists ? parseStoredDocument(personDocSchema, keepSnapshot.data()) : null;
  const merged = mergeSnapshot?.exists ? parseStoredDocument(personDocSchema, mergeSnapshot.data()) : null;
  if (keep === null || merged === null) throw new AppError("not-found", "One of the two records does not exist.");
  if (!keep.success) throw keep.error;
  if (!merged.success) throw merged.error;
  if (keep.data.archivedAt !== null || merged.data.archivedAt !== null) {
    throw new AppError("failed-precondition", "One of the two records is archived. Restore it before merging.");
  }
  if (merged.data.userId !== null) {
    throw new AppError(
      "failed-precondition",
      "The record to merge away is linked to an account, and the link would be lost. Keep that record instead, or unlink the account first.",
    );
  }

  const byPerson = (collectionId: string) =>
    transaction.get(db.collectionGroup(collectionId).where("personId", "==", mergeId));
  const [
    keys,
    emailIndex,
    entries,
    memberships,
    teamEntries,
    affiliations,
    laboratories,
    participations,
    replications,
    contributors,
    outreach,
  ] = await Promise.all([
    transaction.get(
      db.collection(COLLECTIONS.identityKeys.collectionPath()).where("entityIds", "array-contains", mergeId),
    ),
    transaction.get(
      db.collection(COLLECTIONS.personEmailIndex.collectionPath()).where("personIds", "array-contains", mergeId),
    ),
    byPerson(COLLECTIONS.laboratoryMembers.collectionId),
    byPerson(COLLECTIONS.replicationMemberships.collectionId),
    byPerson(COLLECTIONS.participationTeamMembers.collectionId),
    transaction.get(db.collection(COLLECTIONS.personAffiliations.collectionPath(mergeId))),
    transaction.get(db.collection(COLLECTIONS.laboratories.collectionPath()).where("piPersonId", "==", mergeId)),
    transaction.get(
      db.collection(COLLECTIONS.participations.collectionPath()).where("localLeadPersonId", "==", mergeId),
    ),
    transaction.get(
      db.collection(COLLECTIONS.replications.collectionPath()).where("leadPersonIds", "array-contains", mergeId),
    ),
    transaction.get(db.collection(COLLECTIONS.contributors.collectionPath()).where("personId", "==", mergeId)),
    transaction.get(db.collection(COLLECTIONS.outreachContacts.collectionPath()).where("personId", "==", mergeId)),
  ]);

  /** The copy of an entry of the merged record beneath the same parent, under the kept record's identifier. */
  const copyTarget = (entry: QueryDocumentSnapshot, ownId: string): DocumentReference => entry.ref.parent.doc(ownId);
  const movedEntries = [
    ...entries.docs.map((entry) => ({ entry, target: copyTarget(entry, keepId) })),
    ...teamEntries.docs.map((entry) => ({ entry, target: copyTarget(entry, keepId) })),
    ...memberships.docs.map((entry) => ({
      entry,
      target: copyTarget(entry, `${keepId}__${String(entry.get("role"))}`),
    })),
  ];
  const targets =
    movedEntries.length === 0 ? [] : await transaction.getAll(...movedEntries.map((moved) => moved.target));
  const affiliationTargets = affiliations.empty
    ? []
    : await transaction.getAll(
        ...affiliations.docs.map((entry) => db.doc(COLLECTIONS.personAffiliations.docPath(keepId, entry.id))),
      );

  const linkedAccount = keep.data.userId;
  return {
    keepId,
    mergeId,
    auditChanges() {
      return [
        { field: "identityKeys", after: keys.docs.map((key) => key.id).sort() },
        { field: "personEmailIndex", after: emailIndex.docs.map((entry) => entry.id).sort() },
        { field: "linkedAccount", after: linkedAccount !== null },
        ...(linkedAccount === null
          ? []
          : [{ field: "copiedEntriesAwaitConfirmation", after: movedEntries.length } satisfies AuditChange]),
      ];
    },
    apply(stamp) {
      let written = 0;
      const now = Timestamp.fromDate(stamp.at);
      const touch = touchedFields(stamp);
      const update = (reference: DocumentReference, data: DocumentData) => {
        transaction.update(reference, { ...data, ...touch });
        written += 1;
      };
      for (const key of keys.docs) {
        const parsed = parseStoredDocument(identityKeyDocSchema, key.data());
        if (!parsed.success) throw parsed.error;
        const others = parsed.data.entityIds.filter((id) => id !== mergeId);
        if (others.length === 0) update(key.ref, { status: "merged", mergedIntoId: keepId });
        else update(key.ref, { entityIds: replaced(parsed.data.entityIds, mergeId, keepId) });
      }
      for (const entry of emailIndex.docs) {
        update(entry.ref, {
          personIds: replaced(entry.get("personIds"), mergeId, keepId),
          claimEligiblePersonIds: replaced(entry.get("claimEligiblePersonIds"), mergeId, keepId),
        });
      }
      if (mergeContact?.exists === true) {
        const from = parseStoredDocument(personContactDocSchema, mergeContact.data());
        if (!from.success) throw from.error;
        const stored =
          keepContact?.exists === true ? parseStoredDocument(personContactDocSchema, keepContact.data()) : null;
        if (stored !== null && !stored.success) throw stored.error;
        const present = new Set((stored?.data.emails ?? []).map((email) => email.email));
        const keepsPrimary = (stored?.data.emails ?? []).some((email) => email.kind === "primary");
        const added = from.data.emails
          .filter((email) => !present.has(email.email))
          .map((email) =>
            email.kind === "primary" && keepsPrimary ? { ...email, kind: "secondary" as const } : email,
          );
        if (stored === null) {
          transaction.set(
            keepContactReference,
            personContactDocSchema.parse({ ...createdFields("personContact", stamp), emails: added }),
          );
          written += 1;
        } else if (added.length > 0) {
          update(keepContactReference, { emails: [...stored.data.emails, ...added] });
        }
      }
      movedEntries.forEach(({ entry, target }, index) => {
        if (targets[index]?.exists !== true) {
          const data = entry.data();
          // The standard fields of a new document, with the version of the entry that is copied.
          transaction.set(target, {
            ...data,
            ...createdFields("laboratoryMembers", stamp),
            schemaVersion: data.schemaVersion,
            personId: keepId,
            ...(linkedAccount === null ? {} : unconfirmed(data)),
          });
          written += 1;
        } else {
          update(target, {
            sourceRecordIds: union(targets[index]?.get("sourceRecordIds"), entry.get("sourceRecordIds")),
          });
        }
        update(entry.ref, { archivedAt: now });
      });
      affiliations.docs.forEach((entry, index) => {
        if (affiliationTargets[index]?.exists === true) return;
        const data = entry.data();
        transaction.set(db.doc(COLLECTIONS.personAffiliations.docPath(keepId, entry.id)), {
          ...data,
          ...createdFields("personAffiliations", stamp),
          schemaVersion: data.schemaVersion,
          personId: keepId,
        });
        written += 1;
      });
      for (const laboratory of laboratories.docs) update(laboratory.ref, { piPersonId: keepId });
      for (const participation of participations.docs) update(participation.ref, { localLeadPersonId: keepId });
      for (const replication of replications.docs) {
        const leads: unknown = replication.get("leadPersonIds");
        update(replication.ref, {
          leadPersonIds:
            linkedAccount === null
              ? replaced(leads, mergeId, keepId)
              : replaced(leads, mergeId, mergeId).filter((id) => id !== mergeId),
        });
      }
      for (const contributor of contributors.docs) update(contributor.ref, { personId: keepId });
      for (const contact of outreach.docs) update(contact.ref, { personId: keepId });
      update(keepReference, {
        sourceRecordIds: union(keep.data.sourceRecordIds, merged.data.sourceRecordIds),
        fieldSources: { ...(merged.data.fieldSources ?? {}), ...(keep.data.fieldSources ?? {}) },
        // The units of the merged record give scope, so a claimed record gains them only once the
        // copied entries are confirmed again, which puts them on it through the triggers.
        ...(linkedAccount === null
          ? {
              laboratoryIds: union(keep.data.laboratoryIds, merged.data.laboratoryIds),
              replicationIds: union(keep.data.replicationIds, merged.data.replicationIds),
            }
          : {}),
      });
      update(mergeReference, { archivedAt: now });
      const eventId = stamp.writeContext.auditEventId;
      if (linkedAccount !== null && linkedAccount !== stamp.actor && eventId !== null) {
        writeNotification(
          db,
          transaction,
          {
            uid: linkedAccount,
            type: "statusChange",
            entityType: "person",
            entityId: keepId,
            eventId,
            payload: { kind: "personMerged" },
          },
          stamp,
        );
        written += 1;
      }
      return written;
    },
  };
}
