// Checks that the static files about to reach Pages are the ones the preflight scanned: the same
// files with the same SHA-256 as the list `npm run deploy:check:<environment>` wrote beside them.
// A build made later, from another commit or with other variables, fails here. Contacts nothing.
//
//   npm run deploy:artefact:verify -- --environment staging|production [--dist <directory>]
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { artefactDifferences } from "./deploy-checks.ts";
import { PORTAL_ROOT, webOutputDirectory } from "./paths.mjs";

function main(args: readonly string[]): number {
  let environment: string | null = null;
  let dist: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const [name, value] = [args[index], args[index + 1]];
    if (name === "--environment" && (value === "staging" || value === "production")) environment = value;
    else if (name === "--dist" && value !== undefined) dist = path.resolve(PORTAL_ROOT, value);
    else environment = null;
  }
  if (environment === null) {
    console.error("Usage: deploy:artefact:verify -- --environment staging|production [--dist <directory>]");
    return 2;
  }
  const directory = dist ?? webOutputDirectory(environment, 0);
  const manifestFile = `${directory.replace(/[\\/]+$/, "")}.sha256.json`;
  if (process.env.PORTAL_EXEC_DRY_RUN === "1") {
    console.log(`deploy:artefact:verify accepts its arguments: ${environment}.`);
    return 0;
  }
  if (!existsSync(manifestFile) || !existsSync(directory)) {
    console.error(
      `No passed preflight for ${path.relative(PORTAL_ROOT, directory)}. Run npm run deploy:check:${environment}.`,
    );
    return 1;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    environment?: string;
    files: Record<string, string>;
  };
  const differences = [
    ...(manifest.environment === environment ? [] : ["The preflight was run for another environment."]),
    ...artefactDifferences(manifest, directory),
  ];
  for (const difference of differences) console.error(difference);
  console.log(
    differences.length === 0
      ? `The ${Object.keys(manifest.files).length} files of ${path.relative(PORTAL_ROOT, directory)} are the ones the preflight scanned.`
      : "Not the build the preflight scanned. Publish nothing; run the preflight again.",
  );
  return differences.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
