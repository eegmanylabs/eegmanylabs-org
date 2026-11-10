// The command line of the importers (docs/MIGRATION_PLAN.md, section 2).
//
//   import list
//   import fetch <source> [--sheet <name>] [--config <file>] [--out <directory>]
//   import run <source> --input <path> --mode preview|apply [--observed-on <date>] [--commit <hash>]
//                       [--sheet <name>] [--preview <batch>] [--config <file>]
//                       [--production --project <identifier>]
//   import show <batch>
//   import rollback <batch>
//   import verify <source> --input <path> [--sheet <name>] [--observed-on <date>] [--config <file>]
//   import purge-special (--source <source> | --batch <batch>)
//
// `--sheet` names one member of a family of sources, such as one contributor sheet, by the name
// under which the private configuration registers it.
//
// | Exit status | Meaning                                                                         |
// |-------------|---------------------------------------------------------------------------------|
// | 0           | Done                                                                            |
// | 1           | The tool failed unexpectedly                                                    |
// | 2           | Refused: wrong usage, missing configuration, or a target that is no emulator    |
// | 3           | Blocked: a check of the source failed, a verification failed, or a rollback was refused because documents have changed |
// | 4           | Stopped: the database changed while the import was running. Run it again        |
//
// Everything printed here is a count, an identifier or a path of a document. No name, address
// or cell content is ever printed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { COLLECTIONS, isoDateSchema } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";
import { ImportStopped } from "../import/apply";
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_EXPORTS_DIRECTORY,
  loadPrivateConfig,
  namesSourceDocument,
  type PrivateConfig,
} from "../import/config";
import { discoverImporters } from "../import/discover";
import { fetchExport } from "../import/fetch";
import type { ImporterDefinition, ImportInput } from "../import/model";
import { purgeSpecial } from "../import/purge";
import { SOURCE_DEFINITIONS, SOURCE_FAMILIES } from "../import/registry";
import { rollbackBatch } from "../import/rollback";
import { type RunReport, runImport } from "../import/run";
import { type VerificationBaseline, verifyImport } from "../import/verify";
import type { RunTarget } from "../import/withheld";

const EXIT_BLOCKED = 3;
const EXIT_STOPPED = 4;

const USAGE = [
  "Usage:",
  "  import list",
  "  import fetch <source> [--sheet <name>] [--config <file>] [--out <directory>]",
  "  import run <source> --input <path> --mode preview|apply [--observed-on <date>] [--commit <hash>]",
  "             [--sheet <name>] [--preview <batch>] [--config <file>] [--production --project <identifier>]",
  "  import show <batch>",
  "  import rollback <batch>",
  "  import verify <source> --input <path> [--sheet <name>] [--observed-on <date>] [--config <file>]",
  "  import purge-special (--source <source> | --batch <batch>)",
].join("\n");

const VALUE_OPTIONS = [
  "--input",
  "--mode",
  "--observed-on",
  "--commit",
  "--preview",
  "--config",
  "--out",
  "--project",
  "--sheet",
  "--source",
  "--batch",
];
const FLAGS = ["--production"];

interface Arguments {
  readonly positional: readonly string[];
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

function parse(args: readonly string[]): Arguments {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (FLAGS.includes(argument)) flags.add(argument);
    else if (VALUE_OPTIONS.includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new ToolRefusal(`${argument} needs a value.\n\n${USAGE}`);
      values.set(argument, value);
      index += 1;
    } else if (argument.startsWith("--")) throw new ToolRefusal(`Unknown option ${argument}.\n\n${USAGE}`);
    else positional.push(argument);
  }
  return { positional, values, flags };
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") throw new ToolRefusal(`${what} is missing.\n\n${USAGE}`);
  return value;
}

async function database(
  given: Arguments,
): Promise<{ readonly db: Firestore; readonly label: string; readonly production: boolean }> {
  const projectId = given.values.get("--project");
  const target = requireImportTarget({
    production: given.flags.has("--production"),
    ...(projectId === undefined ? {} : { projectId }),
  });
  if (target.kind === "production") {
    return {
      db: connectToProject(target.projectId).db,
      label: `${target.projectId} (a real project)`,
      production: true,
    };
  }
  await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
  return { db: connectToEmulators(target).db, label: `${target.projectId} (emulator)`, production: false };
}

/**
 * The importer of a source. Where one importer serves a family of sources, it is bound to the
 * member that `--sheet` names, which the private configuration has to register.
 */
async function importerOf(source: string, given: Arguments, config: PrivateConfig): Promise<ImporterDefinition> {
  const importers = await discoverImporters();
  const wanted = source.toLowerCase();
  const found = importers.find((candidate) => candidate.sourceKey === wanted || candidate.key.toLowerCase() === wanted);
  if (found === undefined) {
    throw new ToolRefusal(
      `No importer exists for "${source}". Importers exist for: ${importers.map((candidate) => candidate.sourceKey).join(", ")}.`,
    );
  }
  const selector = given.values.get("--sheet");
  if (found.select === undefined) {
    if (selector !== undefined) throw new ToolRefusal(`Source ${found.sourceKey} is one source and takes no --sheet.`);
    return found;
  }
  return found.select({ selector, config });
}

/** The commit that a directory was read at, where it is part of a git checkout and holds no uncommitted change. */
function commitOf(directory: string): string | undefined {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return git("status", "--porcelain", "--", ".") === "" ? git("rev-parse", "HEAD") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a file written to a directory could be committed: the directory lies in a git work
 * tree and git does not ignore it. A directory that does not exist yet is judged by its path.
 */
function isCommittable(directory: string): boolean {
  let existing = directory;
  while (!existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", existing, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (git("rev-parse", "--is-inside-work-tree") !== "true") return false;
  } catch {
    return false;
  }
  try {
    // `check-ignore` ends with status 0 for an ignored path and with status 1 for one that is not.
    git("check-ignore", "--quiet", path.join(directory, "export.xlsx"));
    return false;
  } catch {
    return true;
  }
}

/** The day on which a fetched export was retrieved, from the record that `import fetch` writes beside it. */
function fetchedOn(inputPath: string): string | undefined {
  const record = inputPath.replace(/\.xlsx$/i, ".json");
  if (record === inputPath || !existsSync(record)) return undefined;
  try {
    const { retrievedAt } = JSON.parse(readFileSync(record, "utf8")) as { retrievedAt?: unknown };
    return typeof retrievedAt === "string" ? retrievedAt.slice(0, 10) : undefined;
  } catch {
    return undefined;
  }
}

function inputOf(given: Arguments, config: PrivateConfig): ImportInput {
  const inputPath = path.resolve(required(given.values.get("--input"), "--input"));
  if (namesSourceDocument(path.basename(inputPath), config)) {
    // The name is neither stored nor printed. A file that carries the identifier of its document in its name is
    // still refused, so that the identifier stays out of every place a file name can travel to.
    throw new ToolRefusal(
      "Refusing to run: the name of the input file holds the identifier of a source document, which is private. " +
        "Give the file a neutral name, such as the letter of its source, and run the command again.",
    );
  }
  if (!existsSync(inputPath)) throw new ToolRefusal(`Refusing to run: the input ${inputPath} does not exist.`);
  const stated = given.values.get("--observed-on");
  const observedOn = stated ?? fetchedOn(inputPath) ?? new Date().toISOString().slice(0, 10);
  if (!isoDateSchema.safeParse(observedOn).success) {
    throw new ToolRefusal("Refusing to run: --observed-on is a date such as 2026-11-09, the day of the export.");
  }
  if (stated === undefined) console.log(`The export date was not stated with --observed-on. Taken as ${observedOn}.`);
  const commit = given.values.get("--commit") ?? (statSync(inputPath).isDirectory() ? commitOf(inputPath) : undefined);
  if (commit !== undefined && !/^[0-9a-f]{7,64}$/.test(commit)) {
    throw new ToolRefusal("Refusing to run: --commit is a commit hash in lower-case hexadecimal.");
  }
  return { path: inputPath, observedOn, ...(commit === undefined ? {} : { commit }) };
}

const counted = (counts: Readonly<Record<string, number | undefined>>): string =>
  Object.entries(counts)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, count]) => `${name} ${count ?? 0}`)
    .join(", ");

/** Prints what a run did or would do: counts, field names and identifiers only. */
function printReport(report: RunReport, target: string): void {
  const would = report.mode === "preview";
  console.log(
    `import ${report.mode} of source ${report.sourceKey} against ${target}: batch ${report.batchId}, ${report.status}.`,
  );
  for (const check of report.blocking) console.log(`Blocking check ${check.check}: ${check.message}`);
  console.log("Rows:");
  for (const tab of report.tabs) {
    const classes = Object.entries(tab.rows)
      .filter(([, count]) => count > 0)
      .map(([rowClass, count]) => `${count} ${rowClass}`)
      .join(", ");
    const raw = Object.entries(tab.rawOnly)
      .map(([reason, count]) => `${count} kept raw (${reason})`)
      .join(", ");
    console.log(
      `  ${tab.tabKey}: ${classes || "no rows"}. Data rows: ${tab.imported} imported, ${tab.queued} held in the queue` +
        `${raw === "" ? "" : `, ${raw}`}${tab.cellAnnotations > 0 ? `. ${tab.cellAnnotations} cell annotations` : ""}.`,
    );
  }
  const records = report.sourceRecords;
  console.log(
    `Source records: ${records.seen} seen, ${records.created} new, ${records.superseded} superseded, ${records.missing} no longer seen.`,
  );
  console.log(`Documents${would ? " (what an apply would write)" : ""}:`);
  const collections = Object.entries(report.collections).sort(([a], [b]) => (a < b ? -1 : 1));
  if (collections.length === 0) console.log("  none planned");
  for (const [collection, account] of collections) {
    console.log(
      `  ${collection}: ${account.created} ${would ? "to create" : "created"}, ${account.changed} ${would ? "to change" : "changed"}, ` +
        (account.removed > 0 ? `${account.removed} ${would ? "to remove" : "removed"}, ` : "") +
        `${account.matched} with source records brought up to date, ${account.unchanged} left alone.`,
    );
    if (Object.keys(account.fields).length > 0) console.log(`    fields that change: ${counted(account.fields)}`);
  }
  for (const action of ["raise", "reopen", "supersede", "clear"] as const) {
    if (Object.keys(report.items[action]).length > 0)
      console.log(`Items to ${action}: ${counted(report.items[action])}.`);
  }
  console.log(`Items that exist already and stay as they are: ${report.items.standing}.`);
  if (report.conflicts > 0) {
    console.log(
      `${report.conflicts} fields were left alone because their live value differs from the source. Each is in the queue.`,
    );
  }
  const pending =
    Object.values(report.collections).reduce(
      (sum, account) => sum + account.created + account.changed + account.removed + account.matched,
      0,
    ) +
    (["raise", "reopen", "supersede", "clear"] as const).reduce(
      (sum, action) => sum + Object.values(report.items[action]).reduce((a, b) => a + (b ?? 0), 0),
      0,
    );
  if (report.documentsWritten === 0 && pending > 0) {
    // A preview of rows that are stored already writes nothing, and still has changes to show.
    console.log("Nothing was written except the batch record. An apply would write the changes listed above.");
  } else if (report.documentsWritten === 0) {
    console.log("Nothing was written except the batch record: the database already holds everything this input says.");
  } else {
    console.log(
      `${report.documentsWritten} documents were written beside the batch record, ${report.changesCommitted} of them changes with a log entry.`,
    );
  }
}

async function list(): Promise<number | undefined> {
  const importers = await discoverImporters();
  console.log("Sources of the registry, with the importer of each:");
  for (const definition of SOURCE_DEFINITIONS) {
    const importer = importers.find((candidate) => candidate.sourceKey === definition.key);
    console.log(
      `  ${definition.key}  ${definition.title}: ` +
        (importer === undefined
          ? "no importer yet"
          : `${importer.key}. ${importer.summary} Input: ${importer.inputDescription}.`),
    );
  }
  console.log("Families of sources, whose members the private configuration registers:");
  for (const family of SOURCE_FAMILIES) {
    const importer = importers.find((candidate) => candidate.sourceKey === family.key);
    console.log(
      `  ${family.key}  ${family.title}: ` +
        (importer === undefined
          ? "no importer yet"
          : `${importer.key}. ${importer.summary} Input: ${importer.inputDescription}. Name the member with ${family.selectedBy}.`),
    );
  }
  return undefined;
}

async function fetchSource(given: Arguments): Promise<number | undefined> {
  const named = required(given.positional[1], "The source").toLowerCase();
  const config = loadPrivateConfig(given.values.get("--config") ?? DEFAULT_CONFIG_PATH);
  // A member of a family is fetched under its own key, from the address that its registration names.
  const member = SOURCE_FAMILIES.some((family) => family.key === named)
    ? await importerOf(named, given, config)
    : undefined;
  const sourceKey = member?.sourceKey ?? named;
  const exportUrl = member === undefined ? config.sources[sourceKey]?.exportUrl : member.location?.exportUrl;
  if (exportUrl === undefined) {
    throw new ToolRefusal(
      `Refusing to fetch: the private configuration names no export address for source ${sourceKey}.`,
    );
  }
  const directory = path.resolve(given.values.get("--out") ?? DEFAULT_EXPORTS_DIRECTORY);
  if (isCommittable(directory)) {
    throw new ToolRefusal(
      "Refusing to fetch: the directory named with --out lies in a git work tree and git does not ignore it, " +
        "so the export could be committed. Leave --out away, or name a directory that git ignores.",
    );
  }
  const fetched = await fetchExport({ sourceKey, exportUrl, directory });
  console.log(
    `Fetched source ${sourceKey}: ${fetched.filePath} (${fetched.bytes} bytes, ${fetched.tabs} tabs, SHA-256 ${fetched.sha256}), ` +
      `retrieved at ${fetched.retrievedAt}. The record of the fetch is ${fetched.recordPath}.`,
  );
  return undefined;
}

async function run(given: Arguments): Promise<number | undefined> {
  const source = required(given.positional[1], "The source");
  const mode = required(given.values.get("--mode"), "--mode");
  if (mode !== "preview" && mode !== "apply") throw new ToolRefusal(`--mode is preview or apply.\n\n${USAGE}`);
  const config = loadPrivateConfig(given.values.get("--config") ?? DEFAULT_CONFIG_PATH);
  const importer = await importerOf(source, given, config);
  const previewBatchId = given.values.get("--preview");
  const input = inputOf(given, config);
  const { db, label, production } = await database(given);
  const target: RunTarget = { production, rehearse: config.rehearse };
  if (production && mode === "apply" && previewBatchId === undefined) {
    throw new ToolRefusal(
      "Refusing to run: an apply against a real project carries out a previewed batch. Name it with --preview <batch>.",
    );
  }
  try {
    const report = await runImport({
      db,
      importer,
      input,
      mode,
      secret: config.hashKey,
      locations: config.sources,
      target,
      ...(previewBatchId === undefined ? {} : { previewBatchId }),
    });
    printReport(report, label);
    return report.blocking.length > 0 ? EXIT_BLOCKED : undefined;
  } catch (error) {
    if (!(error instanceof ImportStopped)) throw error;
    console.error(error.message);
    return EXIT_STOPPED;
  }
}

async function show(given: Arguments): Promise<number | undefined> {
  const batchId = required(given.positional[1], "The batch");
  const { db, label } = await database(given);
  const batch = await db.doc(COLLECTIONS.importBatches.docPath(batchId)).get();
  if (!batch.exists) throw new ToolRefusal(`No batch ${batchId} exists in ${label}.`);
  const text = (field: string) => {
    const value: unknown = batch.get(field);
    const instant = value as { toDate?: () => Date } | null | undefined;
    return typeof instant?.toDate === "function"
      ? instant.toDate().toISOString()
      : value === undefined || value === null
        ? "none"
        : String(value);
  };
  console.log(`Batch ${batchId} in ${label}`);
  for (const field of [
    "sourceKey",
    "mode",
    "status",
    "startedAt",
    "finishedAt",
    "observedOn",
    "sourceCommit",
    "contentHash",
    "planHash",
    "previewBatchId",
    "manifestBatchId",
  ]) {
    console.log(`  ${field}: ${text(field)}`);
  }
  const stats = (batch.get("stats") as Record<string, number> | undefined) ?? {};
  for (const [name, count] of Object.entries(stats).sort(([a], [b]) => (a < b ? -1 : 1)))
    console.log(`  ${name}: ${count}`);
  const changes = await db.collection(COLLECTIONS.importBatchChanges.collectionPath(batchId)).get();
  const byCollection: Record<string, number> = {};
  for (const change of changes.docs) {
    // The collections of a path are its segments at even positions, which hold no identifier.
    const collection = (change.get("documentPath") as string)
      .split("/")
      .filter((_segment, index) => index % 2 === 0)
      .join("/");
    const key = `${collection} ${String(change.get("relation"))}`;
    byCollection[key] = (byCollection[key] ?? 0) + 1;
  }
  console.log(`Changes in the log: ${changes.size}${changes.size === 0 ? "" : ` (${counted(byCollection)})`}.`);
  const log = await db.collection(COLLECTIONS.importBatchLog.collectionPath(batchId)).get();
  for (const entry of log.docs) console.log(`  ${String(entry.get("level"))}: ${String(entry.get("message"))}`);
  return undefined;
}

async function rollback(given: Arguments): Promise<number | undefined> {
  const batchId = required(given.positional[1], "The batch");
  const { db, label } = await database(given);
  const result = await rollbackBatch(db, batchId);
  if (result.status === "notFound") throw new ToolRefusal(`No batch ${batchId} exists in ${label}.`);
  if (result.status === "nothingToReverse") {
    console.log(`Batch ${batchId} has nothing to reverse: ${result.reason}.`);
    return undefined;
  }
  if (result.status === "refused") {
    console.log(
      `Rollback of batch ${batchId} refused: ${result.changedDocuments.length} documents have changed since the batch wrote them. Nothing was reversed.`,
    );
    for (const document of result.changedDocuments) console.log(`  ${document}`);
    return EXIT_BLOCKED;
  }
  console.log(
    `Batch ${batchId} rolled back: ${result.restored} documents restored, ${result.removed} removed, ` +
      `${result.itemsWithdrawn} items withdrawn. Source records were kept.`,
  );
  for (const item of result.itemsLeft) console.log(`  Left in place, because a reviewer has decided it: ${item}`);
  return undefined;
}

async function verify(given: Arguments): Promise<number | undefined> {
  const config = loadPrivateConfig(given.values.get("--config") ?? DEFAULT_CONFIG_PATH);
  const importer = await importerOf(required(given.positional[1], "The source"), given, config);
  const input = inputOf(given, config);
  const { db, label, production } = await database(given);
  const sheet = given.values.get("--sheet");
  const rows =
    sheet === undefined ? config.sources[importer.sourceKey]?.baseline : config.contributorSheets?.[sheet]?.baseline;
  const baseline: VerificationBaseline = {
    ...(rows === undefined ? {} : { rows }),
    ...(config.expectedStudies === undefined ? {} : { studies: config.expectedStudies }),
  };
  const confirmedHeaders = config.sources[importer.sourceKey]?.confirmedHeaders;
  const checks = await verifyImport({
    db,
    importer,
    input,
    secret: config.hashKey,
    target: { production, rehearse: config.rehearse },
    baseline,
    requireBaseline: true,
    record: true,
    ...(confirmedHeaders === undefined ? {} : { confirmedHeaders }),
  });
  console.log(`Verification of source ${importer.sourceKey} in ${label}:`);
  for (const check of checks) console.log(`  ${check.passed ? "passed" : "FAILED"}  ${check.key}: ${check.detail}`);
  const failed = checks.filter((check) => !check.passed).length;
  console.log(
    failed === 0
      ? "Every check passed. The report is stored on the latest applied batch of the source."
      : `${failed} checks failed. The import is not verified. The report is stored on the latest applied batch of the source.`,
  );
  return failed === 0 ? undefined : EXIT_BLOCKED;
}

/**
 * Removes the special-category copies that imports keep where no client reads them: the cells of
 * rows that wait in the queue, and the states that the change log keeps for a rollback. It is
 * the decision of an administrator, for one source or for one batch, and it prints counts only.
 */
async function purge(given: Arguments): Promise<number | undefined> {
  const sourceKey = given.values.get("--source")?.toLowerCase();
  const batchId = given.values.get("--batch");
  if ((sourceKey === undefined) === (batchId === undefined)) {
    throw new ToolRefusal(`purge-special names one source or one batch.\n\n${USAGE}`);
  }
  const { db, label } = await database(given);
  const result = await purgeSpecial(db, {
    ...(sourceKey === undefined ? {} : { sourceKey }),
    ...(batchId === undefined ? {} : { batchId }),
  });
  console.log(
    `Special-category copies of ${sourceKey === undefined ? `batch ${batchId}` : `source ${sourceKey}`} in ${label}: ` +
      `${result.cellsRemoved} documents of cells beneath source records removed, ${result.statesRemoved} kept states of the change log removed. ` +
      "A batch whose kept states are removed can no longer be rolled back.",
  );
  return undefined;
}

export const importCommand: Command = {
  name: "import",
  summary: "Import a source: list, fetch, run (preview or apply), show, rollback, verify, purge-special.",
  async run(args) {
    const given = parse(args);
    switch (given.positional[0]) {
      case "list":
        return list();
      case "fetch":
        return fetchSource(given);
      case "run":
        return run(given);
      case "show":
        return show(given);
      case "rollback":
        return rollback(given);
      case "verify":
        return verify(given);
      case "purge-special":
        return purge(given);
      default:
        throw new ToolRefusal(USAGE);
    }
  },
};
