// Admin SDK set-up shared by the tools.
import { getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import type { EmulatorTarget } from "./environment";

export interface AdminHandles {
  readonly db: Firestore;
  readonly auth: Auth;
}

/** Connects to the emulators named by the target. No credential is involved. */
export function connectToEmulators(target: EmulatorTarget): AdminHandles {
  if (getApps().length === 0) initializeApp({ projectId: target.projectId });
  return { db: getFirestore(), auth: getAuth() };
}
