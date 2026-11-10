// Integration tests of the tools for identity and access, run against the emulators:
// admin:bootstrap and access:rebuild.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  accessDocSchema,
  bootstrapAdminId,
  bootstrapAdminRecordSchema,
  can,
  DEMO_IDENTITY_HASH_KEY,
  emptyAccess,
  systemWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { adminDb } from "../support/admin";
import { clearFirestore, PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";

const ADDRESS = "Founding.Administrator@example.org";
const withEmulators = emulatorEnvironment(PORTS, PROJECT_ID);

/** Runs the command line as a person would, in a process of its own, with no credentials of any project. */
function runCli(args: string[], environment: Record<string, string | undefined> = withEmulators) {
  const result = spawnSync(path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], {
    cwd: path.join(PORTAL_ROOT, "tools"),
    env: {
      ...process.env,
      GCLOUD_PROJECT: undefined,
      GOOGLE_CLOUD_PROJECT: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      FIRESTORE_EMULATOR_HOST: undefined,
      FIREBASE_AUTH_EMULATOR_HOST: undefined,
      IDENTITY_HASH_KEY: undefined,
      ...environment,
    },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

const standard = () => {
  const now = Timestamp.now();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system:test",
    updatedBy: "system:test",
    archivedAt: null,
    writeContext: systemWriteContext(),
  };
};

beforeEach(async () => {
  await clearFirestore();
});

describe("admin:bootstrap", () => {
  it("stores one record under the keyed hash of the address, and neither stores nor prints the address", async () => {
    const result = runCli(["admin:bootstrap", "--email", ADDRESS]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("stored one bootstrap record");
    expect(result.stdout).toContain("The address was not stored and is not shown.");

    const stored = await adminDb.collection("bootstrapAdmins").get();
    const id = bootstrapAdminId("founding.administrator@example.org", DEMO_IDENTITY_HASH_KEY);
    expect(stored.docs.map((record) => record.id)).toEqual([id]);
    expect(bootstrapAdminRecordSchema.parse(stored.docs[0]?.data())).toMatchObject({
      usedAt: null,
      usedBy: null,
      createdBy: "system:adminBootstrap",
    });
    // Nothing that was printed or stored gives the address away, and the hash is not printed either.
    for (const text of [result.output, JSON.stringify(stored.docs[0]?.data())]) {
      expect(text.toLowerCase()).not.toMatch(/founding|administrator@|example\.org/);
      expect(text).not.toContain(id);
    }
    // Only the record was written.
    expect((await adminDb.listCollections()).map((collection) => collection.id)).toEqual(["bootstrapAdmins"]);
  });

  it("writes nothing when the record exists, whether it is unused or used", async () => {
    runCli(["admin:bootstrap", "--email", ADDRESS]);
    const record = (await adminDb.collection("bootstrapAdmins").get()).docs[0];

    const again = runCli(["admin:bootstrap", "--email", ` ${ADDRESS.toLowerCase()} `]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("has not been used yet, and wrote nothing");

    await record?.ref.update({ usedAt: Timestamp.now(), usedBy: "uid-first" });
    const used = runCli(["admin:bootstrap", "--email", ADDRESS]);
    expect(used.stdout).toContain("has been used already, and wrote nothing");
    expect((await adminDb.collection("bootstrapAdmins").get()).size).toBe(1);
    expect((await record?.ref.get())?.get("usedBy")).toBe("uid-first");
  });

  it("uses the key of the environment, so another key names another record", async () => {
    runCli(["admin:bootstrap", "--email", ADDRESS], {
      ...withEmulators,
      IDENTITY_HASH_KEY: "another-synthetic-key-of-at-least-32-bytes",
    });
    const stored = await adminDb.collection("bootstrapAdmins").get();
    expect(stored.docs.map((record) => record.id)).toEqual([
      bootstrapAdminId(ADDRESS, "another-synthetic-key-of-at-least-32-bytes"),
    ]);
    expect(stored.docs[0]?.id).not.toBe(bootstrapAdminId(ADDRESS, DEMO_IDENTITY_HASH_KEY));
    const short = runCli(["admin:bootstrap", "--email", ADDRESS], { ...withEmulators, IDENTITY_HASH_KEY: "too-short" });
    expect(short.status).toBe(2);
  });

  it.each([
    ["no address", ["admin:bootstrap"]],
    ["something that is no address", ["admin:bootstrap", "--email", "not-an-address"]],
    ["two addresses", ["admin:bootstrap", "--email", "one.person@example.org,other.person@example.org"]],
    ["an option it does not know", ["admin:bootstrap", "--email", ADDRESS, "--role", "core_team"]],
    [
      "a configuration file without the production flag",
      ["admin:bootstrap", "--email", ADDRESS, "--config", "elsewhere.json"],
    ],
  ])("refuses %s without repeating what was typed, and writes nothing", async (_label, args) => {
    const result = runCli(args);
    expect(result.status).toBe(2);
    expect(result.output).toContain("admin:bootstrap");
    expect(result.output).not.toMatch(/not-an-address|one\.person|example\.org/);
    expect((await adminDb.collection("bootstrapAdmins").get()).size).toBe(0);
  });

  it("refuses to run when it cannot tell that its target is an emulator", async () => {
    const withoutTarget = runCli(["admin:bootstrap", "--email", ADDRESS], {});
    expect(withoutTarget.status).toBe(2);
    expect(withoutTarget.stderr).toContain("Refusing to run");
    const realProject = runCli(["admin:bootstrap", "--email", ADDRESS], {
      ...withEmulators,
      GCLOUD_PROJECT: "a-real-project",
    });
    expect(realProject.status).toBe(2);
    expect(realProject.stderr).toContain("not a demonstration project");
    // A real project needs the flag, the project, credentials and the private key of the hash together.
    const production = runCli(
      ["admin:bootstrap", "--email", ADDRESS, "--production", "--project", "a-real-project"],
      {},
    );
    expect(production.status).toBe(2);
    expect(production.stderr).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    expect(`${withoutTarget.output}${realProject.output}${production.output}`.toLowerCase()).not.toContain("founding");
    expect((await adminDb.collection("bootstrapAdmins").get()).size).toBe(0);
  });
});

describe("access:rebuild", () => {
  async function accountWithRole(uid: string, access: Record<string, unknown> | null): Promise<void> {
    await adminDb.doc(`users/${uid}`).set({
      ...standard(),
      emailLower: `${uid}@example.org`,
      displayName: null,
      personId: null,
      status: "active",
      mfaEnrolled: true,
      lastSeenAt: Timestamp.now(),
      dataOrigin: "demo",
    });
    await adminDb.doc(`roleAssignments/${uid}__lab_coordinator__laboratory__lab-a`).set({
      ...standard(),
      uid,
      role: "lab_coordinator",
      scopeType: "laboratory",
      scopeId: "lab-a",
      status: "active",
      grantedBy: "system:test",
      grantedAt: Timestamp.now(),
      expiresAt: null,
      revokedBy: null,
      revokedAt: null,
      history: [],
    });
    if (access !== null) await adminDb.doc(`access/${uid}`).set({ ...standard(), ...emptyAccess(), ...access });
  }
  const accessOf = async (uid: string) => accessDocSchema.parse((await adminDb.doc(`access/${uid}`).get()).data());

  it("resolves every access document again: creates a missing one, corrects a stale one, leaves a right one alone", async () => {
    await accountWithRole("uid-missing", null);
    // A document from before the two arrays for contact details existed, with a role that was revoked since.
    await accountWithRole("uid-stale", {
      member: true,
      leadReplicationIds: ["StudyGone1999"],
      scopeKeys: ["rep:StudyGone1999"],
    });
    await adminDb.doc("users/uid-suspended").set({
      ...standard(),
      emailLower: "uid-suspended@example.org",
      displayName: null,
      personId: null,
      status: "suspended",
      mfaEnrolled: false,
      lastSeenAt: Timestamp.now(),
      dataOrigin: "demo",
    });
    await adminDb
      .doc("access/uid-suspended")
      .set({ ...standard(), ...emptyAccess(), member: true, scopeKeys: ["members"] });

    const first = runCli(["access:rebuild"]);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("1 created, 2 updated, 0 unchanged");

    for (const uid of ["uid-missing", "uid-stale"]) {
      const access = await accessOf(uid);
      expect(access).toMatchObject({
        member: true,
        coordinatorLaboratoryIds: ["lab-a"],
        contactLaboratoryIds: ["lab-a"],
        leadReplicationIds: [],
        scopeKeys: ["lab:lab-a", "members", "role:lab_coordinator", `user:${uid}`],
        updatedBy: "system:accessRebuild",
      });
      expect(can(access, "labs.manage", { laboratoryId: "lab-a" })).toBe(true);
    }
    expect(await accessOf("uid-suspended")).toMatchObject({
      suspended: true,
      member: false,
      scopeKeys: [],
      capabilities: {},
    });

    // A second run finds every document in line and writes nothing.
    const before = (await adminDb.collection("access").get()).docs.map((document) => document.updateTime.toMillis());
    const second = runCli(["access:rebuild"]);
    expect(second.stdout).toContain("0 created, 0 updated, 3 unchanged");
    expect((await adminDb.collection("access").get()).docs.map((document) => document.updateTime.toMillis())).toEqual(
      before,
    );
  });

  it("reports a document that does not fit its schema, which confers nothing", async () => {
    await accountWithRole("uid-damaged", null);
    await adminDb
      .doc("roleAssignments/uid-damaged__programme_admin__programme__eegmanylabs")
      .set({ uid: "uid-damaged", role: "programme_admin", status: "active" });

    const result = runCli(["access:rebuild"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("roleAssignments/uid-damaged__programme_admin__programme__eegmanylabs");
    expect((await accessOf("uid-damaged")).programmeRoles).toEqual([]);
  });

  it("refuses an option it does not know, and a target that is no emulator", () => {
    expect(runCli(["access:rebuild", "--everything"]).status).toBe(2);
    const withoutTarget = runCli(["access:rebuild"], {});
    expect(withoutTarget.status).toBe(2);
    expect(withoutTarget.stderr).toContain("Refusing to run");
  });
});
