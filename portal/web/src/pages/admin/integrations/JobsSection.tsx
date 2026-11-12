// The jobs of the integrations page: what waits, what runs, what failed and was retried, and the
// plan of each run, cell by cell. A failed run is retried, and a queued one cancelled, through a
// function that records who did it.
import { controlSyncRunContract } from "@eegml/shared";
import { useRef, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import {
  ERROR_KIND_LABELS,
  JOB_KIND_LABELS,
  labelOf,
  MODE_LABELS,
  PLAN_ACTION_LABELS,
  RUN_STATUS_LABELS,
  statLines,
  valueText,
} from "./integration-format";

type Run = RecordOf<"syncRuns">;

/** Which runs the list shows. */
export const RUN_FILTERS = {
  pending: { label: "Waiting or running", statuses: ["queued", "running", "retrying"] },
  errors: { label: "Failed", statuses: ["failed", "deadLetter"] },
  all: { label: "Every run", statuses: null },
} as const;
export type RunFilter = keyof typeof RUN_FILTERS;

const PAGE = 25;

/** Whether a run of a status is listed under a filter. */
function matches(filter: RunFilter, status: string): boolean {
  const statuses: readonly string[] | null = RUN_FILTERS[filter].statuses;
  return statuses === null || statuses.includes(status);
}

/** Whether a run has ended well, so that an error it carries is one of an earlier attempt. */
const SUCCEEDED: ReadonlySet<string> = new Set(["succeeded", "partial", "skipped"]);

/** The error of a run in words: of an earlier attempt where the run succeeded since, or what follows from it. */
export function errorText(run: Pick<Run, "error" | "status">): string {
  if (run.error === undefined) return "";
  if (SUCCEEDED.has(run.status)) return `Earlier attempt: ${run.error}`;
  if (run.status === "retrying") return `${run.error} The run will be retried.`;
  return run.error;
}

/**
 * When a waiting run is due, in words. The ten-minute sweep puts it back in the queue; a time in
 * the past means the sweep has not run since, which is always so under the emulator, where no
 * schedule runs and Retry now moves it on.
 */
export function nextAttemptText(next: Date, now: Date): string {
  return next.getTime() > now.getTime()
    ? `Next attempt ${formatDateTime(next)}`
    : `Retry overdue since ${formatDateTime(next)}. The sweep runs every ten minutes; Retry now moves it on.`;
}

/** The plan and the statistics of one run. */
export function RunDialog({
  run,
  subject,
  onClose,
  returnFocus,
}: {
  run: Run;
  subject: string;
  onClose: () => void;
  /** The control that opened the dialog, which focus returns to when it closes. */
  returnFocus: () => HTMLElement | null;
}) {
  const plan = run.plan ?? [];
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        title={`${JOB_KIND_LABELS[run.kind]}: ${subject}`}
        description={`${MODE_LABELS[run.mode]}, ${labelOf(RUN_STATUS_LABELS, run.status).toLowerCase()}.`}
        className="max-w-3xl"
        returnFocus={returnFocus}
      >
        <div className="mt-4 grid gap-4" data-testid="run-details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-muted">Queued</dt>
            <dd>{formatDateTime(run.queuedAt.toDate())}</dd>
            <dt className="text-fg-muted">Finished</dt>
            <dd>
              {run.finishedAt === null ? <Unknown>Not finished</Unknown> : formatDateTime(run.finishedAt.toDate())}
            </dd>
            <dt className="text-fg-muted">Attempts</dt>
            <dd>
              {run.attempts} of {run.maxAttempts}
            </dd>
            {run.error === undefined ? null : (
              <>
                <dt className="text-fg-muted">
                  {run.errorKind === undefined ? "Note" : ERROR_KIND_LABELS[run.errorKind]}
                </dt>
                <dd>{errorText(run)}</dd>
              </>
            )}
          </dl>
          {statLines(run.stats).length === 0 ? null : (
            <ul className="flex flex-wrap gap-1.5" aria-label="Counts">
              {statLines(run.stats).map((line) => (
                <li key={line}>
                  <Badge tone="outline">{line}</Badge>
                </li>
              ))}
            </ul>
          )}
          {plan.length === 0 ? (
            <p className="text-fg-secondary">The run planned no change.</p>
          ) : (
            <div className="relative max-h-96 overflow-auto">
              <Table caption="The plan of the run">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Action</TableHeaderCell>
                    <TableHeaderCell>Row or section</TableHeaderCell>
                    <TableHeaderCell>Field</TableHeaderCell>
                    <TableHeaderCell>From</TableHeaderCell>
                    <TableHeaderCell>To</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plan.map((entry, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a stored plan is shown as stored and never reordered
                    <TableRow key={index} className="align-top">
                      <TableCell>
                        {PLAN_ACTION_LABELS[entry.action]}
                        {entry.detail === undefined ? null : (
                          <span className="block text-xs text-fg-secondary">{entry.detail}</span>
                        )}
                      </TableCell>
                      <TableCell className="break-all">{entry.rowKey ?? <Unknown>None</Unknown>}</TableCell>
                      <TableCell>{entry.field ?? <Unknown>None</Unknown>}</TableCell>
                      <TableCell>{entry.before === undefined ? null : valueText(entry.before)}</TableCell>
                      <TableCell>{entry.after === undefined ? null : valueText(entry.after)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(run.planOmitted ?? 0) > 0 ? (
                <p className="mt-2 text-sm text-fg-secondary">{run.planOmitted} further entries are not kept.</p>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JobsSection({
  runs,
  subjectOf,
  filter,
  onFilter,
}: {
  runs: readonly Run[];
  /** What a run is about, in words. */
  subjectOf: (run: Run) => string;
  filter: RunFilter;
  onFilter: (filter: RunFilter) => void;
}) {
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [shown, setShown] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const list = runs.filter((run) => matches(filter, run.status));
  const act = async (run: Run, action: "retry" | "cancel") => {
    setBusy(run.id);
    try {
      await callFunction(controlSyncRunContract, { runId: run.id, action });
      toast.show({ title: action === "retry" ? "The run is queued again." : "The run is cancelled." });
      // The run may leave the list it was in, and its row with it, so focus goes to the heading.
      heading.current?.focus();
    } catch (error) {
      toast.show({ title: "Nothing was changed.", description: error instanceof CallableError ? error.message : "" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-labelledby="jobs-heading" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="jobs-heading" ref={heading} tabIndex={-1} className="text-lg text-fg-strong">
          Jobs
        </h2>
        <FormField label="Show" className="w-64">
          {(control) => (
            <Select
              {...control}
              value={filter}
              onChange={(event) => {
                onFilter(event.target.value as RunFilter);
                setOffset(0);
              }}
            >
              {(Object.keys(RUN_FILTERS) as RunFilter[]).map((key) => (
                <option key={key} value={key}>
                  {`${RUN_FILTERS[key].label} (${runs.filter((run) => matches(key, run.status)).length})`}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      {list.length === 0 ? (
        <EmptyState
          title="No run to show"
          description={
            runs.length === 0
              ? "Runs are listed here from the moment they are queued."
              : `${runs.length} ${runs.length === 1 ? "run is" : "runs are"} hidden by this filter. Choose ${RUN_FILTERS.all.label} to see ${runs.length === 1 ? "it" : "them"}.`
          }
        />
      ) : (
        <>
          <div className="relative overflow-x-auto">
            <Table caption="Runs, latest first">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Job</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Attempts</TableHeaderCell>
                  <TableHeaderCell>Queued</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.slice(offset, offset + PAGE).map((run) => (
                  <TableRow key={run.id} className="align-top" data-testid="run-row">
                    <TableCell>
                      <span className="text-fg-strong">{JOB_KIND_LABELS[run.kind]}</span>
                      <span className="block text-xs text-fg-muted">
                        {subjectOf(run)}, {MODE_LABELS[run.mode].toLowerCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge tone={["failed", "deadLetter", "retrying"].includes(run.status) ? "accent" : "neutral"}>
                        {labelOf(RUN_STATUS_LABELS, run.status)}
                      </Badge>
                      {run.error === undefined ? null : (
                        <span className="mt-1 block text-xs text-fg-secondary">{errorText(run)}</span>
                      )}
                      {run.nextAttemptAt === null || run.status !== "retrying" ? null : (
                        <span className="block text-xs text-fg-muted">
                          {nextAttemptText(run.nextAttemptAt.toDate(), new Date())}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {run.attempts} of {run.maxAttempts}
                    </TableCell>
                    <TableCell>{formatDateTime(run.queuedAt.toDate())}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            opener.current = event.currentTarget;
                            setShown(run);
                          }}
                        >
                          Details<span className="sr-only"> of the run of {subjectOf(run)}</span>
                        </Button>
                        {["failed", "deadLetter", "retrying"].includes(run.status) ? (
                          <Button size="sm" disabled={busy === run.id} onClick={() => void act(run, "retry")}>
                            Retry now<span className="sr-only"> the run of {subjectOf(run)}</span>
                          </Button>
                        ) : null}
                        {["queued", "retrying"].includes(run.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === run.id}
                            onClick={() => void act(run, "cancel")}
                          >
                            Cancel<span className="sr-only"> the run of {subjectOf(run)}</span>
                          </Button>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} pageSize={PAGE} total={list.length} label="runs" onChange={setOffset} />
        </>
      )}
      {shown === null ? null : (
        <RunDialog
          run={shown}
          subject={subjectOf(shown)}
          onClose={() => setShown(null)}
          returnFocus={() => opener.current}
        />
      )}
    </section>
  );
}
