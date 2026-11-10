// The one place where the Admin SDK is initialised.
import { getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

/** The Firestore Admin handle. It bypasses security rules, so only trusted code may hold it. */
export function firestore(): Firestore {
  // In Cloud Functions and in the emulator the default credentials and project come from the
  // environment, so initialisation takes no arguments.
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

/** The Authentication Admin handle, for the few functions that change an account itself. */
export function authentication(): Auth {
  if (getApps().length === 0) initializeApp();
  return getAuth();
}
