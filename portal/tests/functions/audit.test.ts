// Integration tests for the audit helper, run against the Firestore emulator.
import { auditEventSchema, SYSTEM_ACTOR } from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEventId, writeAudit } from "../../functions/src/framework/audit";
import { adminDb } from "../support/admin";
import { clearFirestore } from "../support/emulators";

beforeEach(async () => {
  await clearFirestore();
});

const entry = {
  type: "account.created",
  actor: SYSTEM_ACTOR,
  targetPath: "access/uid-synthetic",
  occurredAt: new Date("2026-03-04T05:06:07Z"),
} as const;

describe("writeAudit", () => {
  it("writes nothing until the batch commits", async () => {
    const batch = adminDb.batch();
    const id = writeAudit(batch, entry, adminDb);
    expect((await adminDb.doc(`auditEvents/${id}`).get()).exists).toBe(false);
    await batch.commit();
    expect((await adminDb.doc(`auditEvents/${id}`).get()).exists).toBe(true);
  });

  it("stores an entry that matches the shared schema, with the system actor", async () => {
    const batch = adminDb.batch();
    const id = writeAudit(batch, { ...entry, details: { reason: "test" } }, adminDb);
    await batch.commit();

    const stored = auditEventSchema.parse((await adminDb.doc(`auditEvents/${id}`).get()).data());
    expect(stored).toMatchObject({
      schemaVersion: 1,
      type: "account.created",
      actor: { kind: "system", id: "system" },
      targetPath: "access/uid-synthetic",
      details: { reason: "test" },
      idempotencyKey: null,
    });
    expect(stored.occurredAt.toDate().toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });

  it("gives every entry without an idempotency key an identifier of its own", async () => {
    const batch = adminDb.batch();
    const first = writeAudit(batch, entry, adminDb);
    const second = writeAudit(batch, entry, adminDb);
    await batch.commit();

    expect(first).not.toBe(second);
    expect((await adminDb.collection("auditEvents").get()).size).toBe(2);
  });

  it("derives the identifier from the idempotency key, so a repeat adds no second entry", async () => {
    const keyed = { ...entry, idempotencyKey: "import:run-7:row-12" };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const batch = adminDb.batch();
      expect(writeAudit(batch, keyed, adminDb)).toBe(auditEventId("import:run-7:row-12"));
      await batch.commit();
    }
    expect((await adminDb.collection("auditEvents").get()).size).toBe(1);
  });

  it("works inside a transaction", async () => {
    const id = await adminDb.runTransaction(async (transaction) => writeAudit(transaction, entry, adminDb));
    expect((await adminDb.doc(`auditEvents/${id}`).get()).exists).toBe(true);
  });

  it("refuses an event type that is not in the registry", () => {
    const batch = adminDb.batch();
    expect(() => writeAudit(batch, { ...entry, type: "made.up" as never }, adminDb)).toThrow();
  });
});
