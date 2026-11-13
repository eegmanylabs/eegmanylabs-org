// The hypotheses of a replication (requirement R12.1): what each states and expects, how it is
// measured and analysed, where it was preregistered, the original statistics and the result
// with where each comes from, the analysis runs that test it, the outputs that report it and
// the prediction-market questions about it. A value that nobody has recorded stays empty: the
// portal never fills one in. The prediction-market data, the outcome and null-significance
// labels, the links to the market's documents and its questions, are sealed by decisions of the
// programme (docs/MIGRATION_PLAN.md, section 11, questions 7 and 22) and shown to programme
// administrators alone.
import { type FindingSource, findingSourceSchema, recordHypothesisFindingContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Detail, Details } from "@/components/registry/details";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import { ANALYSIS_STATUS_LABELS, FINDING_SOURCE_LABELS, provenanceText } from "@/pages/science/science-format";
import { SCIENTIFIC_REVIEW_LABELS } from "@/registry/labels";

type Hypothesis = RecordOf<"replicationHypotheses">;

/** The sealed prediction-market data of a replication, which programme administrators alone read. */
export interface SealedMarketData {
  /** The verbatim "replicated" labels by hypothesis. */
  readonly replicated: Readonly<Record<string, string>>;
  /** The verbatim null-significance labels by hypothesis. */
  readonly nullSig: Readonly<Record<string, string>>;
  readonly studyDescriptionUrl: string | undefined;
  readonly infosheetUrl: string | undefined;
}

const SEALED_NOTE = "Sealed by a decision of the programme and shown to programme administrators only";

/** An address that a source gave, as a link. */
function Address({ url }: { url: string | undefined }) {
  if (url === undefined) return <Unknown />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-fg-accent underline">
      {url}
    </a>
  );
}

/** A label as a source gave it, which nobody has reviewed scientifically. */
function SourceValue({ value }: { value: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{value}</span>
      <Badge tone="outline">Unverified source value</Badge>
    </span>
  );
}

/** Sorts hypotheses by their number where it reads as one, and by identifier otherwise. */
function byNumber(a: Hypothesis, b: Hypothesis): number {
  const numberA = Number.parseInt(a.hypothesisNumber, 10);
  const numberB = Number.parseInt(b.hypothesisNumber, 10);
  if (Number.isNaN(numberA) || Number.isNaN(numberB)) return a.id.localeCompare(b.id);
  return numberA - numberB;
}

/** A finding with where it comes from, or the words that say nobody has recorded one. */
function Finding({
  text,
  provenance,
  importedAs,
}: {
  text: string | undefined;
  provenance: Hypothesis["resultProvenance"];
  /** What to say of a value that an import brought without a provenance of its own. */
  importedAs: string;
}) {
  if (text === undefined) return <Unknown />;
  return (
    <span className="grid gap-1">
      <span className="whitespace-pre-wrap">{text}</span>
      <span className="text-xs text-fg-muted">
        {provenance === undefined ? importedAs : provenanceText(provenance)}
      </span>
    </span>
  );
}

export interface HypothesesTabProps {
  studyKey: string;
  hypotheses: readonly Hypothesis[];
  /** The sealed prediction-market data of the replication, or null where the caller may not read it. */
  sealed: SealedMarketData | null;
  /** The analysis runs the reader may read. */
  runs: readonly RecordOf<"processingRuns">[];
  manuscripts: readonly RecordOf<"manuscripts">[];
  /** The questions of the prediction market, which are sealed, or null where the caller may not read them. */
  predictionItems: readonly RecordOf<"predictionMarketItems">[] | null;
  /** Whether the reader may record findings, which the function decides again. */
  canRecord: boolean;
}

export function HypothesesTab({
  studyKey,
  hypotheses,
  sealed,
  runs,
  manuscripts,
  predictionItems,
  canRecord,
}: HypothesesTabProps) {
  const sorted = [...hypotheses].filter((hypothesis) => hypothesis.archivedAt === null).sort(byNumber);
  const [recording, setRecording] = useState<{
    hypothesis: Hypothesis;
    finding: "originalStatistics" | "result";
  } | null>(null);
  return (
    <div className="grid gap-4">
      <p className="text-fg-secondary">
        Original statistics and results are shown with where they come from. The labels "null or significant" and
        "replicated" are copied from the programme's historical records and nobody has reviewed them scientifically.
      </p>
      {sealed === null ? null : (
        <Details>
          <Detail term="Prediction-market study description">
            <Address url={sealed.studyDescriptionUrl} />
          </Detail>
          <Detail term="Prediction-market information sheet">
            <Address url={sealed.infosheetUrl} />
          </Detail>
        </Details>
      )}
      <ol className="grid gap-3">
        {sorted.map((hypothesis) => {
          const replicated = sealed?.replicated[hypothesis.id];
          const nullSig = sealed?.nullSig[hypothesis.id];
          const testing = runs.filter((run) => run.archivedAt === null && run.hypothesisIds.includes(hypothesis.id));
          const reporting = manuscripts.filter(
            (manuscript) => manuscript.archivedAt === null && (manuscript.hypothesisIds ?? []).includes(hypothesis.id),
          );
          const questions = predictionItems?.filter((item) => item.hypothesisId === hypothesis.id) ?? null;
          return (
            <li
              key={hypothesis.id}
              className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
              data-testid="hypothesis"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-md font-medium text-fg-strong">Hypothesis {hypothesis.hypothesisNumber}</h2>
                {canRecord ? (
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setRecording({ hypothesis, finding: "originalStatistics" })}>
                      Record original statistics
                    </Button>
                    <Button size="sm" onClick={() => setRecording({ hypothesis, finding: "result" })}>
                      Record a result
                    </Button>
                  </span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap">{hypothesis.text}</p>
              <Details>
                <Detail term="Expected effect">{hypothesis.expectedEffect ?? <Unknown />}</Detail>
                <Detail term="Outcome measure">{hypothesis.outcomeMeasure ?? <Unknown />}</Detail>
                <Detail term="Analysis">{hypothesis.analysisSpecification ?? <Unknown />}</Detail>
                <Detail term="Preregistration">
                  {hypothesis.preregistrationUrl === undefined ? (
                    <Unknown />
                  ) : (
                    <a
                      href={hypothesis.preregistrationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-fg-accent underline"
                    >
                      {hypothesis.preregistrationUrl}
                    </a>
                  )}
                </Detail>
                <Detail term="Original statistics">
                  <Finding
                    text={hypothesis.originalStatistics}
                    provenance={hypothesis.originalStatisticsProvenance}
                    importedAs="Taken from the programme's list of studies, as the source wrote it."
                  />
                </Detail>
                <Detail term="State of the analysis">{ANALYSIS_STATUS_LABELS[hypothesis.analysisStatus]}</Detail>
                <Detail term="Result">
                  <Finding
                    text={hypothesis.resultSummary}
                    provenance={hypothesis.resultProvenance}
                    importedAs="Recorded before results carried their provenance."
                  />
                </Detail>
                <Detail term="Scientific review">{SCIENTIFIC_REVIEW_LABELS[hypothesis.scientificReviewStatus]}</Detail>
                <Detail term="Analysis runs">
                  {testing.length === 0 ? (
                    <Unknown>None recorded</Unknown>
                  ) : (
                    testing.map((run) => run.title ?? run.pipelineName).join(", ")
                  )}
                </Detail>
                <Detail term="Reported in">
                  {reporting.length === 0 ? (
                    <Unknown>No output yet</Unknown>
                  ) : (
                    reporting.map((item) => item.title).join(", ")
                  )}
                </Detail>
                {questions === null ? null : (
                  <Detail term="Prediction-market questions">
                    {questions.length === 0 ? (
                      <Unknown>None</Unknown>
                    ) : (
                      <ul className="grid gap-1">
                        {questions.map((item) => (
                          <li key={item.id}>{item.questionText}</li>
                        ))}
                      </ul>
                    )}
                  </Detail>
                )}
                <Detail term="Null or significant">
                  {sealed === null ? (
                    <Unknown>{SEALED_NOTE}</Unknown>
                  ) : nullSig === undefined ? (
                    <Unknown />
                  ) : (
                    <SourceValue value={nullSig} />
                  )}
                </Detail>
                <Detail term="Replicated">
                  {sealed === null ? (
                    <Unknown>{SEALED_NOTE}</Unknown>
                  ) : replicated === undefined ? (
                    <Unknown />
                  ) : (
                    <SourceValue value={replicated} />
                  )}
                </Detail>
              </Details>
            </li>
          );
        })}
      </ol>
      {recording === null ? null : (
        <FindingDialog
          studyKey={studyKey}
          hypothesis={recording.hypothesis}
          finding={recording.finding}
          runs={runs.filter((run) => run.hypothesisIds.includes(recording.hypothesis.id))}
          manuscripts={manuscripts}
          onClose={() => setRecording(null)}
        />
      )}
    </div>
  );
}

const ORIGINAL_SOURCES: readonly FindingSource[] = [
  "originalArticle",
  "supplementaryMaterial",
  "authorCorrespondence",
  "reanalysis",
];

/** Records an original statistic or a result of a hypothesis with where it comes from. */
function FindingDialog({
  studyKey,
  hypothesis,
  finding,
  runs,
  manuscripts,
  onClose,
}: {
  studyKey: string;
  hypothesis: Hypothesis;
  finding: "originalStatistics" | "result";
  runs: readonly RecordOf<"processingRuns">[];
  manuscripts: readonly RecordOf<"manuscripts">[];
  onClose: () => void;
}) {
  const toast = useToast();
  const sources = finding === "originalStatistics" ? ORIGINAL_SOURCES : findingSourceSchema.options;
  const [text, setText] = useState(
    (finding === "originalStatistics" ? hypothesis.originalStatistics : hypothesis.resultSummary) ?? "",
  );
  // A result comes from an analysis run where one tests the hypothesis; until then, from an article.
  const [source, setSource] = useState<FindingSource>(
    finding === "result" && runs.length > 0 ? "analysisRun" : "originalArticle",
  );
  const [locator, setLocator] = useState("");
  const [url, setUrl] = useState("");
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [manuscriptId, setManuscriptId] = useState(manuscripts[0]?.id ?? "");
  const [analysisStatus, setAnalysisStatus] = useState(hypothesis.analysisStatus);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = finding === "originalStatistics" ? "Record original statistics" : "Record a result";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() === "" || locator.trim() === "") {
      setFailure("Give the value and where in the source it is.");
      return;
    }
    if (source === "analysisRun" && runId === "") {
      setFailure("Choose the analysis run, or record the run first on the analysis tab.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(recordHypothesisFindingContract, {
        replicationId: studyKey,
        hypothesisId: hypothesis.id,
        finding,
        text: text.trim(),
        provenance: {
          source,
          locator: locator.trim(),
          url: url.trim() === "" ? null : url.trim(),
          analysisRunId: source === "analysisRun" ? runId : null,
          manuscriptId: source === "manuscript" && manuscriptId !== "" ? manuscriptId : null,
        },
        analysisStatus: finding === "result" ? analysisStatus : null,
      });
      toast.show({ title: finding === "originalStatistics" ? "Original statistics recorded." : "Result recorded." });
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The value could not be recorded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={`${title}: hypothesis ${hypothesis.hypothesisNumber}`}
        description="Every value is kept with its source and the place in it. Write the value exactly as the source states it."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label={finding === "originalStatistics" ? "Original statistics" : "Result"}>
            {(control) => <Textarea {...control} value={text} onChange={(event) => setText(event.target.value)} />}
          </FormField>
          <FormField label="Source">
            {(control) => (
              <Select {...control} value={source} onChange={(event) => setSource(event.target.value as FindingSource)}>
                {sources.map((option) => (
                  <option key={option} value={option} disabled={option === "analysisRun" && runs.length === 0}>
                    {option === "analysisRun" && runs.length === 0
                      ? `${FINDING_SOURCE_LABELS[option]} (no run tests this hypothesis yet)`
                      : FINDING_SOURCE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {source === "analysisRun" ? (
            <FormField label="Analysis run" hint="The runs that test this hypothesis.">
              {(control) => (
                <Select {...control} value={runId} onChange={(event) => setRunId(event.target.value)}>
                  {runs.length === 0 ? <option value="">No run tests this hypothesis yet</option> : null}
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.title ?? run.pipelineName}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {source === "manuscript" ? (
            <FormField label="Output">
              {(control) => (
                <Select {...control} value={manuscriptId} onChange={(event) => setManuscriptId(event.target.value)}>
                  {manuscripts.map((manuscript) => (
                    <option key={manuscript.id} value={manuscript.id}>
                      {manuscript.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField label="Where in the source" hint="For example: Table 2, page 14.">
            {(control) => <Input {...control} value={locator} onChange={(event) => setLocator(event.target.value)} />}
          </FormField>
          <FormField label="Address of the source" hint="Optional.">
            {(control) => (
              <Input {...control} type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
            )}
          </FormField>
          {finding === "result" ? (
            <FormField label="State of the analysis">
              {(control) => (
                <Select
                  {...control}
                  value={analysisStatus}
                  onChange={(event) => setAnalysisStatus(event.target.value as typeof analysisStatus)}
                >
                  {Object.entries(ANALYSIS_STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
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
              {busy ? "Recording" : "Record"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
