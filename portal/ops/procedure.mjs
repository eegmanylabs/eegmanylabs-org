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
import { createInterface } from "node:readline/promises";
import { isPlaceholder } from "./environments.mjs";

/**
 * One command of a procedure: the program, its arguments, and what it is for.
 * @typedef {{ program: "gcloud" | "firebase" | "npm", args: string[], purpose: string }} PlannedCommand
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

/** @param {PlannedCommand} command */
export function commandLine(command) {
  return [command.program, ...command.args].map(quote).join(" ");
}

/** @param {readonly PlannedCommand[]} commands */
export function printPlan(commands) {
  for (const [index, command] of commands.entries()) {
    console.log(`# ${index + 1}. ${command.purpose}`);
    console.log(commandLine(command));
    console.log("");
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
  for (const command of commands) {
    console.log(`Running: ${commandLine(command)}`);
    const result = spawnSync(command.program, command.args, { stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`Stopped: the command failed with status ${result.status ?? "unknown"}.`);
      return result.status ?? 1;
    }
  }
  return 0;
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
