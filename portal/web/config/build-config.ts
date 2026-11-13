// Decides, at build time, which Firebase project the web application talks to.
//
// | Mode         | Firebase project                  | Configuration comes from               |
// |--------------|-----------------------------------|----------------------------------------|
// | `emulator`   | The Local Emulator Suite          | PORTAL_PORT_BASE, nothing else         |
// | `staging`    | The staging project               | VITE_ variables (see web/.env.example) |
// | `production` | The production project            | VITE_ variables (see web/.env.example) |
//
// The environments are kept apart here (D-017, ops/environments.mjs): a staging or production
// build refuses an emulator setting, a demonstration project and the project of the other
// environment, and a production build refuses to start without App Check.
//
// The result is compiled into the bundle as `__PORTAL_BUILD_CONFIG__` and read through
// src/app/config.ts.
import { ENVIRONMENTS, projectRefusal } from "../../ops/environments.mjs";
import { PREVIEW_MOUNT } from "../../scripts/paths.mjs";
import { LOCAL_HOST, type PortalPorts } from "../../scripts/ports.mjs";
// Relative imports with file extensions on purpose: Vite loads its configuration with Node,
// which resolves neither the workspace package's TypeScript entry point nor an import without
// an extension. The constants file has no imports of its own.
import { DEMO_PROJECT_ID, DEMO_PROJECT_PREFIX, FUNCTIONS_REGION } from "../../shared/src/constants.ts";
import { PORTAL_MODES, type PortalBuildConfig, type PortalMode, PRESENCE_MODES, type PresenceMode } from "./types.ts";

/** Variables a staging or production build cannot do without. */
export const REQUIRED_VARIABLES = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_APP_ID",
] as const;

type Environment = Record<string, string | undefined>;

function flag(env: Environment, name: string): boolean {
  const value = env[name]?.trim() ?? "";
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be "true" or "false", but it is "${value}".`);
}

/** How a page shows who else has it open: VITE_PRESENCE, "cursor" unless set. */
function presenceMode(env: Environment): PresenceMode {
  const value = env.VITE_PRESENCE?.trim() ?? "";
  if (value === "") return "cursor";
  if ((PRESENCE_MODES as readonly string[]).includes(value)) return value as PresenceMode;
  throw new Error(`VITE_PRESENCE must be one of ${PRESENCE_MODES.join(", ")}, but it is "${value}".`);
}

/**
 * The path the built files are published under, which the page for unknown addresses needs for
 * its link back to the portal. The application itself uses relative addresses and works at any
 * path.
 *
 * | Published at                                    | PORTAL_PUBLIC_PATH        |
 * |-------------------------------------------------|---------------------------|
 * | A domain of its own                             | `/`, which is the default |
 * | `https://<owner>.github.io/<repository>/`       | `/<repository>/`          |
 * | The preview server and the tests (emulator mode) | `/portal/`, set for you   |
 */
export function resolvePublicPath(mode: string, env: Environment): string {
  const given = env.PORTAL_PUBLIC_PATH?.trim() ?? "";
  const publicPath = given === "" ? (mode === "emulator" ? PREVIEW_MOUNT : "/") : given;
  // Segments of letters, digits, dots, hyphens and underscores, none of them "." or "..".
  if (!/^\/(?:(?!\.{1,2}\/)[\w.-]+\/)*$/.test(publicPath)) {
    throw new Error(
      `PORTAL_PUBLIC_PATH must start and end with a slash, for example "/" or "/portal/", but it is "${given}".`,
    );
  }
  return publicPath;
}

export function resolveBuildConfig(mode: string, env: Environment, ports: PortalPorts): PortalBuildConfig {
  if (!PORTAL_MODES.includes(mode as PortalMode)) {
    throw new Error(
      `Unknown build mode "${mode}". Use --mode with one of: ${PORTAL_MODES.join(", ")}. ` +
        "The npm scripts in portal/web/package.json set it for you.",
    );
  }
  const googleSignIn = flag(env, "VITE_ENABLE_GOOGLE_SIGN_IN");
  const presence = presenceMode(env);

  if (mode === "emulator") {
    return {
      mode,
      firebase: {
        apiKey: "fake-api-key",
        projectId: DEMO_PROJECT_ID,
        appId: "1:1:web:emulator",
        authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
        storageBucket: `${DEMO_PROJECT_ID}.appspot.com`,
      },
      emulators: {
        host: LOCAL_HOST,
        auth: ports.auth,
        firestore: ports.firestore,
        functions: ports.functions,
        storage: ports.storage,
      },
      functionsRegion: FUNCTIONS_REGION,
      appCheck: null,
      googleSignIn,
      presence,
    };
  }

  const emulatorSettings = Object.keys(env).filter(
    (name) => /EMULATOR/i.test(name) && (env[name]?.trim() ?? "") !== "",
  );
  if (emulatorSettings.length > 0) {
    throw new Error(
      `Cannot build the portal in "${mode}" mode while ${emulatorSettings.join(", ")} ${emulatorSettings.length === 1 ? "is" : "are"} set: ` +
        "emulator settings belong to the emulator mode alone.",
    );
  }

  const value = (name: string) => env[name]?.trim() ?? "";
  const missing = REQUIRED_VARIABLES.filter((name) => value(name) === "");
  if (missing.length > 0) {
    throw new Error(
      `Cannot build the portal in "${mode}" mode: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        `Copy portal/web/.env.example to portal/web/.env.${mode}.local and fill it in, ` +
        "or set the variables in the environment of the build.",
    );
  }
  const projectId = value("VITE_FIREBASE_PROJECT_ID");
  if (projectId.startsWith(DEMO_PROJECT_PREFIX)) {
    throw new Error(
      `Cannot build the portal in "${mode}" mode for the project "${projectId}": identifiers that start ` +
        `with "${DEMO_PROJECT_PREFIX}" only exist in the emulators. Use the emulator mode for those.`,
    );
  }
  const environment = mode as "staging" | "production";
  const refusal = projectRefusal(environment, projectId);
  if (refusal !== null) throw new Error(`Cannot build the portal in "${mode}" mode: ${refusal}`);
  for (const other of Object.values(ENVIRONMENTS).filter((candidate) => candidate.name !== environment)) {
    for (const name of ["VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_STORAGE_BUCKET"]) {
      if (value(name).toLowerCase().includes(other.projectId.toLowerCase())) {
        throw new Error(`Cannot build the portal in "${mode}" mode: ${name} names the project of ${other.name}.`);
      }
    }
  }
  const siteKey = value("VITE_APP_CHECK_SITE_KEY");
  if (mode === "production" && siteKey === "") {
    throw new Error(
      'Cannot build the portal in "production" mode: VITE_APP_CHECK_SITE_KEY is not set. ' +
        "A production build carries App Check with the reCAPTCHA Enterprise site key of the project.",
    );
  }
  if (siteKey !== "" && !/^[\w-]{20,100}$/.test(siteKey)) {
    throw new Error("VITE_APP_CHECK_SITE_KEY must be the public site key of reCAPTCHA Enterprise.");
  }
  const messagingSenderId = value("VITE_FIREBASE_MESSAGING_SENDER_ID");
  return {
    mode: mode as PortalMode,
    firebase: {
      apiKey: value("VITE_FIREBASE_API_KEY"),
      projectId,
      appId: value("VITE_FIREBASE_APP_ID"),
      authDomain: value("VITE_FIREBASE_AUTH_DOMAIN"),
      storageBucket: value("VITE_FIREBASE_STORAGE_BUCKET"),
      ...(messagingSenderId === "" ? {} : { messagingSenderId }),
    },
    emulators: null,
    functionsRegion: FUNCTIONS_REGION,
    appCheck: siteKey === "" ? null : { siteKey },
    googleSignIn,
    presence,
  };
}
