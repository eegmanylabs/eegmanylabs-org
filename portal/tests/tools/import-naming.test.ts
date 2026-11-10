// Integration tests of the importer of the naming conventions (source B) against the Firestore
// emulator. The workbook and the website data it is matched against are synthetic: every study
// identifier, name and address in them is invented.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { studyAliasId } from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { websiteFixture, writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import {
  NAMING_FOOTNOTE,
  NAMING_ROWS,
  type NamingRow,
  type NamingWorkbookOptions,
  namingWorkbook,
} from "../../tools/src/import/fixtures/workbooks";
import { importer as naming } from "../../tools/src/import/sources/naming-conventions";
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
  temporaryDirectory,
  verify,
} from "./import-support";

async function workbookFile(options: NamingWorkbookOptions = {}): Promise<string> {
  const file = path.join(temporaryDirectory(), "naming-conventions.xlsx");
  writeFileSync(file, await namingWorkbook(options));
  return file;
}

/** Applies the synthetic website data, which creates the six replications that the workbook is matched against. */
async function applyWebsite(extraStudies: readonly string[] = []): Promise<void> {
  const fixture = websiteFixture();
  const [template] = fixture.replications;
  for (const [index, studyId] of extraStudies.entries()) {
    fixture.replications.push({
      ...template,
      StudyId: studyId,
      PublicationId: "",
      Doi: `10.1000/invented.extra.${index}`,
    });
  }
  await run(website, writeWebsiteFixture(temporaryDirectory(), fixture), "apply");
}

const rowsWith = (name: string, change: Partial<NamingRow>): NamingRow[] =>
  NAMING_ROWS.map((row) => (row.name === name ? { ...row, ...change } : row));

const alias = async (studyId: string, scheme: Parameters<typeof studyAliasId>[0], value: string) =>
  (await adminDb.doc(`replications/${studyId}/aliases/${studyAliasId(scheme, value)}`).get()).data();

/** The aliases that source B wrote: those of its four schemes. The website wrote the others. */
async function namingAliases() {
  const aliases = [...(await documentsOf("aliases", true)).values()];
  return aliases.filter((entry) => ["programme", "cloudAccount", "bids", "eegnet"].includes(entry.scheme as string));
}

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

describe("the naming conventions importer", () => {
  it("captures every row with the formula text and the kind of each cell, and the footnote as an annotation", async () => {
    const report = await run(naming, await workbookFile(), "preview");
    expect(report.tabs).toEqual([
      expect.objectContaining({
        tabKey: "t0",
        cellAnnotations: 1,
        rows: expect.objectContaining({ header: 1, data: 8, annotation: 0, blank: 0 }),
      }),
    ]);
    const records = (await adminDb.collection("sourceRecords").where("sourceKey", "==", "b").get()).docs.map((doc) =>
      doc.data(),
    );
    expect(records).toHaveLength(1 + 8 + 1);
    const beta = records.find((record) => record.rowKey === "alphabeta2001");
    // The row key is the folded name, and the row number is provenance only.
    expect(beta).toMatchObject({ tabKey: "t0", rowNumber: 2 });
    expect(beta?.raw).toEqual({
      A: { v: "AlphaBeta2001", t: "string" },
      B: { v: "AlBe2001", t: "string" },
      C: { v: "Al + Be + A", t: "string" },
      // A cell that depends on a shared formula is stored with its own formula text and its cached value.
      E: { v: "Alp", t: "formulaString", f: "LEFT(A2, 3)" },
      // A typed literal, in a column that otherwise holds formulas, with the footnote marker left in the value.
      F: { v: "A", t: "string" },
      G: { v: "Alph*", t: "string" },
      H: { v: "ALP*", t: "string" },
    });
    expect(records.find((record) => record.rowKey === "etatheta2005")?.raw).toMatchObject({
      E: { v: "E", f: "LEFT(A6, 1)" },
      F: { v: "The", f: "MID(A6,4,3)" },
      G: { v: "EThe", f: "CONCATENATE(E6,F6)" },
    });
    const footnote = records.find((record) => Object.keys(record.raw as object).join() === "J");
    expect(footnote?.raw).toEqual({ J: { v: NAMING_FOOTNOTE, t: "string" } });
    expect(footnote?.rowKey).toMatch(/^row__[0-9a-f]{12}__1$/);
    expect((await adminDb.doc("sources/b/tabs/t0").get()).data()).toMatchObject({
      name: "Sheet1",
      visibility: "visible",
      headerRow: 1,
      rowCount: 8,
      importerKey: "namingConventions",
    });
  });

  it("creates no replication and no alias while the studies do not exist, and holds every row in the queue", async () => {
    const report = await run(naming, await workbookFile(), "apply");
    expect(report.tabs[0]).toMatchObject({ imported: 0, queued: 8, unaccounted: 0 });
    expect((await documentsOf("replications")).size).toBe(0);
    expect((await documentsOf("aliases", true)).size).toBe(0);
    expect((await itemCounts()).unmatchedIdentifier).toBe(8);
  });

  it("writes four aliases beneath each study that exists, from the stored values and never from a naming rule", async () => {
    await applyWebsite();
    const report = await run(naming, await workbookFile(), "apply");
    expect(report.tabs[0]).toMatchObject({ imported: 6, queued: 2, unaccounted: 0 });
    expect(await namingAliases()).toHaveLength(6 * 4);
    expect((await documentsOf("replications")).size).toBe(6);

    expect(await alias("Delta1999", "programme", "Delta1999")).toMatchObject({
      scheme: "programme",
      alias: "Delta1999",
      isCanonical: true,
    });
    expect(await alias("Delta1999", "cloudAccount", "Delt1999")).toMatchObject({
      replicationId: "Delta1999",
      alias: "Delt1999",
      aliasFolded: "delt1999",
      isCanonical: false,
      // The explanation is kept verbatim, and its third part is not interpreted.
      explanation: "De + lt + A",
    });
    expect(await alias("Delta1999", "bids", "Delt")).toMatchObject({ alias: "Delt", part1: "Del", part2: "t" });
    expect(await alias("Delta1999", "eegnet", "DEL")).toMatchObject({ alias: "DEL", aliasFolded: "del" });
    // Stored values that no rule would give: a cloud name of three name parts, and a split of one letter and three.
    expect(await alias("EpsilonVanZeta2010", "cloudAccount", "EpVZ2010")).toMatchObject({ explanation: "Ep + VZ + a" });
    expect(await alias("EtaTheta2005", "bids", "EThe")).toMatchObject({ part1: "E", part2: "The" });
    expect(await alias("EtaTheta2005", "eegnet", "ETH")).toBeDefined();
    // Case is preserved exactly.
    expect((await namingAliases()).map((entry) => entry.alias)).toEqual(
      expect.arrayContaining(["AlBe2001", "EpVZ2010", "IOT", "Iota"]),
    );
    expect(await schemaProblems()).toEqual([]);
  });

  it("stores an alias that two studies share beneath each of them, without its marker and with the footnote", async () => {
    await applyWebsite();
    await run(naming, await workbookFile(), "apply");
    for (const studyId of ["AlphaBeta2001", "AlphaGamma2002"]) {
      expect(await alias(studyId, "bids", "Alph")).toMatchObject({
        replicationId: studyId,
        alias: "Alph",
        explanation: NAMING_FOOTNOTE,
      });
      expect(await alias(studyId, "eegnet", "ALP")).toMatchObject({ alias: "ALP", explanation: NAMING_FOOTNOTE });
    }
    // The components differ between the two studies, although the name is one.
    expect([
      (await alias("AlphaBeta2001", "bids", "Alph"))?.part2,
      (await alias("AlphaGamma2002", "bids", "Alph"))?.part2,
    ]).toEqual(["A", "B"]);
    // The folded lookup lists both studies, so the spelling resolves to neither by itself.
    expect((await adminDb.doc("studyAliasIndex/alph").get()).get("replicationIds").sort()).toEqual([
      "AlphaBeta2001",
      "AlphaGamma2002",
    ]);
    expect((await adminDb.doc("studyAliasIndex/delt1999").get()).get("replicationIds")).toEqual(["Delta1999"]);
    // One string is the programme identifier and the cloud name of one study: two aliases, one lookup entry.
    expect(await alias("Iota2004", "programme", "Iota2004")).toBeDefined();
    expect(await alias("Iota2004", "cloudAccount", "Iota2004")).toBeDefined();
    expect((await adminDb.doc("studyAliasIndex/iota2004").get()).get("replicationIds")).toEqual(["Iota2004"]);
  });

  it("queues what a person has to confirm, and reports what departs from the naming rules without correcting it", async () => {
    await applyWebsite();
    await run(naming, await workbookFile(), "apply");
    const items = (await reconciliationItems()).filter((item) => item.sourceKey === "b");
    const count = (kind: string) => items.filter((item) => item.kind === kind).length;
    expect([count("unmatchedIdentifier"), count("aliasConfirmation"), count("annotationReview")]).toEqual([2, 3, 8]);

    const confirmations = items
      .filter((item) => item.kind === "aliasConfirmation")
      .map((item) => [
        item.candidates[0].valueSource,
        item.entityRefs.map((ref: { entityId: string }) => ref.entityId).sort(),
      ]);
    expect(confirmations.sort()).toEqual([
      ["ALP", ["AlphaBeta2001", "AlphaGamma2002"]],
      ["Alph", ["AlphaBeta2001", "AlphaGamma2002"]],
      ["Iota2004", ["Iota2004"]],
    ]);
    const unmatched = items
      .filter((item) => item.kind === "unmatchedIdentifier")
      .map((item) => item.candidates[0].valueSource);
    expect(unmatched.sort()).toEqual(["Kappa2006", "Lambda2003"]);

    const lint = items
      .filter((item) => item.kind === "annotationReview")
      .map(
        (item) =>
          `${item.entityRefs[0]?.entityId} ${item.field} ${item.candidates[0].key.split("/")[2]}: ${item.candidates.map((candidate: { valueSource: string }) => candidate.valueSource).join(" -> ")}`,
      );
    expect(lint.sort()).toEqual([
      // A typed literal where the column otherwise holds a formula, or a name that does not follow the rule.
      "AlphaBeta2001 bids kind: literal -> formula",
      "AlphaBeta2001 eegnet rule: ALP* -> ALH",
      "AlphaGamma2002 bids kind: literal -> formula",
      "AlphaGamma2002 eegnet rule: ALP* -> ALH",
      // A cloud name that the token rule cannot produce, and a third token that is no capital letter.
      "EpsilonVanZeta2010 cloud tokenRule: EpVZ2010 -> no name: the rule covers one or two name parts",
      "EpsilonVanZeta2010 explanation thirdToken: a -> one capital letter",
      // Component formulas that depart from the pattern of their columns.
      "EtaTheta2005 part1 pattern: LEFT(A{r}, 1) -> LEFT(A{r}, 3)",
      "EtaTheta2005 part2 pattern: MID(A{r},4,3) -> MID(A{r},4,1)",
    ]);
    // Nothing was corrected: the stored names stand.
    expect(await alias("AlphaBeta2001", "eegnet", "ALH")).toBeUndefined();
    expect(await alias("EpsilonVanZeta2010", "cloudAccount", "EpVZ2010")).toBeDefined();
  });

  it("completes its aliases on a second run, once the remaining studies exist, and then writes nothing more", async () => {
    await applyWebsite();
    const file = await workbookFile();
    await run(naming, file, "apply");
    await applyWebsite(["Kappa2006", "Lambda2003"]);
    const second = await run(naming, file, "apply");
    expect(second.collections.replicationAliases).toMatchObject({ created: 8, changed: 0, unchanged: 24 });
    expect(second.items.clear).toEqual({ unmatchedIdentifier: 2 });
    expect(second.tabs[0]).toMatchObject({ imported: 8, queued: 0 });
    expect(await namingAliases()).toHaveLength(8 * 4);

    const before = await allDocuments();
    const third = await run(naming, file, "apply");
    expect(third).toMatchObject({ documentsWritten: 0, changesCommitted: 0 });
    expect(differences(before, await allDocuments())).toMatchObject({ removed: [], rewritten: [] });
    expect((await verify(naming, file)).filter((check) => !check.passed)).toEqual([]);
  });

  it("gives the same aliases whether the website data or the workbook is imported first", async () => {
    await applyWebsite();
    await run(naming, await workbookFile(), "apply");
    const websiteFirst = [...(await documentsOf("aliases", true)).keys()].sort();
    await freshDatabase();
    const file = await workbookFile();
    await run(naming, file, "apply");
    await applyWebsite();
    await run(naming, file, "apply");
    expect([...(await documentsOf("aliases", true)).keys()].sort()).toEqual(websiteFirst);
  });

  it("keeps the earlier alias when a name changes, writes the new one beside it, and tells a reviewer", async () => {
    await applyWebsite();
    await run(naming, await workbookFile(), "apply");
    const changed = await workbookFile({ rows: rowsWith("Delta1999", { cloud: "Dlta1999" }) });
    const report = await run(naming, changed, "apply");
    expect(report.collections.replicationAliases).toMatchObject({ created: 1 });
    expect(await alias("Delta1999", "cloudAccount", "Dlta1999")).toMatchObject({ alias: "Dlta1999" });
    // Nothing is renamed or deleted, because an external system may still use the earlier name.
    expect(await alias("Delta1999", "cloudAccount", "Delt1999")).toMatchObject({ alias: "Delt1999" });
    const gone = (await reconciliationItems()).filter((item) => item.kind === "missingFromSource");
    expect(gone.map((item) => item.candidates[0].valueSource)).toEqual(
      expect.arrayContaining([`replications/Delta1999/aliases/${studyAliasId("cloudAccount", "Delt1999")}`]),
    );
    // The lint reports the new name, which the token rule does not give.
    expect(report.items.raise.annotationReview).toBe(2);
  });

  it("keeps the aliases of a row that disappears", async () => {
    await applyWebsite();
    await run(naming, await workbookFile(), "apply");
    const without = await workbookFile({ rows: NAMING_ROWS.filter((row) => row.name !== "Delta1999") });
    const report = await run(naming, without, "apply");
    expect(report.sourceRecords.missing).toBe(1);
    expect(await namingAliases()).toHaveLength(6 * 4);
    expect(report.items.raise.missingFromSource).toBe(1);
  });
});

describe("the naming conventions importer imports the workbook as a whole or not at all", () => {
  async function blocked(options: NamingWorkbookOptions, ...checks: string[]): Promise<void> {
    await applyWebsite();
    await run(naming, await workbookFile(), "apply");
    const before = await namingAliases();
    const file = await workbookFile(options);
    const preview = await run(naming, file, "preview");
    expect(preview.blocking.map((entry) => entry.check).sort()).toEqual(checks.sort());
    // The items that explain the block are written at preview, so that a reviewer can act on them.
    expect((await itemCounts()).structureChange).toBe(checks.length);
    const applied = await run(naming, file, "apply");
    expect(applied).toMatchObject({ status: "failed", changesCommitted: 0 });
    // The earlier import is untouched.
    expect(await namingAliases()).toEqual(before);
  }

  it("stops when the workbook has a second tab", async () => {
    await blocked({ secondTab: true }, "tabs");
  });

  it("stops when an expected header is missing or renamed", async () => {
    await blocked({ eegnetHeader: "EEGNet name" }, "header");
  });

  it("stops when one name belongs to two rows without the footnote marker", async () => {
    await blocked({ rows: rowsWith("Iota2004", { eegnet: "DEL" }) }, "duplicate");
  });

  it("stops when marked cells have no footnote, and when a footnote has no marked cells", async () => {
    // Without the footnote, the two shared names are duplicates that nothing explains.
    await blocked({ footnote: null }, "footnote", "duplicate", "duplicate");
    await freshDatabase();
    // The same rows without any marker: the two shared names become names of their own.
    const unmarked: NamingRow[] = NAMING_ROWS.map((row) => ({
      name: row.name,
      cloud: row.cloud,
      explanation: row.explanation,
      ...(row.part2Literal === undefined ? {} : { part2Literal: row.part2Literal }),
      ...(row.split === undefined ? {} : { split: row.split }),
      eegnet: row.eegnet.replace("*", row.part2Literal ?? ""),
    }));
    await blocked({ rows: unmarked }, "footnote");
  });

  it("stops when two names of one scheme differ only by case", async () => {
    await blocked({ rows: rowsWith("Iota2004", { eegnet: "Del" }) }, "case");
  });

  it("stops when a name cell holds no text, and never fills it from a rule", async () => {
    await blocked({ rows: rowsWith("Iota2004", { eegnet: "" }) }, "value");
  });

  it("reports a file that is no workbook", async () => {
    const file = path.join(temporaryDirectory(), "not-a-workbook.xlsx");
    writeFileSync(file, "<html>a sign-in page</html>");
    const report = await run(naming, file, "preview");
    expect(report.blocking.map((entry) => entry.check)).toEqual(["format"]);
    expect(report.tabs).toEqual([]);
  });
});
