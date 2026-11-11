// Integration tests for the integrity:check tool, run against the Firestore emulator. The world is
// the synthetic one of seed:demo, with one invented laboratory added whose principal investigator
// does not exist.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { COLLECTIONS, DEMO_IDENTITY_HASH_KEY, integrityReportDocSchema, systemWriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { checkAndRecordIntegrity, INTEGRITY_CHECK_ACTOR } from "../../tools/src/commands/integrity-check";
import { demoDocuments } from "../../tools/src/commands/seed-demo";
import { adminDb } from "../support/admin";
import { clearFirestore, PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";

/** Writes the documents of the demonstration world directly, without its accounts. */
async function seedWorld(): Promise<void> {
  const documents = demoDocuments(new Date("2026-03-04T05:06:07Z"), DEMO_IDENTITY_HASH_KEY);
  for (let start = 0; start < documents.length; start += 400) {
    const batch = adminDb.batch();
    for (const document of documents.slice(start, start + 400)) batch.set(adminDb.doc(document.path), document.data);
    await batch.commit();
  }
}

beforeEach(async () => {
  await clearFirestore();
});

describe("integrity:check", () => {
  it("finds nothing in the demonstration world, and records a report that says so", async () => {
    await seedWorld();
    const { runId, findings } = await checkAndRecordIntegrity(adminDb, new Date("2026-05-06T07:08:09.010Z"));
    expect(findings).toEqual([]);
    expect(runId).toBe("tools-20260506T070809010Z");
    const report = integrityReportDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.integrityReports.docPath(runId)).get()).data(),
    );
    expect(report).toMatchObject({ status: "completed", createdBy: INTEGRITY_CHECK_ACTOR });
    expect(Object.values(report.counts).every((count) => count === 0)).toBe(true);
  });

  it("records each finding with its check, its document and its field, and no personal value", async () => {
    await seedWorld();
    const now = Timestamp.now();
    await adminDb.doc(COLLECTIONS.laboratories.docPath("demo-lab-dangling")).set({
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "system:test",
      updatedBy: "system:test",
      archivedAt: null,
      writeContext: systemWriteContext(),
      slug: "demo-dangling-lab",
      name: "Demo Dangling Laboratory",
      piPersonId: "demo-person-missing",
      status: "active",
      custom: {},
      dataOrigin: "demo",
    });
    await adminDb.doc("persons/demo-person-ivy").update({ laboratoryIds: [] });
    const { runId } = await checkAndRecordIntegrity(adminDb);
    const findings = (
      await adminDb.collection(COLLECTIONS.integrityReportFindings.collectionPath(runId)).get()
    ).docs.map((finding) => finding.data());
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "danglingReference",
          documentPath: "laboratories/demo-lab-dangling",
          field: "piPersonId",
        }),
        expect.objectContaining({
          check: "derivedValueDisagrees",
          documentPath: "persons/demo-person-ivy",
          field: "laboratoryIds",
        }),
      ]),
    );
    expect(JSON.stringify(findings)).not.toMatch(/@example\.org/);
  });

  it("runs from the command line against the emulator", () => {
    const result = spawnSync(path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx"), ["src/cli.ts", "integrity:check"], {
      cwd: path.join(PORTAL_ROOT, "tools"),
      env: { ...process.env, ...emulatorEnvironment(PORTS, PROJECT_ID) },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/integrity:check in demo-eegml: report tools-\d{8}T\d{9}Z, 0 findings\./);
  });
});
