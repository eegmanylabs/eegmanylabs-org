import { existsSync } from "node:fs";
import path from "node:path";
import { webOutputDirectory } from "../../scripts/paths.mjs";
import { clearAuth, clearFirestore, PORTS } from "../support/emulators";

/** Starts every end-to-end run from empty emulators and checks that there is a build to test. */
export default async function globalSetup(): Promise<void> {
  const build = webOutputDirectory("emulator", PORTS.base);
  if (!existsSync(path.join(build, "index.html"))) {
    throw new Error(
      `There is no build in ${build}. Run "npm run build", or use "npm run test:e2e", which builds first.`,
    );
  }
  await Promise.all([clearFirestore(), clearAuth()]);
}
