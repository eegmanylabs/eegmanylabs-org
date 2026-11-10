// Integration tests of the importer of the list of studies (source D) against the Firestore
// emulator. The workbook and the website data it meets are synthetic: every study, person,
// note and address in them is invented.
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  COLLECTION_ENTRIES,
  candidateStudyId,
  documentLinkSlotId,
  entityRefId,
  integrationMappingId,
  keyedShortHash,
  lookupFold,
  reconciliationFingerprint,
  shortHash,
  sourceTabKey,
  vocabularyTermId,
} from "@eegml/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LIST_OF_STUDIES_RESTRICTED,
  type ListOfStudiesOptions,
  listOfStudiesWorkbook,
  STUDIES,
} from "../../tools/src/import/fixtures/list-of-studies";
import { writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import type { RunReport } from "../../tools/src/import/run";
import { importer as studies, TAB_TITLES } from "../../tools/src/import/sources/list-of-studies";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  itemCounts,
  reconciliationItems,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

async function workbookFile(options: ListOfStudiesOptions = {}): Promise<string> {
  const file = path.join(temporaryDirectory(), "list-of-studies.xlsx");
  writeFileSync(file, await listOfStudiesWorkbook(options));
  return file;
}

/** Applies the synthetic website data: six of the eight studies of the workbook, with their leads and links. */
const applyWebsite = () => run(website, writeWebsiteFixture(temporaryDirectory()), "apply");

const tabKey = (tab: keyof typeof TAB_TITLES) => sourceTabKey(TAB_TITLES[tab]);
const replication = async (studyId: string) => (await adminDb.doc(`replications/${studyId}`).get()).data();
const candidateOf = async (doi: string) =>
  (await adminDb.doc(`candidateStudies/${candidateStudyId({ doi })}`).get()).data();
const link = async (studyId: string, slot: string) =>
  (await adminDb.doc(`documentLinks/${documentLinkSlotId(entityRefId("replication", studyId), slot)}`).get()).data();

type Item = DocumentData & { readonly id: string };
/** The open items of source D of one kind, optionally of one field and about one record. */
async function items(kind: string, field?: string, entityId?: string): Promise<Item[]> {
  return (await reconciliationItems()).filter(
    (item) =>
      item.sourceKey === "d" &&
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

describe("the list of studies, applied after the website data", () => {
  let report: RunReport;
  let file: string;
  beforeAll(async () => {
    await freshDatabase();
    await applyWebsite();
    file = await workbookFile();
    report = await run(studies, file, "apply");
  });

  it("accounts for every row of every tab: imported, queued or kept raw for a stated reason", () => {
    expect(report.status).toBe("applied");
    expect(report.blocking).toEqual([]);
    const byTab = Object.fromEntries(report.tabs.map((tab) => [tab.tabKey, tab]));
    expect(byTab[tabKey("list")]).toMatchObject({
      rows: expect.objectContaining({ header: 2, data: 8, blank: 0 }),
      cellAnnotations: 2,
      imported: 8,
      queued: 0,
      rawOnly: {},
      unaccounted: 0,
    });
    expect(byTab[tabKey("shortlist")]).toMatchObject({
      rows: expect.objectContaining({ header: 2, data: 10 }),
      imported: 10,
      queued: 0,
      unaccounted: 0,
    });
    expect(byTab[tabKey("ranked")]).toMatchObject({
      rows: expect.objectContaining({ header: 2, data: 14 }),
      imported: 14,
      queued: 0,
      unaccounted: 0,
    });
    // The hidden planning list: two rows are cross-references, one waits with the question about a year, one is raw.
    expect(byTab[tabKey("questionnaires")]).toMatchObject({
      rows: expect.objectContaining({ banner: 1, header: 1, data: 4 }),
      imported: 2,
      queued: 1,
      rawOnly: { planningList: 1 },
      unaccounted: 0,
    });
    // The paper that neither a DOI nor a title places waits in the queue.
    expect(byTab[tabKey("subproject")]).toMatchObject({
      rows: expect.objectContaining({ header: 2, data: 3 }),
      imported: 2,
      queued: 1,
      unaccounted: 0,
    });
    expect(byTab[tabKey("scratch")]).toMatchObject({
      rows: expect.objectContaining({ header: 0, data: 3 }),
      imported: 0,
      queued: 0,
      rawOnly: { purposeUnknown: 3 },
      unaccounted: 0,
    });
    for (const tab of report.tabs) {
      const raw = Object.values(tab.rawOnly).reduce((sum, count) => sum + count, 0);
      expect(tab.imported + tab.queued + raw, tab.tabKey).toBe(tab.rows.data);
    }
  });

  it("stores every row of every tab as a source record, the hidden tabs and the header rows included", async () => {
    const records = (await adminDb.collection("sourceRecords").where("sourceKey", "==", "d").get()).docs.map((doc) =>
      doc.data(),
    );
    const perTab = (tab: keyof typeof TAB_TITLES) => records.filter((record) => record.tabKey === tabKey(tab)).length;
    expect(perTab("list")).toBe(2 + 8 + 2);
    expect(perTab("shortlist")).toBe(2 + 10);
    expect(perTab("ranked")).toBe(2 + 14);
    expect(perTab("questionnaires")).toBe(1 + 1 + 4);
    expect(perTab("subproject")).toBe(2 + 3);
    expect(perTab("scratch")).toBe(3);
    expect((await adminDb.doc(`sources/d/tabs/${tabKey("questionnaires")}`).get()).data()).toMatchObject({
      name: "questionnaires",
      visibility: "hidden",
      headerRow: 2,
      rowCount: 4,
      importerKey: "listOfStudies",
    });
    // The notes and the votes are in the source records, where no member reads them.
    const alpha = records.find((record) => record.rowKey === "alphabeta2001");
    expect(alpha?.raw).toMatchObject({
      R: { v: "Zed Remarker thinks the sample is too small", t: "string" },
      AP: { v: "Ann Voter", t: "string" },
    });
  });

  it("creates the two replications that the website does not hold, and labels them as historical", async () => {
    expect(report.collections.replications).toMatchObject({ created: 2, changed: 6 });
    const kappa = await replication("Kappa2006");
    expect(kappa).toMatchObject({
      studyKey: "Kappa2006",
      programmeId: "eegmanylabs",
      dataOrigin: "importedHistorical",
      selectionStatus: "selected",
      // No status follows from a stage text, and no lead from a name.
      statusKey: null,
      leadPersonIds: [],
      citationStatus: "unverified",
      originalDoi: "10.1000/invented.2006.07",
      originalN: 20,
      studyType: "1_Experimental",
    });
    expect(kappa).not.toHaveProperty("publicStageName");
    expect(kappa).not.toHaveProperty("signupUrl");
    // The identifier resolves from now on, for the sources that come after.
    expect((await adminDb.doc("studyAliasIndex/kappa2006").get()).data()?.replicationIds).toEqual(["Kappa2006"]);
    const lookup = integrationMappingId("doi", "replication", "10.1000/invented.2006.07");
    expect((await adminDb.doc(`integrationMappings/${lookup}`).get()).data()).toMatchObject({ entityId: "Kappa2006" });
  });

  it("adds the extraction fields to a study of the website and leaves the fields of the website alone", async () => {
    const alpha = await replication("AlphaBeta2001");
    expect(alpha).toMatchObject({
      // What the website wrote stays as it was.
      dataOrigin: "live",
      theme: "Personality",
      publicStageName: "stage2_prep",
      publicStageNumber: 7,
      psychConstruct: "conflict monitoring",
      originalDoi: "10.1000/invented.2001.01",
      // What only the workbook holds. A text is stored without the white space around it.
      abstract: "An invented abstract about conflict in a task that nobody ran.",
      effectOfInterest: "Larger invented negativity after errors than after correct responses",
      plainLanguageDescription: "People notice their own invented mistakes",
      originalStatistics: "F(2,58)=5.12, P<0.05",
      originalEffectSizeSource: "r = .42",
      originalEffectSizeValue: 0.412,
      originalEffectSizeMetric: "r",
      originalBayesFactorSource: "BF10 = 3.207",
      durationSource: "~40 mins",
      sampleType: "invented volunteers\nright-handed",
      studyType: "1_Experimental",
      outcome: "N1x,P9z",
    });
    // The stage and the sign-up link of the workbook are observations. Neither is written to the replication.
    expect(alpha).not.toHaveProperty("signupUrl");
    expect(alpha?.statusKey).toBeNull();
    const source = alpha?.fieldSources as Record<string, string>;
    expect(source.abstract).not.toBe(source.theme);
    expect(alpha?.sourceRecordIds).toHaveLength(3);
  });

  it("keeps free text in a numeric column verbatim, and offers a number only where the cell states exactly one", async () => {
    const alpha = await replication("AlphaBeta2001");
    expect(alpha).toMatchObject({ originalN: 19, originalNSource: "19", minEegChannels: 1, minEegChannelsSource: "1" });
    // A required N that comes with its assumptions: the text is kept, and no number is picked out of four.
    expect(alpha?.powerBasedNSource).toBe("N=84 (one-tailed, with dz=.31, alpha level 0.02, power 90)");
    expect(alpha?.powerAssumptions).toBe("N=84 (one-tailed, with dz=.31, alpha level 0.02, power 90)");
    expect(alpha).not.toHaveProperty("powerBasedN");

    const gamma = await replication("AlphaGamma2002");
    expect(gamma).toMatchObject({
      originalNSource: "N=17 (+3 excluded)",
      minEegChannelsSource: "2: P4-P3",
      powerBasedN: 44,
      powerBasedNSource: "44",
      originalEffectSizeValue: 0.41,
      originalBayesFactorSource: "3.2",
    });
    expect(gamma).not.toHaveProperty("originalN");
    expect(gamma).not.toHaveProperty("minEegChannels");

    // One number beside a word is read, and the cell still goes to a reviewer.
    expect(await replication("Delta1999")).toMatchObject({ minEegChannels: 1, minEegChannelsSource: "1 (Cz)" });
    expect(await replication("Iota2004")).toMatchObject({ powerBasedN: 64, powerBasedNSource: "64 participants" });
    const unparsed = await items("unparsedValue");
    const reasons = (studyId: string, field: string) =>
      claimSources(unparsed.find((item) => item.field === field && item.entityRefs[0].entityId === studyId));
    expect(reasons("AlphaGamma2002", "originalN")).toEqual(["d/list", "d/list/freeText"]);
    expect(reasons("Delta1999", "channels")).toEqual(["d/list", "d/list/freeText"]);
    expect(reasons("AlphaGamma2002", "statistics")).toEqual(["d/list", "d/list/severalExperiments"]);
    expect(reasons("Delta1999", "bayesFactor")).toEqual(["d/list", "d/list/freeText", "d/list/labelledBF01"]);
    // A numeric cell in a numeric column asks nothing.
    expect(reasons("AlphaBeta2001", "originalN")).toEqual([]);
    expect(reasons("AlphaGamma2002", "powerN")).toEqual([]);
  });

  it("keeps a blank apart from a cell that says none: white space stays absent, a token is kept as written", async () => {
    expect(await replication("Delta1999")).not.toHaveProperty("extraEquipment");
    expect(await replication("Iota2004")).not.toHaveProperty("extraEquipment");
    expect((await replication("AlphaBeta2001"))?.extraEquipment).toBe("none");
    expect((await replication("AlphaGamma2002"))?.extraEquipment).toBe("-");
    expect((await replication("EtaTheta2005"))?.durationSource).toBe("Unknown");
  });

  it("reads the hidden keyword columns: their terms are split on commas only and linked to the replication", async () => {
    const term = async (kind: string, label: string) =>
      (await adminDb.doc(`vocabularyTerms/${vocabularyTermId(kind, label)}`).get()).data();
    expect(await term("outcome", "P9z")).toMatchObject({ kind: "outcome", name: "P9z" });
    expect(await term("descriptor", "press/no-press task")).toMatchObject({ name: "press/no-press task" });
    expect(await term("descriptor", "press")).toBeUndefined();
    // Two spellings of the ranked list that fold alike are one term that lists each.
    expect((await term("psychConstruct", "pretend processing"))?.labelsSource).toEqual([
      "Pretend processing",
      "pretend processing",
    ]);
    // The options of the validated list are stage terms whether a row uses them or not.
    expect(await term("progressStage", "Data extracted (stage 1)")).toMatchObject({ kind: "progressStage" });
    expect((await term("progressStage", "IPA acquired. Data collection (stage 6)"))?.labelsSource).toEqual([
      "IPA acquired. Data collection (stage 6) ",
    ]);
    const alpha = await replication("AlphaBeta2001");
    expect(alpha?.vocabulary).toEqual(
      expect.arrayContaining([
        { termId: vocabularyTermId("outcome", "N1x"), relation: "outcome" },
        { termId: vocabularyTermId("psychConstruct", "conflict monitoring"), relation: "psychConstruct" },
        { termId: vocabularyTermId("descriptor", "invented views"), relation: "descriptor" },
      ]),
    );
  });

  it("finds the DOI in the text, in a formula and behind a link, and keeps its capitals and parentheses", async () => {
    // The citation of this study is a HYPERLINK formula with no link of its own.
    expect((await replication("Delta1999"))?.originalDoi).toBe("10.1000/invented.1999.03");
    expect((await replication("AlphaGamma2002"))?.originalDoi).toBe("10.1000/INVENTED(2002)02");
    expect(await candidateOf("10.1000/INVENTED(2002)02")).toMatchObject({
      originalDoi: "10.1000/INVENTED(2002)02",
      replicationId: "AlphaGamma2002",
    });
    // The lookup is keyed by the DOI in lower case, so both spellings meet in it.
    const lookup = integrationMappingId("doi", "candidateStudy", "10.1000/invented(2002)02");
    expect((await adminDb.doc(`integrationMappings/${lookup}`).get()).data()).toMatchObject({
      entityType: "candidateStudy",
      externalId: "10.1000/invented(2002)02",
    });
  });

  it("never overwrites what the website says: a reference that differs stays, and both values go to a reviewer", async () => {
    const eta = await replication("EtaTheta2005");
    expect(eta?.originalReference).toContain("1(1), 1–2.");
    const [conflict] = await items("valueConflict", "originalReference", "EtaTheta2005");
    expect(claimSources(conflict)).toEqual(["otherSource", "d"]);
    expect(claimValues(conflict)[0]).toContain("1–2");
    expect(claimValues(conflict)[1]).toContain("11–22");
    // A reference that differs by white space at its end only is the same reference.
    expect(await items("valueConflict", "originalReference", "EpsilonVanZeta2010")).toEqual([]);
    expect(report.conflicts).toBe(2);
  });

  it("compares the sign-up link with the links of the portal and replaces none", async () => {
    // The same address as the current link of the website: nothing changes.
    expect((await link("AlphaGamma2002", "signup"))?.url).toBe("https://forms.example.org/alphagamma");
    // The same address as the archived link of a study whose sign-up is closed: no current link appears.
    expect(await link("AlphaBeta2001", "signup")).toBeUndefined();
    expect((await link("AlphaBeta2001", "signupArchive"))?.sourceRecordIds).toHaveLength(2);
    // Another address than the website's: the link stays, and one item states both.
    expect((await link("EpsilonVanZeta2010", "signup"))?.url).toBe("https://forms.example.org/epsilon");
    const conflicts = (await items("valueConflict")).filter((item) =>
      (item.entityRefs as { entityId: string }[]).some((ref) => ref.entityId.endsWith("EpsilonVanZeta2010__signup")),
    );
    expect(conflicts.map((item) => item.field)).toEqual(["url"]);
    expect(claimValues(conflicts[0])).toEqual([
      "https://forms.example.org/epsilon",
      "https://docs.google.com/forms/d/another-invented-form/edit",
    ]);
    // A study that only the workbook holds gets its link, in the named place of a sign-up link.
    expect(await link("Kappa2006", "signup")).toMatchObject({
      url: "https://forms.example.org/kappa",
      kind: "url",
      entityType: "replication",
      entityId: "Kappa2006",
      scopeKeys: ["rep:Kappa2006", "members"],
    });
  });

  it("treats a lead as a claim: no person and no membership is made from a name, and a difference goes to a reviewer", async () => {
    // The website fixture made fifteen people and seven memberships. The workbook adds none.
    expect((await documentsOf("persons")).size).toBe(15);
    expect((await documentsOf("memberships", true)).size).toBe(7);
    expect(report.collections.persons).toBeUndefined();

    const conflicts = await items("conflictingLead", "lead");
    expect(conflicts.map((item) => item.entityRefs[0].entityId).sort()).toEqual(["EpsilonVanZeta2010", "Iota2004"]);
    const twoTabs = conflicts.find((item) => item.entityRefs[0].entityId === "EpsilonVanZeta2010");
    expect(claimSources(twoTabs)).toEqual(["d/list", "d/shortlist"]);
    const againstPortal = conflicts.find((item) => item.entityRefs[0].entityId === "Iota2004");
    expect(claimSources(againstPortal)).toEqual(["d/list", "portal/membership"]);
    expect(againstPortal?.entityRefs).toHaveLength(2);
    expect(againstPortal?.entityRefs[1].entityType).toBe("person");
    // The lead that the website confirmed is in question now: the membership stays, the same person stays, and
    // its confirmation is lowered until a reviewer has decided. The row of the workbook is named as the reason.
    const memberships = [...(await documentsOf("memberships", true)).entries()];
    const iota = memberships.find(([documentPath]) => documentPath.startsWith("replications/Iota2004/"));
    expect(iota?.[1]).toMatchObject({ role: "lead", isCurrent: true, reviewStatus: "needsReview" });
    expect(iota?.[1].personId).toBe(againstPortal?.entityRefs[1].entityId);
    const reason = await adminDb.doc(`sourceRecords/${iota?.[1].fieldSources.reviewStatus}`).get();
    expect(reason.data()).toMatchObject({ sourceKey: "d", tabKey: tabKey("list") });
    // The same holds where the two tabs of the workbook name different leads. Where nothing disagrees, a
    // confirmation stands.
    const confirmed = memberships
      .filter(([, membership]) => membership.reviewStatus === "confirmed")
      .map(([documentPath]) => documentPath.split("/")[1]);
    expect(confirmed).not.toContain("Iota2004");
    expect(confirmed).not.toContain("EpsilonVanZeta2010");
    expect(confirmed.length).toBeGreaterThan(0);
    expect(report.collections.replicationMemberships).toMatchObject({ created: 0, changed: 2 });

    // A name that folds like the archived one, or like one of the leads of the portal, is no disagreement.
    expect(await items("conflictingLead", "lead", "AlphaGamma2002")).toEqual([]);
    expect(await items("conflictingLead", "lead", "Delta1999")).toEqual([]);
    // Where the portal holds no lead at all, the name is offered to a reviewer and to nobody else.
    const offered = await items("candidateLink", "lead");
    expect(offered.map((item) => item.entityRefs[0].entityId).sort()).toEqual(["Kappa2006", "Lambda2003"]);
  });

  it("raises one item for each study whose archived extraction differs, lists the fields, and fills no gap", async () => {
    const conflicts = await items("valueConflict", "extraction");
    expect(conflicts).toHaveLength(8);
    const fields = (studyId: string) => [
      ...new Set(
        claimSources(conflicts.find((item) => item.entityRefs[0].entityId === studyId)).map((source) =>
          source?.split("/").at(-1),
        ),
      ),
    ];
    // The required N differs on every row, as two generations of one extraction do.
    for (const study of STUDIES) expect(fields(study.studyId), study.studyId).toContain("powerN");
    expect(fields("AlphaBeta2001")).toEqual(["abstract", "effectSize", "powerN"]);
    expect(fields("AlphaGamma2002")).toEqual(["citation", "abstract", "originalN", "powerN"]);
    // A cell that the archived tab leaves empty is a gap and no second value.
    expect(fields("Delta1999")).not.toContain("equipment");
    // The current tab keeps its own value.
    expect((await replication("AlphaBeta2001"))?.originalEffectSizeSource).toBe("r = .42");

    const [keywords] = await items("valueConflict", "keywords", "AlphaGamma2002");
    expect(claimSources(keywords)).toEqual([
      "d/list/outcome",
      "d/ranked/outcome",
      "d/list/construct",
      "d/ranked/construct",
      "d/list/descriptors",
      "d/ranked/descriptors",
    ]);
    expect(await items("valueConflict", "keywords")).toHaveLength(1);
  });

  it("reports a paper that the tabs date differently, and writes neither year", async () => {
    const [years] = await items("valueConflict", "originalYear");
    expect(years?.entityRefs).toEqual([{ entityType: "replication", entityId: "AlphaGamma2002" }]);
    expect(claimSources(years)).toEqual(["d/list", "d/shortlist", "d/ranked", "d/questionnaires"]);
    expect(claimValues(years)).toEqual(["2002", "2001", "2002", "2001"]);
    expect(await candidateOf("10.1000/INVENTED(2002)02")).not.toHaveProperty("originalYear");
    expect((await candidateOf("10.1000/invented.2001.01"))?.originalYear).toBe(2001);
    // The year of the replication is the website's, which this workbook does not write.
    expect((await replication("AlphaGamma2002"))?.originalYear).toBe(2002);
  });

  it("keeps every archived candidate with the selection status that the tabs give it", async () => {
    const candidates = await documentsOf("candidateStudies");
    expect(candidates.size).toBe(15);
    const statuses: Record<string, number> = {};
    for (const candidate of candidates.values()) {
      statuses[candidate.selectionStatus as string] = (statuses[candidate.selectionStatus as string] ?? 0) + 1;
      expect(candidate).toMatchObject({ programmeId: "eegmanylabs", dataOrigin: "importedHistorical" });
    }
    expect(statuses).toEqual({ selected: 8, shortlisted: 4, rankedCandidate: 3 });

    expect(await candidateOf("10.1000/invented.2001.01")).toMatchObject({
      selectionStatus: "selected",
      replicationId: "AlphaBeta2001",
      originalAuthors: "Invented, A; Authors, B",
      originalTitle: "AN INVENTED STUDY OF NOTHING IN PARTICULAR",
    });
    // On hold and excluded are remarks in a stage cell. The candidate stays shortlisted, and a reviewer is asked.
    const onHold = await candidateOf("10.1000/invented.1998.09");
    expect(onHold).toMatchObject({ selectionStatus: "shortlisted", replicationId: null });
    expect(onHold?.originalReference).toContain("An imaginary inquiry into sounds");
    // The citation stands in the shortlist and the title in the ranked list, and each field names its own row.
    const citedIn = await adminDb.doc(`sourceRecords/${onHold?.fieldSources.originalReference}`).get();
    const titledIn = await adminDb.doc(`sourceRecords/${onHold?.fieldSources.originalTitle}`).get();
    expect(citedIn.get("tabKey")).toBe(tabKey("shortlist"));
    expect(titledIn.get("tabKey")).toBe(tabKey("ranked"));
    expect(onHold?.sourceRecordIds).toEqual(expect.arrayContaining([citedIn.id, titledIn.id]));
    expect(await candidateOf("10.1000/invented.1997.10")).toMatchObject({ selectionStatus: "shortlisted" });
    // The candidates of the subproject: one by its DOI, one found by its title in the ranked list.
    expect(await candidateOf("10.1000/invented.2003.11")).toMatchObject({ selectionStatus: "shortlisted" });
    expect(await candidateOf("10.1000/invented.2004.12")).toMatchObject({ selectionStatus: "shortlisted" });
    expect((await candidateOf("10.1000/invented.2004.12"))?.sourceRecordIds).toHaveLength(2);
    // A paper that was ranked and went no further, and one without a DOI, keyed by author, year and title.
    expect(await candidateOf("10.1000/invented.2000.14")).toMatchObject({ selectionStatus: "rankedCandidate" });
    const untitled = candidateStudyId({
      firstAuthorSurname: "Specimen",
      year: 1992,
      title: "A hypothetical note that carries no identifier",
    });
    expect(candidates.get(untitled)).toMatchObject({ selectionStatus: "rankedCandidate", originalYear: 1992 });
    expect(candidates.get(untitled)).not.toHaveProperty("originalDoi");
    // A candidate holds bibliographic fields only: no vote, no voter and no extraction text.
    for (const candidate of candidates.values()) {
      expect(Object.keys(candidate).filter((field) => /vote|group|note|extract/i.test(field))).toEqual([]);
    }
  });

  it("links nothing when a title matches and the DOIs differ, and asks about every row without a DOI", async () => {
    const unmatched = await items("unmatchedIdentifier", "originalDoi");
    expect(unmatched).toHaveLength(4);
    const mistyped = unmatched.find((item) => claimSources(item).includes("d/ranked/doi"));
    expect(claimSources(mistyped)).toEqual(["d/ranked/doi", "d/list/doi", "d/shortlist/doi"]);
    expect(claimValues(mistyped)).toEqual([
      "10.1000/invented.2003.80",
      "10.1000/invented.2003.08",
      "10.1000/invented.2003.08",
    ]);
    expect(mistyped?.entityRefs).toEqual([{ entityType: "replication", entityId: "Lambda2003" }]);
    // The ranked row keeps a candidate of its own, which names no replication.
    expect(await candidateOf("10.1000/invented.2003.80")).toMatchObject({
      selectionStatus: "rankedCandidate",
      replicationId: null,
    });
    expect(await candidateOf("10.1000/invented.2003.08")).toMatchObject({
      selectionStatus: "selected",
      replicationId: "Lambda2003",
    });
    const shapes = unmatched.map((item) => claimSources(item).join("+")).sort();
    expect(shapes).toEqual([
      "d/ranked/doi+d/list/doi+d/shortlist/doi",
      "d/ranked/title",
      "d/subproject/citation",
      "d/subproject/citation+d/ranked/title",
    ]);
  });

  it("asks about a status and sets none: a study off the website, a stage outside the list, an appended line", async () => {
    const absent = await items("statusQuestion", "status");
    expect(absent.map((item) => item.entityRefs[0].entityId).sort()).toEqual(["Kappa2006", "Lambda2003"]);
    const lambda = absent.find((item) => item.entityRefs[0].entityId === "Lambda2003");
    expect(claimSources(lambda)).toEqual(["d/list/absentFromWebsite", "d/list/stage", "d/list/stageNumber"]);
    expect(claimValues(lambda)[1]).toBe("Looking for replicating labs (stage 3)");

    const stages = await items("statusQuestion", "progressStage");
    const shapes = stages.map((item) => claimSources(item).slice(1).join()).sort();
    expect(shapes).toEqual([
      "d/list/unlistedStage",
      "d/shortlist/appendedLine",
      "d/shortlist/appendedLine",
      "d/shortlist/unlistedStage",
      "d/shortlist/unlistedStage",
    ]);
    // A stage that ends in a space is the listed stage, and `Completed` carries no number and is listed too.
    expect(await items("statusQuestion", "progressStage", "AlphaBeta2001")).toEqual([]);
    expect(await items("statusQuestion", "progressStage", "EtaTheta2005")).toEqual([]);
    expect(await items("statusQuestion", "studyType")).toHaveLength(2);
    expect(await items("vocabularyReview", "studyType")).toHaveLength(3);
    for (const replicationDocument of (await documentsOf("replications")).values()) {
      expect(replicationDocument.statusKey).toBeNull();
      expect(replicationDocument.selectionStatus).toBe("selected");
    }
  });

  it("reports link defects, names left in group columns and a stale vote count, and corrects none", async () => {
    const defects = (await items("linkDefect")).map((item) => `${item.field}:${claimSources(item)[0]}`).sort();
    expect(defects).toEqual([
      "citation:d/list/textOnly",
      "powerN:d/list/strayParenthesis",
      "signup:d/list/editorAddress",
      "signup:d/list/editorAddress",
    ]);
    const leftovers = await items("annotationReview", "groupCells");
    expect(leftovers.map((item) => claimSources(item)[0]).sort()).toEqual([
      "d/list/groups",
      "d/shortlist/groups",
      "d/subproject/groups",
    ]);
    // The names stay in the source records: the item holds a keyed hash of them and nothing to read.
    for (const item of leftovers) expect(claimValues(item)).toEqual([undefined]);
    const [votes] = await items("annotationReview", "votesCount");
    expect(claimValues(votes)).toEqual(["3", "4"]);
    // The cached count stays as the file holds it, in the record of its row.
    const records = await adminDb.collection("sourceRecords").where("sourceKey", "==", "d").get();
    const stale = records.docs.find(
      (doc) =>
        doc.get("tabKey") === tabKey("ranked") && doc.get("rowKey") === `doi__${shortHash("10.1000/invented.2004.06")}`,
    );
    expect(stale?.get("raw")).toMatchObject({ J: { v: 3, t: "number" } });
  });

  it("cross-references the planning list where its text is the questionnaire cell of a study or a candidate", async () => {
    const records = (await adminDb.collection("sourceRecords").where("sourceKey", "==", "d").get()).docs
      .filter((doc) => doc.get("tabKey") === tabKey("questionnaires") && doc.get("rowNumber") >= 3)
      .sort((a, b) => a.get("rowNumber") - b.get("rowNumber"));
    expect((await replication("AlphaBeta2001"))?.sourceRecordIds).toContain(records[0]?.id);
    expect((await candidateOf("10.1000/invented.2003.11"))?.sourceRecordIds).toContain(records[1]?.id);
    // The suggestion of a named person is kept raw and creates nobody.
    expect(records[3]?.get("raw")).toMatchObject({ C: { v: "proposed by Nia Suggester" } });
  });

  it("gives every item the fingerprint of its kind, its subject and its candidate values", async () => {
    const stage = shortHash("Currently put on hold");
    const unlisted = reconciliationFingerprint({
      kind: "statusQuestion",
      subject: "Kappa2006#progressStage",
      candidateKeys: [`d/list/stage:${stage}`, `d/list/unlistedStage:${stage}`],
    });
    expect((await adminDb.doc(`reconciliationItems/${unlisted}`).get()).data()).toMatchObject({
      kind: "statusQuestion",
      field: "progressStage",
      status: "open",
      sourceKey: "d",
      batchId: report.batchId,
    });
    // A name is hashed with the secret key, so the fingerprint of a lead conflict cannot be guessed from the names.
    const keyed = (name: string) => keyedShortHash(lookupFold(name), TEST_HASH_KEY);
    const lead = reconciliationFingerprint(
      {
        kind: "conflictingLead",
        subject: "EpsilonVanZeta2010#lead",
        candidateKeys: [`d/list:${keyed("Eli Madeup")}`, `d/shortlist:${keyed("Ivy Earlier")}`],
      },
      TEST_HASH_KEY,
    );
    expect((await adminDb.doc(`reconciliationItems/${lead}`).get()).exists).toBe(true);
    const all = (await reconciliationItems()).filter((item) => item.sourceKey === "d");
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    for (const item of all) expect(item.id).toMatch(/^[0-9a-f]{20}$/);
    expect(await itemCounts()).toMatchObject({
      unparsedValue: 28,
      statusQuestion: 9,
      unmatchedIdentifier: 4,
      linkDefect: 5,
      privacyReview: 2,
      candidateLink: 2,
    });
  });

  it("writes documents that fit their schemas, passes its verification, and writes nothing on a second run", async () => {
    expect(await schemaProblems()).toEqual([]);
    const checks = await verify(studies, file);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
    const before = await allDocuments();
    const second = await run(studies, file, "apply");
    const changed = differences(before, await allDocuments());
    // The one write of a second run is its own batch record.
    expect(changed).toEqual({ created: [`importBatches/${second.batchId}`], removed: [], rewritten: [] });
    expect(second).toMatchObject({ status: "applied", documentsWritten: 0, changesCommitted: 0 });
    expect(second.sourceRecords).toMatchObject({ created: 0, superseded: 0, missing: 0 });
    expect(second.items.raise).toEqual({});
    expect(second.items.clear).toEqual({});
  });
});

describe("what the list of studies keeps restricted", () => {
  let report: RunReport;
  beforeAll(async () => {
    await freshDatabase();
    // Without the website data every replication is made by the workbook, so every document here is its own.
    report = await run(studies, await workbookFile(), "apply");
  });

  it("holds the restricted values in its source records", async () => {
    const records = await adminDb.collection("sourceRecords").where("sourceKey", "==", "d").get();
    const raw = JSON.stringify(records.docs.map((doc) => doc.get("raw")));
    for (const value of LIST_OF_STUDIES_RESTRICTED) expect(raw, value).toContain(value);
  });

  it("writes no name, note or remark about a person to a document that members can read", async () => {
    const readable = await memberReadable();
    expect(readable.size).toBeGreaterThan(100);
    for (const [documentPath, data] of readable) {
      const text = `${documentPath} ${JSON.stringify(data)}`;
      for (const value of LIST_OF_STUDIES_RESTRICTED) expect(text, `${value} in ${documentPath}`).not.toContain(value);
      expect(text, documentPath).not.toMatch(/@example\.org/);
    }
    // The cells that were held back, by name: a dated remark, and an address inside a value.
    const gamma = await replication("AlphaGamma2002");
    expect(gamma).not.toHaveProperty("originalEffectSizeSource");
    expect(gamma?.originalNSource).toBe("N=17 (+3 excluded)");
    expect(await replication("Iota2004")).not.toHaveProperty("plainLanguageDescription");
    // The notes column is written nowhere: not to the replication and not to its restricted document.
    expect((await documentsOf("private", true)).size).toBe(0);
    const held = await items("privacyReview");
    expect(held.map((item) => `${item.entityRefs[0].entityId}:${item.field}`).sort()).toEqual([
      "AlphaGamma2002:effectSize",
      "Iota2004:plain",
    ]);
    for (const item of held) expect(claimValues(item)).toEqual([undefined]);
  });

  it("prints and logs counts and identifiers only: no restricted value is in the report, the batch or its log", async () => {
    const batch = (await adminDb.doc(`importBatches/${report.batchId}`).get()).data();
    const log = await adminDb.collection(`importBatches/${report.batchId}/log`).get();
    const printed = JSON.stringify([report, batch, log.docs.map((doc) => doc.data())]);
    for (const value of LIST_OF_STUDIES_RESTRICTED) expect(printed, value).not.toContain(value);
    for (const study of STUDIES) expect(printed, study.studyId).not.toContain(study.abstract);
    expect(Object.keys(batch?.stats ?? {}).length).toBeGreaterThan(20);
    for (const [key, value] of Object.entries(batch?.stats ?? {})) {
      expect(typeof value, key).toBe("number");
      expect(key, key).toMatch(/^[A-Za-z0-9:]+$/);
    }
  });

  it("creates all eight replications when it runs first, and asks about each because none is on the website", async () => {
    expect(report.collections.replications).toMatchObject({ created: 8 });
    expect(await items("statusQuestion", "status")).toHaveLength(8);
    expect(await items("conflictingLead", "lead")).toHaveLength(1);
    expect(await items("candidateLink", "lead")).toHaveLength(7);
    expect((await documentsOf("persons")).size).toBe(0);
  });
});

describe("the list of studies over several runs", () => {
  beforeEach(async () => {
    await freshDatabase();
    await applyWebsite();
  });

  it("lowers a confirmed lead while its question is open, and never against a reviewer or a second time", async () => {
    const file = await workbookFile();
    const path = async () =>
      [...(await documentsOf("memberships", true)).keys()].find((documentPath) =>
        documentPath.startsWith("replications/Iota2004/"),
      ) ?? "";
    const membership = adminDb.doc(await path());
    expect((await membership.get()).get("reviewStatus")).toBe("confirmed");

    // A preview lowers nothing. The apply lowers the one membership and logs the change.
    const preview = await run(studies, file, "preview");
    expect((await membership.get()).get("reviewStatus")).toBe("confirmed");
    expect(preview.collections.replicationMemberships).toMatchObject({ changed: 2, fields: { reviewStatus: 2 } });
    const applied = await run(studies, file, "apply", { previewBatchId: preview.batchId });
    expect(applied.collections.replicationMemberships).toMatchObject({ created: 0, changed: 2 });
    expect((await membership.get()).get("reviewStatus")).toBe("needsReview");

    // Neither the website nor the workbook writes anything when it is run again, in either order.
    expect((await applyWebsite()).documentsWritten).toBe(0);
    expect((await run(studies, file, "apply")).documentsWritten).toBe(0);
    expect((await membership.get()).get("reviewStatus")).toBe("needsReview");

    // A reviewer confirms the lead. The question is still open in the queue, and the confirmation stands.
    await membership.update({ reviewStatus: "confirmed" });
    expect((await run(studies, file, "apply")).documentsWritten).toBe(0);
    expect((await applyWebsite()).documentsWritten).toBe(0);
    expect((await membership.get()).get("reviewStatus")).toBe("confirmed");
  });

  it("leaves a confirmed lead alone once a reviewer has decided the question about it", async () => {
    const file = await workbookFile();
    const preview = await run(studies, file, "preview");
    expect(preview.items.raise.conflictingLead).toBe(2);
    // The reviewer dismisses the question before the batch is applied: the item exists and is decided.
    const first = await run(studies, file, "apply");
    const [question] = (await items("conflictingLead", "lead", "Iota2004")).map((item) => item.id);
    const membershipPath =
      [...(await documentsOf("memberships", true)).keys()].find((documentPath) =>
        documentPath.startsWith("replications/Iota2004/"),
      ) ?? "";
    expect(first.collections.replicationMemberships).toMatchObject({ changed: 2 });
    await adminDb.doc(`reconciliationItems/${question}`).update({ status: "dismissed" });
    // The lead is confirmed again, by an import this time, as a rollback and a new apply of the website would leave it.
    await adminDb.doc(membershipPath).update({
      reviewStatus: "confirmed",
      "importedValues.reviewStatus": "confirmed",
    });
    const again = await run(studies, file, "apply");
    expect(again.collections.replicationMemberships).toBeUndefined();
    expect((await adminDb.doc(membershipPath).get()).get("reviewStatus")).toBe("confirmed");
  });

  it("previews without writing an entity, and the apply then writes what the preview counted", async () => {
    const file = await workbookFile();
    const preview = await run(studies, file, "preview");
    expect(preview).toMatchObject({ status: "previewed", changesCommitted: 0 });
    expect((await documentsOf("candidateStudies")).size).toBe(0);
    expect(await replication("Kappa2006")).toBeUndefined();
    const applied = await run(studies, file, "apply", { previewBatchId: preview.batchId });
    expect(applied.collections).toEqual(preview.collections);
    expect(applied.items.raise).toEqual(preview.items.raise);
    expect((await documentsOf("candidateStudies")).size).toBe(15);
  });

  it("follows the source where nobody has edited a field, and keeps an edit made in the portal", async () => {
    await run(studies, await workbookFile(), "apply");
    // A member corrects the abstract in the portal, and the workbook changes two cells afterwards.
    await adminDb.doc("replications/Kappa2006").update({ abstract: "An abstract corrected in the portal." });
    const changed = await run(
      studies,
      await workbookFile({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("list of studies");
          if (sheet === undefined) return;
          sheet.getCell("D9").value = "An abstract rewritten in the workbook.";
          sheet.getCell("G9").value = 24;
        },
      }),
      "apply",
    );
    const kappa = await replication("Kappa2006");
    // The field that nobody touched follows the source. The edited one keeps what the member wrote.
    expect(kappa).toMatchObject({
      originalN: 24,
      originalNSource: "24",
      abstract: "An abstract corrected in the portal.",
    });
    expect(kappa?.importedValues).toMatchObject({ abstract: "An abstract rewritten in the workbook." });
    expect(changed.sourceRecords).toMatchObject({ created: 1, superseded: 1 });
    expect(changed.collections.replications).toMatchObject({ changed: 1 });
    expect(changed.collections.replications?.fields).toEqual({ originalN: 1, originalNSource: 1 });
    const [conflict] = await items("valueConflict", "abstract", "Kappa2006");
    expect(claimSources(conflict)).toEqual(["portal", "d"]);
    expect(claimValues(conflict)).toEqual([
      "An abstract corrected in the portal.",
      "An abstract rewritten in the workbook.",
    ]);
  });

  it("replaces an item by a new one when its value changes in the source, and clears one whose cause has gone", async () => {
    await run(studies, await workbookFile(), "apply");
    const [before] = await items("statusQuestion", "progressStage", "Kappa2006");
    const second = await run(
      studies,
      await workbookFile({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("list of studies");
          if (sheet === undefined) return;
          // Another wording outside the list for one study, and a repaired target for another.
          sheet.getCell("W9").value = "Paused for now";
          sheet.getCell("P6").value = {
            text: "see the invented power document for 2 analyses",
            hyperlink: "https://docs.example.org/document/d/invented-power-doc",
          };
        },
      }),
      "apply",
    );
    expect(second.items.supersede).toMatchObject({ statusQuestion: 2 });
    expect(second.items.clear).toEqual({ linkDefect: 1 });
    const [after] = await items("statusQuestion", "progressStage", "Kappa2006");
    expect(after?.id).not.toBe(before?.id);
    expect(claimValues(after)[0]).toBe("Paused for now");
    expect((await adminDb.doc(`reconciliationItems/${before?.id}`).get()).get("status")).toBe("superseded");
    expect(await items("linkDefect", "powerN")).toEqual([]);
  });

  it("leaves alone what a reviewer decided about a candidate", async () => {
    const file = await workbookFile();
    await run(studies, file, "apply");
    const id = candidateStudyId({ doi: "10.1000/invented.1997.10" });
    await adminDb.doc(`candidateStudies/${id}`).update({ selectionStatus: "withdrawn" });
    const second = await run(studies, file, "apply");
    expect((await adminDb.doc(`candidateStudies/${id}`).get()).get("selectionStatus")).toBe("withdrawn");
    // The decision raises no conflict and no write.
    expect(second).toMatchObject({ documentsWritten: 0, conflicts: 2 });
  });

  it("holds a row whose identifier is malformed, and creates nothing from it", async () => {
    const report = await run(
      studies,
      await workbookFile({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("list of studies");
          if (sheet) sheet.getCell("A10").value = "lambda 2003!";
        },
      }),
      "apply",
    );
    expect(report.tabs.find((tab) => tab.tabKey === tabKey("list"))).toMatchObject({ imported: 7, queued: 1 });
    expect(await replication("Lambda2003")).toBeUndefined();
    expect((await documentsOf("replications")).size).toBe(7);
    const [held] = (await items("unmatchedIdentifier")).filter((item) => item.field === undefined);
    expect(claimValues(held)).toEqual(["lambda 2003!"]);
  });
});

describe("a list of studies that cannot be imported", () => {
  beforeEach(freshDatabase);

  it("is blocked as a whole when a header is missing: rows are stored, nothing is interpreted, a reviewer is told", async () => {
    await applyWebsite();
    const report = await run(
      studies,
      await workbookFile({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("shortlist_archived");
          if (sheet) sheet.getCell("W1").value = "Lead";
        },
      }),
      "apply",
    );
    expect(report.status).toBe("failed");
    expect(report.blocking.map((check) => check.check)).toEqual(["header"]);
    for (const tab of report.tabs) {
      expect(tab.imported + tab.queued, tab.tabKey).toBe(0);
      expect(tab.rawOnly.blocked ?? 0, tab.tabKey).toBe(tab.rows.data);
    }
    expect((await documentsOf("candidateStudies")).size).toBe(0);
    expect((await documentsOf("replications")).size).toBe(6);
    expect((await adminDb.collection("sourceRecords").where("sourceKey", "==", "d").get()).size).toBeGreaterThan(40);
    const [blocking] = await items("structureChange");
    expect(claimValues(blocking)?.[1]).toBe("missing: Lead Replicating Lab; twice: none");
  });

  it("reports a header that it does not know without stopping, and maps nothing by guesswork", async () => {
    await applyWebsite();
    const report = await run(
      studies,
      await workbookFile({
        change: (workbook) => {
          const sheet = workbook.getWorksheet("allranked_archived");
          if (sheet === undefined) return;
          sheet.getCell("AI2").value = "Comments";
          sheet.getCell("AJ3").value = "an invented remark under no header";
          // A row below the table that names no paper: it is kept, and a reviewer places it.
          sheet.getCell("E18").value = "an invented remark below the table";
        },
      }),
      "apply",
    );
    expect(report.status).toBe("applied");
    const reported = await items("structureChange");
    // One item names the new header. The other names the column without one, and quotes nothing from it.
    expect(reported.map((item) => claimValues(item)[0] ?? "no value")).toHaveLength(2);
    expect(reported.map((item) => claimValues(item)[0] ?? "no value").sort()).toEqual(["Comments", "no value"]);
    expect(JSON.stringify(reported)).not.toContain("invented remark");
    expect((await documentsOf("candidateStudies")).size).toBe(15);
    const ranked = report.tabs.find((tab) => tab.tabKey === tabKey("ranked"));
    expect(ranked).toMatchObject({
      rows: expect.objectContaining({ data: 14, annotation: 1, blank: 1 }),
      imported: 14,
    });
    const [placed] = (await items("annotationReview")).filter((item) => item.field === undefined);
    expect(claimSources(placed)).toEqual(["d/ranked"]);
    expect(claimValues(placed)).toEqual([undefined]);
  });

  it("stops when the lookup data is missing, because a replication would refer to no programme", async () => {
    await adminDb.doc("programmes/eegmanylabs").delete();
    const report = await run(studies, await workbookFile(), "apply");
    expect(report.status).toBe("failed");
    expect(report.blocking.map((check) => check.check)).toEqual(["lookups"]);
    expect((await documentsOf("replications")).size).toBe(0);
  });
});

describe("the identifier column of the list of studies", () => {
  /** Applies the website data and the list of studies with one study written in another spelling. */
  async function applyWith(spelling: string | null): Promise<{ report: RunReport; counts: Record<string, number> }> {
    await freshDatabase();
    await applyWebsite();
    const variant =
      spelling === null
        ? STUDIES
        : STUDIES.map((study) => (study.studyId === "Delta1999" ? { ...study, studyId: spelling } : study));
    const report = await run(studies, await workbookFile({ studies: variant }), "apply");
    return { report, counts: await itemCounts() };
  }

  it("resolves an identifier with a lower-case initial or a diacritic to the study it folds to, and holds nothing", async () => {
    const plain = await applyWith(null);
    const replications = [...(await documentsOf("replications")).keys()].sort();
    const listTab = (report: RunReport) => report.tabs.find((tab) => tab.tabKey === tabKey("list"));
    for (const spelling of ["delta1999", "Déltá1999"]) {
      const { report, counts } = await applyWith(spelling);
      // The row is imported as the study it folds to: nothing waits, nothing is missing and no study is created.
      expect(listTab(report), spelling).toMatchObject({ imported: listTab(plain.report)?.imported, queued: 0 });
      expect(counts.unmatchedIdentifier ?? 0, spelling).toBe(plain.counts.unmatchedIdentifier ?? 0);
      expect(counts.missingFromSource ?? 0, spelling).toBe(0);
      expect([...(await documentsOf("replications")).keys()].sort(), spelling).toEqual(replications);
      // The study carries the record of its row of this workbook.
      const records = await documentsOf("sourceRecords");
      const named = ((await replication("Delta1999"))?.sourceRecordIds ?? []) as string[];
      expect(
        named.some((id) => records.get(id)?.sourceKey === "d"),
        spelling,
      ).toBe(true);
    }
  });
});
