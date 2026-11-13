// Red-team attempts on the seal of the programme's answers of 13 November 2026
// (docs/MIGRATION_PLAN.md, section 11, questions 7 and 14): "no one may see prediction-market
// data" and the summary figures of source F are "visible to programme administrators only". The
// sealed collections themselves are read by administrators alone
// (tests/rules/programme-answers-features.test.ts). These attempts read the same values through
// the review queue and the change log of an import, which the core team reads through
// `reconciliation.resolve` and `imports.run`.
// Fixtures are synthetic: a fictitious study, synthetic batch and item identifiers.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld, trusted } from "../seed";
import { createRulesEnvironment } from "../support";
import { stored } from "../world";

let environment: RulesTestEnvironment;
const { get } = requestsOf(() => environment);

const STUDY = "SyntheticSealed2001";
const BATCH = "run__20261113T000000000Z__aaaaaaaaaaaa";
/** Two items about the outcome label of two hypotheses, as the prediction-market importer raises them. */
const LABEL_ITEM_ONE = "ffffffffffffffffffff0001";
const LABEL_ITEM_TWO = "ffffffffffffffffffff0002";
/** An item about a figure of the summary tab of source F. */
const FIGURE_ITEM = "ffffffffffffffffffff0003";
/** A change-log entry that an import wrote before the labels were sealed, which the migration leaves in place. */
const LEGACY_CHANGE = `importBatches/${BATCH}/changes/000001`;

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-redteam-decisions-sealed");
  await seedWorld(environment);
  const item = (subject: string, field: string, source: string, key: string) => ({
    ...stored(),
    kind: field === "labelsSource" ? "unverifiedLabel" : "unparsedValue",
    status: "open",
    subject: `${subject}#${field}`,
    field,
    sourceKey: source.slice(0, 1),
    entityRefs: [{ entityType: "replication", entityId: STUDY }],
    // The key of a claim about a sealed value is a keyed hash of the value alone, so equal labels give equal keys.
    candidates: [{ key: `${source}:${key}`, sourceRecordId: "record-synthetic" }],
    blocking: false,
  });
  await trusted(environment, async (db) => {
    await setDoc(
      doc(db, `reconciliationItems/${LABEL_ITEM_ONE}`),
      item(`${STUDY}__h01`, "labelsSource", "e/replicated", "0123456789abcdef"),
    );
    await setDoc(
      doc(db, `reconciliationItems/${LABEL_ITEM_TWO}`),
      item(`${STUDY}__h02`, "labelsSource", "e/replicated", "0123456789abcdef"),
    );
    await setDoc(
      doc(db, `reconciliationItems/${FIGURE_ITEM}`),
      item("f/numberoflabsperreplication", "labsCompleted", "f/numberOfLabsPerReplication/labsCompleted", "fedcba98"),
    );
    await setDoc(doc(db, LEGACY_CHANGE), {
      ...stored(),
      batchId: BATCH,
      documentPath: `replications/${STUDY}/private/detail`,
      operation: "update",
      relation: "updated",
      sourceRecordIds: ["record-synthetic"],
      before: null,
      // What an import of source E that rehearsed the labels wrote before the seal; migrate:sealed-outcomes keeps it.
      after: { replicatedSource: { h01: "synthetic-label" } },
    });
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("the review queue and the change log under the seal of questions 7 and 14", () => {
  it("lets no one below a programme administrator read an item about a sealed outcome label", async () => {
    await expectOutcomes({
      "the programme administrator reads the item": ["allowed", get("admin", `reconciliationItems/${LABEL_ITEM_ONE}`)],
      // The item exists only where the hypothesis has a label, and its candidate key equals that of every other
      // hypothesis with the same label, so reading two items tells the core team which outcomes are equal.
      "the core team reads the first item": ["denied", get("coreTeam", `reconciliationItems/${LABEL_ITEM_ONE}`)],
      "the core team reads the second item": ["denied", get("coreTeam", `reconciliationItems/${LABEL_ITEM_TWO}`)],
    });
  });

  it("lets no one below a programme administrator read an item about a sealed summary figure of source F", async () => {
    await expectOutcomes({
      "the programme administrator reads the item": ["allowed", get("admin", `reconciliationItems/${FIGURE_ITEM}`)],
      "the core team reads the item": ["denied", get("coreTeam", `reconciliationItems/${FIGURE_ITEM}`)],
    });
  });

  it("lets no one below a programme administrator read a change-log entry that holds a label from before the seal", async () => {
    await expectOutcomes({
      "the programme administrator reads the entry": ["allowed", get("admin", LEGACY_CHANGE)],
      "the core team reads the entry": ["denied", get("coreTeam", LEGACY_CHANGE)],
    });
  });
});
