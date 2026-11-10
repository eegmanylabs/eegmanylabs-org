// Unit tests of the guard that reads every planned document before anything is written.
// SYNTHETIC DATA. Every name, term and address (on example.org) below is invented.
import { describe, expect, it } from "vitest";
import type { RecordedRow } from "./model";
import { PlanBuilder } from "./plan";
import { guardPlan, withGuard } from "./privacy-guard";
import { itemBuilders } from "./reconcile";

const items = itemBuilders("a-synthetic-secret-for-tests-of-32-bytes-or-more");

function row(recordId: string, extra: Partial<RecordedRow> = {}): RecordedRow {
  return {
    rowClass: "data",
    rowNumber: 2,
    rowKey: `key-${recordId}`,
    tabKey: "t0",
    recordId,
    rawHash: "0123456789ab",
    labels: ["A", "B", "C", "D"],
    cells: [
      { v: "Zed", t: "string" },
      { v: "Quillfeather-Example", t: "string" },
      { v: "zed.quillfeather@example.org", t: "string" },
      { v: "Example University", t: "string" },
    ],
    ...extra,
  };
}

const rowsOf = (...rows: RecordedRow[]) => new Map([["t0", rows]]);

/** A person as an importer of a restricted source states it: an opaque identifier, and the name in the directory. */
function personPlan(overrides: { readonly id?: string; readonly displayName?: string } = {}): PlanBuilder {
  const builder = new PlanBuilder();
  builder.document({
    collection: "persons",
    ids: [overrides.id ?? "p__0123456789abcdef0123"],
    fixed: { slug: "p-0123456789abcdef0123" },
    owned: { displayName: overrides.displayName ?? "Zed Quillfeather-Example" },
    sourceRecordIds: ["r-1"],
  });
  return builder;
}

describe("guardPlan", () => {
  it("finds nothing in a plan that keeps every value in its place", () => {
    const builder = personPlan();
    builder.document({
      collection: "personContact",
      ids: ["p__0123456789abcdef0123"],
      union: { emails: [{ email: "zed.quillfeather@example.org", kind: "primary" }] },
      sourceRecordIds: ["r-1"],
    });
    expect(guardPlan(builder.build(), rowsOf(row("r-1", { personal: ["A", "B", "C"] })))).toEqual([]);
  });

  it("finds an address in a document that every member can read, and names the field and never the value", () => {
    const builder = personPlan({ displayName: "Zed zed.quillfeather@example.org" });
    builder.document({
      collection: "personAffiliations",
      ids: ["p__0123456789abcdef0123", "g__t0__1"],
      owned: { affiliationSource: "Example University (write to zed.quillfeather@example.org)" },
      sourceRecordIds: ["r-1"],
    });
    const findings = guardPlan(builder.build(), rowsOf(row("r-1")));
    expect(findings).toEqual([
      { check: "address", collection: "persons", fields: ["displayName"], recordIds: ["r-1"] },
      { check: "address", collection: "personAffiliations", fields: ["affiliationSource"], recordIds: ["r-1"] },
    ]);
    expect(JSON.stringify(findings)).not.toContain("example.org");
  });

  it("finds an address in the path of any document, whoever may read it", () => {
    const builder = new PlanBuilder();
    builder.document({
      collection: "personEmailIndex",
      ids: ["zed.quillfeather@example.org"],
      union: { personIds: ["p__0123456789abcdef0123"] },
      sourceRecordIds: ["r-1"],
    });
    expect(guardPlan(builder.build(), rowsOf(row("r-1")))).toEqual([
      { check: "address", collection: "personEmailIndex", fields: ["(identifier)"], recordIds: ["r-1"] },
    ]);
  });

  it("finds an identifier that holds a word of a name of its own row, and no word of a hash or of another row", () => {
    const personal = { personal: ["A", "B", "C"] };
    const named = personPlan({ id: "p__zed-quillfeather" });
    expect(guardPlan(named.build(), rowsOf(row("r-1", personal)))).toEqual([
      { check: "identifier", collection: "persons", fields: ["(identifier)"], recordIds: ["r-1"] },
    ]);
    // The same identifier is no finding for a row that does not say which of its cells name a person,
    // and an identifier of hashes holds no word, whatever letters the hash happens to contain.
    expect(guardPlan(named.build(), rowsOf(row("r-1")))).toEqual([]);
    const hashed = personPlan({ id: "p__abcdefabcdefabcdef12" });
    const hexName = row("r-1", { personal: ["A"], cells: [{ v: "Abcdefabcdefabcdef12", t: "string" }, null, null, null] });
    expect(guardPlan(hashed.build(), rowsOf(hexName))).toEqual([]);
    // A study identifier that begins with the surname of a lead is public and is no word of the name.
    const membership = new PlanBuilder();
    membership.document({
      collection: "replicationMemberships",
      ids: ["QuillfeatherExample2001", "p__0123456789abcdef0123__lead"],
      owned: { reviewStatus: "needsReview" },
      sourceRecordIds: ["r-1"],
    });
    expect(guardPlan(membership.build(), rowsOf(row("r-1", personal)))).toEqual([]);
  });

  it("finds a special-category cell outside a special-category document, also in an item", () => {
    const special = { special: { E: { v: " An Invented Term ", t: "string" }, F: { v: "xy", t: "string" } } };
    const builder = personPlan();
    builder.document({
      collection: "personDemographics",
      ids: ["p__0123456789abcdef0123"],
      owned: { genderSource: " An Invented Term " },
      sourceRecordIds: ["r-1"],
    });
    expect(guardPlan(builder.build(), rowsOf(row("r-1", special)))).toEqual([]);
    // The same term in the directory document, in any case and spacing, is a finding. A code of two letters is not compared.
    const leaked = personPlan();
    leaked.document({
      collection: "persons",
      ids: ["p__0123456789abcdef0123"],
      owned: { countrySource: "an invented term", givenName: "xy" },
      sourceRecordIds: ["r-1"],
    });
    leaked.item(
      items.unparsedValue({
        subject: "g/t0/key-r-1",
        claims: [{ source: "g/t0", value: "x", valueSource: "An Invented Term", sourceRecordId: "r-1" }],
      }),
    );
    expect(guardPlan(leaked.build(), rowsOf(row("r-1", special)))).toEqual([
      { check: "specialCategory", collection: "persons", fields: ["countrySource"], recordIds: ["r-1"] },
      { check: "specialCategory", collection: "reconciliationItems", fields: ["candidates"], recordIds: ["r-1"] },
    ]);
  });
});

describe("withGuard", () => {
  it("leaves a clean plan as it is", () => {
    const plan = personPlan().build();
    expect(withGuard(plan, [], "g", items)).toBe(plan);
  });

  it("blocks the batch and raises one item for each check and collection, with records and fields and no value", () => {
    const builder = personPlan({ displayName: "Zed zed.quillfeather@example.org" });
    const plan = builder.build();
    const guarded = withGuard(plan, guardPlan(plan, rowsOf(row("r-1"))), "g", items);
    expect(guarded.blocking).toEqual([
      { check: "privacy/address", message: expect.stringContaining("1 planned documents of persons") },
    ]);
    expect(guarded.blocking[0]?.message).toContain("displayName");
    const [item] = guarded.items;
    expect(item).toMatchObject({ kind: "privacyReview", blocking: true, field: "address" });
    expect(item?.candidates.map((candidate) => candidate.sourceRecordId).filter(Boolean)).toEqual(["r-1"]);
    expect(JSON.stringify(guarded.items) + JSON.stringify(guarded.blocking)).not.toContain("example.org");
    // The same finding gives the same item on every run, so it is raised once.
    expect(withGuard(plan, guardPlan(plan, rowsOf(row("r-1"))), "g", items).items[0]?.fingerprint).toBe(item?.fingerprint);
  });
});
