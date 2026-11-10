// Unit tests of the document builders that several importers share. The studies, labels and
// addresses (on example.org) are invented.
import {
  documentLinkSlotId,
  institutionCandidateId,
  integrationMappingId,
  studyAliasId,
  vocabularyTermId,
} from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { fakeFirestore } from "./fixtures/fake-firestore";
import type { SourceRow } from "./model";
import { PlanBuilder } from "./plan";
import {
  affiliationDocuments,
  aliasDocuments,
  cellText,
  cellValue,
  doiLookupDocument,
  isEditorAddress,
  isStorableUrl,
  linkKindOf,
  slotLinkDocument,
  VocabularyCollector,
} from "./records";
import { StudyResolver } from "./studies";

const byPath = (builder: PlanBuilder) =>
  new Map(builder.build().documents.map((document) => [document.path, document]));

describe("cellValue and cellText", () => {
  const row: SourceRow = {
    rowClass: "data",
    rowNumber: 2,
    rowKey: "k",
    labels: ["A", "B", "C", "D", "E"],
    cells: [{ v: "text", t: "string" }, { v: 0, t: "number" }, null, "plain", { v: null, t: "empty", merge: "C2:C3" }],
  };

  it("read the stored value of a cell record, and of a cell of a text file", () => {
    expect(cellValue(row, "A")).toBe("text");
    expect(cellValue(row, "B")).toBe(0);
    expect(cellValue(row, "D")).toBe("plain");
    expect(cellText(row, "D")).toBe("plain");
  });

  it("give null for an empty cell, a cell without a value and a column the row does not have, and no text for a number", () => {
    expect([cellValue(row, "C"), cellValue(row, "E"), cellValue(row, "Z")]).toEqual([null, null, null]);
    expect(cellText(row, "B")).toBeNull();
  });
});

describe("aliasDocuments", () => {
  it("states the alias beneath its replication and its entry in the folded lookup, and tells the resolver", async () => {
    const builder = new PlanBuilder();
    const studies = new StudyResolver(fakeFirestore({}).db);
    expect(
      aliasDocuments(builder, studies, {
        replicationId: "Delta1999",
        scheme: "bids",
        alias: "Delt",
        owned: { part1: "Del" },
        recordId: "r-1",
      }),
    ).toBe(true);
    const documents = byPath(builder);
    expect(documents.get(`replications/Delta1999/aliases/${studyAliasId("bids", "Delt")}`)).toMatchObject({
      fixed: { replicationId: "Delta1999", alias: "Delt", aliasFolded: "delt", scheme: "bids", isCanonical: false },
      owned: { part1: "Del" },
    });
    expect(documents.get("studyAliasIndex/delt")).toMatchObject({ union: { replicationIds: ["Delta1999"] } });
    expect(await studies.resolve("DELT")).toEqual({ status: "resolved", replicationId: "Delta1999" });
  });

  it("flags the spelling that equals the identifier as canonical, and writes no lookup entry for a spelling that folds to nothing", () => {
    const builder = new PlanBuilder();
    const studies = new StudyResolver(fakeFirestore({}).db);
    aliasDocuments(builder, studies, {
      replicationId: "Delta1999",
      scheme: "programme",
      alias: "Delta1999",
      recordId: "r-1",
    });
    expect(
      aliasDocuments(builder, studies, { replicationId: "Delta1999", scheme: "other", alias: "***", recordId: "r-1" }),
    ).toBe(false);
    const documents = byPath(builder);
    expect(
      documents.get(`replications/Delta1999/aliases/${studyAliasId("programme", "Delta1999")}`)?.fixed.isCanonical,
    ).toBe(true);
    expect([...documents.keys()].filter((path) => path.startsWith("studyAliasIndex/"))).toEqual([
      "studyAliasIndex/delta1999",
    ]);
  });
});

describe("the other shared documents", () => {
  it("key a DOI lookup by the lower-case DOI, whose hash is the identifier", () => {
    const builder = new PlanBuilder();
    doiLookupDocument(builder, { entityType: "manuscript", entityId: "Kept2025" }, " 10.1000/INVENTED(2002)02 ", "r-1");
    const id = integrationMappingId("doi", "manuscript", "10.1000/invented(2002)02");
    expect(byPath(builder).get(`integrationMappings/${id}`)?.fixed).toEqual({
      entityType: "manuscript",
      entityId: "Kept2025",
      system: "doi",
      externalId: "10.1000/invented(2002)02",
    });
  });

  it("keep an affiliation as one verbatim string and state the candidate of its folded form", () => {
    const builder = new PlanBuilder();
    const affiliation = "Dept. of Examples; Invented University & Example Hospital, Nowhereland";
    affiliationDocuments(builder, {
      personId: "p__1",
      sourceKey: "h",
      tabKey: "members",
      slot: 1,
      affiliation,
      recordId: "r-1",
    });
    affiliationDocuments(builder, {
      personId: "p__2",
      sourceKey: "h",
      tabKey: "people",
      slot: 2,
      affiliation: affiliation.toUpperCase(),
      recordId: "r-2",
    });
    const documents = byPath(builder);
    expect(documents.get("persons/p__1/affiliations/h__members__a1")).toMatchObject({
      fixed: { isPrimary: true },
      owned: { affiliationSource: affiliation },
    });
    expect(documents.get("persons/p__2/affiliations/h__people__a2")?.fixed.isPrimary).toBe(false);
    // Two spellings that fold alike meet in one candidate, which lists both and maps to no institution.
    expect(documents.get(`institutionCandidates/${institutionCandidateId(affiliation)}`)).toMatchObject({
      fixed: { institutionId: null },
      union: { affiliationsSource: [affiliation, affiliation.toUpperCase()] },
      sourceRecordIds: ["r-1", "r-2"],
    });
  });

  it("state a link in a named slot of its owner, with the audience of the owner and of every member", () => {
    const builder = new PlanBuilder();
    slotLinkDocument(builder, {
      owner: { entityType: "replication", entityId: "Delta1999" },
      slot: "signup",
      url: "https://forms.gle/an-invented-form",
      replicationId: "Delta1999",
      ownerScopeKeys: ["rep:Delta1999"],
      recordId: "r-1",
    });
    expect(
      byPath(builder).get(`documentLinks/${documentLinkSlotId("replication__Delta1999", "signup")}`),
    ).toMatchObject({
      fixed: {
        entityType: "replication",
        entityId: "Delta1999",
        scopeKeys: ["rep:Delta1999", "members"],
        restricted: false,
      },
      owned: { url: "https://forms.gle/an-invented-form", kind: "form" },
    });
  });

  it("read the kind of a link from its host and path, and know an editor address", () => {
    expect(
      [
        "https://forms.gle/x",
        "https://docs.google.com/forms/d/e/x/viewform",
        "https://docs.google.com/document/d/x/edit",
        "https://docs.google.com/spreadsheets/d/x/edit#gid=0",
        "https://drive.google.com/drive/folders/x",
        "https://osf.io/abcde/",
        "https://github.com/example/repository",
        "https://papers.example.org/report.PDF",
        "https://doi.org/10.1000/invented",
      ].map(linkKindOf),
    ).toEqual(["form", "form", "googleDoc", "googleSheet", "driveFolder", "osf", "github", "pdf", "url"]);
    expect(isEditorAddress("https://docs.google.com/forms/d/x/edit")).toBe(true);
    expect(isEditorAddress("https://docs.google.com/forms/d/e/x/viewform")).toBe(false);
    expect(isEditorAddress("https://forms.example.org/edit")).toBe(false);
    expect(
      ["https://example.org/a", "http://example.org", "done", "ftp://example.org/a", "example.org", ""].map(
        isStorableUrl,
      ),
    ).toEqual([true, true, false, false, false, false]);
  });
});

describe("VocabularyCollector", () => {
  it("makes one term of spellings that fold alike, named by the most frequent label, whatever the order of the rows", () => {
    const collect = (order: readonly (readonly [string, string])[]) => {
      const collector = new VocabularyCollector();
      for (const [label, recordId] of order) collector.add("journal", label, recordId);
      const builder = new PlanBuilder();
      collector.documents(builder);
      return builder.build().documents;
    };
    const rows = [
      ["ExampleArXiv", "r-3"],
      ["Examplearxiv", "r-2"],
      ["ExampleArXiv", "r-1"],
    ] as const;
    const forwards = collect(rows);
    expect(forwards).toEqual(collect([...rows].reverse()));
    expect(forwards).toHaveLength(1);
    expect(forwards[0]).toMatchObject({
      path: `vocabularyTerms/${vocabularyTermId("journal", "ExampleArXiv")}`,
      fixed: { kind: "journal", sameAsSource: [], isDeprecated: false },
      owned: { name: "ExampleArXiv" },
      union: { labelsSource: ["ExampleArXiv", "Examplearxiv"] },
      // One source record for each spelling: the one with the smallest identifier.
      sourceRecordIds: ["r-1", "r-2"],
    });
  });

  it("keeps the raw spelling that an alias table mapped, and makes no term of an empty label", () => {
    const collector = new VocabularyCollector();
    expect(collector.add("country", "United States", "r-1", "USA")).toBe(vocabularyTermId("country", "United States"));
    collector.add("country", "United States", "r-2");
    expect(collector.add("country", "  ", "r-3")).toBeNull();
    const builder = new PlanBuilder();
    collector.documents(builder);
    expect(builder.build().documents[0]).toMatchObject({
      owned: { name: "United States" },
      union: { labelsSource: ["USA", "United States"] },
    });
  });
});
