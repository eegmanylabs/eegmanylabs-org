// The deployment preflight. Contacts no project and deploys nothing.
//
//   npm run deploy:check                      the production environment
//   npm run deploy:check -- --environment staging
//
// It starts the Firestore and Storage emulators to compile the rules, builds the web application
// in the environment's mode into a temporary directory with the configuration of the build's
// environment (web/.env.<mode>.local or the variables of the shell), reads what came out, prints
// a checklist and exits with 1 when any item fails. While ops/environments.mjs holds placeholders
// the first item fails, which is the truth: nothing is ready to deploy until an administrator has
// named the projects.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "vite";
import { ENVIRONMENTS } from "../ops/environments.mjs";
import { resolveBuildConfig } from "../web/config/build-config.ts";
import {
  type CheckResult,
  checkAppCheck,
  checkContentSecurityPolicy,
  checkEnvironmentSupplied,
  checkFunctionsHttps,
  checkIndexes,
  checkRegion,
  checkRulesCompile,
  checkSecretsDeclared,
  scanBundle,
} from "./deploy-checks.ts";
import { PORTAL_ROOT } from "./paths.mjs";
import { portsFor, resolvePortBase } from "./ports.mjs";

function environmentArgument(): "staging" | "production" {
  const args = process.argv.slice(2);
  if (args.length === 0) return "production";
  if (args.length === 2 && args[0] === "--environment" && (args[1] === "staging" || args[1] === "production")) {
    return args[1];
  }
  console.error("Usage: deploy:check [--environment staging|production]");
  process.exit(2);
}

async function main(): Promise<number> {
  const name = environmentArgument();
  const results: CheckResult[] = [checkEnvironmentSupplied(name)];

  const firestore = process.env.FIRESTORE_EMULATOR_HOST?.trim() ?? "";
  const storage = process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim() ?? "";
  results.push(
    firestore === "" || storage === ""
      ? {
          name: "The Firestore and Storage rules compile",
          passed: false,
          details: ["Run through `npm run deploy:check`, which starts the emulators."],
        }
      : await checkRulesCompile(
          { firestore, storage },
          {
            firestore: readFileSync(path.join(PORTAL_ROOT, "firestore.rules"), "utf8"),
            storage: readFileSync(path.join(PORTAL_ROOT, "storage.rules"), "utf8"),
          },
        ),
  );
  results.push(checkIndexes(), checkSecretsDeclared(), checkFunctionsHttps());

  // The build's configuration, as the build itself will resolve it. Emulator variables of this
  // process are left out: the emulators of the preflight are no setting of the build.
  const webDirectory = path.join(PORTAL_ROOT, "web");
  const env = loadEnv(name, webDirectory, ["VITE_", "PORTAL_PUBLIC_PATH"]);
  let indexHtml: string | null = null;
  const buildName = `A ${name} build succeeds with its own configuration`;
  try {
    const config = resolveBuildConfig(name, env, portsFor(resolvePortBase()));
    const intended = ENVIRONMENTS[name].projectId;
    results.push({
      name: `The build is made for the ${name} project`,
      passed: config.firebase.projectId === intended,
      details:
        config.firebase.projectId === intended ? [] : [`The build names another project than ops/environments.mjs.`],
    });
    const output = mkdtempSync(path.join(os.tmpdir(), "eegml-deploy-check-"));
    try {
      const buildEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/EMULATOR|^GCLOUD_PROJECT$/.test(key)),
      );
      const build = spawnSync(
        process.execPath,
        [path.join(PORTAL_ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--mode", name],
        { cwd: webDirectory, env: { ...buildEnvironment, PORTAL_WEB_OUT_DIR: output }, encoding: "utf8" },
      );
      if (build.status !== 0) {
        results.push({ name: buildName, passed: false, details: [build.stderr.slice(-500)] });
      } else {
        results.push({ name: buildName, passed: true, details: [] });
        indexHtml = readFileSync(path.join(output, "index.html"), "utf8");
        results.push(
          scanBundle(output, {
            apiKey: config.firebase.apiKey,
            projectId: config.firebase.projectId,
            appCheckSiteKey: config.appCheck?.siteKey ?? null,
          }),
          checkContentSecurityPolicy(indexHtml),
        );
        if (name === "production") results.push(checkAppCheck(indexHtml, config.appCheck?.siteKey ?? null));
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  } catch (error) {
    results.push({ name: buildName, passed: false, details: [error instanceof Error ? error.message : String(error)] });
  }
  results.push(checkRegion(indexHtml));

  console.log(`Deployment preflight for ${name}. No project was contacted and nothing was deployed.\n`);
  for (const item of results) {
    console.log(`${item.passed ? "[pass]" : "[FAIL]"} ${item.name}`);
    for (const detail of item.details) console.log(`         ${detail}`);
  }
  const failed = results.filter((item) => !item.passed).length;
  console.log(
    `\n${results.length - failed} of ${results.length} items pass.${failed > 0 ? " Not ready to deploy." : ""}`,
  );
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
