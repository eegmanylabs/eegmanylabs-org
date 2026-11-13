// The two halves of the restore rehearsal (docs/SECURITY.md, section 10), which
// scripts/restore-rehearsal.mjs runs in two separate emulator sessions:
//
// | Command           | Session                                   | What it does                                  |
// |-------------------|-------------------------------------------|-----------------------------------------------|
// | `restore:capture` | Fresh emulators, exported when it ends    | Seeds the demonstration world, marks the audit trail, stores one object, writes the manifest |
// | `restore:verify`  | Fresh emulators started from that export  | Compares the restore with the manifest, reads the audit trail, asks the rules, corrupts two documents and an object on purpose and checks that the comparison finds them, writes the dated report |
//
// Both write only below the rehearsal directory that the orchestrating script names, which lies
// in the run's log directory and never in the repository.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { COLLECTIONS, systemActor, systemWriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { type AdminHandles, connectToEmulators } from "../admin";
import {
  type BackupManifest,
  compareManifests,
  differenceCount,
  MANIFEST_KINDS,
  type ManifestDifference,
  parseManifest,
} from "../backup/manifest";
import { probeDocument, probeObject } from "../backup/rules-probe";
import { defaultBucketName, takeManifest } from "../backup/snapshot";
import type { Command } from "../command";
import { type EmulatorTarget, requireEmulatorTarget, requireRunningEmulators, ToolRefusal } from "../environment";
import { DEMO_ACCOUNTS } from "../fixtures/demo-accounts";
import { DEMO_PERSONS } from "../fixtures/demo-world";
import { seedDemo } from "./seed-demo";

/** The variable through which the orchestrating script names the rehearsal directory. */
export const REHEARSAL_DIRECTORY_VARIABLE = "PORTAL_REHEARSAL_DIR";

/** The object the capture stores, under the path of the files of a page, so the storage rules govern it. */
export const REHEARSAL_OBJECT = "pages/restore-rehearsal-page/files/restore-rehearsal-file/rehearsal.txt";
const REHEARSAL_OBJECT_TEXT = "SYNTHETIC. An object written by the restore rehearsal of the emulators.\n";
/** The audit entry the capture writes, which the restore must bring back readable. */
export const REHEARSAL_AUDIT_ID = "restore-rehearsal-marker";

const MANIFEST_FILE = "manifest.json";
const REPORT_FILE = "report.md";
const EXIT_FAILED_CHECK = 3;

type Environment = Record<string, string | undefined>;

/** The rehearsal directory, refused unless it is an existing absolute directory outside the repository's source. */
export function rehearsalDirectory(env: Environment = process.env): string {
  const given = env[REHEARSAL_DIRECTORY_VARIABLE]?.trim() ?? "";
  if (given === "" || !path.isAbsolute(given) || !existsSync(given)) {
    throw new ToolRefusal(
      `Refusing to run: ${REHEARSAL_DIRECTORY_VARIABLE} must name an existing absolute directory. ` +
        "Run the rehearsal with `npm run restore:rehearse`, which creates one in the run's log directory.",
    );
  }
  const resolved = path.resolve(given);
  const inRunDirectory = resolved.split(path.sep).includes(".run");
  const inTemporary = resolved.startsWith(path.resolve(os.tmpdir()) + path.sep);
  if (!inRunDirectory && !inTemporary) {
    throw new ToolRefusal(
      "Refusing to run: the rehearsal writes only below a run's log directory (.run) or the temporary directory.",
    );
  }
  return resolved;
}

interface Handles extends AdminHandles {
  readonly storage: Storage;
}

async function connect(): Promise<{ target: EmulatorTarget; handles: Handles; storageHost: string }> {
  const target = requireEmulatorTarget();
  await requireRunningEmulators(target);
  const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim() ?? "";
  if (storageHost === "") {
    throw new ToolRefusal(
      "Refusing to run: FIREBASE_STORAGE_EMULATOR_HOST is not set. The rehearsal covers Storage too.",
    );
  }
  const admin = connectToEmulators(target);
  return { target, storageHost, handles: { ...admin, storage: getStorage() } };
}

async function markAuditTrail(handles: Handles, at: Date): Promise<void> {
  const { auditEvents, systemSettings } = COLLECTIONS;
  const actor = systemActor("restoreRehearsal");
  const data = auditEvents.schema.parse({
    schemaVersion: auditEvents.schemaVersion,
    createdAt: Timestamp.fromDate(at),
    createdBy: actor,
    writeContext: systemWriteContext("system", REHEARSAL_AUDIT_ID),
    actorUid: null,
    actorKind: "system",
    action: "backup.rehearsalMarked",
    documentPath: systemSettings.docPath(),
    entityType: null,
    entityId: null,
    changes: [],
    context: {
      origin: "system",
      depth: 0,
      correlationId: null,
      causationId: null,
      requestId: null,
      ipHash: null,
      userAgent: null,
    },
  });
  await handles.db.doc(auditEvents.docPath(REHEARSAL_AUDIT_ID)).set(data);
}

export const restoreCaptureCommand: Command = {
  name: "restore:capture",
  summary: "First half of the restore rehearsal: seed, mark and take the manifest (emulators only).",
  async run() {
    const directory = rehearsalDirectory();
    const { target, handles } = await connect();
    await seedDemo(handles, target.projectId);
    await markAuditTrail(handles, new Date());
    await handles.storage
      .bucket(defaultBucketName(target.projectId))
      .file(REHEARSAL_OBJECT)
      .save(REHEARSAL_OBJECT_TEXT, { contentType: "text/plain", metadata: { metadata: { synthetic: "true" } } });
    const manifest = await takeManifest(handles, target.projectId);
    writeFileSync(path.join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `restore:capture took the manifest of ${target.projectId}: ${manifest.documents.length} documents, ` +
        `${manifest.accounts.length} accounts and ${manifest.objects.length} objects. The emulators export when this ends.`,
    );
    return undefined;
  },
};

export interface RehearsalCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

function describeDifference(difference: ManifestDifference): string {
  return MANIFEST_KINDS.map(
    (kind) =>
      `${kind}: ${difference[kind].missing.length} missing, ${difference[kind].changed.length} changed, ` +
      `${difference[kind].unexpected.length} unexpected`,
  ).join("; ");
}

/** Reads every audit entry back through its schema, as the console's function would. */
async function auditTrailCheck(handles: Handles, manifest: BackupManifest): Promise<RehearsalCheck> {
  const { auditEvents } = COLLECTIONS;
  const snapshot = await handles.db.collection(auditEvents.collectionPath()).get();
  const unreadable = snapshot.docs.filter((document) => !auditEvents.schema.safeParse(document.data()).success);
  const expected = manifest.documents.filter((entry) =>
    entry.key.startsWith(`${auditEvents.collectionPath()}/`),
  ).length;
  const marker = snapshot.docs.find((document) => document.id === REHEARSAL_AUDIT_ID);
  const passed = unreadable.length === 0 && snapshot.size === expected && marker !== undefined;
  return {
    name: "The audit trail is complete and readable",
    passed,
    detail:
      `${snapshot.size} entries restored of ${expected} backed up, ${unreadable.length} that fail their schema, ` +
      `rehearsal marker ${marker === undefined ? "absent" : "present"}`,
  };
}

async function rulesChecks(target: EmulatorTarget, storageHost: string): Promise<RehearsalCheck[]> {
  const member = DEMO_ACCOUNTS.find((account) => account.personId !== null);
  const person = DEMO_PERSONS[0];
  if (member === undefined || person === undefined) throw new Error("The demonstration world has no claimed account.");
  const { access, auditEvents, persons, personDemographics } = COLLECTIONS;
  const probes: { name: string; expected: "allowed" | "denied"; run: () => Promise<string> }[] = [
    {
      name: "A member still reads their own access document",
      expected: "allowed",
      run: () => probeDocument(target.firestoreHost, target.projectId, access.docPath(member.uid), member.uid),
    },
    {
      name: "A caller who is not signed in is still refused a directory entry",
      expected: "denied",
      run: () => probeDocument(target.firestoreHost, target.projectId, persons.docPath(person.id), null),
    },
    {
      name: "A member is still refused the audit trail",
      expected: "denied",
      run: () =>
        probeDocument(target.firestoreHost, target.projectId, auditEvents.docPath(REHEARSAL_AUDIT_ID), member.uid),
    },
    {
      name: "A member is still refused a demographics document",
      expected: "denied",
      run: () =>
        probeDocument(
          target.firestoreHost,
          target.projectId,
          personDemographics.docPath(member.personId ?? person.id),
          member.uid,
        ),
    },
    {
      name: "A caller who is not signed in is still refused a stored object",
      expected: "denied",
      run: () =>
        probeObject(storageHost, defaultBucketName(target.projectId), REHEARSAL_OBJECT, target.projectId, null),
    },
  ];
  const checks: RehearsalCheck[] = [];
  for (const probe of probes) {
    const outcome = await probe.run();
    checks.push({
      name: probe.name,
      passed: outcome === probe.expected,
      detail: `expected ${probe.expected}, got ${outcome}`,
    });
  }
  return checks;
}

/**
 * Damages the restore on purpose: one document changed, one removed and the object removed. The
 * comparison must name exactly those three, which shows that it would have caught a bad restore.
 */
async function corruptionCheck(handles: Handles, manifest: BackupManifest, projectId: string): Promise<RehearsalCheck> {
  const { persons, institutions } = COLLECTIONS;
  const changedPath = manifest.documents.find((entry) => entry.key.startsWith(`${persons.collectionPath()}/`))?.key;
  const removedPath = manifest.documents.find(
    (entry) => entry.key.startsWith(`${institutions.collectionPath()}/`) && entry.key.split("/").length === 2,
  )?.key;
  if (changedPath === undefined || removedPath === undefined) {
    return {
      name: "A corrupted restore is detected",
      passed: false,
      detail: "The manifest has no person or institution.",
    };
  }
  await handles.db.doc(changedPath).update({ middleName: "Corrupted by the rehearsal" });
  await handles.db.doc(removedPath).delete();
  await handles.storage.bucket(defaultBucketName(projectId)).file(REHEARSAL_OBJECT).delete();
  const difference = compareManifests(manifest, await takeManifest(handles, projectId));
  const passed =
    difference.documents.changed.join() === changedPath &&
    difference.documents.missing.join() === removedPath &&
    difference.objects.missing.join() === REHEARSAL_OBJECT &&
    differenceCount(difference) === 3;
  return {
    name: "A corrupted restore is detected",
    passed,
    detail: `After one change, one removal and one removed object the comparison found: ${describeDifference(difference)}`,
  };
}

export function rehearsalReport(manifest: BackupManifest, checks: readonly RehearsalCheck[], finishedAt: Date): string {
  const passed = checks.every((check) => check.passed);
  return [
    `# Restore rehearsal of ${finishedAt.toISOString().slice(0, 10)}`,
    "",
    "Emulator evidence only. The Local Emulator Suite exported its Firestore, Authentication and Storage state, fresh emulators",
    `started from that export, and the restore was compared with the manifest taken before the export. Project: ${manifest.projectId}.`,
    "The data is the synthetic demonstration world.",
    "",
    `- Manifest taken: ${manifest.takenAt}`,
    `- Verified: ${finishedAt.toISOString()}`,
    `- Backed up: ${manifest.documents.length} documents, ${manifest.accounts.length} accounts, ${manifest.objects.length} objects`,
    `- Result: ${passed ? "passed" : "failed"}`,
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...checks.map((check) => `| ${check.name} | ${check.passed ? "passed" : "failed"} | ${check.detail} |`),
    "",
  ].join("\n");
}

export const restoreVerifyCommand: Command = {
  name: "restore:verify",
  summary: "Second half of the restore rehearsal: compare, check and report (emulators only).",
  async run() {
    const directory = rehearsalDirectory();
    const manifestFile = path.join(directory, MANIFEST_FILE);
    if (!existsSync(manifestFile)) throw new ToolRefusal("Refusing to run: the rehearsal directory holds no manifest.");
    const manifest = parseManifest(readFileSync(manifestFile, "utf8"));
    const { target, handles, storageHost } = await connect();
    if (manifest.projectId !== target.projectId) {
      throw new ToolRefusal("Refusing to run: the manifest is of another project than the emulators.");
    }
    const restored = await takeManifest(handles, target.projectId);
    const difference = compareManifests(manifest, restored);
    const checks: RehearsalCheck[] = [
      {
        name: "Every document, account and object is present and identical",
        passed: differenceCount(difference) === 0 && manifest.documents.length > 0 && manifest.accounts.length > 0,
        detail: `${restored.documents.length} documents, ${restored.accounts.length} accounts, ${restored.objects.length} objects; ${describeDifference(difference)}`,
      },
      await auditTrailCheck(handles, manifest),
      ...(await rulesChecks(target, storageHost)),
      await corruptionCheck(handles, manifest, target.projectId),
    ];
    const finishedAt = new Date();
    const report = rehearsalReport(manifest, checks, finishedAt);
    writeFileSync(path.join(directory, REPORT_FILE), report);
    console.log(report);
    console.log(`The report is at ${path.join(directory, REPORT_FILE)}.`);
    return checks.every((check) => check.passed) ? undefined : EXIT_FAILED_CHECK;
  },
};
