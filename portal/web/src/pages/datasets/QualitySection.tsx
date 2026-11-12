// The quality control of a dataset (docs/DATA_MODEL.md, section 10): assessments of the dataset
// as a whole and of single recordings, each naming its pipeline and versions, parameters,
// metrics, the recordings it excludes with a reason that recruitment reports also use, and the
// deviations of the participation it takes into account. Assessments never change; a correction
// is a new assessment that names the one it replaces. The latest of the dataset as a whole sets
// its QC status.
import { recordQcAssessmentContract } from "@eegml/shared";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, type RecordOf } from "@/data";
import { FormDialog, parseValues, useAction } from "./dataset-actions";

type Assessment = RecordOf<"datasetQcAssessments">;
type Outcome = Assessment["outcome"];

const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = { pass: "Pass", flag: "Flag", fail: "Fail" };

const mapText = (map: Readonly<Record<string, unknown>> | undefined) =>
  map === undefined || Object.keys(map).length === 0
    ? null
    : Object.entries(map)
        .map(([name, value]) => `${name} ${String(value)}`)
        .join(", ");

function RecordDialog({
  datasetKey,
  reasons,
  deviations,
  assessments,
  onClose,
}: {
  datasetKey: string;
  reasons: readonly RecordOf<"vocabularyTerms">[];
  deviations: readonly RecordOf<"participationDeviations">[];
  assessments: readonly Assessment[];
  onClose: () => void;
}) {
  const action = useAction();
  const [level, setLevel] = useState<"dataset" | "recording">("dataset");
  const [recording, setRecording] = useState("");
  const [tool, setTool] = useState("");
  const [pipelineVersion, setPipelineVersion] = useState("");
  const [toolVersion, setToolVersion] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("pass");
  const [parameters, setParameters] = useState("");
  const [metrics, setMetrics] = useState("");
  const [excluded, setExcluded] = useState("");
  const [reason, setReason] = useState(reasons[0]?.id ?? "");
  const [deviationIds, setDeviationIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [replaces, setReplaces] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="Record a quality assessment"
      submitLabel="Record the assessment"
      failureTitle="Nothing was recorded."
      busy={action.busy}
      failure={problem ?? action.failure}
      onSubmit={async () => {
        const parsedParameters = parseValues(parameters);
        const parsedMetrics = parseValues(metrics);
        if (parsedParameters === null || parsedMetrics === null) {
          setProblem("Write parameters and metrics as one name, a colon and a value on each line.");
          return;
        }
        if (level === "recording" && recording.trim() === "") {
          setProblem("Name the recording that the assessment is about.");
          return;
        }
        setProblem(null);
        const labels = excluded
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "");
        if (
          await action.run(
            () =>
              callFunction(recordQcAssessmentContract, {
                datasetKey,
                level,
                recordingLabel: level === "recording" ? recording.trim() : null,
                tool: tool.trim() === "" ? null : tool.trim(),
                toolVersion: toolVersion.trim() === "" ? null : toolVersion.trim(),
                pipelineVersion: pipelineVersion.trim() === "" ? null : pipelineVersion.trim(),
                parameters: parsedParameters,
                metrics: parsedMetrics,
                outcome,
                exclusions: labels.map((label) => ({
                  recordingLabel: label,
                  ...(reason === "" ? {} : { reasonTermId: reason }),
                })),
                deviationIds,
                notes: notes.trim(),
                supersedesAssessmentId: replaces === "" ? null : replaces,
              }),
            "The assessment has been recorded.",
            "The assessment could not be recorded. Try again.",
          )
        )
          onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Level">
          {(control) => (
            <Select
              {...control}
              value={level}
              onChange={(event) => setLevel(event.target.value as "dataset" | "recording")}
            >
              <option value="dataset">The dataset as a whole</option>
              <option value="recording">One recording</option>
            </Select>
          )}
        </FormField>
        {level === "recording" ? (
          <FormField label="Recording" hint="A pseudonymous label, such as sub-01. Never a name.">
            {(control) => (
              <Input {...control} value={recording} onChange={(event) => setRecording(event.target.value)} />
            )}
          </FormField>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Pipeline">
          {(control) => <Input {...control} value={tool} onChange={(event) => setTool(event.target.value)} />}
        </FormField>
        <FormField label="Pipeline version">
          {(control) => (
            <Input {...control} value={pipelineVersion} onChange={(event) => setPipelineVersion(event.target.value)} />
          )}
        </FormField>
        <FormField label="Tool version">
          {(control) => (
            <Input {...control} value={toolVersion} onChange={(event) => setToolVersion(event.target.value)} />
          )}
        </FormField>
      </div>
      <FormField label="Outcome">
        {(control) => (
          <Select {...control} value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}>
            {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((value) => (
              <option key={value} value={value}>
                {OUTCOME_LABELS[value]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Parameters" hint="One name, a colon and a value on each line.">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={parameters}
              onChange={(event) => setParameters(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Metrics" hint="One name, a colon and a value on each line.">
          {(control) => (
            <Textarea {...control} rows={3} value={metrics} onChange={(event) => setMetrics(event.target.value)} />
          )}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Excluded recordings" hint="One label on each line.">
          {(control) => (
            <Textarea {...control} rows={3} value={excluded} onChange={(event) => setExcluded(event.target.value)} />
          )}
        </FormField>
        <FormField label="Reason for the exclusions" hint="The reasons recruitment reports use.">
          {(control) => (
            <Select {...control} value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">No reason stated</option>
              {reasons.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      {deviations.length === 0 ? null : (
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium">Deviations taken into account</legend>
          {deviations.map((deviation) => (
            <label key={deviation.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deviationIds.includes(deviation.id)}
                onChange={(event) =>
                  setDeviationIds(
                    event.target.checked
                      ? [...deviationIds, deviation.id]
                      : deviationIds.filter((id) => id !== deviation.id),
                  )
                }
              />
              {deviation.description}
            </label>
          ))}
        </fieldset>
      )}
      {assessments.length === 0 ? null : (
        <FormField label="Replaces" hint="Optional. A correction names the assessment it replaces.">
          {(control) => (
            <Select {...control} value={replaces} onChange={(event) => setReplaces(event.target.value)}>
              <option value="">Replaces nothing</option>
              {assessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {formatDateTime(assessment.assessedAt.toDate())}, {assessment.recordingLabel ?? "dataset"},{" "}
                  {OUTCOME_LABELS[assessment.outcome]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}
      <FormField label="Notes" hint="Optional.">
        {(control) => (
          <Textarea {...control} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}

export function QualitySection({
  datasetKey,
  assessments,
  reasons,
  deviations,
  manages,
}: {
  datasetKey: string;
  assessments: readonly Assessment[];
  reasons: readonly RecordOf<"vocabularyTerms">[];
  deviations: readonly RecordOf<"participationDeviations">[];
  manages: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const ordered = [...assessments].sort((a, b) => b.assessedAt.toMillis() - a.assessedAt.toMillis());
  const replaced = new Set(
    assessments.flatMap((assessment) =>
      assessment.supersedesAssessmentId === undefined ? [] : [assessment.supersedesAssessmentId],
    ),
  );
  const reasonName = (id: string | undefined) => reasons.find((term) => term.id === id)?.name ?? "no reason stated";
  return (
    <div className="grid gap-3">
      {manages ? (
        <div>
          <Button variant="primary" onClick={() => setRecording(true)}>
            Record a quality assessment
          </Button>
        </div>
      ) : null}
      {ordered.length === 0 ? (
        <EmptyState
          title="No quality assessment yet"
          description="The quality-control task opens when the data first arrives."
        />
      ) : (
        <Table caption="Quality assessments" data-testid="qc-assessments">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Assessed</TableHeaderCell>
              <TableHeaderCell>Of</TableHeaderCell>
              <TableHeaderCell>Pipeline</TableHeaderCell>
              <TableHeaderCell>Outcome</TableHeaderCell>
              <TableHeaderCell>Exclusions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((assessment) => (
              <TableRow key={assessment.id}>
                <TableCell>
                  {formatDateTime(assessment.assessedAt.toDate())}
                  {replaced.has(assessment.id) ? (
                    <Badge className="ml-1" tone="outline">
                      Replaced
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{assessment.level === "dataset" ? "The dataset" : assessment.recordingLabel}</TableCell>
                <TableCell>
                  {assessment.tool ?? <Unknown />}
                  <span className="block text-xs text-fg-muted">
                    {[assessment.pipelineVersion, assessment.toolVersion]
                      .filter((part) => part !== undefined)
                      .join(", ")}
                    {mapText(assessment.parameters) === null ? "" : ` ${mapText(assessment.parameters)}`}
                  </span>
                </TableCell>
                <TableCell>
                  {assessment.outcome === "pass" ? (
                    OUTCOME_LABELS.pass
                  ) : (
                    <Badge tone="accent">{OUTCOME_LABELS[assessment.outcome]}</Badge>
                  )}
                  {mapText(assessment.metrics) === null ? null : (
                    <span className="block text-xs text-fg-muted">{mapText(assessment.metrics)}</span>
                  )}
                </TableCell>
                <TableCell>
                  {(assessment.exclusions ?? []).length === 0
                    ? "None"
                    : (assessment.exclusions ?? [])
                        .map((exclusion) => `${exclusion.recordingLabel} (${reasonName(exclusion.reasonTermId)})`)
                        .join(", ")}
                  {(assessment.deviationIds ?? []).length === 0 ? null : (
                    <span className="block text-xs text-fg-muted">
                      {(assessment.deviationIds ?? []).length} deviations considered
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {recording ? (
        <RecordDialog
          datasetKey={datasetKey}
          reasons={reasons}
          deviations={deviations}
          assessments={ordered}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </div>
  );
}
