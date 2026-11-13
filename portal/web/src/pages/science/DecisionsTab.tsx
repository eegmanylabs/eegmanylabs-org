// The methodological decision log of a replication (requirement R12.6). The log is
// append-only: each decision shows its content as it stands, the corrections that led there and
// the decision that replaced it, and a change is a new entry, never an edit.
import { type CallableInput, decisionStates, recordDecisionContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import type { Viewer } from "@/registry/viewer";
import { DECISION_STATUS_LABELS, DEVIATION_SEVERITY_LABELS, readableDate, readableInstant } from "./science-format";

type Entry = RecordOf<"decisions">;
type Deviation = RecordOf<"participationDeviations">;
type DecisionInput = CallableInput<typeof recordDecisionContract>;

export function DecisionsTab({
  studyKey,
  viewer,
  entries,
  deviations,
  laboratoryNames,
}: {
  studyKey: string;
  viewer: Viewer;
  entries: readonly Entry[];
  /** The deviations of the replication that the reader may read, which a decision can answer. */
  deviations: readonly Deviation[];
  laboratoryNames: ReadonlyMap<string, string>;
}) {
  const states = decisionStates(entries.filter((entry) => entry.scopeType === "replication"));
  const canRecord = viewer.access.member && viewer.can("replications.manage", { replicationId: studyKey });
  const [dialog, setDialog] = useState<{
    mode: "new" | "correct" | "replace";
    of: (typeof states)[number] | null;
  } | null>(null);
  const deviationText = (participationId: string, deviationId: string) =>
    deviations.find((deviation) => deviation.participationId === participationId && deviation.id === deviationId)
      ?.description ?? "A deviation the reader cannot open";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-secondary">
          Every member reads the log. An entry never changes: a correction or a replacement is recorded beside it.
        </p>
        {canRecord ? (
          <Button variant="primary" onClick={() => setDialog({ mode: "new", of: null })}>
            Record a decision
          </Button>
        ) : null}
      </div>
      {states.length === 0 ? (
        <EmptyState
          title="No decisions recorded yet"
          description="Methodological decisions of the replication appear here."
        />
      ) : (
        <ol className="grid gap-3" data-testid="decision-log">
          {states.map((state) => (
            <li key={state.id} className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-md font-medium text-fg-strong">{state.current.title}</h2>
                <Badge tone={state.status === "superseded" ? "outline" : "neutral"}>
                  {DECISION_STATUS_LABELS[state.status]}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap">{state.current.summary}</p>
              {state.current.rationale === undefined ? null : (
                <p className="text-sm text-fg-secondary">Rationale: {state.current.rationale}</p>
              )}
              {state.current.outcome === undefined ? null : (
                <p className="text-sm text-fg-secondary">Outcome: {state.current.outcome}</p>
              )}
              <p className="text-xs text-fg-muted">
                {state.current.decidedAt === undefined
                  ? "Date of the decision not recorded"
                  : `Decided on ${readableDate(state.current.decidedAt)}`}
                {state.history.length > 1
                  ? `. Corrected ${state.history.length - 1} time${state.history.length > 2 ? "s" : ""}`
                  : ""}
                {state.supersededBy.length > 0 ? ". Replaced by a later decision" : ""}.
              </p>
              {state.current.deviations.length === 0 ? null : (
                <ul className="grid gap-1 text-sm">
                  {state.current.deviations.map((ref) => (
                    <li key={`${ref.participationId}/${ref.deviationId}`}>
                      Answers the deviation: {deviationText(ref.participationId, ref.deviationId)}
                    </li>
                  ))}
                </ul>
              )}
              {state.history.length > 1 ? (
                <details>
                  <summary className="cursor-pointer text-sm text-fg-secondary">Earlier wording</summary>
                  <ol className="mt-2 grid gap-2 text-sm">
                    {state.history.slice(0, -1).map((entry) => (
                      <li key={entry.id}>
                        <span className="text-fg-muted">{readableInstant(entry.createdAt)}: </span>
                        {entry.title}. {entry.summary}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              {canRecord && state.status !== "superseded" ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setDialog({ mode: "correct", of: state })}>
                    Correct {state.current.title}
                  </Button>
                  <Button size="sm" onClick={() => setDialog({ mode: "replace", of: state })}>
                    Replace {state.current.title}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {dialog === null ? null : (
        <DecisionDialog
          studyKey={studyKey}
          mode={dialog.mode}
          of={dialog.of}
          deviations={deviations.filter((deviation) => deviation.archivedAt === null)}
          laboratoryNames={laboratoryNames}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function DecisionDialog({
  studyKey,
  mode,
  of,
  deviations,
  laboratoryNames,
  onClose,
}: {
  studyKey: string;
  mode: "new" | "correct" | "replace";
  of: ReturnType<typeof decisionStates>[number] | null;
  deviations: readonly Deviation[];
  laboratoryNames: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const toast = useToast();
  const base = mode === "correct" ? of?.current : undefined;
  const [title, setTitle] = useState(base?.title ?? "");
  const [summary, setSummary] = useState(base?.summary ?? "");
  const [rationale, setRationale] = useState(base?.rationale ?? "");
  const [outcome, setOutcome] = useState(base?.outcome ?? "");
  const [status, setStatus] = useState<DecisionInput["status"]>(
    base === undefined || base.status === "superseded" ? "accepted" : base.status,
  );
  const [decidedAt, setDecidedAt] = useState(base?.decidedAt ?? "");
  const [answered, setAnswered] = useState<readonly string[]>(
    base?.deviations.map((ref) => `${ref.participationId}/${ref.deviationId}`) ?? [],
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading =
    mode === "new" ? "Record a decision" : mode === "correct" ? "Correct the decision" : "Replace the decision";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "" || summary.trim() === "") return setFailure("Give the decision a title and a summary.");
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(recordDecisionContract, {
        scopeType: "replication",
        scopeId: studyKey,
        kind: mode === "correct" ? "correction" : "decision",
        correctsDecisionId: mode === "correct" ? (of?.id ?? null) : null,
        supersedesDecisionId: mode === "replace" ? (of?.id ?? null) : null,
        title: title.trim(),
        summary: summary.trim(),
        rationale: rationale.trim() === "" ? null : rationale.trim(),
        outcome: outcome.trim() === "" ? null : outcome.trim(),
        status,
        ownerPersonId: null,
        decidedAt: decidedAt === "" ? null : decidedAt,
        deviations: answered.map((key) => {
          const [participationId = "", deviationId = ""] = key.split("/");
          return { participationId, deviationId };
        }),
      });
      toast.show({ title: mode === "correct" ? "Correction recorded." : "Decision recorded." });
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The decision could not be recorded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title={heading}
        description={
          mode === "correct"
            ? "The correction is a new entry that states the decision in full. The entry it corrects stays in the log."
            : "The entry is added to the log and never changes."
        }
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Title">
            {(control) => <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} />}
          </FormField>
          <FormField label="Summary">
            {(control) => (
              <Textarea {...control} value={summary} onChange={(event) => setSummary(event.target.value)} />
            )}
          </FormField>
          <FormField label="Rationale" hint="Optional.">
            {(control) => (
              <Textarea {...control} value={rationale} onChange={(event) => setRationale(event.target.value)} />
            )}
          </FormField>
          <FormField label="Outcome" hint="Optional.">
            {(control) => <Input {...control} value={outcome} onChange={(event) => setOutcome(event.target.value)} />}
          </FormField>
          <FormField label="Status">
            {(control) => (
              <Select
                {...control}
                value={status}
                onChange={(event) => setStatus(event.target.value as DecisionInput["status"])}
              >
                <option value="proposed">Proposed</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </Select>
            )}
          </FormField>
          <FormField label="Date of the decision" hint="Optional.">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={decidedAt}
                onChange={(event) => setDecidedAt(event.target.value)}
              />
            )}
          </FormField>
          {deviations.length === 0 ? null : (
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium text-fg-strong">Deviations it answers</legend>
              {deviations.map((deviation) => {
                const key = `${deviation.participationId}/${deviation.id}`;
                return (
                  <label key={key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={answered.includes(key)}
                      onChange={(event) =>
                        setAnswered((list) =>
                          event.target.checked ? [...list, key] : list.filter((item) => item !== key),
                        )
                      }
                    />
                    <span>
                      {deviation.description} ({DEVIATION_SEVERITY_LABELS[deviation.severity].toLowerCase()},{" "}
                      {laboratoryNames.get(deviation.laboratoryId) ?? deviation.laboratoryId})
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
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
