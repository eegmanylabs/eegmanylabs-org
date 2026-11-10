// @ts-check
// Locations inside the portal directory that scripts and test configuration agree on.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the portal directory. */
export const PORTAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Project identifier used with the Local Emulator Suite. Mirrors DEMO_PROJECT_ID in @eegml/shared. */
export const DEMO_PROJECT_ID = "demo-eegml";

/**
 * Directory for everything one run generates: emulator logs, test output. Keyed by the port
 * base, so two runs never write to the same place.
 * @param {number} base
 */
export function runDirectory(base) {
  return path.join(PORTAL_ROOT, ".run", String(base));
}

/**
 * Temporary directory handed to the Firebase tools for one run. It sits under the system
 * temporary directory because the functions emulator creates Unix sockets in it, and socket
 * paths have a short length limit.
 * @param {number} base
 */
export function runTemporaryDirectory(base) {
  return path.join(os.tmpdir(), `eegml-portal-${base}`);
}

/**
 * The Firebase configuration generated for one run. It has to sit in the portal directory
 * because the Firebase tools refuse rules and functions paths outside the configuration's folder.
 * @param {number} base
 */
export function firebaseConfigPath(base) {
  return path.join(PORTAL_ROOT, `firebase.run-${base}.json`);
}

/**
 * Output directory of a web build. Emulator builds have their ports compiled in, so their
 * directory is keyed by the port base.
 * @param {string} mode
 * @param {number} base
 */
export function webOutputDirectory(mode, base) {
  return path.join(PORTAL_ROOT, "web", "out", mode === "emulator" ? `emulator-${base}` : mode);
}
