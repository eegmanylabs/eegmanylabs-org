#!/usr/bin/env node
// @ts-check
// Starts the Firebase Local Emulator Suite for one port base.
//
//   node scripts/emulators.mjs start  [--only auth,firestore]      run until interrupted
//   node scripts/emulators.mjs exec   [--only auth,firestore] [--web] [--import <dir>]
//                                     [--export-on-exit <dir>] <npm script>
//                                                                   start, run the script, stop.
//                                                                   --web says that the script
//                                                                   starts the preview server.
//                                                                   --import starts from an
//                                                                   export, --export-on-exit
//                                                                   exports when the script ends
//   node scripts/emulators.mjs run    <command> [arguments...]     run a command with the
//                                                                   emulator addresses in its
//                                                                   environment, start nothing
//   node scripts/emulators.mjs status                               show which ports are in use
//
// Each run gets its own generated Firebase configuration, its own log directory and its own
// temporary directory, all keyed by PORTAL_PORT_BASE, so runs with different bases do not
// interfere with one another. The configuration and the temporary directory are removed when
// the run ends. The log directory stays, because it holds what a failed run leaves to read.
//
// A run is stopped as a whole: an interrupt reaches the emulators, the script and everything
// the script started (see process-group.mjs).
import { mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { writeFirebaseConfig } from "./firebase-config.mjs";
import { DEMO_PROJECT_ID, PORTAL_ROOT, runDirectory, runTemporaryDirectory } from "./paths.mjs";
import { emulatorEnvironment, LOCAL_HOST, nearestPortBases, portsFor, resolvePortBase } from "./ports.mjs";
import { runToCompletion } from "./process-group.mjs";

/** Emulators the portal uses, and the ports each one needs to be free. */
const EMULATOR_PORTS = /** @type {const} */ ({
  auth: ["auth"],
  firestore: ["firestore", "firestoreWebsocket"],
  functions: ["functions", "eventarc", "tasks"],
  storage: ["storage"],
});
const ALWAYS_PORTS = /** @type {const} */ (["hub", "logging"]);
/** Ports of the servers that the end-to-end tests start beside the emulators. */
const WEB_PORTS = /** @type {const} */ (["preview", "secondOrigin"]);

/** @typedef {keyof typeof EMULATOR_PORTS} EmulatorName */

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`emulators: ${message}`);
  process.exit(2);
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, LOCAL_HOST, () => probe.close(() => resolve(true)));
  });
}

/**
 * An absolute directory for --import or --export-on-exit. It must lie in a run's directory or
 * in the temporary directory, so that an export never lands among the sources.
 * @param {string} option
 * @param {string | undefined} value
 * @returns {string}
 */
function stateDirectory(option, value) {
  if (!value || !path.isAbsolute(value)) fail(`${option} needs an absolute directory.`);
  const resolved = path.resolve(value);
  if (!resolved.split(path.sep).includes(".run") && !resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    fail(`${option} accepts a directory below a run's directory (.run) or the temporary directory only.`);
  }
  return resolved;
}

/**
 * Splits "--only a,b", "--web", "--import <dir>" and "--export-on-exit <dir>" off the front of the arguments.
 * @param {string[]} args
 * @returns {{ only: EmulatorName[], web: boolean, state: string[], rest: string[] }}
 */
function parseOptions(args) {
  const all = /** @type {EmulatorName[]} */ (Object.keys(EMULATOR_PORTS));
  let only = all;
  let web = false;
  /** @type {string[]} */
  const state = [];
  let rest = args;
  for (;;) {
    if (rest[0] === "--import" || rest[0] === "--export-on-exit") {
      state.push(`${rest[0]}=${stateDirectory(rest[0], rest[1])}`);
      rest = rest.slice(2);
    } else if (rest[0] === "--web") {
      web = true;
      rest = rest.slice(1);
    } else if (rest[0] === "--only") {
      const names = (rest[1] ?? "").split(",").filter(Boolean);
      if (names.length === 0) fail("--only needs a comma-separated list of emulators.");
      for (const name of names) {
        if (!all.includes(/** @type {EmulatorName} */ (name))) {
          fail(`unknown emulator "${name}". Known emulators: ${all.join(", ")}.`);
        }
      }
      only = /** @type {EmulatorName[]} */ (names);
      rest = rest.slice(2);
    } else {
      return { only, web, state, rest };
    }
  }
}

/**
 * Fails at once, naming the ports, when a port this run needs is taken.
 * @param {import("./ports.mjs").PortalPorts} ports
 * @param {EmulatorName[]} only
 * @param {boolean} web Whether the run also starts the preview server.
 */
async function assertPortsFree(ports, only, web) {
  const names = [...ALWAYS_PORTS, ...only.flatMap((emulator) => EMULATOR_PORTS[emulator]), ...(web ? WEB_PORTS : [])];
  const busy = [];
  for (const name of names) {
    if (!(await portIsFree(ports[name]))) busy.push(`${ports[name]} (${name})`);
  }
  if (busy.length > 0) {
    fail(
      `${busy.length === 1 ? "port" : "ports"} ${busy.join(", ")} ${busy.length === 1 ? "is" : "are"} already in use. ` +
        "Another portal run is probably using " +
        `PORTAL_PORT_BASE=${ports.base}. Stop it, or choose another base, for example ` +
        `PORTAL_PORT_BASE=${nearestPortBases(ports.base + 100)[0]}.`,
    );
  }
}

/**
 * @param {"emulators:start" | "emulators:exec"} firebaseCommand
 * @param {EmulatorName[]} only
 * @param {boolean} web
 * @param {string[]} extra
 */
async function runFirebase(firebaseCommand, only, web, extra) {
  const base = resolvePortBase();
  const ports = portsFor(base);
  await assertPortsFree(ports, only, web);

  const config = writeFirebaseConfig(base);
  const logs = path.join(runDirectory(base), "emulator-logs");
  const temporary = runTemporaryDirectory(base);
  mkdirSync(logs, { recursive: true });
  mkdirSync(temporary, { recursive: true });

  const args = [firebaseCommand, "--project", DEMO_PROJECT_ID, "--config", config, "--only", only.join(","), ...extra];
  // The Firebase tools write their debug logs to the working directory and their locator and
  // socket files to the temporary directory, so both are specific to this run.
  runToCompletion(path.join(PORTAL_ROOT, "scripts", "fb.sh"), args, {
    spawnOptions: {
      cwd: logs,
      // The functions emulator discovers the functions by loading the bundle in a process of its
      // own, at start and whenever the tests switch the triggers on again, and gives up after
      // ten seconds. On a loaded machine that load can take longer, and a discovery that gives up
      // leaves every trigger off while the hub reports success, so the limit is raised.
      env: {
        ...process.env,
        PORTAL_PORT_BASE: String(base),
        TMPDIR: temporary,
        // The fake of the website repository starts from the committed data files of the public
        // site, which it reads and never changes (docs/INTEGRATIONS.md, section 6).
        EEGML_WEBSITE_ROOT: path.resolve(PORTAL_ROOT, ".."),
        FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT ?? "60",
      },
    },
    // Runs when nothing of this run is left: what remains would otherwise look like a run in progress.
    cleanup() {
      rmSync(config, { force: true });
      rmSync(temporary, { recursive: true, force: true });
    },
    onStartFailure: (error) => console.error(`emulators: could not start the Firebase tools: ${error.message}`),
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "start": {
      const { only, web, state, rest } = parseOptions(args);
      if (web) fail("--web belongs to exec: start runs the emulators and nothing else.");
      if (state.length > 0) fail("--import and --export-on-exit belong to exec.");
      if (rest.length > 0) fail(`unexpected argument "${rest[0]}".`);
      await runFirebase("emulators:start", only, false, []);
      return;
    }
    case "exec": {
      const { only, web, state, rest } = parseOptions(args);
      const [script, ...more] = rest;
      if (!script || more.length > 0 || !/^[\w:.-]+$/.test(script)) {
        fail("exec needs exactly one npm script name, for example: exec emulated:rules");
      }
      // The emulators run the script from their log directory, so name the portal explicitly.
      await runFirebase("emulators:exec", only, web, [...state, `npm --prefix "${PORTAL_ROOT}" run ${script}`]);
      return;
    }
    case "run": {
      const [program, ...programArgs] = args;
      if (!program) fail("run needs a command.");
      const ports = portsFor(resolvePortBase());
      runToCompletion(program, programArgs, {
        spawnOptions: {
          cwd: PORTAL_ROOT,
          env: { ...process.env, ...emulatorEnvironment(ports, DEMO_PROJECT_ID) },
        },
        onStartFailure: (error) => console.error(`emulators: could not start ${program}: ${error.message}`),
      });
      return;
    }
    case "status": {
      const ports = portsFor(resolvePortBase());
      for (const [name, port] of Object.entries(ports)) {
        if (name === "base") continue;
        console.log(`${String(port).padEnd(6)} ${name.padEnd(20)} ${(await portIsFree(port)) ? "free" : "in use"}`);
      }
      return;
    }
    default:
      fail("expected one of: start, exec, run, status.");
  }
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
