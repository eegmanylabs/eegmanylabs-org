// Red-team attempts on the code that applies the programme's answers of 13 November 2026
// (docs/DECISIONS.md, "Answers given on 13 November 2026", and docs/MIGRATION_PLAN.md, section 11):
//
// | Attempt                                                                       | Decision            |
// |-------------------------------------------------------------------------------|---------------------|
// | The retention of questions 20 and 21 meets an outreach contact as the importer writes it | Questions 20 and 21 |
// | A production procedure accepts one person as operator and approver            | Deployment roles    |
// | The candidate keys of items about sealed labels let a reader compare outcomes | Question 7          |
//
// Fixtures are synthetic: fictitious contacts, studies and names on the example.org domain.
import { COLLECTIONS, outreachContactDocSchema } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { sweepRetention } from "../../../functions/src/governance/retention";
import { requireApproval } from "../../../ops/procedure.mjs";
import { itemBuilders } from "../../../tools/src/import/reconcile";
import { adminDb } from "../../support/admin";
import { resetWorld, standard, withoutTriggers } from "../support";

withoutTriggers();
beforeEach(resetWorld);

const DAY = 86_400_000;

describe("the retention of the raw material of the migration (questions 20 and 21)", () => {
  /**
   * An outreach contact of source F as the recruitment importer writes it for a person who never
   * joined: the plan leaves `personId` undefined, so the stored document has no such field at all.
   */
  async function outsiderAsImported(id: string): Promise<void> {
    const recordId = `record-${id}`;
    await adminDb.doc(COLLECTIONS.sourceRecords.docPath(recordId)).set({
      ...standard(),
      sourceKey: "f",
      tabKey: "synthetictab",
      rowKey: `contact__${id}`,
      rowNumber: 4,
      raw: { A: "Synthetic Outsider", B: "synthetic.outsider@example.org" },
      rawHash: "aaaaaaaaaaaa",
      observedOn: "2026-11-09",
      supersededById: null,
    });
    await adminDb.doc(COLLECTIONS.outreachContacts.docPath(id)).set({
      ...standard(),
      replicationId: "SyntheticStudy2001",
      contactNameSource: "Synthetic Outsider",
      sourceRecordId: recordId,
      scopeKeys: ["rep:SyntheticStudy2001"],
    });
  }

  it("cannot meet a contact whose personId is null, because the schema allows no null there", () => {
    expect(outreachContactDocSchema.shape.personId.safeParse(null).success).toBe(false);
  });

  it("deletes the contact of a person who never joined once the three years after verification have passed", async () => {
    await outsiderAsImported("contact-outsider");
    const verifiedAt = new Date("2027-03-01T00:00:00Z");
    const before = await sweepRetention(
      adminDb,
      { retention: {}, migrationVerifiedAt: verifiedAt },
      new Date(verifiedAt.getTime() + 1_096 * DAY - 1),
      false,
    );
    expect(before.find((outcome) => outcome.target === "outreachNeverJoined")).toMatchObject({ deleted: 0 });
    expect((await adminDb.doc(COLLECTIONS.outreachContacts.docPath("contact-outsider")).get()).exists).toBe(true);
    const later = new Date(verifiedAt.getTime() + 1_096 * DAY + 1);
    const outcomes = await sweepRetention(adminDb, { retention: {}, migrationVerifiedAt: verifiedAt }, later, false);
    expect(outcomes.find((outcome) => outcome.target === "outreachNeverJoined")).toMatchObject({ deleted: 1 });
    expect((await adminDb.doc(COLLECTIONS.outreachContacts.docPath("contact-outsider")).get()).exists).toBe(false);
  });

  it("deletes nothing before the migration is marked verified, whatever the clock says", async () => {
    await outsiderAsImported("contact-early");
    const outcomes = await sweepRetention(
      adminDb,
      { retention: {}, migrationVerifiedAt: null },
      new Date(Timestamp.now().toMillis() + 5000 * DAY),
      false,
    );
    expect(outcomes.find((outcome) => outcome.target === "outreachNeverJoined")).toMatchObject({ deleted: 0 });
    expect((await adminDb.doc(COLLECTIONS.outreachContacts.docPath("contact-early")).get()).exists).toBe(true);
  });
});

describe("the approval of a production procedure (deployment roles)", () => {
  const options = (operator: string, approver: string) =>
    new Map([
      ["operator", operator],
      ["approver", approver],
    ]);

  it("refuses one person as operator and approver on production, however the name is written", () => {
    for (const [operator, approver] of [
      ["Synthetic Lead", "Synthetic Lead"],
      ["Synthetic Lead", "synthetic  lead"],
      ["Synthetic Lead", "Synthetic Lead."],
      ["Synthetic Lead", "Synthetic-Lead"],
      ["Synthetic Lead", "Synthétic Lead"],
      ["Synthetic Lead", "S. Lead"],
    ] as const) {
      expect(() => requireApproval("production", options(operator, approver)), `${operator} / ${approver}`).toThrow(
        /second named approver/,
      );
    }
  });
});

describe("the candidate keys of items about sealed outcome labels (question 7)", () => {
  const items = itemBuilders("synthetic-hash-key-for-red-team-tests-only-0123456789");
  const labelItem = (study: string, hypothesis: string, label: string) =>
    items.unverifiedLabel({
      subject: `${study}__${hypothesis}`,
      field: "labelsSource",
      entityRefs: [{ entityType: "hypothesis", entityId: `${study}__${hypothesis}` }],
      personal: true,
      claims: [{ source: "e/replicated", value: label, sourceRecordId: `record-${study}-${hypothesis}` }],
    });

  it("gives a reader of the queue no way to tell which hypotheses share an outcome label", () => {
    const one = labelItem("SyntheticOne2001", "h01", "yes");
    const two = labelItem("SyntheticTwo2002", "h03", "yes");
    const three = labelItem("SyntheticTwo2002", "h04", "no");
    // A reader who knows one published outcome would otherwise learn every label equal to it.
    expect(one.candidates[0]?.key).not.toBe(two.candidates[0]?.key);
    expect(two.candidates[0]?.key).not.toBe(three.candidates[0]?.key);
  });
});
