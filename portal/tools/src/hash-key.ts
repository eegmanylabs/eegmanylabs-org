// The key of the keyed hashes, as a tool finds it (docs/DATA_MODEL.md, section 1).
import { DEMO_IDENTITY_HASH_KEY, IDENTITY_HASH_KEY_NAME, MIN_HASH_SECRET_BYTES } from "@eegml/shared";
import { ToolRefusal } from "./environment";

/**
 * The key for the Local Emulator Suite: the public demonstration key, which the functions use
 * in the emulator as well, unless the environment names another. It protects nothing, and no
 * tool uses it for a real project, whose key comes from the private configuration.
 */
export function emulatorHashKey(env: Record<string, string | undefined> = process.env): string {
  const configured = env[IDENTITY_HASH_KEY_NAME]?.trim() ?? "";
  if (configured === "") return DEMO_IDENTITY_HASH_KEY;
  if (Buffer.byteLength(configured, "utf8") < MIN_HASH_SECRET_BYTES) {
    throw new ToolRefusal(
      `Refusing to run: ${IDENTITY_HASH_KEY_NAME} is shorter than ${MIN_HASH_SECRET_BYTES} bytes. Unset it to use the demonstration key.`,
    );
  }
  return configured;
}
