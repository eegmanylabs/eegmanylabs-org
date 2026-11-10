// @ts-check
// Generates the Firebase configuration for one run from firebase.template.json.
//
// The template holds everything that is the same for every run (rules, indexes, the functions
// source). This script adds the emulator addresses, all derived from PORTAL_PORT_BASE.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { firebaseConfigPath, PORTAL_ROOT } from "./paths.mjs";
import { LOCAL_HOST, portsFor } from "./ports.mjs";

/**
 * @param {import("./ports.mjs").PortalPorts} ports
 * @returns {Record<string, unknown>}
 */
export function buildFirebaseConfig(ports) {
  const template = JSON.parse(readFileSync(path.join(PORTAL_ROOT, "firebase.template.json"), "utf8"));
  /** @param {number} port */
  const at = (port) => ({ host: LOCAL_HOST, port });
  return {
    ...template,
    emulators: {
      ...template.emulators,
      auth: at(ports.auth),
      firestore: { ...at(ports.firestore), websocketPort: ports.firestoreWebsocket },
      functions: at(ports.functions),
      storage: at(ports.storage),
      hub: at(ports.hub),
      logging: at(ports.logging),
      eventarc: at(ports.eventarc),
      tasks: at(ports.tasks),
      ui: { enabled: false },
    },
  };
}

/**
 * Writes the configuration for a port base and returns its path.
 * @param {number} base
 * @returns {string}
 */
export function writeFirebaseConfig(base) {
  const file = firebaseConfigPath(base);
  writeFileSync(file, `${JSON.stringify(buildFirebaseConfig(portsFor(base)), null, 2)}\n`);
  return file;
}
