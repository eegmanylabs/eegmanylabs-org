#!/usr/bin/env node
// @ts-check
// Prints the commands that create the service accounts of ops/service-accounts.mjs with exactly
// the roles it specifies. WRITTEN, NEVER RUN: an administrator reviews the output and runs it.
// The flags follow the vendor documentation of November 2026 and are unverified.
//
//   node ops/iam-plan.mjs --environment production --project <id> --project-number <number>
//     --deployer user:<address> [--integrations github,storage,google,osf,mail]
//   (add --execute to run them after typing the project identifier again)
//
// It creates the secrets it binds, in europe-west2 alone, before binding them, and only those of
// the integrations named; creating an account or a secret that exists already is skipped, so an
// interrupted run can be run again. A secret's value is added by hand afterwards.
import { fileURLToPath } from "node:url";
import { ENVIRONMENTS, projectRefusal, REGION } from "./environments.mjs";
import { ProcedureRefusal, requireProject, requireSupplied, runProcedure } from "./procedure.mjs";
import { SERVICE_ACCOUNTS } from "./service-accounts.mjs";

/** The domain of the Compute Engine default account, which no function of the portal runs as. */
const DEFAULT_COMPUTE_DOMAIN = "developer.gserviceaccount.com";

/** The integrations whose secrets an administrator may ask to have created and bound. */
export const INTEGRATIONS = Object.freeze(["github", "storage", "google", "osf", "mail"]);

/**
 * @param {import("./environments.mjs").PortalEnvironment} environment
 * @param {{ projectId: string, projectNumber: string, deployer: string, integrations: readonly string[] }} request
 * @returns {import("./procedure.mjs").PlannedCommand[]}
 */
export function iamCommands(environment, request) {
  const { projectId, projectNumber, deployer, integrations } = request;
  const refusal = projectRefusal(environment.name, projectId);
  if (refusal !== null) throw new ProcedureRefusal(`Refusing: ${refusal}`);
  if (projectId !== environment.projectId) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is not the ${environment.name} project of ops/environments.mjs.`,
    );
  }
  if (!/^\d{6,20}$/.test(projectNumber)) {
    throw new ProcedureRefusal("Refusing: --project-number is the number of the project.");
  }
  if (!/^(user|group):[^\s@]+@[^\s@]+$/.test(deployer)) {
    throw new ProcedureRefusal(
      "Refusing: --deployer names the person or group who deploys, as user:<address> or group:<address>.",
    );
  }
  const unknown = integrations.filter((name) => !INTEGRATIONS.includes(name));
  if (unknown.length > 0) {
    throw new ProcedureRefusal(`Refusing: --integrations takes ${INTEGRATIONS.join(", ")}; not ${unknown.join(", ")}.`);
  }
  const project = `--project=${projectId}`;
  /** @param {string} id */
  const email = (id) => `${id}@${projectId}.iam.gserviceaccount.com`;
  const runtime = email(SERVICE_ACCOUNTS.runtime.id);
  const files = `gs://${requireSupplied("the Storage bucket", environment.storageBucket)}`;
  /** @type {import("./procedure.mjs").PlannedCommand[]} */
  const commands = [
    {
      program: "gcloud",
      purpose: "The services the functions and their secrets use",
      args: ["services", "enable", "secretmanager.googleapis.com", "iam.googleapis.com", "run.googleapis.com", project],
    },
  ];
  const active = Object.values(SERVICE_ACCOUNTS).filter(
    (account) => account.integration === "always" || integrations.includes(account.integration),
  );
  // Secrets first, so that every binding below names a secret that exists.
  for (const account of active) {
    for (const secret of account.secrets) {
      commands.push({
        program: "gcloud",
        purpose: `The secret ${secret}, kept in ${REGION} alone. Its value is added by hand afterwards`,
        args: ["secrets", "create", secret, "--replication-policy=user-managed", `--locations=${REGION}`, project],
        unlessSucceeds: { program: "gcloud", args: ["secrets", "describe", secret, project] },
      });
    }
  }
  for (const account of active) {
    commands.push({
      program: "gcloud",
      purpose: `${account.displayName}: ${account.purpose}`,
      args: ["iam", "service-accounts", "create", account.id, project, `--display-name=${account.displayName}`],
      unlessSucceeds: { program: "gcloud", args: ["iam", "service-accounts", "describe", email(account.id), project] },
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
    for (const role of account.storageBucketRoles) {
      commands.push({
        program: "gcloud",
        purpose: `${account.displayName} needs ${role} on the bucket of the files of pages, and on no other bucket`,
        args: [
          "storage",
          "buckets",
          "add-iam-policy-binding",
          files,
          `--member=serviceAccount:${email(account.id)}`,
          `--role=${role}`,
        ],
      });
    }
    for (const secret of account.secrets) {
      // Every function runs as the runtime account, so it is the runtime that reads the secret.
      commands.push({
        program: "gcloud",
        purpose: `The functions read the secret ${secret} and no other secret of this integration`,
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
  if (integrations.includes("google")) {
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
  }
  commands.push(
    {
      program: "gcloud",
      purpose: "The person who deploys may make the functions run as the runtime account, and nobody else may",
      args: [
        "iam",
        "service-accounts",
        "add-iam-policy-binding",
        runtime,
        project,
        `--member=${deployer}`,
        "--role=roles/iam.serviceAccountUser",
      ],
    },
    {
      program: "gcloud",
      purpose:
        "Take the editor role from the Compute Engine default account, which no function runs as. Where the organisation policy iam.automaticIamGrantsForDefaultServiceAccounts is enforced it never had it",
      args: [
        "projects",
        "remove-iam-policy-binding",
        projectId,
        `--member=serviceAccount:${projectNumber}-compute@${DEFAULT_COMPUTE_DOMAIN}`,
        "--role=roles/editor",
        "--condition=None",
      ],
      allowFailure: "the default account holds no editor role, which is the state this step asks for",
    },
  );
  return commands;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runProcedure(({ options }) => {
    const name = options.get("environment");
    if (name !== "staging" && name !== "production")
      throw new ProcedureRefusal("Refusing: --environment is staging or production.");
    const projectId = requireProject(options);
    const integrations = (options.get("integrations") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return {
      environment: name,
      projectId,
      commands: iamCommands(ENVIRONMENTS[name], {
        projectId,
        projectNumber: options.get("project-number") ?? "",
        deployer: options.get("deployer") ?? "",
        integrations,
      }),
    };
  });
}
