// The parts of the data model that the import framework added: the institution candidate, two
// alias schemes, the affiliation slots of a contributor, a reconciliation candidate without a
// source record, and the fields by which a batch names what it read and what it saw.
// SYNTHETIC DATA. Every name and value below is invented.
import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "../collections";
import { institutionCandidateId } from "../ids";
import { systemWriteContext } from "./base";
import { institutionCandidateDocSchema } from "./identity";
import { affiliationSlotSchema, contributorDocSchema } from "./outputs";
import { importBatchChangeStateDocSchema, importBatchDocSchema, reconciliationCandidateSchema } from "./provenance";
import { aliasSchemeSchema } from "./replications";

const NOW = { seconds: 1_800_000_000, nanoseconds: 0, toDate: () => new Date(0), toMillis: () => 0 };
const STANDARD = {
  schemaVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: "system:import",
  updatedBy: "system:import",
  archivedAt: null,
  writeContext: systemWriteContext("import"),
};

describe("an institution candidate", () => {
  const candidate = {
    ...STANDARD,
    affiliationFolded: "exampleuniversitysamplecity",
    affiliationsSource: ["Example University, Sample City", "example university,  Sample City"],
    institutionId: null,
  };

  it("holds the folded string, every raw spelling and no institution until a reviewer maps it", () => {
    expect(institutionCandidateDocSchema.safeParse(candidate).success).toBe(true);
    expect(institutionCandidateDocSchema.safeParse({ ...candidate, institutionId: "inst__0f3a" }).success).toBe(true);
  });

  it("refuses a string that is not folded, and a field the model does not name", () => {
    expect(
      institutionCandidateDocSchema.safeParse({ ...candidate, affiliationFolded: "Example University" }).success,
    ).toBe(false);
    expect(institutionCandidateDocSchema.safeParse({ ...candidate, affiliationFolded: "" }).success).toBe(false);
    expect(institutionCandidateDocSchema.safeParse({ ...candidate, country: "Nowhere" }).success).toBe(false);
  });

  it("is registered as written by trusted code alone, closed to every client and built from the folded string", () => {
    const entry = COLLECTIONS.institutionCandidates;
    expect(entry.write).toEqual({ mode: "function" });
    expect(entry.read.tiers).toEqual(["ADMIN"]);
    expect(entry.enforcement).toBe("deniedUntilBuilt");
    expect(entry.identifier).toMatchObject({ kind: "builder", builder: "institutionCandidateId" });
    const id = institutionCandidateId(candidate.affiliationsSource[0] ?? "") ?? "";
    expect(institutionCandidateId(candidate.affiliationFolded)).toBe(id);
    expect(entry.docPath(id)).toBe(`institutionCandidates/${id}`);
  });
});

describe("the alias schemes", () => {
  it("include the display text of a link and the name of a data repository", () => {
    expect(aliasSchemeSchema.options).toEqual(expect.arrayContaining(["sourceLabel", "dataRepository"]));
    expect(aliasSchemeSchema.safeParse("ginRepository").success).toBe(false);
  });
});

describe("the affiliations of a contributor", () => {
  const contributor = {
    ...STANDARD,
    creditRoles: {},
    reviewStatus: "needsReview",
    replicationId: null,
    manuscriptId: null,
    contributorTableId: "ctable__0f3a",
    personId: null,
    scopeKeys: [],
  };

  it("keep every affiliation cell by its slot, verbatim", () => {
    const parsed = contributorDocSchema.safeParse({
      ...contributor,
      affiliationSource: " Example University ",
      affiliationSlotsSource: { "1": " Example University ", "2": "Sample Institute; Other Place", "3": "" },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.affiliationSlotsSource?.["2"]).toBe("Sample Institute; Other Place");
  });

  it("refuse a slot that is no number from 1 to 9", () => {
    for (const slot of ["0", "10", "primary", ""])
      expect(affiliationSlotSchema.safeParse(slot).success, slot).toBe(false);
    expect(contributorDocSchema.safeParse({ ...contributor, affiliationSlotsSource: { primary: "x" } }).success).toBe(
      false,
    );
  });
});

describe("a candidate of a reconciliation item", () => {
  it("names its source record, or none when the value was edited in the portal", () => {
    expect(reconciliationCandidateSchema.safeParse({ key: "portal:aa", valueSource: "Edited title" }).success).toBe(
      true,
    );
    expect(
      reconciliationCandidateSchema.safeParse({
        key: "h/replications:bb",
        valueSource: "Title",
        sourceRecordId: "0123456789abcdef0123",
      }).success,
    ).toBe(true);
    expect(reconciliationCandidateSchema.safeParse({ valueSource: "Title" }).success).toBe(false);
  });
});

describe("an import batch", () => {
  const batch = {
    ...STANDARD,
    sourceKey: "h",
    mode: "preview",
    status: "previewed",
    contentHash: "ab".repeat(32),
    startedBy: "system:import",
    startedAt: NOW,
    finishedAt: NOW,
    stats: {},
  };

  it("needs none of the added fields", () => {
    expect(importBatchDocSchema.safeParse(batch).success).toBe(true);
  });

  it("names the files it read, the commit, its plan and the batch that lists what it saw", () => {
    const parsed = importBatchDocSchema.safeParse({
      ...batch,
      observedOn: "2026-11-09",
      inputFiles: [{ name: "people.tsv", sha256: "cd".repeat(32) }],
      sourceCommit: "b0c0f04",
      planHash: "ef".repeat(32),
      previewBatchId: "run__20261110T031500123Z__abababababab",
      manifestBatchId: "run__20261109T120000000Z__abababababab",
    });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("holds the report of its verification, with each check and no field beside them", () => {
    const verification = {
      checkedAt: NOW,
      passed: false,
      checks: [{ key: "rowAccounting", passed: false, detail: "t0: 3 data rows = 2 imported + 0 queued + 0 raw only" }],
    };
    expect(importBatchDocSchema.safeParse({ ...batch, verification }).error?.issues ?? []).toEqual([]);
    expect(importBatchDocSchema.safeParse({ ...batch, verification: { ...verification, signedBy: "x" } }).success).toBe(
      false,
    );
    expect(
      importBatchDocSchema.safeParse({ ...batch, verification: { ...verification, checks: [{ key: "a", passed: true }] } })
        .success,
    ).toBe(false);
  });

  it("refuses a file hash, a commit or a plan hash of another shape", () => {
    expect(
      importBatchDocSchema.safeParse({ ...batch, inputFiles: [{ name: "people.tsv", sha256: "abc" }] }).success,
    ).toBe(false);
    expect(importBatchDocSchema.safeParse({ ...batch, sourceCommit: "HEAD" }).success).toBe(false);
    expect(importBatchDocSchema.safeParse({ ...batch, planHash: "not-a-hash" }).success).toBe(false);
  });
});

describe("the two states of a special-category document in the change log", () => {
  const state = { schemaVersion: 1, createdAt: NOW, createdBy: "system:import", writeContext: STANDARD.writeContext };

  it("may name the path of the document, which the entry that clients read does not", () => {
    expect(
      importBatchChangeStateDocSchema.safeParse({
        ...state,
        documentPath: "persons/p__0123456789abcdef0123/special/demographics",
        before: null,
        after: { genderSource: "an invented term" },
      }).error?.issues ?? [],
    ).toEqual([]);
    expect(importBatchChangeStateDocSchema.safeParse({ ...state, before: null, after: null }).success).toBe(true);
    expect(importBatchChangeStateDocSchema.safeParse({ ...state, documentPath: "", before: null, after: null }).success).toBe(
      false,
    );
  });
});
