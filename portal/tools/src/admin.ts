// Admin SDK set-up shared by the tools.
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
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
 * Connects to the Firestore of a real project with the credentials of the environment. Only the
 * importers call this, and only after `requireImportTarget` has accepted the operator's request.
 */
export function connectToProject(projectId: string): Pick<AdminHandles, "db"> {
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  return { db: getFirestore() };
}
