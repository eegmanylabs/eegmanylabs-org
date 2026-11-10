import {
  ACCESS_SCHEMA_VERSION,
  type AccessDoc,
  accessDocSchema,
  normaliseEmail,
  paths,
  USER_SCHEMA_VERSION,
  type UserDoc,
  userDocSchema,
} from "@eegml/shared";
import type { DocumentReference } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { type AdminHandles, connectToEmulators } from "../admin";
import type { Command } from "../command";
import { requireEmulatorTarget } from "../environment";
import { DEMO_ACCOUNTS } from "../fixtures/demo-accounts";

export interface SeedSummary {
  readonly projectId: string;
  created: number;
  unchanged: number;
}

/**
 * Writes the demonstration accounts: an Authentication account, a `users` document and an
 * `access` document for each. Everything is labelled `dataOrigin: "demo"`. Running it again
 * changes nothing.
 */
export async function seedDemo(handles: AdminHandles, projectId: string, now: Date = new Date()): Promise<SeedSummary> {
  const summary: SeedSummary = { projectId, created: 0, unchanged: 0 };
  const timestamp = Timestamp.fromDate(now);

  const createIfMissing = async (reference: DocumentReference, data: UserDoc | AccessDoc) => {
    const written = await handles.db.runTransaction(async (transaction) => {
      if ((await transaction.get(reference)).exists) return false;
      transaction.create(reference, data);
      return true;
    });
    if (written) summary.created += 1;
    else summary.unchanged += 1;
  };

  for (const account of DEMO_ACCOUNTS) {
    const existing = await handles.auth.getUser(account.uid).catch((error: { code?: string }) => {
      if (error.code === "auth/user-not-found") return null;
      throw error;
    });
    if (existing === null) {
      await handles.auth.createUser({
        uid: account.uid,
        email: account.email,
        emailVerified: true,
        displayName: account.displayName,
      });
      summary.created += 1;
    } else {
      summary.unchanged += 1;
    }

    await createIfMissing(
      handles.db.doc(paths.user(account.uid)),
      userDocSchema.parse({
        schemaVersion: USER_SCHEMA_VERSION,
        emailLower: normaliseEmail(account.email),
        displayName: account.displayName,
        status: "active",
        createdAt: timestamp,
        lastSeenAt: timestamp,
        dataOrigin: "demo",
      }),
    );
    await createIfMissing(
      handles.db.doc(paths.access(account.uid)),
      accessDocSchema.parse({
        schemaVersion: ACCESS_SCHEMA_VERSION,
        member: false,
        personId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        dataOrigin: "demo",
      }),
    );
  }
  return summary;
}

export const seedDemoCommand: Command = {
  name: "seed:demo",
  summary: "Write a small synthetic data set to the Local Emulator Suite.",
  async run() {
    // Refuses here, before the Admin SDK is touched, unless the emulators are the target.
    const target = requireEmulatorTarget();
    const summary = await seedDemo(connectToEmulators(target), target.projectId);
    console.log(
      `seed:demo wrote to ${summary.projectId} (emulator): ${summary.created} created, ${summary.unchanged} unchanged.`,
    );
    console.log(`Demonstration accounts: ${DEMO_ACCOUNTS.map((account) => account.email).join(", ")}`);
  },
};
