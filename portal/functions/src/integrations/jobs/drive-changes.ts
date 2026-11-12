// The Drive change feed (docs/INTEGRATIONS.md, section 3.2). Drive says that a file changed and
// never what changed, so this job only finds out which linked files moved on and starts the
// work they call for: a run of each mapping of a changed spreadsheet, and a fresh check of each
// link to a changed file. A removal does not say whether the file was deleted or access was
// lost, so a removed file's mappings are paused for a person and its links marked unreachable.
import { COLLECTIONS, systemActor, systemWriteContext } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { retrying } from "../google/retry";
import type { DriveChange } from "../google/types";
import { type JobDependencies, JobFailure, type JobOutcome, SYNC_ACTOR } from "./context";
import { enqueueRun } from "./queue";
import { upsertReviewItems } from "./records";
import { mappingNeedsAttention } from "./sheet-sync";

/** The most pages of the feed one run reads. The next run goes on from the saved token. */
const MAX_PAGES = 20;

export const DRIVE_CHANGES_ACTOR = systemActor("driveChanges");

interface Watched {
  /** The mappings of each spreadsheet, by file identifier. */
  readonly mappings: Map<string, { readonly id: string; readonly mode: "dryRun" | "live" }[]>;
}

async function watchedFiles(db: Firestore): Promise<Watched> {
  const mappings = await db.collection(COLLECTIONS.syncMappings.collectionPath()).get();
  const byFile = new Map<string, { id: string; mode: "dryRun" | "live" }[]>();
  for (const mapping of mappings.docs) {
    if (mapping.get("status") === "paused") continue;
    const location = await db.doc(COLLECTIONS.sourceLocation.docPath(String(mapping.get("sourceKey")))).get();
    const fileId: unknown = location.get("externalId");
    if (typeof fileId !== "string") continue;
    byFile.set(fileId, [
      ...(byFile.get(fileId) ?? []),
      { id: mapping.id, mode: mapping.get("mode") === "live" ? "live" : "dryRun" },
    ]);
  }
  return { mappings: byFile };
}

async function updateLinks(db: Firestore, change: DriveChange, at: Date): Promise<number> {
  const links = await db
    .collection(COLLECTIONS.documentLinks.collectionPath())
    .where("externalId", "==", change.fileId)
    .get();
  const now = Timestamp.fromDate(at);
  for (const link of links.docs) {
    await link.ref.update({
      accessStatus: change.removed ? "unreachable" : "shared",
      lastCheckedAt: now,
      ...(change.file === undefined
        ? {}
        : {
            title: change.file.name.slice(0, 300),
            modifiedAt: Timestamp.fromDate(new Date(change.file.modifiedTime)),
            ...(change.file.owners[0] === undefined
              ? {}
              : { ownerName: change.file.owners[0].displayName.slice(0, 300) }),
          }),
      updatedAt: now,
      updatedBy: SYNC_ACTOR,
      writeContext: { ...systemWriteContext(), origin: "sync" },
    });
  }
  return links.size;
}

/** Reads the change feed from the saved page token and starts the work each change calls for. */
export async function runDriveChanges(dependencies: JobDependencies): Promise<JobOutcome> {
  const { db, clock } = dependencies;
  if (dependencies.adapters === null) throw new JobFailure("guard", false, "Not connected: credentials not supplied.");
  const drive = retrying(dependencies.adapters.drive, { sleep: dependencies.sleep, random: dependencies.random });
  const connection = db.doc(COLLECTIONS.integrationConnections.docPath("googleDrive"));
  const stored: unknown = (await connection.get()).get("changesPageToken");
  const at = clock.now();
  if (typeof stored !== "string") {
    // The first poll only marks where the feed starts: what happened before is covered by the nightly comparison.
    await connection.update({
      changesPageToken: await drive.getStartPageToken(),
      lastPolledAt: Timestamp.fromDate(at),
    });
    return { status: "succeeded", stats: { changes: 0 }, note: "The change feed now starts here." };
  }
  const watched = await watchedFiles(db);
  let token = stored;
  let changes = 0;
  let runs = 0;
  let links = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await drive.listChanges(token);
    for (const change of result.changes) {
      changes += 1;
      links += await updateLinks(db, change, at);
      for (const mapping of watched.mappings.get(change.fileId) ?? []) {
        if (change.removed) {
          const detail =
            "Drive reports the spreadsheet as removed: it was deleted, or it is no longer shared with the portal's account.";
          await mappingNeedsAttention(db, mapping.id, detail, at);
          await upsertReviewItems(db, [{ mappingId: mapping.id, kind: "accessLost", detail }], at);
          continue;
        }
        const queued = await enqueueRun(db, {
          kind: "sheetSync",
          mappingId: mapping.id,
          mode: mapping.mode,
          trigger: "event",
          eventKey: `change:${change.fileId}:${change.file?.version ?? change.time}`,
          requestedBy: DRIVE_CHANGES_ACTOR,
          at,
        });
        if (queued.created) runs += 1;
      }
    }
    if (result.newStartPageToken !== undefined) {
      token = result.newStartPageToken;
      break;
    }
    if (result.nextPageToken === undefined) break;
    token = result.nextPageToken;
  }
  await connection.update({ changesPageToken: token, lastPolledAt: Timestamp.fromDate(at) });
  return { status: "succeeded", stats: { changes, runsQueued: runs, linksChecked: links } };
}
