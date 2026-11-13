// backup:manifest --out <file> [--database <id>] [--bucket <name>] [--accounts]
//                 [--production --project <identifier>]
// backup:compare <backup manifest> <restore manifest>
//
// The comparison of the restore rehearsal for a real project (ops/restore-scratch.mjs): a
// manifest of the point-in-time clone that a restore came from, a manifest of the scratch project
// it was restored into, and a comparison of the two. A manifest holds paths and hashes and never a
// value. Against a real project the command only reads, and it is reached only with the
// production flag, the identifier and credentials together, as for the importers.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
  type BackupManifest,
  compareManifests,
  differenceCount,
  MANIFEST_FORMAT,
  MANIFEST_KINDS,
  parseManifest,
} from "../backup/manifest";
import { accountEntries, defaultBucketName, documentEntries, objectEntries } from "../backup/snapshot";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";

const MANIFEST_USAGE =
  "Usage: backup:manifest --out <file> [--database <id>] [--bucket <name>] [--accounts] [--production --project <identifier>]";
const EXIT_DIFFERENT = 3;

interface ManifestRequest {
  readonly out: string;
  readonly database: string;
  readonly bucket: string | null;
  readonly accounts: boolean;
  readonly production: boolean;
  readonly projectId: string | undefined;
}

export function parseManifestArguments(args: readonly string[]): ManifestRequest {
  let out = "";
  let database = "(default)";
  let bucket: string | null = null;
  let accounts = false;
  let production = false;
  let projectId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--accounts") accounts = true;
    else if (argument === "--production") production = true;
    else if (value !== undefined && ["--out", "--database", "--bucket", "--project"].includes(argument ?? "")) {
      if (argument === "--out") out = value;
      else if (argument === "--database") database = value;
      else if (argument === "--bucket") bucket = value;
      else projectId = value;
      index += 1;
    } else throw new ToolRefusal(`Unexpected argument "${argument}".\n${MANIFEST_USAGE}`);
  }
  if (out === "") throw new ToolRefusal(`--out is required.\n${MANIFEST_USAGE}`);
  if (!/^[\w()-]{1,63}$/.test(database))
    throw new ToolRefusal("--database names a Firestore database by its identifier.");
  return { out: path.resolve(out), database, bucket, accounts, production, projectId };
}

export const backupManifestCommand: Command = {
  name: "backup:manifest",
  summary: "Write a manifest of every document (and optionally account and object) with a hash of each.",
  async run(args) {
    const request = parseManifestArguments(args);
    const target = requireImportTarget({
      production: request.production,
      ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
    });
    if (target.kind === "emulator") await requireRunningEmulators(target);
    // The emulators need no credential, so the SDK must not go looking for one on the network.
    if (target.kind === "emulator") process.env.METADATA_SERVER_DETECTION ??= "none";
    const app =
      getApps()[0] ??
      initializeApp(
        target.kind === "emulator"
          ? { projectId: target.projectId }
          : { credential: applicationDefault(), projectId: target.projectId },
      );
    const db = request.database === "(default)" ? getFirestore(app) : getFirestore(app, request.database);
    const manifest: BackupManifest = {
      format: MANIFEST_FORMAT,
      projectId: target.projectId,
      takenAt: new Date().toISOString(),
      documents: await documentEntries(db),
      accounts: request.accounts ? await accountEntries(getAuth(app)) : [],
      objects:
        request.bucket === null
          ? []
          : await objectEntries(
              getStorage(app),
              request.bucket === "default" ? defaultBucketName(target.projectId) : request.bucket,
            ),
    };
    writeFileSync(request.out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `backup:manifest read ${target.projectId} (${target.kind}): ${manifest.documents.length} documents, ` +
        `${manifest.accounts.length} accounts, ${manifest.objects.length} objects.`,
    );
    return undefined;
  },
};

export const backupCompareCommand: Command = {
  name: "backup:compare",
  summary: "Compare the manifest of a backup with the manifest of its restore. Needs no database.",
  async run(args) {
    const [backupFile, restoreFile, ...rest] = args;
    if (backupFile === undefined || restoreFile === undefined || rest.length > 0) {
      throw new ToolRefusal("Usage: backup:compare <backup manifest> <restore manifest>");
    }
    const difference = compareManifests(
      parseManifest(readFileSync(backupFile, "utf8")),
      parseManifest(readFileSync(restoreFile, "utf8")),
    );
    for (const kind of MANIFEST_KINDS) {
      const { missing, changed, unexpected } = difference[kind];
      console.log(`${kind}: ${missing.length} missing, ${changed.length} changed, ${unexpected.length} unexpected`);
      for (const key of missing) console.log(`  missing ${key}`);
      for (const key of changed) console.log(`  changed ${key}`);
      for (const key of unexpected) console.log(`  unexpected ${key}`);
    }
    const count = differenceCount(difference);
    console.log(count === 0 ? "The restore is identical to the backup." : `The restore differs in ${count} entries.`);
    return count === 0 ? undefined : EXIT_DIFFERENT;
  },
};
