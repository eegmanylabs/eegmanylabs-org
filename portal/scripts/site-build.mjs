#!/usr/bin/env node
// @ts-check
// The build command of the public website, for the staging verification of a publication
// (docs/INTEGRATIONS.md, section 6). The site is built with Syrinx, the one Python dependency in
// the repository's requirements.txt, exactly as its README asks of a maintainer. This script
// keeps a virtual environment of its own under `.run/site-venv`, which git ignores, and installs
// the pinned requirements there once; it never touches the repository's own files.
//
//   node scripts/site-build.mjs ensure    installs Syrinx where it is missing and prints the build command
//   node scripts/site-build.mjs command   prints the build command, or fails where Syrinx is missing
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PORTAL_ROOT } from "./paths.mjs";

const VENV = path.join(PORTAL_ROOT, ".run", "site-venv");
const SYRINX = path.join(VENV, "bin", "syrinx");
const REQUIREMENTS = path.resolve(PORTAL_ROOT, "..", "requirements.txt");

/** The command that builds the staging site in the current directory, as the README gives it. */
export function siteBuildCommand() {
  return `${SYRINX} -c -e staging .`;
}

/** Whether the build command can run. */
export function siteBuilderInstalled() {
  return existsSync(SYRINX);
}

/** @param {string} program @param {string[]} args */
function run(program, args) {
  const result = spawnSync(program, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} failed.`);
}

export function ensureSiteBuilder() {
  if (siteBuilderInstalled()) return siteBuildCommand();
  run("python3", ["-m", "venv", VENV]);
  run(path.join(VENV, "bin", "python"), ["-m", "pip", "install", "--quiet", "-r", REQUIREMENTS]);
  if (!siteBuilderInstalled()) throw new Error("Syrinx was not installed.");
  return siteBuildCommand();
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  const [command] = process.argv.slice(2);
  if (command === "ensure") console.log(ensureSiteBuilder());
  else if (command === "command") {
    if (!siteBuilderInstalled()) {
      console.error("site-build: Syrinx is not installed. Run `node scripts/site-build.mjs ensure` first.");
      process.exitCode = 2;
    } else console.log(siteBuildCommand());
  } else {
    console.error("Usage: site-build.mjs ensure | command");
    process.exitCode = 2;
  }
}
