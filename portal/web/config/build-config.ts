// Decides, at build time, which Firebase project the web application talks to.
//
// | Mode         | Firebase project                  | Configuration comes from               |
// |--------------|-----------------------------------|----------------------------------------|
// | `emulator`   | The Local Emulator Suite          | PORTAL_PORT_BASE, nothing else         |
// | `staging`    | The staging project               | VITE_ variables (see web/.env.example) |
// | `production` | The production project            | VITE_ variables (see web/.env.example) |
//
// The result is compiled into the bundle as `__PORTAL_BUILD_CONFIG__` and read through
// src/app/config.ts.
import { LOCAL_HOST, type PortalPorts } from "../../scripts/ports.mjs";
// Relative imports with file extensions on purpose: Vite loads its configuration with Node,
// which resolves neither the workspace package's TypeScript entry point nor an import without
// an extension. The constants file has no imports of its own.
import { DEMO_PROJECT_ID, DEMO_PROJECT_PREFIX, FUNCTIONS_REGION } from "../../shared/src/constants.ts";
import { PORTAL_MODES, type PortalBuildConfig, type PortalMode } from "./types.ts";

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

export function resolveBuildConfig(mode: string, env: Environment, ports: PortalPorts): PortalBuildConfig {
  if (!PORTAL_MODES.includes(mode as PortalMode)) {
    throw new Error(
      `Unknown build mode "${mode}". Use --mode with one of: ${PORTAL_MODES.join(", ")}. ` +
        "The npm scripts in portal/web/package.json set it for you.",
    );
  }
  const googleSignIn = flag(env, "VITE_ENABLE_GOOGLE_SIGN_IN");

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
      googleSignIn,
    };
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
    googleSignIn,
  };
}
