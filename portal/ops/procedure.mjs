// @ts-check
// What every procedure of this directory shares: it acts on one project that the operator names
// in full on the command line, prints the commands it would run, and runs them only after the
// operator has typed the project identifier again at an interactive terminal.
//
//   node ops/<procedure>.mjs --project <identifier> [other options]            print only
//   node ops/<procedure>.mjs --project <identifier> [other options] --execute  print, confirm, run
//
// Nothing in this repository runs a procedure with --execute: the tests call the planning
// functions alone, and no workflow file names these scripts.
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { isPlaceholder } from "./environments.mjs";

/** The portal's directory, where every procedure runs its commands. */
export const PORTAL_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The programs a procedure may run. `fb` is the Firebase tools at the version package.json pins,
 * through scripts/fb.sh, never a global install. `gcloud` is the operator's Google Cloud CLI.
 * @type {Readonly<Record<"gcloud" | "fb" | "npm", string>>}
 */
export const PROGRAMS = Object.freeze({
  gcloud: "gcloud",
  fb: path.join(PORTAL_DIRECTORY, "scripts", "fb.sh"),
  npm: "npm",
});

/**
 * One command of a procedure: the program, its arguments, and what it is for.
 *
 * - `unlessSucceeds`: a read-only check run first; when it succeeds the command is skipped,
 *   which makes a creation safe to run again (an account or a secret that exists already).
 * - `allowFailure`: why a failure of this command does not stop the procedure.
 * - `always`: a clean-up that runs even after an earlier command failed.
 * - `stdoutFile`: a file outside the repository that receives what the command prints.
 *
 * @typedef {{
 *   program: keyof typeof PROGRAMS,
 *   args: string[],
 *   purpose: string,
 *   unlessSucceeds?: { program: keyof typeof PROGRAMS, args: string[] },
 *   allowFailure?: string,
 *   always?: true,
 *   stdoutFile?: string,
 * }} PlannedCommand
 */

/** Raised when a procedure declines to go on. */
export class ProcedureRefusal extends Error {
  /** @override */
  name = "ProcedureRefusal";
}

/**
 * Reads "--name value" options and bare flags.
 * @param {readonly string[]} argv
 * @returns {{ options: Map<string, string>, flags: Set<string> }}
 */
export function parseArguments(argv) {
  /** @type {Map<string, string>} */
  const options = new Map();
  /** @type {Set<string>} */
  const flags = new Set();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) throw new ProcedureRefusal(`Unexpected argument "${argument}".`);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options.set(argument.slice(2), next);
      index++;
    } else {
      flags.add(argument.slice(2));
    }
  }
  return { options, flags };
}

/**
 * The project the operator named, refused when absent, a placeholder or a demonstration project.
 * @param {Map<string, string>} options
 * @param {string} [name] The option that names it.
 */
export function requireProject(options, name = "project") {
  const projectId = options.get(name)?.trim() ?? "";
  if (projectId === "")
    throw new ProcedureRefusal(`Refusing: --${name} <identifier> is required. Nothing has been run.`);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) && !isPlaceholder(projectId)) {
    throw new ProcedureRefusal(`Refusing: "${projectId}" is not a Google Cloud project identifier.`);
  }
  if (isPlaceholder(projectId)) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is a placeholder. An administrator supplies the real identifier in ops/environments.mjs first.`,
    );
  }
  if (projectId.startsWith("demo-")) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is a demonstration project, which exists in the emulators only.`,
    );
  }
  return projectId;
}

/**
 * A value of the plan that must have been supplied, refused while it is a placeholder.
 * @param {string} label
 * @param {string} value
 */
export function requireSupplied(label, value) {
  if (isPlaceholder(value)) {
    throw new ProcedureRefusal(`Refusing: ${label} is still the placeholder "${value}" in ops/environments.mjs.`);
  }
  return value;
}

/** @param {string} value */
function quote(value) {
  return /^[\w@%+=:,./()-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/** @param {{ program: keyof typeof PROGRAMS, args: string[] }} command */
function displayProgram(command) {
  return command.program === "fb" ? "scripts/fb.sh" : command.program;
}

/** @param {PlannedCommand} command */
export function commandLine(command) {
  const line = [displayProgram(command), ...command.args].map(quote).join(" ");
  return command.stdoutFile === undefined ? line : `${line} > ${quote(command.stdoutFile)}`;
}

/** @param {readonly PlannedCommand[]} commands */
export function printPlan(commands) {
  for (const [index, command] of commands.entries()) {
    console.log(`# ${index + 1}. ${command.purpose}`);
    if (command.unlessSucceeds !== undefined) {
      const check = [displayProgram(command.unlessSucceeds), ...command.unlessSucceeds.args].map(quote).join(" ");
      console.log(`#    Skipped when this succeeds: ${check}`);
    }
    if (command.allowFailure !== undefined)
      console.log(`#    A failure does not stop the procedure: ${command.allowFailure}`);
    if (command.always === true) console.log("#    Runs even when an earlier command failed.");
    console.log(commandLine(command));
    console.log("");
  }
}

/**
 * Runs one command in the portal's directory and answers its exit status.
 * @param {PlannedCommand} command
 */
function run(command) {
  if (command.unlessSucceeds !== undefined) {
    const check = spawnSync(PROGRAMS[command.unlessSucceeds.program], command.unlessSucceeds.args, {
      cwd: PORTAL_DIRECTORY,
      stdio: "ignore",
    });
    if (check.status === 0) {
      console.log("Skipped: the check found it done already.");
      return 0;
    }
  }
  const output = command.stdoutFile === undefined ? null : openSync(command.stdoutFile, "w", 0o600);
  try {
    const result = spawnSync(PROGRAMS[command.program], command.args, {
      cwd: PORTAL_DIRECTORY,
      stdio: ["inherit", output ?? "inherit", "inherit"],
    });
    if (result.error !== undefined)
      console.error(`Could not start ${displayProgram(command)}: ${result.error.message}`);
    return result.status ?? 1;
  } finally {
    if (output !== null) closeSync(output);
  }
}

/**
 * Prints the plan, and with --execute asks for the project identifier at a terminal and runs the
 * commands one after another, stopping at the first that fails.
 * @param {string} projectId
 * @param {readonly PlannedCommand[]} commands
 * @param {Set<string>} flags
 */
export async function carryOut(projectId, commands, flags) {
  printPlan(commands);
  if (!flags.has("execute")) {
    console.log("Printed only. Nothing has been run. Add --execute to run these commands after a confirmation.");
    return 0;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ProcedureRefusal("Refusing: --execute needs an interactive terminal for the confirmation.");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(
    `Type the project identifier "${projectId}" to run ${commands.length} commands: `,
  );
  prompt.close();
  if (answer.trim() !== projectId)
    throw new ProcedureRefusal("Refusing: the confirmation did not match. Nothing has been run.");
  let failed = 0;
  for (const command of commands) {
    if (failed !== 0 && command.always !== true) continue;
    console.log(`Running: ${commandLine(command)}`);
    const status = run(command);
    if (status === 0) continue;
    if (command.allowFailure !== undefined) {
      console.error(`The command failed with status ${status}, which is expected when ${command.allowFailure}`);
    } else if (failed === 0) {
      console.error(`Stopped: the command failed with status ${status}. Only the clean-up commands still run.`);
      failed = status;
    }
  }
  return failed;
}

/**
 * The main of a procedure script.
 * @param {(parsed: { options: Map<string, string>, flags: Set<string> }) => { projectId: string, commands: PlannedCommand[] }} plan
 */
export async function runProcedure(plan) {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    const { projectId, commands } = plan(parsed);
    process.exitCode = await carryOut(projectId, commands, parsed.flags);
  } catch (error) {
    if (error instanceof ProcedureRefusal) {
      console.error(error.message);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
