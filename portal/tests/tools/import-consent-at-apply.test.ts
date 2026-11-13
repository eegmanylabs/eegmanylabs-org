// The apply of an import writes gender and ethnicity only while the person's consent is in force
// (docs/MIGRATION_PLAN.md, section 11, question 20). The plan reads the consent, but a withdrawal
// may land between the plan and the write, so the apply reads it again in the transaction that
// writes the values. These tests stage a planned write and change the consent before the apply.
// Fixtures are synthetic: a fictitious person, row and term.
import { COLLECTIONS, importBatchId } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { applyDiff } from "../../tools/src/import/apply";
import { createdFields, IMPORT_ACTOR } from "../../tools/src/import/context";
import type { PlanDiff } from "../../tools/src/import/preview";
import { adminDb } from "../support/admin";
import { recordConsent } from "../support/consent";
import { freshDatabase, nextInstant } from "./import-support";

beforeEach(freshDatabase);

const PERSON = "person-synthetic-consent-race";
const RECORD = "record-synthetic-consent-race";
const VALUES = COLLECTIONS.personDemographics.docPath(PERSON);

/** A batch that was planned while the person's consent was in force, and is about to write their values. */
async function plannedBatch() {
  const started = nextInstant();
  const now = Timestamp.fromDate(started);
  const batchId = importBatchId(started, "0".repeat(64));
  await adminDb.doc(COLLECTIONS.importBatches.docPath(batchId)).create({
    ...createdFields(now),
    schemaVersion: 1,
    sourceKey: "g",
    mode: "apply",
    status: "running",
    contentHash: "0".repeat(64),
    startedBy: IMPORT_ACTOR,
    startedAt: now,
    finishedAt: null,
    stats: {},
  });
  const diff: PlanDiff = {
    changes: [
      {
        path: VALUES,
        collection: "personDemographics",
        operation: "create",
        relation: "created",
        before: null,
        after: {
          ...createdFields(now),
          schemaVersion: 1,
          genderSource: "synthetic-gender-term",
          sourceRecordId: RECORD,
          recordedAt: now,
          sourceRecordIds: [RECORD],
        },
        changedFields: ["genderSource"],
        sourceRecordIds: [RECORD],
        updateTime: null,
      },
    ],
    unchanged: new Map(),
    itemChanges: [],
    itemsStanding: 0,
    conflicts: 0,
    specialDiscarded: 0,
    planHash: "synthetic-plan",
  };
  return { context: { db: adminDb, sourceKey: "g", batchId, now }, diff };
}

describe("an apply that writes gender and ethnicity", () => {
  it("leaves out the values of a person whose consent was withdrawn after the plan", async () => {
    const { context, diff } = await plannedBatch();
    // No record of consent is in force at the moment of the write.
    expect(await applyDiff(context, diff)).toEqual({ committed: 0, discarded: 1 });
    expect((await adminDb.doc(VALUES).get()).exists).toBe(false);
    const log = await adminDb.collection(COLLECTIONS.importBatchChanges.collectionPath(context.batchId)).get();
    expect(log.size).toBe(0);
  });

  it("writes the values, with their log entry and kept state, while the consent is in force", async () => {
    await recordConsent(PERSON);
    const { context, diff } = await plannedBatch();
    expect(await applyDiff(context, diff)).toEqual({ committed: 1, discarded: 0 });
    expect((await adminDb.doc(VALUES).get()).get("genderSource")).toBe("synthetic-gender-term");
    const log = await adminDb.collection(COLLECTIONS.importBatchChanges.collectionPath(context.batchId)).get();
    expect(log.docs.map((entry) => entry.get("after"))).toEqual([{ specialCategory: true }]);
  });
});
