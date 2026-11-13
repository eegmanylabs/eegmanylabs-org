#!/usr/bin/env node
// @ts-check
// Restores the live database of one environment to a chosen moment and then applies again every
// governance action made after it (docs/SECURITY.md, section 10). WRITTEN, NEVER RUN: nothing
// in this repository has executed these commands, and the flags follow the vendor documentation
// of November 2026 without having been tried against a real project. It is for a recovery that
// the programme administrators have decided on, after the same moment has been rehearsed with
// ops/restore-scratch.mjs.
//
//   node ops/restore-live.mjs --environment production --project <id>
//     --snapshot-time 2026-11-20T09:00:00Z [--work-directory <absolute directory outside the repository>]
//   (add --execute to run the printed commands after typing the project identifier again)
//
// | Step | Why |
// |------|-----|
// | Export the governance ledger first | It lives in a locked log bucket outside Firestore, so the restore cannot touch it |
// | Export the moment from point-in-time recovery and import it into the live database | Every document that existed at the moment returns to its state then. A document created after the moment stays, so that nothing written since is lost without a decision |
// | `governance:replay` | Every erasure, role or grant revocation and suspension after the moment is applied again, every access document is resolved again, and every session that began before the replay is ended |
//
// The restored moment must lie inside the 7 days of point-in-time recovery. For an older moment
// the scheduled backups are restored into a new database instead, which is a decision of its own.
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENVIRONMENTS, projectRefusal } from "./environments.mjs";
import { ProcedureRefusal, requireProject, requireSupplied, runProcedure } from "./procedure.mjs";
import { ledgerExportCommand, requireWorkDirectory } from "./restore-scratch.mjs";

/**
 * @param {import("./environments.mjs").PortalEnvironment} environment
 * @param {{ projectId: string, snapshotTime: string, workDirectory: string }} request
 * @returns {import("./procedure.mjs").PlannedCommand[]}
 */
export function restoreLiveCommands(environment, request) {
  const { projectId, snapshotTime } = request;
  const refusal = projectRefusal(environment.name, projectId);
  if (refusal !== null) throw new ProcedureRefusal(`Refusing: ${refusal}`);
  if (projectId !== environment.projectId) {
    throw new ProcedureRefusal(
      `Refusing: "${projectId}" is not the ${environment.name} project of ops/environments.mjs.`,
    );
  }
  const moment = new Date(snapshotTime);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(snapshotTime) || Number.isNaN(moment.getTime())) {
    throw new ProcedureRefusal("Refusing: --snapshot-time is a whole minute in UTC, such as 2026-11-20T09:00:00Z.");
  }
  const work = requireWorkDirectory(request.workDirectory);
  const ledger = path.join(work, "governance-ledger.json");
  const prefix = `gs://${requireSupplied("the backup bucket", environment.backupBucket)}/restore-live/${snapshotTime.replace(/[:]/g, "")}`;
  return [
    ledgerExportCommand(projectId, ledger),
    {
      program: "gcloud",
      purpose: "Export the live database as it stood at the moment, from point-in-time recovery",
      args: ["firestore", "export", `${prefix}/firestore`, `--snapshot-time=${snapshotTime}`, `--project=${projectId}`],
    },
    {
      program: "gcloud",
      purpose: "Import that moment into the live database. Documents created after the moment stay",
      args: ["firestore", "import", `${prefix}/firestore`, `--project=${projectId}`],
    },
    {
      program: "npm",
      purpose:
        "Apply again every erasure, revocation and suspension after the moment, resolve every access document and end every session",
      args: [
        "run",
        "--silent",
        "-w",
        "@eegml/tools",
        "cli",
        "--",
        "governance:replay",
        "--production",
        "--project",
        projectId,
        "--ledger",
        ledger,
        "--after",
        snapshotTime,
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
    const snapshotTime = options.get("snapshot-time") ?? "";
    const workDirectory =
      options.get("work-directory") ?? path.join(os.tmpdir(), `eegml-restore-live-${snapshotTime.replace(/[:]/g, "")}`);
    const commands = restoreLiveCommands(ENVIRONMENTS[name], { projectId, snapshotTime, workDirectory });
    mkdirSync(workDirectory, { recursive: true, mode: 0o700 });
    return { projectId, commands };
  });
}
