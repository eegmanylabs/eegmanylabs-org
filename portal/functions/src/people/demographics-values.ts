// Where the gender and ethnicity of one person are held, and what removes every copy of them
// (docs/DATA_MODEL.md, section 3). The values live in `persons/{personId}/special/demographics`.
// An import keeps two kinds of copy where no client reads them: the states of that document
// beside each entry of the change log that wrote it, for a rollback, and, for rows imported before
// consent was required, the special-category cells beneath a source record. A withdrawal of
// consent and an erasure remove all of them, so that the values are deleted and not hidden.
import { COLLECTIONS, consentInForce } from "@eegml/shared";
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction,
} from "firebase-admin/firestore";

/** The most values Firestore accepts in one array-contains-any clause. */
const ANY_OF_MAX = 30;

/** Reads through a transaction or directly, so that the same search serves both. */
export interface CopyReader {
  getAll(references: readonly DocumentReference[]): Promise<DocumentSnapshot[]>;
  query(query: Query): Promise<QuerySnapshot>;
}

export function transactionReader(transaction: Transaction): CopyReader {
  return {
    getAll: async (references) => (references.length === 0 ? [] : transaction.getAll(...references)),
    query: (query) => transaction.get(query),
  };
}

export function directReader(db: Firestore): CopyReader {
  return {
    getAll: async (references) => (references.length === 0 ? [] : db.getAll(...references)),
    query: (query) => query.get(),
  };
}

export interface DemographicCopies {
  /** The document of values, where it exists. */
  readonly values: DocumentReference | null;
  /** The kept states of the change log and the kept cells of source records that hold the values. */
  readonly copies: readonly DocumentReference[];
}

const sourceRecordIdsOf = (snapshot: DocumentSnapshot | undefined): string[] => {
  const listed: unknown = snapshot?.get("sourceRecordIds");
  const single: unknown = snapshot?.get("sourceRecordId");
  return [
    ...(Array.isArray(listed) ? listed.filter((id): id is string => typeof id === "string") : []),
    ...(typeof single === "string" ? [single] : []),
  ];
};

/**
 * Every document that holds the gender or ethnicity of a person: the document of values, and
 * the copies that imports kept of it. The rows behind the person and behind the values name the
 * entries of the change log through `sourceRecordIds`, which is the query that erasure makes.
 */
export async function demographicCopies(
  db: Firestore,
  reader: CopyReader,
  personId: string,
): Promise<DemographicCopies> {
  const valuesReference = db.doc(COLLECTIONS.personDemographics.docPath(personId));
  const [values, person] = await reader.getAll([valuesReference, db.doc(COLLECTIONS.persons.docPath(personId))]);
  const recordIds = [...new Set([...sourceRecordIdsOf(values), ...sourceRecordIdsOf(person)])].sort();
  const cellPaths = new Set(recordIds.map((id) => COLLECTIONS.sourceRecordSpecial.docPath(id)));
  const keptPaths = new Set([valuesReference.path, ...cellPaths]);
  const loggedCollections = new Set([COLLECTIONS.personDemographics.path, COLLECTIONS.sourceRecordSpecial.path]);

  const states: DocumentReference[] = [];
  for (let start = 0; start < recordIds.length; start += ANY_OF_MAX) {
    const changes = await reader.query(
      db
        .collectionGroup(COLLECTIONS.importBatchChanges.collectionId)
        .where("sourceRecordIds", "array-contains-any", recordIds.slice(start, start + ANY_OF_MAX)),
    );
    for (const change of changes.docs) {
      const batchId = change.ref.parent.parent?.id;
      if (batchId === undefined || !loggedCollections.has(change.get("documentPath"))) continue;
      states.push(db.doc(COLLECTIONS.importBatchChangeState.docPath(batchId, change.id)));
    }
  }
  const candidates = [...states, ...[...cellPaths].map((path) => db.doc(path))];
  const found = await reader.getAll(candidates);
  const copies = found
    .filter((snapshot) => {
      if (!snapshot.exists) return false;
      // A cell copy holds the values itself. A state holds them only where it is the state of one of the documents above.
      if (cellPaths.has(snapshot.ref.path)) return true;
      return keptPaths.has(snapshot.get("documentPath"));
    })
    .map((snapshot) => snapshot.ref);
  return { values: values?.exists === true ? valuesReference : null, copies };
}

/** Removes every copy outside a transaction: for an erasure and for a replay of the governance ledger. */
export async function removeDemographicCopies(db: Firestore, personId: string): Promise<number> {
  const found = await demographicCopies(db, directReader(db), personId);
  const references = [...(found.values === null ? [] : [found.values]), ...found.copies];
  for (let start = 0; start < references.length; start += 400) {
    const batch = db.batch();
    for (const reference of references.slice(start, start + 400)) batch.delete(reference);
    await batch.commit();
  }
  return references.length;
}

/** The record of consent of each person, keyed by person: whether it is in force. */
export async function consentsInForce(db: Firestore, personIds: readonly string[]): Promise<Set<string>> {
  const consenting = new Set<string>();
  for (let start = 0; start < personIds.length; start += 300) {
    const chunk = personIds.slice(start, start + 300);
    if (chunk.length === 0) continue;
    const records = await db.getAll(...chunk.map((id) => db.doc(COLLECTIONS.personDemographicsConsent.docPath(id))));
    records.forEach((record, index) => {
      if (consentInForce(record.data())) consenting.add(chunk[index] ?? "");
    });
  }
  return consenting;
}
