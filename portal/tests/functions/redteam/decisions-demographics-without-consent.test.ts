// Red-team attempts to keep or recover gender and ethnicity without consent, which the programme
// lead ruled out on 13 November 2026 (docs/MIGRATION_PLAN.md, section 11, question 20: "held only
// for members who give explicit consent, and are left blank for everyone else").
//
// The membership importer removes a copy of the cells that an earlier apply kept beneath a source
// record (tools/src/import/preview.ts, `specialCellChanges`). Like every change of a
// special-category document, the removal keeps the state before it beside its change-log entry,
// so the cells survive in `importBatches/{batch}/changes/{n}/special/state`, and a rollback of that
// batch writes them back, whether or not the person has consented.
// Fixtures are synthetic: a fictitious person, row and terms.
import { COLLECTIONS, rollbackImportBatchContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { rollbackBatch } from "../../../tools/src/import/rollback";
import { adminDb } from "../../support/admin";
import { administrator, call, resetWorld, standard, withoutTriggers } from "../support";

withoutTriggers();
beforeEach(resetWorld);

const BATCH = "run__20261114T000000000Z__bbbbbbbbbbbb";
const RECORD = "record-synthetic-member-row";
const PERSON = "person-synthetic-no-consent";
const CELLS = { raw: { H: "synthetic-gender-term", I: "synthetic-ethnicity-term" } };

/** A later apply of the membership workbook that removed the cells kept beneath the row of a person without consent. */
async function batchThatRemovedTheCells(): Promise<void> {
  await adminDb.doc(COLLECTIONS.persons.docPath(PERSON)).set({ ...standard(), sourceRecordIds: [RECORD] });
  await adminDb.doc(COLLECTIONS.importBatches.docPath(BATCH)).set({
    ...standard(),
    sourceKey: "g",
    mode: "apply",
    status: "applied",
  });
  const entry = `${COLLECTIONS.importBatchChanges.collectionPath(BATCH)}/000001`;
  await adminDb.doc(entry).set({
    schemaVersion: 1,
    createdAt: Timestamp.now(),
    createdBy: "system:import",
    batchId: BATCH,
    documentPath: COLLECTIONS.sourceRecordSpecial.path,
    operation: "delete",
    relation: "updated",
    sourceRecordIds: [RECORD],
    before: { specialCategory: true },
    after: null,
  });
  await adminDb.doc(COLLECTIONS.importBatchChangeState.docPath(BATCH, "000001")).set({
    schemaVersion: 1,
    createdAt: Timestamp.now(),
    createdBy: "system:import",
    documentPath: COLLECTIONS.sourceRecordSpecial.docPath(RECORD),
    before: { ...standard(), ...CELLS },
    after: null,
  });
}

describe("special-category cells of a person who has not consented", () => {
  it("are not written back by a rollback of the batch that removed them", async () => {
    await batchThatRemovedTheCells();
    const consent = await adminDb.doc(COLLECTIONS.personDemographicsConsent.docPath(PERSON)).get();
    expect(consent.exists).toBe(false);
    await rollbackBatch(adminDb, BATCH, new Date("2026-11-15T00:00:00Z"));
    const cells = await adminDb.doc(COLLECTIONS.sourceRecordSpecial.docPath(RECORD)).get();
    expect(cells.exists).toBe(false);
  });

  it("are not written back by the rollback that an administrator asks for in the portal either", async () => {
    await batchThatRemovedTheCells();
    const admin = await administrator("uid-admin-rollback-consent");
    const planned = await call(admin, rollbackImportBatchContract, { batchId: BATCH, confirm: false });
    expect(planned).toMatchObject({ status: "planned", counts: { restored: 0, discarded: 1 } });
    await call(admin, rollbackImportBatchContract, { batchId: BATCH, confirm: true });
    expect((await adminDb.doc(COLLECTIONS.sourceRecordSpecial.docPath(RECORD)).get()).exists).toBe(false);
  });
});
