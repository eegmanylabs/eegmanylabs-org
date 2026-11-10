// Integration tests of the bootstrap of the first programme administrators, run against the
// emulators: the record that `admin:bootstrap` stores, and what `sessionStart` does with it.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import {
  BOOTSTRAP_ADMINS_COLLECTION,
  bootstrapAdminId,
  bootstrapAdminPath,
  bootstrapAdminRecordSchema,
  can,
  DEMO_IDENTITY_HASH_KEY,
  roleAssignmentDocSchema,
  sessionStartContract,
  userDocSchema,
} from "@eegml/shared";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdministrator } from "../../tools/src/commands/admin-bootstrap";
import { adminDb } from "../support/admin";
import { createTestClient, signInWithEmailLinkFromEmulator } from "../support/client";
import { HOST, PORTS } from "../support/emulators";
import { accessOf, account, auditOf, type Caller, call, codeOf, dataOf, leaveNoTrace, resetWorld } from "./support";

const ADDRESS = "First.Administrator@example.org";
const recordPath = (email: string) => bootstrapAdminPath(bootstrapAdminId(email, DEMO_IDENTITY_HASH_KEY));
const ASSIGNMENT = "roleAssignments/uid-first__programme_admin__programme__eegmanylabs";
const first: Caller = { uid: "uid-first", email: ADDRESS };

beforeEach(resetWorld);

afterAll(leaveNoTrace);

describe("a bootstrap record", () => {
  it("is stored under the keyed hash of the address and holds no address", async () => {
    expect(await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY)).toBe("created");

    const stored = await adminDb.collection(BOOTSTRAP_ADMINS_COLLECTION).get();
    expect(stored.docs.map((document) => document.ref.path)).toEqual([recordPath("first.administrator@example.org")]);
    const record = bootstrapAdminRecordSchema.parse(stored.docs[0]?.data());
    expect(record).toMatchObject({ usedAt: null, usedBy: null, createdBy: "system:adminBootstrap" });
    expect(`${stored.docs[0]?.id} ${JSON.stringify(stored.docs[0]?.data())}`.toLowerCase()).not.toMatch(
      /administrator|example\.org|@/,
    );
    // A second run finds the record and writes nothing.
    const before = stored.docs[0]?.updateTime;
    expect(await bootstrapAdministrator(adminDb, ` ${ADDRESS.toUpperCase()} `, DEMO_IDENTITY_HASH_KEY)).toBe("waiting");
    expect((await adminDb.doc(recordPath(ADDRESS)).get()).updateTime?.isEqual(before as never)).toBe(true);
  });

  it("can be neither read nor written by a signed-in client", async () => {
    await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY);
    const client = createTestClient();
    try {
      await signInWithEmailLinkFromEmulator(client, "curious.member@example.org");
      const db = getFirestore(client.app);
      connectFirestoreEmulator(db, HOST, PORTS.firestore);
      const record = doc(db, recordPath(ADDRESS));
      await expect(getDoc(record)).rejects.toMatchObject({ code: "permission-denied" });
      await expect(setDoc(record, { usedAt: null })).rejects.toMatchObject({ code: "permission-denied" });
      await expect(
        setDoc(doc(db, recordPath("curious.member@example.org")), { usedAt: null, usedBy: null }),
      ).rejects.toMatchObject({ code: "permission-denied" });
    } finally {
      await client.close();
    }
  });
});

describe("sessionStart and a bootstrap record", () => {
  it("makes the first account with the verified address a programme administrator, once, and audits it", async () => {
    await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY);

    expect(await call(first, sessionStartContract, {})).toEqual({ member: true, personId: null });

    const assignment = roleAssignmentDocSchema.parse(await dataOf(ASSIGNMENT));
    expect(assignment).toMatchObject({
      uid: "uid-first",
      role: "programme_admin",
      scopeType: "programme",
      scopeId: "eegmanylabs",
      status: "active",
      grantedBy: "uid-first",
      expiresAt: null,
    });
    const record = bootstrapAdminRecordSchema.parse(await dataOf(recordPath(ADDRESS)));
    expect(record.usedBy).toBe("uid-first");
    expect(record.usedAt?.toMillis()).toBe(assignment.grantedAt?.toMillis());

    const [entry] = await auditOf("admin.bootstrapped", "uid-first");
    expect(entry).toMatchObject({ actorUid: "uid-first", entityType: "user", documentPath: "users/uid-first" });
    expect(assignment.writeContext.auditEventId).toBe(entry?.writeContext.auditEventId);
    expect(record.writeContext.auditEventId).toBe(entry?.writeContext.auditEventId);
    expect(await auditOf("account.created", "uid-first")).toHaveLength(1);

    // The access document is written in the same transaction. No second factor is enrolled yet,
    // so it names the role and withholds its powers.
    const access = await accessOf("uid-first");
    expect(access).toMatchObject({
      programmeRoles: ["programme_admin"],
      secondFactorRequired: true,
      mfaEnrolled: false,
    });
    expect(access.capabilities).toEqual({});

    // A later call changes nothing, and the record serves nobody else.
    await call(first, sessionStartContract, {});
    expect(await auditOf("admin.bootstrapped")).toHaveLength(1);
    expect(await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY)).toBe("used");
  });

  it("puts the powers of the role in effect once the session presents the second factor", async () => {
    await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY);
    await call(first, sessionStartContract, {});
    expect(can(await accessOf("uid-first"), "roles.manage", "programme")).toBe(false);

    await call({ ...first, secondFactor: true }, sessionStartContract, {});

    expect(userDocSchema.parse(await dataOf("users/uid-first")).mfaEnrolled).toBe(true);
    const access = await accessOf("uid-first");
    expect(access).toMatchObject({ mfaEnrolled: true, secondFactorRequired: true });
    expect(can(access, "roles.manage", "programme")).toBe(true);
    expect(await auditOf("account.secondFactorChanged", "uid-first")).toHaveLength(1);
  });

  it("serves an account that was registered before the record was stored", async () => {
    await call(first, sessionStartContract, {});
    expect((await accessOf("uid-first")).programmeRoles).toEqual([]);
    await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY);

    expect(await call(first, sessionStartContract, {})).toEqual({ member: true, personId: null });
    expect((await accessOf("uid-first")).programmeRoles).toEqual(["programme_admin"]);
  });

  it("never matches an address that the sign-in provider has not verified", async () => {
    await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY);

    expect(await codeOf(call({ ...first, emailVerified: false }, sessionStartContract, {}))).toBe(
      "failed-precondition",
    );

    expect(await dataOf(ASSIGNMENT)).toBeUndefined();
    expect(await dataOf(recordPath(ADDRESS))).toMatchObject({ usedAt: null, usedBy: null });
    expect(await auditOf("admin.bootstrapped")).toHaveLength(0);
  });

  it("gives nothing to an account with another address, and nothing a second time", async () => {
    await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY);
    const other: Caller = { uid: "uid-other", email: "another.administrator@example.org" };

    expect(await call(other, sessionStartContract, {})).toEqual({ member: false, personId: null });
    expect((await accessOf("uid-other")).programmeRoles).toEqual([]);

    await call(first, sessionStartContract, {});
    // Another account that comes to hold the same address later finds the record used.
    const second: Caller = { uid: "uid-second", email: ADDRESS };
    expect(await call(second, sessionStartContract, {})).toEqual({ member: false, personId: null });
    expect((await accessOf("uid-second")).programmeRoles).toEqual([]);
    expect(await auditOf("admin.bootstrapped")).toHaveLength(1);
  });

  it("gives one role when eight calls arrive at the same moment", async () => {
    await bootstrapAdministrator(adminDb, ADDRESS, DEMO_IDENTITY_HASH_KEY);
    await account("uid-bystander");

    await Promise.all(Array.from({ length: 8 }, () => call(first, sessionStartContract, {})));

    expect(roleAssignmentDocSchema.parse(await dataOf(ASSIGNMENT)).history).toEqual([]);
    expect(await auditOf("admin.bootstrapped")).toHaveLength(1);
    expect((await adminDb.collection("roleAssignments").get()).size).toBe(1);
  });
});
