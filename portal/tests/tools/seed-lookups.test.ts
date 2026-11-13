// Integration tests for the seed:lookups tool, run against the Firestore emulator. The tool
// needs no other emulator: `npm run test:seed-lookups` starts Firestore alone.
// The lookup data is configuration of the programme and holds nothing about a person.
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { COLLECTIONS, lookupSeedDocuments } from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { SEED_LOOKUPS_ACTOR, seedLookups } from "../../tools/src/commands/seed-lookups";
import { adminDb } from "../support/admin";
import { clearFirestore, PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";

const EMULATOR_VARIABLES = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"];
const SEEDED_COLLECTIONS = [
  "programmes",
  "statusDefinitions",
  "countCategories",
  "checklistTemplates",
  "vocabularyTerms",
];
const SEEDS = lookupSeedDocuments();

/** Runs the command line as a person would, in a process of its own. */
function runCli(args: string[], environment: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = { ...process.env, GCLOUD_PROJECT: undefined };
  for (const name of EMULATOR_VARIABLES) env[name] = undefined;
  return spawnSync(path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], {
    cwd: path.join(PORTAL_ROOT, "tools"),
    env: { ...env, ...environment },
    encoding: "utf8",
  });
}

/** A loopback port that nothing listens on: taken from the system, then given back. */
function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")),
      );
    });
  });
}

const withEmulators = emulatorEnvironment(PORTS, PROJECT_ID);

/** Every document of the seeded collections, by path, with the time of its last write. */
async function writeTimes(): Promise<Record<string, string>> {
  const snapshots = await Promise.all(SEEDED_COLLECTIONS.map((name) => adminDb.collection(name).get()));
  return Object.fromEntries(
    snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => [doc.ref.path, doc.updateTime.toDate().toISOString()])),
  );
}

beforeEach(async () => {
  await clearFirestore();
});

describe("seed:lookups", () => {
  it("writes every document of the lookup data, each valid for its collection and attributed to the command", async () => {
    const result = runCli(["seed:lookups"], withEmulators);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${SEEDS.length} created, 0 unchanged, 0 different`);

    expect(Object.keys(await writeTimes())).toHaveLength(SEEDS.length);
    for (const seed of SEEDS) {
      const entry = COLLECTIONS[seed.collection];
      const stored = (await adminDb.doc(entry.docPath(seed.id)).get()).data();
      // The schema is strict, so this also proves that nothing but the seed and the standard fields was written.
      expect(entry.schema.safeParse(stored).error?.issues ?? [], entry.docPath(seed.id)).toEqual([]);
      expect(stored).toMatchObject({
        ...seed.data,
        schemaVersion: entry.schemaVersion,
        createdBy: SEED_LOOKUPS_ACTOR,
        updatedBy: SEED_LOOKUPS_ACTOR,
        archivedAt: null,
        writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
      });
    }
  });

  it("writes the programme, the statuses, the categories, the checklist and the contributor roles", async () => {
    expect(runCli(["seed:lookups"], withEmulators).status).toBe(0);

    expect((await adminDb.doc("programmes/eegmanylabs").get()).data()).toMatchObject({
      key: "eegmanylabs",
      name: "#EEGManyLabs",
      kind: "programme",
      parentId: null,
    });
    const statuses = await adminDb.collection("statusDefinitions").where("entityType", "==", "replication").get();
    expect(
      statuses.docs
        .map((doc) => doc.data())
        .sort((a, b) => a.position - b.position)
        .map((status) => status.key),
    ).toEqual([
      "proposed",
      "ongoing",
      "planning",
      "recruitingLabs",
      "sitePreparation",
      "collecting",
      "collectionComplete",
      "processing",
      "analysing",
      "writing",
      "submitted",
      "published",
      "paused",
      "archived",
    ]);
    expect((await adminDb.doc("statusDefinitions/dataset__analysisReady").get()).get("label")).toBe("Analysis ready");
    expect((await adminDb.doc("statusDefinitions/task__toDo").get()).get("isDefault")).toBe(true);
    expect((await adminDb.collection("countCategories").get()).size).toBe(11);
    expect((await adminDb.doc("countCategories/usable").get()).get("definition")).toMatch(/^Participants .+\.$/);
    expect((await adminDb.doc("checklistTemplates/onboarding").get()).get("items")).toHaveLength(9);
    const roles = await adminDb.collection("vocabularyTerms").where("kind", "==", "creditRole").get();
    expect(roles.size).toBe(14);
    expect((await adminDb.doc("vocabularyTerms/creditRole__writingreviewediting").get()).get("name")).toBe(
      "Writing – review & editing",
    );
  });

  it("performs no write when it is run a second time", async () => {
    expect(runCli(["seed:lookups"], withEmulators).status).toBe(0);
    const before = await writeTimes();
    expect(Object.keys(before)).toHaveLength(SEEDS.length);

    const second = runCli(["seed:lookups"], withEmulators);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(`0 created, ${SEEDS.length} unchanged, 0 different`);
    // A write of any kind, even one that changes no value, would move the time of the last write.
    expect(await writeTimes()).toEqual(before);

    const third = await seedLookups(adminDb, PROJECT_ID, new Date("2031-01-01T00:00:00Z"));
    expect(third).toEqual({ projectId: PROJECT_ID, created: 0, unchanged: SEEDS.length, different: [] });
    expect(await writeTimes()).toEqual(before);
  });

  it("writes only what is missing", async () => {
    await seedLookups(adminDb, PROJECT_ID);
    await adminDb.doc("countCategories/usable").delete();
    await adminDb.doc("statusDefinitions/task__blocked").delete();
    const before = await writeTimes();

    const summary = await seedLookups(adminDb, PROJECT_ID);
    expect(summary).toMatchObject({ created: 2, unchanged: SEEDS.length - 2, different: [] });
    const after = await writeTimes();
    expect(Object.keys(after)).toHaveLength(SEEDS.length);
    for (const [documentPath, time] of Object.entries(before)) expect(after[documentPath], documentPath).toBe(time);
  });

  it("leaves a document that an administrator has changed as it is, and says so", async () => {
    await seedLookups(adminDb, PROJECT_ID);
    await adminDb.doc("statusDefinitions/replication__paused").update({ label: "On hold" });
    await adminDb.doc("checklistTemplates/onboarding").update({
      items: [{ key: "ethics", label: "Ethics approval" }],
    });
    const before = await writeTimes();

    const result = runCli(["seed:lookups"], withEmulators);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`0 created, ${SEEDS.length - 2} unchanged, 2 different`);
    expect(result.stdout).toContain("statusDefinitions/replication__paused");
    expect(result.stdout).toContain("checklistTemplates/onboarding");
    expect(await writeTimes()).toEqual(before);
    expect((await adminDb.doc("statusDefinitions/replication__paused").get()).get("label")).toBe("On hold");
  });

  it("needs the Firestore emulator and no other", async () => {
    const result = runCli(["seed:lookups"], {
      ...withEmulators,
      FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${await unusedPort()}`,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(Object.keys(await writeTimes())).toHaveLength(SEEDS.length);
  });

  it("refuses to run when the emulator variables are not set, and writes nothing", async () => {
    const result = runCli(["seed:lookups"], {});
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Refusing to run");
    expect(await writeTimes()).toEqual({});
  });

  it("refuses a project that is not a demonstration project", async () => {
    const result = runCli(["seed:lookups"], { ...withEmulators, GCLOUD_PROJECT: "a-real-project" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a demonstration project");
    expect(await writeTimes()).toEqual({});
  });

  it("refuses, in one line, when the Firestore emulator it was pointed at is not running", async () => {
    const result = runCli(["seed:lookups"], {
      ...withEmulators,
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${await unusedPort()}`,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("(Firestore)");
    expect(result.stderr).not.toContain("(Authentication)");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("is listed by the command line", () => {
    const result = runCli(["help"], {});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("seed:lookups");
  });
});
