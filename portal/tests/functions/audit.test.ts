// Integration tests for the audit helper, run against the Firestore emulator.
// Fixtures are synthetic: invented identifiers, no real account.
import { auditEventSchema } from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuditEntry, auditEventId, withheldChanges, writeAudit } from "../../functions/src/framework/audit";
import { adminDb } from "../support/admin";
import { clearFirestore } from "../support/emulators";
import { withoutTriggers } from "./support";

withoutTriggers();
beforeEach(async () => {
  await clearFirestore();
});

const entry = {
  action: "account.created",
  actor: { kind: "system" },
  entityType: "user",
  entityId: "uid-synthetic",
  at: new Date("2026-03-04T05:06:07Z"),
} as const satisfies AuditEntry;

describe("writeAudit", () => {
  it("writes nothing until the batch commits", async () => {
    const batch = adminDb.batch();
    const id = writeAudit(batch, entry, adminDb);
    expect((await adminDb.doc(`auditEvents/${id}`).get()).exists).toBe(false);
    await batch.commit();
    expect((await adminDb.doc(`auditEvents/${id}`).get()).exists).toBe(true);
  });

  it("stores an entry in the shape of the data model, made by trusted code", async () => {
    const batch = adminDb.batch();
    const id = writeAudit(batch, { ...entry, changes: withheldChanges(["status", "emailLower"]) }, adminDb);
    await batch.commit();

    const stored = auditEventSchema.parse((await adminDb.doc(`auditEvents/${id}`).get()).data());
    expect(stored).toMatchObject({
      schemaVersion: 1,
      createdBy: "system:system",
      actorUid: null,
      actorKind: "system",
      action: "account.created",
      documentPath: "users/uid-synthetic",
      entityType: "user",
      entityId: "uid-synthetic",
      changes: [
        { field: "emailLower", withheld: true },
        { field: "status", withheld: true },
      ],
      context: {
        origin: "system",
        depth: 0,
        correlationId: null,
        causationId: null,
        requestId: null,
        ipHash: null,
        userAgent: null,
      },
      // The entry names itself, as every document written with it does.
      writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: id },
    });
    expect(stored.createdAt.toDate().toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });

  it("names the account when a person made the change, and copies the chain of writes into the context", async () => {
    const batch = adminDb.batch();
    const id = writeAudit(
      batch,
      {
        ...entry,
        actor: { kind: "user", uid: "uid-actor" },
        context: { depth: 2, correlationId: "chain-1", causationId: "event-0", requestId: "request-1" },
      },
      adminDb,
    );
    await batch.commit();

    const stored = auditEventSchema.parse((await adminDb.doc(`auditEvents/${id}`).get()).data());
    expect(stored).toMatchObject({
      createdBy: "uid-actor",
      actorUid: "uid-actor",
      actorKind: "user",
      context: { origin: "user", depth: 2, correlationId: "chain-1", causationId: "event-0", requestId: "request-1" },
      writeContext: { origin: "user", depth: 2, correlationId: "chain-1", causationId: "event-0", auditEventId: id },
    });
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

  it("refuses an action that is not in the registry", () => {
    const batch = adminDb.batch();
    expect(() => writeAudit(batch, { ...entry, action: "made.up" as never }, adminDb)).toThrow();
  });

  it("refuses an entity type that is not in the registry", () => {
    const batch = adminDb.batch();
    expect(() => writeAudit(batch, { ...entry, entityType: "spaceship" as never }, adminDb)).toThrow();
  });
});
