// @ts-check
// What every procedure of this directory shares: it acts on one project that the operator names
// in full on the command line, prints the commands it would run, and runs them only after the
// operator has typed the project identifier again at an interactive terminal.
//
//   node ops/<procedure>.mjs --project <identifier> [other options]            print only
//   node ops/<procedure>.mjs --project <identifier> [other options] \
//     --approver "<name>" --approve                                              the approver: print the token
//   node ops/<procedure>.mjs --project <identifier> [other options] \
//     --operator "<name>" --approver "<name>" [--approval-token <token>] --execute  print, confirm, run
//
// A plan is approved before it runs, and the operator and the approver are named on the command
// line; the printed plan states the approval and ends with the record of it that the operator
// keeps in the private operations log (docs/DEPLOYMENT.md). The two are normally two people. The
// programme lead decided on 13 November 2026 to act as both for now (docs/DECISIONS.md, answers
// of 13 November 2026, deployment roles), so a single-person approval is accepted for staging,
// where the plan and the record say so. Production still waits for a second administrator:
//
// | Check on production                                                                          |
// |----------------------------------------------------------------------------------------------|
// | `approvers` of ops/environments.mjs, a reviewed list, names at least two people              |
// | The operator and the approver are two different entries of that list, compared without case, accents, spaces or punctuation |
// | The approver has run the plan with `--approve`, which prints a token bound to the plan and to their name, and the operator passes it with `--approval-token` |
//
// While the list names fewer than two people, every production plan is refused. A name typed on
// the command line identifies nobody, so the token is no proof of who ran `--approve`: it binds the
// approval to the exact plan, and the operations log records it.
//
// Nothing in this repository runs a procedure with --execute: the tests call the planning
// functions alone, and no workflow file names these scripts.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ENVIRONMENTS, isPlaceholder } from "./environments.mjs";

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

/** The decision that lets one person operate and approve a procedure on staging. */
export const SINGLE_PERSON_STAGING_DECISION = Object.freeze({
  decidedBy: "programmeLead",
  decidedOn: "2026-11-13",
  reference: "docs/DECISIONS.md, answers of 13 November 2026, deployment roles",
});

/**
 * Who runs a plan and who approved it. `singlePerson` is true where one person is both, which is
 * accepted for staging alone and carries the decision that allows it. `token` is what the approver's
 * own `--approve` run printed, which production needs.
 * @typedef {{
 *   environment: "staging" | "production",
 *   operator: string,
 *   approver: string,
 *   singlePerson: boolean,
 *   basis: typeof SINGLE_PERSON_STAGING_DECISION | null,
 *   token: string | null,
 * }} Approval
 */

/**
 * The form of a name in which two spellings of one person are equal: decomposed, without accents,
 * letters alone, in lower case. "Synthétic-Lead." and "synthetic lead" are one name.
 * @param {string} name
 */
export function canonicalName(name) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}]+/gu, "")
    .toLocaleLowerCase("en-GB");
}

const SECOND_APPROVER_REFUSAL =
  "Refusing: production needs a second named approver, a person other than the operator, and both must be on the " +
  "reviewed list of approvers in ops/environments.mjs (docs/DEPLOYMENT.md). The programme lead decided on 13 November 2026 " +
  "that production waits for a second administrator. Nothing has been run.";

/**
 * The reviewed list of approvers of an environment.
 * @param {"staging" | "production"} environment
 * @returns {readonly string[]}
 */
export function approversOf(environment) {
  return ENVIRONMENTS[environment].approvers;
}

/**
 * The name of a person given with an option: letters, spaces, full stops, hyphens and
 * apostrophes, so that an address or anything else that identifies an account never reaches the
 * printed plan or the operations log.
 * @param {Map<string, string>} options
 * @param {"operator" | "approver"} name
 */
function personNamed(options, name) {
  const value = (options.get(name) ?? "").trim().replace(/\s+/g, " ");
  if (value === "") throw new ProcedureRefusal(`Refusing: --${name} "<name>" is required to run a plan.`);
  if (value.length > 100 || !/^\p{L}[\p{L} .'-]*$/u.test(value)) {
    throw new ProcedureRefusal(
      `Refusing: --${name} is the name of a person, in letters, not an address or an identifier.`,
    );
  }
  return value;
}

/**
 * Refuses an approver who is not a production approver. Production needs a reviewed list of at
 * least two people, and the name must be one of them.
 * @param {string} name
 * @param {readonly string[]} approvers
 */
function requireListed(name, approvers) {
  const listed = new Set(approvers.map(canonicalName));
  if (listed.size < 2 || !listed.has(canonicalName(name))) throw new ProcedureRefusal(SECOND_APPROVER_REFUSAL);
}

/**
 * The approval of a plan. On production it is refused unless the operator and the approver are
 * two different people of the reviewed list of approvers, which must name at least two.
 * @param {"staging" | "production"} environment
 * @param {Map<string, string>} options
 * @param {readonly string[]} [approvers] The reviewed list; ops/environments.mjs by default.
 * @returns {Approval}
 */
export function requireApproval(environment, options, approvers = approversOf(environment)) {
  const operator = personNamed(options, "operator");
  const approver = personNamed(options, "approver");
  const singlePerson = canonicalName(operator) === canonicalName(approver);
  if (environment === "production") {
    if (singlePerson) throw new ProcedureRefusal(SECOND_APPROVER_REFUSAL);
    requireListed(operator, approvers);
    requireListed(approver, approvers);
  }
  const token = options.get("approval-token")?.trim() ?? "";
  return {
    environment,
    operator,
    approver,
    singlePerson,
    basis: singlePerson ? SINGLE_PERSON_STAGING_DECISION : null,
    token: token === "" ? null : token,
  };
}

/**
 * The token of an approval: the approver's name and a digest of the exact plan. The approver
 * prints it with `--approve`, and a production plan runs only with it.
 * @param {string} approver
 * @param {string} projectId
 * @param {readonly PlannedCommand[]} commands
 */
export function approvalToken(approver, projectId, commands) {
  const digest = createHash("sha256")
    .update(JSON.stringify({ projectId, commands: commands.map(commandLine) }))
    .digest("hex")
    .slice(0, 20);
  return `${canonicalName(approver)}-${digest}`;
}

/**
 * The record of an approval that the operator keeps in the private operations log, with the
 * printed plan. It names people and the project, never an address.
 * @param {Approval} approval
 * @param {string} projectId
 * @param {readonly PlannedCommand[]} commands
 */
export function approvalRecord(approval, projectId, commands) {
  return {
    environment: approval.environment,
    projectId,
    operator: approval.operator,
    approver: approval.approver,
    singlePersonApproval: approval.singlePerson,
    basis: approval.basis,
    commands: commands.length,
    ...(approval.token === null ? {} : { approvalToken: approval.token }),
  };
}

/**
 * What the printed plan says of its approval.
 * @param {Approval | null} approval
 * @param {string} projectId
 * @param {readonly PlannedCommand[]} commands
 * @returns {string[]}
 */
export function approvalLines(approval, projectId, commands) {
  if (approval === null) {
    return ['# Approval: not recorded. --execute needs --operator "<name>" and --approver "<name>".'];
  }
  const lines = [
    `# Approval for ${approval.environment}: operated by ${approval.operator}, approved by ${approval.approver}.`,
  ];
  if (approval.singlePerson && approval.basis !== null) {
    lines.push(
      `# Single-person approval: one person operates and approves this plan, which is accepted for staging alone ` +
        `(decided by the programme lead on ${approval.basis.decidedOn}, ${approval.basis.reference}). ` +
        "Production still needs a second named approver.",
    );
  }
  lines.push(`# Record for the operations log: ${JSON.stringify(approvalRecord(approval, projectId, commands))}`);
  return lines;
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
 * Prints the plan with its approval, and with --execute asks for the project identifier at a
 * terminal and runs the commands one after another, stopping at the first that fails. Nothing
 * runs without an approval.
 * @param {string} projectId
 * @param {readonly PlannedCommand[]} commands
 * @param {Set<string>} flags
 * @param {Approval | null} approval
 */
export async function carryOut(projectId, commands, flags, approval) {
  printPlan(commands);
  for (const line of approvalLines(approval, projectId, commands)) console.log(line);
  console.log("");
  if (!flags.has("execute")) {
    console.log("Printed only. Nothing has been run. Add --execute to run these commands after a confirmation.");
    return 0;
  }
  if (approval === null)
    throw new ProcedureRefusal("Refusing: --execute needs a recorded approval. Nothing has been run.");
  if (
    approval.environment === "production" &&
    approval.token !== approvalToken(approval.approver, projectId, commands)
  ) {
    throw new ProcedureRefusal(
      "Refusing: production needs the token that the approver printed for this exact plan with --approve, " +
        "given with --approval-token. Nothing has been run.",
    );
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
 * The approval that the options state: required to run, and printed with the plan whenever it is given.
 * @param {"staging" | "production"} environment
 * @param {{ options: Map<string, string>, flags: Set<string> }} parsed
 * @returns {Approval | null}
 */
export function approvalOf(environment, parsed) {
  const stated = parsed.options.has("operator") || parsed.options.has("approver");
  return stated || parsed.flags.has("execute") ? requireApproval(environment, parsed.options) : null;
}

/**
 * What the approver's own run with `--approve` prints: the token of the plan, for the operator to
 * pass with `--approval-token`. It runs nothing and needs no operator.
 * @param {"staging" | "production"} environment
 * @param {Map<string, string>} options
 * @param {string} projectId
 * @param {readonly PlannedCommand[]} commands
 */
export function approveLines(environment, options, projectId, commands) {
  const approver = personNamed(options, "approver");
  if (environment === "production") requireListed(approver, approversOf(environment));
  printPlan(commands);
  return [
    `# Approved by ${approver} for ${environment}. Give the operator this token for --approval-token:`,
    approvalToken(approver, projectId, commands),
  ];
}

/**
 * The main of a procedure script.
 * @param {(parsed: { options: Map<string, string>, flags: Set<string> }) => { environment: "staging" | "production", projectId: string, commands: PlannedCommand[] }} plan
 */
export async function runProcedure(plan) {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    const { environment, projectId, commands } = plan(parsed);
    if (parsed.flags.has("approve")) {
      for (const line of approveLines(environment, parsed.options, projectId, commands)) console.log(line);
      process.exitCode = 0;
      return;
    }
    process.exitCode = await carryOut(projectId, commands, parsed.flags, approvalOf(environment, parsed));
  } catch (error) {
    if (error instanceof ProcedureRefusal) {
      console.error(error.message);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
