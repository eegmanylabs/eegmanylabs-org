// Decides which Firebase project a tool is allowed to touch.
import net from "node:net";
import { DEMO_PROJECT_ID, DEMO_PROJECT_PREFIX } from "@eegml/shared";

/** Raised when a tool declines to run. The message says what to do about it. */
export class ToolRefusal extends Error {
  override readonly name = "ToolRefusal";
}

export interface EmulatorTarget {
  readonly projectId: string;
  readonly firestoreHost: string;
  readonly authHost: string;
}

type Environment = Record<string, string | undefined>;

/**
 * Returns the emulator a tool should use, or refuses.
 *
 * A tool that calls this can never reach a real project: the Admin SDK sends every request to
 * the emulator addresses when these variables are set, and the tool refuses to start when they
 * are not. The project identifier must also carry the "demo-" prefix, which makes the Firebase
 * SDKs themselves refuse to contact production services.
 */
export function requireEmulatorTarget(env: Environment = process.env): EmulatorTarget {
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST?.trim();
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
  const missing = [
    firestoreHost ? null : "FIRESTORE_EMULATOR_HOST",
    authHost ? null : "FIREBASE_AUTH_EMULATOR_HOST",
  ].filter((name) => name !== null);
  if (!firestoreHost || !authHost) {
    throw new ToolRefusal(
      `Refusing to run: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        "This command only writes to the Local Emulator Suite. Start the emulators with " +
        "`npm run emulators` and run the command through its npm script, which sets these variables.",
    );
  }
  const projectId = env.GCLOUD_PROJECT?.trim() || DEMO_PROJECT_ID;
  if (!projectId.startsWith(DEMO_PROJECT_PREFIX)) {
    throw new ToolRefusal(
      `Refusing to run: the project "${projectId}" is not a demonstration project. ` +
        `This command only accepts project identifiers that start with "${DEMO_PROJECT_PREFIX}".`,
    );
  }
  return { projectId, firestoreHost, authHost };
}

/** Where an importer may write: the emulators, or a real project that the operator has named in full. */
export type ImportTarget =
  | ({ readonly kind: "emulator" } & EmulatorTarget)
  | { readonly kind: "production"; readonly projectId: string };

export interface ImportTargetRequest {
  /** True when the operator gave the production flag. */
  readonly production: boolean;
  /** The project the operator named beside the flag. */
  readonly projectId?: string;
}

const EMULATOR_VARIABLES = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] as const;

/**
 * Decides where an importer may write, or refuses.
 *
 * Without the production flag the answer is the emulator or a refusal, exactly as for every
 * other tool. A real project is reached only when the operator asks for it three times over:
 * with the flag, with the identifier of the project, and with credentials in the environment.
 * Anything that leaves the target in doubt is refused: emulator variables beside the flag, a
 * demonstration project, or a project in the environment that differs from the one named.
 */
export function requireImportTarget(request: ImportTargetRequest, env: Environment = process.env): ImportTarget {
  if (!request.production) {
    if (request.projectId !== undefined) {
      throw new ToolRefusal(
        "Refusing to run: --project names a real project and is read only together with --production.",
      );
    }
    return { kind: "emulator", ...requireEmulatorTarget(env) };
  }
  const emulators = EMULATOR_VARIABLES.filter((name) => env[name]?.trim());
  if (emulators.length > 0) {
    throw new ToolRefusal(
      `Refusing to run: --production was given while ${emulators.join(" and ")} ${emulators.length === 1 ? "is" : "are"} set, ` +
        "so the target is in doubt. Run the command outside the emulator environment, or leave the flag out.",
    );
  }
  const projectId = request.projectId?.trim() ?? "";
  if (projectId === "") {
    throw new ToolRefusal("Refusing to run: --production needs the project named with --project <identifier>.");
  }
  if (projectId.startsWith(DEMO_PROJECT_PREFIX)) {
    throw new ToolRefusal(
      `Refusing to run: "${projectId}" is a demonstration project, which exists in the emulators only.`,
    );
  }
  const inEnvironment = env.GCLOUD_PROJECT?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim();
  if (inEnvironment && inEnvironment !== projectId) {
    throw new ToolRefusal("Refusing to run: the project in the environment is not the project named with --project.");
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    throw new ToolRefusal(
      "Refusing to run: --production needs credentials, and GOOGLE_APPLICATION_CREDENTIALS is not set. " +
        "An import against a real project is run by a programme administrator, with short-lived credentials.",
    );
  }
  return { kind: "production", projectId };
}

/** Whether something accepts connections at "host:port". */
function accepts(address: string, timeoutMs: number): Promise<boolean> {
  const separator = address.lastIndexOf(":");
  const host = address.slice(0, separator);
  const port = Number(address.slice(separator + 1));
  if (separator < 1 || !Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** The emulators a tool can need. */
export type EmulatorService = "firestore" | "auth";

/**
 * Refuses when the emulators a tool was pointed at are not running. Without this check the
 * Admin SDK would try to connect for a while and then fail with an error that says nothing
 * about emulators. A tool that writes documents only names `firestore` alone in `services`.
 */
export async function requireRunningEmulators(
  target: EmulatorTarget,
  env: Environment = process.env,
  timeoutMs = 1_000,
  services: readonly EmulatorService[] = ["firestore", "auth"],
): Promise<void> {
  const checks = [
    { service: "firestore", name: "Firestore", address: target.firestoreHost },
    { service: "auth", name: "Authentication", address: target.authHost },
  ].filter((check) => (services as readonly string[]).includes(check.service));
  const reachable = await Promise.all(checks.map((check) => accepts(check.address, timeoutMs)));
  const down = checks.filter((_check, index) => !reachable[index]);
  if (down.length === 0) return;
  const base = env.PORTAL_PORT_BASE?.trim();
  throw new ToolRefusal(
    `Refusing to run: the emulators${base ? ` of PORTAL_PORT_BASE=${base}` : ""} are not running. ` +
      `Nothing answers at ${down.map((check) => `${check.address} (${check.name})`).join(" or ")}. ` +
      "Start them with `npm run emulators` and run the command again.",
  );
}
