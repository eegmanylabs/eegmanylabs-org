// migrate:manuscript-ids [--apply] [--production --project <identifier>]
//
// Moves every manuscript that the importer of the public website wrote under its bare
// publication identifier to the namespaced identifier `web__<PublicationId>`
// (`websiteManuscriptId`), which no client can take (docs/SECURITY.md). Without `--apply` it
// reports what it would move and writes nothing. With it, each manuscript moves in one
// transaction together with what names it: its events and its restricted custom values, the
// document links of the manuscript (a link in a named slot takes the identifier of the slot under
// the new owner), the DOI lookups of the manuscript and the contributor rows that name it. The
// old documents are deleted in the same transaction, so a manuscript is never in two places.
//
// The command is idempotent: a second run finds nothing to move. It refuses to move a
// manuscript whose new identifier is taken, or that has entries in the status history, which is
// append-only, and reports both for a person to decide. The way back is to restore the export
// taken before `--apply` (README, "Migrations").
import {
  COLLECTIONS,
  documentLinkSlotId,
  entityRefId,
  systemActor,
  systemWriteContext,
  websiteManuscriptId,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp } from "firebase-admin/firestore";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";

/** The actor recorded on what the migration writes. */
export const MANUSCRIPT_MIGRATION_ACTOR = systemActor("manuscriptIdMigration");

export interface ManuscriptMigrationSummary {
  /** The manuscripts moved, or that would be moved in a dry run, as `old -> new`. */
  readonly moved: string[];
  /** The manuscripts left where they are, each with the reason. */
  readonly refused: string[];
  /** The documents rewritten beside the manuscripts. */
  rewritten: number;
}

/** The manuscripts that still sit under the bare identifier of the website. */
async function unmigrated(db: Firestore) {
  const found = await db.collection(COLLECTIONS.manuscripts.collectionPath()).get();
  return found.docs.filter((document) => {
    const publicationId = document.get("websitePublicationId");
    return typeof publicationId === "string" && document.id === publicationId;
  });
}

const touched = (at: Date) => ({
  updatedAt: Timestamp.fromDate(at),
  updatedBy: MANUSCRIPT_MIGRATION_ACTOR,
  writeContext: systemWriteContext(),
});

/** Moves the manuscripts of the website to their namespaced identifiers. */
export async function migrateManuscriptIds(
  db: Firestore,
  options: { readonly apply: boolean; readonly now?: Date },
): Promise<ManuscriptMigrationSummary> {
  const summary: ManuscriptMigrationSummary = { moved: [], refused: [], rewritten: 0 };
  const at = options.now ?? new Date();
  for (const candidate of await unmigrated(db)) {
    const oldId = candidate.id;
    const newId = websiteManuscriptId(oldId);
    const outcome = await db.runTransaction(async (transaction) => {
      const oldReference = db.doc(COLLECTIONS.manuscripts.docPath(oldId));
      const newReference = db.doc(COLLECTIONS.manuscripts.docPath(newId));
      const [current, taken] = await Promise.all([transaction.get(oldReference), transaction.get(newReference)]);
      if (!current.exists) return { kind: "gone" as const };
      if (taken.exists) return { kind: "refused" as const, reason: `${newId} exists already` };
      const history = await transaction.get(
        db
          .collection(COLLECTIONS.statusHistory.collectionPath())
          .where("entityType", "==", "manuscript")
          .where("entityId", "==", oldId)
          .limit(1),
      );
      if (!history.empty) return { kind: "refused" as const, reason: "it has entries in the status history" };
      const events = await transaction.get(db.collection(COLLECTIONS.manuscriptEvents.collectionPath(oldId)));
      const custom = await transaction.get(db.doc(COLLECTIONS.manuscriptCustom.docPath(oldId)));
      const links = await transaction.get(
        db
          .collection(COLLECTIONS.documentLinks.collectionPath())
          .where("entityType", "==", "manuscript")
          .where("entityId", "==", oldId),
      );
      const mappings = await transaction.get(
        db
          .collection(COLLECTIONS.integrationMappings.collectionPath())
          .where("entityType", "==", "manuscript")
          .where("entityId", "==", oldId),
      );
      const contributors = await transaction.get(
        db.collection(COLLECTIONS.contributors.collectionPath()).where("manuscriptId", "==", oldId),
      );
      const rewritten = events.size + (custom.exists ? 1 : 0) + links.size + mappings.size + contributors.size;
      if (!options.apply) return { kind: "moved" as const, rewritten };

      const move = (from: DocumentReference, to: DocumentReference, data: Record<string, unknown>) => {
        transaction.set(to, { ...data, ...touched(at) });
        transaction.delete(from);
      };
      move(oldReference, newReference, current.data() ?? {});
      for (const event of events.docs) {
        move(event.ref, db.doc(COLLECTIONS.manuscriptEvents.docPath(newId, event.id)), {
          ...event.data(),
          manuscriptId: newId,
        });
      }
      if (custom.exists) move(custom.ref, db.doc(COLLECTIONS.manuscriptCustom.docPath(newId)), custom.data() ?? {});
      const oldOwner = entityRefId("manuscript", oldId);
      for (const link of links.docs) {
        const slotPrefix = `${oldOwner}__`;
        const slot = link.id.startsWith(slotPrefix) ? link.id.slice(slotPrefix.length) : null;
        const data = { ...link.data(), entityId: newId };
        if (slot === null) transaction.update(link.ref, { entityId: newId, ...touched(at) });
        else
          move(
            link.ref,
            db.doc(COLLECTIONS.documentLinks.docPath(documentLinkSlotId(entityRefId("manuscript", newId), slot))),
            data,
          );
      }
      for (const mapping of mappings.docs) transaction.update(mapping.ref, { entityId: newId, ...touched(at) });
      for (const contributor of contributors.docs) {
        transaction.update(contributor.ref, { manuscriptId: newId, ...touched(at) });
      }
      return { kind: "moved" as const, rewritten };
    });
    if (outcome.kind === "refused") summary.refused.push(`${oldId}: ${outcome.reason}`);
    if (outcome.kind === "moved") {
      summary.moved.push(`${oldId} -> ${newId}`);
      summary.rewritten += outcome.rewritten;
    }
  }
  return summary;
}

const USAGE = "Usage: migrate:manuscript-ids [--apply] [--production --project <identifier>]";

export const migrateManuscriptIdsCommand: Command = {
  name: "migrate:manuscript-ids",
  summary: "Move the manuscripts of the website to the identifier web__<PublicationId>. Dry run without --apply.",
  async run(args) {
    let apply = false;
    let production = false;
    let projectId: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--apply") apply = true;
      else if (argument === "--production") production = true;
      else if (argument === "--project") {
        projectId = args[index + 1];
        if (projectId === undefined || projectId.startsWith("--"))
          throw new ToolRefusal(`--project needs a value.\n\n${USAGE}`);
        index += 1;
      } else throw new ToolRefusal(USAGE);
    }
    const target = requireImportTarget({ production, ...(projectId === undefined ? {} : { projectId }) });
    let db: Firestore;
    if (target.kind === "production") db = connectToProject(target.projectId).db;
    else {
      await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
      db = connectToEmulators(target).db;
    }
    const summary = await migrateManuscriptIds(db, { apply });
    console.log(
      `migrate:manuscript-ids in ${target.projectId} (${apply ? "applied" : "dry run, nothing written"}): ` +
        `${summary.moved.length} manuscript(s) ${apply ? "moved" : "to move"}, ${summary.rewritten} document(s) beside them, ` +
        `${summary.refused.length} refused.`,
    );
    for (const line of summary.moved) console.log(`  ${line}`);
    for (const line of summary.refused) console.warn(`  Left in place: ${line}`);
    return summary.refused.length > 0 ? 3 : undefined;
  },
};
