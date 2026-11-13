// The erasure of one person's personal data (docs/DATA_MODEL.md, section 14). The scientific
// record and the audit trail stay: the directory entry keeps its identifier, is anonymised and
// archived, and every other document that names the person keeps its reference. What goes is
// what is personal: the restricted and special-category documents, the affiliations, the
// outreach correspondence and the contact documents of contributor rows. The identity keys
// become tombstones, so that a later import neither recreates the person nor restores what was
// erased, and the person's values in source records, batch changes and audit entries become a
// marker. Every step can run again: an interrupted erasure is completed by running it again.
//
// | Record that names the person          | What erasure does |
// |---------------------------------------|-------------------|
// | Contributor rows                      | The link to the person goes (`personId` null). Names, ORCID iD and affiliations become the marker, unless the row belongs to a published manuscript, whose author list is the published record and stays without the link |
// | Authorship entries                    | The entry is keyed by the person and cannot lose the link, so its name becomes "Erased person" and its affiliations and ORCID iD go |
// | Audit entries about the person, a former account, a contributor row or an authorship entry | Values withheld, fields kept |
// | Accounts that were once linked to the person and are linked to nobody else | The Authentication account, the profile with its notifications and preferences, the access document and the claim with its review are deleted. An account that now belongs to another person, or that holds a programme role, is kept and counted |
// | The public website                    | Nothing is published from here. When the person was publicly listed, `publicListingRemoved` is counted, and the console asks for a publication and for the website's history to be rewritten by hand |
import { COLLECTIONS, isProgrammeRole, parseStoredDocument, roleAssignmentDocSchema, shortHash } from "@eegml/shared";
import type { Auth } from "firebase-admin/auth";
import {
  type DocumentData,
  type DocumentReference,
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import { touchedFields, type WriteStamp } from "../framework/documents";
import { inForce } from "../roles/assignments";

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
  auth: Auth,
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
      // Normally null already, since a linked person is refused. A replay after a restore can
      // meet a link that the restore brought back, and the account goes below.
      userId: null,
      claimedAt: null,
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
  // Paths of the rows that named the person, whose audit entries lose their values below.
  const linkedPaths: string[] = [];
  for (const contributor of contributors.docs) {
    const contributorContact = await db.doc(COLLECTIONS.contributorContact.docPath(contributor.id)).get();
    if (contributorContact.exists) {
      writes.push({ kind: "delete", reference: contributorContact.ref });
      count("contributorContacts", 1);
    }
    const manuscriptId: unknown = contributor.get("manuscriptId");
    const published =
      typeof manuscriptId === "string" &&
      (await db.doc(COLLECTIONS.manuscripts.docPath(manuscriptId)).get()).get("status") === "published";
    const named: DocumentData = {};
    if (!published) {
      for (const field of ["firstNameSource", "middleNameSource", "surnameSource", "affiliationSource", "orcid"]) {
        if (contributor.get(field) !== undefined) named[field] = ERASED_MARKER;
      }
      const slots: unknown = contributor.get("affiliationSlotsSource");
      if (slots !== undefined) named.affiliationSlotsSource = markValues(slots) ?? {};
    }
    writes.push({
      kind: "update",
      reference: contributor.ref,
      data: { ...touchedFields(stamp), personId: null, ...named },
    });
    linkedPaths.push(contributor.ref.path);
    count(published ? "contributorRowsUnlinked" : "contributorRowsMarked", 1);
  }

  const authorship = await db
    .collectionGroup(COLLECTIONS.authorshipEntries.collectionId)
    .where("personId", "==", personId)
    .get();
  for (const entry of authorship.docs) {
    writes.push({
      kind: "update",
      reference: entry.ref,
      data: {
        ...touchedFields(stamp),
        displayName: ERASED_DISPLAY_NAME,
        affiliations: [],
        orcid: FieldValue.delete(),
      },
    });
    linkedPaths.push(entry.ref.path);
  }
  count("authorshipEntriesAnonymised", authorship.size);

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

  // The accounts that were ever linked to the person, from the claims and from the entries of
  // linking and unlinking, which name the account in the field `userId`.
  const formerUids = new Set<string>();
  const claims = await db
    .collection(COLLECTIONS.accountClaims.collectionPath())
    .where("personId", "==", personId)
    .get();
  for (const claim of claims.docs) formerUids.add(claim.id);
  for (const entry of audit.docs) {
    const entryChanges: unknown = entry.get("changes");
    for (const change of Array.isArray(entryChanges) ? entryChanges : []) {
      const { field, before, after } = change as { field?: unknown; before?: unknown; after?: unknown };
      if (field !== "userId") continue;
      for (const value of [before, after]) if (typeof value === "string" && value !== "") formerUids.add(value);
    }
  }
  const accountEntries: QueryDocumentSnapshot[] = [];
  for (const uid of formerUids) {
    const user = await db.doc(COLLECTIONS.users.docPath(uid)).get();
    const linkedElsewhere =
      user.exists && typeof user.get("personId") === "string" && user.get("personId") !== personId;
    const roles = await db.collection(COLLECTIONS.roleAssignments.collectionPath()).where("uid", "==", uid).get();
    const staff = roles.docs.some((document) => {
      const role = parseStoredDocument(roleAssignmentDocSchema, document.data());
      return role.success && isProgrammeRole(role.data.role) && inForce(role.data, stamp.at);
    });
    if (linkedElsewhere || staff) {
      count("accountsKept", 1);
      continue;
    }
    // The profile and the claim go with their subcollections: notifications, preferences and
    // the review of the claim. They go before the audit values are withheld, so that an
    // interrupted erasure still finds the account when it runs again.
    for (const reference of [
      db.doc(COLLECTIONS.users.docPath(uid)),
      db.doc(COLLECTIONS.access.docPath(uid)),
      db.doc(COLLECTIONS.accountClaims.docPath(uid)),
    ]) {
      await db.recursiveDelete(reference);
    }
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if ((error as { code?: unknown }).code !== "auth/user-not-found") throw error;
    }
    accountEntries.push(
      ...(await db.collection(COLLECTIONS.auditEvents.collectionPath()).where("entityId", "==", uid).get()).docs,
    );
    count("accountsDeleted", 1);
  }
  for (let start = 0; start < linkedPaths.length; start += ANY_OF_MAX) {
    const page = await db
      .collection(COLLECTIONS.auditEvents.collectionPath())
      .where("documentPath", "in", linkedPaths.slice(start, start + ANY_OF_MAX))
      .get();
    accountEntries.push(...page.docs);
  }
  if (person.get("publicListing") !== undefined && person.get("publicListing") !== "none") {
    count("publicListingRemoved", 1);
  }

  const withheld = new Set<string>();
  for (const entry of [...audit.docs, ...accountEntries]) {
    if (withheld.has(entry.ref.path)) continue;
    withheld.add(entry.ref.path);
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
