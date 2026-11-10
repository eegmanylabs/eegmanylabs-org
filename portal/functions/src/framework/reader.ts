// Reads of the database for trusted code, in the terms of the shared package.
import type { DocumentReader, StoredDocument } from "@eegml/shared";
import type { DocumentSnapshot, Firestore, Query, Transaction } from "firebase-admin/firestore";

function stored(snapshot: DocumentSnapshot): StoredDocument | null {
  const data = snapshot.data();
  return data === undefined ? null : { id: snapshot.id, data };
}

/**
 * A reader over the Admin SDK. With a transaction every read goes through it, so the
 * transaction commits only while what was read still holds. Call it before the first write of
 * the transaction, as every read of a transaction must be.
 */
export function adminReader(db: Firestore, transaction?: Transaction): DocumentReader {
  const run = async (query: Query): Promise<StoredDocument[]> => {
    const result = transaction === undefined ? await query.get() : await transaction.get(query);
    return result.docs.map((document) => ({ id: document.id, data: document.data() }));
  };
  return {
    get: async (path) => {
      const reference = db.doc(path);
      return stored(transaction === undefined ? await reference.get() : await transaction.get(reference));
    },
    whereEquals: (collectionPath, field, value) => run(db.collection(collectionPath).where(field, "==", value)),
    whereArrayContains: (collectionPath, field, value) =>
      run(db.collection(collectionPath).where(field, "array-contains", value)),
    list: (collectionPath) => run(db.collection(collectionPath)),
  };
}
