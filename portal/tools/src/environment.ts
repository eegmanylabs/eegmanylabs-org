// Decides which Firebase project a tool is allowed to touch.
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
