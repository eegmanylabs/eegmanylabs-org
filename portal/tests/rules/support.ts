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

/** The signed-in accounts the tests act as. */
export const ACCOUNTS = {
  owner: { uid: "uid-owner", email: "owner.account@example.org" },
  other: { uid: "uid-other", email: "other.account@example.org" },
} as const;
export type AccountName = keyof typeof ACCOUNTS;
export type Caller = AccountName | "signedOut";

export function createRulesEnvironment(): Promise<RulesTestEnvironment> {
  const read = (file: string) => readFileSync(path.join(PORTAL_ROOT, file), "utf8");
  return initializeTestEnvironment({
    projectId: RULES_PROJECT_ID,
    firestore: { rules: read("firestore.rules"), host: HOST, port: PORTS.firestore },
    storage: { rules: read("storage.rules"), host: HOST, port: PORTS.storage },
  });
}

function contextFor(environment: RulesTestEnvironment, caller: Caller) {
  if (caller === "signedOut") return environment.unauthenticatedContext();
  const account = ACCOUNTS[caller];
  return environment.authenticatedContext(account.uid, { email: account.email, email_verified: true });
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
