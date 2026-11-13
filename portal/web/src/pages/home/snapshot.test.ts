// The figures of the programme snapshot on Home. Identifiers and countries are synthetic.
import { SMALL_CELL_THRESHOLD } from "@eegml/shared";
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

  it("counts members by country, most first, with small groups and the rest together and the unknown apart", () => {
    const people = [
      ...Array.from({ length: 7 }, () => ({ countryCode: "GB" })),
      ...Array.from({ length: 6 }, () => ({ countryCode: "DE" })),
      ...Array.from({ length: 5 }, () => ({ countryCode: "FR" })),
      ...Array.from({ length: 2 }, () => ({ countryCode: "NL" })),
      { countryCode: "ES" },
      { countryCode: null },
    ];
    const name = (code: string) =>
      ({ GB: "United Kingdom", DE: "Germany", NL: "Netherlands", FR: "France", ES: "Spain" })[code] ?? code;
    expect(membersByCountry(people, name, 2)).toEqual([
      { key: "GB", label: "United Kingdom", count: 7, to: "/members?country=GB" },
      { key: "DE", label: "Germany", count: 6, to: "/members?country=DE" },
      { key: "other", label: "1 other countries", count: 5, to: "/members" },
      { key: "small", label: "2 countries with fewer than 5 members each", count: 3, to: "/members" },
      { key: "none", label: "No country recorded", count: 1, to: "/members?country=none" },
    ]);
  });

  it("never names a country with fewer members than the threshold of small groups", () => {
    const people = [
      ...Array.from({ length: 3 }, () => ({ countryCode: "NL" })),
      ...Array.from({ length: 4 }, () => ({ countryCode: "GB" })),
      ...Array.from({ length: SMALL_CELL_THRESHOLD }, () => ({ countryCode: "DE" })),
    ];
    const figures = membersByCountry(people, (code) => code);
    for (const figure of figures.filter((item) => !["small", "other", "none"].includes(item.key))) {
      expect(figure.count).toBeGreaterThanOrEqual(SMALL_CELL_THRESHOLD);
    }
    expect(figures.map((figure) => figure.key)).toEqual(["DE", "small"]);
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
