// @ts-check
// The single place where the portal's local ports are decided.
//
// Everything that listens on a port derives it from PORTAL_PORT_BASE (default 9100), so several
// working copies, agents or test suites can run side by side by choosing different bases.
// Emulators use base..base+99. The web servers use base+150 (preview), base+151 (development)
// and base+152 (a second origin for tests).
//
// A base is a multiple of 100. The web servers of one base therefore sit at offsets 50 to 52 of
// the next base's range, and no emulator uses those three offsets, so any two different bases
// have no port in common.

export const DEFAULT_PORT_BASE = 9100;

/** Every base is a multiple of this. */
export const PORT_BASE_STEP = 100;

/** Loopback only: nothing the portal starts locally is reachable from another machine. */
export const LOCAL_HOST = "127.0.0.1";

const OFFSETS = /** @type {const} */ ({
  functions: 1,
  eventarc: 29,
  hub: 40,
  logging: 48,
  tasks: 49,
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
const LOWEST_PORT_BASE = Math.ceil(1024 / PORT_BASE_STEP) * PORT_BASE_STEP;
const HIGHEST_PORT_BASE = Math.floor((65535 - HIGHEST_OFFSET) / PORT_BASE_STEP) * PORT_BASE_STEP;

/**
 * The valid bases closest to a number: the one at or below it and the one above it.
 * @param {number} value
 * @returns {[number, number]}
 */
export function nearestPortBases(value) {
  const clamp = (/** @type {number} */ base) => Math.min(HIGHEST_PORT_BASE, Math.max(LOWEST_PORT_BASE, base));
  const below = clamp(Math.floor(value / PORT_BASE_STEP) * PORT_BASE_STEP);
  const above = clamp(below + PORT_BASE_STEP);
  return above === below ? [clamp(below - PORT_BASE_STEP), below] : [below, above];
}

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
  if (!Number.isInteger(base) || base < LOWEST_PORT_BASE || base > HIGHEST_PORT_BASE) {
    throw new Error(
      `PORTAL_PORT_BASE must be a multiple of ${PORT_BASE_STEP} between ${LOWEST_PORT_BASE} and ` +
        `${HIGHEST_PORT_BASE}, but it is "${raw}".`,
    );
  }
  if (base % PORT_BASE_STEP !== 0) {
    const [below, above] = nearestPortBases(base);
    // Bases in between would put the web servers of one run on the emulator ports of another.
    throw new Error(
      `PORTAL_PORT_BASE must be a multiple of ${PORT_BASE_STEP}, but it is "${raw}". ` +
        `The nearest valid values are ${below} and ${above}.`,
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
