// The erasure of one person's personal data (docs/DATA_MODEL.md, section 14). The scientific
// record and the audit trail stay: the directory entry keeps its identifier, is anonymised and
// archived, and every other document that names the person keeps its reference. What goes is
// what is personal: the restricted and special-category documents, the affiliations, the
// outreach correspondence and the contact documents of contributor rows. The identity keys
// become tombstones, so that a later import neither recreates the person nor restores what was
// erased, and the person's values in source records, batch changes and audit entries become a
// marker. Every step can run again: an interrupted erasure is completed by running it again.
import { COLLECTIONS, shortHash } from "@eegml/shared";
import {
  type DocumentData,
  type DocumentReference,
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import { touchedFields, type WriteStamp } from "../framework";

/** What stands in place of an erased value. */
export const ERASED_MARKER = "[erased]";
/** The name an erased person keeps in the directory. */
export const ERASED_DISPLAY_NAME = "Erased person";

const BATCH_WRITES = 400;
/** The most values Firestore accepts in one array-contains-any clause. */
const ANY_OF_MAX = 30;

type Write =
  | { readonly kind: "delete"; readonly reference: DocumentReference }
  | { readonly kind: "update"; readonly reference: DocumentReference; readonly data: DocumentData };

async function commit(db: Firestore, writes: readonly Write[]): Promise<void> {
  for (let start = 0; start < writes.length; start += BATCH_WRITES) {
    const batch = db.batch();
    for (const write of writes.slice(start, start + BATCH_WRITES)) {
      if (write.kind === "delete") batch.delete(write.reference);
      else batch.update(write.reference, write.data);
    }
    await batch.commit();
  }
}

const markValues = (state: unknown): Record<string, string> | null =>
  state === null || typeof state !== "object"
    ? null
    : Object.fromEntries(Object.keys(state as Record<string, unknown>).map((key) => [key, ERASED_MARKER]));

/** Erases one person and returns, for each kind of document, how many were removed or marked. */
export async function applyErasure(
  db: Firestore,
  personId: string,
  stamp: WriteStamp,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const count = (kind: string, number: number) => {
    counts[kind] = (counts[kind] ?? 0) + number;
  };
  const writes: Write[] = [];
  const personReference = db.doc(COLLECTIONS.persons.docPath(personId));
  const person = await personReference.get();
  const contact = await db.doc(COLLECTIONS.personContact.docPath(personId)).get();

  // The rows of the sources behind the person and behind each of the person's addresses.
  const sourceRecordIds = new Set<string>(
    Array.isArray(person.get("sourceRecordIds")) ? (person.get("sourceRecordIds") as string[]) : [],
  );
  const emails: unknown = contact.get("emails");
  if (Array.isArray(emails)) {
    for (const email of emails) {
      const id = (email as { sourceRecordId?: unknown }).sourceRecordId;
      if (typeof id === "string") sourceRecordIds.add(id);
    }
  }

  writes.push({
    kind: "update",
    reference: personReference,
    data: {
      ...touchedFields(stamp),
      displayName: ERASED_DISPLAY_NAME,
      slug: `erased-${shortHash(personId)}`,
      givenName: FieldValue.delete(),
      middleName: FieldValue.delete(),
      familyName: FieldValue.delete(),
      orcid: FieldValue.delete(),
      countryCode: FieldValue.delete(),
      countrySource: FieldValue.delete(),
      affiliationSummary: FieldValue.delete(),
      websitePersonId: FieldValue.delete(),
      headshotFilename: FieldValue.delete(),
      scholarUrl: FieldValue.delete(),
      universityUrl: FieldValue.delete(),
      labUrl: FieldValue.delete(),
      importedValues: FieldValue.delete(),
      sourceAuthor: FieldValue.delete(),
      custom: {},
      publicListing: "none",
      archivedAt: person.get("archivedAt") ?? Timestamp.fromDate(stamp.at),
    },
  });
  count("person", 1);

  for (const path of [
    COLLECTIONS.personContact.docPath(personId),
    COLLECTIONS.personAddress.docPath(personId),
    COLLECTIONS.personNotes.docPath(personId),
    COLLECTIONS.personDemographics.docPath(personId),
  ]) {
    const snapshot = await db.doc(path).get();
    if (snapshot.exists) {
      writes.push({ kind: "delete", reference: snapshot.ref });
      count("restrictedDocuments", 1);
    }
  }
  const affiliations = await db.collection(COLLECTIONS.personAffiliations.collectionPath(personId)).get();
  for (const affiliation of affiliations.docs) writes.push({ kind: "delete", reference: affiliation.ref });
  count("affiliations", affiliations.size);

  const outreach = await db
    .collection(COLLECTIONS.outreachContacts.collectionPath())
    .where("personId", "==", personId)
    .get();
  for (const entry of outreach.docs) writes.push({ kind: "delete", reference: entry.ref });
  count("outreachContacts", outreach.size);

  const contributors = await db
    .collection(COLLECTIONS.contributors.collectionPath())
    .where("personId", "==", personId)
    .get();
  for (const contributor of contributors.docs) {
    const contributorContact = await db.doc(COLLECTIONS.contributorContact.docPath(contributor.id)).get();
    if (contributorContact.exists) {
      writes.push({ kind: "delete", reference: contributorContact.ref });
      count("contributorContacts", 1);
    }
  }

  const keys = await db
    .collection(COLLECTIONS.identityKeys.collectionPath())
    .where("entityIds", "array-contains", personId)
    .get();
  for (const key of keys.docs) {
    writes.push({ kind: "update", reference: key.ref, data: { ...touchedFields(stamp), status: "erased" } });
  }
  count("identityKeysTombstoned", keys.size);

  const index = await db
    .collection(COLLECTIONS.personEmailIndex.collectionPath())
    .where("personIds", "array-contains", personId)
    .get();
  for (const entry of index.docs) {
    const remaining = (entry.get("personIds") as string[]).filter((id) => id !== personId);
    if (remaining.length === 0) writes.push({ kind: "delete", reference: entry.ref });
    else {
      writes.push({
        kind: "update",
        reference: entry.ref,
        data: {
          ...touchedFields(stamp),
          personIds: remaining,
          claimEligiblePersonIds: FieldValue.arrayRemove(personId),
        },
      });
    }
  }
  count("emailIndexEntries", index.size);

  for (const id of sourceRecordIds) {
    const record = await db.doc(COLLECTIONS.sourceRecords.docPath(id)).get();
    if (!record.exists) continue;
    writes.push({ kind: "update", reference: record.ref, data: { raw: markValues(record.get("raw")) ?? {} } });
    const special = await db.doc(COLLECTIONS.sourceRecordSpecial.docPath(id)).get();
    if (special.exists) writes.push({ kind: "delete", reference: special.ref });
    count("sourceRecordsMarked", 1);
  }
  const recordIds = [...sourceRecordIds];
  const changes: QueryDocumentSnapshot[] = [];
  for (let start = 0; start < recordIds.length; start += ANY_OF_MAX) {
    const page = await db
      .collectionGroup(COLLECTIONS.importBatchChanges.collectionId)
      .where("sourceRecordIds", "array-contains-any", recordIds.slice(start, start + ANY_OF_MAX))
      .get();
    changes.push(...page.docs);
  }
  for (const change of changes) {
    writes.push({
      kind: "update",
      reference: change.ref,
      data: { before: markValues(change.get("before")), after: markValues(change.get("after")) },
    });
  }
  count("batchChangesMarked", changes.length);

  // The audit trail keeps every entry: who did what and when stays readable, and the values
  // that an entry about the person carried become withheld.
  const audit = await db.collection(COLLECTIONS.auditEvents.collectionPath()).where("entityId", "==", personId).get();
  for (const entry of audit.docs) {
    const entryChanges: unknown = entry.get("changes");
    if (!Array.isArray(entryChanges) || entryChanges.length === 0) continue;
    writes.push({
      kind: "update",
      reference: entry.ref,
      data: {
        changes: entryChanges.map((change) => ({ field: (change as { field: string }).field, withheld: true })),
      },
    });
    count("auditEntriesWithheld", 1);
  }

  await commit(db, writes);
  return counts;
}
