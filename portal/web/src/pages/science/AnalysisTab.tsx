// The analysis runs of a replication (requirements R12.5 and R12.11): the code and pipeline of
// each, its parameters, the datasets of the registry it read with the listing of each copy, what
// it produced, its quality control and whether it has been reproduced. A run opens in a side
// panel, from which its provenance is exported as JSON-LD and the manifest of its
// reproducibility bundle as documented JSON.
import {
  type CallableInput,
  type ProcessingRunDoc,
  provenanceJsonLd,
  reproducibilityManifest,
  runExportFileName,
  saveAnalysisRunContract,
} from "@eegml/shared";
import { type FormEvent, useMemo, useState } from "react";
import { type RecordColumn, RecordTable } from "@/components/record-table";
import { Detail, Details } from "@/components/registry/details";
import { SidePanel } from "@/components/registry/side-panel";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SortDirection } from "@/components/ui/sort-header";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, useLiveDocument, useLiveQuery } from "@/data";
import { storageRefsOf } from "@/registry/dataset-queries";
import { replicationPath } from "@/registry/paths";
import type { Viewer } from "@/registry/viewer";
import { downloadText } from "@/utils/download";
import {
  namedValuesText,
  OUTPUT_KIND_LABELS,
  parseNamedValues,
  REPRODUCIBILITY_LABELS,
  RUN_KIND_LABELS,
  RUN_QC_LABELS,
  RUN_STATUS_LABELS,
  readableInstant,
} from "./science-format";

type Run = RecordOf<"processingRuns">;
type RunSortKey = "title" | "status" | "finished";

const COLUMNS: readonly RecordColumn<Run, RunSortKey>[] = [
  { id: "title", header: "Run", sortKey: "title", className: "min-w-56", cell: (run) => run.title ?? run.pipelineName },
  {
    id: "pipeline",
    header: "Pipeline",
    cell: (run) => `${run.pipelineName}${run.version === undefined ? "" : ` ${run.version}`}`,
  },
  { id: "status", header: "Status", sortKey: "status", cell: (run) => RUN_STATUS_LABELS[run.status] },
  { id: "qc", header: "QC", cell: (run) => RUN_QC_LABELS[run.qcStatus] },
  {
    id: "reproducibility",
    header: "Reproducibility",
    cell: (run) => REPRODUCIBILITY_LABELS[run.reproducibilityStatus],
  },
  {
    id: "finished",
    header: "Finished",
    sortKey: "finished",
    // A run that ended without a recorded time has finished all the same.
    cell: (run) =>
      run.finishedAt !== undefined ? (
        readableInstant(run.finishedAt)
      ) : run.status === "planned" || run.status === "running" ? (
        <Unknown>Not finished</Unknown>
      ) : (
        <Unknown>Not recorded</Unknown>
      ),
  },
];

function sortRuns(runs: readonly Run[], key: RunSortKey, direction: SortDirection): Run[] {
  const sign = direction === "asc" ? 1 : -1;
  const value = (run: Run) =>
    key === "title"
      ? (run.title ?? run.pipelineName)
      : key === "status"
        ? run.status
        : (run.finishedAt?.toMillis() ?? 0);
  return [...runs].sort((a, b) => {
    const first = value(a);
    const second = value(b);
    return (
      sign *
      (typeof first === "number" && typeof second === "number"
        ? first - second
        : String(first).localeCompare(String(second)))
    );
  });
}

export function AnalysisTab({
  studyKey,
  viewer,
  runs,
  datasets,
  hypotheses,
}: {
  studyKey: string;
  viewer: Viewer;
  runs: readonly Run[];
  datasets: readonly RecordOf<"datasets">[];
  hypotheses: readonly RecordOf<"replicationHypotheses">[];
}) {
  const [sort, setSort] = useState<{ key: RunSortKey; direction: SortDirection }>({
    key: "finished",
    direction: "desc",
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Run | "new" | null>(null);
  const canRecord =
    viewer.access.member &&
    (viewer.can("datasets.manage", { replicationId: studyKey }) ||
      viewer.can("replications.manage", { replicationId: studyKey }));
  const current = runs.filter((run) => run.archivedAt === null);
  const sorted = sortRuns(current, sort.key, sort.direction);
  const open = current.find((run) => run.id === openId) ?? null;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-secondary">
          Each run states its code, pipeline, parameters and the datasets it read, so that it can be run again.
        </p>
        {canRecord ? (
          <Button variant="primary" onClick={() => setEditing("new")}>
            Record an analysis run
          </Button>
        ) : null}
      </div>
      {sorted.length === 0 ? (
        <EmptyState
          title="No analysis runs yet"
          description="A run is recorded once it is planned or has run, with the datasets it reads."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <RecordTable
            caption="Analysis runs of the replication"
            rows={sorted}
            columns={COLUMNS}
            rowKey={(run) => run.id}
            rowLabel={(run) => run.title ?? run.pipelineName}
            sortKey={sort.key}
            direction={sort.direction}
            onSort={(key) =>
              setSort((previous) => ({
                key,
                direction: previous.key === key && previous.direction === "asc" ? "desc" : "asc",
              }))
            }
            onOpen={(run) => setOpenId(run.id)}
            openKey={openId}
            data-testid="analysis-runs"
          />
          {open === null ? null : (
            <SidePanel
              title={open.title ?? open.pipelineName}
              fullPage={`${replicationPath(studyKey)}?tab=analysis`}
              onClose={() => setOpenId(null)}
            >
              <RunDetails
                run={open}
                datasets={datasets}
                hypotheses={hypotheses}
                canEdit={canRecord}
                onEdit={() => setEditing(open)}
              />
            </SidePanel>
          )}
        </div>
      )}
      {editing === null ? null : (
        <RunDialog
          studyKey={studyKey}
          viewer={viewer}
          run={editing === "new" ? null : editing}
          runs={current}
          datasets={datasets.filter((dataset) => dataset.archivedAt === null)}
          hypotheses={hypotheses.filter((hypothesis) => hypothesis.archivedAt === null)}
          onClose={() => setEditing(null)}
          onSaved={(runId) => setOpenId(runId)}
        />
      )}
    </div>
  );
}

function RunDetails({
  run,
  datasets,
  hypotheses,
  canEdit,
  onEdit,
}: {
  run: Run;
  datasets: readonly RecordOf<"datasets">[];
  hypotheses: readonly RecordOf<"replicationHypotheses">[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  // The person who ran it, from the directory that every member reads, for the provenance agent.
  const runner = useLiveDocument("persons", run.runByPersonId === undefined ? null : [run.runByPersonId]);
  const person = runner.status === "ready" ? runner.data : null;
  const context = () => ({
    runId: run.id,
    datasets: new Map(datasets.map((dataset) => [dataset.id, dataset])),
    hypotheses: new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis])),
    runBy: person === null ? null : { name: person.displayName, orcid: person.orcid ?? null },
    exportedAt: new Date(),
  });
  const document = run as unknown as ProcessingRunDoc;
  return (
    <div className="grid gap-4" data-testid="analysis-run">
      <Details>
        <Detail term="Kind">{RUN_KIND_LABELS[run.kind]}</Detail>
        <Detail term="Status">{RUN_STATUS_LABELS[run.status]}</Detail>
        <Detail term="Pipeline">{`${run.pipelineName}${run.version === undefined ? "" : `, version ${run.version}`}`}</Detail>
        <Detail term="Code">
          {run.codeUrl === undefined ? (
            <Unknown />
          ) : (
            <a
              href={run.codeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-fg-accent underline"
            >
              {run.codeUrl}
            </a>
          )}
        </Detail>
        <Detail term="Commit">{run.codeCommit ?? <Unknown />}</Detail>
        <Detail term="Parameters">
          {run.parameters === undefined ? (
            <Unknown>None stated</Unknown>
          ) : (
            <pre className="whitespace-pre-wrap">{namedValuesText(run.parameters)}</pre>
          )}
        </Detail>
        <Detail term="Environment">
          {run.environment === undefined ? (
            <Unknown>None stated</Unknown>
          ) : (
            <pre className="whitespace-pre-wrap">{namedValuesText(run.environment)}</pre>
          )}
        </Detail>
        <Detail term="Input datasets">
          {run.inputs.length === 0 ? (
            <Unknown>None</Unknown>
          ) : (
            <ul className="grid gap-1">
              {run.inputs.map((input) => (
                <li key={input.datasetId}>
                  {input.datasetId}
                  {input.manifest === undefined
                    ? " (no listing of the copy)"
                    : ` (${input.manifest.fileCount} files listed on ${readableInstant(input.manifest.listedAt)})`}
                </li>
              ))}
            </ul>
          )}
        </Detail>
        <Detail term="Outputs">
          {run.outputs.length === 0 ? (
            <Unknown>None</Unknown>
          ) : (
            <ul className="grid gap-1">
              {run.outputs.map((output) => (
                <li key={`${output.label}-${output.kind}`}>
                  {output.label} ({OUTPUT_KIND_LABELS[output.kind].toLowerCase()})
                </li>
              ))}
            </ul>
          )}
        </Detail>
        <Detail term="Hypotheses tested">
          {run.hypothesisIds.length === 0 ? <Unknown>None</Unknown> : run.hypothesisIds.join(", ")}
        </Detail>
        <Detail term="Quality control">
          <span className="flex flex-wrap items-center gap-2">
            {run.qcStatus === "flagged" || run.qcStatus === "failed" ? (
              <Badge tone="accent">{RUN_QC_LABELS[run.qcStatus]}</Badge>
            ) : (
              RUN_QC_LABELS[run.qcStatus]
            )}
            {run.qcNotes ?? null}
          </span>
        </Detail>
        <Detail term="Reproducibility">
          {REPRODUCIBILITY_LABELS[run.reproducibilityStatus]}
          {run.reproducibilityNotes === undefined ? "" : `. ${run.reproducibilityNotes}`}
        </Detail>
      </Details>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            downloadText(
              runExportFileName(run, "provenance.jsonld"),
              `${JSON.stringify(provenanceJsonLd(document, context()), null, 2)}\n`,
              "application/ld+json",
            )
          }
        >
          Export provenance (JSON-LD)
        </Button>
        <Button
          size="sm"
          onClick={() =>
            downloadText(
              runExportFileName(run, "bundle-manifest.json"),
              `${JSON.stringify(reproducibilityManifest(document, context()), null, 2)}\n`,
              "application/json",
            )
          }
        >
          Export bundle manifest
        </Button>
        {canEdit ? (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Change the run
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type RunInput = CallableInput<typeof saveAnalysisRunContract>;

/** One line of an output: `label | kind | address`, where the kind and the address may be left out. */
function parseOutputs(text: string): RunInput["outputs"] | null {
  const outputs: RunInput["outputs"] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const [label = "", kind = "other", uri = ""] = line.split("|").map((part) => part.trim());
    if (label === "" || !(kind in OUTPUT_KIND_LABELS)) return null;
    outputs.push({ label, kind: kind as keyof typeof OUTPUT_KIND_LABELS, ...(uri === "" ? {} : { uri }) });
  }
  return outputs;
}

const isoOrNull = (local: string) => (local === "" ? null : new Date(local).toISOString());
const localOf = (instant: { toDate(): Date } | undefined) =>
  instant === undefined
    ? ""
    : new Date(instant.toDate().getTime() - instant.toDate().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function RunDialog({
  studyKey,
  viewer,
  run,
  runs,
  datasets,
  hypotheses,
  onClose,
  onSaved,
}: {
  studyKey: string;
  viewer: Viewer;
  run: Run | null;
  runs: readonly Run[];
  datasets: readonly RecordOf<"datasets">[];
  hypotheses: readonly RecordOf<"replicationHypotheses">[];
  onClose: () => void;
  onSaved: (runId: string) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(run?.title ?? "");
  const [kind, setKind] = useState<RunInput["kind"]>(run?.kind ?? "analysis");
  const [pipelineName, setPipelineName] = useState(run?.pipelineName ?? "");
  const [version, setVersion] = useState(run?.version ?? "");
  const [codeUrl, setCodeUrl] = useState(run?.codeUrl ?? "");
  const [codeCommit, setCodeCommit] = useState(run?.codeCommit ?? "");
  const [parameters, setParameters] = useState(namedValuesText(run?.parameters));
  const [environment, setEnvironment] = useState(namedValuesText(run?.environment));
  const [status, setStatus] = useState<RunInput["status"]>(run?.status ?? "succeeded");
  const [startedAt, setStartedAt] = useState(localOf(run?.startedAt));
  const [finishedAt, setFinishedAt] = useState(localOf(run?.finishedAt));
  const [inputs, setInputs] = useState<RunInput["inputs"]>(
    run?.inputs.map((input) => ({ datasetId: input.datasetId, storageRefId: input.storageRefId ?? null })) ?? [],
  );
  const [adding, setAdding] = useState(datasets[0]?.id ?? "");
  const [outputs, setOutputs] = useState(
    run?.outputs.map((output) => [output.label, output.kind, output.uri ?? ""].join(" | ")).join("\n") ?? "",
  );
  const [tested, setTested] = useState<readonly string[]>(run?.hypothesisIds ?? []);
  const [qcStatus, setQcStatus] = useState<RunInput["qcStatus"]>(run?.qcStatus ?? "notAssessed");
  const [qcNotes, setQcNotes] = useState(run?.qcNotes ?? "");
  const [reproducibilityStatus, setReproducibilityStatus] = useState<RunInput["reproducibilityStatus"]>(
    run?.reproducibilityStatus ?? "notAttempted",
  );
  const [reproducesRunId, setReproducesRunId] = useState(run?.reproducesRunId ?? "");
  const [reproducibilityNotes, setReproducibilityNotes] = useState(run?.reproducibilityNotes ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = viewer.staff ? "all" : viewer.queryScopeKeys;
  const lastInput = inputs.at(-1);
  const refs = useLiveQuery(lastInput === undefined ? null : storageRefsOf(lastInput.datasetId, scope));
  const copies = useMemo(
    () =>
      refs.status === "ready"
        ? refs.data.filter((ref) => ref.validTo === null && ref.archivedAt === null)
        : ([] as RecordOf<"datasetStorageRefs">[]),
    [refs],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedParameters = parseNamedValues(parameters);
    const parsedEnvironment = parseNamedValues(environment);
    const parsedOutputs = parseOutputs(outputs);
    if (pipelineName.trim() === "") return setFailure("Name the pipeline.");
    if (parsedParameters === null || parsedEnvironment === null) {
      return setFailure("Write the parameters and the environment as one name, a colon and a value on each line.");
    }
    if (parsedOutputs === null) {
      return setFailure("Write each output as a label, then optionally | a kind | an address.");
    }
    setBusy(true);
    setFailure(null);
    try {
      const { runId } = await callFunction(saveAnalysisRunContract, {
        runId: run?.id ?? null,
        replicationId: studyKey,
        laboratoryId: run?.laboratoryId ?? null,
        kind,
        title: title.trim() === "" ? null : title.trim(),
        pipelineName: pipelineName.trim(),
        version: version.trim() === "" ? null : version.trim(),
        codeUrl: codeUrl.trim() === "" ? null : codeUrl.trim(),
        codeCommit: codeCommit.trim() === "" ? null : codeCommit.trim(),
        parameters: parsedParameters,
        environment: parsedEnvironment,
        status,
        startedAt: isoOrNull(startedAt),
        finishedAt: isoOrNull(finishedAt),
        inputs,
        outputs: parsedOutputs,
        hypothesisIds: [...tested],
        qcStatus,
        qcNotes: qcNotes.trim() === "" ? null : qcNotes.trim(),
        reproducibilityStatus,
        reproducesRunId: reproducesRunId === "" ? null : reproducesRunId,
        reproducibilityNotes: reproducibilityNotes.trim() === "" ? null : reproducibilityNotes.trim(),
      });
      toast.show({ title: run === null ? "Analysis run recorded." : "Analysis run saved." });
      onSaved(runId);
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The run could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const text = (label: string, value: string, set: (value: string) => void, hint?: string, type = "text") => (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => <Input {...control} type={type} value={value} onChange={(event) => set(event.target.value)} />}
    </FormField>
  );

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title={run === null ? "Record an analysis run" : "Change the analysis run"}
        description="State what the run used and produced. The datasets come from the registry, and the listing of each copy is kept as it stands now."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {text("Title", title, setTitle, "Optional. The pipeline names the run where there is none.")}
          <FormField label="Kind">
            {(control) => (
              <Select {...control} value={kind} onChange={(event) => setKind(event.target.value as RunInput["kind"])}>
                {Object.entries(RUN_KIND_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {text("Pipeline", pipelineName, setPipelineName)}
          {text("Pipeline version", version, setVersion)}
          {text("Code repository", codeUrl, setCodeUrl, "The address of the repository.", "url")}
          {text("Commit", codeCommit, setCodeCommit, "The commit hash, 7 to 64 hexadecimal characters.")}
          <FormField label="Parameters" hint="One name, a colon and a value on each line.">
            {(control) => (
              <Textarea {...control} value={parameters} onChange={(event) => setParameters(event.target.value)} />
            )}
          </FormField>
          <FormField label="Environment" hint="For example: python: 3.12">
            {(control) => (
              <Textarea {...control} value={environment} onChange={(event) => setEnvironment(event.target.value)} />
            )}
          </FormField>
          <FormField label="Status">
            {(control) => (
              <Select
                {...control}
                value={status}
                onChange={(event) => setStatus(event.target.value as RunInput["status"])}
              >
                {Object.entries(RUN_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {text("Started", startedAt, setStartedAt, undefined, "datetime-local")}
          {text("Finished", finishedAt, setFinishedAt, undefined, "datetime-local")}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-fg-strong">Input datasets</legend>
            {inputs.length === 0 ? <p className="text-sm text-fg-muted">No dataset yet.</p> : null}
            <ul className="grid gap-2">
              {inputs.map((input, index) => (
                <li key={input.datasetId} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{input.datasetId}</span>
                  {index === inputs.length - 1 && copies.length > 0 ? (
                    <FormField label={`Copy of ${input.datasetId}`} className="min-w-48">
                      {(control) => (
                        <Select
                          {...control}
                          value={input.storageRefId ?? ""}
                          onChange={(event) =>
                            setInputs((list) =>
                              list.map((item, at) =>
                                at === index
                                  ? { ...item, storageRefId: event.target.value === "" ? null : event.target.value }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="">No particular copy</option>
                          {copies.map((copy) => (
                            <option key={copy.id} value={copy.id}>
                              {`${copy.role} on ${copy.endpointKey}`}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  ) : input.storageRefId === null ? null : (
                    <span className="text-sm text-fg-muted">copy {input.storageRefId}</span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setInputs((list) => list.filter((_, at) => at !== index))}
                  >
                    Remove {input.datasetId}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <FormField label="Dataset to add" className="min-w-56">
                {(control) => (
                  <Select {...control} value={adding} onChange={(event) => setAdding(event.target.value)}>
                    {datasets.length === 0 ? <option value="">The replication has no datasets</option> : null}
                    {datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {`${dataset.datasetKey}: ${dataset.title}`}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <Button
                type="button"
                size="sm"
                disabled={adding === "" || inputs.some((input) => input.datasetId === adding)}
                onClick={() => setInputs((list) => [...list, { datasetId: adding, storageRefId: null }])}
              >
                Add the dataset
              </Button>
            </div>
          </fieldset>
          <FormField
            label="Outputs"
            hint="One on each line: a label, then optionally | a kind | an address. Kinds: statistics, figure, table, derivedData, report, other."
          >
            {(control) => (
              <Textarea {...control} value={outputs} onChange={(event) => setOutputs(event.target.value)} />
            )}
          </FormField>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium text-fg-strong">Hypotheses tested</legend>
            {hypotheses.length === 0 ? (
              <p className="text-sm text-fg-muted">The replication has no hypotheses.</p>
            ) : null}
            {hypotheses.map((hypothesis) => (
              <label key={hypothesis.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={tested.includes(hypothesis.id)}
                  onChange={(event) =>
                    setTested((list) =>
                      event.target.checked ? [...list, hypothesis.id] : list.filter((id) => id !== hypothesis.id),
                    )
                  }
                />
                Hypothesis {hypothesis.hypothesisNumber}
              </label>
            ))}
          </fieldset>
          <FormField label="Quality control">
            {(control) => (
              <Select
                {...control}
                value={qcStatus}
                onChange={(event) => setQcStatus(event.target.value as RunInput["qcStatus"])}
              >
                {Object.entries(RUN_QC_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {text("Notes on quality control", qcNotes, setQcNotes)}
          <FormField label="Reproducibility">
            {(control) => (
              <Select
                {...control}
                value={reproducibilityStatus}
                onChange={(event) => setReproducibilityStatus(event.target.value as RunInput["reproducibilityStatus"])}
              >
                {Object.entries(REPRODUCIBILITY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {reproducibilityStatus === "notAttempted" ? null : (
            <FormField label="Run reproduced">
              {(control) => (
                <Select
                  {...control}
                  value={reproducesRunId}
                  onChange={(event) => setReproducesRunId(event.target.value)}
                >
                  <option value="">Choose the run</option>
                  {runs
                    .filter((candidate) => candidate.id !== run?.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title ?? candidate.pipelineName}
                      </option>
                    ))}
                </Select>
              )}
            </FormField>
          )}
          {text("Notes on reproducibility", reproducibilityNotes, setReproducibilityNotes)}
          {failure === null ? null : (
            <p role="alert" className="text-sm text-fg-accent">
              {failure}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving" : "Save the run"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
