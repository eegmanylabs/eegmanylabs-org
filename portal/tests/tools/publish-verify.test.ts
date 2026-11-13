// Integration tests of publish:verify, run against the Firestore emulator. The export is made by
// the generator of the shared package from the committed data files of this repository, which
// the test reads and never changes, and one synthetic member on the example.org domain. The
// build here is a stand-in, a few lines of Node that write the pages the checks read, so that the
// checks themselves are proved whatever is installed; the browser test of acceptance scenario 13
// builds the real site with Syrinx.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COLLECTIONS,
  diffWebsiteFile,
  generateWebsiteFiles,
  publicationBatchDocSchema,
  publicationPayloadSha256,
  publicProjection,
  sha256Hex,
  systemWriteContext,
  WEBSITE_FILES,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { recordedCommand, verifyPublication } from "../../tools/src/commands/publish-verify";
import { adminDb } from "../support/admin";
import { clearFirestore, PORTAL_ROOT } from "../support/emulators";

const SITE_ROOT = path.resolve(PORTAL_ROOT, "..");
const BATCH = "publishVerifySynthetic";

/**
 * A stand-in for the site's build: it writes the home page, a members page that lists every
 * PersonId of the members file, and copies the candidate files, as the real build does.
 */
const STAND_IN_BUILD = `node -e "
const fs = require('fs');
fs.mkdirSync('dist/members', { recursive: true });
fs.writeFileSync('dist/index.html', '<h1>Synthetic home</h1>');
const rows = fs.readFileSync('data/members.tsv', 'utf8').split(/\\r?\\n/).slice(1);
fs.writeFileSync('dist/members/index.html', rows.map((row) => row.split('\\t')[1] || '').join(' '));
fs.cpSync('assets', 'dist/assets', { recursive: true });
"`;

async function seedExport(tamper = false): Promise<void> {
  const base = {
    members: readFileSync(path.join(SITE_ROOT, WEBSITE_FILES.members.path), "utf8"),
    people: readFileSync(path.join(SITE_ROOT, WEBSITE_FILES.people.path), "utf8"),
  };
  const persons = [
    publicProjection("person", "synthetic-verify", {
      slug: "synthetic-verify",
      displayName: "Synthetic Verify Member",
      affiliationSummary: "Synthetic Institute",
      countrySource: "Nowhere",
      publicListing: "member",
      archivedAt: null,
      dataOrigin: "live",
    }),
  ];
  const { files } = generateWebsiteFiles(
    base,
    { persons, replications: [], laboratories: [], participations: [], manuscripts: [], summaries: [] },
    { outputs: ["members", "laboratories"], origins: ["live"] },
  );
  const written = (["members", "people", "laboratories"] as const).map((key) => ({
    key,
    path: WEBSITE_FILES[key].path,
    content: files[key] ?? "",
    base: key === "laboratories" ? null : base[key],
  }));
  const now = Timestamp.now();
  const standard = {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system:test",
    updatedBy: "system:test",
    archivedAt: null,
    writeContext: systemWriteContext(),
  };
  await adminDb.doc(COLLECTIONS.publicationBatches.docPath(BATCH)).set({
    ...standard,
    kind: "website",
    outputs: ["members", "laboratories"],
    syntheticData: true,
    baseCommit: "synthetic-commit",
    payloadSha256: publicationPayloadSha256(written),
    diffSummary: {},
    notes: [],
    status: "previewed",
    requestedBy: "uid-synthetic",
    requestedAt: now,
    verification: null,
    approvedBy: null,
    approvedAt: null,
    publishedAt: null,
    rolledBackBy: null,
    rolledBackAt: null,
  });
  for (const file of written) {
    const diff = diffWebsiteFile(file.base, file.content, WEBSITE_FILES[file.key].key);
    const content = tamper && file.key === "members" ? `${file.content}9\tplanted\tPlanted Row\t\t\n` : file.content;
    await adminDb.doc(COLLECTIONS.publicationFiles.docPath(BATCH, file.key)).set({
      ...standard,
      batchId: BATCH,
      fileKey: file.key,
      path: file.path,
      content,
      sha256: sha256Hex(content),
      baseContent: file.base,
      baseSha256: file.base === null ? null : sha256Hex(file.base),
      diff: { ...diff, rows: diff.rows.slice(0, 500), rowsOmitted: 0 },
    });
  }
}

async function batch() {
  return publicationBatchDocSchema.parse(
    (await adminDb.doc(COLLECTIONS.publicationBatches.docPath(BATCH)).get()).data(),
  );
}

beforeEach(async () => {
  await clearFirestore();
});

describe("publish:verify", () => {
  it("builds the site from the export in a scratch copy outside the repository and records the passed checks", async () => {
    await seedExport();
    const before = readFileSync(path.join(SITE_ROOT, "data/members.tsv"), "utf8");
    const result = await verifyPublication(adminDb, {
      batchId: BATCH,
      siteRoot: SITE_ROOT,
      buildCommand: STAND_IN_BUILD,
    });
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(result.checks.map((check) => check.key)).toEqual([
      "payload",
      "build",
      "output",
      "pages",
      "feeds",
      "images",
      "stages",
      "privacy",
      "repository",
    ]);
    expect(path.relative(SITE_ROOT, result.scratch).startsWith("..")).toBe(true);
    expect(readFileSync(path.join(SITE_ROOT, "data/members.tsv"), "utf8")).toBe(before);
    const stored = await batch();
    expect(stored.status).toBe("verified");
    expect(stored.verification).toMatchObject({ passed: true, payloadSha256: stored.payloadSha256 });
  });

  it("records the build command without a path of the trusted machine", () => {
    expect(recordedCommand("/home/someone/portal/.run/site-venv/bin/syrinx -c -e staging .")).toBe(
      "syrinx -c -e staging .",
    );
    expect(recordedCommand("syrinx -c -e staging .")).toBe("syrinx -c -e staging .");
    expect(recordedCommand("node build.js")).toBe("node build.js");
  });

  it("fails an export whose files are not the files the preview showed", async () => {
    await seedExport(true);
    const result = await verifyPublication(adminDb, {
      batchId: BATCH,
      siteRoot: SITE_ROOT,
      buildCommand: STAND_IN_BUILD,
    });
    expect(result.checks.find((check) => check.key === "payload")?.passed).toBe(false);
    expect(await batch()).toMatchObject({ status: "failed", statusReason: expect.stringContaining("payload") });
  });

  it("fails an export whose build fails, and builds nothing twice", async () => {
    await seedExport();
    const result = await verifyPublication(adminDb, { batchId: BATCH, siteRoot: SITE_ROOT, buildCommand: "exit 1" });
    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.key === "build")?.detail).toContain("status 1");
    await expect(
      verifyPublication(adminDb, { batchId: BATCH, siteRoot: SITE_ROOT, buildCommand: STAND_IN_BUILD }),
    ).rejects.toThrow("only an export that was previewed is built");
  });
});
