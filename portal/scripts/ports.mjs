// @ts-check
// The single place where the portal's local ports are decided.
//
// Everything that listens on a port derives it from PORTAL_PORT_BASE (default 9100), so several
// working copies, agents or test suites can run side by side by choosing different bases.
// Emulators use base..base+99. The web servers use base+150 (preview) and base+151 (development).

export const DEFAULT_PORT_BASE = 9100;

/** Loopback only: nothing the portal starts locally is reachable from another machine. */
export const LOCAL_HOST = "127.0.0.1";

const OFFSETS = /** @type {const} */ ({
  functions: 1,
  eventarc: 29,
  hub: 40,
  tasks: 49,
  logging: 50,
  firestore: 80,
  firestoreWebsocket: 81,
  storage: 97,
  auth: 99,
  preview: 150,
  dev: 151,
  // A second local origin for tests that need a page on "another site".
  secondOrigin: 152,
});

const HIGHEST_OFFSET = Math.max(...Object.values(OFFSETS));

/**
 * @typedef {{ readonly base: number } & { readonly [K in keyof typeof OFFSETS]: number }} PortalPorts
 */

/**
 * Reads and validates PORTAL_PORT_BASE.
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolvePortBase(env = process.env) {
  const raw = env.PORTAL_PORT_BASE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT_BASE;
  const base = Number(raw);
  if (!Number.isInteger(base) || base < 1024 || base + HIGHEST_OFFSET > 65535) {
    throw new Error(
      `PORTAL_PORT_BASE must be a whole number between 1024 and ${65535 - HIGHEST_OFFSET}, but it is "${raw}".`,
    );
  }
  return base;
}

/**
 * @param {number} [base]
 * @returns {PortalPorts}
 */
export function portsFor(base = resolvePortBase()) {
  /** @type {Record<string, number>} */
  const ports = { base };
  for (const [name, offset] of Object.entries(OFFSETS)) ports[name] = base + offset;
  return /** @type {PortalPorts} */ (ports);
}

/**
 * The environment variables the Firebase Admin SDK and the test helpers read to find the
 * emulators. `firebase emulators:exec` sets the same variables for the command it runs.
 * @param {PortalPorts} ports
 * @param {string} projectId
 * @returns {Record<string, string>}
 */
export function emulatorEnvironment(ports, projectId) {
  return {
    PORTAL_PORT_BASE: String(ports.base),
    GCLOUD_PROJECT: projectId,
    FIRESTORE_EMULATOR_HOST: `${LOCAL_HOST}:${ports.firestore}`,
    FIREBASE_AUTH_EMULATOR_HOST: `${LOCAL_HOST}:${ports.auth}`,
    FIREBASE_STORAGE_EMULATOR_HOST: `${LOCAL_HOST}:${ports.storage}`,
  };
}
