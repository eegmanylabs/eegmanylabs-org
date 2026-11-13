#!/usr/bin/env node
// @ts-check
// Sets up the backups of one environment (docs/SECURITY.md, section 10). WRITTEN, NEVER RUN:
// nothing in this repository has executed these commands, and the flags follow the vendor
// documentation of November 2026 without having been tried against a real project.
//
//   node ops/backup-setup.mjs --environment production --project <id> --project-number <number>
//   (add --execute to run the printed commands after typing the project identifier again)
//
// | Copy                      | Where                                   | How long                       |
// |---------------------------|-----------------------------------------|--------------------------------|
// | Point-in-time recovery    | Inside Firestore                        | 7 days, one version a minute   |
// | Scheduled backups         | Inside Firestore, in the database's region | daily for 7 days, weekly for 14 weeks |
// | Managed export            | A bucket of its own in europe-west2     | 98 days, by a lifecycle rule   |
// | Storage objects           | The same bucket, below storage/         | 98 days, by the same rule      |
//
// Authentication accounts are not exported by any of these. An administrator exports them with
// `firebase auth:export` to the same bucket, by hand, as ops/README.md describes, because the
// file holds every member's address.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_RETENTION, ENVIRONMENTS, projectRefusal, REGION } from "./environments.mjs";
import { ProcedureRefusal, requireProject, requireSupplied, runProcedure } from "./procedure.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXPORT_ACCOUNT_ID = "eegml-backup-export";

/**
 * @param {import("./environments.mjs").PortalEnvironment} environment
 * @param {string} projectId
 * @param {string} projectNumber
 * @returns {import("./procedure.mjs").PlannedCommand[]}
 */
export function backupSetupCommands(environment, projectId, projectNumber) {
  const refusal = projectRefusal(environment.name, projectId);
  if (refusal !== null) throw new ProcedureRefusal(`Refusing: ${refusal}`);
  if (projectId !== environment.projectId) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is not the ${environment.name} project of ops/environments.mjs.`,
    );
  }
  if (!/^\d{6,20}$/.test(projectNumber))
    throw new ProcedureRefusal("Refusing: --project-number is the number of the project.");
  const bucket = `gs://${requireSupplied("the backup bucket", environment.backupBucket)}`;
  const exporter = `${EXPORT_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`;
  const firestoreAgent = `service-${projectNumber}@gcp-sa-firestore.iam.gserviceaccount.com`;
  const project = `--project=${projectId}`;
  return [
    {
      program: "gcloud",
      purpose: `A bucket of its own for the backups, in ${REGION}, closed to the public`,
      args: [
        "storage",
        "buckets",
        "create",
        bucket,
        project,
        `--location=${REGION}`,
        "--uniform-bucket-level-access",
        "--public-access-prevention",
      ],
    },
    {
      program: "gcloud",
      purpose: `Delete each copy ${BACKUP_RETENTION.managedExportDays} days after it was written`,
      args: [
        "storage",
        "buckets",
        "update",
        bucket,
        project,
        `--lifecycle-file=${path.join(HERE, "backup-lifecycle.json")}`,
      ],
    },
    {
      program: "gcloud",
      purpose: "Point-in-time recovery: one version a minute for 7 days",
      args: ["firestore", "databases", "update", "--database=(default)", "--enable-pitr", project],
    },
    {
      program: "gcloud",
      purpose: `A daily scheduled backup kept ${BACKUP_RETENTION.dailyBackup}`,
      args: [
        "firestore",
        "backups",
        "schedules",
        "create",
        "--database=(default)",
        "--recurrence=daily",
        `--retention=${BACKUP_RETENTION.dailyBackup}`,
        project,
      ],
    },
    {
      program: "gcloud",
      purpose: `A weekly scheduled backup kept ${BACKUP_RETENTION.weeklyBackup}`,
      args: [
        "firestore",
        "backups",
        "schedules",
        "create",
        "--database=(default)",
        "--recurrence=weekly",
        "--day-of-week=SUN",
        `--retention=${BACKUP_RETENTION.weeklyBackup}`,
        project,
      ],
    },
    {
      program: "gcloud",
      purpose: "The account that starts a managed export, and nothing else",
      args: ["iam", "service-accounts", "create", EXPORT_ACCOUNT_ID, project, "--display-name=Portal managed export"],
    },
    {
      program: "gcloud",
      purpose: "It may start exports and imports of Firestore",
      args: [
        "projects",
        "add-iam-policy-binding",
        projectId,
        `--member=serviceAccount:${exporter}`,
        "--role=roles/datastore.importExportAdmin",
        "--condition=None",
      ],
    },
    {
      program: "gcloud",
      purpose: "The Firestore service agent writes the export into the backup bucket, and into no other",
      args: [
        "storage",
        "buckets",
        "add-iam-policy-binding",
        bucket,
        `--member=serviceAccount:${firestoreAgent}`,
        "--role=roles/storage.objectAdmin",
      ],
    },
    {
      program: "gcloud",
      purpose: "Start a managed export every night, at a time outside the working day",
      args: [
        "scheduler",
        "jobs",
        "create",
        "http",
        "eegml-firestore-export",
        project,
        `--location=${REGION}`,
        "--schedule=17 1 * * *",
        "--time-zone=Europe/London",
        "--http-method=POST",
        `--uri=https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
        `--message-body={"outputUriPrefix":"${bucket}/firestore"}`,
        `--oauth-service-account-email=${exporter}`,
        "--oauth-token-scope=https://www.googleapis.com/auth/datastore",
      ],
    },
    {
      program: "gcloud",
      purpose: "Copy the files of pages into the backup bucket every day",
      args: [
        "transfer",
        "jobs",
        "create",
        `gs://${projectId}.firebasestorage.app`,
        `${bucket}/storage/`,
        project,
        "--schedule-repeats-every=1d",
        "--description=Portal files to the backup bucket",
      ],
    },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runProcedure(({ options }) => {
    const name = options.get("environment");
    if (name !== "staging" && name !== "production")
      throw new ProcedureRefusal("Refusing: --environment is staging or production.");
    const projectId = requireProject(options);
    return {
      projectId,
      commands: backupSetupCommands(ENVIRONMENTS[name], projectId, options.get("project-number") ?? ""),
    };
  });
}
