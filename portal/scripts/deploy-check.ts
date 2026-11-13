// The deployment preflight. Contacts no project and deploys nothing.
//
//   npm run deploy:check:staging    [-- --dist <directory>]
//   npm run deploy:check:production [-- --dist <directory>]
//
// It starts the Firestore and Storage emulators to compile the rules, builds the web application
// in the environment's mode into the directory that is published (web/out/<environment>, or the
// one --dist names) with the configuration of the build's environment (web/.env.<mode>.local or
// the variables of the shell), scans every file of it, and writes the SHA-256 of every file to
// <directory>.sha256.json beside it, so that `npm run deploy:artefact:verify` can show that what
// reaches Pages is what was scanned. It checks the deployment configuration, the package of the
// functions (`npm run functions:package` first), the service account the functions run as and
// their parameters for the project, prints a checklist and exits with 1 when any item fails.
// While ops/environments.mjs holds placeholders the first item fails, which is the truth:
// nothing is ready to deploy until an administrator has named the projects.
//
// With PORTAL_EXEC_DRY_RUN=1 it checks its arguments and stops, for the tests of the plan.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";
import { ENVIRONMENTS } from "../ops/environments.mjs";
import { resolveBuildConfig } from "../web/config/build-config.ts";
import {
  artefactManifest,
  type CheckResult,
  checkAppCheck,
  checkContentSecurityPolicy,
  checkDeployConfig,
  checkEnvironmentSupplied,
  checkFunctionsHttps,
  checkFunctionsPackage,
  checkFunctionsParameters,
  checkIndexes,
  checkRegion,
  checkRulesCompile,
  checkSecretsDeclared,
  checkServiceAccount,
  scanBundle,
} from "./deploy-checks.ts";
import { PORTAL_ROOT, webOutputDirectory } from "./paths.mjs";
import { portsFor, resolvePortBase } from "./ports.mjs";

const USAGE = "Usage: deploy:check:run --environment staging|production [--dist <directory>]";

/** The arguments, refused unless they are exactly the environment and, at most, the directory to publish. */
function preflightArguments(args: readonly string[]): { environment: "staging" | "production"; dist: string } {
  let environment: "staging" | "production" | null = null;
  let dist: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const [name, value] = [args[index], args[index + 1]];
    if (name === "--environment" && (value === "staging" || value === "production")) environment = value;
    else if (name === "--dist" && value !== undefined && !value.startsWith("--"))
      dist = path.resolve(PORTAL_ROOT, value);
    else throw new Error(USAGE);
  }
  if (environment === null) throw new Error(USAGE);
  return { environment, dist: dist ?? webOutputDirectory(environment, 0) };
}

/** Where the list of files and their SHA-256 is written: beside the directory, never in it. */
const manifestPathOf = (dist: string) => `${dist.replace(/[\\/]+$/, "")}.sha256.json`;

async function main(): Promise<number> {
  let parsed: ReturnType<typeof preflightArguments>;
  try {
    parsed = preflightArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const { environment: name, dist } = parsed;
  if (process.env.PORTAL_EXEC_DRY_RUN === "1") {
    console.log(`deploy:check accepts its arguments: ${name}, publishing ${path.relative(PORTAL_ROOT, dist)}.`);
    return 0;
  }
  const results: CheckResult[] = [checkEnvironmentSupplied(name)];

  const firestore = process.env.FIRESTORE_EMULATOR_HOST?.trim() ?? "";
  const storage = process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim() ?? "";
  results.push(
    firestore === "" || storage === ""
      ? {
          name: "The Firestore and Storage rules compile",
          passed: false,
          details: [`Run through \`npm run deploy:check:${name}\`, which starts the emulators.`],
        }
      : await checkRulesCompile(
          { firestore, storage },
          {
            firestore: readFileSync(path.join(PORTAL_ROOT, "firestore.rules"), "utf8"),
            storage: readFileSync(path.join(PORTAL_ROOT, "storage.rules"), "utf8"),
          },
        ),
  );
  results.push(
    checkIndexes(),
    checkSecretsDeclared(),
    checkFunctionsHttps(),
    checkDeployConfig(),
    checkFunctionsPackage(),
    checkServiceAccount(),
    checkFunctionsParameters(name),
  );

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
    rmSync(dist, { recursive: true, force: true });
    rmSync(manifestPathOf(dist), { force: true });
    mkdirSync(path.dirname(dist), { recursive: true });
    const buildEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/EMULATOR|^GCLOUD_PROJECT$/.test(key)),
    );
    const build = spawnSync(
      process.execPath,
      [path.join(PORTAL_ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--mode", name],
      { cwd: webDirectory, env: { ...buildEnvironment, PORTAL_WEB_OUT_DIR: dist }, encoding: "utf8" },
    );
    if (build.status !== 0) {
      results.push({ name: buildName, passed: false, details: [build.stderr.slice(-500)] });
    } else {
      results.push({ name: buildName, passed: true, details: [] });
      indexHtml = readFileSync(path.join(dist, "index.html"), "utf8");
      results.push(
        scanBundle(dist, {
          apiKey: config.firebase.apiKey,
          projectId: config.firebase.projectId,
          appCheckSiteKey: config.appCheck?.siteKey ?? null,
        }),
        checkContentSecurityPolicy(indexHtml),
        checkAppCheck(indexHtml, config.appCheck?.siteKey ?? null),
      );
    }
  } catch (error) {
    results.push({ name: buildName, passed: false, details: [error instanceof Error ? error.message : String(error)] });
  }
  results.push(checkRegion(indexHtml));

  console.log(`Deployment preflight for ${name}. No project was contacted and nothing was deployed.\n`);
  for (const item of results) {
    console.log(`${item.passed ? "[pass]" : "[FAIL]"} ${item.name}`);
    for (const detail of item.details) console.log(`         ${detail}`);
    for (const note of item.notes ?? []) console.log(`         Note: ${note}`);
  }
  const failed = results.filter((item) => !item.passed).length;
  if (failed === 0) {
    writeFileSync(
      manifestPathOf(dist),
      `${JSON.stringify({ environment: name, ...artefactManifest(dist) }, null, 2)}\n`,
    );
    console.log(`\nThe files to publish and their SHA-256 are in ${path.relative(PORTAL_ROOT, manifestPathOf(dist))}.`);
  }
  console.log(
    `\n${results.length - failed} of ${results.length} items pass.${failed > 0 ? " Not ready to deploy." : ""}`,
  );
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
