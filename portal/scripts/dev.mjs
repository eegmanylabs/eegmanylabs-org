#!/usr/bin/env node
// @ts-check
// Starts everything needed to work on the portal, and stops it all together:
//
//   - the functions bundler in watch mode, so the emulator always loads current code
//   - the Firebase emulators (Authentication, Firestore, Functions, Storage)
//   - the Vite development server
//
// All ports derive from PORTAL_PORT_BASE. Stop with Ctrl-C.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { PORTAL_ROOT } from "./paths.mjs";
import { LOCAL_HOST, portsFor, resolvePortBase } from "./ports.mjs";

const ports = portsFor(resolvePortBase());
const env = { ...process.env, PORTAL_PORT_BASE: String(ports.base) };
const node = process.execPath;

// The emulator needs a bundle to load before the watcher has produced its first one.
const firstBundle = spawnSync(node, ["bundle.mjs"], { cwd: path.join(PORTAL_ROOT, "functions"), stdio: "inherit" });
if (firstBundle.status !== 0) process.exit(firstBundle.status ?? 1);

/** @type {{ name: string, child: import("node:child_process").ChildProcess }[]} */
const running = [];
let stopping = false;

/** @param {number} code */
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const { child } of running) child.kill("SIGINT");
  // Give the emulators time to shut down cleanly, then leave with the first exit status.
  const waitUntil = Date.now() + 20_000;
  const timer = setInterval(() => {
    const alive = running.filter(({ child }) => child.exitCode === null && child.signalCode === null);
    if (alive.length === 0 || Date.now() > waitUntil) {
      for (const { child } of alive) child.kill("SIGKILL");
      clearInterval(timer);
      process.exit(code);
    }
  }, 100);
}

/**
 * @param {string} name
 * @param {string[]} args
 * @param {string} cwd
 */
function start(name, args, cwd) {
  // A process group of its own, so Ctrl-C reaches each child once, through stopAll.
  const child = spawn(node, args, { cwd, env, stdio: "inherit", detached: true });
  running.push({ name, child });
  child.on("exit", (code) => {
    if (!stopping) console.error(`dev: ${name} stopped, stopping the rest.`);
    stopAll(code ?? 1);
  });
}

start("functions bundler", ["bundle.mjs", "--watch"], path.join(PORTAL_ROOT, "functions"));
start("emulators", [path.join(PORTAL_ROOT, "scripts", "emulators.mjs"), "start"], PORTAL_ROOT);
start(
  "web server",
  [path.join(PORTAL_ROOT, "node_modules", "vite", "bin", "vite.js"), "--mode", "emulator"],
  path.join(PORTAL_ROOT, "web"),
);

console.log(`dev: the portal will be at http://${LOCAL_HOST}:${ports.dev}/ once the servers are up.`);
console.log("dev: sign-in links are printed in this terminal by the Authentication emulator.");

for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
  process.on(signal, () => stopAll(0));
}
