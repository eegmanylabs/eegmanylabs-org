#!/usr/bin/env node
// @ts-check
// Starts the Firebase Local Emulator Suite for one port base.
//
//   node scripts/emulators.mjs start  [--only auth,firestore]      run until interrupted
//   node scripts/emulators.mjs exec   [--only auth,firestore] <npm script>
//                                                                   start, run the script, stop
//   node scripts/emulators.mjs run    <command> [arguments...]     run a command with the
//                                                                   emulator addresses in its
//                                                                   environment, start nothing
//   node scripts/emulators.mjs status                               show which ports are in use
//
// Each run gets its own generated Firebase configuration, its own log directory and its own
// temporary directory, all keyed by PORTAL_PORT_BASE, so runs with different bases do not
// interfere with one another.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { writeFirebaseConfig } from "./firebase-config.mjs";
import { DEMO_PROJECT_ID, PORTAL_ROOT, runDirectory, runTemporaryDirectory } from "./paths.mjs";
import { emulatorEnvironment, LOCAL_HOST, portsFor, resolvePortBase } from "./ports.mjs";

/** Emulators the portal uses, and the ports each one needs to be free. */
const EMULATOR_PORTS = /** @type {const} */ ({
  auth: ["auth"],
  firestore: ["firestore", "firestoreWebsocket"],
  functions: ["functions", "eventarc", "tasks"],
  storage: ["storage"],
});
const ALWAYS_PORTS = /** @type {const} */ (["hub", "logging"]);

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
 * Splits "--only a,b" off the front of the arguments.
 * @param {string[]} args
 * @returns {{ only: EmulatorName[], rest: string[] }}
 */
function parseOnly(args) {
  const all = /** @type {EmulatorName[]} */ (Object.keys(EMULATOR_PORTS));
  if (args[0] !== "--only") return { only: all, rest: args };
  const names = (args[1] ?? "").split(",").filter(Boolean);
  if (names.length === 0) fail("--only needs a comma-separated list of emulators.");
  for (const name of names) {
    if (!all.includes(/** @type {EmulatorName} */ (name))) {
      fail(`unknown emulator "${name}". Known emulators: ${all.join(", ")}.`);
    }
  }
  return { only: /** @type {EmulatorName[]} */ (names), rest: args.slice(2) };
}

/**
 * @param {import("./ports.mjs").PortalPorts} ports
 * @param {EmulatorName[]} only
 */
async function assertPortsFree(ports, only) {
  const names = [...ALWAYS_PORTS, ...only.flatMap((emulator) => EMULATOR_PORTS[emulator])];
  const busy = [];
  for (const name of names) {
    if (!(await portIsFree(ports[name]))) busy.push(`${ports[name]} (${name})`);
  }
  if (busy.length > 0) {
    fail(
      `port ${busy.join(", ")} is already in use. Another portal run is probably using ` +
        `PORTAL_PORT_BASE=${ports.base}. Stop it, or choose another base, for example ` +
        `PORTAL_PORT_BASE=${ports.base + 200}.`,
    );
  }
}

/**
 * Runs a child process, passes termination signals on to it once, and exits with its status.
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} options
 */
function runToCompletion(command, args, options) {
  // A process group of its own: Ctrl-C in a terminal then reaches the child once, through the
  // handler below, and not a second time directly from the terminal.
  const child = spawn(command, args, { stdio: "inherit", detached: true, ...options });
  for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
    process.on(signal, () => child.kill("SIGINT"));
  }
  child.on("error", (error) => fail(`could not start ${command}: ${error.message}`));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

/**
 * @param {"emulators:start" | "emulators:exec"} firebaseCommand
 * @param {EmulatorName[]} only
 * @param {string[]} extra
 */
async function runFirebase(firebaseCommand, only, extra) {
  const base = resolvePortBase();
  const ports = portsFor(base);
  await assertPortsFree(ports, only);

  const config = writeFirebaseConfig(base);
  const logs = path.join(runDirectory(base), "emulator-logs");
  const temporary = runTemporaryDirectory(base);
  mkdirSync(logs, { recursive: true });
  mkdirSync(temporary, { recursive: true });

  const args = [firebaseCommand, "--project", DEMO_PROJECT_ID, "--config", config, "--only", only.join(","), ...extra];
  // The Firebase tools write their debug logs to the working directory and their locator and
  // socket files to the temporary directory, so both are specific to this run.
  runToCompletion(path.join(PORTAL_ROOT, "scripts", "fb.sh"), args, {
    cwd: logs,
    env: { ...process.env, PORTAL_PORT_BASE: String(base), TMPDIR: temporary },
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "start": {
      const { only, rest } = parseOnly(args);
      if (rest.length > 0) fail(`unexpected argument "${rest[0]}".`);
      await runFirebase("emulators:start", only, []);
      return;
    }
    case "exec": {
      const { only, rest } = parseOnly(args);
      const [script, ...more] = rest;
      if (!script || more.length > 0 || !/^[\w:.-]+$/.test(script)) {
        fail("exec needs exactly one npm script name, for example: exec emulated:rules");
      }
      // The emulators run the script from their log directory, so name the portal explicitly.
      await runFirebase("emulators:exec", only, [`npm --prefix "${PORTAL_ROOT}" run ${script}`]);
      return;
    }
    case "run": {
      const [program, ...programArgs] = args;
      if (!program) fail("run needs a command.");
      const ports = portsFor(resolvePortBase());
      runToCompletion(program, programArgs, {
        cwd: PORTAL_ROOT,
        env: { ...process.env, ...emulatorEnvironment(ports, DEMO_PROJECT_ID) },
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
