// Integration tests for the seed:demo tool, run against the emulators.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { accessDocSchema, userDocSchema } from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { DEMO_ACCOUNTS } from "../../tools/src/fixtures/demo-accounts";
import { adminAuth, adminDb } from "../support/admin";
import { clearAuth, clearFirestore, PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";

const EMULATOR_VARIABLES = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"];

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

const withEmulators = emulatorEnvironment(PORTS, PROJECT_ID);

beforeEach(async () => {
  await Promise.all([clearFirestore(), clearAuth()]);
});

describe("seed:demo", () => {
  it("refuses to run when the emulator variables are not set, and writes nothing", async () => {
    const result = runCli(["seed:demo"], {});
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Refusing to run");
    expect(result.stderr).toContain("FIRESTORE_EMULATOR_HOST");
    expect((await adminDb.collection("users").get()).size).toBe(0);
  });

  it("refuses a project that is not a demonstration project", () => {
    const result = runCli(["seed:demo"], { ...withEmulators, GCLOUD_PROJECT: "a-real-project" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a demonstration project");
  });

  it("writes two fictitious accounts with their documents, all labelled as demonstration data", async () => {
    const result = runCli(["seed:demo"], withEmulators);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("6 created, 0 unchanged");

    expect(DEMO_ACCOUNTS).toHaveLength(2);
    for (const account of DEMO_ACCOUNTS) {
      expect(account.email).toMatch(/@example\.org$/);
      const record = await adminAuth.getUser(account.uid);
      expect(record).toMatchObject({ email: account.email, emailVerified: true, displayName: account.displayName });

      const user = userDocSchema.parse((await adminDb.doc(`users/${account.uid}`).get()).data());
      expect(user).toMatchObject({ emailLower: account.email, status: "active", dataOrigin: "demo" });

      const access = accessDocSchema.parse((await adminDb.doc(`access/${account.uid}`).get()).data());
      expect(access).toMatchObject({ member: false, personId: null, dataOrigin: "demo" });
    }
    expect((await adminDb.collection("users").get()).size).toBe(2);
    expect((await adminDb.collection("access").get()).size).toBe(2);
  });

  it("changes nothing when it is run a second time", async () => {
    runCli(["seed:demo"], withEmulators);
    const before = await adminDb.collection("users").get();

    const result = runCli(["seed:demo"], withEmulators);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 created, 6 unchanged");

    const after = await adminDb.collection("users").get();
    expect(after.docs.map((doc) => doc.updateTime.toMillis())).toEqual(
      before.docs.map((doc) => doc.updateTime.toMillis()),
    );
  });
});

describe("the tools command line", () => {
  it("lists its commands", () => {
    const result = runCli(["help"], {});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("seed:demo");
  });

  it("rejects a command it does not know", () => {
    const result = runCli(["drop:everything"], withEmulators);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown command "drop:everything"');
  });
});
