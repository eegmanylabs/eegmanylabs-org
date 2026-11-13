// Provenance and reproducibility exports of an analysis run (requirement R12.11). The export is
// computed from the documents the reader may read, so it says nothing that the portal does not
// hold: an unknown value is left out, never filled in.
//
// | Export                      | Format                                                                 |
// |-----------------------------|------------------------------------------------------------------------|
// | Provenance                  | JSON-LD in the W3C PROV-O vocabulary, with schema.org for code and data |
// | Reproducibility bundle      | The documented JSON of `REPRODUCIBILITY_BUNDLE_FORMAT`, which lists what a bundle holds |
//
// Records are named by URNs of the form `urn:eegml:<kind>:<identifier>`, because a record of the
// portal has no public address.
import type { AnalysisRunInput, AnalysisRunOutput, DatasetDoc, ProcessingRunDoc } from "../schemas/datasets";
import type { ReplicationHypothesisDoc } from "../schemas/replications";
import { isFirestoreTimestamp } from "../timestamp";

/** The version of the documented format of a reproducibility bundle's manifest. */
export const REPRODUCIBILITY_BUNDLE_FORMAT = "eegml-reproducibility-bundle/1";
/** The version of the provenance export. */
export const PROVENANCE_EXPORT_FORMAT = "eegml-provenance/1";

export const urn = (kind: string, id: string) => `urn:eegml:${kind}:${encodeURIComponent(id)}`;

const instant = (value: unknown): string | undefined =>
  isFirestoreTimestamp(value) ? new Date(value.toMillis()).toISOString() : undefined;

/** What an export reads beside the run: the datasets and hypotheses it names, as far as the reader may read them. */
export interface ProvenanceContext {
  readonly runId: string;
  readonly datasets: ReadonlyMap<
    string,
    Pick<DatasetDoc, "title" | "replicationId" | "laboratoryId" | "modality"> & Partial<Pick<DatasetDoc, "dataOrigin">>
  >;
  readonly hypotheses: ReadonlyMap<string, Pick<ReplicationHypothesisDoc, "hypothesisNumber">>;
  /** The person who ran it, where the run names one and the reader may read the directory. */
  readonly runBy: { readonly name: string | null; readonly orcid: string | null } | null;
  /** When the export is made. */
  readonly exportedAt: Date;
}

type Run = Omit<ProcessingRunDoc, "writeContext">;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** Drops the keys whose value is undefined, so that an unknown value is absent and never null or empty. */
function defined(entries: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as JsonObject;
}

/** A free map of the run as JSON: values that are no JSON are left out. */
function jsonMap(map: Readonly<Record<string, unknown>> | undefined): JsonObject | undefined {
  if (map === undefined) return undefined;
  const entries = Object.entries(map).filter(
    ([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean",
  );
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as JsonObject);
}

function planOf(run: Run): JsonObject {
  return defined({
    "@id": urn("pipeline", `${run.pipelineName}@${run.version ?? "unversioned"}`),
    "@type": ["prov:Plan", "schema:SoftwareSourceCode"],
    "schema:name": run.pipelineName,
    "schema:version": run.version,
    "schema:codeRepository": run.codeUrl,
    "eegml:commit": run.codeCommit,
  });
}

function inputOf(input: AnalysisRunInput, context: ProvenanceContext): JsonObject {
  const dataset = context.datasets.get(input.datasetId);
  return defined({
    "@id": urn("dataset", input.datasetId),
    "@type": ["prov:Entity", "schema:Dataset"],
    "schema:identifier": input.datasetId,
    "schema:name": dataset?.title,
    "eegml:replication": dataset === undefined ? undefined : urn("replication", dataset.replicationId),
    "eegml:laboratory": dataset?.laboratoryId == null ? undefined : urn("laboratory", dataset.laboratoryId),
    "eegml:modality": dataset?.modality,
    "eegml:dataOrigin": dataset?.dataOrigin,
    "eegml:copy":
      input.storageRefId === undefined ? undefined : urn("storageRef", `${input.datasetId}/${input.storageRefId}`),
    "eegml:listing":
      input.manifest === undefined
        ? undefined
        : defined({
            "@id": urn("manifest", `${input.datasetId}/${input.manifest.manifestId}`),
            "eegml:fileCount": input.manifest.fileCount,
            "eegml:totalSizeBytes": input.manifest.totalSizeBytes,
            "eegml:filesWithChecksum": input.manifest.checksumCount,
            "prov:generatedAtTime": instant(input.manifest.listedAt),
          }),
  });
}

function outputOf(output: AnalysisRunOutput, index: number, runId: string): JsonObject {
  return defined({
    "@id": urn("output", `${runId}/${index + 1}`),
    "@type": "prov:Entity",
    "schema:name": output.label,
    "eegml:kind": output.kind,
    "schema:contentUrl": output.uri,
    "eegml:checksum":
      output.checksum === undefined
        ? undefined
        : { "eegml:algorithm": output.checksum.algorithm, "eegml:value": output.checksum.value },
    "prov:wasGeneratedBy": { "@id": urn("analysisRun", runId) },
  });
}

/**
 * The provenance of a run as JSON-LD in PROV-O: the run is an activity that used its input
 * datasets, followed its pipeline as a plan, was associated with the person who ran it and
 * generated its outputs. The hypotheses it tests, its parameters, its environment, its quality
 * control and its reproducibility are stated in the portal's own terms.
 */
export function provenanceJsonLd(run: Run, context: ProvenanceContext): JsonObject {
  const activityId = urn("analysisRun", context.runId);
  const plan = planOf(run);
  // The agent is the person, whom someone outside the portal can recognise by name and ORCID iD,
  // and never the account, whose identifier means nothing outside it.
  const agent =
    run.runByPersonId === undefined
      ? undefined
      : defined({
          "@id": urn("person", run.runByPersonId),
          "@type": ["prov:Agent", "schema:Person"],
          "schema:name": context.runBy?.name ?? undefined,
          "schema:identifier": context.runBy?.orcid == null ? undefined : `https://orcid.org/${context.runBy.orcid}`,
        });
  const activity = defined({
    "@id": activityId,
    "@type": "prov:Activity",
    "schema:name": run.title ?? run.pipelineName,
    "eegml:kind": run.kind,
    "eegml:status": run.status,
    "prov:startedAtTime": instant(run.startedAt),
    "prov:endedAtTime": instant(run.finishedAt),
    "prov:used": run.inputs.map((input) => ({ "@id": urn("dataset", input.datasetId) })),
    "prov:wasAssociatedWith": agent === undefined ? undefined : { "@id": agent["@id"] as string },
    "prov:qualifiedAssociation": defined({
      "@type": "prov:Association",
      "prov:agent": agent === undefined ? undefined : { "@id": agent["@id"] as string },
      "prov:hadPlan": { "@id": plan["@id"] as string },
    }),
    "eegml:replication": run.replicationId === null ? undefined : urn("replication", run.replicationId),
    "eegml:laboratory": run.laboratoryId === null ? undefined : urn("laboratory", run.laboratoryId),
    "eegml:tests": run.hypothesisIds.map((id) =>
      defined({
        "@id": urn("hypothesis", run.replicationId === null ? id : `${run.replicationId}/${id}`),
        "schema:name":
          context.hypotheses.get(id) === undefined
            ? undefined
            : `Hypothesis ${context.hypotheses.get(id)?.hypothesisNumber}`,
      }),
    ),
    "eegml:parameters": jsonMap(run.parameters),
    "eegml:environment": jsonMap(run.environment),
    "eegml:qualityControl": defined({ "eegml:status": run.qcStatus, "eegml:notes": run.qcNotes }),
    "eegml:reproducibility": defined({
      "eegml:status": run.reproducibilityStatus,
      "eegml:reproduces": run.reproducesRunId === undefined ? undefined : urn("analysisRun", run.reproducesRunId),
      "eegml:notes": run.reproducibilityNotes,
    }),
  });
  return {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      schema: "https://schema.org/",
      eegml: "urn:eegml:vocabulary:",
    },
    "eegml:format": PROVENANCE_EXPORT_FORMAT,
    "eegml:exportedAt": context.exportedAt.toISOString(),
    "@graph": [
      activity,
      plan,
      ...(agent === undefined ? [] : [agent]),
      ...run.inputs.map((input) => inputOf(input, context)),
      ...run.outputs.map((output, index) => outputOf(output, index, context.runId)),
    ],
  };
}

/**
 * The manifest of a reproducibility bundle, in the documented format `REPRODUCIBILITY_BUNDLE_FORMAT`.
 * A bundle is what someone needs to run the analysis again: the code at its commit, the
 * pipeline and its version, the parameters and the environment, and the input datasets with the
 * listing each was read from. The manifest names the files of the bundle, `provenance.jsonld`
 * among them, and lists in `missing` what the run does not record, so that a gap is visible.
 */
export function reproducibilityManifest(run: Run, context: ProvenanceContext): JsonObject {
  const missing = [
    ...(run.codeUrl === undefined ? ["code repository"] : []),
    ...(run.codeCommit === undefined ? ["commit"] : []),
    ...(run.version === undefined ? ["pipeline version"] : []),
    ...(run.inputs.length === 0 ? ["input datasets"] : []),
    ...(run.inputs.some((input) => input.manifest === undefined) ? ["a listing of every input dataset"] : []),
    ...(run.environment === undefined ? ["environment"] : []),
  ];
  const origins = [
    ...new Set(
      run.inputs.flatMap((input) => {
        const origin = context.datasets.get(input.datasetId)?.dataOrigin;
        return origin === undefined ? [] : [origin];
      }),
    ),
  ].sort();
  return {
    format: REPRODUCIBILITY_BUNDLE_FORMAT,
    exportedAt: context.exportedAt.toISOString(),
    // Where the input data comes from: `demo`, `projected` or `importedHistorical` data is no
    // live record, which whoever reads the bundle must be told.
    origins,
    run: defined({
      id: context.runId,
      title: run.title,
      kind: run.kind,
      status: run.status,
      replicationId: run.replicationId ?? undefined,
      laboratoryId: run.laboratoryId ?? undefined,
      startedAt: instant(run.startedAt),
      finishedAt: instant(run.finishedAt),
    }),
    code: defined({
      pipeline: run.pipelineName,
      version: run.version,
      repository: run.codeUrl,
      commit: run.codeCommit,
    }),
    parameters: jsonMap(run.parameters) ?? {},
    environment: jsonMap(run.environment) ?? {},
    inputs: run.inputs.map((input) =>
      defined({
        datasetKey: input.datasetId,
        title: context.datasets.get(input.datasetId)?.title,
        dataOrigin: context.datasets.get(input.datasetId)?.dataOrigin,
        storageRefId: input.storageRefId,
        listing:
          input.manifest === undefined
            ? undefined
            : defined({
                manifestId: input.manifest.manifestId,
                fileCount: input.manifest.fileCount,
                totalSizeBytes: input.manifest.totalSizeBytes,
                filesWithChecksum: input.manifest.checksumCount,
                listedAt: instant(input.manifest.listedAt),
              }),
      }),
    ),
    outputs: run.outputs.map((output) =>
      defined({
        label: output.label,
        kind: output.kind,
        uri: output.uri,
        checksum: output.checksum === undefined ? undefined : { ...output.checksum },
      }),
    ),
    hypotheses: run.hypothesisIds.map((id) => id),
    qualityControl: defined({ status: run.qcStatus, notes: run.qcNotes }),
    reproducibility: defined({
      status: run.reproducibilityStatus,
      reproducesRunId: run.reproducesRunId,
      notes: run.reproducibilityNotes,
    }),
    files: [
      { path: "manifest.json", describes: "This manifest." },
      { path: "provenance.jsonld", describes: `The provenance of the run in PROV-O (${PROVENANCE_EXPORT_FORMAT}).` },
    ],
    missing,
  };
}

/**
 * The name of an export file of a run: its replication and the slug of its title, which say what
 * the file is about outside the portal, and never the run's internal identifier alone.
 */
export function runExportFileName(run: Pick<Run, "replicationId" | "title" | "pipelineName">, suffix: string): string {
  const slug = (run.title ?? run.pipelineName)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return [run.replicationId, slug === "" ? "analysis-run" : slug, suffix].filter((part) => part !== null).join("-");
}
