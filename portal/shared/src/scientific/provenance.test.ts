// A synthetic analysis run over invented datasets.
import { describe, expect, it } from "vitest";
import type { ProcessingRunDoc } from "../schemas/datasets";
import {
  PROVENANCE_EXPORT_FORMAT,
  provenanceJsonLd,
  REPRODUCIBILITY_BUNDLE_FORMAT,
  reproducibilityManifest,
  runExportFileName,
} from "./provenance";
import { at, stamped } from "./test-support";

const run: ProcessingRunDoc = {
  ...stamped("2026-04-01T00:00:00Z"),
  kind: "analysis",
  title: "Confirmatory analysis",
  pipelineName: "synthetic-erp-pipeline",
  version: "1.4.0",
  codeUrl: "https://example.org/code/synthetic-erp-pipeline",
  codeCommit: "0123abc",
  parameters: { highPassHz: 0.1, reference: "average" },
  status: "succeeded",
  startedAt: at("2026-04-01T10:00:00Z"),
  finishedAt: at("2026-04-01T11:00:00Z"),
  runBy: "uid-analyst",
  inputs: [
    {
      datasetId: "SyntheticStudy2001-lab-main",
      storageRefId: "ref-1",
      manifest: {
        manifestId: "m-1",
        fileCount: 40,
        totalSizeBytes: 1_000_000,
        checksumCount: 40,
        listedAt: at("2026-03-30T00:00:00Z"),
      },
    },
    { datasetId: "SyntheticStudy2001-other-main" },
  ],
  inputDatasetIds: ["SyntheticStudy2001-lab-main", "SyntheticStudy2001-other-main"],
  outputs: [{ label: "Main effect", kind: "statistics", checksum: { algorithm: "sha256", value: "ab12" } }],
  outputDatasetIds: [],
  hypothesisIds: ["h01"],
  outputLinkIds: [],
  qcStatus: "passed",
  reproducibilityStatus: "notAttempted",
  replicationId: "SyntheticStudy2001",
  laboratoryId: null,
  scopeKeys: ["rep:SyntheticStudy2001"],
};

const context = {
  runId: "run-1",
  datasets: new Map([
    [
      "SyntheticStudy2001-lab-main",
      {
        title: "Main data",
        replicationId: "SyntheticStudy2001",
        laboratoryId: "lab-1",
        modality: "main" as const,
        dataOrigin: "demo" as const,
      },
    ],
  ]),
  hypotheses: new Map([["h01", { hypothesisNumber: "1" }]]),
  runBy: { name: "Ana Lyst", orcid: "0000-0002-1825-0097" },
  exportedAt: new Date("2026-05-01T00:00:00Z"),
};

describe("provenanceJsonLd", () => {
  it("states the run as a PROV activity that used its datasets, followed its plan and generated its outputs", () => {
    const document = provenanceJsonLd(run, context);
    expect(document["eegml:format"]).toBe(PROVENANCE_EXPORT_FORMAT);
    const graph = document["@graph"] as Record<string, unknown>[];
    const activity = graph.find((node) => node["@type"] === "prov:Activity") as Record<string, unknown>;
    expect(activity["@id"]).toBe("urn:eegml:analysisRun:run-1");
    expect(activity["prov:used"]).toEqual([
      { "@id": "urn:eegml:dataset:SyntheticStudy2001-lab-main" },
      { "@id": "urn:eegml:dataset:SyntheticStudy2001-other-main" },
    ]);
    expect(activity["prov:startedAtTime"]).toBe("2026-04-01T10:00:00.000Z");
    expect(activity["eegml:parameters"]).toEqual({ highPassHz: 0.1, reference: "average" });
    const plan = graph.find((node) => node["schema:name"] === "synthetic-erp-pipeline") as Record<string, unknown>;
    expect(plan["eegml:commit"]).toBe("0123abc");
    const output = graph.find((node) => node["schema:name"] === "Main effect") as Record<string, unknown>;
    expect(output["prov:wasGeneratedBy"]).toEqual({ "@id": "urn:eegml:analysisRun:run-1" });
  });

  it("leaves out what the run does not record, and names a dataset the reader cannot read by its key alone", () => {
    const { codeUrl: _code, startedAt: _started, ...unrecorded } = run;
    const graph = provenanceJsonLd(unrecorded, context)["@graph"] as Record<string, unknown>[];
    const activity = graph.find((node) => node["@type"] === "prov:Activity") as Record<string, unknown>;
    expect(activity).not.toHaveProperty("prov:startedAtTime");
    const unread = graph.find((node) => node["@id"] === "urn:eegml:dataset:SyntheticStudy2001-other-main");
    expect(unread).toEqual({
      "@id": "urn:eegml:dataset:SyntheticStudy2001-other-main",
      "@type": ["prov:Entity", "schema:Dataset"],
      "schema:identifier": "SyntheticStudy2001-other-main",
    });
  });
});

describe("the agent and the origin of the data", () => {
  it("name the person who ran it, with their ORCID iD, never the account, and the origin of each dataset", () => {
    const graph = provenanceJsonLd({ ...run, runByPersonId: "person-ana" }, context)["@graph"] as Record<
      string,
      unknown
    >[];
    const activity = graph.find((node) => node["@type"] === "prov:Activity") as Record<string, unknown>;
    expect(activity["prov:wasAssociatedWith"]).toEqual({ "@id": "urn:eegml:person:person-ana" });
    expect(graph.find((node) => node["@id"] === "urn:eegml:person:person-ana")).toEqual({
      "@id": "urn:eegml:person:person-ana",
      "@type": ["prov:Agent", "schema:Person"],
      "schema:name": "Ana Lyst",
      "schema:identifier": "https://orcid.org/0000-0002-1825-0097",
    });
    expect(JSON.stringify(graph)).not.toContain("urn:eegml:account");
    expect(graph.find((node) => node["@id"] === "urn:eegml:dataset:SyntheticStudy2001-lab-main")).toMatchObject({
      "eegml:dataOrigin": "demo",
    });
    expect(reproducibilityManifest(run, context).origins).toEqual(["demo"]);
  });

  it("give the files of a run the names of its replication and its title", () => {
    expect(
      runExportFileName(
        { replicationId: "DemoAlpha2001", title: "Main ERP analysis (synthetic)", pipelineName: "x" },
        "provenance.jsonld",
      ),
    ).toBe("DemoAlpha2001-main-erp-analysis-synthetic-provenance.jsonld");
  });
});

describe("reproducibilityManifest", () => {
  it("lists the code, the inputs with their listings and what is missing", () => {
    const manifest = reproducibilityManifest(run, context);
    expect(manifest.format).toBe(REPRODUCIBILITY_BUNDLE_FORMAT);
    expect(manifest.code).toEqual({
      pipeline: "synthetic-erp-pipeline",
      version: "1.4.0",
      repository: "https://example.org/code/synthetic-erp-pipeline",
      commit: "0123abc",
    });
    expect((manifest.inputs as Record<string, unknown>[])[0]?.listing).toMatchObject({ fileCount: 40 });
    expect(manifest.missing).toEqual(["a listing of every input dataset", "environment"]);
  });
});
