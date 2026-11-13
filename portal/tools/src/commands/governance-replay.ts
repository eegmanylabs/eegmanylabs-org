// governance:replay --ledger <file> --after <instant> [--production --project <identifier>]
//
// The mandatory step after any restore of a database (ops/README.md, "Restoring the live
// project"): applies again every entry of the governance ledger later than the restored moment,
// resolves every access document again and ends every session. `--ledger` names an export of
// the ledger's log bucket, `gcloud logging read` with `--format=json`, kept outside the
// repository. `--after` is the moment the database was restored to.
import { readFileSync } from "node:fs";
import { ledgerEntriesAfter } from "@eegml/shared";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";
import { replayLedger } from "../governance/replay";

const USAGE = "Usage: governance:replay --ledger <file> --after <instant> [--production --project <identifier>]";

export const governanceReplayCommand: Command = {
  name: "governance:replay",
  summary: "After a restore: apply the governance ledger again, rebuild access and end every session.",
  async run(args) {
    let production = false;
    let projectId: string | undefined;
    let ledger: string | undefined;
    let after: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      const value = args[index + 1];
      if (argument === "--production") production = true;
      else if (argument === "--project" || argument === "--ledger" || argument === "--after") {
        if (value === undefined || value.startsWith("--"))
          throw new ToolRefusal(`${argument} needs a value.\n\n${USAGE}`);
        if (argument === "--project") projectId = value;
        else if (argument === "--ledger") ledger = value;
        else after = value;
        index += 1;
      } else throw new ToolRefusal(USAGE);
    }
    if (ledger === undefined || after === undefined) throw new ToolRefusal(USAGE);
    const moment = new Date(after);
    if (Number.isNaN(moment.getTime()))
      throw new ToolRefusal(`--after is an instant such as 2026-11-20T09:00:00Z.\n\n${USAGE}`);
    let exported: unknown;
    try {
      exported = JSON.parse(readFileSync(ledger, "utf8"));
    } catch {
      throw new ToolRefusal("Refusing to run: the ledger file cannot be read as JSON.");
    }
    const { entries, skipped } = ledgerEntriesAfter(exported, moment);
    const target = requireImportTarget({ production, ...(projectId === undefined ? {} : { projectId }) });
    let handles: ReturnType<typeof connectToProject>;
    if (target.kind === "production") handles = connectToProject(target.projectId);
    else {
      await requireRunningEmulators(target, process.env, 1_000, ["auth", "firestore"]);
      handles = connectToEmulators(target);
    }
    const summary = await replayLedger(handles, entries, new Date());
    console.log(
      `governance:replay in ${target.projectId}: ${entries.length} entries after ${moment.toISOString()} ` +
        `(${skipped} lines that are no ledger entry skipped). ${summary.erasures} erasures, ${summary.rolesRevoked} roles ` +
        `and ${summary.grantsRevoked} grants revoked, ${summary.accountsSuspended} accounts suspended, ` +
        `${summary.alreadyApplied} already in effect; ${summary.accessUpdated} access documents rewritten and the ` +
        `sessions of ${summary.sessionsEnded} accounts ended.`,
    );
    return undefined;
  },
};
