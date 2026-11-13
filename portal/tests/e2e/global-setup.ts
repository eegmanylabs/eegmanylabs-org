import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gitHubFakeStatePath } from "../../functions/src/integrations/github/fake";
import { resetFakeState } from "../../functions/src/integrations/google/fake/store";
import { mailFakeStatePath } from "../../functions/src/integrations/mail/fake";
import { storageFakeStatePath } from "../../functions/src/integrations/storage/fake";
import { webOutputDirectory } from "../../scripts/paths.mjs";
import { ensureSiteBuilder } from "../../scripts/site-build.mjs";
import { clearAuth, clearFirestore, PORTAL_ROOT, PORTS } from "../support/emulators";
import { drainTriggers, ensureTriggers } from "../support/triggers";

/**
 * Starts every end-to-end run from empty emulators with the synthetic demonstration world of
 * `seed:demo` and the fixtures of the Google Workspace fake, and checks that there is a build to test. The command runs as an operator runs
 * it, with the emulator variables of this run, and refuses any other target.
 *
 * The seed writes a few hundred documents, and each write starts the audit trigger and the
 * triggers of its collection. The first tests would otherwise run while the functions emulator
 * works through that backlog, starting a runtime for each trigger, and a callable function such
 * as the one that starts a session waits in the same queue: on a busy machine a page then waited
 * for its account for longer than a test allows. So the run starts only once the emulator is
 * idle: switching the triggers off waits for every piece of work it holds, which is its own
 * signal that the backlog, the deletions of the clear included, is done, and switching them on
 * again is confirmed by a sentinel (`tests/support/triggers.ts`).
 */
export default async function globalSetup(): Promise<void> {
  const build = webOutputDirectory("emulator", PORTS.base);
  if (!existsSync(path.join(build, "index.html"))) {
    throw new Error(
      `There is no build in ${build}. Run "npm run build", or use "npm run test:e2e", which builds first.`,
    );
  }
  // The seed writes with the triggers on, as it does for an operator.
  await Promise.all([clearFirestore(), clearAuth()]);
  await ensureTriggers("on");
  // The Google Workspace fake starts again from its synthetic fixtures, as the world does.
  resetFakeState();
  // So does the fake of the storage servers, the fake of the website repository, which starts
  // from the committed data files, and the fake mail sender.
  resetFakeState(storageFakeStatePath());
  resetFakeState(gitHubFakeStatePath());
  resetFakeState(mailFakeStatePath());
  // The staging build of a publication runs the site's own build command, Syrinx, which is
  // installed once beside the portal (scripts/site-build.mjs).
  ensureSiteBuilder();
  await promisify(execFile)("npm", ["run", "--silent", "-w", "@eegml/tools", "cli", "--", "seed:demo"], {
    cwd: PORTAL_ROOT,
    env: process.env,
  });
  await drainTriggers();
}
