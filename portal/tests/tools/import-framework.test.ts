// Integration tests of the import framework against the Firestore emulator: snapshot, plan,
// preview, apply, idempotency, ownership of fields, the review queue, rollback and verification.
// The input is the synthetic website fixture: every study, person and address in it is invented.
import { writeFileSync } from "node:fs";
import { COLLECTIONS, importBatchId, sourceRecordId } from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ToolRefusal } from "../../tools/src/environment";
import { APPLY_CHUNK_SIZE, applyDiff, ImportStopped } from "../../tools/src/import/apply";
import { createdFields, IMPORT_ACTOR } from "../../tools/src/import/context";
import {
  WEBSITE_HEADERS,
  type WebsiteFixture,
  websiteFixture,
  writeWebsiteFixture,
} from "../../tools/src/import/fixtures/website";
import { namingWorkbook } from "../../tools/src/import/fixtures/workbooks";
import { SOURCE_DEFINITIONS } from "../../tools/src/import/registry";
import { rollbackBatch } from "../../tools/src/import/rollback";
import { compute, runImport } from "../../tools/src/import/run";
import { compareSnapshot, recordRows } from "../../tools/src/import/snapshot";
import { importer as naming } from "../../tools/src/import/sources/naming-conventions";
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
    const hash = rowHash(cells, 4);
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
    expect(preview.collections.replications).toEqual({
      created: 6,
      changed: 0,
      removed: 0,
      matched: 0,
      unchanged: 0,
      fields: {},
    });
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

  it("leaves a field cleared that a person has cleared in the portal, and queues the source value beside it", async () => {
    const data = input();
    await run(website, data, "apply");
    // A person removes the theme of a replication and the name of a vocabulary term: a member document and a public one.
    await adminDb.doc("replications/Delta1999").update({ theme: FieldValue.delete() });
    const [termId] = [...(await documentsOf("vocabularyTerms"))].find(([, term]) => term.kind === "theme") ?? [""];
    await adminDb.doc(`vocabularyTerms/${termId}`).update({ name: FieldValue.delete() });

    const second = await run(website, data, "apply");
    expect((await adminDb.doc("replications/Delta1999").get()).data()).not.toHaveProperty("theme");
    expect((await adminDb.doc(`vocabularyTerms/${termId}`).get()).data()).not.toHaveProperty("name");
    expect(second.conflicts).toBe(2);
    expect(second.items.raise).toEqual({ valueConflict: 2 });
    const [item] = (await conflictsOf("Delta1999")).filter((candidate) => candidate.field === "theme");
    expect(item?.candidates).toEqual([
      { key: expect.stringMatching(/^portal:[0-9a-f]{20}$/), valueSource: "(cleared)" },
      expect.objectContaining({ key: expect.stringMatching(/^h:/), valueSource: "Attention" }),
    ]);
    // The cleared fields stay cleared on every later run, which writes nothing.
    const third = await run(website, data, "apply");
    expect(third).toMatchObject({ documentsWritten: 0, conflicts: 2 });
    expect((await adminDb.doc("replications/Delta1999").get()).data()).not.toHaveProperty("theme");
  });

  it("does not add a member again that a person has removed from a list, in a document of any class", async () => {
    const data = input();
    await run(website, data, "apply");
    // A reviewer detaches a study from a spelling of the folded lookup (members read it), a person from an
    // identity key and a spelling from an institution candidate (restricted), and a label from a term (public).
    const lists = [
      ["studyAliasIndex", "replicationIds"],
      ["identityKeys", "entityIds"],
      ["institutionCandidates", "affiliationsSource"],
      ["vocabularyTerms", "labelsSource"],
    ] as const;
    const shortened = new Map<string, unknown[]>();
    for (const [collection, field] of lists) {
      const [id, document] = [...(await documentsOf(collection))]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .find(([, candidate]) => Array.isArray(candidate[field]) && candidate[field].length > 0) ?? ["", {}];
      expect(id, collection).not.toBe("");
      const kept = (document[field] as unknown[]).slice(1);
      await adminDb.doc(`${collection}/${id}`).update({ [field]: kept });
      shortened.set(`${collection}/${id}`, kept);
    }
    const second = await run(website, data, "apply");
    for (const [index, [, field]] of lists.entries()) {
      const [path, kept] = [...shortened][index] ?? ["", []];
      expect((await adminDb.doc(path).get()).get(field), path).toEqual(kept);
    }
    expect(second.conflicts).toBe(4);
    expect(second.items.raise).toEqual({ valueConflict: 4 });
    const raised = new Map(
      (await reconciliationItems())
        .filter((item) => item.batchId === second.batchId)
        .map((item) => [
          String(item.field),
          (item.candidates as { valueSource?: string }[]).map((candidate) => candidate.valueSource),
        ]),
    );
    expect(raised.get("replicationIds")).toEqual(expect.arrayContaining(["(memberRemoved)"]));
    expect(raised.get("labelsSource")).toEqual(expect.arrayContaining(["(memberRemoved)"]));
    // A removed member of a restricted document is named by its field and its record. Its value is not shown.
    expect(raised.get("entityIds")).toEqual([undefined, undefined]);
    expect(raised.get("affiliationsSource")).toEqual([undefined, undefined]);
    // The removals stand on every later run, which writes nothing.
    expect(await run(website, data, "apply")).toMatchObject({ documentsWritten: 0, conflicts: 4 });
  });

  it("adds a member that the source states for the first time, and one that a rolled-back batch had added", async () => {
    await run(website, input(), "apply");
    // A further member whose affiliation is another spelling of one that an institution candidate holds already.
    const more = input((fixture) => {
      fixture.members.push({
        SequenceNumber: "8",
        PersonId: "max-madeup",
        FullName: "Max Madeup",
        Affiliation: "imaginary  college, NOWHERELAND",
        Country: "Nowhereland",
      });
    });
    const second = await run(website, more, "apply");
    expect(second.conflicts).toBe(0);
    expect(second.collections.institutionCandidates).toMatchObject({ created: 0, changed: 1 });
    const [candidate] = [...(await documentsOf("institutionCandidates")).values()].filter(
      (document) => document.affiliationFolded === "imaginarycollegenowhereland",
    );
    expect(candidate?.affiliationsSource).toEqual([
      "Imaginary College, Nowhereland",
      "imaginary  college, NOWHERELAND",
    ]);
    // A batch that was rolled back added nothing that counts: a new apply adds the member again.
    await rollbackBatch(adminDb, second.batchId);
    const again = await run(website, more, "apply");
    expect(again.conflicts).toBe(0);
    expect(again.changesCommitted).toBe(second.changesCommitted);
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

  it("carries on where an earlier attempt stopped: what is reversed already is skipped, and the rest is reversed", async () => {
    await run(website, input(), "apply");
    const changed = await run(
      website,
      input((fixture) => {
        row(fixture.replications, "StudyId", "Iota2004").Theme = "Memory";
        fixture.members.push({
          SequenceNumber: "8",
          PersonId: "max-madeup",
          FullName: "Max Madeup",
          Affiliation: "Madeup Institute, Nowhereland",
          Country: "Nowhereland",
        });
      }),
      "apply",
    );
    const log = await adminDb.collection(COLLECTIONS.importBatchChanges.collectionPath(changed.batchId)).get();
    // An attempt that stopped after its first piece left some documents in their earlier state and the batch as applied.
    const created = log.docs.filter(
      (entry) => entry.get("before") === null && !String(entry.get("documentPath")).startsWith("reconciliationItems/"),
    );
    const updated = log.docs.find((entry) => entry.get("documentPath") === "replications/Iota2004");
    expect(created.length).toBeGreaterThan(2);
    await adminDb.doc(String(created[0]?.get("documentPath"))).delete();
    await adminDb.doc("replications/Iota2004").set(updated?.get("before"));
    // A document that a person has edited since would still stop the rollback as a whole.
    await adminDb.doc(String(created[1]?.get("documentPath"))).update({ updatedBy: "uid-of-a-person" });
    expect(await rollbackBatch(adminDb, changed.batchId)).toEqual({
      status: "refused",
      changedDocuments: [created[1]?.get("documentPath")],
    });
    await adminDb.doc(String(created[1]?.get("documentPath"))).set(created[1]?.get("after"));

    const result = await rollbackBatch(adminDb, changed.batchId);
    expect(result).toMatchObject({ status: "rolledBack", removed: created.length - 1 });
    for (const entry of created) {
      expect((await adminDb.doc(String(entry.get("documentPath"))).get()).exists, entry.get("documentPath")).toBe(
        false,
      );
    }
    expect((await adminDb.doc("replications/Iota2004").get()).get("theme")).not.toBe("Memory");
    expect((await adminDb.doc(COLLECTIONS.importBatches.docPath(changed.batchId)).get()).get("status")).toBe(
      "rolledBack",
    );
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
      ["rowBaseline", true],
      ["rawFidelity", true],
      ["secondRun", true],
      ["traceToSource", true],
      ["noOrphans", true],
      ["studyRegistry", true],
      ["derivedValues", true],
      ["blankAndZero", true],
      ["noAddress", true],
    ]);
    expect(differences(before, await allDocuments())).toEqual({ created: [], removed: [], rewritten: [] });
    // The identifiers of the six studies stay apart after folding, and no study has two DOIs.
    expect(checks.find((check) => check.key === "studyRegistry")?.detail).toContain(
      "6 replications, 0 with a programme identifier, no number of studies stated; 0 identifiers collide after folding; " +
        "0 studies have more than one DOI",
    );
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

  it("fails when a document that members can read holds an address, however it came there", async () => {
    const data = input();
    await run(website, data, "apply");
    const [person] = [...(await documentsOf("persons")).keys()].sort();
    // The address did not come from the source, so only the check of the stored documents can find it.
    await adminDb.doc(`persons/${person}`).update({ custom: { note: "write to hal@example.org" } });
    expect(await failed(data)).toEqual(["noAddress"]);
  });

  it("compares the rows of each tab with the baseline that the operator states, by title or by key", async () => {
    const data = input();
    await run(website, data, "apply");
    const baseline = {
      rows: {
        replications: { header: 1, data: 6 },
        publications: { data: 5 },
        people: { data: 8 },
        members: { data: 7, blank: 0 },
        files: { data: 7 },
      },
    };
    const rowBaseline = async (extra: Parameters<typeof verify>[2]) =>
      (await verify(website, data, extra)).find((check) => check.key === "rowBaseline");
    expect(await rowBaseline({ baseline, requireBaseline: true })).toMatchObject({
      passed: true,
      detail: "7 counts of 5 tabs compared with the stated baseline, all equal",
    });
    // A row more or less than stated fails, and the detail names the tab, the class and the two counts.
    const fewer = { rows: { ...baseline.rows, members: { data: 6 } } };
    expect(await rowBaseline({ baseline: fewer })).toMatchObject({
      passed: false,
      detail: expect.stringContaining("members: 7 data rows where 6 are stated"),
    });
    // A tab without a baseline, and a baseline for a tab that the source does not hold, fail as well.
    const { files: _files, ...withoutFiles } = baseline.rows;
    expect((await rowBaseline({ baseline: { rows: withoutFiles } }))?.detail).toContain("files: no baseline");
    expect((await rowBaseline({ baseline: { rows: { ...baseline.rows, archive: { data: 1 } } } }))?.passed).toBe(false);
    // On the command line a source without any baseline is not verified. A test of one importer may leave it out.
    expect(await rowBaseline({ requireBaseline: true })).toMatchObject({ passed: false });
    expect(await rowBaseline({})).toMatchObject({ passed: true });
  });

  it("checks the registry of studies: the stated number, distinct identifiers after folding and one DOI for each", async () => {
    const data = input();
    await run(website, data, "apply");
    const registry = async (studies?: number) =>
      (await verify(website, data, studies === undefined ? {} : { baseline: { studies } })).find(
        (check) => check.key === "studyRegistry",
      );
    // The number of studies is compared only once the list of studies has been applied.
    expect(await registry(27)).toMatchObject({ passed: true, detail: expect.stringContaining("not yet comparable") });
    // A second DOI for one study, as another source would write it under a mistyped DOI, fails the check.
    const [lookup] = [...(await documentsOf("integrationMappings"))].filter(
      ([, mapping]) => mapping.entityType === "replication",
    );
    const [, mapping] = lookup ?? ["", {}];
    await adminDb.doc("integrationMappings/doi__replication__0123456789abcdef0123").set({
      ...mapping,
      externalId: "10.1000/an-invented-other-doi",
    });
    expect(await registry()).toMatchObject({
      passed: false,
      detail: expect.stringContaining(`1 studies have more than one DOI across the sources (${mapping?.entityId})`),
    });
    await adminDb.doc("integrationMappings/doi__replication__0123456789abcdef0123").delete();
    // Two identifiers that fold alike fail it too.
    const delta = (await adminDb.doc("replications/Delta1999").get()).data() ?? {};
    await adminDb.doc("replications/delta1999").set({ ...delta, studyKey: "delta1999" });
    expect(await registry()).toMatchObject({
      passed: false,
      detail: expect.stringContaining("2 identifiers collide after folding (Delta1999, delta1999)"),
    });
  });

  it("stores its report on the latest applied batch of the source, which is verified only while every check passes", async () => {
    const data = input();
    const preview = await run(website, data, "preview");
    const applied = await run(website, data, "apply");
    const batch = async (id: string) => (await adminDb.doc(COLLECTIONS.importBatches.docPath(id)).get()).data();
    const checks = await verify(website, data, { record: true });
    expect((await batch(applied.batchId))?.verification).toMatchObject({
      passed: true,
      checks: checks.map((check) => ({ key: check.key, passed: true, detail: check.detail })),
    });
    expect((await batch(applied.batchId))?.status).toBe("applied");
    expect(await batch(preview.batchId)).not.toHaveProperty("verification");
    expect(await schemaProblems()).toEqual([]);
    // A later verification that fails replaces the report: the batch no longer counts as verified.
    const [person] = [...(await documentsOf("persons")).keys()].sort();
    await adminDb.doc(`persons/${person}`).delete();
    await verify(website, data, { record: true });
    const stored = (await batch(applied.batchId))?.verification as {
      passed: boolean;
      checks: { key: string; passed: boolean }[];
    };
    expect(stored.passed).toBe(false);
    expect(stored.checks.filter((check) => !check.passed).map((check) => check.key)).toEqual(
      expect.arrayContaining(["secondRun", "noOrphans"]),
    );
  });
});

describe("the privacy guard", () => {
  it("blocks a batch whose plan would put an address where every member can read it, at the preview already", async () => {
    const data = input((fixture) => {
      row(fixture.people, "PersonId", "hnobody").Affiliation = "Imaginary College (write to hal@example.org)";
    });
    const preview = await run(website, data, "preview");
    expect(preview.blocking.map((check) => check.check)).toEqual(["privacy/address"]);
    expect(preview.blocking[0]?.message).toContain("personAffiliations");
    expect(preview.blocking[0]?.message).toContain("affiliationSource");
    // The item that explains the block is written at once. It names the row and the field, and no value.
    const [item] = await reconciliationItems();
    expect(item).toMatchObject({ kind: "privacyReview", status: "open", field: "address" });
    expect(JSON.stringify(item)).not.toContain("example.org");
    expect(JSON.stringify(preview)).not.toContain("example.org");

    // An apply writes no entity at all, and the batch record says that it failed.
    const applied = await run(website, data, "apply");
    expect(applied).toMatchObject({ status: "failed", changesCommitted: 0 });
    expect(await entityCount()).toBe(0);
    for (const [path, document] of await allDocuments()) {
      if (path.startsWith("sourceRecords/")) continue;
      expect(JSON.stringify(document.data), path).not.toContain("hal@example.org");
    }
    // Once the source is corrected the import goes through, and the item is closed by the importer.
    const corrected = await run(website, input(), "apply");
    expect(corrected).toMatchObject({ status: "applied", blocking: [] });
    expect(corrected.items.clear).toEqual({ privacyReview: 1 });
  });
});

describe("the order of the sources", () => {
  const namingFile = async () => {
    const file = `${temporaryDirectory()}/naming.xlsx`;
    writeFileSync(file, await namingWorkbook());
    return file;
  };

  it("refuses a source whose earlier sources have no applied batch, before anything is written", async () => {
    const file = await namingFile();
    const before = await allDocuments();
    for (const mode of ["preview", "apply"] as const) {
      await expect(run(naming, file, mode, { order: "required" })).rejects.toThrow(ToolRefusal);
      await expect(run(naming, file, mode, { order: "required" })).rejects.toThrow(/after source h .*section 5/);
    }
    expect(differences(before, await allDocuments())).toEqual({ created: [], removed: [], rewritten: [] });
    // A preview of the earlier source is no applied batch, and neither is one that was rolled back.
    await run(website, input(), "preview", { order: "required" });
    await expect(run(naming, file, "apply", { order: "required" })).rejects.toThrow(ToolRefusal);
    const applied = await run(website, input(), "apply", { order: "required" });
    await rollbackBatch(adminDb, applied.batchId);
    await expect(run(naming, file, "apply", { order: "required" })).rejects.toThrow(ToolRefusal);
  });

  it("runs a source once every earlier source has been applied", async () => {
    await run(website, input(), "apply", { order: "required" });
    const report = await run(naming, await namingFile(), "apply", { order: "required" });
    expect(report.status).toBe("applied");
    expect(naming.after).toEqual(["h"]);
    expect(website.after).toBeUndefined();
  });
});

describe("the record of the input", () => {
  it("names a workbook neutrally, whatever its file is called, and identifies it by its hash", async () => {
    await run(website, input(), "apply");
    // An export is often named after the identifier of its document, which is private.
    const file = `${temporaryDirectory()}/an-invented-identifier-of-the-workbook - Sheet1.xlsx`;
    writeFileSync(file, await namingWorkbook());
    const report = await run(naming, file, "preview");
    const batch = (await adminDb.doc(COLLECTIONS.importBatches.docPath(report.batchId)).get()).data();
    expect(batch?.inputFiles).toEqual([{ name: "input.xlsx", sha256: batch?.contentHash }]);
    for (const [path, document] of await allDocuments()) {
      expect(`${path} ${JSON.stringify(document.data)}`, path).not.toContain("an-invented-identifier-of-the-workbook");
    }
  });
});

describe("a renamed natural key", () => {
  const renamed = (to: string) =>
    input((fixture) => {
      row(fixture.members, "PersonId", "lu-mockup").PersonId = to;
    });
  const people = async () => (await adminDb.collection("persons").count().get()).data().count;
  const renameItems = async () =>
    (await reconciliationItems()).filter(
      (item) => item.kind === "missingFromSource" && JSON.stringify(item.candidates).includes("renamedTo"),
    );

  it("presents the row that has gone and the row that replaces it together, and creates no second record", async () => {
    await run(website, input(), "apply");
    const before = await people();
    const data = renamed("lu-mock-up");
    const second = await run(website, data, "apply");
    expect(await people()).toBe(before);
    expect(second.items.raise).toEqual({ missingFromSource: 1 });
    expect(second.sourceRecords).toMatchObject({ created: 1, missing: 1 });
    expect(second.collections.persons?.created ?? 0).toBe(0);
    expect(second.collections.identityKeys?.created ?? 0).toBe(0);
    const [item] = await renameItems();
    // One item names both rows, and the records that the earlier row had produced.
    expect(((item?.candidates ?? []) as { key: string }[]).map((candidate) => candidate.key.split(":")[0])).toEqual([
      "h/members/gone",
      "h/members/renamedTo",
    ]);
    expect(item?.entityRefs).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "person" })]));
    // The new row waits in the queue: it is accounted for and writes nothing.
    const members = second.tabs.find((tab) => tab.tabKey === "members");
    expect(members).toMatchObject({ imported: 6, queued: 1 });
    // Nothing more happens on the next run, although the new row is no longer new to the snapshot.
    const third = await run(website, data, "apply");
    expect(third).toMatchObject({ documentsWritten: 0 });
    expect(await people()).toBe(before);
    expect((await verify(website, data)).filter((check) => !check.passed)).toEqual([]);
  });

  it("treats a key that differs by case alone in the same way", async () => {
    await run(website, input(), "apply");
    const before = await people();
    await run(website, renamed("Lu-Mockup"), "apply");
    expect(await people()).toBe(before);
    expect(await renameItems()).toHaveLength(1);
  });

  it("imports the new row once a reviewer has dismissed the pair, and pairs no row that differs in more than its key", async () => {
    await run(website, input(), "apply");
    const before = await people();
    const data = renamed("lu-mock-up");
    await run(website, data, "apply");
    const [item] = await renameItems();
    await adminDb
      .doc(`reconciliationItems/${item?.id}`)
      .update({ status: "dismissed", resolvedBy: "uid-of-a-reviewer" });
    const report = await run(website, data, "apply");
    expect(report.collections.persons?.created).toBe(1);
    expect(await people()).toBe(before + 1);
    // A row that has gone and a row with another key and another name are two things: the usual item, and a new person.
    await freshDatabase();
    await run(website, input(), "apply");
    const replaced = input((fixture) => {
      const lu = row(fixture.members, "PersonId", "lu-mockup");
      lu.PersonId = "lou-mockup";
      lu.FullName = "Lou Mockup";
    });
    const other = await run(website, replaced, "apply");
    expect(other.collections.persons?.created).toBe(1);
    expect(await renameItems()).toEqual([]);
    expect(other.items.raise).toMatchObject({ missingFromSource: 1 });
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
