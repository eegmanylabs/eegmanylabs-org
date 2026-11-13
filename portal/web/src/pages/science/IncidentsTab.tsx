// The incident and corrective-action registry of a replication (requirement R12.7). A report
// never changes: corrective actions, changes of status and corrections are added beneath it, and
// the incident reads as its actions leave it. An incident may answer deviations from the protocol.
import { type CallableInput, incidentState, recordIncidentActionContract, reportIncidentContract } from "@eegml/shared";
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
import {
  INCIDENT_ACTION_LABELS,
  INCIDENT_STATUS_LABELS,
  readableDate,
  readableInstant,
  SEVERITY_LABELS,
  todayIsoDate,
} from "./science-format";

type Incident = RecordOf<"incidents">;
type Action = RecordOf<"incidentActions">;
type ActionInput = CallableInput<typeof recordIncidentActionContract>;

export function IncidentsTab({
  studyKey,
  viewer,
  incidents,
  actions,
  participations,
  laboratoryNames,
  deviations,
}: {
  studyKey: string;
  viewer: Viewer;
  incidents: readonly Incident[];
  actions: readonly Action[];
  participations: readonly RecordOf<"participations">[];
  laboratoryNames: ReadonlyMap<string, string>;
  deviations: readonly RecordOf<"participationDeviations">[];
}) {
  const [reporting, setReporting] = useState(false);
  const [acting, setActing] = useState<{ incident: Incident; kind: ActionInput["kind"] } | null>(null);
  const reportsFor = participations.filter((participation) =>
    viewer.can("participations.manage", { replicationId: studyKey, laboratoryId: participation.laboratoryId }),
  );
  const canReport =
    viewer.access.member && (viewer.can("participations.manage", { replicationId: studyKey }) || reportsFor.length > 0);
  const sorted = [...incidents].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  // The managers of the replication or of the laboratory of an incident follow it up.
  const manages = (incident: Incident) =>
    viewer.access.member &&
    viewer.can("participations.manage", { replicationId: incident.replicationId, laboratoryId: incident.laboratoryId });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-secondary">
          An incident report never changes. What follows it is added beneath it, corrections included.
        </p>
        {canReport ? (
          <Button variant="primary" onClick={() => setReporting(true)}>
            Report an incident
          </Button>
        ) : null}
      </div>
      {sorted.length === 0 ? (
        <EmptyState
          title="No incidents reported"
          description="Incidents of the replication and its laboratories appear here."
        />
      ) : (
        <ol className="grid gap-3" data-testid="incidents">
          {sorted.map((incident) => {
            const history = actions.filter((action) => action.incidentId === incident.id);
            const state = incidentState(incident, history);
            return (
              <li key={incident.id} className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-md font-medium text-fg-strong">{state.title}</h2>
                  <span className="flex flex-wrap gap-2">
                    <Badge tone={state.status === "resolved" ? "outline" : "accent"}>
                      {INCIDENT_STATUS_LABELS[state.status]}
                    </Badge>
                    <Badge>{`Severity: ${SEVERITY_LABELS[state.severity].toLowerCase()}`}</Badge>
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{state.description}</p>
                <p className="text-xs text-fg-muted">
                  Occurred on {readableDate(incident.occurredAt)}
                  {incident.laboratoryId === null
                    ? ""
                    : ` at ${laboratoryNames.get(incident.laboratoryId) ?? incident.laboratoryId}`}
                  {incident.datasetId === undefined ? "" : `, dataset ${incident.datasetId}`}.
                </p>
                <section aria-label={`Corrective actions of ${state.title}`} className="grid gap-1">
                  <h3 className="text-sm font-medium text-fg-strong">Corrective actions</h3>
                  {state.correctiveActions.length === 0 ? (
                    <p className="text-sm text-fg-muted">None recorded yet.</p>
                  ) : (
                    <ul className="grid gap-1 text-sm">
                      {state.correctiveActions.map((action) => (
                        <li key={action.id}>
                          {action.text}
                          {action.dueDate === undefined ? "" : ` Due on ${readableDate(action.dueDate)}.`}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {history.length === 0 ? null : (
                  <details>
                    <summary className="cursor-pointer text-sm text-fg-secondary">History</summary>
                    <ol className="mt-2 grid gap-1 text-sm">
                      {state.history.map((action) => (
                        <li
                          key={action.id}
                          className={state.corrected.has(action.id) ? "text-fg-muted line-through" : undefined}
                        >
                          {readableInstant(action.createdAt)}: {INCIDENT_ACTION_LABELS[action.kind]}
                          {action.status === undefined
                            ? ""
                            : `, ${INCIDENT_STATUS_LABELS[action.status].toLowerCase()}`}
                          {action.text === undefined ? "" : `. ${action.text}`}
                          {action.correctedReport?.severity === undefined
                            ? ""
                            : `. Severity corrected to ${SEVERITY_LABELS[action.correctedReport.severity].toLowerCase()}`}
                          {state.corrected.has(action.id) ? " (corrected)" : ""}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {manages(incident) ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setActing({ incident, kind: "correctiveAction" })}>
                      Add a corrective action
                    </Button>
                    <Button size="sm" onClick={() => setActing({ incident, kind: "statusChange" })}>
                      Change the status
                    </Button>
                    <Button size="sm" onClick={() => setActing({ incident, kind: "correction" })}>
                      Correct the record
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {reporting ? (
        <ReportDialog
          studyKey={studyKey}
          viewer={viewer}
          participations={participations}
          laboratoryNames={laboratoryNames}
          deviations={deviations}
          onClose={() => setReporting(false)}
        />
      ) : null}
      {acting === null ? null : (
        <ActionDialog
          incident={acting.incident}
          kind={acting.kind}
          actions={actions.filter((action) => action.incidentId === acting.incident.id)}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  );
}

function ReportDialog({
  studyKey,
  viewer,
  participations,
  laboratoryNames,
  deviations,
  onClose,
}: {
  studyKey: string;
  viewer: Viewer;
  participations: readonly RecordOf<"participations">[];
  laboratoryNames: ReadonlyMap<string, string>;
  deviations: readonly RecordOf<"participationDeviations">[];
  onClose: () => void;
}) {
  const toast = useToast();
  const leads = viewer.can("participations.manage", { replicationId: studyKey });
  const choices = participations.filter(
    (participation) => leads || viewer.can("participations.manage", { laboratoryId: participation.laboratoryId }),
  );
  const [participationId, setParticipationId] = useState(leads ? "" : (choices[0]?.id ?? ""));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("medium");
  const [occurredAt, setOccurredAt] = useState(todayIsoDate());
  const [answered, setAnswered] = useState<readonly string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const participation = choices.find((item) => item.id === participationId) ?? null;
  const ofParticipation = deviations.filter((deviation) => deviation.participationId === participationId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "" || description.trim() === "")
      return setFailure("Give the incident a title and a description.");
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(reportIncidentContract, {
        scopeType: participation === null ? "replication" : leads ? "replication" : "laboratory",
        scopeId: participation === null || leads ? studyKey : participation.laboratoryId,
        title: title.trim(),
        description: description.trim(),
        severity,
        occurredAt,
        participationId: participation?.id ?? null,
        datasetId: null,
        deviations: answered.map((deviationId) => ({ participationId, deviationId })),
      });
      toast.show({ title: "Incident reported." });
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The incident could not be reported. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title="Report an incident"
        description="The report is kept as written. What follows is added beneath it."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Laboratory">
            {(control) => (
              <Select {...control} value={participationId} onChange={(event) => setParticipationId(event.target.value)}>
                {leads ? <option value="">The replication as a whole</option> : null}
                {choices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {laboratoryNames.get(item.laboratoryId) ?? item.laboratoryId}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Title">
            {(control) => <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} />}
          </FormField>
          <FormField label="What happened">
            {(control) => (
              <Textarea {...control} value={description} onChange={(event) => setDescription(event.target.value)} />
            )}
          </FormField>
          <FormField label="Severity">
            {(control) => (
              <Select
                {...control}
                value={severity}
                onChange={(event) => setSeverity(event.target.value as typeof severity)}
              >
                {Object.entries(SEVERITY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Date it happened">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            )}
          </FormField>
          {ofParticipation.length === 0 ? null : (
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium text-fg-strong">Deviations it concerns</legend>
              {ofParticipation.map((deviation) => (
                <label key={deviation.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={answered.includes(deviation.id)}
                    onChange={(event) =>
                      setAnswered((list) =>
                        event.target.checked ? [...list, deviation.id] : list.filter((id) => id !== deviation.id),
                      )
                    }
                  />
                  {deviation.description}
                </label>
              ))}
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
              {busy ? "Reporting" : "Report the incident"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({
  incident,
  kind,
  actions,
  onClose,
}: {
  incident: Incident;
  kind: ActionInput["kind"];
  actions: readonly Action[];
  onClose: () => void;
}) {
  const toast = useToast();
  const corrective = actions.filter((action) => action.kind === "correctiveAction" || action.kind === "correction");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"open" | "investigating" | "resolved">("investigating");
  const [dueDate, setDueDate] = useState("");
  const [target, setTarget] = useState<string>("report");
  const [severity, setSeverity] = useState<"" | "low" | "medium" | "high">("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading =
    kind === "correctiveAction"
      ? "Add a corrective action"
      : kind === "statusChange"
        ? "Change the status"
        : "Correct the record";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const correctingReport = kind === "correction" && target === "report";
    try {
      await callFunction(recordIncidentActionContract, {
        incidentId: incident.id,
        kind,
        // A correction of the report carries the corrected description in `correctedReport` alone.
        text: correctingReport || text.trim() === "" ? null : text.trim(),
        status: kind === "statusChange" ? status : null,
        ownerPersonId: null,
        dueDate: kind === "correctiveAction" && dueDate !== "" ? dueDate : null,
        correctsActionId: kind === "correction" && !correctingReport ? target : null,
        correctedReport: correctingReport
          ? {
              ...(text.trim() === "" ? {} : { description: text.trim() }),
              ...(severity === "" ? {} : { severity }),
            }
          : null,
      });
      toast.show({ title: "Recorded." });
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The action could not be recorded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent title={heading} description={`For the incident: ${incident.title}`}>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {kind === "statusChange" ? (
            <FormField label="New status">
              {(control) => (
                <Select
                  {...control}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                >
                  {Object.entries(INCIDENT_STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {kind === "correction" ? (
            <FormField label="What the correction replaces">
              {(control) => (
                <Select {...control} value={target} onChange={(event) => setTarget(event.target.value)}>
                  <option value="report">The description or severity of the report</option>
                  {corrective.map((action) => (
                    <option key={action.id} value={action.id}>
                      {`The corrective action: ${action.text ?? ""}`}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {kind === "statusChange" ? null : (
            <FormField
              label={
                kind === "correctiveAction"
                  ? "Corrective action"
                  : target === "report"
                    ? "Corrected description"
                    : "Corrected action"
              }
              {...(kind === "correction" && target === "report"
                ? { hint: "Leave empty to keep the description." }
                : {})}
            >
              {(control) => <Textarea {...control} value={text} onChange={(event) => setText(event.target.value)} />}
            </FormField>
          )}
          {kind === "correction" && target === "report" ? (
            <FormField label="Corrected severity">
              {(control) => (
                <Select
                  {...control}
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as typeof severity)}
                >
                  <option value="">Keep the severity</option>
                  {Object.entries(SEVERITY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {kind === "correctiveAction" ? (
            <FormField label="Due by" hint="Optional.">
              {(control) => (
                <Input {...control} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
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
