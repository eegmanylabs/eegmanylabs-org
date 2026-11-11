// Live queries as data: what identifies a query, and what is refused before it reaches Firestore.
import { describe, expect, it } from "vitest";
import {
  assertValidLiveQuery,
  LIVE_QUERY_MAX_LIMIT,
  type LiveQuery,
  LiveQueryError,
  liveQueryKey,
  QUERY_MAX_CLAUSE_VALUES,
} from "./query-spec";

const participations: LiveQuery<"participations"> = {
  collection: "participations",
  within: [],
  where: [
    ["scopeKeys", "array-contains-any", ["rep:SyntheticStudy2001", "lab:lab-synthetic-1"]],
    ["archivedAt", "==", null],
  ],
  orderBy: [["laboratoryId", "asc"]],
  limit: 50,
};

describe("liveQueryKey", () => {
  it("is the same for two descriptions of the same query", () => {
    const again: LiveQuery<"participations"> = {
      limit: 50,
      orderBy: [["laboratoryId", "asc"]],
      where: [
        ["scopeKeys", "array-contains-any", ["rep:SyntheticStudy2001", "lab:lab-synthetic-1"]],
        ["archivedAt", "==", null],
      ],
      within: [],
      collection: "participations",
    };
    expect(liveQueryKey(again)).toBe(liveQueryKey(participations));
    expect(liveQueryKey(participations)).toMatch(/^query:/);
  });

  it.each<[string, Partial<LiveQuery<"participations">>]>([
    ["another limit", { limit: 51 }],
    ["another order", { orderBy: [["laboratoryId", "desc"]] }],
    ["another field to order by", { orderBy: [["replicationId", "asc"]] }],
    ["no order", { orderBy: [] }],
    ["another value", { where: [["scopeKeys", "array-contains-any", ["rep:SyntheticStudy2002"]]] }],
    ["another operator", { where: [["scopeKeys", "array-contains", "rep:SyntheticStudy2001"]] }],
    ["one clause fewer", { where: [["archivedAt", "==", null]] }],
    ["the collection beneath every parent", { within: "group" }],
  ])("differs for %s", (_label, change) => {
    expect(liveQueryKey({ ...participations, ...change })).not.toBe(liveQueryKey(participations));
  });

  it("tells the collections of two parents apart, and a date from the text that spells it", () => {
    const hypotheses = (studyKey: string): LiveQuery<"replicationHypotheses"> => ({
      collection: "replicationHypotheses",
      within: [studyKey],
      limit: 10,
    });
    expect(liveQueryKey(hypotheses("SyntheticStudy2001"))).not.toBe(liveQueryKey(hypotheses("SyntheticStudy2002")));

    const since = (value: Date | string): LiveQuery<"participations"> => ({
      collection: "participations",
      within: [],
      where: [["updatedAt", ">=", value]],
      limit: 10,
    });
    const instant = new Date("2026-01-02T03:04:05Z");
    expect(liveQueryKey(since(instant))).toBe(liveQueryKey(since(new Date(instant.getTime()))));
    expect(liveQueryKey(since(instant))).not.toBe(liveQueryKey(since(instant.toISOString())));
    expect(liveQueryKey(since(instant))).not.toBe(liveQueryKey(since(new Date("2026-01-02T03:04:06Z"))));
  });
});

describe("assertValidLiveQuery", () => {
  const refused = (change: Partial<LiveQuery<"participations">>) => () =>
    assertValidLiveQuery({ ...participations, ...change });

  it("accepts a bounded query that is limited to scopes", () => {
    expect(refused({})).not.toThrow();
    expect(refused({ limit: 1 })).not.toThrow();
    expect(refused({ limit: LIVE_QUERY_MAX_LIMIT })).not.toThrow();
  });

  it.each([0, -1, 1.5, LIVE_QUERY_MAX_LIMIT + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses the limit %s: every list is bounded",
    (limit) => {
      expect(refused({ limit })).toThrow(LiveQueryError);
    },
  );

  it("refuses a second array-membership clause, which Firestore does not accept", () => {
    expect(
      refused({
        where: [
          ["scopeKeys", "array-contains-any", ["rep:SyntheticStudy2001"]],
          ["sourceRecordIds", "array-contains", "0123456789abcdef0123"],
        ],
      }),
    ).toThrow(/one array-membership clause/);
  });

  it("refuses a list where one value is compared, and one value where a list is", () => {
    expect(refused({ where: [["replicationId", "==", ["SyntheticStudy2001"]]] })).toThrow(/replicationId/);
    expect(refused({ where: [["replicationId", "in", "SyntheticStudy2001"]] })).toThrow(/replicationId/);
    expect(refused({ where: [["replicationId", "in", ["SyntheticStudy2001"]]] })).not.toThrow();
  });

  it("refuses an empty list and more values than one clause may hold", () => {
    const keys = Array.from({ length: QUERY_MAX_CLAUSE_VALUES + 1 }, (_value, index) => `rep:Study${index}`);
    expect(refused({ where: [["scopeKeys", "array-contains-any", []]] })).toThrow(LiveQueryError);
    expect(refused({ where: [["scopeKeys", "array-contains-any", keys]] })).toThrow(/between 1 and 30/);
    expect(refused({ where: [["scopeKeys", "array-contains-any", keys.slice(1)]] })).not.toThrow();
  });
});

describe("the types of a live query", () => {
  it("accept only fields of the collection and the identifiers of its ancestors", () => {
    const valid: LiveQuery<"replicationHypotheses"> = {
      collection: "replicationHypotheses",
      within: ["SyntheticStudy2001"],
      where: [["scientificReviewStatus", "==", "unverified"]],
      limit: 10,
    };
    // @ts-expect-error A hypothesis has no such field.
    const wrongField: LiveQuery<"replicationHypotheses"> = { ...valid, where: [["laboratoryId", "==", "x"]] };
    // @ts-expect-error The collection of hypotheses lies beneath one replication.
    const wrongParents: LiveQuery<"replicationHypotheses"> = { ...valid, within: [] };
    // @ts-expect-error The preferences of a user are one document with a fixed name, and no collection to list.
    const fixedName: LiveQuery<"userPreferences"> = { collection: "userPreferences", within: ["uid"], limit: 1 };
    expect([valid, wrongField, wrongParents, fixedName]).toHaveLength(4);
  });
});

describe("a page of a longer list", () => {
  const persons: LiveQuery<"persons"> = { collection: "persons", within: [], limit: 1_000 };

  it("is a query of its own, after the document it starts after", () => {
    expect(liveQueryKey({ ...persons, startAfterId: "person-a" })).not.toBe(liveQueryKey(persons));
    expect(liveQueryKey({ ...persons, startAfterId: "person-a" })).not.toBe(
      liveQueryKey({ ...persons, startAfterId: "person-b" }),
    );
    expect(() => assertValidLiveQuery({ ...persons, startAfterId: "person-a" })).not.toThrow();
  });

  it("is refused for a query in another order, or across the parents of a collection", () => {
    expect(() => assertValidLiveQuery({ ...participations, startAfterId: "x" })).toThrow(LiveQueryError);
    expect(() =>
      assertValidLiveQuery({ collection: "laboratoryMembers", within: "group", limit: 10, startAfterId: "x" }),
    ).toThrow(LiveQueryError);
  });
});
