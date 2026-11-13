// Integration tests of backup:manifest and backup:compare, run as a person would run them against
// the Firestore and Authentication emulators. Every document is synthetic.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { adminDb } from "../support/admin";
import { clearFirestore, PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";

const TSX = path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx");
const directory = mkdtempSync(path.join(os.tmpdir(), "eegml-backup-manifest-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function cli(args: readonly string[]) {
  return spawnSync(TSX, ["src/cli.ts", ...args], {
    cwd: path.join(PORTAL_ROOT, "tools"),
    env: {
      ...process.env,
      GCLOUD_PROJECT: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      ...emulatorEnvironment(PORTS, PROJECT_ID),
    },
    encoding: "utf8",
  });
}

beforeEach(async () => {
  await clearFirestore();
  await adminDb.doc("institutions/synthetic-one").set({ name: "Synthetic institution one" });
  await adminDb.doc("institutions/synthetic-one/nested/child").set({ value: 1 });
  await adminDb.doc("institutions/synthetic-two").set({ name: "Synthetic institution two" });
});

describe("backup:manifest and backup:compare", () => {
  it("find a restore identical, then name the document that changed and the one that went", async () => {
    const before = path.join(directory, "before.json");
    const after = path.join(directory, "after.json");
    expect(cli(["backup:manifest", "--out", before]).status).toBe(0);
    const manifest = JSON.parse(readFileSync(before, "utf8"));
    expect(manifest.documents.map((entry: { key: string }) => entry.key)).toEqual([
      "institutions/synthetic-one",
      "institutions/synthetic-one/nested/child",
      "institutions/synthetic-two",
    ]);
    expect(readFileSync(before, "utf8")).not.toContain("Synthetic institution");

    expect(cli(["backup:compare", before, before]).status).toBe(0);

    await adminDb.doc("institutions/synthetic-one").update({ name: "Changed" });
    await adminDb.doc("institutions/synthetic-two").delete();
    expect(cli(["backup:manifest", "--out", after]).status).toBe(0);
    const compared = cli(["backup:compare", before, after]);
    expect(compared.status).toBe(3);
    expect(compared.stdout).toContain("missing institutions/synthetic-two");
    expect(compared.stdout).toContain("changed institutions/synthetic-one");
  });

  it("refuses a real project without the production flag and credentials", () => {
    const refused = cli(["backup:manifest", "--out", path.join(directory, "x.json"), "--project", "eegml-live"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/--production/);
  });
});
