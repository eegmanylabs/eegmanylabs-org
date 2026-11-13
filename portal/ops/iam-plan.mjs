#!/usr/bin/env node
// @ts-check
// Prints the commands that create the service accounts of ops/service-accounts.mjs with exactly
// the roles it specifies. WRITTEN, NEVER RUN: an administrator reviews the output and runs it.
// The flags follow the vendor documentation of November 2026 and are unverified.
//
//   node ops/iam-plan.mjs --environment production --project <id>
//   (add --execute to run them after typing the project identifier again)
import { fileURLToPath } from "node:url";
import { ENVIRONMENTS, projectRefusal } from "./environments.mjs";
import { ProcedureRefusal, requireProject, runProcedure } from "./procedure.mjs";
import { SERVICE_ACCOUNTS } from "./service-accounts.mjs";

/**
 * @param {import("./environments.mjs").PortalEnvironment} environment
 * @param {string} projectId
 * @returns {import("./procedure.mjs").PlannedCommand[]}
 */
export function iamCommands(environment, projectId) {
  const refusal = projectRefusal(environment.name, projectId);
  if (refusal !== null) throw new ProcedureRefusal(`Refusing: ${refusal}`);
  if (projectId !== environment.projectId) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is not the ${environment.name} project of ops/environments.mjs.`,
    );
  }
  const project = `--project=${projectId}`;
  /** @param {string} id */
  const email = (id) => `${id}@${projectId}.iam.gserviceaccount.com`;
  const runtime = email(SERVICE_ACCOUNTS.runtime.id);
  /** @type {import("./procedure.mjs").PlannedCommand[]} */
  const commands = [];
  for (const account of Object.values(SERVICE_ACCOUNTS)) {
    commands.push({
      program: "gcloud",
      purpose: `${account.displayName}: ${account.purpose}`,
      args: ["iam", "service-accounts", "create", account.id, project, `--display-name=${account.displayName}`],
    });
    for (const role of account.projectRoles) {
      commands.push({
        program: "gcloud",
        purpose: `${account.displayName} needs ${role}`,
        args: [
          "projects",
          "add-iam-policy-binding",
          projectId,
          `--member=serviceAccount:${email(account.id)}`,
          `--role=${role}`,
          "--condition=None",
        ],
      });
    }
    for (const secret of account.secrets) {
      commands.push({
        program: "gcloud",
        purpose: `${account.displayName} reads the secret ${secret} and no other (the runtime account too, until the functions run as their own accounts)`,
        args: [
          "secrets",
          "add-iam-policy-binding",
          secret,
          project,
          `--member=serviceAccount:${email(account.id)}`,
          "--role=roles/secretmanager.secretAccessor",
        ],
      });
      if (account.id !== SERVICE_ACCOUNTS.runtime.id) {
        commands.push({
          program: "gcloud",
          purpose: `Until then the runtime account reads ${secret} as well, secret by secret`,
          args: [
            "secrets",
            "add-iam-policy-binding",
            secret,
            project,
            `--member=serviceAccount:${runtime}`,
            "--role=roles/secretmanager.secretAccessor",
          ],
        });
      }
    }
  }
  commands.push({
    program: "gcloud",
    purpose: "The runtime obtains short-lived tokens for the Google Workspace account, which needs no key",
    args: [
      "iam",
      "service-accounts",
      "add-iam-policy-binding",
      email(SERVICE_ACCOUNTS.drive.id),
      project,
      `--member=serviceAccount:${runtime}`,
      "--role=roles/iam.serviceAccountTokenCreator",
    ],
  });
  return commands;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runProcedure(({ options }) => {
    const name = options.get("environment");
    if (name !== "staging" && name !== "production")
      throw new ProcedureRefusal("Refusing: --environment is staging or production.");
    const projectId = requireProject(options);
    return { projectId, commands: iamCommands(ENVIRONMENTS[name], projectId) };
  });
}
