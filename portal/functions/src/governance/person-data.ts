// What the portal holds about one person, gathered for a subject access export
// (docs/SECURITY.md, section 6). The queries are those the merge of persons and the claim
// functions already make, so the index file serves them as it stands.
import { COLLECTIONS, consentInForce, PERSON_EXPORT_MAX_DOCUMENTS } from "@eegml/shared";
import type { Auth } from "firebase-admin/auth";
import type { DocumentData, DocumentSnapshot, Firestore, Query } from "firebase-admin/firestore";
import { jsonOf } from "../callables/listAuditEvents";

type Json = ReturnType<typeof jsonOf>;

export interface PersonData {
  readonly documents: { path: string; data: Json }[];
  readonly accounts: {
    uid: string;
    email: string | null;
    emailVerified: boolean;
    disabled: boolean;
    createdAt: string | null;
    lastSignInAt: string | null;
  }[];
  readonly truncated: boolean;
}

/** The most entries of the audit trail one query of an export reads. */
const AUDIT_ENTRIES_MAX = 1_000;
const LIST_MAX = 1_000;

const instantOf = (text: string | undefined) =>
  text === undefined || text === "" ? null : new Date(text).toISOString();

/** An audit entry with the values of its changes withheld, keeping which fields changed. */
export function withholdValues(data: DocumentData): DocumentData {
  const changes: unknown = data.changes;
  if (!Array.isArray(changes)) return data;
  return {
    ...data,
    changes: changes.map((change) => ({ field: (change as { field?: unknown }).field, withheld: true })),
  };
}

/**
 * Every document about one person and the accounts linked to the person. The special-category
 * document is read only when `includeSpecial` is true, which the caller decides from a grant.
 * The audit entries of the person's own actions are included with the values withheld wherever
 * the entry is about someone or something else: those values are third-party data.
 */
export async function gatherPersonData(
  db: Firestore,
  auth: Auth,
  personId: string,
  includeSpecial: boolean,
): Promise<PersonData> {
  const seen = new Set<string>();
  const documents: { path: string; data: Json }[] = [];
  let truncated = false;
  const add = (snapshot: DocumentSnapshot, shape: (data: DocumentData) => DocumentData = (data) => data) => {
    const data = snapshot.data();
    if (data === undefined || seen.has(snapshot.ref.path)) return;
    if (documents.length >= PERSON_EXPORT_MAX_DOCUMENTS) {
      truncated = true;
      return;
    }
    seen.add(snapshot.ref.path);
    documents.push({ path: snapshot.ref.path, data: jsonOf(shape(data)) });
  };
  const addAll = async (query: Query, shape?: (data: DocumentData) => DocumentData) => {
    for (const snapshot of (await query.limit(LIST_MAX).get()).docs) add(snapshot, shape);
  };
  const addPaths = async (paths: readonly string[]) => {
    if (paths.length > 0) for (const snapshot of await db.getAll(...paths.map((path) => db.doc(path)))) add(snapshot);
  };

  // Gender and ethnicity are held only while the person's consent is in force (question 20), and are served then
  // alone, as getPersonDemographics serves them. A value that a race left without consent is never handed out.
  const consent = await db.doc(COLLECTIONS.personDemographicsConsent.docPath(personId)).get();
  const servesValues = includeSpecial && consentInForce(consent.data());
  await addPaths([
    COLLECTIONS.persons.docPath(personId),
    COLLECTIONS.personContact.docPath(personId),
    COLLECTIONS.personAddress.docPath(personId),
    COLLECTIONS.personNotes.docPath(personId),
    // The record of consent to holding gender and ethnicity holds no value, so it is always included.
    COLLECTIONS.personDemographicsConsent.docPath(personId),
    ...(servesValues ? [COLLECTIONS.personDemographics.docPath(personId)] : []),
  ]);
  await addAll(db.collection(COLLECTIONS.personAffiliations.collectionPath(personId)));
  for (const entry of [
    COLLECTIONS.laboratoryMembers,
    COLLECTIONS.replicationMemberships,
    COLLECTIONS.participationTeamMembers,
    COLLECTIONS.authorshipEntries,
  ]) {
    await addAll(db.collectionGroup(entry.collectionId).where("personId", "==", personId));
  }
  const contributors = await db
    .collection(COLLECTIONS.contributors.collectionPath())
    .where("personId", "==", personId)
    .limit(LIST_MAX)
    .get();
  for (const contributor of contributors.docs) add(contributor);
  await addPaths(contributors.docs.map((contributor) => COLLECTIONS.contributorContact.docPath(contributor.id)));
  await addAll(db.collection(COLLECTIONS.outreachContacts.collectionPath()).where("personId", "==", personId));
  await addAll(db.collection(COLLECTIONS.auditEvents.collectionPath()).where("entityId", "==", personId));

  const users = await db
    .collection(COLLECTIONS.users.collectionPath())
    .where("personId", "==", personId)
    .limit(20)
    .get();
  const accounts: PersonData["accounts"] = [];
  for (const user of users.docs) {
    const uid = user.id;
    add(user);
    for (const collection of await user.ref.listCollections()) {
      for (const snapshot of (await collection.limit(LIST_MAX).get()).docs) add(snapshot);
    }
    await addPaths([
      COLLECTIONS.access.docPath(uid),
      COLLECTIONS.accountClaims.docPath(uid),
      COLLECTIONS.accountClaimReview.docPath(uid),
    ]);
    for (const entry of [
      COLLECTIONS.roleAssignments,
      COLLECTIONS.capabilityGrants,
      COLLECTIONS.recordGrants,
      COLLECTIONS.labClaims,
      COLLECTIONS.correctionRequests,
    ]) {
      await addAll(db.collection(entry.collectionPath()).where("uid", "==", uid));
    }
    // What the person did is their data; the values of what they did to others are not.
    await addAll(
      db
        .collection(COLLECTIONS.auditEvents.collectionPath())
        .where("actorUid", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(AUDIT_ENTRIES_MAX),
      (data) => (data.entityId === personId || data.entityId === uid ? data : withholdValues(data)),
    );
    try {
      const record = await auth.getUser(uid);
      accounts.push({
        uid,
        email: record.email ?? null,
        emailVerified: record.emailVerified,
        disabled: record.disabled,
        createdAt: instantOf(record.metadata.creationTime),
        lastSignInAt: instantOf(record.metadata.lastSignInTime),
      });
    } catch {
      // An account that Authentication no longer knows has its documents and nothing more.
    }
  }
  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { documents, accounts, truncated };
}
