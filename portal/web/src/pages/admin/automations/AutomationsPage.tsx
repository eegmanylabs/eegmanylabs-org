// Automations and scheduled reports (requirements R15.7, R16.9 and R16.10). Administrators see
// the rules in force, the ones that ship with the portal and their own, switch them off and on,
// narrow them to a replication, add a rule from the fixed lists of events and actions, run a rule
// of a schedule by hand, and read the log of every run. Scheduled progress reports are kept here
// too. Every change goes through a callable function and is audited.
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_EVENT_KEYS,
  type AutomationActionKind,
  type AutomationEventKey,
  type AutomationRuleSpec,
  effectiveRules,
  PROGRAMME_KEY,
  runAutomationRuleContract,
  saveAutomationRuleContract,
  saveScheduledReportContract,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { CallableError, callFunction, type LiveQuery, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { combineLive, orEmpty } from "@/registry/combine";
import { ALL_REPLICATIONS } from "@/registry/queries";
import { useViewer } from "@/registry/viewer";
import { AdminPage } from "../AdminPage";
import { ACTION_LABELS, EVENT_LABELS } from "./automation-format";

const RULES: LiveQuery<"automationRules"> = { collection: "automationRules", within: [], limit: 500 };
const RUNS: LiveQuery<"automationRuns"> = {
  collection: "automationRuns",
  within: [],
  orderBy: [["startedAt", "desc"]],
  limit: 50,
};
const REPORTS: LiveQuery<"scheduledReports"> = { collection: "scheduledReports", within: [], limit: 200 };
const TEMPLATES: LiveQuery<"documentTemplates"> = { collection: "documentTemplates", within: [], limit: 100 };

const failureText = (error: unknown) =>
  error instanceof CallableError ? error.message : "This could not be done. Try again.";

/** The replication a rule is limited to by its one condition, or the empty text. */
function replicationOf(rule: AutomationRuleSpec): string {
  const condition = rule.conditions.find(
    (candidate) => candidate.field === "replicationId" && candidate.operator === "equals",
  );
  return condition?.values[0] ?? "";
}

function ruleInput(rule: AutomationRuleSpec, changes: { enabled?: boolean; replicationId?: string }) {
  const replicationId = changes.replicationId ?? replicationOf(rule);
  return {
    name: rule.name,
    enabled: changes.enabled ?? rule.enabled,
    event: rule.triggerConfig.event,
    conditions: [
      ...rule.conditions.filter((condition) => condition.field !== "replicationId"),
      ...(replicationId === ""
        ? []
        : [{ field: "replicationId" as const, operator: "equals" as const, values: [replicationId] }]),
    ],
    actions: rule.actions,
    scopeType: "programme" as const,
    scopeId: PROGRAMME_KEY,
  };
}

function RuleRow({
  id,
  rule,
  replications,
}: {
  id: string;
  rule: AutomationRuleSpec;
  replications: readonly RecordOf<"replications">[];
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const save = (changes: { enabled?: boolean; replicationId?: string }) => {
    setBusy(true);
    setMessage(null);
    callFunction(saveAutomationRuleContract, { ruleId: id, ...ruleInput(rule, changes) })
      .then(() => setMessage("Saved."))
      .catch((error: unknown) => setMessage(failureText(error)))
      .finally(() => setBusy(false));
  };
  const runnable = rule.triggerConfig.event === "manual" || rule.triggerConfig.event.startsWith("schedule.");
  const run = () => {
    setBusy(true);
    setMessage(null);
    callFunction(runAutomationRuleContract, { ruleId: id })
      .then((result) =>
        setMessage(result.status === "queued" ? "The run is queued; its log appears below." : result.reason),
      )
      .catch((error: unknown) => setMessage(failureText(error)))
      .finally(() => setBusy(false));
  };
  return (
    <TableRow className="align-top" data-testid="automation-rule">
      <TableCell>
        <span className="font-medium text-fg-strong">{rule.name}</span>
        {rule.builtIn ? (
          <Badge tone="outline" className="ml-2">
            Ships with the portal
          </Badge>
        ) : null}
      </TableCell>
      <TableCell>{EVENT_LABELS[rule.triggerConfig.event]}</TableCell>
      <TableCell>{rule.actions.map((action) => ACTION_LABELS[action.kind]).join(", ")}</TableCell>
      <TableCell>
        <Select
          className="min-w-44"
          aria-label={`Replication that ${rule.name} is limited to`}
          value={replicationOf(rule)}
          disabled={busy}
          onChange={(event) => save({ replicationId: event.target.value })}
        >
          <option value="">Every replication</option>
          {replications.map((replication) => (
            <option key={replication.id} value={replication.id}>
              {replication.id}
            </option>
          ))}
        </Select>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rule.enabled}
              disabled={busy}
              onChange={(event) => save({ enabled: event.target.checked })}
            />
            On<span className="sr-only"> for {rule.name}</span>
          </label>
          {runnable ? (
            <Button size="sm" onClick={run} disabled={busy || !rule.enabled}>
              Run now
            </Button>
          ) : null}
        </div>
        {message === null ? null : (
          <p className="mt-1 text-xs text-fg-secondary" role="status">
            {message}
          </p>
        )}
      </TableCell>
    </TableRow>
  );
}

function NewRuleForm() {
  const viewer = useViewer();
  // The templates are read by the administrators of the integrations, who register them.
  const templates = orEmpty(useLiveQuery(viewer?.can("integrations.manage", "programme") === true ? TEMPLATES : null));
  const registered =
    templates.status === "ready" ? templates.data.filter((template) => template.archivedAt === null) : [];
  const [name, setName] = useState("");
  const [event, setEvent] = useState<AutomationEventKey>("dataset.dataArrived");
  const [actions, setActions] = useState<AutomationActionKind[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fitting = (Object.keys(AUTOMATION_ACTIONS) as AutomationActionKind[]).filter((kind) =>
    (AUTOMATION_ACTIONS[kind] as readonly AutomationEventKey[]).includes(event),
  );
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setBusy(true);
    setFailure(null);
    setSaved(false);
    callFunction(saveAutomationRuleContract, {
      name: name.trim(),
      enabled: true,
      event,
      conditions: [],
      actions: actions.map((kind) => (kind === "generateProgressReport" ? { kind, templateKey } : { kind })),
      scopeType: "programme",
      scopeId: PROGRAMME_KEY,
    })
      .then(() => {
        setName("");
        setActions([]);
        setSaved(true);
      })
      .catch((error: unknown) => setFailure(failureText(error)))
      .finally(() => setBusy(false));
  };
  return (
    <form
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      onSubmit={submit}
      noValidate
      aria-label="Add a rule"
    >
      <h3 className="text-md font-medium text-fg-strong">Add a rule</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name">
          {(control) => (
            <Input {...control} value={name} maxLength={100} onChange={(change) => setName(change.target.value)} />
          )}
        </FormField>
        <FormField label="When">
          {(control) => (
            <Select
              {...control}
              value={event}
              onChange={(change) => {
                setEvent(change.target.value as AutomationEventKey);
                setActions([]);
              }}
            >
              {AUTOMATION_EVENT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {EVENT_LABELS[key]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium text-fg-strong">Then</legend>
        {fitting.length === 0 ? (
          <p className="text-sm text-fg-secondary">No action follows this event.</p>
        ) : (
          fitting.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={actions.includes(kind)}
                onChange={(change) =>
                  setActions((list) => (change.target.checked ? [...list, kind] : list.filter((item) => item !== kind)))
                }
              />
              {ACTION_LABELS[kind]}
            </label>
          ))
        )}
      </fieldset>
      {actions.includes("generateProgressReport") ? (
        registered.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            Updating the progress reports needs a template of generated documents, which an administrator of the
            integrations registers on the integrations page.
          </p>
        ) : (
          <FormField label="Template of the report">
            {(control) => (
              <Select {...control} value={templateKey} onChange={(change) => setTemplateKey(change.target.value)}>
                <option value="">Choose a template</option>
                {registered.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        )
      ) : null}
      {failure === null ? null : <ErrorState title="The rule was not saved." description={failure} />}
      {saved ? (
        <p className="text-sm" role="status">
          The rule is saved and on.
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={
            busy ||
            name.trim() === "" ||
            actions.length === 0 ||
            (actions.includes("generateProgressReport") && templateKey === "")
          }
        >
          Add the rule
        </Button>
      </div>
    </form>
  );
}

function Rules() {
  const live = combineLive([useLiveQuery(RULES), useLiveQuery(ALL_REPLICATIONS)] as const, (stored, replications) => ({
    stored,
    replications,
  }));
  return (
    <section className="grid gap-3" aria-label="Rules">
      <h2 className="text-lg">Rules</h2>
      <LiveView
        live={live}
        loadingLabel="Loading the rules"
        errorTitle="The rules could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ stored, replications }) => {
          const rules = effectiveRules(stored.map((document) => ({ id: document.id, data: document })));
          const shown = replications.filter((replication) => replication.archivedAt === null);
          return (
            <div className="relative overflow-x-auto">
              <Table caption="The rules in force">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Rule</TableHeaderCell>
                    <TableHeaderCell>When</TableHeaderCell>
                    <TableHeaderCell>Then</TableHeaderCell>
                    <TableHeaderCell>Limited to</TableHeaderCell>
                    <TableHeaderCell>State</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rules.map(({ id, rule }) => (
                    <RuleRow key={id} id={id} rule={rule} replications={shown} />
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        }}
      </LiveView>
      <NewRuleForm />
    </section>
  );
}

const RUN_STATUS_LABELS = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Passed over",
} as const;

/** A line of a run's log, with the action that wrote it named in words rather than by its key. */
function logLine(line: string): string {
  // A line holds the time it was written and, before what an action did, the action's key.
  let text = line;
  for (const [kind, label] of Object.entries(ACTION_LABELS)) text = text.replaceAll(`${kind}: `, `${label}: `);
  return text;
}

function Runs() {
  const live = combineLive([useLiveQuery(RUNS), useLiveQuery(RULES)] as const, (runs, stored) => ({
    runs,
    names: new Map(
      effectiveRules(stored.map((document) => ({ id: document.id, data: document }))).map(({ id, rule }) => [
        id,
        rule.name,
      ]),
    ),
  }));
  return (
    <section className="grid gap-3" aria-label="Runs">
      <h2 className="text-lg">Recent runs</h2>
      <LiveView
        live={live}
        loadingLabel="Loading the runs"
        errorTitle="The runs could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ runs: list, names }) =>
          list.length === 0 ? (
            <EmptyState
              title="No rule has run yet"
              description="Each run is logged here with its event, its outcome and what each action did."
            />
          ) : (
            <ul className="grid gap-2">
              {list.map((run) => (
                <li key={run.id} className="rounded-tile border border-border px-3 py-2" data-testid="automation-run">
                  <details>
                    <summary className="cursor-pointer text-sm">
                      <span className="font-medium">{names.get(run.ruleId) ?? "A deleted rule"}</span>,{" "}
                      {EVENT_LABELS[run.event]}, {formatDateTime(run.startedAt.toDate())}:{" "}
                      <Badge tone={run.status === "failed" ? "accent" : "neutral"}>
                        {RUN_STATUS_LABELS[run.status]}
                      </Badge>
                    </summary>
                    <ol className="mt-2 grid gap-1 text-xs text-fg-secondary">
                      {run.log.map((line) => (
                        <li key={line}>{logLine(line)}</li>
                      ))}
                    </ol>
                    {run.error === undefined ? null : <p className="mt-1 text-xs text-fg-accent">{run.error}</p>}
                  </details>
                </li>
              ))}
            </ul>
          )
        }
      </LiveView>
    </section>
  );
}

function ScheduledReports() {
  const viewer = useViewer();
  const live = combineLive(
    [
      useLiveQuery(REPORTS),
      orEmpty(useLiveQuery(viewer?.can("integrations.manage", "programme") === true ? TEMPLATES : null)),
      useLiveQuery(ALL_REPLICATIONS),
    ] as const,
    (reports, templates, replications) => ({ reports, templates, replications }),
  );
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [entityId, setEntityId] = useState("");
  const [schedule, setSchedule] = useState<"weekly" | "monthly">("weekly");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="grid gap-3" aria-label="Scheduled reports">
      <h2 className="text-lg">Scheduled progress reports</h2>
      <p className="text-sm text-fg-secondary">
        On its schedule a report updates the generated document of its template for the record it names, through the
        same queue as every generated document, and tells you in the portal.
      </p>
      <LiveView
        live={live}
        loadingLabel="Loading the reports"
        errorTitle="The reports could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ reports, templates, replications }) => {
          const forReplications = templates.filter(
            (template) => template.entityType === "replication" && template.archivedAt === null,
          );
          const submit = (event: FormEvent) => {
            event.preventDefault();
            if (viewer === null) return;
            setBusy(true);
            setFailure(null);
            callFunction(saveScheduledReportContract, {
              name: name.trim(),
              templateKey,
              entityType: "replication",
              entityId,
              schedule,
              recipients: [viewer.uid],
              enabled: true,
            })
              .then(() => setName(""))
              .catch((error: unknown) => setFailure(failureText(error)))
              .finally(() => setBusy(false));
          };
          return (
            <div className="grid gap-3">
              {reports.length === 0 ? (
                <p className="text-sm text-fg-secondary">No report is scheduled.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {reports.map((report) => (
                    <li key={report.id} data-testid="scheduled-report">
                      <span className="font-medium">{report.name}</span>:{" "}
                      {report.schedule === "weekly" ? "every Monday" : "on the first day of each month"},{" "}
                      {report.lastRunAt === null
                        ? "not run yet"
                        : `last run ${formatDateTime(report.lastRunAt.toDate())}`}
                    </li>
                  ))}
                </ul>
              )}
              {forReplications.length === 0 ? (
                <p className="text-sm text-fg-secondary">
                  A report needs a template of generated documents for replications, which an administrator of the
                  integrations registers on the integrations page.
                </p>
              ) : (
                <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit} noValidate aria-label="Schedule a report">
                  <FormField label="Name of the report">
                    {(control) => (
                      <Input
                        {...control}
                        value={name}
                        maxLength={100}
                        onChange={(event) => setName(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="Template">
                    {(control) => (
                      <Select {...control} value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
                        <option value="">Choose a template</option>
                        {forReplications.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label="Replication">
                    {(control) => (
                      <Select {...control} value={entityId} onChange={(event) => setEntityId(event.target.value)}>
                        <option value="">Choose a replication</option>
                        {replications.map((replication) => (
                          <option key={replication.id} value={replication.id}>
                            {replication.id}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label="Schedule">
                    {(control) => (
                      <Select
                        {...control}
                        value={schedule}
                        onChange={(event) => setSchedule(event.target.value as "weekly" | "monthly")}
                      >
                        <option value="weekly">Every Monday</option>
                        <option value="monthly">On the first day of each month</option>
                      </Select>
                    )}
                  </FormField>
                  {failure === null ? null : <ErrorState title="The report was not scheduled." description={failure} />}
                  <div>
                    <Button
                      type="submit"
                      disabled={busy || name.trim() === "" || templateKey === "" || entityId === ""}
                    >
                      Schedule the report
                    </Button>
                  </div>
                </form>
              )}
            </div>
          );
        }}
      </LiveView>
    </section>
  );
}

/** Automations and scheduled reports, for holders of `automations.manage`. */
export function AutomationsPage() {
  return (
    <AdminPage
      entryId="admin-automations"
      description="Rules that act when something happens: a fixed list of events and of actions, each run logged, retried through the job queue when it fails, and stopped where it would start itself again."
    >
      <Rules />
      <Runs />
      <ScheduledReports />
    </AdminPage>
  );
}
