#!/usr/bin/env node
// @ts-check
// Restores one environment, as it stood at a chosen moment, into a scratch project and compares
// the two (docs/SECURITY.md, section 10). WRITTEN, NEVER RUN: nothing in this repository has
// executed these commands, and the flags follow the vendor documentation of November 2026
// without having been tried against a real project.
//
//   node ops/restore-scratch.mjs --environment production --project <id>
//     --scratch-project <id> --scratch-project-number <number> --snapshot-time 2026-11-20T09:00:00Z
//     [--work-directory <absolute directory outside the repository>]
//   (add --execute to run the printed commands after typing the project identifier again)
//
// What it writes, and where:
//
// | Where                     | What                                                                 | Removed |
// |---------------------------|----------------------------------------------------------------------|---------|
// | The live project          | A temporary second database, `restore-reference`, cloned from the moment: a full copy of live data, special-category documents included | At the end, even after a failure |
// | The backup bucket         | The export of the moment, below restore/<moment>/                    | By the bucket's lifecycle rule |
// | The backup bucket's policy | Read access for the scratch project's Firestore agent, limited by a condition to restore/<moment>/ | At the end, even after a failure |
// | The scratch project       | The imported database and the copied files, then the governance ledger applied to them | At the end, even after a failure |
// | The work directory        | The export of the governance ledger and the two manifests, which list every document path | By the operator, once the result is recorded |
//
// The live database itself is only read. The moment must lie inside the 7 days of point-in-time
// recovery.
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENVIRONMENTS, GOVERNANCE_LEDGER, projectRefusal, REGION } from "./environments.mjs";
import { PORTAL_DIRECTORY, ProcedureRefusal, requireProject, requireSupplied, runProcedure } from "./procedure.mjs";

export const CLONE_DATABASE = "restore-reference";

/**
 * A directory for the files of one restore, refused inside the repository: the manifests list
 * every document path of production.
 * @param {string} directory
 */
export function requireWorkDirectory(directory) {
  const resolved = path.resolve(directory);
  if (!path.isAbsolute(directory)) throw new ProcedureRefusal("Refusing: --work-directory is an absolute path.");
  const repository = path.resolve(PORTAL_DIRECTORY, "..");
  if (resolved === repository || resolved.startsWith(`${repository}${path.sep}`)) {
    throw new ProcedureRefusal(
      "Refusing: the work directory lies inside the repository, where nothing of production belongs.",
    );
  }
  return resolved;
}

/**
 * The commands that export the governance ledger of a project to a file.
 * @param {string} projectId
 * @param {string} file
 * @returns {import("./procedure.mjs").PlannedCommand}
 */
export function ledgerExportCommand(projectId, file) {
  return {
    program: "gcloud",
    purpose: "Export the governance ledger, kept outside Firestore, so that what a restore undoes can be applied again",
    args: [
      "logging",
      "read",
      GOVERNANCE_LEDGER.filter,
      `--bucket=${GOVERNANCE_LEDGER.bucket}`,
      `--location=${REGION}`,
      "--view=_AllLogs",
      "--freshness=3650d",
      "--format=json",
      `--project=${projectId}`,
    ],
    stdoutFile: file,
  };
}

/**
 * @param {import("./environments.mjs").PortalEnvironment} environment
 * @param {{ projectId: string, scratchProjectId: string, scratchProjectNumber: string, snapshotTime: string, workDirectory: string }} request
 * @returns {import("./procedure.mjs").PlannedCommand[]}
 */
export function restoreScratchCommands(environment, request) {
  const { projectId, scratchProjectId, scratchProjectNumber, snapshotTime } = request;
  const refusal = projectRefusal(environment.name, projectId);
  if (refusal !== null) throw new ProcedureRefusal(`Refusing: ${refusal}`);
  if (projectId !== environment.projectId) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is not the ${environment.name} project of ops/environments.mjs.`,
    );
  }
  if (scratchProjectId !== requireSupplied("the scratch project", environment.scratchProjectId)) {
    throw new ProcedureRefusal(
      "Refusing: a restore goes into the scratch project of ops/environments.mjs and nowhere else.",
    );
  }
  if (scratchProjectId === projectId)
    throw new ProcedureRefusal("Refusing: a restore never writes into the live project.");
  if (!/^\d{6,20}$/.test(scratchProjectNumber)) {
    throw new ProcedureRefusal("Refusing: --scratch-project-number is the number of the scratch project.");
  }
  const moment = new Date(snapshotTime);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(snapshotTime) || Number.isNaN(moment.getTime())) {
    throw new ProcedureRefusal("Refusing: --snapshot-time is a whole minute in UTC, such as 2026-11-20T09:00:00Z.");
  }
  const work = requireWorkDirectory(request.workDirectory);
  const backupBucket = requireSupplied("the backup bucket", environment.backupBucket);
  const liveFiles = requireSupplied("the Storage bucket", environment.storageBucket);
  const scratchFiles = `${scratchProjectId}.firebasestorage.app`;
  const stamp = snapshotTime.replace(/[:]/g, "");
  const prefix = `gs://${backupBucket}/restore/${stamp}`;
  const scratchAgent = `serviceAccount:service-${scratchProjectNumber}@gcp-sa-firestore.iam.gserviceaccount.com`;
  // Read access for the scratch project's agent to this one export, and to nothing else in the bucket.
  const condition = `expression=resource.name.startsWith("projects/_/buckets/${backupBucket}/objects/restore/${stamp}/"),title=restore-${stamp}`;
  const tools = ["run", "--silent", "-w", "@eegml/tools", "cli", "--"];
  /** @param {string} name */
  const file = (name) => path.join(work, name);
  return [
    ledgerExportCommand(projectId, file("governance-ledger.json")),
    {
      program: "gcloud",
      purpose: "Export the live database as it stood at the moment, from point-in-time recovery",
      args: ["firestore", "export", `${prefix}/firestore`, `--snapshot-time=${snapshotTime}`, `--project=${projectId}`],
    },
    {
      program: "gcloud",
      purpose: `Clone the same moment into a temporary second database of the live project, ${CLONE_DATABASE}, as the reference`,
      args: [
        "firestore",
        "databases",
        "clone",
        `--source-database=projects/${projectId}/databases/(default)`,
        `--snapshot-time=${snapshotTime}`,
        `--destination-database=${CLONE_DATABASE}`,
        `--project=${projectId}`,
      ],
    },
    {
      program: "gcloud",
      purpose: "Let the scratch project read this export, and nothing more of the backup bucket",
      args: [
        "storage",
        "buckets",
        "add-iam-policy-binding",
        `gs://${backupBucket}`,
        `--member=${scratchAgent}`,
        "--role=roles/storage.objectViewer",
        `--condition=${condition}`,
      ],
    },
    {
      program: "gcloud",
      purpose: `Import the export into the scratch project, whose database is in ${REGION}`,
      args: ["firestore", "import", `${prefix}/firestore`, `--project=${scratchProjectId}`],
    },
    {
      program: "gcloud",
      purpose: "Copy the latest daily copy of the files of pages into the scratch project",
      args: ["storage", "rsync", `gs://${backupBucket}/storage`, `gs://${scratchFiles}`, "--recursive"],
    },
    {
      program: "fb",
      purpose: "Give the scratch project the rules of this repository, so that the rules check means something",
      args: [
        "deploy",
        "--config",
        "firebase.deploy.json",
        "--only",
        "firestore:rules,storage",
        "--project",
        scratchProjectId,
      ],
    },
    {
      program: "npm",
      purpose: "Manifest of the reference clone and of the live files (read only)",
      args: [
        ...tools,
        "backup:manifest",
        "--production",
        "--project",
        projectId,
        "--database",
        CLONE_DATABASE,
        "--bucket",
        liveFiles,
        "--out",
        file("reference-manifest.json"),
      ],
    },
    {
      program: "npm",
      purpose: "Manifest of the restore and of its files (read only)",
      args: [
        ...tools,
        "backup:manifest",
        "--production",
        "--project",
        scratchProjectId,
        "--bucket",
        scratchFiles,
        "--out",
        file("restore-manifest.json"),
      ],
    },
    {
      program: "npm",
      purpose:
        "Every document present and identical, or the differences listed. A file changed since the last daily copy shows as a difference",
      args: [...tools, "backup:compare", file("reference-manifest.json"), file("restore-manifest.json")],
    },
    {
      program: "npm",
      purpose: "Apply to the restored copy every erasure, revocation and suspension made after the moment",
      args: [
        ...tools,
        "governance:replay",
        "--production",
        "--project",
        scratchProjectId,
        "--ledger",
        file("governance-ledger.json"),
        "--after",
        snapshotTime,
      ],
    },
    {
      program: "gcloud",
      purpose: "Remove the reference clone from the live project",
      args: ["firestore", "databases", "delete", `--database=${CLONE_DATABASE}`, `--project=${projectId}`],
      always: true,
      allowFailure: "the clone was never made",
    },
    {
      program: "gcloud",
      purpose: "Take back the scratch project's read access to the backup bucket",
      args: [
        "storage",
        "buckets",
        "remove-iam-policy-binding",
        `gs://${backupBucket}`,
        `--member=${scratchAgent}`,
        "--role=roles/storage.objectViewer",
        `--condition=${condition}`,
      ],
      always: true,
      allowFailure: "the access was never granted",
    },
    {
      program: "gcloud",
      purpose:
        "Remove the restored database from the scratch project: the copy of production does not outlive the rehearsal",
      args: ["firestore", "databases", "delete", "--database=(default)", `--project=${scratchProjectId}`],
      always: true,
      allowFailure: "nothing was imported",
    },
    {
      program: "gcloud",
      purpose: "Remove the copied files from the scratch project",
      args: ["storage", "rm", "--recursive", `gs://${scratchFiles}/**`],
      always: true,
      allowFailure: "nothing was copied",
    },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runProcedure(({ options }) => {
    const name = options.get("environment");
    if (name !== "staging" && name !== "production")
      throw new ProcedureRefusal("Refusing: --environment is staging or production.");
    const projectId = requireProject(options);
    const scratchProjectId = requireProject(options, "scratch-project");
    const snapshotTime = options.get("snapshot-time") ?? "";
    const workDirectory =
      options.get("work-directory") ?? path.join(os.tmpdir(), `eegml-restore-${snapshotTime.replace(/[:]/g, "")}`);
    const commands = restoreScratchCommands(ENVIRONMENTS[name], {
      projectId,
      scratchProjectId,
      scratchProjectNumber: options.get("scratch-project-number") ?? "",
      snapshotTime,
      workDirectory,
    });
    mkdirSync(workDirectory, { recursive: true, mode: 0o700 });
    return { environment: name, projectId, commands };
  });
}
