// Test fixtures for the security-rules tests.
// Everything here is synthetic. The accounts are fictitious and use the example.org domain.
import { readFileSync } from "node:fs";
import path from "node:path";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { HOST, PORTAL_ROOT, PORTS } from "../support/emulators";

/** A project of its own, so these tests never see data written by the other suites. */
const RULES_PROJECT_ID = "demo-eegml-rules";

/** The instant from which the sessions of the `ended` account are valid, in seconds since the epoch. */
export const SESSIONS_VALID_AFTER_SECONDS = 1_800_000_000;

/**
 * The signed-in accounts the tests act as. `signedInAt` is the time of sign-in that the
 * account's token states, in seconds since the epoch.
 *
 * | Account     | Standing                                                             |
 * |-------------|----------------------------------------------------------------------|
 * | `owner`     | Active                                                               |
 * | `other`     | Active                                                               |
 * | `suspended` | Its access document says it is suspended                             |
 * | `ended`     | Signed in one second before the instant its sessions are valid from |
 * | `renewed`   | Same account as `ended`, signed in again at that instant            |
 */
export const ACCOUNTS = {
  owner: { uid: "uid-owner", email: "owner.account@example.org", signedInAt: 1_700_000_000 },
  other: { uid: "uid-other", email: "other.account@example.org", signedInAt: 1_700_000_000 },
  suspended: { uid: "uid-suspended", email: "suspended.account@example.org", signedInAt: 1_700_000_000 },
  ended: { uid: "uid-ended", email: "ended.account@example.org", signedInAt: SESSIONS_VALID_AFTER_SECONDS - 1 },
  renewed: { uid: "uid-ended", email: "ended.account@example.org", signedInAt: SESSIONS_VALID_AFTER_SECONDS },
} as const;
export type AccountName = keyof typeof ACCOUNTS;
export type Caller = AccountName | "signedOut";

/** The text of a rules file of the portal. */
export function readRulesFile(file: "firestore.rules" | "storage.rules"): string {
  return readFileSync(path.join(PORTAL_ROOT, file), "utf8");
}

/**
 * Loads the rules of the portal into the emulators. A suite that must not share documents, or
 * the record of which rules were evaluated, with the other suites names a project of its own.
 */
export function createRulesEnvironment(projectId: string = RULES_PROJECT_ID): Promise<RulesTestEnvironment> {
  const read = readRulesFile;
  return initializeTestEnvironment({
    projectId,
    firestore: { rules: read("firestore.rules"), host: HOST, port: PORTS.firestore },
    storage: { rules: read("storage.rules"), host: HOST, port: PORTS.storage },
  });
}

function contextFor(environment: RulesTestEnvironment, caller: Caller) {
  if (caller === "signedOut") return environment.unauthenticatedContext();
  const account = ACCOUNTS[caller];
  return environment.authenticatedContext(account.uid, {
    email: account.email,
    email_verified: true,
    auth_time: account.signedInAt,
  });
}

/** Firestore as seen by a caller, with the security rules applied. */
export function firestoreAs(environment: RulesTestEnvironment, caller: Caller): Firestore {
  // The context returns a compat instance, which the modular functions accept.
  return contextFor(environment, caller).firestore() as unknown as Firestore;
}

/** Cloud Storage as seen by a caller, with the security rules applied. */
export function storageAs(environment: RulesTestEnvironment, caller: Caller): FirebaseStorage {
  return contextFor(environment, caller).storage() as unknown as FirebaseStorage;
}

/** Writes documents with the rules switched off, as trusted code would. */
export async function seedDocuments(
  environment: RulesTestEnvironment,
  documents: Record<string, Record<string, unknown>>,
): Promise<void> {
  const { doc, setDoc } = await import("firebase/firestore");
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    await Promise.all(Object.entries(documents).map(([path, data]) => setDoc(doc(db, path), data)));
  });
}
