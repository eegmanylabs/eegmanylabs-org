// @ts-check
// The deployed environments of the portal and what each one is (D-017).
//
// Every identifier below is a placeholder until a programme administrator supplies the real one.
// A placeholder holds the word PLACEHOLDER, and every script that acts on a project refuses a
// placeholder, so nothing can reach a project that nobody has named. The emulators are no
// environment here: they run under the demonstration project and need none of this.
//
// The web build reads this file to keep the environments apart (web/config/build-config.ts),
// the deployment preflight reads it (scripts/deploy-check.mjs), and the procedures in this
// directory read it to print their commands.

/** The one region of every resource that has a location (D-003, D-014). */
export const REGION = "europe-west2";

/** The marker of an identifier that an administrator has still to supply. */
export const PLACEHOLDER = "PLACEHOLDER";

/** The log bucket and the sink that keep the governance ledger outside Firestore (shared/src/governance/ledger.ts). */
export const GOVERNANCE_LEDGER = Object.freeze({
  bucket: "eegml-governance-ledger",
  sink: "eegml-governance-ledger",
  filter: "jsonPayload.governanceLedger:*",
});

/**
 * @typedef {object} PortalEnvironment
 * @property {"staging" | "production"} name
 * @property {string} projectId The Firebase project.
 * @property {string} backupBucket A bucket of its own for managed exports, in REGION.
 * @property {string} storageBucket The project's Cloud Storage for Firebase bucket, which holds the files of pages:
 *   `<project>.firebasestorage.app` for a bucket made since October 2024, `<project>.appspot.com` for an older one.
 * @property {string} scratchProjectId The project a restore is rehearsed in, never the live one.
 * @property {string} siteOrigin The origin the portal is published at. No decision fixes it yet, so both are placeholders.
 * @property {readonly string[]} forbiddenProjectWords Words that may not appear in this environment's project.
 */

/** @type {Readonly<Record<"staging" | "production", PortalEnvironment>>} */
export const ENVIRONMENTS = Object.freeze({
  staging: Object.freeze({
    name: "staging",
    projectId: "eegml-staging-PLACEHOLDER",
    backupBucket: "eegml-staging-backups-PLACEHOLDER",
    storageBucket: "eegml-staging-PLACEHOLDER.firebasestorage.app",
    scratchProjectId: "eegml-staging-restore-PLACEHOLDER",
    siteOrigin: "https://staging-PLACEHOLDER.github.io",
    forbiddenProjectWords: Object.freeze(["prod", "production"]),
  }),
  production: Object.freeze({
    name: "production",
    projectId: "eegml-production-PLACEHOLDER",
    backupBucket: "eegml-production-backups-PLACEHOLDER",
    storageBucket: "eegml-production-PLACEHOLDER.firebasestorage.app",
    scratchProjectId: "eegml-restore-scratch-PLACEHOLDER",
    siteOrigin: "https://portal-PLACEHOLDER.example.org",
    forbiddenProjectWords: Object.freeze(["staging", "stage", "test", "scratch", "restore"]),
  }),
});

/**
 * Proposed retention of the copies that the backup procedure keeps. They follow Firestore's own
 * limits (docs/SECURITY.md, section 10) and are for the administrators to confirm.
 */
export const BACKUP_RETENTION = Object.freeze({
  /** Days a managed export stays in the backup bucket before its lifecycle rule deletes it. */
  managedExportDays: 98,
  /** Retention of the daily scheduled backup. */
  dailyBackup: "7d",
  /** Retention of the weekly scheduled backup, the longest Firestore allows. */
  weeklyBackup: "14w",
  /**
   * Days the governance ledger's log bucket keeps each entry. It must outlast every copy a
   * restore could start from, and it is locked so that nobody can shorten it.
   */
  governanceLedgerDays: 3650,
});

/** @param {string} value */
export function isPlaceholder(value) {
  return value.includes(PLACEHOLDER);
}

/**
 * The environment whose project this is, or null.
 * @param {string} projectId
 * @returns {PortalEnvironment | null}
 */
export function environmentOfProject(projectId) {
  return Object.values(ENVIRONMENTS).find((environment) => environment.projectId === projectId) ?? null;
}

/**
 * Why a project may not serve as the given environment, or null when it may. A project of the
 * other environment, a demonstration project and a project whose name marks another environment
 * are all refused.
 * @param {"staging" | "production"} name
 * @param {string} projectId
 * @returns {string | null}
 */
export function projectRefusal(name, projectId) {
  const environment = ENVIRONMENTS[name];
  const id = projectId.trim().toLowerCase();
  if (id === "") return `no ${name} project is named.`;
  if (id.startsWith("demo-")) return `"${projectId}" is a demonstration project, which exists in the emulators only.`;
  for (const other of Object.values(ENVIRONMENTS)) {
    if (other.name !== name && (other.projectId.toLowerCase() === id || other.scratchProjectId.toLowerCase() === id)) {
      return `"${projectId}" is the project of ${other.name}, not of ${name}.`;
    }
  }
  if (environment.scratchProjectId.toLowerCase() === id) return `"${projectId}" is the scratch project of restores.`;
  const word = environment.forbiddenProjectWords.find((candidate) => id.split(/[^a-z0-9]+/).includes(candidate));
  if (word !== undefined) return `the project "${projectId}" is named for "${word}", which is not ${name}.`;
  return null;
}
