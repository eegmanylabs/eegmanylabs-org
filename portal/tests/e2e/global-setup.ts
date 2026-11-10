import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { webOutputDirectory } from "../../scripts/paths.mjs";
import { clearAuth, clearFirestore, PORTAL_ROOT, PORTS } from "../support/emulators";

/**
 * Starts every end-to-end run from empty emulators with the synthetic demonstration world of
 * `seed:demo`, and checks that there is a build to test. The command runs as an operator runs
 * it, with the emulator variables of this run, and refuses any other target.
 */
export default async function globalSetup(): Promise<void> {
  const build = webOutputDirectory("emulator", PORTS.base);
  if (!existsSync(path.join(build, "index.html"))) {
    throw new Error(
      `There is no build in ${build}. Run "npm run build", or use "npm run test:e2e", which builds first.`,
    );
  }
  await Promise.all([clearFirestore(), clearAuth()]);
  await promisify(execFile)("npm", ["run", "--silent", "-w", "@eegml/tools", "cli", "--", "seed:demo"], {
    cwd: PORTAL_ROOT,
    env: process.env,
  });
}
