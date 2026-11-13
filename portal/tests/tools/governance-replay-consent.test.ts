// Integration test of the governance ledger for a withdrawal of consent (docs/SECURITY.md,
// section 10): a restore to a moment before a person withdrew consent to holding their gender and
// ethnicity brings the values back, and `governance:replay` deletes them again with every kept
// copy and marks the record of consent withdrawn. The people and values are synthetic.
import { COLLECTIONS, personDemographicsConsentDocSchema, sequenceId } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { replayLedger } from "../../tools/src/governance/replay";
import { adminAuth, adminDb } from "../support/admin";
import { recordConsent } from "../support/consent";
import { freshDatabase } from "./import-support";

beforeEach(freshDatabase);

const PERSON = "person-replay-consent";
const RECORD = "record-replay-consent";
const handles = { db: adminDb, auth: adminAuth };

const standard = () => {
  const now = Timestamp.now();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system:test",
    updatedBy: "system:test",
    archivedAt: null,
    writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
  };
};

/** The state that a restore from before the withdrawal brings back: consent in force, the values and a kept copy. */
async function restoredState(): Promise<{ values: string; state: string }> {
  await recordConsent(PERSON);
  const values = COLLECTIONS.personDemographics.docPath(PERSON);
  await adminDb.doc(values).set({
    ...standard(),
    genderSource: "synthetic restored term",
    sourceRecordIds: [RECORD],
    recordedAt: Timestamp.now(),
  });
  await adminDb.doc(COLLECTIONS.importBatchChanges.docPath("batch-replay", sequenceId(1))).set({
    ...standard(),
    documentPath: COLLECTIONS.personDemographics.path,
    sourceRecordIds: [RECORD],
  });
  const state = COLLECTIONS.importBatchChangeState.docPath("batch-replay", sequenceId(1));
  await adminDb.doc(state).set({ ...standard(), documentPath: values, before: null, after: {} });
  return { values, state };
}

describe("a withdrawal of consent in the governance ledger", () => {
  it("is applied again after a restore: the values and their copies go, and the record says withdrawn", async () => {
    const { values, state } = await restoredState();
    const at = new Date("2026-11-20T10:00:00.000Z");
    const entries = [{ kind: "demographicsWithdrawn" as const, at: at.toISOString(), personId: PERSON }];

    const summary = await replayLedger(handles, entries, new Date("2026-11-21T10:00:00.000Z"));
    expect(summary).toMatchObject({ consentsWithdrawn: 1, alreadyApplied: 0 });
    expect((await adminDb.doc(values).get()).exists).toBe(false);
    expect((await adminDb.doc(state).get()).exists).toBe(false);
    const record = personDemographicsConsentDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.personDemographicsConsent.docPath(PERSON)).get()).data(),
    );
    expect(record.status).toBe("withdrawn");
    expect(record.withdrawnAt?.toDate().toISOString()).toBe(at.toISOString());
    expect(record.history.at(-1)).toMatchObject({ status: "withdrawn", auditEventId: null });

    // A second replay of the same ledger finds nothing left to do.
    const again = await replayLedger(handles, entries, new Date("2026-11-22T10:00:00.000Z"));
    expect(again).toMatchObject({ consentsWithdrawn: 0, alreadyApplied: 1 });
  });
});
