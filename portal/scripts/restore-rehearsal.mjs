#!/usr/bin/env node
// @ts-check
// The restore rehearsal on the Local Emulator Suite (docs/SECURITY.md, section 10).
//
//   npm run restore:rehearse
//
// 1. Fresh emulators (Authentication, Firestore, Storage) run `restore:capture`, which seeds the
//    demonstration world, marks the audit trail, stores an object and writes a manifest of every
//    document, account and object with a hash of each. The emulators export their state with
//    their own export when the command ends.
// 2. Emulators start from that export and run `restore:after-snapshot`, which erases a person and
//    revokes a grant after the backup moment and writes both to the governance ledger file. These
//    emulators are not exported: what they did is what a restore to the backup moment loses.
// 3. Fresh emulators start from the same export and run `restore:verify`, which compares the
//    restore with the manifest, reads the audit trail back, asks the rules whether a denied read
//    stays denied, damages the restore on purpose to show that the comparison catches it, replays
//    the governance ledger and checks that the erasure and the revocation are back in effect, and
//    writes a dated report.
//
// Everything goes to .run/<port base>/restore-rehearsal/<time>/ and nothing to the repository.
// Nothing here reaches a real project: the emulators run under the demonstration project.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PORTAL_ROOT, runDirectory } from "./paths.mjs";
import { resolvePortBase } from "./ports.mjs";

const base = resolvePortBase();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = path.join(runDirectory(base), "restore-rehearsal", stamp);
const exported = path.join(directory, "export");
mkdirSync(directory, { recursive: true });

/**
 * @param {string[]} options
 * @param {string} script
 */
function session(options, script) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(PORTAL_ROOT, "scripts", "emulators.mjs"),
      "exec",
      "--only",
      "auth,firestore,storage",
      ...options,
      script,
    ],
    { cwd: PORTAL_ROOT, stdio: "inherit", env: { ...process.env, PORTAL_REHEARSAL_DIR: directory } },
  );
  return result.status ?? 1;
}

const captured = session(["--export-on-exit", exported], "restore:capture");
if (captured !== 0 || !existsSync(path.join(exported, "firebase-export-metadata.json"))) {
  console.error(`restore:rehearse: the capture or the export failed. See ${directory}.`);
  process.exit(captured === 0 ? 1 : captured);
}
const lost = session(["--import", exported], "restore:after-snapshot");
if (lost !== 0) {
  console.error(`restore:rehearse: the changes after the backup moment failed. See ${directory}.`);
  process.exit(lost);
}
const verified = session(["--import", exported], "restore:verify");
console.log(`restore:rehearse ${verified === 0 ? "passed" : "failed"}. The report is in ${directory}.`);
process.exit(verified);
