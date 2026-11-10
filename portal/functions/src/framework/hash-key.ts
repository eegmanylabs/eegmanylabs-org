// The key of the keyed hashes (docs/DATA_MODEL.md, section 1).
//
// The identifier of an entry of `personEmailIndex`, of an identity key and of a bootstrap record
// is an HMAC of a personal value, because a plain hash of an address can be reversed by
// guessing. The importers read the key from private configuration, and the functions read the
// same key from the secret store. A function that needs it says so with `usesIdentityHashKey`.
import { DEMO_IDENTITY_HASH_KEY, IDENTITY_HASH_KEY_NAME, MIN_HASH_SECRET_BYTES } from "@eegml/shared";
import { defineSecret } from "firebase-functions/params";

type SecretParameter = ReturnType<typeof defineSecret>;

let parameter: SecretParameter | undefined;

/**
 * The secret that holds the key. It is declared on first use, and the emulator never uses it:
 * the Firebase tools would otherwise look for a value in the functions directory of every
 * machine that starts the emulator.
 */
export function identityHashKeySecret(): SecretParameter {
  parameter ??= defineSecret(IDENTITY_HASH_KEY_NAME);
  return parameter;
}

/**
 * The key of the keyed hashes for this environment. A bound secret arrives in the environment
 * variable of its name. The emulator falls back to the public demonstration key, which the
 * tools use for the emulator as well, and nothing else ever does.
 */
export function identityHashKey(env: Record<string, string | undefined> = process.env): string {
  const configured = env[IDENTITY_HASH_KEY_NAME]?.trim() ?? "";
  if (configured !== "") {
    if (Buffer.byteLength(configured, "utf8") < MIN_HASH_SECRET_BYTES) {
      throw new Error(`The secret ${IDENTITY_HASH_KEY_NAME} is shorter than ${MIN_HASH_SECRET_BYTES} bytes.`);
    }
    return configured;
  }
  if (env.FUNCTIONS_EMULATOR === "true") return DEMO_IDENTITY_HASH_KEY;
  throw new Error(`The secret ${IDENTITY_HASH_KEY_NAME} is not available to this function.`);
}
