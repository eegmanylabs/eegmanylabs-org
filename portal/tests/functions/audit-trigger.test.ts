// Integration tests of the audit trigger (decision D-007), run against the emulators: what it
// records, what it withholds, what it leaves to the functions, and what a second delivery does.
// Fixtures are synthetic: fictitious accounts and records, with addresses on the example.org domain.
import {
  type AuditEvent,
  auditEventSchema,
  COLLECTION_ENTRIES,
  FUNCTIONS_REGION,
  userWriteContext,
} from "@eegml/shared";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { writeAudit } from "../../functions/src/framework/audit";
import { recordWrite } from "../../functions/src/triggers/audit";
import {
  auditChangesOf,
  auditedActorOf,
  claimedAuditEntry,
  coveredByAuditTrigger,
  type ObservedWrite,
  planAuditEntry,
} from "../../functions/src/triggers/audit-entry";
import { adminDb } from "../support/admin";
import { createTestClient, signInWithEmailLinkFromEmulator, type TestClient } from "../support/client";
import { FUNCTIONS_URL, HOST, PORTS, PROJECT_ID } from "../support/emulators";
import { auditOfPath, eventually, laboratory, resetWorld, settle, standard, withTriggers } from "./support";

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const clients: TestClient[] = [];

withTriggers();
beforeEach(resetWorld);

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
});

/** A member signed in through the Authentication emulator, with the Firestore of the web SDK. */
async function signedInMember(email: string) {
  const client = createTestClient();
  clients.push(client);
  const user = await signInWithEmailLinkFromEmulator(client, email);
  await adminDb.doc(`access/${user.uid}`).set({
    ...standard(),
    member: true,
    personId: null,
    programmeRoles: [],
    leadReplicationIds: [],
    teamReplicationIds: [],
    coordinatorLaboratoryIds: [],
    memberLaboratoryIds: [],
    contactReplicationIds: [],
    contactLaboratoryIds: [],
    groupKeys: [],
    scopeKeys: ["members", `user:${user.uid}`],
    manageScopeKeys: [],
    sharedRecordKeys: [],
    editableRecordKeys: [],
    pendingRoles: [],
    capabilities: {},
    mfaEnrolled: false,
    secondFactorRequired: false,
    sessionsValidAfter: null,
    suspended: false,
  });
  const db = getFirestore(client.app);
  connectFirestoreEmulator(db, HOST, PORTS.firestore);
  return { uid: user.uid, db };
}

const entriesOf = (path: string, count: number) =>
  eventually(async () => {
    const entries = await auditOfPath(path);
    return entries.length >= count ? entries : null;
  }, `${count} audit entries about ${path}`);

const byAction = (entries: AuditEvent[], action: AuditEvent["action"]) =>
  entries.find((entry) => entry.action === action);

describe("what the audit trigger covers", () => {
  it("is every collection that the registry flags as audited and lets clients write, and no other", () => {
    const covered = COLLECTION_ENTRIES.filter(coveredByAuditTrigger).map((entry) => entry.key);
    expect(covered).toEqual(
      COLLECTION_ENTRIES.filter((entry) => entry.flags.audited && entry.write.mode === "client").map(
        (entry) => entry.key,
      ),
    );
    expect(covered).toEqual(
      expect.arrayContaining(["persons", "personAddress", "laboratoryMembers", "correctionRequests", "userFavourites"]),
    );
    for (const key of [
      "users",
      "access",
      "roleAssignments",
      "auditEvents",
      "userNotifications",
      "userRecents",
      "personContact",
      "personDemographics",
    ]) {
      expect(covered).not.toContain(key);
    }
  });

  it("records nothing for a collection outside it, and nothing for a path the registry does not know", async () => {
    await adminDb
      .doc("roleAssignments/uid-1__core_team__programme__eegmanylabs")
      .set({ uid: "uid-1", role: "core_team" });
    await adminDb
      .doc("users/uid-1/recents/person__person-1")
      .set({ uid: "uid-1", entityType: "person", entityId: "person-1" });
    await adminDb.doc("bootstrapAdmins/00000000000000000000").set({ usedAt: null });
    await adminDb.doc("somethingElse/entirely").set({ value: 1 });
    await settle();
    const audited = await adminDb.collection("auditEvents").get();
    expect(
      audited.docs
        .map((entry) => entry.get("documentPath"))
        .filter((path: string) => !path.startsWith("countCategories/")),
    ).toEqual([]);
  });
});

describe("a write that a client makes under the security rules", () => {
  it("is recorded with its actor, its operation, its path and the values before and after", async () => {
    const { uid, db } = await signedInMember("audited.member@example.org");
    const path = `users/${uid}/favourites/person__person-1`;
    const stamp = { updatedAt: serverTimestamp(), updatedBy: uid, writeContext: userWriteContext() };

    await setDoc(doc(db, path), {
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      createdBy: uid,
      archivedAt: null,
      ...stamp,
      uid,
      entityType: "person",
      entityId: "person-1",
    });
    await updateDoc(doc(db, path), { archivedAt: serverTimestamp(), ...stamp });
    await deleteDoc(doc(db, path));

    const entries = await entriesOf(path, 3);
    expect(entries).toHaveLength(3);
    const created = byAction(entries, "document.created");
    expect(created).toMatchObject({
      actorUid: uid,
      actorKind: "user",
      createdBy: uid,
      documentPath: path,
      entityType: "user",
      entityId: uid,
      context: { origin: "user", depth: 0 },
    });
    expect(created?.changes).toEqual([
      { field: "archivedAt", after: null },
      { field: "entityId", after: "person-1" },
      { field: "entityType", after: "person" },
      { field: "uid", after: uid },
    ]);
    const updated = byAction(entries, "document.updated");
    expect(updated?.actorUid).toBe(uid);
    expect(updated?.changes.map((change) => change.field)).toEqual(["archivedAt"]);
    expect(updated?.changes[0]?.before).toBeNull();
    expect(updated?.changes[0]?.after).toBeInstanceOf(Timestamp);
    // A deletion leaves no document. Its last state is recorded, and the emulator names no principal.
    const deleted = byAction(entries, "document.deleted");
    expect(deleted).toMatchObject({ actorKind: "system", actorUid: null, documentPath: path });
    expect(deleted?.changes.map((change) => change.field)).toEqual(["archivedAt", "entityId", "entityType", "uid"]);
    expect(deleted?.changes.every((change) => !("after" in change))).toBe(true);
  });

  it("is recorded without a value where the document is restricted", async () => {
    const { uid, db } = await signedInMember("private.member@example.org");
    await adminDb.doc("persons/person-own").set({ ...standard(), userId: uid, displayName: "Synthetic Person" });
    const path = "persons/person-own/private/address";

    await setDoc(doc(db, path), {
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      archivedAt: null,
      writeContext: userWriteContext(),
      postalAddress: "1 Synthetic Street, Exampletown",
    });

    const [entry] = await entriesOf(path, 1);
    expect(entry).toMatchObject({
      actorUid: uid,
      action: "document.created",
      entityType: "person",
      entityId: "person-own",
    });
    expect(entry?.changes).toEqual([
      { field: "archivedAt", withheld: true },
      { field: "postalAddress", withheld: true },
    ]);
    expect(JSON.stringify(entry)).not.toContain("Synthetic Street");
  });
});

describe("a write that trusted code makes outside a callable function", () => {
  it("is recorded as the work of its origin, with the chain of writes it belongs to", async () => {
    await adminDb.doc("laboratories/lab-imported").set({
      ...standard(),
      createdBy: "system:import",
      updatedBy: "system:import",
      writeContext: { origin: "import", depth: 0, correlationId: "batch-1", causationId: null, auditEventId: null },
      slug: "lab-imported",
      name: "Synthetic Laboratory",
      status: "active",
      custom: { contactEmail: "lab.office@example.org", note: { genderSource: "synthetic term" } },
      dataOrigin: "importedHistorical",
    });

    const [entry] = await entriesOf("laboratories/lab-imported", 1);
    expect(entry).toMatchObject({
      actorKind: "import",
      actorUid: null,
      createdBy: "system:import",
      action: "document.created",
      entityType: "laboratory",
      entityId: "lab-imported",
      context: { origin: "import", correlationId: "batch-1" },
    });
    expect(entry?.changes).toContainEqual({ field: "name", after: "Synthetic Laboratory" });
    // A field that names an address or a special category is withheld wherever it sits.
    expect(entry?.changes).toContainEqual({
      field: "custom",
      after: { contactEmail: "[withheld]", note: { genderSource: "[withheld]" } },
    });
    expect(JSON.stringify(entry)).not.toMatch(/lab\.office|synthetic term/);
  });
});

describe("a write that a callable function has audited itself", () => {
  it("is passed over, while a write that only names an entry is recorded", async () => {
    await laboratory("lab-a");
    await entriesOf("laboratories/lab-a", 1);

    // A function changes the laboratory and writes its audit entry in the same transaction.
    const functionEntry = await adminDb.runTransaction(async (transaction) => {
      const id = writeAudit(
        transaction,
        {
          action: "labClaim.approved",
          actor: { kind: "user", uid: "uid-reviewer" },
          entityType: "laboratory",
          entityId: "lab-a",
          at: new Date(),
        },
        adminDb,
      );
      transaction.update(adminDb.doc("laboratories/lab-a"), {
        name: "Renamed by a function",
        updatedBy: "uid-reviewer",
        writeContext: userWriteContext(id),
      });
      return id;
    });
    // A later write keeps the name of that entry and is no part of it: a client under the rules
    // could not, and trusted code that forgot to clear the context still would be recorded.
    await adminDb.doc("laboratories/lab-a").update({ name: "Renamed afterwards" });
    // A write that names an entry which does not exist proves nothing either.
    await adminDb
      .doc("laboratories/lab-a")
      .update({ name: "Renamed once more", writeContext: userWriteContext("no-such-entry") });

    const entries = await entriesOf("laboratories/lab-a", 4);
    await settle();
    const all = await auditOfPath("laboratories/lab-a");
    expect(all).toHaveLength(4);
    expect(
      all.filter((entry) => entry.action === "labClaim.approved").map((entry) => entry.writeContext.auditEventId),
    ).toEqual([functionEntry]);
    const names = entries
      .filter((entry) => entry.action === "document.updated")
      .map((entry) => entry.changes.find((change) => change.field === "name")?.after);
    // The change that the function made appears once, in the function's own entry, and never in an entry of the trigger.
    expect(names.sort()).toEqual(["Renamed afterwards", "Renamed once more"]);
  });

  it("decides from the audit entry that a write names, and from nothing a client could set", () => {
    const context = (auditEventId: string | null) => ({ writeContext: userWriteContext(auditEventId) });
    expect(claimedAuditEntry({ before: null, after: context("entry-1") })).toBe("entry-1");
    expect(claimedAuditEntry({ before: context("entry-1"), after: context("entry-2") })).toBe("entry-2");
    expect(claimedAuditEntry({ before: context(null), after: context("entry-1") })).toBe("entry-1");
    // The rules make a client write clear the context, and a name that was there before says nothing.
    expect(claimedAuditEntry({ before: context("entry-1"), after: context(null) })).toBeNull();
    expect(claimedAuditEntry({ before: context("entry-1"), after: context("entry-1") })).toBeNull();
    expect(claimedAuditEntry({ before: context("entry-1"), after: null })).toBeNull();
    expect(claimedAuditEntry({ before: null, after: { name: "no context at all" } })).toBeNull();
  });
});

describe("a second delivery of the same event", () => {
  const write: ObservedWrite = {
    eventId: "event-redelivered-1",
    documentPath: "laboratories/lab-x",
    before: { name: "Old name", updatedBy: "uid-writer", writeContext: userWriteContext() },
    after: { name: "New name", updatedBy: "uid-writer", writeContext: userWriteContext() },
    authType: "unknown",
    authId: null,
    time: new Date("2026-03-04T05:06:07Z"),
  };

  it("writes one entry, named after the event, however often the handler runs", async () => {
    expect(await recordWrite(adminDb, write, logger)).toBe("recorded");
    const first = await adminDb.doc("auditEvents/event-redelivered-1").get();

    expect(await recordWrite(adminDb, write, logger)).toBe("duplicate");
    expect(await recordWrite(adminDb, { ...write, after: { ...write.after, name: "Another name" } }, logger)).toBe(
      "duplicate",
    );

    const again = await adminDb.doc("auditEvents/event-redelivered-1").get();
    expect(again.updateTime?.isEqual(first.updateTime as Timestamp)).toBe(true);
    expect(auditEventSchema.parse(again.data())).toMatchObject({
      actorUid: "uid-writer",
      action: "document.updated",
      changes: [{ field: "name", before: "Old name", after: "New name" }],
      writeContext: { auditEventId: "event-redelivered-1" },
    });
    expect(again.get("createdAt").toDate().toISOString()).toBe("2026-03-04T05:06:07.000Z");
    expect(await auditOfPath("laboratories/lab-x")).toHaveLength(1);
  });

  it("is harmless when the platform delivers the event to the deployed trigger three times", async () => {
    const event = {
      specversion: "1.0",
      id: "event-delivered-by-hand-1",
      source: `//firestore.googleapis.com/projects/${PROJECT_ID}/databases/(default)`,
      type: "google.cloud.firestore.document.v1.written.withAuthContext",
      datacontenttype: "application/json",
      time: "2026-03-04T05:06:07.000Z",
      subject: "documents/laboratories/lab-y",
      location: FUNCTIONS_REGION,
      project: PROJECT_ID,
      database: "(default)",
      namespace: "(default)",
      document: "laboratories/lab-y",
      // What production is expected to send for a person signed in through Firebase Authentication.
      authtype: "app_user",
      authid: "uid-from-the-platform",
      data: {
        oldValue: {},
        value: {
          name: `projects/${PROJECT_ID}/databases/(default)/documents/laboratories/lab-y`,
          fields: {
            name: { stringValue: "Lab Y" },
            updatedBy: { stringValue: "uid-in-the-document" },
            writeContext: { mapValue: { fields: { origin: { stringValue: "user" }, depth: { integerValue: "0" } } } },
          },
          createTime: "2026-03-04T05:06:07.000Z",
          updateTime: "2026-03-04T05:06:07.000Z",
        },
      },
    };
    // The functions emulator names a trigger with the number of times it has loaded its
    // triggers, which grows whenever a suite switches them off and on again. The answer to a
    // request for a trigger that does not exist lists the names, and the highest number is in use.
    const listing = await fetch(`${FUNCTIONS_URL}/functions/projects/${PROJECT_ID}/triggers/no-such-trigger`, {
      method: "POST",
    });
    const loaded = [
      ...(await listing.text()).matchAll(new RegExp(`${FUNCTIONS_REGION}-auditDocumentWrites-(\\d+)`, "g")),
    ];
    const generation = Math.max(...loaded.map((match) => Number(match[1])));
    const deliver = () =>
      fetch(
        `${FUNCTIONS_URL}/functions/projects/${PROJECT_ID}/triggers/${FUNCTIONS_REGION}-auditDocumentWrites-${generation}`,
        { method: "POST", headers: { "content-type": "application/cloudevents+json" }, body: JSON.stringify(event) },
      );

    expect((await deliver()).status).toBe(200);
    const first = await eventually(async () => {
      const snapshot = await adminDb.doc("auditEvents/event-delivered-by-hand-1").get();
      return snapshot.exists ? snapshot : null;
    }, "the entry of the first delivery");
    expect((await deliver()).status).toBe(200);
    expect((await deliver()).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const again = await adminDb.doc("auditEvents/event-delivered-by-hand-1").get();
    expect(again.updateTime?.isEqual(first.updateTime as Timestamp)).toBe(true);
    expect(await auditOfPath("laboratories/lab-y")).toHaveLength(1);
    // The principal that the platform names is the actor, whatever the document says.
    expect(auditEventSchema.parse(again.data())).toMatchObject({
      actorUid: "uid-from-the-platform",
      actorKind: "user",
      action: "document.created",
      entityType: "laboratory",
      entityId: "lab-y",
    });
  });
});

describe("the entry of the audit trigger", () => {
  it("names the actor from the document, and from the platform where the platform names a person", () => {
    const written = (updatedBy: string, origin = "user") => ({ updatedBy, writeContext: { origin, depth: 0 } });
    expect(auditedActorOf({ after: written("uid-a"), authType: "unknown", authId: "emulator-placeholder" })).toEqual({
      actorKind: "user",
      actorUid: "uid-a",
      mismatch: false,
    });
    expect(auditedActorOf({ after: written("uid-a"), authType: "app_user", authId: "uid-a" })).toMatchObject({
      actorUid: "uid-a",
      mismatch: false,
    });
    expect(auditedActorOf({ after: written("uid-forged"), authType: "app_user", authId: "uid-real" })).toEqual({
      actorKind: "user",
      actorUid: "uid-real",
      mismatch: true,
    });
    expect(
      auditedActorOf({ after: written("system:import", "import"), authType: "service_account", authId: "importer" }),
    ).toEqual({
      actorKind: "import",
      actorUid: null,
      mismatch: false,
    });
    expect(auditedActorOf({ after: null, authType: "app_user", authId: "uid-deleter" })).toMatchObject({
      actorUid: "uid-deleter",
    });
    expect(auditedActorOf({ after: null, authType: "unknown", authId: null })).toEqual({
      actorKind: "system",
      actorUid: null,
      mismatch: false,
    });
  });

  it("records a large value as its size and its hash, and leaves the stamps of a write out", () => {
    const large = "x".repeat(20_000);
    const changes = auditChangesOf(
      { dataClass: "member" },
      { description: "short", updatedAt: 1, updatedBy: "uid-a", writeContext: {}, archivedAt: null },
      { description: large, updatedAt: 2, updatedBy: "uid-b", writeContext: { depth: 1 }, archivedAt: null },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "description", before: "short", after: { sizeBytes: 20_002 } });
    expect(JSON.stringify(changes)).not.toContain("xxxx");
  });

  it("withholds every value of a special-category document, and names no record for a lookup", () => {
    const special = { genderSource: "synthetic term", ethnicitySource: "another synthetic term" };
    expect(auditChangesOf({ dataClass: "special" }, null, special)).toEqual([
      { field: "ethnicitySource", withheld: true },
      { field: "genderSource", withheld: true },
    ]);
    const base = { eventId: "event-1", authType: "unknown", authId: null, time: new Date() };
    expect(
      planAuditEntry({ ...base, documentPath: "persons/p1/special/demographics", before: null, after: special }),
    ).toBeNull();
    expect(
      planAuditEntry({ ...base, documentPath: "countCategories/tested", before: null, after: { label: "Tested" } }),
    ).toMatchObject({ entityType: null, entityId: null, action: "document.created" });
    expect(
      planAuditEntry({
        ...base,
        documentPath: "replications/StudyA2001/hypotheses/h01",
        before: { text: "a" },
        after: { text: "b" },
      }),
    ).toMatchObject({ entityType: "hypothesis", entityId: "StudyA2001__h01", action: "document.updated" });
    expect(
      planAuditEntry({
        ...base,
        documentPath: "persons/p1/private/address",
        before: { postalAddress: "a" },
        after: null,
      }),
    ).toMatchObject({
      entityType: "person",
      entityId: "p1",
      action: "document.deleted",
      changes: [{ field: "postalAddress", withheld: true }],
    });
  });
});
