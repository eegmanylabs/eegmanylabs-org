// Integration tests of the import framework against the Firestore emulator: snapshot, plan,
// preview, apply, idempotency, ownership of fields, the review queue, rollback and verification.
// The input is the synthetic website fixture: every study, person and address in it is invented.
import { COLLECTIONS, importBatchId, sourceRecordId } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APPLY_CHUNK_SIZE, applyDiff, ImportStopped } from "../../tools/src/import/apply";
import { createdFields, IMPORT_ACTOR } from "../../tools/src/import/context";
import {
  WEBSITE_HEADERS,
  type WebsiteFixture,
  websiteFixture,
  writeWebsiteFixture,
} from "../../tools/src/import/fixtures/website";
import { SOURCE_DEFINITIONS } from "../../tools/src/import/registry";
import { rollbackBatch } from "../../tools/src/import/rollback";
import { compute, runImport } from "../../tools/src/import/run";
import { compareSnapshot, recordRows } from "../../tools/src/import/snapshot";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { rowHash } from "../../tools/src/import/values";
import { adminDb } from "../support/admin";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  itemCounts,
  nextInstant,
  OBSERVED_ON,
  reconciliationItems,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

/** Writes the fixture, changed by `change`, to a directory of its own and returns the input of the importer. */
function input(change: (fixture: WebsiteFixture) => void = () => {}): string {
  const fixture = websiteFixture();
  change(fixture);
  return writeWebsiteFixture(temporaryDirectory(), fixture);
}

const row = (rows: readonly Record<string, string>[], key: string, value: string) => {
  const found = rows.find((candidate) => candidate[key] === value);
  if (found === undefined) throw new Error(`The fixture holds no row with ${key} ${value}.`);
  return found;
};

/** Collections that hold nothing but what an import wrote. The lookup data is in others. */
const ENTITY_COLLECTIONS = [
  "replications",
  "persons",
  "manuscripts",
  "documentLinks",
  "identityKeys",
  "institutionCandidates",
];

async function entityCount(): Promise<number> {
  const counts = await Promise.all(
    ENTITY_COLLECTIONS.map(async (name) => (await adminDb.collection(name).count().get()).data().count),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

/** The source records of the website source, by row key within a tab. */
async function sourceRecords(tabKey: string) {
  const snapshot = await adminDb
    .collection("sourceRecords")
    .where("sourceKey", "==", "h")
    .where("tabKey", "==", tabKey)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string });
}

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

describe("snapshot", () => {
  it("stores every row as a source record with its verbatim cells, keyed by its natural key and its content", async () => {
    const report = await run(website, input(), "preview");
    const replications = await sourceRecords("replications");
    expect(replications).toHaveLength(7);
    const delta = replications.find((record) => record.rowKey === "delta1999");
    const raw = delta?.raw as Record<string, unknown>;
    // The cells are stored under their headers, exactly as the file holds them.
    const cells = WEBSITE_HEADERS.replications.map((header) => raw[header]);
    expect(cells.slice(0, 7)).toEqual([
      "Delta1999",
      "Gone2022",
      "Cy Invented",
      "Attention",
      "Stage 1 Registered report in preparation",
      "4",
      "stage1_prep",
    ]);
    // An empty field is stored as an empty cell, never as an empty text.
    const gamma = replications.find((record) => record.rowKey === "alphagamma2002");
    expect(gamma?.raw).toMatchObject({ PublicationId: null, PublicationYear: "2002a" });
    const hash = rowHash(cells);
    expect(delta).toMatchObject({
      id: sourceRecordId("h", "replications", "delta1999", hash),
      rawHash: hash,
      observedOn: OBSERVED_ON,
      firstSeenBatchId: report.batchId,
      lastSeenBatchId: report.batchId,
      supersededById: null,
      createdBy: IMPORT_ACTOR,
    });
    // The row number is provenance and no part of the identity.
    expect(delta?.rowNumber).toBe(4);
    expect(report.sourceRecords).toMatchObject({ created: 4 + 6 + 5 + 8 + 7 + 7, superseded: 0, missing: 0 });
  });

  it("writes source records during a preview, and no entity", async () => {
    const report = await run(website, input(), "preview");
    expect(report).toMatchObject({ mode: "preview", status: "previewed", changesCommitted: 0 });
    expect((await adminDb.collection("sourceRecords").count().get()).data().count).toBe(37);
    expect(await entityCount()).toBe(0);
    expect(await reconciliationItems()).toEqual([]);
    expect((await adminDb.doc(COLLECTIONS.importBatches.docPath(report.batchId)).get()).data()).toMatchObject({
      sourceKey: "h",
      mode: "preview",
      status: "previewed",
      observedOn: OBSERVED_ON,
      planHash: report.planHash,
      manifestBatchId: report.batchId,
    });
  });

  it("writes nothing new for an unchanged file, even when it is another copy of the file", async () => {
    await run(website, input(), "preview");
    const before = await allDocuments();
    const second = await run(website, input(), "preview");
    const { created, removed, rewritten } = differences(before, await allDocuments());
    expect(created).toEqual([COLLECTIONS.importBatches.docPath(second.batchId)]);
    expect(removed).toEqual([]);
    expect(rewritten).toEqual([]);
    expect(second.documentsWritten).toBe(0);
    expect(second.sourceRecords).toMatchObject({ created: 0, seen: 37 });
  });

  it("adds one source record when one cell changes, and keeps the earlier one with a link to its successor", async () => {
    await run(website, input(), "preview");
    const [earlier] = (await sourceRecords("replications")).filter((record) => record.rowKey === "iota2004");
    const report = await run(
      website,
      input((fixture) => {
        row(fixture.replications, "StudyId", "Iota2004").Theme = "Memory";
      }),
      "preview",
    );
    expect(report.sourceRecords).toMatchObject({ created: 1, superseded: 1, missing: 0 });
    const revisions = (await sourceRecords("replications")).filter((record) => record.rowKey === "iota2004");
    expect(revisions).toHaveLength(2);
    const later = revisions.find((record) => record.id !== earlier?.id);
    expect(revisions.find((record) => record.id === earlier?.id)).toMatchObject({
      raw: earlier?.raw,
      supersededById: later?.id,
    });
    expect(later).toMatchObject({ supersededById: null, firstSeenBatchId: report.batchId });
    expect(later?.raw).toMatchObject({ Theme: "Memory" });
  });

  it("keeps the record of a row that has gone, names the last batch that saw it, and notices its return", async () => {
    const first = await run(website, input(), "preview");
    const second = await run(website, input(), "preview");
    const without = input((fixture) => {
      fixture.members = fixture.members.filter((member) => member.PersonId !== "lu-mockup");
    });
    const third = await run(website, without, "preview");
    expect(third.sourceRecords).toMatchObject({ created: 0, missing: 1, seen: 36 });
    const gone = (await sourceRecords("members")).find((record) => record.rowKey === "lu-mockup");
    expect(gone).toMatchObject({
      firstSeenBatchId: first.batchId,
      lastSeenBatchId: second.batchId,
      supersededById: null,
    });
    const fourth = await run(website, input(), "preview");
    expect(fourth.sourceRecords).toMatchObject({ created: 0, missing: 0, seen: 37 });
    expect((await sourceRecords("members")).find((record) => record.rowKey === "lu-mockup")).toMatchObject({
      lastSeenBatchId: fourth.batchId,
    });
  });
});

describe("preview and apply", () => {
  it("previews what an apply would write, per collection, and the apply then writes exactly that", async () => {
    const data = input();
    const preview = await run(website, data, "preview");
    expect(preview.collections.replications).toEqual({ created: 6, changed: 0, matched: 0, unchanged: 0, fields: {} });
    expect(preview.collections.persons?.created).toBe(15);
    expect(preview.collections.manuscripts?.created).toBe(5);
    expect(await entityCount()).toBe(0);

    const applied = await run(website, data, "apply", { previewBatchId: preview.batchId });
    expect(applied).toMatchObject({ mode: "apply", status: "applied", planHash: preview.planHash });
    expect(applied.collections).toEqual(preview.collections);
    expect(applied.items.raise).toEqual(preview.items.raise);
    expect((await adminDb.collection("replications").count().get()).data().count).toBe(6);
    expect(await schemaProblems()).toEqual([]);
  });

  it("records every write of an apply in the change log of its batch, with the state before and after", async () => {
    const applied = await run(website, input(), "apply");
    const log = await adminDb.collection(COLLECTIONS.importBatchChanges.collectionPath(applied.batchId)).get();
    expect(log.size).toBe(applied.changesCommitted);
    expect(log.docs.map((doc) => doc.id)).toEqual(log.docs.map((_doc, index) => String(index + 1).padStart(6, "0")));
    const entry = log.docs.find((doc) => doc.get("documentPath") === "replications/Delta1999");
    const stored = (await adminDb.doc("replications/Delta1999").get()).data();
    expect(entry?.data()).toMatchObject({
      batchId: applied.batchId,
      operation: "create",
      relation: "created",
      before: null,
      after: stored,
    });
    expect(entry?.get("sourceRecordIds")).toEqual(stored?.sourceRecordIds);
    // Every document the batch wrote has its entry, and every entry names a document that exists.
    const logged = new Set(log.docs.map((doc) => doc.get("documentPath") as string));
    for (const name of ENTITY_COLLECTIONS) {
      for (const doc of (await adminDb.collection(name).get()).docs)
        expect(logged.has(doc.ref.path), doc.ref.path).toBe(true);
    }
    expect(
      (await adminDb.doc(COLLECTIONS.importBatches.docPath(applied.batchId)).get()).get("stats.changesCommitted"),
    ).toBe(applied.changesCommitted);
  });

  it("changes only the fields that changed in the source, and names them in the preview without their values", async () => {
    await run(website, input(), "apply");
    const changed = input((fixture) => {
      row(fixture.replications, "StudyId", "Iota2004").Theme = "Memory";
      row(fixture.people, "PersonId", "gpretend").Affiliation = "Another Invented Polytechnic";
    });
    const preview = await run(website, changed, "preview");
    expect(preview.collections.replications).toMatchObject({
      created: 0,
      changed: 1,
      unchanged: 5,
      fields: { theme: 1 },
    });
    expect(preview.collections.personAffiliations).toMatchObject({ changed: 1, fields: { affiliationSource: 1 } });
    expect(JSON.stringify(preview)).not.toContain("Another Invented Polytechnic");
    expect((await adminDb.doc("replications/Iota2004").get()).get("theme")).toBe("Attention");

    const applied = await run(website, changed, "apply");
    const log = await adminDb.collection(COLLECTIONS.importBatchChanges.collectionPath(applied.batchId)).get();
    const entry = log.docs.find((doc) => doc.get("documentPath") === "replications/Iota2004");
    expect(entry?.data()).toMatchObject({
      operation: "update",
      relation: "updated",
      before: { theme: "Attention" },
      after: { theme: "Memory" },
    });
    const stored = (await adminDb.doc("replications/Iota2004").get()).data();
    expect(stored).toMatchObject({ theme: "Memory", importedValues: { theme: "Memory" }, psychConstruct: "attention" });
    // The document names the current revision of its row, and the earlier revision is kept as a record.
    expect(stored?.sourceRecordIds).toHaveLength(1);
    expect(stored?.fieldSources.theme).toBe(stored?.sourceRecordIds[0]);
  });

  it("refuses an apply that does not match the preview it names", async () => {
    const preview = await run(website, input(), "preview");
    const other = input((fixture) => {
      row(fixture.replications, "StudyId", "Iota2004").Theme = "Memory";
    });
    await expect(run(website, other, "apply", { previewBatchId: preview.batchId })).rejects.toThrow(ImportStopped);
    expect(await entityCount()).toBe(0);
    await expect(run(website, input(), "apply", { previewBatchId: "run__no-such-batch" })).rejects.toThrow(
      /does not exist/,
    );
  });

  it("is safe to interrupt: a batch that stops part-way is marked as failed, and the next run writes what remains", async () => {
    const data = input();
    await run(website, data, "preview");
    // The stages of a run, taken one by one, so that the database can change between plan and apply.
    const started = nextInstant();
    const reading = await website.read({ path: data, observedOn: OBSERVED_ON }, { secret: TEST_HASH_KEY });
    const batchId = importBatchId(started, reading.contentHash);
    const context = { db: adminDb, sourceKey: "h", batchId, now: Timestamp.fromDate(started) };
    await adminDb.doc(COLLECTIONS.importBatches.docPath(batchId)).create({
      ...createdFields(context.now),
      schemaVersion: 1,
      sourceKey: "h",
      mode: "apply",
      status: "running",
      contentHash: reading.contentHash,
      startedBy: IMPORT_ACTOR,
      startedAt: context.now,
      finishedAt: null,
      stats: {},
    });
    const rows = recordRows("h", reading);
    const state = await compareSnapshot(context, rows);
    const { diff } = await compute(
      context,
      website,
      { path: data, observedOn: OBSERVED_ON },
      TEST_HASH_KEY,
      reading,
      rows,
      state,
    );
    const total = diff.changes.length + diff.itemChanges.length;
    expect(total).toBeGreaterThan(APPLY_CHUNK_SIZE);
    // Somebody else creates a document of the second piece before the apply reaches it.
    const late = diff.changes[APPLY_CHUNK_SIZE + 3]?.path ?? "";
    await adminDb.doc(late).create({ createdElsewhere: true });

    await expect(applyDiff(context, diff)).rejects.toThrow(ImportStopped);
    const failed = await adminDb.doc(COLLECTIONS.importBatches.docPath(batchId)).get();
    expect(failed.data()).toMatchObject({ status: "failed", stats: { changesCommitted: APPLY_CHUNK_SIZE } });
    const log = await adminDb.collection(COLLECTIONS.importBatchChanges.collectionPath(batchId)).get();
    // Nothing of the failed piece was written, and every written change has its log entry.
    expect(log.size).toBe(APPLY_CHUNK_SIZE);
    expect((await adminDb.doc(diff.changes[APPLY_CHUNK_SIZE + 4]?.path ?? "").get()).exists).toBe(false);

    await adminDb.doc(late).delete();
    const resumed = await run(website, data, "apply");
    expect(resumed).toMatchObject({ status: "applied", changesCommitted: total - APPLY_CHUNK_SIZE });
    expect((await verify(website, data)).filter((check) => !check.passed)).toEqual([]);
  });
});

describe("idempotency", () => {
  it("performs zero writes on a second apply of the same input, and says so", async () => {
    const data = input();
    await run(website, data, "apply");
    const before = await allDocuments();
    const second = await run(website, data, "apply");
    const after = await allDocuments();
    const { created, removed, rewritten } = differences(before, after);
    // One document is new: the record of the second batch. No other document was written, as their update times show.
    expect(created).toEqual([COLLECTIONS.importBatches.docPath(second.batchId)]);
    expect(removed).toEqual([]);
    expect(rewritten).toEqual([]);
    expect(second).toMatchObject({ status: "applied", documentsWritten: 0, changesCommitted: 0, conflicts: 0 });
    expect(second.sourceRecords).toMatchObject({ created: 0, superseded: 0, missing: 0 });
    expect(
      Object.values(second.collections).every((account) => account.created + account.changed + account.matched === 0),
    ).toBe(true);
    expect(second.items).toMatchObject({ raise: {}, reopen: {}, supersede: {}, clear: {} });
    expect(
      (await adminDb.collection(COLLECTIONS.importBatchChanges.collectionPath(second.batchId)).count().get()).data()
        .count,
    ).toBe(0);
    expect(after.get(COLLECTIONS.importBatches.docPath(second.batchId))?.data).toMatchObject({
      status: "applied",
      stats: { documentsWritten: 0, changesCommitted: 0 },
    });
  });

  it("gives the same documents whichever way the rows of the files are ordered", async () => {
    await run(website, input(), "apply");
    const forwards = [...(await allDocuments()).keys()].filter(
      (path) => !path.startsWith("importBatches/") && !path.startsWith("sources/"),
    );
    await freshDatabase();
    await run(
      website,
      input((fixture) => {
        fixture.replications.reverse();
        fixture.people.reverse();
        fixture.members.reverse();
        fixture.publications.reverse();
      }),
      "apply",
    );
    const backwards = [...(await allDocuments()).keys()].filter(
      (path) => !path.startsWith("importBatches/") && !path.startsWith("sources/"),
    );
    expect(backwards.sort()).toEqual(forwards.sort());
  });
});

describe("ownership of fields", () => {
  const conflictsOf = async (path: string) =>
    (await reconciliationItems()).filter(
      (item) => item.kind === "valueConflict" && JSON.stringify(item.entityRefs).includes(path),
    );

  it("never overwrites a manual edit, and raises exactly one conflict item for it, once", async () => {
    const data = input();
    await run(website, data, "apply");
    // A person edits the theme in the portal.
    await adminDb.doc("replications/Delta1999").update({ theme: "Edited in the portal", updatedBy: "uid-of-a-lead" });

    const second = await run(website, data, "apply");
    expect((await adminDb.doc("replications/Delta1999").get()).get("theme")).toBe("Edited in the portal");
    expect(second.conflicts).toBe(1);
    expect(second.items.raise).toEqual({ valueConflict: 1 });
    const [item] = (await conflictsOf("Delta1999")).filter((candidate) => candidate.field === "theme");
    const record = (await adminDb.doc("replications/Delta1999").get()).get("sourceRecordIds")[0];
    expect(item).toMatchObject({ status: "open", field: "theme", sourceKey: "h", batchId: second.batchId });
    // Both values are in the item, each with where it comes from.
    expect(item?.candidates).toEqual([
      { key: expect.stringMatching(/^portal:[0-9a-f]{20}$/), valueSource: "Edited in the portal" },
      { key: expect.stringMatching(/^h:[0-9a-f]{20}$/), valueSource: "Attention", sourceRecordId: record },
    ]);

    // A third import raises nothing and writes nothing.
    const before = await allDocuments();
    const third = await run(website, data, "apply");
    expect(third).toMatchObject({ documentsWritten: 0, conflicts: 1 });
    expect(third.items).toMatchObject({ raise: {}, standing: second.items.standing + 1 });
    expect(differences(before, await allDocuments()).rewritten).toEqual([]);
    expect((await conflictsOf("Delta1999")).filter((candidate) => candidate.field === "theme")).toHaveLength(1);
  });

  it("keeps the manual edit when the source changes, and replaces the item by one that states the new source value", async () => {
    await run(website, input(), "apply");
    await adminDb.doc("replications/Delta1999").update({ theme: "Edited in the portal" });
    await run(website, input(), "apply");
    const changed = input((fixture) => {
      const delta = row(fixture.replications, "StudyId", "Delta1999");
      delta.Theme = "Memory";
      delta.PsychConstruct = "working memory";
    });
    const report = await run(website, changed, "apply");
    const stored = (await adminDb.doc("replications/Delta1999").get()).data();
    // The edited field stays, the new source value is recorded beside it, and a field nobody edited follows the source.
    expect(stored).toMatchObject({ theme: "Edited in the portal", psychConstruct: "working memory" });
    expect(stored?.importedValues).toMatchObject({ theme: "Memory", psychConstruct: "working memory" });
    expect(report.items.supersede).toEqual({ valueConflict: 1 });
    const items = (await conflictsOf("Delta1999")).filter((candidate) => candidate.field === "theme");
    expect(items.map((item) => item.status).sort()).toEqual(["open", "superseded"]);
    expect(items.find((item) => item.status === "open")?.candidates[1]).toMatchObject({ valueSource: "Memory" });
  });

  it("lets a field follow the source again once the edit and the source agree", async () => {
    await run(website, input(), "apply");
    await adminDb.doc("replications/Delta1999").update({ theme: "Memory" });
    await run(website, input(), "apply");
    expect(await itemCounts()).toMatchObject({ valueConflict: 5 });
    const agreeing = input((fixture) => {
      row(fixture.replications, "StudyId", "Delta1999").Theme = "Memory";
    });
    const report = await run(website, agreeing, "apply");
    expect(report.conflicts).toBe(0);
    // The condition has disappeared from the source, so the importer closes its own item.
    expect(report.items.clear).toEqual({ valueConflict: 1 });
    expect(await itemCounts("cleared")).toEqual({ valueConflict: 1 });
    const later = input((fixture) => {
      row(fixture.replications, "StudyId", "Delta1999").Theme = "Emotion";
    });
    await run(website, later, "apply");
    expect((await adminDb.doc("replications/Delta1999").get()).get("theme")).toBe("Emotion");
  });

  it("leaves alone what a reviewer decided about a membership, without raising a conflict", async () => {
    const data = input();
    await run(website, data, "apply");
    const memberships = await documentsOf("memberships", true);
    const [path] = [...memberships].find(([, membership]) => membership.replicationId === "Delta1999") ?? [""];
    await adminDb.doc(path).update({ reviewStatus: "confirmed" });
    const second = await run(website, data, "apply");
    expect(second).toMatchObject({ conflicts: 0, documentsWritten: 0 });
    expect((await adminDb.doc(path).get()).get("reviewStatus")).toBe("confirmed");
  });
});

describe("the review queue", () => {
  it("raises each item once: a repeated import adds none", async () => {
    const data = input();
    const first = await run(website, data, "apply");
    const raised = await itemCounts();
    expect(Object.values(first.items.raise).reduce((sum, count) => sum + (count ?? 0), 0)).toBe(
      Object.values(raised).reduce((sum, count) => sum + count, 0),
    );
    const second = await run(website, data, "apply");
    expect(second.items).toMatchObject({
      raise: {},
      standing: Object.values(raised).reduce((sum, count) => sum + count, 0),
    });
    expect(await itemCounts()).toEqual(raised);
  });

  it("never reopens or rewrites an item that a reviewer has resolved or dismissed", async () => {
    const data = input();
    await run(website, data, "apply");
    const items = await reconciliationItems();
    const [resolved, dismissed] = [
      items.find((item) => item.kind === "conflictingLead"),
      items.find((item) => item.kind === "linkDefect"),
    ];
    const decidedAt = Timestamp.fromMillis(Date.UTC(2026, 10, 10));
    await adminDb.doc(`reconciliationItems/${resolved?.id}`).update({
      status: "resolved",
      resolution: { decision: "both are leads" },
      resolvedBy: "uid-of-a-reviewer",
      resolvedAt: decidedAt,
    });
    await adminDb
      .doc(`reconciliationItems/${dismissed?.id}`)
      .update({ status: "dismissed", resolvedBy: "uid-of-a-reviewer", resolvedAt: decidedAt });
    const before = await allDocuments();
    const report = await run(website, data, "apply");
    expect(report.items).toMatchObject({ raise: {}, reopen: {} });
    expect(differences(before, await allDocuments()).rewritten).toEqual([]);
    expect((await adminDb.doc(`reconciliationItems/${resolved?.id}`).get()).data()).toMatchObject({
      status: "resolved",
      resolution: { decision: "both are leads" },
      resolvedBy: "uid-of-a-reviewer",
    });
    expect((await adminDb.doc(`reconciliationItems/${dismissed?.id}`).get()).get("status")).toBe("dismissed");
  });

  it("closes an open item whose condition has gone from the source, and opens it again when the condition returns", async () => {
    await run(website, input(), "apply");
    const fixed = input((fixture) => {
      row(fixture.replications, "StudyId", "EtaTheta2005").allSignUpLinks = "https://forms.example.org/etatheta";
    });
    const report = await run(website, fixed, "apply");
    expect(report.items.clear).toEqual({ linkDefect: 1 });
    const [cleared] = (await reconciliationItems()).filter((item) => item.kind === "linkDefect");
    expect(cleared).toMatchObject({ status: "cleared", resolvedBy: IMPORT_ACTOR });
    const again = await run(website, input(), "apply");
    expect(again.items.reopen).toEqual({ linkDefect: 1 });
    expect((await adminDb.doc(`reconciliationItems/${cleared?.id}`).get()).data()).toMatchObject({
      status: "open",
      resolvedBy: null,
    });
  });

  it("deletes nothing when a row disappears, and raises one item that names what the row had produced", async () => {
    await run(website, input(), "apply");
    const people = (await adminDb.collection("persons").count().get()).data().count;
    const without = input((fixture) => {
      fixture.members = fixture.members.filter((member) => member.PersonId !== "ida-sample");
    });
    const report = await run(website, without, "apply");
    expect(report.items.raise).toEqual({ missingFromSource: 1 });
    expect((await adminDb.collection("persons").count().get()).data().count).toBe(people);
    const [item] = (await reconciliationItems()).filter((candidate) => candidate.kind === "missingFromSource");
    expect(item?.entityRefs).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "person" })]));
    expect(
      item?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource).filter(Boolean),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^persons\/p__[0-9a-f]{20}$/),
        expect.stringMatching(/\/affiliations\/h__members__a1$/),
      ]),
    );
    // The same absence raises nothing more on the next run.
    expect((await run(website, without, "apply")).items).toMatchObject({ raise: {} });
  });
});

describe("the review queue after a rollback", () => {
  it("names no document that a rollback has removed, when a row disappears afterwards", async () => {
    const applied = await run(website, input(), "apply");
    await rollbackBatch(adminDb, applied.batchId);
    const without = input((fixture) => {
      fixture.members = fixture.members.filter((member) => member.PersonId !== "ida-sample");
    });
    await run(website, without, "apply");
    const [item] = (await reconciliationItems()).filter((candidate) => candidate.kind === "missingFromSource");
    // The row is reported as gone, and nothing is said to have come from it, because nothing of it exists.
    expect(item).toMatchObject({ status: "open", entityRefs: [] });
    expect(item?.candidates).toHaveLength(1);
  });
});

describe("rollback", () => {
  const comparable = (documents: Awaited<ReturnType<typeof allDocuments>>) =>
    Object.fromEntries(
      [...documents]
        .filter(([path]) => !path.startsWith("importBatches/"))
        .map(([path, document]) => {
          const { createdAt, updatedAt, batchId, resolvedAt, lastSeenAt, ...data } = document.data;
          void [createdAt, updatedAt, batchId, resolvedAt, lastSeenAt];
          return [path, data];
        }),
    );

  it("reverses a batch from its change log: created documents go, source records stay, open items are withdrawn", async () => {
    const data = input();
    const applied = await run(website, data, "apply");
    const records = (await adminDb.collection("sourceRecords").count().get()).data().count;
    const result = await rollbackBatch(adminDb, applied.batchId);
    expect(result).toMatchObject({ status: "rolledBack", restored: 0, itemsLeft: [] });
    expect(result.status === "rolledBack" && result.removed + result.itemsWithdrawn).toBe(applied.changesCommitted);
    expect(await entityCount()).toBe(0);
    expect((await adminDb.collection("sourceRecords").count().get()).data().count).toBe(records);
    expect((await reconciliationItems()).map((item) => item.status)).toEqual(expect.arrayContaining(["withdrawn"]));
    expect(await itemCounts()).toEqual({});
    expect((await adminDb.doc(COLLECTIONS.importBatches.docPath(applied.batchId)).get()).get("status")).toBe(
      "rolledBack",
    );
    expect(await rollbackBatch(adminDb, applied.batchId)).toMatchObject({ status: "nothingToReverse" });
  });

  it("reproduces the same documents when the import is applied again after a rollback", async () => {
    const data = input();
    const applied = await run(website, data, "apply");
    const first = comparable(await allDocuments());
    await rollbackBatch(adminDb, applied.batchId);
    const again = await run(website, data, "apply");
    expect(again.changesCommitted).toBe(applied.changesCommitted);
    expect(comparable(await allDocuments())).toEqual(first);
  });

  it("restores the earlier state of a document that the batch updated", async () => {
    await run(website, input(), "apply");
    const before = (await adminDb.doc("replications/Iota2004").get()).data();
    const changed = await run(
      website,
      input((fixture) => {
        row(fixture.replications, "StudyId", "Iota2004").Theme = "Memory";
      }),
      "apply",
    );
    expect(await rollbackBatch(adminDb, changed.batchId)).toMatchObject({ status: "rolledBack", removed: 0 });
    const { updatedAt, ...restored } = (await adminDb.doc("replications/Iota2004").get()).data() ?? {};
    void updatedAt;
    const { updatedAt: earlier, ...expected } = before ?? {};
    void earlier;
    expect(restored).toEqual(expected);
  });

  it("refuses as a whole, and lists the documents, when a document has changed since the batch wrote it", async () => {
    const applied = await run(website, input(), "apply");
    await adminDb.doc("replications/Delta1999").update({ theme: "Edited in the portal" });
    await adminDb.doc("manuscripts/Kept2025").update({ journal: "Edited too" });
    const before = await allDocuments();
    expect(await rollbackBatch(adminDb, applied.batchId)).toEqual({
      status: "refused",
      changedDocuments: ["manuscripts/Kept2025", "replications/Delta1999"],
    });
    // Nothing was reversed.
    expect(differences(before, await allDocuments())).toEqual({ created: [], removed: [], rewritten: [] });
    expect((await adminDb.doc(COLLECTIONS.importBatches.docPath(applied.batchId)).get()).get("status")).toBe("applied");
  });

  it("leaves an item in place that a reviewer has decided, and reports it", async () => {
    const applied = await run(website, input(), "apply");
    const [item] = (await reconciliationItems()).filter((candidate) => candidate.kind === "conflictingLead");
    await adminDb
      .doc(`reconciliationItems/${item?.id}`)
      .update({ status: "resolved", resolvedBy: "uid-of-a-reviewer" });
    const result = await rollbackBatch(adminDb, applied.batchId);
    expect(result).toMatchObject({ status: "rolledBack", itemsLeft: [`reconciliationItems/${item?.id}`] });
    expect((await adminDb.doc(`reconciliationItems/${item?.id}`).get()).get("status")).toBe("resolved");
  });

  it("has nothing to reverse for a preview, and knows no batch it was never given", async () => {
    const preview = await run(website, input(), "preview");
    expect(await rollbackBatch(adminDb, preview.batchId)).toMatchObject({ status: "nothingToReverse" });
    expect(await rollbackBatch(adminDb, "run__no-such-batch")).toEqual({ status: "notFound" });
  });
});

describe("verification", () => {
  const failed = async (data: string) =>
    (await verify(website, data)).filter((check) => !check.passed).map((check) => check.key);

  it("passes every check after an apply, and writes nothing while it checks", async () => {
    const data = input();
    await run(website, data, "apply");
    const before = await allDocuments();
    const checks = await verify(website, data);
    expect(checks.map((check) => [check.key, check.passed])).toEqual([
      ["structure", true],
      ["rowAccounting", true],
      ["rawFidelity", true],
      ["secondRun", true],
      ["traceToSource", true],
      ["noOrphans", true],
      ["noAddress", true],
    ]);
    expect(differences(before, await allDocuments())).toEqual({ created: [], removed: [], rewritten: [] });
    // Every row is accounted for: imported, held in the queue, or kept raw for a stated reason.
    const accounting = checks.find((check) => check.key === "rowAccounting")?.detail ?? "";
    expect(accounting).toContain("replications: 6 data rows = 6 imported + 0 queued + 0 raw only");
    expect(accounting).toContain("files: 7 data rows = 1 imported + 3 queued + 3 raw only");
  });

  it("fails while the import has not been applied, because a second run would still write", async () => {
    const data = input();
    await run(website, data, "preview");
    expect(await failed(data)).toEqual(["secondRun", "traceToSource"]);
  });

  it("fails when the file no longer says what was imported", async () => {
    await run(website, input(), "apply");
    const changed = input((fixture) => {
      row(fixture.members, "PersonId", "jo-placeholder").Affiliation = "Somewhere Else, USA";
    });
    expect(await failed(changed)).toEqual(expect.arrayContaining(["rawFidelity", "secondRun"]));
  });

  it("fails when a stored raw row no longer hashes to its own identity", async () => {
    const data = input();
    await run(website, data, "apply");
    const [record] = (await sourceRecords("members")).filter((candidate) => candidate.rowKey === "jo-placeholder");
    await adminDb.doc(`sourceRecords/${record?.id}`).update({ "raw.FullName": "Tampered" });
    expect(await failed(data)).toEqual(["rawFidelity"]);
  });

  it("fails on a reference that resolves to nothing, and on an imported document that has gone", async () => {
    const data = input();
    await run(website, data, "apply");
    await adminDb.doc("programmes/eegmanylabs").delete();
    expect(await failed(data)).toEqual(expect.arrayContaining(["structure", "rowAccounting"]));
    await freshDatabase();
    await run(website, data, "apply");
    const [person] = [...(await documentsOf("persons")).keys()];
    await adminDb.doc(`persons/${person}`).delete();
    expect(await failed(data)).toEqual(expect.arrayContaining(["secondRun", "traceToSource", "noOrphans"]));
  });

  it("fails when a document that members can read holds an address", async () => {
    const data = input((fixture) => {
      row(fixture.people, "PersonId", "hnobody").Affiliation = "Imaginary College (write to hal@example.org)";
    });
    await run(website, data, "apply");
    expect(await failed(data)).toEqual(["noAddress"]);
  });
});

describe("the source registry", () => {
  it("writes the entry of every source from the committed definitions, and the tabs of the source that was read", async () => {
    await run(website, input(), "preview");
    const sources = await documentsOf("sources");
    expect([...sources.keys()].sort()).toEqual(SOURCE_DEFINITIONS.map((definition) => definition.key).sort());
    expect(sources.get("h")).toMatchObject({
      key: "h",
      title: "Website structured data",
      kind: "repositoryTsv",
      authority: "live",
      syncPolicy: "repeatable",
    });
    expect(sources.get("b")).toMatchObject({
      title: "Naming conventions",
      kind: "googleSheet",
      authority: "reference",
    });
    const tabs = await documentsOf("tabs", true);
    expect([...tabs.keys()].sort()).toEqual(
      ["files", "members", "people", "publications", "replications"].map((tab) => `sources/h/tabs/${tab}`),
    );
    expect(tabs.get("sources/h/tabs/members")).toMatchObject({
      name: "members.tsv",
      visibility: "visible",
      headerRow: 1,
      rowCount: 7,
      importerKey: "websiteData",
    });
  });

  it("writes a location only from the private configuration, where no client can read it, and nothing private elsewhere", async () => {
    const data = input();
    const locations = {
      b: { externalId: "an-invented-file-identifier", exportUrl: "https://sheets.example.org/export" },
      d: { url: "https://sheets.example.org/d/edit" },
    };
    await runImport({
      db: adminDb,
      importer: website,
      input: { path: data, observedOn: OBSERVED_ON },
      mode: "preview",
      secret: TEST_HASH_KEY,
      locations,
      now: nextInstant(),
    });
    expect((await adminDb.doc("sources/b/private/location").get()).data()).toMatchObject({
      externalId: "an-invented-file-identifier",
    });
    expect((await adminDb.doc("sources/d/private/location").get()).data()).toMatchObject({
      url: "https://sheets.example.org/d/edit",
    });
    expect((await adminDb.doc("sources/h/private/location").get()).exists).toBe(false);
    const elsewhere = [...(await allDocuments())].filter(([path]) => !path.endsWith("/private/location"));
    expect(
      elsewhere.filter(([, document]) => JSON.stringify(document.data).includes("an-invented-file-identifier")),
    ).toEqual([]);
    // A second run with the same configuration writes none of it again.
    const before = await allDocuments();
    await runImport({
      db: adminDb,
      importer: website,
      input: { path: data, observedOn: OBSERVED_ON },
      mode: "preview",
      secret: TEST_HASH_KEY,
      locations,
      now: nextInstant(),
    });
    expect(differences(before, await allDocuments()).rewritten).toEqual([]);
  });
});
