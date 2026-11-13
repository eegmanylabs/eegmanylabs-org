// publish:verify --batch <id> [--site <repository>] [--build-command "<command>"] [--keep]
//                [--production --project <identifier>]
//
// The staging verification of a public export (requirement R14.3, docs/INTEGRATIONS.md,
// section 6). It copies the website's repository into a scratch directory outside the
// repository, writes the files of the export into the copy, builds the site there with the
// site's own build command and checks the result. The report is recorded on the export, which
// becomes verified or failed; only a verified export can be approved, and only for the files
// that were built. The repository itself is read and never changed, which the last check proves.
//
// The build runs on a trusted machine, because the build command is Python and the functions
// cannot run it. The default command is `syrinx -c -e staging .`, as the website's README gives
// it, run by the Syrinx that `node scripts/site-build.mjs ensure` installs beside the portal where
// it is installed; `--build-command`, or the variable SITE_BUILD_COMMAND, names another.
//
// | Check        | Passes when                                                                    |
// |--------------|--------------------------------------------------------------------------------|
// | `payload`    | The files are the files the preview showed: their hash is the export's         |
// | `build`      | The build command ends successfully                                             |
// | `output`     | The build wrote the home page                                                   |
// | `pages`      | Every added or changed row of a file the site reads appears on its page         |
// | `feeds`      | Every candidate file is published as it was written                             |
// | `images`     | Every portrait that the core team file names exists in the copy                  |
// | `stages`     | Every replication has a stage the site's filters know and a stage tag             |
// | `privacy`    | No text shaped like an email address is in any file of the export               |
// | `repository` | The repository's own files are unchanged after the build                        |
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COLLECTIONS,
  cellOf,
  isWebsiteStagePair,
  type PublicationFileDoc,
  parseStoredDocument,
  parseTsv,
  privacyFindings,
  publicationBatchDocSchema,
  publicationFileDocSchema,
  publicationPayloadSha256,
  sha256Hex,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";

export const PUBLISH_VERIFY_ACTOR = systemActor("publishVerify");

export const DEFAULT_BUILD_COMMAND = "syrinx -c -e staging .";

/**
 * The build command where none is named: the Syrinx that `node scripts/site-build.mjs ensure`
 * installs beside the portal, where it is, and otherwise the one on the path.
 */
export function defaultBuildCommand(portalRoot: string): string {
  const installed = path.join(portalRoot, ".run", "site-venv", "bin", "syrinx");
  return existsSync(installed) ? `${installed} -c -e staging .` : DEFAULT_BUILD_COMMAND;
}

/**
 * The build command as it is recorded on the export: an installed Syrinx is named by its program
 * alone, so the record never shows a path of the trusted machine.
 */
export function recordedCommand(command: string): string {
  return command.replace(/^\S*[\\/]syrinx(?=\s|$)/, "syrinx");
}

/** What the copy leaves out: the history, the portal and anything a build or a tool generated. */
const NOT_COPIED = new Set([".git", "portal", "node_modules", "dist", ".venv", "venv", ".run"]);

/** The page of the built site on which the rows of each file that the site reads appear. */
const PAGES: Readonly<Record<string, string>> = {
  "data/replications.tsv": "replications/index.html",
  "data/publications.tsv": "publications/index.html",
  "data/people.tsv": "people/index.html",
  "data/members.tsv": "members/index.html",
};

/** The column of each file whose value the page shows for a row. */
const KEY_COLUMNS: Readonly<Record<string, string>> = {
  "data/replications.tsv": "StudyId",
  "data/publications.tsv": "PublicationId",
  "data/people.tsv": "PersonId",
  "data/members.tsv": "PersonId",
};

export interface VerifyOptions {
  readonly batchId: string;
  /** The root of the website's repository, which is copied and never changed. */
  readonly siteRoot: string;
  readonly buildCommand: string;
  /** Whether the scratch copy is kept for a person to look at. */
  readonly keep?: boolean;
  readonly now?: Date;
}

export interface Check {
  readonly key: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VerifyResult {
  readonly passed: boolean;
  readonly checks: readonly Check[];
  readonly scratch: string;
}

function hashOf(file: string): string | null {
  return existsSync(file) ? sha256Hex(readFileSync(file, "utf8")) : null;
}

/** The checks of a build, on the copy it was made in. */
function checkBuild(scratch: string, files: readonly PublicationFileDoc[], exitStatus: number | null): Check[] {
  const dist = path.join(scratch, "dist");
  const checks: Check[] = [
    {
      key: "build",
      passed: exitStatus === 0,
      detail:
        exitStatus === 0
          ? "The build command succeeded."
          : `The build command ended with status ${exitStatus ?? "none"}.`,
    },
    {
      key: "output",
      passed: existsSync(path.join(dist, "index.html")),
      detail: "The home page of the built site.",
    },
  ];
  let missing = 0;
  let looked = 0;
  for (const file of files) {
    const page = PAGES[file.path];
    const column = KEY_COLUMNS[file.path];
    if (page === undefined || column === undefined) continue;
    const html = existsSync(path.join(dist, page)) ? readFileSync(path.join(dist, page), "utf8") : "";
    for (const row of file.diff.rows) {
      if (row.kind === "removed") continue;
      looked += 1;
      if (!html.includes(row.key.split("|")[0] ?? row.key)) missing += 1;
    }
  }
  checks.push({
    key: "pages",
    passed: missing === 0,
    detail: `${looked - missing} of ${looked} added or changed rows appear on their pages.`,
  });
  const feeds = files.filter((file) => file.path.startsWith("assets/data/"));
  const published = feeds.filter((file) => hashOf(path.join(dist, file.path)) === file.sha256);
  checks.push({
    key: "feeds",
    passed: published.length === feeds.length,
    detail: `${published.length} of ${feeds.length} candidate files are published as written.`,
  });
  const people = files.find((file) => file.path === "data/people.tsv");
  let portraits = 0;
  let absent = 0;
  if (people !== undefined) {
    const table = parseTsv(people.content);
    for (const line of table.lines) {
      const portrait = cellOf(table, line, "HeadShotFilename");
      if (portrait === "") continue;
      portraits += 1;
      if (!existsSync(path.join(scratch, "assets", "images", "headshots", portrait))) absent += 1;
    }
  }
  checks.push({
    key: "images",
    passed: absent === 0,
    detail: `${portraits - absent} of ${portraits} portraits named in the core team file exist.`,
  });
  // Every card of a replication gets a stage the site's filters know, and a tag that is not empty.
  const replications = files.find((file) => file.path === "data/replications.tsv");
  let stages = 0;
  let unknownStages = 0;
  if (replications !== undefined) {
    const table = parseTsv(replications.content);
    for (const line of table.lines) {
      if (cellOf(table, line, "StudyId") === "") continue;
      stages += 1;
      const known = isWebsiteStagePair(cellOf(table, line, "StageNumber"), cellOf(table, line, "StageName"));
      if (!known || cellOf(table, line, "LongStageText").trim() === "") unknownStages += 1;
    }
  }
  checks.push({
    key: "stages",
    passed: unknownStages === 0,
    detail: `${stages - unknownStages} of ${stages} replications have a stage the website knows and a stage tag.`,
  });
  const findings = privacyFindings(Object.fromEntries(files.map((file) => [file.path, file.content])));
  checks.push({
    key: "privacy",
    passed: findings.length === 0,
    detail: `${findings.length} lines with text shaped like an email address.`,
  });
  return checks;
}

export async function verifyPublication(db: Firestore, options: VerifyOptions): Promise<VerifyResult> {
  const reference = db.doc(COLLECTIONS.publicationBatches.docPath(options.batchId));
  const batch = parseStoredDocument(publicationBatchDocSchema, (await reference.get()).data());
  if (!batch.success) throw new ToolRefusal(`There is no export ${options.batchId}.`);
  if (batch.data.status !== "previewed") {
    throw new ToolRefusal(`The export is ${batch.data.status}; only an export that was previewed is built.`);
  }
  const files = (await db.collection(COLLECTIONS.publicationFiles.collectionPath(options.batchId)).get()).docs.flatMap(
    (document) => {
      const parsed = parseStoredDocument(publicationFileDocSchema, document.data());
      return parsed.success ? [parsed.data] : [];
    },
  );
  const siteRoot = path.resolve(options.siteRoot);
  if (!existsSync(path.join(siteRoot, "syrinx.cfg"))) {
    throw new ToolRefusal(`${siteRoot} is not the website's repository: it has no syrinx.cfg.`);
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), `eegml-site-${options.batchId}-`));
  if (path.relative(siteRoot, scratch).split(path.sep)[0] !== "..") {
    throw new ToolRefusal("The scratch copy must lie outside the repository.");
  }
  const guarded = files.map((file) => path.join(siteRoot, file.path));
  const before = guarded.map(hashOf);
  const checks: Check[] = [];
  const payload = publicationPayloadSha256(files);
  checks.push({
    key: "payload",
    passed: payload === batch.data.payloadSha256,
    detail:
      payload === batch.data.payloadSha256
        ? "The files are those of the preview."
        : "The files differ from the preview.",
  });
  try {
    cpSync(siteRoot, scratch, {
      recursive: true,
      filter: (source) => !NOT_COPIED.has(path.basename(source)) || path.dirname(source) !== siteRoot,
    });
    for (const file of files) {
      const target = path.join(scratch, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    const build = spawnSync("sh", ["-c", options.buildCommand], { cwd: scratch, encoding: "utf8", timeout: 600_000 });
    checks.push(...checkBuild(scratch, files, build.status));
  } finally {
    const after = guarded.map(hashOf);
    const unchanged = after.every((hash, index) => hash === before[index]);
    checks.push({
      key: "repository",
      passed: unchanged,
      detail: unchanged
        ? "The repository's files are unchanged."
        : "A file of the repository changed during the build.",
    });
    if (options.keep !== true) rmSync(scratch, { recursive: true, force: true });
  }
  const passed = checks.every((check) => check.passed);
  const at = options.now ?? new Date();
  const failed = checks.filter((check) => !check.passed).map((check) => check.key);
  await reference.update({
    status: passed ? "verified" : "failed",
    ...(passed ? {} : { statusReason: `The staging build failed its checks: ${failed.join(", ")}.` }),
    verification: {
      checkedAt: Timestamp.fromDate(at),
      passed,
      payloadSha256: batch.data.payloadSha256,
      buildCommand: recordedCommand(options.buildCommand).slice(0, 200),
      checks: checks.map((check) => ({ ...check, detail: check.detail.slice(0, 1_000) })),
    },
    updatedAt: Timestamp.fromDate(at),
    updatedBy: PUBLISH_VERIFY_ACTOR,
    writeContext: systemWriteContext(),
  });
  return { passed, checks, scratch };
}

const USAGE =
  'Usage: publish:verify --batch <id> [--site <repository>] [--build-command "<command>"] [--keep] [--production --project <identifier>]';

export const publishVerifyCommand: Command = {
  name: "publish:verify",
  summary: "Build the public site from an export in a scratch copy and record the checks",
  async run(args) {
    let batchId: string | undefined;
    const portalRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    let siteRoot = path.resolve(portalRoot, "..");
    let buildCommand = process.env.SITE_BUILD_COMMAND?.trim() || defaultBuildCommand(portalRoot);
    let keep = false;
    let production = false;
    let projectId: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      const value = args[index + 1];
      if (argument === "--batch" && value !== undefined) {
        batchId = value;
        index += 1;
      } else if (argument === "--site" && value !== undefined) {
        siteRoot = value;
        index += 1;
      } else if (argument === "--build-command" && value !== undefined) {
        buildCommand = value;
        index += 1;
      } else if (argument === "--keep") keep = true;
      else if (argument === "--production") production = true;
      else if (argument === "--project" && value !== undefined) {
        projectId = value;
        index += 1;
      } else throw new ToolRefusal(USAGE);
    }
    if (batchId === undefined) throw new ToolRefusal(USAGE);
    const target = requireImportTarget({ production, ...(projectId === undefined ? {} : { projectId }) });
    let db: Firestore;
    if (target.kind === "production") db = connectToProject(target.projectId).db;
    else {
      await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
      db = connectToEmulators(target).db;
    }
    const result = await verifyPublication(db, { batchId, siteRoot, buildCommand, keep });
    for (const check of result.checks)
      console.log(`${check.passed ? "passed" : "FAILED"}  ${check.key}: ${check.detail}`);
    if (keep) console.log(`The scratch copy is kept at ${result.scratch}.`);
    console.log(result.passed ? "The export is verified." : "The export failed its staging build.");
    return result.passed ? undefined : 3;
  },
};
