// Synthetic participations only.
import { describe, expect, it } from "vitest";
import { buildMatrix, parseReadinessState, progressByParticipation, serialiseReadinessState } from "./readiness";

const participations = [
  {
    id: "S1__lab-a",
    replicationId: "S1",
    laboratoryId: "lab-a",
    status: "onboarding",
    readinessStatus: "inProgress",
    dataOrigin: "demo",
  },
  {
    id: "S2__lab-a",
    replicationId: "S2",
    laboratoryId: "lab-a",
    status: "ready",
    readinessStatus: "approved",
    dataOrigin: "demo",
  },
  {
    id: "S1__lab-b",
    replicationId: "S1",
    laboratoryId: "lab-b",
    status: "invited",
    readinessStatus: "notStarted",
    dataOrigin: "demo",
  },
] as const;
const laboratories = new Map([
  ["lab-a", { name: "Alpha Lab", countryCode: "GB" }],
  ["lab-b", { name: "Beta Lab", countryCode: null }],
]);

describe("the readiness matrix", () => {
  it("puts laboratories by replications, with the progress the viewer may read", () => {
    const progress = progressByParticipation([
      { participationId: "S1__lab-a", status: "done", archivedAt: null },
      { participationId: "S1__lab-a", status: "notApplicable", archivedAt: null },
      { participationId: "S1__lab-a", status: "blocked", archivedAt: null },
      { participationId: "S1__lab-a", status: "done", archivedAt: "archived" },
    ]);
    const { columns, rows } = buildMatrix({
      participations,
      laboratories,
      progress,
      state: { replication: null, country: null, status: null },
    });
    expect(columns).toEqual(["S1", "S2"]);
    expect(rows.map((row) => row.name)).toEqual(["Alpha Lab", "Beta Lab"]);
    expect(rows[0]?.cells.get("S1")?.progress).toEqual({ settled: 2, total: 3 });
    expect(rows[1]?.cells.get("S1")?.progress).toBeNull();
    expect(rows[1]?.cells.has("S2")).toBe(false);
  });

  it("filters by replication, country and status", () => {
    const only = (state: { replication: string | null; country: string | null; status: "invited" | null }) =>
      buildMatrix({ participations, laboratories, progress: new Map(), state }).rows.map((row) => row.laboratoryId);
    expect(only({ replication: "S2", country: null, status: null })).toEqual(["lab-a"]);
    expect(only({ replication: null, country: "GB", status: null })).toEqual(["lab-a"]);
    expect(only({ replication: null, country: null, status: "invited" })).toEqual(["lab-b"]);
  });

  it("keeps its state in the address and ignores a status it does not know", () => {
    const state = { replication: "S1", country: "GB", status: "ready" as const, open: "S1__lab-a" };
    expect(parseReadinessState(serialiseReadinessState(state))).toEqual(state);
    expect(parseReadinessState(new URLSearchParams("status=finished")).status).toBeNull();
  });
});
