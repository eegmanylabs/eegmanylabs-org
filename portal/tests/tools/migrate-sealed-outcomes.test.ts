// The migration that moves the outcome labels of the prediction market out of the restricted
// document of a replication, which its team reads, into the sealed document that programme
// administrators alone read (docs/MIGRATION_PLAN.md, section 11, question 7). Run against the
// emulators. The labels and studies are synthetic.
import { COLLECTIONS } from "@eegml/shared";
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
  entriesSealed: 0,
  entriesMarked: 0,
  itemsSealed: 0,
  itemsMarked: 0,
  aggregatesSealed: 0,
};
