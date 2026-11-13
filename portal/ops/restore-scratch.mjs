#!/usr/bin/env node
// @ts-check
// Restores one environment, as it stood at a chosen moment, into a scratch project and compares
// the two (docs/SECURITY.md, section 10). WRITTEN, NEVER RUN: nothing in this repository has
// executed these commands, and the flags follow the vendor documentation of November 2026
// without having been tried against a real project.
//
//   node ops/restore-scratch.mjs --environment production --project <id>
//     --scratch-project <id> --scratch-project-number <number> --snapshot-time 2026-11-20T09:00:00Z
//   (add --execute to run the printed commands after typing the project identifier again)
//
// The moment must lie inside the 7 days of point-in-time recovery. The live database is only
// read: a clone of it at that moment is the reference, the export of that moment is restored into
// the scratch project, and `backup:compare` must find the two identical, as the emulator
// rehearsal (`npm run restore:rehearse`) does locally. The clone is deleted at the end.
import { fileURLToPath } from "node:url";
import { ENVIRONMENTS, projectRefusal, REGION } from "./environments.mjs";
import { ProcedureRefusal, requireProject, requireSupplied, runProcedure } from "./procedure.mjs";

export const CLONE_DATABASE = "restore-reference";

/**
 * @param {import("./environments.mjs").PortalEnvironment} environment
 * @param {{ projectId: string, scratchProjectId: string, scratchProjectNumber: string, snapshotTime: string }} request
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
  const bucket = `gs://${requireSupplied("the backup bucket", environment.backupBucket)}`;
  const prefix = `${bucket}/restore/${snapshotTime.replace(/[:]/g, "")}`;
  const scratchAgent = `service-${scratchProjectNumber}@gcp-sa-firestore.iam.gserviceaccount.com`;
  const tools = ["run", "--silent", "-w", "@eegml/tools", "cli", "--"];
  return [
    {
      program: "gcloud",
      purpose: "Export the live database as it stood at the moment, from point-in-time recovery",
      args: ["firestore", "export", `${prefix}/firestore`, `--snapshot-time=${snapshotTime}`, `--project=${projectId}`],
    },
    {
      program: "gcloud",
      purpose: "Clone the same moment into a second database of the live project, as the reference",
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
      purpose: "Let the scratch project read the export, and nothing more",
      args: [
        "storage",
        "buckets",
        "add-iam-policy-binding",
        bucket,
        `--member=serviceAccount:${scratchAgent}`,
        "--role=roles/storage.objectViewer",
      ],
    },
    {
      program: "gcloud",
      purpose: `Import the export into the scratch project, whose database is in ${REGION}`,
      args: ["firestore", "import", `${prefix}/firestore`, `--project=${scratchProjectId}`],
    },
    {
      program: "gcloud",
      purpose: "Copy the latest copy of the files of pages into the scratch project",
      args: ["storage", "rsync", `${bucket}/storage`, `gs://${scratchProjectId}.firebasestorage.app`, "--recursive"],
    },
    {
      program: "firebase",
      purpose: "Give the scratch project the rules of this repository, so that the rules check means something",
      args: ["deploy", "--only", "firestore:rules,storage", "--project", scratchProjectId],
    },
    {
      program: "npm",
      purpose: "Manifest of the reference clone (read only)",
      args: [
        ...tools,
        "backup:manifest",
        "--production",
        "--project",
        projectId,
        "--database",
        CLONE_DATABASE,
        "--out",
        "reference-manifest.json",
      ],
    },
    {
      program: "npm",
      purpose: "Manifest of the restore (read only)",
      args: [
        ...tools,
        "backup:manifest",
        "--production",
        "--project",
        scratchProjectId,
        "--out",
        "restore-manifest.json",
      ],
    },
    {
      program: "npm",
      purpose: "Every document present and identical, or the differences listed",
      args: [...tools, "backup:compare", "reference-manifest.json", "restore-manifest.json"],
    },
    {
      program: "gcloud",
      purpose: "Remove the reference clone from the live project",
      args: ["firestore", "databases", "delete", `--database=${CLONE_DATABASE}`, `--project=${projectId}`],
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
    return {
      projectId,
      commands: restoreScratchCommands(ENVIRONMENTS[name], {
        projectId,
        scratchProjectId,
        scratchProjectNumber: options.get("scratch-project-number") ?? "",
        snapshotTime: options.get("snapshot-time") ?? "",
      }),
    };
  });
}
