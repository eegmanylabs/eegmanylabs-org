// The words of the imports console for the counts of a batch and the kinds of records it wrote.
// Identifiers are synthetic.
import { describe, expect, it } from "vitest";
import { collectionOfPath, statLabel } from "./import-format";

describe("the words of the imports console", () => {
  it("puts the counts of a batch and the field names into sentence case", () => {
    expect(statLabel("rowsRead")).toBe("Rows read");
    expect(statLabel("itemsRaised")).toBe("Items raised for review");
    expect(statLabel("rows:people:cellAnnotations")).toBe("Rows, people, cell annotations");
    expect(statLabel("dataOrigin")).toBe("Data origin");
  });

  it("names the kind of record a document path holds", () => {
    expect(collectionOfPath("historicalAggregates/totalNRest__s-1")).toBe("Historical aggregates");
    expect(collectionOfPath("persons/person-1/private/contact")).toBe("Person contact");
  });
});
