#!/usr/bin/env node
// @ts-check
// The deployment of the back end of one environment: rules, indexes, Storage rules and
// functions. WRITTEN, NEVER RUN: nothing has been deployed from this repository, and the static
// files reach GitHub Pages only through the protected, manually started workflow that
// docs/SECURITY.md, section 8, proposes and a repository administrator has still to create.
//
//   node ops/deploy-plan.mjs --environment staging --project <id>
//   (add --execute to run the printed commands after typing the project identifier again)
//
// The order follows ops/README.md: the preflight first, then the rules and indexes before the
// functions that rely on them. Production is deployed only after the same commit has passed on
// staging, and only with the explicit approval of a programme administrator (R21.9).
import { fileURLToPath } from "node:url";
import { ENVIRONMENTS, projectRefusal } from "./environments.mjs";
import { ProcedureRefusal, requireProject, runProcedure } from "./procedure.mjs";

/**
 * @param {import("./environments.mjs").PortalEnvironment} environment
 * @param {string} projectId
 * @returns {import("./procedure.mjs").PlannedCommand[]}
 */
export function deployCommands(environment, projectId) {
  const refusal = projectRefusal(environment.name, projectId);
  if (refusal !== null) throw new ProcedureRefusal(`Refusing: ${refusal}`);
  if (projectId !== environment.projectId) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is not the ${environment.name} project of ops/environments.mjs.`,
    );
  }
  return [
    {
      program: "npm",
      purpose: "The preflight: every item must pass",
      args: ["run", "deploy:check", "--", "--environment", environment.name],
    },
    {
      program: "npm",
      purpose: "The full test suite on the emulators",
      args: ["test"],
    },
    {
      program: "firebase",
      purpose: "Rules, indexes and Storage rules, which the functions rely on",
      args: ["deploy", "--only", "firestore:rules,firestore:indexes,storage", "--project", projectId],
    },
    {
      program: "firebase",
      purpose: "The functions, all in europe-west2",
      args: ["deploy", "--only", "functions", "--project", projectId],
    },
    {
      program: "npm",
      purpose: `The static files for ${environment.siteOrigin}, which the protected Pages workflow publishes`,
      args: ["run", environment.name === "production" ? "build:production" : "build:staging"],
    },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runProcedure(({ options }) => {
    const name = options.get("environment");
    if (name !== "staging" && name !== "production")
      throw new ProcedureRefusal("Refusing: --environment is staging or production.");
    const projectId = requireProject(options);
    return { projectId, commands: deployCommands(ENVIRONMENTS[name], projectId) };
  });
}
