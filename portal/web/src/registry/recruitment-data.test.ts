// How the browser reads the documents of recruitment for the resolver and the views. Every
// study and laboratory here is synthetic.
import { countPropertyId, resolvedValue, type SourceLookups } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import type { RecordOf } from "@/data";
import { currentCategories, participationFacts, recruitmentCollections, reportFact } from "./recruitment-data";

const STORED = { seconds: 1_780_000_000, nanoseconds: 0, toMillis: () => 1_780_000_000_000, toDate: () => new Date(0) };

const report = (fields: Partial<RecordOf<"recruitmentReports">>): RecordOf<"recruitmentReports"> =>
  ({
    id: "report-1",
    schemaVersion: 1,
    createdAt: STORED,
    createdBy: "uid-coordinator",
    writeContext: { origin: "user", depth: 0, correlationId: null, causationId: null, auditEventId: "audit-1" },
    participationId: "ExampleStudy2001__lab-a",
    replicationId: "ExampleStudy2001",
    laboratoryId: "lab-a",
    scopeKeys: ["rep:ExampleStudy2001", "lab:lab-a"],
    asOfDate: "2026-03-31",
    reportKind: "cumulative",
    basis: "labReported",
    entryKind: "new",
    counts: { main: { tested: 12 }, rest: { tested: 10 }, participants: { tested: 14 } },
    exclusions: [],
    reportedBy: "uid-coordinator",
    source: "manual",
    dataOrigin: "live",
    ...fields,
  }) as RecordOf<"recruitmentReports">;

const participation = (id: string, laboratoryId: string, fields: Partial<RecordOf<"participations">> = {}) =>
  ({
    id,
    replicationId: "ExampleStudy2001",
    laboratoryId,
    status: "collecting",
    archivedAt: null,
    targetNMain: 40,
    ...fields,
  }) as RecordOf<"participations">;

const lookups: SourceLookups = {
  laboratoryName: (id) => (id === "lab-a" ? "Example Laboratory A" : null),
  replicationStatuses: [],
  countCategories: [{ key: "tested", label: "Tested" }],
};

describe("reportFact", () => {
  it("reads the time of filing, and counts a report still waiting for the server's time as the latest", () => {
    expect(reportFact(report({})).createdAtMillis).toBe(1_780_000_000_000);
    const pending = report({ createdAt: null as unknown as RecordOf<"recruitmentReports">["createdAt"] });
    expect(reportFact(pending).createdAtMillis).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("participationFacts", () => {
  it("takes the country and the institution from the laboratory, and leaves archived participations out", () => {
    const facts = participationFacts(
      [
        participation("ExampleStudy2001__lab-a", "lab-a"),
        participation("ExampleStudy2001__lab-b", "lab-b", { archivedAt: STORED }),
      ],
      [{ id: "lab-a", countryCode: "GB", institutionId: "inst-a" } as RecordOf<"laboratories">],
    );
    expect(facts).toEqual([
      {
        id: "ExampleStudy2001__lab-a",
        replicationId: "ExampleStudy2001",
        laboratoryId: "lab-a",
        status: "collecting",
        countryCode: "GB",
        institutionId: "inst-a",
        targetNMain: 40,
        targetNRest: null,
      },
    ]);
  });
});

describe("currentCategories", () => {
  it("keeps the global categories and those of the replications asked for, in their order", () => {
    const categories = [
      { key: "usable", position: 9, archivedAt: null },
      { key: "tested", position: 4, archivedAt: null },
      { key: "eyesOpen", position: 20, archivedAt: null, replicationId: "ExampleStudy2001" },
      { key: "other", position: 21, archivedAt: null, replicationId: "ExampleStudy2002" },
      { key: "retired", position: 1, archivedAt: STORED },
    ] as unknown as RecordOf<"countCategories">[];
    expect(currentCategories(categories, new Set(["ExampleStudy2001"])).map((category) => category.key)).toEqual([
      "tested",
      "usable",
      "eyesOpen",
    ]);
    expect(currentCategories(categories, "all")).toHaveLength(4);
  });
});

describe("recruitmentCollections", () => {
  it("gives every report, and one record of effective values for each participation, unknown where nothing is stated", () => {
    const reports = [report({})];
    const { reports: reportCollection, states } = recruitmentCollections(
      { reports, facts: reports.map(reportFact) },
      [participation("ExampleStudy2001__lab-a", "lab-a"), participation("ExampleStudy2001__lab-b", "lab-b")],
      lookups,
      "2026-04-30",
    );
    expect(reportCollection.records).toHaveLength(1);
    expect(reportCollection.records[0]?.values[countPropertyId("rest", "tested")]).toBe(10);
    const byId = new Map(states.records.map((record) => [record.id, record.values]));
    expect(byId.get("ExampleStudy2001__lab-a")).toMatchObject({
      [countPropertyId("main", "tested")]: 12,
      [countPropertyId("rest", "tested")]: 10,
      [countPropertyId("participants", "tested")]: 14,
      basis: "reported",
      latestAsOfDate: "2026-03-31",
    });
    expect(byId.get("ExampleStudy2001__lab-b")).toMatchObject({
      [countPropertyId("main", "tested")]: null,
      basis: null,
      latestAsOfDate: null,
    });
    // Nothing in the record adds one modality to another.
    expect(Object.values(byId.get("ExampleStudy2001__lab-a") ?? {})).not.toContain(22);
    expect(resolvedValue({}, "main", "tested")).toBeUndefined();
  });
});
