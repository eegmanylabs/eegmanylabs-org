// Integration tests for the seed:demo tool, run against the emulators.
// Fixtures are synthetic: the demonstration accounts are fictitious and use the example.org domain.
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
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

  it("refuses, and says how to start them, when the emulators it was pointed at are not running", async () => {
    const port = await unusedPort();
    const result = runCli(["seed:demo"], {
      ...withEmulators,
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`,
      FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${port}`,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`the emulators of PORTAL_PORT_BASE=${PORTS.base} are not running`);
    expect(result.stderr).toContain("npm run emulators");
    // One short message, and no dump of an Admin SDK error.
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect((await adminDb.collection("users").get()).size).toBe(0);
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

      // Every document names the command as its author, as trusted code acting by itself.
      const standard = {
        schemaVersion: 1,
        createdBy: "system:seedDemo",
        updatedBy: "system:seedDemo",
        archivedAt: null,
        writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
      };

      const user = userDocSchema.parse((await adminDb.doc(`users/${account.uid}`).get()).data());
      expect(user).toMatchObject({
        ...standard,
        emailLower: account.email,
        displayName: account.displayName,
        personId: null,
        status: "active",
        mfaEnrolled: false,
        dataOrigin: "demo",
      });

      const access = accessDocSchema.parse((await adminDb.doc(`access/${account.uid}`).get()).data());
      expect(access).toMatchObject({
        ...standard,
        member: false,
        personId: null,
        suspended: false,
        sessionsValidAfter: null,
      });
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
