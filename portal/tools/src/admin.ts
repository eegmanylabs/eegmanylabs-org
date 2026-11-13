// Admin SDK set-up shared by the tools.
import type { DocumentReader, StoredDocument } from "@eegml/shared";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore, type Query, type Transaction } from "firebase-admin/firestore";
import type { EmulatorTarget } from "./environment";

export interface AdminHandles {
  readonly db: Firestore;
  readonly auth: Auth;
}

/** Connects to the emulators named by the target. No credential is involved. */
export function connectToEmulators(target: EmulatorTarget): AdminHandles {
  // The emulators need no credential, so the SDK must not go looking for one on the network.
  process.env.METADATA_SERVER_DETECTION ??= "none";
  if (getApps().length === 0) initializeApp({ projectId: target.projectId });
  return { db: getFirestore(), auth: getAuth() };
}

/**
 * Connects to Firestore and Authentication of a real project with the credentials of the
 * environment. Only the commands that accept `--production` call this, and only after
 * `requireImportTarget` has accepted the operator's request.
 */
export function connectToProject(projectId: string): AdminHandles {
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  return { db: getFirestore(), auth: getAuth() };
}

/**
 * Reads of the database in the terms of the shared package, for the code that resolves access
 * documents. With a transaction every read goes through it.
 */
export function adminReader(db: Firestore, transaction?: Transaction): DocumentReader {
  const run = async (query: Query): Promise<StoredDocument[]> => {
    const result = transaction === undefined ? await query.get() : await transaction.get(query);
    return result.docs.map((document) => ({ id: document.id, data: document.data() }));
  };
  return {
    get: async (path) => {
      const reference = db.doc(path);
      const snapshot = transaction === undefined ? await reference.get() : await transaction.get(reference);
      const data = snapshot.data();
      return data === undefined ? null : { id: snapshot.id, data };
    },
    whereEquals: (collectionPath, field, value) => run(db.collection(collectionPath).where(field, "==", value)),
    whereArrayContains: (collectionPath, field, value) =>
      run(db.collection(collectionPath).where(field, "array-contains", value)),
    list: (collectionPath) => run(db.collection(collectionPath)),
  };
}
