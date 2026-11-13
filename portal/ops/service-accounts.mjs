// @ts-check
// The service accounts of the portal's functions and the least each one needs (D-014,
// docs/SECURITY.md, section 7). This is the reviewed specification: ops/iam-plan.mjs prints the
// commands that create exactly this, and tests/architecture/least-privilege.test.ts holds the
// functions code to it. Nothing here has been applied to any project.
//
// Every function runs as the runtime account (FUNCTIONS_SERVICE_ACCOUNT in shared/src/constants.ts,
// set on each function), never as the Compute Engine default account, which holds the editor
// role on a new project. Each integration has an account or a secret of its own, so that a
// fault in one reaches nothing of another:
//
// | Account          | Acts for                                | Project roles                     | Secrets it may read |
// |------------------|-----------------------------------------|-----------------------------------|---------------------|
// | `runtime`        | Every function: Firestore, Authentication, keyed hashes, the files of pages, its own scheduled and event triggers | Firestore user, Authentication admin, log and trace writer, Eventarc receiver, Cloud Run invoker; object admin on the Storage bucket alone | `IDENTITY_HASH_KEY` |
// | `drive`          | Google Drive, Sheets and Docs           | None. It reaches only the files shared with it | None: the runtime obtains short-lived tokens for it |
// | `storageScan`    | Listing research data servers           | None                              | `STORAGE_*` secrets |
// | `github`         | Pull requests on the website repository | None                              | `PUBLISHING_GITHUB_TOKEN` |
// | `osf`            | Public reads of OSF registrations       | None                              | None |
// | `mail`           | The outbox, once a provider is chosen   | None                              | None until decision 7 names a provider |
//
// The accounts other than `runtime` hold no project role at all. The functions of an integration
// run in the same deployment as every other function, so they run as `runtime` too, and the
// runtime account is bound to the secrets of each integration that is switched on, one by one,
// never to Secret Manager as a whole. A `STORAGE_` secret is bound when its endpoint is added.
// The runtime obtains short-lived tokens for `drive`, which has no key.

/**
 * @typedef {object} ServiceAccountSpec
 * @property {string} id The account identifier, before the @.
 * @property {string} displayName
 * @property {string} purpose
 * @property {readonly string[]} projectRoles Roles on the project. As few as the job needs.
 * @property {readonly string[]} storageBucketRoles Roles on the project's Storage bucket alone.
 * @property {"always" | "github" | "storage" | "google" | "osf" | "mail"} integration When its secrets are created and bound:
 *   always, or once the named integration is switched on.
 * @property {readonly string[]} secrets Exact secret names the account may read.
 * @property {string | null} secretPrefix A prefix of secret names it may read, or null.
 * @property {readonly string[]} sourceDirectories Directories of functions/src whose code may name these secrets.
 */

/** @type {Readonly<Record<"runtime" | "drive" | "storageScan" | "github" | "osf" | "mail", ServiceAccountSpec>>} */
export const SERVICE_ACCOUNTS = Object.freeze({
  runtime: {
    id: "eegml-functions",
    displayName: "Portal functions runtime",
    purpose: "Reads and writes Firestore, manages accounts in Authentication and derives keyed hashes.",
    projectRoles: [
      "roles/datastore.user",
      "roles/firebaseauth.admin",
      "roles/logging.logWriter",
      "roles/cloudtrace.agent",
      "roles/eventarc.eventReceiver",
      // Cloud Scheduler and Eventarc call the scheduled and the event functions as this account.
      "roles/run.invoker",
    ],
    storageBucketRoles: ["roles/storage.objectAdmin"],
    integration: "always",
    secrets: ["IDENTITY_HASH_KEY"],
    secretPrefix: null,
    sourceDirectories: ["framework", "triggers"],
  },
  drive: {
    id: "eegml-drive",
    displayName: "Portal Google Workspace",
    purpose: "The account that spreadsheets, documents and folders are shared with. No project role.",
    projectRoles: [],
    storageBucketRoles: [],
    integration: "google",
    secrets: [],
    secretPrefix: null,
    sourceDirectories: ["integrations/google"],
  },
  storageScan: {
    id: "eegml-storage-scan",
    displayName: "Portal storage scanning",
    purpose: "Lists files and checksums on research data servers with read-only credentials.",
    projectRoles: [],
    storageBucketRoles: [],
    integration: "storage",
    secrets: [],
    secretPrefix: "STORAGE_",
    sourceDirectories: ["integrations/storage"],
  },
  github: {
    id: "eegml-publishing",
    displayName: "Portal website publishing",
    purpose: "Opens pull requests on the website repository with a token limited to that repository.",
    projectRoles: [],
    storageBucketRoles: [],
    integration: "github",
    secrets: ["PUBLISHING_GITHUB_TOKEN"],
    secretPrefix: null,
    sourceDirectories: ["integrations/github"],
  },
  osf: {
    id: "eegml-osf",
    displayName: "Portal OSF checks",
    purpose: "Reads public OSF registrations. Needs no credential.",
    projectRoles: [],
    storageBucketRoles: [],
    integration: "osf",
    secrets: [],
    secretPrefix: null,
    sourceDirectories: ["integrations/osf"],
  },
  mail: {
    id: "eegml-mail",
    displayName: "Portal mail",
    purpose: "Sends the outbox once a provider is chosen. Holds nothing until then.",
    projectRoles: [],
    storageBucketRoles: [],
    integration: "mail",
    secrets: [],
    secretPrefix: null,
    sourceDirectories: ["integrations/mail", "notifications"],
  },
});

/** Every exact secret name that the specification declares. */
export function declaredSecrets() {
  return Object.values(SERVICE_ACCOUNTS).flatMap((account) => account.secrets);
}

/**
 * Whether a secret name is declared, exactly or by prefix.
 * @param {string} name
 */
export function isDeclaredSecret(name) {
  return Object.values(SERVICE_ACCOUNTS).some(
    (account) =>
      account.secrets.includes(name) || (account.secretPrefix !== null && name.startsWith(account.secretPrefix)),
  );
}
