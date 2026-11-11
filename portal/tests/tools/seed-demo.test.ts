// Integration tests for the seed:demo tool, run against the emulators.
// Fixtures are synthetic: the demonstration world is fictitious and every address in it uses the example.org domain.
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import {
  APPEND_ONLY_BASE_FIELDS,
  accessDocSchema,
  bootstrapAdminId,
  DEMO_IDENTITY_HASH_KEY,
  emptyAccess,
  entryOfDocumentPath,
  personEmailIndexId,
  userDocSchema,
} from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { demoDocuments } from "../../tools/src/commands/seed-demo";
import { DEMO_ACCOUNTS } from "../../tools/src/fixtures/demo-accounts";
import { DEMO_BOOTSTRAP_ADMIN_EMAIL, DEMO_PERSONS, DEMO_REPLICATIONS } from "../../tools/src/fixtures/demo-world";
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

/** What a first run creates: every document of the world, and an account and an access document for each demonstration account. */
const WORLD_SIZE = 210;

/** Every document names the command as its author, as trusted code acting by itself. */
const STANDARD = {
  schemaVersion: 1,
  createdBy: "system:seedDemo",
  updatedBy: "system:seedDemo",
  archivedAt: null,
  writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
};

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

  it("writes the demonstration accounts with their documents, all labelled as demonstration data", async () => {
    const result = runCli(["seed:demo"], withEmulators);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${WORLD_SIZE} created, 0 unchanged`);
    expect(result.stdout).toContain("Nobody in it exists.");

    expect(DEMO_ACCOUNTS).toHaveLength(2);
    for (const account of DEMO_ACCOUNTS) {
      expect(account.email).toMatch(/@example\.org$/);
      const record = await adminAuth.getUser(account.uid);
      expect(record).toMatchObject({ email: account.email, emailVerified: true, displayName: account.displayName });

      const user = userDocSchema.parse((await adminDb.doc(`users/${account.uid}`).get()).data());
      expect(user).toMatchObject({
        ...STANDARD,
        emailLower: account.email,
        displayName: account.displayName,
        personId: account.personId,
        status: "active",
        mfaEnrolled: false,
        dataOrigin: "demo",
      });

      const access = accessDocSchema.parse((await adminDb.doc(`access/${account.uid}`).get()).data());
      expect(access).toMatchObject({
        ...STANDARD,
        personId: account.personId,
        suspended: false,
        sessionsValidAfter: null,
      });
    }
    expect((await adminDb.collection("users").get()).size).toBe(2);
    expect((await adminDb.collection("access").get()).size).toBe(2);
  });

  it("resolves the access documents from the world it wrote", async () => {
    runCli(["seed:demo"], withEmulators);
    const [claimed, unclaimed] = await Promise.all(
      DEMO_ACCOUNTS.map(async (account) =>
        accessDocSchema.parse((await adminDb.doc(`access/${account.uid}`).get()).data()),
      ),
    );

    // The account that has claimed Ivy Pretend is a member of her laboratory and on the team of her replication.
    expect(claimed).toMatchObject({
      member: true,
      personId: "demo-person-ivy",
      memberLaboratoryIds: ["demo-lab-cognition"],
      coordinatorLaboratoryIds: [],
      teamReplicationIds: ["DemoGamma2010"],
      pendingRoles: [],
      programmeRoles: [],
    });
    expect(claimed?.scopeKeys).toEqual([
      "lab:demo-lab-cognition",
      "members",
      "rep:DemoGamma2010",
      "role:lab_member",
      "user:demo-account-one",
    ]);
    // The account whose address matches nobody has been granted nothing.
    expect(unclaimed).toEqual({ ...unclaimed, ...emptyAccess(), scopeKeys: ["user:demo-account-two"] });

    expect((await adminDb.doc("persons/demo-person-ivy").get()).get("userId")).toBe("demo-account-one");
    expect((await adminDb.doc("accountClaims/demo-account-one").get()).data()).toMatchObject({
      status: "approved",
      personId: "demo-person-ivy",
    });
    expect(
      (await adminDb.doc("roleAssignments/demo-account-one__lab_member__laboratory__demo-lab-cognition").get()).data(),
    ).toMatchObject({
      status: "active",
      grantedBy: "system:seedDemo",
    });
    // What `access:rebuild` resolves is what the seed wrote.
    const rebuilt = runCli(["access:rebuild"], withEmulators);
    expect(rebuilt.status).toBe(0);
    expect(rebuilt.stdout).toContain("0 created, 0 updated, 2 unchanged");
  });

  it("builds a coherent world: every document fits its schema, names the command and is synthetic", async () => {
    runCli(["seed:demo"], withEmulators);
    const documents = demoDocuments(new Date(), DEMO_IDENTITY_HASH_KEY);
    expect(documents).toHaveLength(WORLD_SIZE - 2 * DEMO_ACCOUNTS.length);

    for (const { path } of documents) {
      const stored = (await adminDb.doc(path).get()).data();
      const matched = entryOfDocumentPath(path);
      // A document of an append-only collection carries the shorter set of standard fields.
      const appendOnly = matched?.entry.flags.appendOnly === true;
      expect(stored, path).toMatchObject(
        appendOnly
          ? Object.fromEntries(Object.entries(STANDARD).filter(([field]) => APPEND_ONLY_BASE_FIELDS.includes(field)))
          : STANDARD,
      );
      if (matched === null) expect(path.startsWith("bootstrapAdmins/")).toBe(true);
      else {
        expect(matched.entry.schema.safeParse(stored).success, path).toBe(true);
        // Every fact-like document is labelled as demonstration data, the historical aggregates
        // included, so that no invented figure is shown as one of the programme's records.
        if ("dataOrigin" in matched.entry.schema.shape) expect(stored?.dataOrigin, path).toBe("demo");
      }
    }

    const sizeOf = async (collection: string) => (await adminDb.collection(collection).get()).size;
    expect(await sizeOf("persons")).toBe(12);
    expect(await sizeOf("laboratories")).toBe(4);
    expect(await sizeOf("institutions")).toBe(3);
    expect(await sizeOf("replications")).toBe(4);
    expect(await sizeOf("participations")).toBe(6);
    expect((await adminDb.collectionGroup("members").get()).size).toBe(7);
    expect((await adminDb.collectionGroup("memberships").get()).size).toBe(6);
    expect((await adminDb.collectionGroup("aliases").get()).size).toBe(8);
    expect((await adminDb.collectionGroup("hypotheses").get()).size).toBe(3);
    expect(await sizeOf("manuscripts")).toBe(2);
    expect(await sizeOf("contributors")).toBe(2);
    expect(await sizeOf("historicalAggregates")).toBe(5);
    expect(await sizeOf("documentLinks")).toBe(2);
    expect(await sizeOf("statusHistory")).toBe(1);
    // Laboratory management and the imports console have something to show: equipment with
    // history, requirements, a checklist for every participation, a source, a batch and its queue.
    expect((await adminDb.collectionGroup("equipment").get()).size).toBe(3);
    expect((await adminDb.collectionGroup("equipment").where("isCurrent", "==", true).get()).size).toBe(2);
    expect((await adminDb.collectionGroup("equipmentRequirements").get()).size).toBe(7);
    expect((await adminDb.collectionGroup("checklist").get()).size).toBe(6 * 9);
    expect(await sizeOf("sources")).toBe(2);
    expect(await sizeOf("importBatches")).toBe(1);
    expect(await sizeOf("reconciliationItems")).toBe(3);
    // The statuses that the replications name exist, because the lookup data is seeded with the world.
    const withStatus = DEMO_REPLICATIONS.filter((replication) => replication.statusKey !== null);
    expect(withStatus).toHaveLength(3);
    for (const replication of withStatus) {
      expect((await adminDb.doc(`statusDefinitions/replication__${replication.statusKey}`).get()).exists).toBe(true);
    }
    // The one replication without a status is the one the public website no longer lists.
    expect((await adminDb.doc("replications/DemoDelta2015").get()).data()).toMatchObject({
      statusKey: null,
      selectionStatus: "withdrawn",
    });
    // The latest status of Alpha names its history entry.
    expect((await adminDb.doc("replications/DemoAlpha2001").get()).get("statusHistoryId")).toBe("demo-history-alpha-1");

    // Every address is on the domain that is reserved for documentation.
    const contacts = await adminDb.collectionGroup("private").get();
    const addresses = contacts.docs.flatMap((contact) =>
      ((contact.get("emails") as { email: string }[] | undefined) ?? []).map((entry) => entry.email),
    );
    expect(addresses).toHaveLength(13);
    for (const address of addresses) expect(address).toMatch(/@example\.org$/);

    // The claim flow finds its three cases: two persons on one address, a secondary address and
    // an address that no claim may rest on.
    const index = async (address: string) =>
      (await adminDb.doc(`personEmailIndex/${personEmailIndexId(address, DEMO_IDENTITY_HASH_KEY)}`).get()).data();
    expect(await index("shared.mock@example.org")).toMatchObject({
      personIds: ["demo-person-hana", "demo-person-hugo"],
      claimEligiblePersonIds: ["demo-person-hana", "demo-person-hugo"],
    });
    expect(await index("gus.specimen.second@example.org")).toMatchObject({ personIds: ["demo-person-gus"] });
    expect(await index("kit.sampleton@example.org")).toMatchObject({
      personIds: ["demo-person-kit"],
      claimEligiblePersonIds: [],
    });
    expect((await adminDb.collection("personEmailIndex").get()).size).toBe(12);

    // The bootstrap record of the demonstration administrator holds no address.
    const bootstrap = await adminDb.collection("bootstrapAdmins").get();
    expect(bootstrap.docs.map((record) => record.id)).toEqual([
      bootstrapAdminId(DEMO_BOOTSTRAP_ADMIN_EMAIL, DEMO_IDENTITY_HASH_KEY),
    ]);
    expect(JSON.stringify(bootstrap.docs[0]?.data())).not.toContain("example.org");
    expect((await adminDb.doc("system/settings").get()).get("requireSecondFactor")).toBe(false);
  });

  it("derives the units of each person and the leads of each replication from confirmed entries alone", async () => {
    runCli(["seed:demo"], withEmulators);
    const person = async (id: string) => (await adminDb.doc(`persons/${id}`).get()).data();

    expect(await person("demo-person-ben")).toMatchObject({
      laboratoryIds: ["demo-lab-attention"],
      replicationIds: ["DemoAlpha2001"],
    });
    expect(await person("demo-person-gus")).toMatchObject({
      laboratoryIds: ["demo-lab-cognition"],
      replicationIds: ["DemoBeta2005"],
    });
    // A member entry that the person has not confirmed puts no laboratory on the person.
    expect(await person("demo-person-fay")).toMatchObject({ laboratoryIds: [], replicationIds: [] });
    // A lead that awaits review is no confirmed lead and puts no replication on the person.
    expect(await person("demo-person-dev")).toMatchObject({ laboratoryIds: ["demo-lab-signal"], replicationIds: [] });
    expect((await adminDb.doc("replications/DemoGamma2010").get()).get("leadPersonIds")).toEqual([]);
    expect((await adminDb.doc("replications/DemoAlpha2001").get()).get("leadPersonIds")).toEqual(["demo-person-ben"]);

    for (const entry of DEMO_PERSONS) {
      const stored = await person(entry.id);
      const confirmed = await adminDb
        .collectionGroup("members")
        .where("personId", "==", entry.id)
        .where("status", "==", "confirmed")
        .get();
      expect(stored?.laboratoryIds, entry.id).toEqual(
        confirmed.docs.map((document) => document.get("laboratoryId") as string).sort(),
      );
    }
  });

  it("changes nothing when it is run a second time", async () => {
    runCli(["seed:demo"], withEmulators);
    const collections = [
      "users",
      "access",
      "persons",
      "laboratories",
      "replications",
      "roleAssignments",
      "personEmailIndex",
      "bootstrapAdmins",
    ];
    const updateTimes = async () =>
      Promise.all(
        collections.map(async (collection) =>
          (await adminDb.collection(collection).get()).docs.map((document) => document.updateTime.toMillis()),
        ),
      );
    const before = await updateTimes();

    const result = runCli(["seed:demo"], withEmulators);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`0 created, ${WORLD_SIZE} unchanged`);

    expect(await updateTimes()).toEqual(before);
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
