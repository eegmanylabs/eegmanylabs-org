// The migration that moves the outcome labels of the prediction market out of the restricted
// document of a replication, which its team reads, and the null-significance labels and the links
// to the market's documents out of the hypotheses, which every member reads, into the sealed
// document that programme administrators alone read (docs/MIGRATION_PLAN.md, section 11,
// questions 7 and 22). Run against the emulators. The labels, links and studies are synthetic.
import { COLLECTIONS, documentLinkSlotId } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateSealedOutcomes } from "../../tools/src/commands/migrate-sealed-outcomes";
import { adminDb } from "../support/admin";
import { freshDatabase } from "./import-support";

beforeEach(freshDatabase);

const standard = () => ({
  schemaVersion: 1,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  createdBy: "system:import",
  updatedBy: "system:import",
  archivedAt: null,
  writeContext: { origin: "import", depth: 0, correlationId: null, causationId: null, auditEventId: null },
});

async function replicationWithLabels(studyKey: string, labels: Record<string, string> | null): Promise<void> {
  await adminDb.doc(COLLECTIONS.replications.docPath(studyKey)).set({ ...standard(), studyKey });
  await adminDb.doc(COLLECTIONS.replicationDetail.docPath(studyKey)).set({
    ...standard(),
    internalNotes: "A synthetic note.",
    ...(labels === null
      ? {}
      : {
          replicatedSource: labels,
          sourceRecordIds: ["record-synthetic"],
          importedValues: { replicatedSource: labels },
        }),
  });
}

describe("migrate:sealed-outcomes", () => {
  it("reports without --apply, then moves the labels once and leaves the detail without them", async () => {
    await replicationWithLabels("SyntheticStudy2001", { h01: "synthetic label one", h02: "synthetic label two" });
    await replicationWithLabels("SyntheticStudy2002", null);

    const dry = await migrateSealedOutcomes(adminDb, { apply: false });
    expect(dry).toMatchObject({ moved: ["SyntheticStudy2001"], cleared: [] });
    expect((await adminDb.doc(COLLECTIONS.predictionMarketOutcomes.docPath("SyntheticStudy2001")).get()).exists).toBe(
      false,
    );

    const applied = await migrateSealedOutcomes(adminDb, { apply: true });
    expect(applied.moved).toEqual(["SyntheticStudy2001"]);
    const sealed = (await adminDb.doc(COLLECTIONS.predictionMarketOutcomes.docPath("SyntheticStudy2001")).get()).data();
    expect(sealed).toMatchObject({
      replicationId: "SyntheticStudy2001",
      labelsSource: { h01: "synthetic label one", h02: "synthetic label two" },
      sealedBy: { decidedBy: "programmeLead", reference: "docs/MIGRATION_PLAN.md, section 11, question 7" },
      sourceRecordIds: ["record-synthetic"],
    });
    const detail = (await adminDb.doc(COLLECTIONS.replicationDetail.docPath("SyntheticStudy2001")).get()).data();
    expect(detail).not.toHaveProperty("replicatedSource");
    expect(detail?.importedValues).toEqual({});
    expect(detail?.internalNotes).toBe("A synthetic note.");
    expect(COLLECTIONS.replicationDetail.schema.safeParse(detail).success).toBe(true);

    // A second run finds nothing to move.
    expect(await migrateSealedOutcomes(adminDb, { apply: true })).toEqual(NOTHING);
  });

  it("moves the null-significance labels and the links off the hypotheses, removes the market's links, and seals their change log and items (question 22)", async () => {
    await replicationWithLabels("SyntheticStudy2004", { h01: "synthetic outcome" });
    // The import wrote the sealed outcome document already; a rehearsal wrote the material on the hypotheses.
    await adminDb.doc(COLLECTIONS.predictionMarketOutcomes.docPath("SyntheticStudy2004")).set({
      ...standard(),
      replicationId: "SyntheticStudy2004",
      labelsSource: { h01: "synthetic outcome" },
      sealedBy: {
        decidedBy: "programmeLead",
        decidedOn: "2026-11-13",
        reference: "docs/MIGRATION_PLAN.md, section 11, question 7",
      },
      sourceRecordIds: ["record-h01"],
    });
    const hypothesis = (number: string, material: Record<string, unknown>) => ({
      ...standard(),
      replicationId: "SyntheticStudy2004",
      hypothesisNumber: number,
      text: `A synthetic hypothesis ${number}.`,
      scientificReviewStatus: "unverified",
      analysisStatus: "notStarted",
      resultReviewedBy: null,
      resultReviewedAt: null,
      sourceRecordIds: [`record-h0${number}`],
      ...material,
    });
    const description = "https://osf.example.org/synthetic-description";
    const infosheet = "https://docs.example.org/synthetic-infosheet";
    await adminDb.doc(COLLECTIONS.replicationHypotheses.docPath("SyntheticStudy2004", "h01")).set(
      hypothesis("1", {
        nullSigSource: "null",
        studyDescriptionUrl: description,
        infosheetUrl: infosheet,
        importedValues: { nullSigSource: "null", text: "A synthetic hypothesis 1." },
        fieldSources: { nullSigSource: "record-h01", text: "record-h01" },
      }),
    );
    await adminDb
      .doc(COLLECTIONS.replicationHypotheses.docPath("SyntheticStudy2004", "h02"))
      .set(hypothesis("2", { nullSigSource: "sig" }));
    await adminDb
      .doc(COLLECTIONS.replicationHypotheses.docPath("SyntheticStudy2005", "h01"))
      .set({ ...hypothesis("1", {}), replicationId: "SyntheticStudy2005" });
    await adminDb
      .doc(COLLECTIONS.replications.docPath("SyntheticStudy2005"))
      .set({ ...standard(), studyKey: "SyntheticStudy2005" });
    const linkOf = (owner: string, slot: string) => COLLECTIONS.documentLinks.docPath(documentLinkSlotId(owner, slot));
    for (const [owner, slot, url] of [
      ["replication__SyntheticStudy2004", "pmStudyDescription", description],
      ["replication__SyntheticStudy2004", "pmInfosheet", infosheet],
      ["programme__eegmanylabs", "pmGeneralInfo", "https://docs.example.org/synthetic-general"],
      ["replication__SyntheticStudy2004", "originalPaper", "https://doi.org/10.1000/synthetic"],
    ] as const) {
      await adminDb.doc(linkOf(owner, slot)).set({ ...standard(), url, kind: "url", entityType: "replication" });
    }
    const batch = "run__20261101T000000000Z__dddddddddddd";
    const changes = COLLECTIONS.importBatchChanges.collectionPath(batch);
    const appended = { schemaVersion: 1, createdAt: Timestamp.now(), createdBy: "system:import", batchId: batch };
    await adminDb.doc(`${changes}/000001`).set({
      ...appended,
      documentPath: COLLECTIONS.replicationHypotheses.docPath("SyntheticStudy2004", "h01"),
      operation: "create",
      relation: "created",
      sourceRecordIds: ["record-h01"],
      before: null,
      after: { text: "A synthetic hypothesis 1.", nullSigSource: "null", infosheetUrl: infosheet },
    });
    await adminDb.doc(`${changes}/000002`).set({
      ...appended,
      documentPath: linkOf("replication__SyntheticStudy2004", "pmInfosheet"),
      operation: "create",
      relation: "created",
      sourceRecordIds: ["record-h01"],
      before: null,
      after: { url: infosheet, title: "SyntheticStudy2004" },
    });
    await adminDb.doc(`${changes}/000003`).set({
      ...appended,
      documentPath: linkOf("replication__SyntheticStudy2004", "originalPaper"),
      operation: "create",
      relation: "created",
      sourceRecordIds: ["record-h01"],
      before: null,
      after: { url: "https://doi.org/10.1000/synthetic" },
    });
    // Items raised before the seal showed the address of a link and a null-significance label.
    const item = (key: string, valueSource: string, field: string) => ({
      ...standard(),
      kind: "linkDefect",
      entityRefs: [],
      sourceKey: "e",
      field,
      candidates: [{ key, valueSource }],
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      batchId: batch,
      sealed: false,
    });
    await adminDb
      .doc(COLLECTIONS.reconciliationItems.docPath("item-link"))
      .set(item("e/hypotheses/infosheet_link/noAddress:0123456789ab", "synthetic text", "infosheet_link"));
    await adminDb
      .doc(COLLECTIONS.reconciliationItems.docPath("item-null-sig"))
      .set(item("e/hypotheses:0123456789ab", "maybe", "null-sig"));
    await adminDb
      .doc(COLLECTIONS.reconciliationItems.docPath("item-option"))
      .set(item("e/hypotheses/list:0123456789ab", "postponed", "replicated"));

    const dry = await migrateSealedOutcomes(adminDb, { apply: false });
    expect(dry).toMatchObject({
      materialMoved: ["SyntheticStudy2004"],
      linksRemoved: 3,
      entriesSealed: 2,
      itemsSealed: 2,
    });
    expect(
      (await adminDb.doc(COLLECTIONS.replicationHypotheses.docPath("SyntheticStudy2004", "h01")).get()).get(
        "nullSigSource",
      ),
    ).toBe("null");

    await migrateSealedOutcomes(adminDb, { apply: true });
    const sealed = (await adminDb.doc(COLLECTIONS.predictionMarketOutcomes.docPath("SyntheticStudy2004")).get()).data();
    expect(sealed).toMatchObject({
      labelsSource: { h01: "synthetic outcome" },
      nullSigSource: { h01: "null", h02: "sig" },
      studyDescriptionUrl: description,
      infosheetUrl: infosheet,
      sealedBy: { reference: "docs/MIGRATION_PLAN.md, section 11, question 7" },
      materialSealedBy: { reference: "docs/MIGRATION_PLAN.md, section 11, question 22" },
      sourceRecordIds: ["record-h01", "record-h02"],
    });
    expect(COLLECTIONS.predictionMarketOutcomes.schema.safeParse(sealed).success).toBe(true);
    for (const id of ["h01", "h02"]) {
      const stored = (
        await adminDb.doc(COLLECTIONS.replicationHypotheses.docPath("SyntheticStudy2004", id)).get()
      ).data();
      for (const field of ["nullSigSource", "studyDescriptionUrl", "infosheetUrl"])
        expect(stored).not.toHaveProperty(field);
      expect(COLLECTIONS.replicationHypotheses.schema.safeParse(stored).success, id).toBe(true);
    }
    const first = (
      await adminDb.doc(COLLECTIONS.replicationHypotheses.docPath("SyntheticStudy2004", "h01")).get()
    ).data();
    expect(first?.importedValues).toEqual({ text: "A synthetic hypothesis 1." });
    expect(first?.fieldSources).toEqual({ text: "record-h01" });
    // The study with no material gets no sealed document.
    expect((await adminDb.doc(COLLECTIONS.predictionMarketOutcomes.docPath("SyntheticStudy2005")).get()).exists).toBe(
      false,
    );
    // The links to the market's documents are gone, and the link to the paper stays.
    expect((await adminDb.doc(linkOf("replication__SyntheticStudy2004", "pmStudyDescription")).get()).exists).toBe(
      false,
    );
    expect((await adminDb.doc(linkOf("replication__SyntheticStudy2004", "pmInfosheet")).get()).exists).toBe(false);
    expect((await adminDb.doc(linkOf("programme__eegmanylabs", "pmGeneralInfo")).get()).exists).toBe(false);
    expect((await adminDb.doc(linkOf("replication__SyntheticStudy2004", "originalPaper")).get()).exists).toBe(true);
    // The change log keeps its entries without the sealed values, and marks them sealed.
    const hypothesisEntry = (await adminDb.doc(`${changes}/000001`).get()).data();
    expect(hypothesisEntry).toMatchObject({ sealed: true, after: { text: "A synthetic hypothesis 1." } });
    expect(JSON.stringify(hypothesisEntry)).not.toContain(infosheet);
    expect(JSON.stringify(hypothesisEntry)).not.toContain("nullSigSource");
    expect((await adminDb.doc(`${changes}/000002`).get()).data()).toMatchObject({
      sealed: true,
      before: null,
      after: { sealed: true },
    });
    expect((await adminDb.doc(`${changes}/000003`).get()).get("sealed")).toBe(false);
    // The items lose the shown value and are sealed; the option of a list is vocabulary and stays as it was.
    for (const id of ["item-link", "item-null-sig"]) {
      const stored = (await adminDb.doc(COLLECTIONS.reconciliationItems.docPath(id)).get()).data();
      expect(stored?.sealed, id).toBe(true);
      expect(stored?.candidates[0], id).not.toHaveProperty("valueSource");
    }
    const option = (await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("item-option")).get()).data();
    expect(option).toMatchObject({ sealed: false, candidates: [{ valueSource: "postponed" }] });

    // A second run finds nothing to change.
    expect(await migrateSealedOutcomes(adminDb, { apply: true })).toEqual(NOTHING);
  });

  it("seals the change-log entries, review items and figures that imports wrote before the seal", async () => {
    await replicationWithLabels("SyntheticStudy2003", null);
    const batch = "run__20261101T000000000Z__cccccccccccc";
    const changes = COLLECTIONS.importBatchChanges.collectionPath(batch);
    await adminDb.doc(COLLECTIONS.importBatches.docPath(batch)).set({ ...standard(), sourceKey: "e", mode: "apply" });
    const appended = { schemaVersion: 1, createdAt: Timestamp.now(), createdBy: "system:import", batchId: batch };
    // An entry that rehearsed the labels in the detail document before the seal, and one about something else.
    await adminDb.doc(`${changes}/000001`).set({
      ...appended,
      documentPath: COLLECTIONS.replicationDetail.docPath("SyntheticStudy2003"),
      operation: "update",
      relation: "updated",
      sourceRecordIds: ["record-synthetic"],
      before: { internalNotes: "A synthetic note." },
      after: {
        internalNotes: "A synthetic note.",
        replicatedSource: { h01: "synthetic label" },
        importedValues: { replicatedSource: { h01: "synthetic label" } },
      },
    });
    await adminDb.doc(`${changes}/000002`).set({
      ...appended,
      documentPath: COLLECTIONS.replications.docPath("SyntheticStudy2003"),
      operation: "update",
      relation: "updated",
      sourceRecordIds: ["record-synthetic"],
      before: { studyKey: "SyntheticStudy2003" },
      after: { studyKey: "SyntheticStudy2003" },
    });
    const item = (candidates: object[], field: string) => ({
      ...standard(),
      kind: "unverifiedLabel",
      entityRefs: [],
      sourceKey: "e",
      field,
      candidates,
      status: "superseded",
      resolvedBy: null,
      resolvedAt: null,
      batchId: batch,
    });
    // Items raised before the seal showed the label and the figure.
    await adminDb
      .doc(COLLECTIONS.reconciliationItems.docPath("item-label"))
      .set(item([{ key: "e/hypotheses/replicated:0123456789ab", valueSource: "synthetic label" }], "labelsSource"));
    await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("item-figure")).set(
      item(
        [
          { key: "f/synthetictab/nLabsSigned:0123456789ab", valueSource: "7", sourceRecordId: "record-synthetic" },
          { key: "f/synthetictab/study:0123456789ab", valueSource: "SyntheticStudy2003" },
        ],
        "nLabsSigned",
      ),
    );
    await adminDb
      .doc(COLLECTIONS.reconciliationItems.docPath("item-other"))
      .set(item([{ key: "d/studies/stage:0123456789ab", valueSource: "Data collection" }], "publicStageName"));
    // A figure of source F written before the decision was named on it.
    await adminDb.doc(COLLECTIONS.sourceRecords.docPath("record-f")).set({ ...standard(), sourceKey: "f" });
    await adminDb.doc(COLLECTIONS.historicalAggregates.docPath("nLabsSigned__record-f")).set({
      ...standard(),
      replicationIds: ["SyntheticStudy2003"],
      metricKey: "nLabsSigned",
      valueSource: "7",
      valueNumeric: 7,
      sourceRecordId: "record-f",
      isCurrent: true,
      dataOrigin: "importedHistorical",
    });

    const dry = await migrateSealedOutcomes(adminDb, { apply: false });
    expect(dry).toEqual({
      moved: [],
      cleared: [],
      materialMoved: [],
      linksRemoved: 0,
      entriesSealed: 1,
      entriesMarked: 1,
      itemsSealed: 2,
      itemsMarked: 1,
      aggregatesSealed: 1,
    });
    expect((await adminDb.doc(`${changes}/000001`).get()).get("sealed")).toBeUndefined();

    await migrateSealedOutcomes(adminDb, { apply: true });
    const sealedEntry = (await adminDb.doc(`${changes}/000001`).get()).data();
    expect(sealedEntry).toMatchObject({
      sealed: true,
      after: { internalNotes: "A synthetic note.", importedValues: {} },
    });
    expect(JSON.stringify(sealedEntry)).not.toContain("synthetic label");
    expect((await adminDb.doc(`${changes}/000002`).get()).get("sealed")).toBe(false);
    const label = (await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("item-label")).get()).data();
    expect(label).toMatchObject({ sealed: true, candidates: [{ key: "e/hypotheses/replicated:0123456789ab" }] });
    expect(JSON.stringify(label)).not.toContain("synthetic label");
    const figure = (await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("item-figure")).get()).data();
    expect(figure?.sealed).toBe(true);
    // The figure loses its shown value, and the claim that names the study keeps its own.
    expect(figure?.candidates).toEqual([
      { key: "f/synthetictab/nLabsSigned:0123456789ab", sourceRecordId: "record-synthetic" },
      { key: "f/synthetictab/study:0123456789ab", valueSource: "SyntheticStudy2003" },
    ]);
    expect((await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("item-other")).get()).get("sealed")).toBe(false);
    const aggregate = await adminDb.doc(COLLECTIONS.historicalAggregates.docPath("nLabsSigned__record-f")).get();
    expect(aggregate.get("sealedBy")).toMatchObject({ reference: "docs/MIGRATION_PLAN.md, section 11, question 14" });

    // A second run finds nothing to change.
    expect(await migrateSealedOutcomes(adminDb, { apply: true })).toEqual(NOTHING);
  });
});

const NOTHING = {
  moved: [],
  cleared: [],
  materialMoved: [],
  linksRemoved: 0,
  entriesSealed: 0,
  entriesMarked: 0,
  itemsSealed: 0,
  itemsMarked: 0,
  aggregatesSealed: 0,
};
