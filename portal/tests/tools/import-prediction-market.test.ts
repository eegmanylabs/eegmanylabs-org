// Integration tests of the importer of the prediction-market hypotheses (source E) against the
// Firestore emulator. The workbook, the list of studies and the website data it meets are
// synthetic: every study, hypothesis, label, note, reviewer and address in them is invented.
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  COLLECTION_ENTRIES,
  documentLinkSlotId,
  entityRefId,
  keyedShortHash,
  predictionMarketItemId,
  reconciliationFingerprint,
  sourceTabKey,
  studyAliasId,
  vocabularyTermId,
} from "@eegml/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listOfStudiesWorkbook } from "../../tools/src/import/fixtures/list-of-studies";
import {
  HYPOTHESES,
  PAPERS,
  PREDICTION_MARKET_RESTRICTED,
  PROGRAMME_LINK,
  type PredictionMarketOptions,
  predictionMarketWorkbook,
  REVIEW_NOTES,
  REVIEW_STATUS_LABEL,
} from "../../tools/src/import/fixtures/prediction-market";
import { writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import type { RunReport } from "../../tools/src/import/run";
import { importer as studies } from "../../tools/src/import/sources/list-of-studies";
import { importer as market, TAB_TITLES } from "../../tools/src/import/sources/prediction-market";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  reconciliationItems,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

async function workbookFile(options: PredictionMarketOptions = {}): Promise<string> {
  const file = path.join(temporaryDirectory(), "prediction-market.xlsx");
  writeFileSync(file, await predictionMarketWorkbook(options));
  return file;
}

const applyWebsite = () => run(website, writeWebsiteFixture(temporaryDirectory()), "apply");
/** Applies the synthetic list of studies, which makes the two studies that the website does not hold. */
async function applyStudies(): Promise<void> {
  const file = path.join(temporaryDirectory(), "list-of-studies.xlsx");
  writeFileSync(file, await listOfStudiesWorkbook());
  await run(studies, file, "apply");
}

const tabKey = (tab: keyof typeof TAB_TITLES) => sourceTabKey(TAB_TITLES[tab]);
const replication = async (studyId: string) => (await adminDb.doc(`replications/${studyId}`).get()).data();
const hypothesis = async (studyId: string, id: string) =>
  (await adminDb.doc(`replications/${studyId}/hypotheses/${id}`).get()).data();
/** The sealed outcome labels of a replication, which programme administrators alone read (question 7). */
const sealed = async (studyId: string) => (await adminDb.doc(`predictionMarketOutcomes/${studyId}`).get()).data();
const link = async (studyId: string, slot: string) =>
  (await adminDb.doc(`documentLinks/${documentLinkSlotId(entityRefId("replication", studyId), slot)}`).get()).data();
const alias = async (studyId: string, scheme: Parameters<typeof studyAliasId>[0], spelling: string) =>
  (await adminDb.doc(`replications/${studyId}/aliases/${studyAliasId(scheme, spelling)}`).get()).data();
const sourceRecords = async (tab: keyof typeof TAB_TITLES) =>
  (await adminDb.collection("sourceRecords").where("sourceKey", "==", "e").get()).docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DocumentData & { readonly id: string })
    .filter((record) => record.tabKey === tabKey(tab));

type Item = DocumentData & { readonly id: string };
/** The open items of source E of one kind, optionally of one field and about one record. */
async function items(kind: string, field?: string, entityId?: string): Promise<Item[]> {
  return (await reconciliationItems()).filter(
    (item) =>
      item.sourceKey === "e" &&
      item.status === "open" &&
      item.kind === kind &&
      (field === undefined || item.field === field) &&
      (entityId === undefined || (item.entityRefs as { entityId: string }[]).some((ref) => ref.entityId === entityId)),
  );
}
const claimSources = (item: Item | undefined) =>
  ((item?.candidates ?? []) as { key: string }[]).map((entry) => entry.key.split(":")[0]);
const claimValues = (item: Item | undefined) =>
  ((item?.candidates ?? []) as { valueSource?: string }[]).map((entry) => entry.valueSource);

/** The documents that members can read: everything in a collection whose data class is public or member. */
async function memberReadable(): Promise<Map<string, DocumentData>> {
  const open = COLLECTION_ENTRIES.filter((entry) => entry.dataClass === "public" || entry.dataClass === "member");
  const found = new Map<string, DocumentData>();
  for (const [documentPath, document] of await allDocuments()) {
    const segments = documentPath.split("/");
    const entry = open.find((candidate) => {
      const template = candidate.path.split("/");
      return (
        template.length === segments.length &&
        template.every((part, index) => part.startsWith("{") || part === segments[index])
      );
    });
    if (entry !== undefined) found.set(documentPath, document.data);
  }
  return found;
}

afterAll(removeTemporaryDirectories);

describe("the prediction-market hypotheses, applied after the website data and the list of studies", () => {
  let report: RunReport;
  let file: string;
  beforeAll(async () => {
    await freshDatabase();
    await applyWebsite();
    await applyStudies();
    file = await workbookFile();
    report = await run(market, file, "apply");
  });

  it("accounts for every row of every tab, the hidden rows and the hidden tab included", () => {
    expect(report.status).toBe("applied");
    expect(report.blocking).toEqual([]);
    const byTab = Object.fromEntries(report.tabs.map((tab) => [tab.tabKey, tab]));
    expect(byTab[tabKey("hypotheses")]).toMatchObject({
      rows: expect.objectContaining({ header: 1, data: 12, annotation: 3, blank: 3 }),
      imported: 12,
      queued: 0,
      rawOnly: {},
      unaccounted: 0,
    });
    expect(byTab[tabKey("review")]).toMatchObject({
      rows: expect.objectContaining({ header: 1, data: 8, annotation: 0, blank: 0 }),
      imported: 8,
      queued: 0,
      unaccounted: 0,
    });
    expect(byTab[tabKey("questions")]).toMatchObject({
      rows: expect.objectContaining({ header: 1, data: 17, blank: 6 }),
      imported: 17,
      queued: 0,
      unaccounted: 0,
    });
    for (const tab of report.tabs) {
      const raw = Object.values(tab.rawOnly).reduce((sum, count) => sum + count, 0);
      expect(tab.imported + tab.queued + raw, tab.tabKey).toBe(tab.rows.data);
    }
    // The workbook creates no replication, whatever its rows name.
    expect(report.collections.replications?.created ?? 0).toBe(0);
  });

  it("imports the hypotheses of hidden rows like any other, and stores that their rows are hidden", async () => {
    expect((await documentsOf("hypotheses", true)).size).toBe(12);
    expect(await hypothesis("Kappa2006", "h01")).toMatchObject({ text: "Losses give a larger negativity" });
    expect(await hypothesis("Kappa2006", "h02")).toBeDefined();
    const records = await sourceRecords("hypotheses");
    const hidden = records.filter((record) => (record.raw as Record<string, { hiddenRow?: boolean }>).A?.hiddenRow);
    expect(hidden.map((record) => record.rowKey).sort()).toEqual(["kappa2006__h01", "kappa2006__h02"]);
    expect((await adminDb.doc(`sources/e/tabs/${tabKey("review")}`).get()).data()).toMatchObject({
      name: "review",
      visibility: "hidden",
      rowCount: 8,
      importerKey: "predictionMarket",
    });
  });

  it("identifies a hypothesis by its study and its two-digit number, beneath its replication", async () => {
    const paths = [...(await documentsOf("hypotheses", true)).keys()];
    expect(paths).toContain("replications/Delta1999/hypotheses/h01");
    expect(paths).toContain("replications/Delta1999/hypotheses/h02");
    expect(paths).toContain("replications/Delta1999/hypotheses/h03");
    // The identifier with a diacritic resolves to the existing study. No second replication appears.
    expect(paths).toContain("replications/EpsilonVanZeta2010/hypotheses/h01");
    expect((await documentsOf("replications")).size).toBe(8);
    expect(await hypothesis("Delta1999", "h03")).toMatchObject({
      replicationId: "Delta1999",
      // The number as the source writes it, and never a row number.
      hypothesisNumber: "3",
      text: "The negativity is larger for No-Go trials",
    });
    // The text is stored with its white space collapsed. The raw cell keeps every space.
    expect((await hypothesis("Iota2004", "h01"))?.text).toBe("Alpha power decreases over the attended side");
    const raw = (await sourceRecords("hypotheses")).find((record) => record.rowKey === "iota2004__h01")?.raw;
    expect(raw).toMatchObject({ E: { v: "Alpha  power decreases over  the attended side " } });
  });

  it("stores null-sig verbatim as an unverified source value: the text null is a value, and nothing states a result", async () => {
    const second = await hypothesis("AlphaBeta2001", "h02");
    expect(second?.nullSigSource).toBe("null");
    expect(typeof second?.nullSigSource).toBe("string");
    expect((await hypothesis("AlphaBeta2001", "h01"))?.nullSigSource).toBe("sig");
    for (const document of (await documentsOf("hypotheses", true)).values()) {
      expect(["sig", "null"]).toContain(document.nullSigSource);
      expect(document).toMatchObject({
        scientificReviewStatus: "unverified",
        analysisStatus: "notStarted",
        resultReviewedBy: null,
        resultReviewedAt: null,
      });
      expect(document).not.toHaveProperty("resultSummary");
      expect(document).not.toHaveProperty("replicatedSource");
    }
  });

  it("stores the replicated labels verbatim and sealed, with the decision that seals them, and leaves a blank absent", async () => {
    expect((await sealed("AlphaBeta2001"))?.labelsSource).toEqual({ h01: "no", h02: "no" });
    expect((await sealed("EtaTheta2005"))?.labelsSource).toEqual({ h01: "yes" });
    expect((await sealed("Kappa2006"))?.labelsSource).toEqual({ h01: "cancelled", h02: "cancelled" });
    expect((await sealed("Kappa2006"))?.sealedBy).toEqual({
      decidedBy: "programmeLead",
      decidedOn: "2026-11-13",
      reference: "docs/MIGRATION_PLAN.md, section 11, question 7",
    });
    // A blank is no label: the studies without one get no entry and no document, and never the label `no`.
    expect(await sealed("Delta1999")).toBeUndefined();
    expect(await sealed("AlphaGamma2002")).toBeUndefined();
    expect((await documentsOf("predictionMarketOutcomes")).size).toBe(3);
    // The restricted document of the replication, which its team reads, holds no label.
    expect((await documentsOf("private", true)).size).toBe(0);
    // A label is a string exactly as written. It is no boolean anywhere.
    const stored = JSON.stringify([...(await allDocuments()).values()].map((document) => document.data));
    expect(stored).not.toMatch(/"replicated(Source)?":(true|false)/);
    // No label changes a replication: no status, and no selection status either.
    for (const document of (await documentsOf("replications")).values()) {
      expect(document.statusKey).toBeNull();
      expect(document.selectionStatus).toBe("selected");
    }
  });

  it("raises every label as unverified, and the outcome on a null hypothesis as a question of its own", async () => {
    const labels = await items("unverifiedLabel", "labelsSource");
    expect(labels.map((item) => item.entityRefs[0].entityId).sort()).toEqual([
      "AlphaBeta2001__h01",
      "AlphaBeta2001__h02",
      "EtaTheta2005__h01",
      "Kappa2006__h01",
      "Kappa2006__h02",
    ]);
    // The labels are sealed: an item names the source record of a label and never shows it.
    for (const item of labels) expect(claimValues(item)).toEqual([undefined]);
    expect(labels[0]?.entityRefs[0].entityType).toBe("hypothesis");
    const onNull = await items("unverifiedLabel", "nullSigSource");
    expect(onNull.map((item) => item.entityRefs[0].entityId)).toEqual(["AlphaBeta2001__h02"]);
    expect(claimSources(onNull[0])).toEqual(["e/hypotheses/replicated", "e/hypotheses/null-sig"]);
    // `cancelled` on a null hypothesis is no outcome, so it asks nothing more.
    expect(await items("unverifiedLabel", "nullSigSource", "Kappa2006__h02")).toEqual([]);
  });

  it("keeps the sealed labels out of every item and out of the change log, which others than administrators read", async () => {
    const labels = ["yes", "no", "cancelled"];
    for (const item of (await reconciliationItems()).filter((candidate) => candidate.sourceKey === "e")) {
      for (const value of claimValues(item)) expect(labels, String(item.id)).not.toContain(value);
    }
    // The change log of the apply shows a marker in place of each sealed document, whose states sit where no client reads.
    const changes = await adminDb.collectionGroup("changes").get();
    const sealedChanges = changes.docs.filter((change) =>
      String(change.get("documentPath")).startsWith("predictionMarketOutcomes/"),
    );
    expect(sealedChanges.length).toBe(3);
    for (const change of sealedChanges) {
      expect(change.get("after")).toEqual({ sealed: true });
      const kept = await change.ref.collection("special").doc("state").get();
      expect(kept.get("after")).toMatchObject({
        sealedBy: { reference: "docs/MIGRATION_PLAN.md, section 11, question 7" },
      });
    }
  });

  it("reports an outcome label on a study that the website does not show as finished", async () => {
    const stage = await items("valueConflict", "publicStageName");
    expect(stage.map((item) => item.entityRefs[0].entityId)).toEqual(["AlphaBeta2001"]);
    expect(claimSources(stage[0])).toEqual([
      "portal/publicStageName",
      "e/hypotheses/replicated",
      "e/hypotheses/replicated",
    ]);
    // The stage is shown; the sealed labels are not.
    expect(claimValues(stage[0])).toEqual(["stage2_prep", undefined, undefined]);
    // The study that is finished carries its label without contradiction.
    expect(await items("valueConflict", "publicStageName", "EtaTheta2005")).toEqual([]);
    expect((await replication("AlphaBeta2001"))?.publicStageName).toBe("stage2_prep");
  });

  it("asks about the status of a study whose rows are hidden and labelled cancelled, and sets none", async () => {
    const questions = await items("statusQuestion", "status");
    expect(questions.map((item) => item.entityRefs[0].entityId)).toEqual(["Kappa2006"]);
    expect(claimSources(questions[0])).toEqual([
      "e/hypotheses/hiddenRow",
      "e/hypotheses/replicated",
      "e/hypotheses/hiddenRow",
      "e/hypotheses/replicated",
      "e/hypotheses/absentFromWebsite",
    ]);
    // Hidden rows and the label go together here, so the formatting says nothing that the text does not.
    expect(await items("formattingSignal")).toEqual([]);
  });

  it("reads the address of a link from its target and never from its label", async () => {
    const iota = await hypothesis("Iota2004", "h01");
    expect(iota?.infosheetUrl).toBe(PAPERS.Iota2004?.infosheet);
    expect(iota?.studyDescriptionUrl).toBe("https://osf.example.org/io004");
    expect(await link("Iota2004", "pmInfosheet")).toMatchObject({
      url: PAPERS.Iota2004?.infosheet,
      // The label is the title of the link. It is no address and no identifier.
      title: "Itoa2004",
      kind: "url",
      entityType: "replication",
      entityId: "Iota2004",
      replicationId: "Iota2004",
      scopeKeys: ["rep:Iota2004", "members"],
      restricted: false,
      accessStatus: "unknown",
    });
    expect(await link("Iota2004", "pmStudyDescription")).toMatchObject({ url: "https://osf.example.org/io004" });
    // The DOI of this paper is nowhere in the text of its citation. The target of the link has it.
    expect(await link("Lambda2003", "originalPaper")).toMatchObject({
      url: "https://doi.org/10.1000/invented.2003.08",
    });
    const links = [...(await documentsOf("documentLinks")).entries()].filter(([id]) =>
      /__(pm[A-Z]|originalPaper)/.test(id),
    );
    // Three links for each of the eight studies, and one for the programme.
    expect(links).toHaveLength(8 * 3 + 1);
    const general = `documentLinks/${documentLinkSlotId(entityRefId("programme", "eegmanylabs"), "pmGeneralInfo")}`;
    expect((await adminDb.doc(general).get()).data()).toMatchObject({
      url: PROGRAMME_LINK.address,
      title: PROGRAMME_LINK.label,
      entityType: "programme",
      entityId: "eegmanylabs",
      replicationId: null,
      scopeKeys: ["programme", "members"],
    });
  });

  it("resolves a variant spelling through the folded lookup and stores it as an alias of the study", async () => {
    expect(await alias("EpsilonVanZeta2010", "programme", "ÉpsilonVanZeta2010")).toMatchObject({
      replicationId: "EpsilonVanZeta2010",
      alias: "ÉpsilonVanZeta2010",
      aliasFolded: "epsilonvanzeta2010",
      scheme: "programme",
      isCanonical: false,
    });
    // The label of a link is a spelling of its own scheme, resolved through the identifier of its row.
    expect(await alias("Iota2004", "sourceLabel", "Itoa2004")).toMatchObject({
      alias: "Itoa2004",
      aliasFolded: "itoa2004",
      scheme: "sourceLabel",
      isCanonical: false,
    });
    expect((await adminDb.doc("studyAliasIndex/itoa2004").get()).data()?.replicationIds).toEqual(["Iota2004"]);
    expect(await alias("AlphaBeta2001", "sourceLabel", "AlphaBeta2001")).toMatchObject({ isCanonical: true });
    // The review tab writes the usual spellings, which name the same studies.
    expect(
      (await alias("EpsilonVanZeta2010", "programme", "EpsilonVanZeta2010"))?.sourceRecordIds?.length,
    ).toBeGreaterThan(1);

    const confirmations = await items("aliasConfirmation");
    expect(confirmations.map((item) => `${item.field}:${claimValues(item).join(" for ")}`).sort()).toEqual([
      "programme:ÉpsilonVanZeta2010",
      "sourceLabel:EpsilonVanZeta2010 for ÉpsilonVanZeta2010",
      "sourceLabel:Itoa2004 for Iota2004",
    ]);
  });

  it("offers its details of the original study as candidate values, and replaces nothing that another source stated", async () => {
    // The website writes this title in other words. Its value stays, and both go to a reviewer.
    const gamma = await replication("AlphaGamma2002");
    expect(gamma?.originalTitle).toBe("An invented study called AlphaGamma2002");
    const [title] = await items("valueConflict", "originalTitle", "AlphaGamma2002");
    expect(claimSources(title)).toEqual(["otherSource", "e"]);
    expect(claimValues(title)[1]).toBe("An invented study called AlphaGamma2002. Journal of Examples");
    // The website writes this year with a letter. The replication holds a number, and the letter is in its source record.
    const [year] = await items("valueConflict", "originalYear", "AlphaGamma2002");
    expect(claimSources(year)).toEqual(["h/replications", "e/hypotheses"]);
    expect(claimValues(year)).toEqual(["2002a", "2002"]);
    expect(gamma?.originalYear).toBe(2002);
    expect(await items("valueConflict", "originalYear")).toHaveLength(1);
    // The sources write the authors in different styles, which is no disagreement about the paper.
    expect(await items("valueConflict", "originalAuthors")).toEqual([]);
    expect(gamma?.originalAuthors).toBe("Invented, & Authors");

    // A study that the list of studies made has no authors, year or title yet: here the values are taken.
    const kappa = await replication("Kappa2006");
    expect(kappa).toMatchObject({
      originalAuthors: "Invented, A., & Authors, B.",
      originalYear: 2006,
      originalTitle: "A fictitious account of rewards that were never paid",
      dataOrigin: "importedHistorical",
    });
    const sources = kappa?.fieldSources as Record<string, string>;
    expect(sources.originalTitle).not.toBe(sources.originalReference);
    // Its reference came from the list of studies, and the one of this workbook lacks the DOI: both are kept.
    const [reference] = await items("valueConflict", "originalReference", "Lambda2003");
    expect(claimSources(reference)).toEqual(["otherSource", "e"]);
    expect((await replication("Lambda2003"))?.originalReference).toContain("https://doi.org/10.1000/invented.2003.08");
    expect(report.conflicts).toBe(2);
  });

  it("keeps the hidden review tab in its source records, and asks about the label that names a person without quoting it", async () => {
    const records = await sourceRecords("review");
    expect(records.filter((record) => record.rowNumber >= 2)).toHaveLength(8);
    expect(records.find((record) => record.rowKey === "alphabeta2001")?.raw).toMatchObject({
      review_status: { v: REVIEW_STATUS_LABEL },
      C: { v: REVIEW_NOTES[0] },
    });
    const [privacy] = await items("privacyReview");
    expect(privacy).toMatchObject({ field: "review_status", entityRefs: [] });
    expect(claimValues(privacy)).toEqual([undefined]);
    expect(JSON.stringify(privacy)).not.toContain("Zebedee");
    // Whether a note is about its study or about the tab is for a reviewer. The item holds no text of it.
    const notes = await items("annotationReview", "notes");
    expect(notes.map((item) => item.entityRefs[0].entityId).sort()).toEqual(["AlphaBeta2001", "Delta1999"]);
    for (const note of notes) expect(claimValues(note)).toEqual([undefined]);
  });

  it("writes one prediction-market item for each content row of the questions tab, linked to no hypothesis", async () => {
    const stored = await documentsOf("predictionMarketItems");
    expect(stored.size).toBe(17);
    const first = "Question about the specific paper";
    expect(stored.get(predictionMarketItemId(first, "How well do you understand the hypothesis?", 1))).toMatchObject({
      questionText: "How well do you understand the hypothesis?",
      choices: ["extremely - not at all"],
    });
    // A list of options is kept whole, as the cell writes it.
    expect(
      stored.get(predictionMarketItemId(first, "How familiar are you with the original paper?", 1))?.choices,
    ).toEqual(["I have read it, I have cited it, I wrote it, It is new to me"]);
    expect(stored.get(predictionMarketItemId("", "About you", 1))).toMatchObject({
      questionText: "About you",
      choices: [],
    });
    for (const item of stored.values()) {
      expect(item).not.toHaveProperty("replicationId");
      expect(item).not.toHaveProperty("hypothesisId");
    }
    // The question that stands twice is two items, and a reviewer is told.
    expect(stored.has(predictionMarketItemId("About you", "Shared an invented protocol", 1))).toBe(true);
    expect(stored.has(predictionMarketItemId("About you", "Shared an invented protocol", 2))).toBe(true);
    const [repeat] = await items("annotationReview", "questionText");
    expect(claimValues(repeat)).toEqual(["Shared an invented protocol", "Shared an invented protocol"]);
    // The font that tells a heading from a question is in the source record.
    const heading = (await sourceRecords("questions")).find((record) => record.rowNumber === 17);
    expect(heading?.raw).toMatchObject({ A: { v: "About you", bold: true } });
  });

  it("collects the validated lists as vocabulary, and leaves out the option that names a person", async () => {
    const term = async (kind: string, label: string) =>
      (await adminDb.doc(`vocabularyTerms/${vocabularyTermId(kind, label)}`).get()).data();
    expect(await term("pmNullSig", "null")).toMatchObject({ name: "null", kind: "pmNullSig" });
    expect(await term("pmNullSig", "sig")).toBeDefined();
    for (const label of ["no", "yes", "cancelled"]) expect(await term("pmReplicated", label), label).toBeDefined();
    expect(await term("pmReviewStatus", "checked_pass1")).toBeDefined();
    expect(await term("pmReviewStatus", "checked_pass2")).toBeDefined();
    expect(await term("pmReviewStatus", REVIEW_STATUS_LABEL)).toBeUndefined();
    expect(await term("pmChoiceFormat", "tickbox")).toMatchObject({ name: "tickbox" });
    // Every value is in its list and every option is a known one, so nothing is asked.
    expect(await items("vocabularyReview")).toEqual([]);
    // The footer counters agree with a recount of the data.
    expect(await items("annotationReview", "footer")).toEqual([]);
  });

  it("gives every item the fingerprint of its kind, its subject and its candidate values", async () => {
    const label = reconciliationFingerprint(
      {
        kind: "unverifiedLabel",
        subject: "EtaTheta2005__h01#labelsSource",
        // A sealed label is hashed together with its subject, so that equal labels of two hypotheses differ.
        candidateKeys: [
          `e/hypotheses/replicated:${keyedShortHash("EtaTheta2005__h01#labelsSource\u0000yes", TEST_HASH_KEY)}`,
        ],
      },
      TEST_HASH_KEY,
    );
    expect((await adminDb.doc(`reconciliationItems/${label}`).get()).data()).toMatchObject({
      kind: "unverifiedLabel",
      status: "open",
      sourceKey: "e",
      batchId: report.batchId,
      entityRefs: [{ entityType: "hypothesis", entityId: "EtaTheta2005__h01" }],
      sealed: true,
    });
    // The label that names a person is hashed with the secret key, so its fingerprint cannot be guessed from the name.
    const privacy = reconciliationFingerprint(
      {
        kind: "privacyReview",
        subject: "e/review/review_status#review_status",
        candidateKeys: [`e/review/review_status:${keyedShortHash(REVIEW_STATUS_LABEL, TEST_HASH_KEY)}`],
      },
      TEST_HASH_KEY,
    );
    expect((await adminDb.doc(`reconciliationItems/${privacy}`).get()).exists).toBe(true);
    const all = (await reconciliationItems()).filter((item) => item.sourceKey === "e");
    const kinds: Record<string, number> = {};
    for (const item of all) kinds[item.kind as string] = (kinds[item.kind as string] ?? 0) + 1;
    expect(kinds).toEqual({
      unverifiedLabel: 6,
      valueConflict: 4,
      aliasConfirmation: 3,
      annotationReview: 3,
      statusQuestion: 1,
      privacyReview: 1,
    });
  });

  it("writes documents that fit their schemas, passes its verification, and writes nothing on a second run", async () => {
    expect(await schemaProblems()).toEqual([]);
    const checks = await verify(market, file);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
    const before = await allDocuments();
    const second = await run(market, file, "apply");
    const changed = differences(before, await allDocuments());
    // The one write of a second run is its own batch record.
    expect(changed).toEqual({ created: [`importBatches/${second.batchId}`], removed: [], rewritten: [] });
    expect(second).toMatchObject({ status: "applied", documentsWritten: 0, changesCommitted: 0 });
    expect(second.sourceRecords).toMatchObject({ created: 0, superseded: 0, missing: 0 });
    expect(second.items.raise).toEqual({});
    expect(second.items.clear).toEqual({});
  });

  it("keeps the labels, the name of the reviewer and the notes away from every document that members can read", async () => {
    const records = JSON.stringify((await sourceRecords("review")).map((record) => record.raw));
    for (const value of PREDICTION_MARKET_RESTRICTED) expect(records, value).toContain(value);

    const readable = await memberReadable();
    const hypothesisRecords = new Set(
      (await sourceRecords("hypotheses"))
        .filter((record) => /__h\d\d$/.test(record.rowKey as string))
        .map((record) => record.id),
    );
    expect(hypothesisRecords.size).toBe(12);
    for (const [documentPath, data] of readable) {
      const text = `${documentPath} ${JSON.stringify(data)}`;
      for (const value of PREDICTION_MARKET_RESTRICTED)
        expect(text, `${value} in ${documentPath}`).not.toContain(value);
      expect(text, documentPath).not.toContain("sealedBy");
    }
    // A term of the outcome labels names the list it was read from, and never a row that carries the label.
    for (const label of ["no", "yes", "cancelled"]) {
      const term = readable.get(`vocabularyTerms/${vocabularyTermId("pmReplicated", label)}`);
      for (const id of (term?.sourceRecordIds ?? []) as string[]) expect(hypothesisRecords.has(id), label).toBe(false);
    }
    // Where the labels are: the sealed documents, the source records, the states of the change log that no client
    // reads, and the vocabulary of the list of the workbook. No item of the review queue shows one.
    const holders = [...(await allDocuments()).entries()]
      // The lookup data names a category of statuses by the same word, which is no label of a study.
      .filter(([documentPath]) => !documentPath.startsWith("statusDefinitions/"))
      .filter(([, document]) => JSON.stringify(document.data).includes('"cancelled"'))
      // The collections of a path, without the identifiers between them.
      .map(([documentPath]) =>
        documentPath
          .split("/")
          .filter((_segment, index) => index % 2 === 0)
          .join("/"),
      );
    expect([...new Set(holders)].sort()).toEqual([
      "importBatches/changes",
      "importBatches/changes/special",
      "predictionMarketOutcomes",
      "sourceRecords",
      "vocabularyTerms",
    ]);
  });

  it("prints and logs counts and identifiers only: no restricted value is in the report, the batch or its log", async () => {
    const batch = (await adminDb.doc(`importBatches/${report.batchId}`).get()).data();
    const log = await adminDb.collection(`importBatches/${report.batchId}/log`).get();
    const printed = JSON.stringify([report, batch, log.docs.map((doc) => doc.data())]);
    for (const value of PREDICTION_MARKET_RESTRICTED) expect(printed, value).not.toContain(value);
    for (const entry of HYPOTHESES) expect(printed, entry.text).not.toContain(entry.text.trim());
    expect(printed).not.toMatch(/cancelled|docs\.example\.org|osf\.example\.org/);
    for (const [key, value] of Object.entries(batch?.stats ?? {})) {
      expect(typeof value, key).toBe("number");
      expect(key, key).toMatch(/^[A-Za-z0-9:]+$/);
    }
  });
});

describe("the prediction-market hypotheses over several runs", () => {
  beforeEach(async () => {
    await freshDatabase();
    await applyWebsite();
    await applyStudies();
  });

  it("never creates a replication: the rows of a study that does not exist wait, and are imported once it does", async () => {
    await freshDatabase();
    await applyWebsite();
    const file = await workbookFile();
    const early = await run(market, file, "apply");
    expect(early.tabs.find((tab) => tab.tabKey === tabKey("hypotheses"))).toMatchObject({ imported: 9, queued: 3 });
    expect((await documentsOf("replications")).size).toBe(6);
    expect(await hypothesis("Kappa2006", "h01")).toBeUndefined();
    const waiting = await items("unmatchedIdentifier");
    // One item for each study in each of the two tabs that name it. The item of a study lists all its rows.
    expect(waiting.map((item) => `${claimSources(item)[0]}:${claimValues(item).join("+")}`).sort()).toEqual([
      "e/hypotheses:Kappa2006+Kappa2006",
      "e/hypotheses:Lambda2003",
      "e/review:Kappa2006",
      "e/review:Lambda2003",
    ]);

    await applyStudies();
    const later = await run(market, file, "apply");
    expect(later.tabs.find((tab) => tab.tabKey === tabKey("hypotheses"))).toMatchObject({ imported: 12, queued: 0 });
    expect(later.items.clear).toEqual({ unmatchedIdentifier: 4 });
    expect(await hypothesis("Kappa2006", "h01")).toBeDefined();
    expect((await documentsOf("replications")).size).toBe(8);
  });

  it("writes no link to the market's documents and no null-significance label where the output is withheld (question 7)", async () => {
    // A real project receives neither until the programme lead says whether they are prediction-market data.
    await run(market, await workbookFile(), "apply", { target: { production: false, rehearse: [] } });
    const iota = await hypothesis("Iota2004", "h01");
    expect(iota).toBeDefined();
    for (const field of ["nullSigSource", "studyDescriptionUrl", "infosheetUrl"])
      expect(iota).not.toHaveProperty(field);
    expect(await link("Iota2004", "pmInfosheet")).toBeUndefined();
    expect(await link("Iota2004", "pmStudyDescription")).toBeUndefined();
    // The survey and market questions are written, sealed: programme administrators alone read them.
    expect((await documentsOf("predictionMarketItems")).size).toBeGreaterThan(0);
  });

  it("follows the source where nobody has edited a field, keeps an edit of the portal, and never lowers a review status", async () => {
    await run(market, await workbookFile(), "apply");
    await adminDb.doc("replications/Delta1999/hypotheses/h01").update({ text: "A wording agreed in the portal" });
    await adminDb.doc("replications/Delta1999/hypotheses/h02").update({ scientificReviewStatus: "verified" });
    const hypotheses = HYPOTHESES.map((entry) =>
      entry.studyId === "Delta1999" ? { ...entry, text: `${entry.text}, as reworded in the workbook` } : entry,
    );
    const second = await run(market, await workbookFile({ hypotheses }), "apply");
    expect((await hypothesis("Delta1999", "h01"))?.text).toBe("A wording agreed in the portal");
    expect(await hypothesis("Delta1999", "h02")).toMatchObject({
      text: "Distractors do not influence the negativity, as reworded in the workbook",
      // What a reviewer decided is no field of the import.
      scientificReviewStatus: "verified",
    });
    expect(second.collections.replicationHypotheses).toMatchObject({ changed: 2 });
    expect(second.collections.replicationHypotheses?.fields).toEqual({ text: 2 });
    const [conflict] = await items("valueConflict", "text");
    expect(claimSources(conflict)).toEqual(["portal", "e"]);
    expect(conflict?.entityRefs).toEqual([{ entityType: "hypothesis", entityId: "Delta1999__h01" }]);
  });

  it("follows a label that changes or goes, and replaces the item of the old label", async () => {
    await run(market, await workbookFile(), "apply");
    const [before] = await items("unverifiedLabel", "labelsSource", "EtaTheta2005__h01");
    const hypotheses = HYPOTHESES.map((entry) =>
      entry.studyId === "EtaTheta2005"
        ? { ...entry, replicated: "no" }
        : entry.studyId === "AlphaBeta2001"
          ? { ...entry, replicated: null }
          : entry,
    );
    const second = await run(market, await workbookFile({ hypotheses }), "apply");
    expect((await sealed("EtaTheta2005"))?.labelsSource).toEqual({ h01: "no" });
    // The study whose labels have all gone keeps its sealed document, with an empty map.
    expect((await sealed("AlphaBeta2001"))?.labelsSource).toEqual({});
    const [after] = await items("unverifiedLabel", "labelsSource", "EtaTheta2005__h01");
    expect(after?.id).not.toBe(before?.id);
    expect((await adminDb.doc(`reconciliationItems/${before?.id}`).get()).get("status")).toBe("superseded");
    expect(second.items.supersede).toMatchObject({ unverifiedLabel: 1 });
    expect(second.items.clear).toMatchObject({ unverifiedLabel: 3, valueConflict: 1 });
    // The finished study now carries `no`, which contradicts nothing, and the unfinished one carries nothing.
    expect(await items("valueConflict", "publicStageName")).toEqual([]);
  });

  it("reports a hidden row without the label cancelled, and the label on a visible row", async () => {
    const hypotheses = HYPOTHESES.map((entry) =>
      entry.studyId === "Lambda2003"
        ? { ...entry, hidden: true }
        : entry.studyId === "Kappa2006" && entry.number === 2
          ? { ...entry, hidden: false }
          : entry,
    );
    await run(market, await workbookFile({ hypotheses }), "apply");
    const signals = await items("formattingSignal");
    expect(signals.map((item) => claimSources(item)[0]).sort()).toEqual([
      "e/hypotheses/hiddenWithoutLabel",
      "e/hypotheses/labelOnVisibleRow",
    ]);
    // The hidden row is still imported, and nothing about its study changes.
    expect(await hypothesis("Lambda2003", "h01")).toBeDefined();
    expect((await replication("Lambda2003"))?.statusKey).toBeNull();
    expect((await items("statusQuestion", "status")).map((item) => item.entityRefs[0].entityId).sort()).toEqual([
      "Kappa2006",
      "Lambda2003",
    ]);
  });

  it("reports a cell that shows one address and links to another, and a label that has no link behind it", async () => {
    await run(
      market,
      await workbookFile({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet === undefined) return;
          sheet.getCell("B4").value = {
            text: "https://osf.example.org/shown",
            hyperlink: "https://osf.example.org/ag002",
          };
          sheet.getCell("C10").value = "Itoa2004";
        },
      }),
      "apply",
    );
    const defects = await items("linkDefect");
    expect(defects.map((item) => `${item.field}:${claimSources(item).join("+")}`).sort()).toEqual([
      "infosheet_link:e/hypotheses/infosheet_link/noAddress",
      "studyDescr_pdf:e/hypotheses/studyDescr_pdf/target+e/hypotheses/studyDescr_pdf/text",
    ]);
    // The link is what a reader follows, so its target is the address. A label alone gives none.
    expect((await hypothesis("AlphaGamma2002", "h01"))?.studyDescriptionUrl).toBe("https://osf.example.org/ag002");
    expect(await hypothesis("Iota2004", "h01")).not.toHaveProperty("infosheetUrl");
    expect(await link("Iota2004", "pmInfosheet")).toBeUndefined();
    // The label still names the study, in its own scheme.
    expect(await alias("Iota2004", "sourceLabel", "Itoa2004")).toBeDefined();
  });

  it("reports a value outside its list, a new option of a list and a footer counter that disagrees", async () => {
    await run(
      market,
      await workbookFile({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet === undefined) return;
          sheet.getCell("F5").value = "maybe";
          sheet.getCell("F14").value = "9/38";
          for (let row = 2; row <= 13; row += 1) {
            sheet.getCell(row, 7).dataValidation = {
              type: "list",
              allowBlank: true,
              formulae: ['"no,yes,cancelled,postponed"'],
            };
          }
        },
      }),
      "apply",
    );
    const reviews = await items("vocabularyReview");
    expect(reviews.map((item) => `${item.field}:${claimSources(item)[0]}=${claimValues(item)[0]}`).sort()).toEqual([
      "null-sig:e/hypotheses=maybe",
      "replicated:e/hypotheses/list=postponed",
    ]);
    // The value is stored as it is written, whatever the list says.
    expect((await hypothesis("Delta1999", "h01"))?.nullSigSource).toBe("maybe");
    // A footer counter counts the sealed labels, so the item names its cell and shows neither count.
    const [footer] = await items("annotationReview", "footer");
    expect(claimValues(footer)).toEqual([undefined, undefined]);
    expect(claimSources(footer)).toEqual(["e/hypotheses/footer", "e/hypotheses/recount"]);
  });
});

describe("a prediction-market workbook that cannot be applied", () => {
  beforeEach(async () => {
    await freshDatabase();
    await applyWebsite();
    await applyStudies();
  });

  const blocked = async (options: PredictionMarketOptions) => {
    const report = await run(market, await workbookFile(options), "apply");
    expect(report.status).toBe("failed");
    // Nothing is imported: every row is stored, and counted as blocked or, where the item that explains
    // the failure names it, as waiting in the queue. No hypothesis is written.
    for (const tab of report.tabs) {
      expect(tab.imported, tab.tabKey).toBe(0);
      expect((tab.rawOnly.blocked ?? 0) + tab.queued, tab.tabKey).toBe(tab.rows.data);
    }
    expect((await documentsOf("hypotheses", true)).size).toBe(0);
    expect((await documentsOf("predictionMarketItems")).size).toBe(0);
    const explaining = await items("structureChange");
    expect(explaining.length).toBeGreaterThan(0);
    return report.blocking.map((check) => check.check);
  };
  const withRows = (change: (entry: (typeof HYPOTHESES)[number], index: number) => (typeof HYPOTHESES)[number]) => ({
    hypotheses: HYPOTHESES.map(change),
  });

  it("is blocked when a study has one hypothesis number twice, or numbers that leave a gap", async () => {
    expect(await blocked(withRows((entry, index) => (index === 1 ? { ...entry, number: 1 } : entry)))).toEqual([
      "unique",
    ]);
    await freshDatabase();
    await applyWebsite();
    await applyStudies();
    expect(await blocked(withRows((entry, index) => (index === 5 ? { ...entry, number: 4 } : entry)))).toEqual([
      "numbering",
    ]);
  });

  it("is blocked when a hypothesis number is no whole number", async () => {
    expect(
      await blocked({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet) sheet.getCell("D3").value = 1.5;
        },
      }),
    ).toEqual(["number"]);
  });

  it("is blocked when the rows of a study state different details, or a year that is not the year of the identifier", async () => {
    expect(
      await blocked({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet) sheet.getCell("J6").value = "Another title on one row of the study";
        },
      }),
    ).toEqual(["studyValues"]);
    const [explaining] = await items("structureChange");
    // The item names the rows by their keys, and quotes nothing from them.
    expect(claimValues(explaining)).toEqual([undefined, undefined, undefined]);
    expect(JSON.stringify(explaining)).not.toContain("Another title");
    await freshDatabase();
    await applyWebsite();
    await applyStudies();
    expect(
      await blocked({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("links_hypotheses");
          if (sheet) sheet.getCell("I4").value = 2003;
        },
      }),
    ).toEqual(["year"]);
  });

  it("is blocked when a tab is missing, and says so before anything is read from the others", async () => {
    expect(await blocked({ change: (workbook) => workbook.removeWorksheet("review") })).toEqual(["tabs"]);
  });
});
