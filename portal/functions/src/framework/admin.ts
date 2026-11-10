// The one place where the Admin SDK is initialised.
import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

/** The Firestore Admin handle. It bypasses security rules, so only trusted code may hold it. */
export function firestore(): Firestore {
  // In Cloud Functions and in the emulator the default credentials and project come from the
  // environment, so initialisation takes no arguments.
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}
