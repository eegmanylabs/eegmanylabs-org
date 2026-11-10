// access:rebuild [--production --project <identifier>]
//
// Resolves the access document of every account again from its sources and writes each one
// that differs. The functions keep `access/{uid}` in line by themselves. This command is for
// what they cannot know: a change to how access is resolved, which a deployment brings, and a
// database that was restored or written by hand.
import { COLLECTIONS, planAccessOf, readAccessSources, systemActor, systemWriteContext } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { adminReader, connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";

/** The actor recorded on an access document that this command writes. */
export const ACCESS_REBUILD_ACTOR = systemActor("accessRebuild");

export interface AccessRebuildSummary {
  created: number;
  updated: number;
  unchanged: number;
  /** Documents that do not fit their schema and therefore confer nothing, as paths. */
  readonly unreadable: string[];
}

/**
 * Brings the access document of every account that has a profile in line with its sources.
 * Each account is read and written in a transaction of its own, so an account that changes
 * while the command runs is resolved from what the transaction saw. A second run writes nothing.
 */
export async function rebuildAllAccess(db: Firestore, now: Date = new Date()): Promise<AccessRebuildSummary> {
  const summary: AccessRebuildSummary = { created: 0, updated: 0, unchanged: 0, unreadable: [] };
  const accounts = await db.collection(COLLECTIONS.users.collectionPath()).select().get();
  for (const account of accounts.docs) {
    const reference = db.doc(COLLECTIONS.access.docPath(account.id));
    await db.runTransaction(async (transaction) => {
      const sources = await readAccessSources(adminReader(db, transaction), account.id, now);
      if (sources === null) return;
      const { write } = planAccessOf(sources, {
        now: Timestamp.fromDate(now),
        actor: ACCESS_REBUILD_ACTOR,
        writeContext: systemWriteContext(),
      });
      for (const path of sources.unreadable) if (!summary.unreadable.includes(path)) summary.unreadable.push(path);
      if (write.kind === "create") transaction.create(reference, write.document);
      else if (write.kind === "update") transaction.update(reference, write.changes);
      summary[write.kind === "none" ? "unchanged" : write.kind === "create" ? "created" : "updated"] += 1;
    });
  }
  return summary;
}

const USAGE = "Usage: access:rebuild [--production --project <identifier>]";

export const accessRebuildCommand: Command = {
  name: "access:rebuild",
  summary: "Resolve the access document of every account again and write those that differ.",
  async run(args) {
    let production = false;
    let projectId: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--production") production = true;
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
    const summary = await rebuildAllAccess(db);
    console.log(
      `access:rebuild in ${target.projectId} (${target.kind === "production" ? "a real project" : "emulator"}): ` +
        `${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged.`,
    );
    for (const path of summary.unreadable) {
      console.warn(`A document does not fit its schema and confers nothing: ${path}`);
    }
    return undefined;
  },
};
