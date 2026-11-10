import { isDeepStrictEqual } from "node:util";
import { COLLECTIONS, lookupSeedDocuments, systemActor, systemWriteContext } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { connectToEmulators } from "../admin";
import type { Command } from "../command";
import { requireEmulatorTarget, requireRunningEmulators } from "../environment";

export interface LookupSeedSummary {
  readonly projectId: string;
  /** Documents that did not exist and were written. */
  readonly created: number;
  /** Documents that exist with the seeded values. */
  readonly unchanged: number;
  /** Paths of documents that exist with other values, which the command leaves as they are. */
  readonly different: readonly string[];
}

/** The actor recorded on everything this command writes. */
export const SEED_LOOKUPS_ACTOR = systemActor("seedLookups");

/**
 * Writes the lookup data the application depends on: the programme, the statuses, the count
 * categories, the onboarding checklist and the contributor roles.
 *
 * A document that already exists is never written again. Administrators may reconfigure lookup
 * data, so a document whose values differ from the seed is reported and left alone. A second
 * run therefore performs no write at all.
 */
export async function seedLookups(
  db: Firestore,
  projectId: string,
  now: Date = new Date(),
): Promise<LookupSeedSummary> {
  const timestamp = Timestamp.fromDate(now);
  const seeds = lookupSeedDocuments().map((seed) => ({
    seed,
    reference: db.doc(COLLECTIONS[seed.collection].docPath(seed.id)),
  }));
  const snapshots = await db.getAll(...seeds.map(({ reference }) => reference));

  const batch = db.batch();
  let created = 0;
  let unchanged = 0;
  const different: string[] = [];
  seeds.forEach(({ seed, reference }, index) => {
    const stored = snapshots[index]?.data();
    if (stored === undefined) {
      const entry = COLLECTIONS[seed.collection];
      // `create` fails if another run wrote the document in the meantime, so nothing is overwritten.
      batch.create(
        reference,
        entry.schema.parse({
          schemaVersion: entry.schemaVersion,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: SEED_LOOKUPS_ACTOR,
          updatedBy: SEED_LOOKUPS_ACTOR,
          archivedAt: null,
          writeContext: systemWriteContext(),
          ...seed.data,
        }),
      );
      created += 1;
    } else if (Object.entries(seed.data).every(([field, value]) => isDeepStrictEqual(stored[field], value))) {
      unchanged += 1;
    } else {
      different.push(reference.path);
    }
  });
  if (created > 0) await batch.commit();
  return { projectId, created, unchanged, different };
}

export const seedLookupsCommand: Command = {
  name: "seed:lookups",
  summary: "Write the lookup data (statuses, count categories, checklist, contributor roles) if it is missing.",
  async run() {
    // Refuses here, before the Admin SDK is touched, unless the emulators are the target.
    const target = requireEmulatorTarget();
    await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
    const summary = await seedLookups(connectToEmulators(target).db, target.projectId);
    console.log(
      `seed:lookups wrote to ${summary.projectId} (emulator): ${summary.created} created, ` +
        `${summary.unchanged} unchanged, ${summary.different.length} different.`,
    );
    for (const path of summary.different) {
      console.log(`Left as it is, because its values differ from the seed: ${path}`);
    }
    return undefined;
  },
};
