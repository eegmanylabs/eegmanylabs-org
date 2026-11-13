#!/usr/bin/env node
// @ts-check
// Writes the package of the functions that a deployment uploads (firebase.deploy.json names
// it): the bundle from functions/out and a package.json that lists the two dependencies the
// platform installs, firebase-admin and firebase-functions, at the versions functions/package.json
// pins. The workspace's own package.json cannot be deployed: it names @eegml/shared, which is on
// no registry, and Cloud Build installs every dependency it names.
//
//   npm run functions:package
//
// The package goes to .run/deploy/functions, which git ignores. Nothing is deployed from here.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORTAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEPLOY_PACKAGE_DIRECTORY = path.join(PORTAL, ".run", "deploy", "functions");
/** The packages the bundle leaves external, which the platform installs. */
export const RUNTIME_DEPENDENCIES = ["firebase-admin", "firebase-functions"];

/**
 * The package.json of the deployed functions, from the workspace's.
 * @param {{ engines?: Record<string, string>, dependencies?: Record<string, string> }} workspace
 */
export function deployPackageJson(workspace) {
  /** @type {Record<string, string>} */
  const dependencies = {};
  for (const name of RUNTIME_DEPENDENCIES) {
    const version = workspace.dependencies?.[name];
    if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`functions/package.json must pin ${name} at an exact version.`);
    }
    dependencies[name] = version;
  }
  return {
    name: "eegml-portal-functions",
    version: "0.0.0",
    private: true,
    type: "module",
    main: "index.js",
    engines: { node: workspace.engines?.node ?? "22" },
    dependencies,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundle = path.join(PORTAL, "functions", "out", "index.js");
  if (!existsSync(bundle)) {
    console.error("functions:package: functions/out/index.js is missing. Build the functions first.");
    process.exit(1);
  }
  const workspace = JSON.parse(readFileSync(path.join(PORTAL, "functions", "package.json"), "utf8"));
  rmSync(DEPLOY_PACKAGE_DIRECTORY, { recursive: true, force: true });
  mkdirSync(DEPLOY_PACKAGE_DIRECTORY, { recursive: true });
  // The source map stays behind, and so does the comment that names it.
  const code = readFileSync(bundle, "utf8").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
  writeFileSync(path.join(DEPLOY_PACKAGE_DIRECTORY, "index.js"), code);
  writeFileSync(
    path.join(DEPLOY_PACKAGE_DIRECTORY, "package.json"),
    `${JSON.stringify(deployPackageJson(workspace), null, 2)}\n`,
  );
  console.log(`functions:package wrote ${path.relative(PORTAL, DEPLOY_PACKAGE_DIRECTORY)}.`);
}
