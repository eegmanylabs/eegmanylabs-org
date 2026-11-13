/** Region of every Cloud Function and the region the web client calls. */
export const FUNCTIONS_REGION = "europe-west2";

/**
 * The service account every function runs as: `eegml-functions` of the project it is deployed
 * to, which holds the least the functions need (portal/ops/service-accounts.mjs). The trailing
 * `@` asks the Firebase tools to complete the address with the project. Without it a function of
 * the second generation runs as the Compute Engine default account, which holds far more.
 */
export const FUNCTIONS_SERVICE_ACCOUNT = "eegml-functions@";

/**
 * Project identifier used by the Local Emulator Suite. The "demo-" prefix makes the Firebase
 * tools and SDKs refuse to contact production services.
 */
export const DEMO_PROJECT_ID = "demo-eegml";

/** Prefix that marks a project identifier as emulator-only. */
export const DEMO_PROJECT_PREFIX = "demo-";

/**
 * The key of the keyed hashes in the Local Emulator Suite. It protects nothing: the emulators
 * hold synthetic data only, and this value is public. A real project reads its key from the
 * secret store, and no tool or function accepts this one outside the emulators.
 */
export const DEMO_IDENTITY_HASH_KEY = "demo-eegml-emulator-hash-key-that-protects-nothing";

/** Name of the secret, and of the environment variable, that holds the key of the keyed hashes. */
export const IDENTITY_HASH_KEY_NAME = "IDENTITY_HASH_KEY";
