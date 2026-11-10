// The options that every Firestore trigger of the portal shares.
import { FUNCTIONS_REGION } from "@eegml/shared";
import { firestore } from "./admin";

// firebase-functions builds the snapshots of an event with the default app before a handler
// runs, so the app has to exist as soon as the module of a trigger is loaded.
firestore();

/**
 * The options of a trigger on a document path. The region is stated here, because the global
 * options of index.ts are set after the modules of the triggers have been loaded. Delivery is
 * at least once, and a failed run is tried again, so every handler is idempotent: it either
 * writes a document named after the event or brings a derived value in line with its sources.
 */
export function documentTrigger<Path extends string>(document: Path) {
  return { document, region: FUNCTIONS_REGION, retry: true } as const;
}
