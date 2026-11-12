// Fixtures are synthetic: invented datasets of invented studies and laboratories.
import { DEFAULT_DATASET_WORKFLOW } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { countsText, formatBytes, suggestedDatasetKey } from "./dataset-format";
import {
  buildDatasetRows,
  type DatasetSource,
  DEFAULT_DATASET_STATE,
  filterDatasets,
  parseDatasetState,
  pipelineOf,
  serialiseDatasetState,
  sortDatasets,
} from "./dataset-list";

const source = (id: string, fields: Partial<DatasetSource> = {}): DatasetSource => ({
  id,
  datasetKey: id,
  title: `Synthetic ${id}`,
  replicationId: "DemoAlpha2001",
  laboratoryId: "lab-a",
  modality: "main",
  workflowStatusKey: "received",
  bidsStatus: "notStarted",
  qcStatus: "notStarted",
  availability: "available",
  analysisReady: false,
  dataOrigin: "demo",
  archivedAt: null,
  lastSeenAt: null,
  ...fields,
});

const label = (_replication: string, key: string) =>
  DEFAULT_DATASET_WORKFLOW.states.find((state) => state.key === key)?.label ?? key;

describe("the list of datasets", () => {
  const rows = buildDatasetRows(
    [
      source("beta-main", { laboratoryId: "lab-b", workflowStatusKey: "qcPending", qcStatus: "pending" }),
      source("alpha-main", { lastSeenAt: { toDate: () => new Date("2026-10-01T00:00:00Z") } }),
      source("gamma-rest", { replicationId: "DemoGamma2010", laboratoryId: null, modality: "rest" }),
      source("archived", {
        archivedAt: { seconds: 1, nanoseconds: 0, toDate: () => new Date(1_000), toMillis: () => 1_000 },
      }),
    ],
    new Map([["lab-a", "Synthetic Lab A"]]),
    label,
  );

  it("leaves archived datasets out and names laboratories and states", () => {
    expect(rows.map((row) => row.id)).toEqual(["beta-main", "alpha-main", "gamma-rest"]);
    expect(rows[1]).toMatchObject({ laboratory: "Synthetic Lab A", status: "Received" });
    expect(rows[0]).toMatchObject({ laboratory: "lab-b", status: "QC pending" });
    expect(rows[2]?.laboratory).toBeNull();
  });

  it("filters by search, replication, laboratory, state and QC", () => {
    const filter = (change: Partial<typeof DEFAULT_DATASET_STATE>) =>
      filterDatasets(rows, { ...DEFAULT_DATASET_STATE, ...change }).map((row) => row.id);
    expect(filter({ query: "gamma" })).toEqual(["gamma-rest"]);
    expect(filter({ replication: "DemoAlpha2001" })).toEqual(["beta-main", "alpha-main"]);
    expect(filter({ laboratory: "lab-a" })).toEqual(["alpha-main"]);
    expect(filter({ status: "qcPending" })).toEqual(["beta-main"]);
    expect(filter({ qc: "pending" })).toEqual(["beta-main"]);
  });

  it("sorts with missing values last in either direction", () => {
    expect(sortDatasets(rows, "key", "asc").map((row) => row.id)).toEqual(["alpha-main", "beta-main", "gamma-rest"]);
    expect(sortDatasets(rows, "lastSeen", "desc").map((row) => row.id)[0]).toBe("alpha-main");
    expect(
      sortDatasets(rows, "laboratory", "desc")
        .map((row) => row.id)
        .at(-1),
    ).toBe("gamma-rest");
  });

  it("writes its state into the address and reads it back", () => {
    const state = {
      ...DEFAULT_DATASET_STATE,
      query: "flanker",
      qc: "flagged" as const,
      sort: "status" as const,
      open: "x",
    };
    expect(parseDatasetState(serialiseDatasetState(state))).toEqual(state);
    expect(parseDatasetState(new URLSearchParams("qc=unknown&sort=nothing"))).toEqual(DEFAULT_DATASET_STATE);
  });

  it("counts the pipeline in the order of the workflow, with a state only a replication knows after it", () => {
    const pipeline = pipelineOf(
      [...rows, { statusKey: "custom", status: "Custom state", qcStatus: "passed" }],
      DEFAULT_DATASET_WORKFLOW.states,
    );
    expect(pipeline.stages[0]).toEqual({ key: "received", label: "Received", count: 2 });
    expect(pipeline.stages.find((stage) => stage.key === "qcPending")?.count).toBe(1);
    expect(pipeline.stages.at(-1)).toEqual({ key: "custom", label: "Custom state", count: 1 });
    expect(pipeline.qc).toEqual({ notStarted: 2, pending: 1, passed: 1, flagged: 0, failed: 0 });
  });
});

describe("the words of the registry", () => {
  it("states the counts of a listing, leaving out what has no file", () => {
    expect(countsText({ present: 12, missing: 1 })).toBe("12 present, 1 missing");
    expect(countsText({})).toBe("No files");
  });

  it("gives sizes in decimal units", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(182_400_000)).toBe("182 MB");
    expect(formatBytes(1_500)).toBe("1.5 kB");
  });

  it("suggests a key that the registry accepts", () => {
    expect(suggestedDatasetKey("DemoAlpha2001", "demo-attention-lab", "main")).toBe(
      "DemoAlpha2001-demo-attention-lab-main",
    );
    expect(suggestedDatasetKey("Study", "Lab Café", "rest")).toBe("Study-Lab-Cafe-rest");
    expect(suggestedDatasetKey("Study", null, "mixed")).toBe("Study-mixed");
  });
});
