// The programme overview (requirements R15.1 and R15.5): active replications, laboratories and
// members; recruitment targets and usable participants as of any date, past dates included,
// through the resolver of phase 5; the dataset and QC pipeline; overdue tasks, milestones and
// stalled projects; and, for those who decide them, pending claims and integration errors, with
// the recent activity of the workspace. Every figure opens the records behind it, and every list
// can be exported. Each figure is computed from the documents the reader's own permissions load.
import { type ExportTable, resolveAll, rollupFigure, shiftIsoDate, targetFigure } from "@eegml/shared";
import { type ReactNode, useState } from "react";
import { useSearchParams } from "react-router";
import { formatDate, formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { type Live, type LiveQuery, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { usePendingAccountClaims, usePendingLabClaims } from "@/pages/admin/queues";
import { useRecruitmentWorld } from "@/pages/recruitment/world";
import { combineLive, orEmpty } from "@/registry/combine";
import { datasetPath, laboratoryPath, memberPath, replicationPath } from "@/registry/paths";
import {
  ALL_DATASETS,
  ALL_LABORATORIES,
  ALL_PERSONS,
  ALL_REPLICATIONS,
  REPLICATION_STATUS_DEFINITIONS,
} from "@/registry/queries";
import { finishedStatus, useTaskData } from "@/registry/task-data";
import { useViewer, type Viewer } from "@/registry/viewer";
import { ExportMenu } from "@/views/ExportMenu";
import { originNoteOf } from "@/views/origins";

/** A replication is stalled when no laboratory has reported its recruitment for this many days. */
export const STALLED_AFTER_DAYS = 60;

interface Item {
  readonly label: string;
  readonly detail?: string;
  readonly to: string | null;
}

const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function itemsTable(title: string, items: readonly Item[]): ExportTable {
  return { title, columns: ["Record", "Detail"], rows: items.map((item) => [item.label, item.detail ?? null]) };
}

/**
 * A figure of the overview: its number, what it counts, the records behind it, and where those
 * records came from wherever any is not live, here, in its list and in its export.
 */
function Tile({
  title,
  items,
  note,
  figure,
  origins,
}: {
  title: string;
  items: readonly Item[];
  note?: string;
  figure?: ReactNode;
  /** The `dataOrigin` of each record behind the figure. */
  origins?: readonly unknown[];
}) {
  const [open, setOpen] = useState(false);
  const origin = originNoteOf(origins ?? []);
  const table = (): ExportTable => {
    const listed = itemsTable(title, items);
    return origin === null ? listed : { ...listed, rows: [...listed.rows, [origin, null]] };
  };
  return (
    <div
      className="grid content-start gap-1 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="overview-tile"
    >
      <h3 className="text-sm text-fg-secondary">{title}</h3>
      <p className="text-3xl text-fg tabular-nums" data-testid="overview-figure">
        {figure ?? items.length}
      </p>
      {note === undefined ? null : <p className="text-xs text-fg-muted">{note}</p>}
      {origin === null ? null : (
        <p className="text-xs text-fg-muted" data-testid="origin-note">
          {origin}
        </p>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="justify-self-start px-0 print:hidden"
        aria-label={`Show the records behind ${title}`}
        onClick={() => setOpen(true)}
      >
        Show the records
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title}>
          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">{origin ?? ""}</p>
              <ExportMenu table={table} />
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing is counted here.</p>
            ) : (
              <ul className="grid max-h-96 gap-1 overflow-y-auto" data-testid="drill-down-records">
                {items.map((item) => (
                  <li key={`${item.label}/${item.detail ?? ""}`} className="text-sm">
                    {item.to === null ? (
                      item.label
                    ) : (
                      <a className="text-fg-accent underline" href={`#${item.to}`}>
                        {item.label}
                      </a>
                    )}
                    {item.detail === undefined ? null : <span className="text-fg-secondary">: {item.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <h2 className="text-lg">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Directory() {
  const live = combineLive(
    [
      useLiveQuery(ALL_REPLICATIONS),
      useLiveQuery(REPLICATION_STATUS_DEFINITIONS),
      useLiveQuery(ALL_LABORATORIES),
      useLiveQuery(ALL_PERSONS),
    ] as const,
    (replications, statuses, laboratories, persons) => ({ replications, statuses, laboratories, persons }),
  );
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the directory"
      errorTitle="The directory could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {({ replications, statuses, laboratories, persons }) => {
        const active = new Set(statuses.filter((status) => status.category === "active").map((status) => status.key));
        const activeReplications = replications.filter(
          (replication) =>
            replication.archivedAt === null && replication.statusKey !== null && active.has(replication.statusKey),
        );
        const activeLaboratories = laboratories.filter(
          (laboratory) => laboratory.archivedAt === null && laboratory.status === "active",
        );
        const members = persons.filter((person) => person.archivedAt === null);
        const withAccount = members.filter((person) => person.userId !== null);
        return (
          <Section title="Replications, laboratories and members">
            <Tile
              title="Active replications"
              items={activeReplications.map((replication) => ({
                label: replication.id,
                detail: replication.shortTitle,
                to: replicationPath(replication.id),
              }))}
              origins={activeReplications.map((replication) => replication.dataOrigin)}
            />
            <Tile
              title="Active laboratories"
              items={activeLaboratories.map((laboratory) => ({
                label: laboratory.name,
                detail: laboratory.city,
                to: laboratoryPath(laboratory.id),
              }))}
              origins={activeLaboratories.map((laboratory) => laboratory.dataOrigin)}
            />
            <Tile
              title="Members"
              items={members.map((person) => ({
                label: person.displayName,
                detail: person.affiliationSummary,
                to: memberPath(person.id),
              }))}
              origins={members.map((person) => person.dataOrigin)}
            />
            <Tile
              title="Members with an account"
              items={withAccount.map((person) => ({ label: person.displayName, to: memberPath(person.id) }))}
              origins={withAccount.map((person) => person.dataOrigin)}
            />
          </Section>
        );
      }}
    </LiveView>
  );
}

function Recruitment({ viewer, asOf }: { viewer: Viewer; asOf: string }) {
  const world = useRecruitmentWorld(viewer);
  return (
    <LiveView
      live={world}
      loadingLabel="Loading recruitment"
      errorTitle="Recruitment could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(data) => {
        const states = resolveAll(
          data.facts.map((fact) => fact.id),
          data.data.facts,
          { date: asOf },
        );
        const figureOf = (value: number | null) => (value === null ? "Unknown" : value.toLocaleString("en-GB"));
        const usable = rollupFigure(data.facts, states, "effective", "participants", "usable");
        const target = targetFigure(data.facts, states, "participants");
        const tested = rollupFigure(data.facts, states, "effective", "participants", "tested");
        const byParticipation = (category: string): Item[] =>
          data.facts.flatMap((fact) => {
            const one = rollupFigure([fact], states, "effective", "participants", category);
            return one.value === null
              ? []
              : [
                  {
                    label: data.participationLabel(fact.id),
                    detail: `${one.value}`,
                    to: `/recruitment/participations/${encodeURIComponent(fact.id)}`,
                  },
                ];
          });
        // A replication is stalled where the latest report of its participations is older than the threshold.
        const cutoff = shiftIsoDate(asOf, -STALLED_AFTER_DAYS);
        const latest = new Map<string, string>();
        for (const report of data.data.facts) {
          if (report.asOfDate > asOf) continue;
          const replicationId = data.participations.find(
            (participation) => participation.id === report.participationId,
          )?.replicationId;
          if (replicationId === undefined) continue;
          if ((latest.get(replicationId) ?? "") < report.asOfDate) latest.set(replicationId, report.asOfDate);
        }
        const collecting = new Set(
          data.participations
            .filter((participation) => participation.status === "collecting")
            .map((participation) => participation.replicationId),
        );
        const stalled = [...collecting]
          .filter((replicationId) => (latest.get(replicationId) ?? "") < cutoff)
          .map((replicationId) => ({
            label: replicationId,
            detail: latest.has(replicationId)
              ? `last report ${formatDate(latest.get(replicationId) ?? "")}`
              : "no report yet",
            to: replicationPath(replicationId),
          }));
        const reportOrigins = data.data.reports
          .filter((report) => report.asOfDate <= asOf)
          .map((report) => report.dataOrigin);
        return (
          <Section title={`Recruitment as of ${formatDate(asOf)}`}>
            <Tile
              title="Target, unique participants"
              origins={reportOrigins}
              items={[]}
              figure={figureOf(target.value)}
              note={`Stated by ${target.known} of ${target.expected} participations.`}
            />
            <Tile
              title="Tested, unique participants"
              origins={reportOrigins}
              items={byParticipation("tested")}
              figure={figureOf(tested.value)}
              note="Never the sum of main experiment and resting state."
            />
            <Tile
              title="Usable N, unique participants"
              origins={reportOrigins}
              items={byParticipation("usable")}
              figure={figureOf(usable.value)}
              note={`Stated by ${usable.known} of ${usable.expected} participations.`}
            />
            <Tile
              title="Stalled replications"
              items={stalled}
              note={`Collecting, with no report in the ${STALLED_AFTER_DAYS} days before this date.`}
            />
          </Section>
        );
      }}
    </LiveView>
  );
}

function Datasets() {
  const datasets = useLiveQuery(ALL_DATASETS);
  return (
    <LiveView
      live={datasets}
      loadingLabel="Loading the datasets"
      errorTitle="The datasets could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => {
        const current = list.filter((dataset) => dataset.archivedAt === null);
        const itemOf = (dataset: RecordOf<"datasets">) => ({
          label: dataset.title,
          detail: dataset.datasetKey,
          to: datasetPath(dataset.id),
        });
        const originOf = (dataset: RecordOf<"datasets">) => dataset.dataOrigin;
        const received = current.filter((dataset) => dataset.receivedAt !== undefined);
        const pending = current.filter((dataset) => dataset.qcStatus === "pending");
        const ready = current.filter((dataset) => dataset.analysisReady);
        return (
          <Section title="Dataset and QC pipeline">
            <Tile title="Datasets registered" items={current.map(itemOf)} origins={current.map(originOf)} />
            <Tile title="Data received" items={received.map(itemOf)} origins={received.map(originOf)} />
            <Tile title="QC pending" items={pending.map(itemOf)} origins={pending.map(originOf)} />
            <Tile title="Analysis ready" items={ready.map(itemOf)} origins={ready.map(originOf)} />
          </Section>
        );
      }}
    </LiveView>
  );
}

function Work({ viewer, asOf }: { viewer: Viewer; asOf: string }) {
  const tasks = useTaskData(viewer);
  return (
    <LiveView
      live={tasks}
      loadingLabel="Loading the tasks"
      errorTitle="The tasks could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(data) => {
        const open = data.tasks.filter((task) => task.archivedAt === null && !finishedStatus(data, task.statusKey));
        const day = (task: RecordOf<"tasks">) =>
          task.dueAt === null || task.dueAt === undefined ? null : task.dueAt.toDate().toISOString().slice(0, 10);
        const itemOf = (task: RecordOf<"tasks">) => ({
          label: task.title,
          detail: day(task) === null ? "no due date" : `due ${formatDate(day(task) ?? "")}`,
          to: `/tasks?task=${encodeURIComponent(task.id)}`,
        });
        const overdue = open.filter((task) => task.kind === "task" && (day(task) ?? "9999") < asOf);
        const milestones = open.filter((task) => task.kind === "milestone");
        const reached = data.tasks.filter((task) => task.kind === "milestone" && finishedStatus(data, task.statusKey));
        return (
          <Section title="Tasks and milestones">
            <Tile title="Overdue tasks" items={overdue.map(itemOf)} />
            <Tile title="Open milestones" items={milestones.map(itemOf)} />
            <Tile
              title="Overdue milestones"
              items={milestones.filter((task) => (day(task) ?? "9999") < asOf).map(itemOf)}
            />
            <Tile title="Milestones reached" items={reached.map(itemOf)} />
          </Section>
        );
      }}
    </LiveView>
  );
}

const ATTENTION_CONNECTIONS: LiveQuery<"integrationConnections"> = {
  collection: "integrationConnections",
  within: [],
  limit: 20,
};
const FAILED_JOBS: LiveQuery<"syncRuns"> = {
  collection: "syncRuns",
  within: [],
  where: [["status", "in", ["deadLetter", "failed"]]],
  limit: 200,
};
const OPEN_FAILURES: LiveQuery<"eventFailures"> = {
  collection: "eventFailures",
  within: [],
  where: [["resolvedAt", "==", null]],
  limit: 200,
};

function Attention({ viewer }: { viewer: Viewer }) {
  const integrations = viewer.can("integrations.manage", "programme");
  const automations = viewer.can("automations.manage", "programme");
  const claims = usePendingAccountClaims(viewer.can("claims.review", "programme"));
  const labClaims = usePendingLabClaims(viewer.access);
  const live = combineLive(
    [
      orEmpty(useLiveQuery(integrations ? ATTENTION_CONNECTIONS : null)),
      orEmpty(useLiveQuery(integrations ? FAILED_JOBS : null)),
      orEmpty(useLiveQuery(automations ? OPEN_FAILURES : null)),
      orEmpty(labClaims),
    ] as const,
    (connections, jobs, failures, laboratoryClaims) => ({ connections, jobs, failures, laboratoryClaims }),
  );
  const accountClaims: Live<number | null> =
    claims.live.status === "ready"
      ? { ...claims.live, data: claims.live.data.claims.length }
      : claims.live.status === "idle"
        ? { status: "ready", data: null, fromCache: false, hasPendingWrites: false }
        : claims.live;
  return (
    <LiveView
      live={combineLive([live, accountClaims] as const, (rest, count) => ({ ...rest, count }))}
      loadingLabel="Loading what needs attention"
      errorTitle="What needs attention could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {({ connections, jobs, failures, laboratoryClaims, count }) => (
        <Section title="Needs attention">
          {count === null ? null : (
            <Tile
              title="Account claims to review"
              items={[]}
              figure={count}
              note="Decided on the account claims page."
            />
          )}
          <Tile
            title="Laboratory claims to review"
            items={laboratoryClaims.map((claim) => ({
              label: claim.laboratoryId,
              detail: "waiting for review",
              to: "/admin/lab-claims",
            }))}
          />
          {integrations ? (
            <Tile
              title="Integration errors"
              items={[
                ...connections
                  .filter((connection) => connection.status === "needsAttention" || connection.status === "degraded")
                  .map((connection) => ({
                    label: connection.system,
                    detail: connection.statusReason ?? connection.status,
                    to: "/admin/integrations",
                  })),
                ...jobs.map((job) => ({
                  label: `Job ${job.id}`,
                  detail: job.error ?? job.status,
                  to: "/admin/integrations",
                })),
              ]}
            />
          ) : null}
          {automations ? (
            <Tile
              title="Failed automations"
              items={failures.map((failure) => ({
                label: failure.consumer,
                detail: failure.error,
                to: "/admin/automations",
              }))}
            />
          ) : null}
        </Section>
      )}
    </LiveView>
  );
}

function Activity({ viewer }: { viewer: Viewer }) {
  const query: LiveQuery<"activity"> = viewer.staff
    ? { collection: "activity", within: [], orderBy: [["createdAt", "desc"]], limit: 15 }
    : {
        collection: "activity",
        within: [],
        where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]],
        orderBy: [["createdAt", "desc"]],
        limit: 15,
      };
  const live = useLiveQuery(query);
  return (
    <section className="grid gap-3" aria-label="Recent activity">
      <h2 className="text-lg">Recent activity</h2>
      <LiveView
        live={live}
        loadingLabel="Loading the activity"
        errorTitle="The activity could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(entries) =>
          entries.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing has happened yet.</p>
          ) : (
            <ol className="grid gap-1 text-sm">
              {entries.map((entry) => (
                <li key={entry.id}>
                  {entry.title ?? entry.entityType}: {entry.action.replace(/^document\./, "")}{" "}
                  <time className="text-fg-muted">{formatDateTime(entry.createdAt.toDate())}</time>
                </li>
              ))}
            </ol>
          )
        }
      </LiveView>
    </section>
  );
}

export function OverviewPage() {
  const viewer = useViewer();
  const [parameters, setParameters] = useSearchParams();
  const today = todayIso();
  const requested = parameters.get("asOf") ?? "";
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today;
  const [draft, setDraft] = useState(asOf);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Programme overview"
        description="The state of the programme from the records your account may read. Every figure opens the records behind it, and recruitment can be shown as it stood on any past date."
        actions={
          <form
            className="flex flex-wrap items-end gap-2 print:hidden"
            onSubmit={(event) => {
              event.preventDefault();
              const next = new URLSearchParams(parameters);
              if (draft === today || draft === "") next.delete("asOf");
              else next.set("asOf", draft);
              setParameters(next, { replace: true });
            }}
          >
            <FormField label="As of">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
            </FormField>
            <Button type="submit">Show</Button>
            <Button onClick={() => window.print()}>Save as PDF</Button>
          </form>
        }
      />
      {asOf === today ? null : (
        <p className="text-sm text-fg-accent" role="status">
          Recruitment, tasks and stalled replications are shown as they stood on {formatDate(asOf)}. The directory and
          the pipeline show their current state.
        </p>
      )}
      {viewer === null ? null : (
        <>
          <Directory />
          <Recruitment viewer={viewer} asOf={asOf} />
          <Datasets />
          <Work viewer={viewer} asOf={asOf} />
          <Attention viewer={viewer} />
          <Activity viewer={viewer} />
        </>
      )}
    </div>
  );
}
