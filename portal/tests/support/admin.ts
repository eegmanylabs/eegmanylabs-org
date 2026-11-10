// Admin SDK handles for tests, pointed at the emulators of the current run.
import { getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { PORTS, PROJECT_ID } from "./emulators";

// `firebase emulators:exec` sets these already. Setting them here as well lets a test file run
// against emulators that were started separately with `npm run emulators`.
for (const [name, value] of Object.entries(emulatorEnvironment(PORTS, PROJECT_ID))) {
  process.env[name] ??= value;
}

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });

export const adminDb: Firestore = getFirestore();
export const adminAuth: Auth = getAuth();
