// Synthetic laboratories only.
import { describe, expect, it } from "vitest";
import {
  buildLaboratoryRows,
  DEFAULT_LABORATORY_STATE,
  filterLaboratories,
  laboratoryFilterOptions,
  parseLaboratoryState,
  serialiseLaboratoryState,
  sortLaboratories,
} from "./laboratory-list";

const rows = buildLaboratoryRows({
  laboratories: [
    {
      id: "lab-b",
      name: "Beta Lab",
      institutionId: "inst-1",
      countryCode: "DE",
      city: "Bonn",
      status: "active",
      dataOrigin: "live",
      archivedAt: null,
    },
    {
      id: "lab-a",
      name: "Alpha Lab",
      institutionId: "inst-2",
      countryCode: "GB",
      status: "unverified",
      piPersonId: "p-1",
      dataOrigin: "demo",
      archivedAt: null,
    },
    { id: "lab-c", name: "Gamma Lab", status: "active", dataOrigin: "live", archivedAt: null },
    { id: "lab-x", name: "Archived Lab", status: "inactive", dataOrigin: "live", archivedAt: "archived" },
  ],
  institutionNames: new Map([["inst-1", "Example University"]]),
  personNames: new Map([["p-1", "Ada Example"]]),
  replicationsOf: new Map([["lab-b", ["Study2002", "Study2001"]]]),
  countryName: (code) => (code === "DE" ? "Germany" : "United Kingdom"),
});

describe("the list of laboratories", () => {
  it("leaves out archived laboratories and shows an unknown as unknown", () => {
    expect(rows.map((row) => row.id)).toEqual(["lab-b", "lab-a", "lab-c"]);
    expect(rows[1]).toMatchObject({ institution: "inst-2", principalInvestigator: "Ada Example", city: null });
    expect(rows[0]?.replicationIds).toEqual(["Study2001", "Study2002"]);
  });

  it("searches, filters by country and by replication, and sorts unknowns last either way", () => {
    expect(filterLaboratories(rows, { ...DEFAULT_LABORATORY_STATE, query: "example" }).map((row) => row.id)).toEqual([
      "lab-b",
    ]);
    expect(filterLaboratories(rows, { ...DEFAULT_LABORATORY_STATE, country: "GB" }).map((row) => row.id)).toEqual([
      "lab-a",
    ]);
    expect(
      filterLaboratories(rows, { ...DEFAULT_LABORATORY_STATE, replication: "Study2001" }).map((row) => row.id),
    ).toEqual(["lab-b"]);
    expect(sortLaboratories(rows, "city", "asc").map((row) => row.id)).toEqual(["lab-b", "lab-a", "lab-c"]);
    expect(sortLaboratories(rows, "country", "desc").map((row) => row.id)).toEqual(["lab-a", "lab-b", "lab-c"]);
    expect(sortLaboratories(rows, "name", "asc").map((row) => row.id)).toEqual(["lab-a", "lab-b", "lab-c"]);
  });

  it("keeps its state in the address, without the defaults", () => {
    const state = { ...DEFAULT_LABORATORY_STATE, query: "lab", country: "DE", open: "lab-b", sort: "city" as const };
    const params = serialiseLaboratoryState(state);
    expect(params.toString()).toBe("q=lab&country=DE&sort=city&open=lab-b");
    expect(parseLaboratoryState(params)).toEqual(state);
    expect(parseLaboratoryState(new URLSearchParams("sort=nonsense&dir=sideways"))).toEqual(DEFAULT_LABORATORY_STATE);
  });

  it("offers the countries and replications that occur", () => {
    expect(laboratoryFilterOptions(rows)).toEqual({
      countries: [
        { code: "DE", name: "Germany" },
        { code: "GB", name: "United Kingdom" },
      ],
      replications: ["Study2001", "Study2002"],
    });
  });
});
