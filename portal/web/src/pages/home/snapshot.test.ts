// The figures of the programme snapshot on Home. Identifiers and countries are synthetic.
import { describe, expect, it } from "vitest";
import {
  membersByCountry,
  originBreakdown,
  publicationsByStatus,
  replicationsByStage,
  replicationsByStatus,
} from "./snapshot";

describe("the programme snapshot", () => {
  it("counts replications by status in the programme's order, those without a status last, each with its list", () => {
    expect(
      replicationsByStatus([
        { statusKey: "collecting", statusLabel: "Collecting", statusPosition: 4 },
        { statusKey: "planning", statusLabel: "Planning", statusPosition: 1 },
        { statusKey: "collecting", statusLabel: "Collecting", statusPosition: 4 },
        { statusKey: null, statusLabel: null, statusPosition: null },
      ]),
    ).toEqual([
      { key: "planning", label: "Planning", count: 1, to: "/replications?status=planning" },
      { key: "collecting", label: "Collecting", count: 2, to: "/replications?status=collecting" },
      { key: "none", label: "No status recorded", count: 1, to: "/replications?status=none" },
    ]);
  });

  it("counts replications by public stage, and leaves out a group that is empty", () => {
    expect(
      replicationsByStage([
        { stageNumber: 3, stageName: "Data collection" },
        { stageNumber: 1, stageName: null },
      ]),
    ).toEqual([
      { key: "1", label: "Stage 1", count: 1, to: "/replications?stage=1" },
      { key: "3", label: "3. Data collection", count: 1, to: "/replications?stage=3" },
    ]);
    expect(replicationsByStage([])).toEqual([]);
  });

  it("counts members by country, most first, with the rest together and the unknown apart", () => {
    const people = [
      ...Array.from({ length: 3 }, () => ({ countryCode: "GB" })),
      ...Array.from({ length: 2 }, () => ({ countryCode: "DE" })),
      { countryCode: "NL" },
      { countryCode: "FR" },
      { countryCode: null },
    ];
    const name = (code: string) =>
      ({ GB: "United Kingdom", DE: "Germany", NL: "Netherlands", FR: "France" })[code] ?? code;
    expect(membersByCountry(people, name, 2)).toEqual([
      { key: "GB", label: "United Kingdom", count: 3, to: "/members?country=GB" },
      { key: "DE", label: "Germany", count: 2, to: "/members?country=DE" },
      { key: "other", label: "2 other countries", count: 2, to: "/members" },
      { key: "none", label: "No country recorded", count: 1, to: "/members?country=none" },
    ]);
  });

  it("counts publications by status in the order of the statuses, each linked to the replications that have one", () => {
    const labels = { planned: "Planned", submitted: "Submitted", published: "Published" };
    expect(publicationsByStatus(["published", "planned", "published"], labels)).toEqual([
      { key: "planned", label: "Planned", count: 1, to: "/replications?publication=planned" },
      { key: "published", label: "Published", count: 2, to: "/replications?publication=published" },
    ]);
  });
});

describe("originBreakdown", () => {
  const labels = {
    live: "Live",
    importedHistorical: "Imported historical",
    demo: "Demonstration data",
    projected: "Projected",
  } as const;
  const format = (value: number) => value.toLocaleString("en-GB");

  it("names one origin for all, and counts each origin apart where they are mixed", () => {
    expect(originBreakdown(["demo", "demo"], labels, format)).toBe("all demonstration data");
    expect(
      originBreakdown([...Array<"demo">(988).fill("demo"), ...Array<"live">(12).fill("live")], labels, format),
    ).toBe("12 live and 988 demonstration data");
    expect(originBreakdown(["demo", "importedHistorical", "live"], labels, format)).toBe(
      "1 live, 1 imported historical and 1 demonstration data",
    );
    expect(originBreakdown([], labels, format)).toBeNull();
  });
});
