// Runs the import command line as a person would run it: in a process of its own, against the
// emulators of the current port base. The tests that use it feed it synthetic input only.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";

const TSX = path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx");

export interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Everything the command printed, on either stream. */
  readonly output: string;
}

/** Runs `import <arguments>` with the emulator addresses in its environment and no credentials of any project. */
export function importCli(args: readonly string[]): CliResult {
  const result = spawnSync(TSX, ["src/cli.ts", "import", ...args], {
    cwd: path.join(PORTAL_ROOT, "tools"),
    env: {
      ...process.env,
      GCLOUD_PROJECT: undefined,
      GOOGLE_CLOUD_PROJECT: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      ...emulatorEnvironment(PORTS, PROJECT_ID),
    },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}\n${result.stderr}`,
  };
}
