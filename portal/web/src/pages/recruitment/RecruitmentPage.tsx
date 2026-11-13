// The recruitment of the programme (docs/DATA_MODEL.md, sections 7 and 15). The latest totals
// of every replication come from the summaries every member reads. Below them, everything is
// worked out in the browser from the reports the account may read, as they stood on the chosen
// date: the rollups by laboratory, replication, country, institution and the programme, target
// against actual, completion, active sites, attrition from recorded to usable, usable N, the
// trend at the end of each month, rates and milestones. Imported historical figures stand apart
// and are never added to live reports.

import {
  attritionPercent,
  completionFigure,
  type ImportedAggregate,
  importedFigures,
  milestoneAchievement,
  monthlyTrend,
  observedRate,
  type ParticipationFacts,
  RECRUITMENT_LENS_LABELS,
  RECRUITMENT_MODALITIES,
  RECRUITMENT_MODALITY_LABELS,
  type RecruitmentLens,
  type RecruitmentModality,
  ROLLUP_DIMENSION_LABELS,
  ROLLUP_DIMENSIONS,
  type RollupDimension,
  type RollupGroup,
  resolveAll,
  resolvedValue,
  rollupBy,
  rollupFigure,
  shiftIsoDate,
  targetFigure,
  UNKNOWN_GROUP,
} from "@eegml/shared";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useNavigableCapabilities } from "@/auth/use-privilege";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { type RecordColumn, RecordTable } from "@/components/record-table";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SortDirection } from "@/components/ui/sort-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { type Live, retryFailedLiveData, useLiveQuery } from "@/data";
import { combineLive } from "@/registry/combine";
import { countryName, formatCount, HISTORICAL_METRIC_LABELS, PARTICIPATION_STATUS_LABELS } from "@/registry/labels";
import { COUNT_CATEGORIES_PATH, laboratoryPath, participationRecruitmentPath, replicationPath } from "@/registry/paths";
import { ALL_HISTORICAL_AGGREGATES, currentCategories } from "@/registry/recruitment-data";
import { dayOf, useTaskData } from "@/registry/task-data";
import { useViewer, type Viewer } from "@/registry/viewer";
import { dateOr, endOfLastMonth, formatDay, formatMonth, startOfMonthsBefore, today } from "./dates";
import { BasisBadges, Figure, figureName, formatDecimal, Percent, ValueCell } from "./figures";
import { type RecruitmentWorld, useRecruitmentWorld } from "./world";

/** The window over which rates are taken, in days. */
export const RATE_WINDOW_DAYS = 90;

/** Days in an average month, to state a daily rate per month. */
const DAYS_PER_MONTH = 30.44;

/** The months a trend shows, the month of the chosen date included. */
const TREND_MONTHS = 12;

const LENSES: readonly RecruitmentLens[] = ["effective", "reported", "verified"];

/** The settings of the page, kept in the address so that a view of a past date can be shared. */
export interface RecruitmentSettings {
  readonly asOf: string;
  readonly lens: RecruitmentLens;
  readonly modality: RecruitmentModality;
  readonly category: string;
  readonly by: RollupDimension;
}

const oneOf = <T extends string>(value: string | null, options: readonly T[], fallback: T): T =>
  value !== null && (options as readonly string[]).includes(value) ? (value as T) : fallback;

export function useRecruitmentSettings(): readonly [RecruitmentSettings, (next: Partial<RecruitmentSettings>) => void] {
  const [params, setParams] = useSearchParams();
  const settings: RecruitmentSettings = {
    asOf: dateOr(params.get("asOf"), today()),
    lens: oneOf(params.get("lens"), LENSES, "effective"),
    modality: oneOf(params.get("modality"), RECRUITMENT_MODALITIES, "main"),
    category: params.get("category") ?? "tested",
    by: oneOf(params.get("by"), ROLLUP_DIMENSIONS, "replication"),
  };
  const change = (next: Partial<RecruitmentSettings>) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        for (const [key, value] of Object.entries(next)) updated.set(key, String(value));
        return updated;
      },
      { replace: true },
    );
  return [settings, change] as const;
}

/** The controls that choose what the page counts and for which date. */
export function RecruitmentControls({
  settings,
  onChange,
  categories,
  showGrouping = true,
}: {
  readonly settings: RecruitmentSettings;
  readonly onChange: (next: Partial<RecruitmentSettings>) => void;
  readonly categories: readonly { readonly key: string; readonly label: string }[];
  readonly showGrouping?: boolean;
}) {
  const [draftDate, setDraftDate] = useState(settings.asOf);
  return (
    <form
      className="grid gap-3 rounded-tile border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
      aria-label="What to count"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ asOf: dateOr(draftDate, settings.asOf) });
      }}
    >
      <FormField label="As of" hint="Shows recruitment as it stood on this day.">
        {(control) => (
          <Input
            {...control}
            type="date"
            max={today()}
            value={draftDate}
            data-testid="recruitment-as-of"
            onChange={(event) => {
              setDraftDate(event.target.value);
              if (event.target.value !== "") onChange({ asOf: dateOr(event.target.value, settings.asOf) });
            }}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2 lg:col-span-1">
        <Button
          size="sm"
          onClick={() => {
            setDraftDate(endOfLastMonth());
            onChange({ asOf: endOfLastMonth() });
          }}
        >
          End of last month
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraftDate(today());
            onChange({ asOf: today() });
          }}
        >
          Today
        </Button>
      </div>
      <FormField label="Values">
        {(control) => (
          <Select
            {...control}
            value={settings.lens}
            onChange={(event) => onChange({ lens: oneOf(event.target.value, LENSES, "effective") })}
          >
            {LENSES.map((lens) => (
              <option key={lens} value={lens}>
                {RECRUITMENT_LENS_LABELS[lens]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Modality">
        {(control) => (
          <Select
            {...control}
            value={settings.modality}
            onChange={(event) => onChange({ modality: oneOf(event.target.value, RECRUITMENT_MODALITIES, "main") })}
          >
            {RECRUITMENT_MODALITIES.map((modality) => (
              <option key={modality} value={modality}>
                {RECRUITMENT_MODALITY_LABELS[modality]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Category">
        {(control) => (
          <Select
            {...control}
            value={settings.category}
            onChange={(event) => onChange({ category: event.target.value })}
          >
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {showGrouping ? (
        <FormField label="Group by">
          {(control) => (
            <Select
              {...control}
              value={settings.by}
              onChange={(event) => onChange({ by: oneOf(event.target.value, ROLLUP_DIMENSIONS, "replication") })}
            >
              {ROLLUP_DIMENSIONS.map((dimension) => (
                <option key={dimension} value={dimension}>
                  {ROLLUP_DIMENSION_LABELS[dimension]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}
    </form>
  );
}

/** A labelled figure of the summary. */
export function Tile({
  term,
  children,
  testId,
}: {
  readonly term: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="grid content-start gap-1 rounded-tile border border-border bg-surface p-3" data-testid={testId}>
      <dt className="text-xs text-fg-muted">{term}</dt>
      <dd className="text-md">{children}</dd>
    </div>
  );
}

/** The figures of some participations on a date: what the summary tiles show. */
export function SummaryTiles({
  facts,
  world,
  settings,
  categoryLabel,
}: {
  readonly facts: readonly ParticipationFacts[];
  readonly world: RecruitmentWorld;
  readonly settings: RecruitmentSettings;
  readonly categoryLabel: (key: string) => string;
}) {
  const { asOf, lens, modality, category } = settings;
  const states = useMemo(
    () =>
      resolveAll(
        facts.map((fact) => fact.id),
        world.data.facts,
        { date: asOf },
      ),
    [facts, world.data.facts, asOf],
  );
  const figure = rollupFigure(facts, states, lens, modality, category);
  const target = targetFigure(facts, states, modality);
  const completion = completionFigure(facts, states, lens, modality, category);
  const usable = rollupFigure(facts, states, lens, modality, "usable");
  const attrition = attritionPercent(facts, states, lens, modality, "recorded", "usable");
  const windowStart = shiftIsoDate(asOf, -RATE_WINDOW_DAYS);
  const rates = facts.map(
    (fact) => observedRate(fact.id, world.data.facts, lens, modality, category, windowStart, asOf).perDay,
  );
  const known = rates.filter((rate): rate is number => rate !== null);
  const monthly = known.length === 0 ? null : known.reduce((sum, rate) => sum + rate, 0) * DAYS_PER_MONTH;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Summary">
      <Tile term={figureName(categoryLabel(category), modality)} testId="tile-actual">
        <Figure figure={figure} testId="figure-actual" />
      </Tile>
      <Tile term={`Target, ${RECRUITMENT_MODALITY_LABELS[modality].toLowerCase()}`} testId="tile-target">
        <Figure figure={target} basisLabel="Agreed target" />
        <span className="block text-xs text-fg-muted">
          The agreed targets, or the reported target where none is agreed.
        </span>
      </Tile>
      <Tile term="Completion" testId="tile-completion">
        <span className="inline-flex flex-wrap items-center gap-2">
          <Percent value={completion.percent} testId="figure-completion" />
          {completion.percent === null ? null : <BasisBadges bases={figure.bases} />}
        </span>
        <span className="block text-xs text-fg-muted">
          From {completion.pairs} of {completion.expected} participations, those that state both the value and a target.
        </span>
      </Tile>
      <Tile term="Active sites" testId="tile-active">
        <span className="tabular-nums">{formatCount(facts.filter((fact) => fact.status === "collecting").length)}</span>
        <span className="block text-xs text-fg-muted">Participations collecting now.</span>
      </Tile>
      <Tile term={figureName(categoryLabel("usable"), modality)} testId="tile-usable">
        <Figure figure={usable} />
      </Tile>
      <Tile term="Quality control attrition, recorded to usable" testId="tile-attrition">
        <span className="inline-flex flex-wrap items-center gap-2">
          <Percent value={attrition.percent} />
          {attrition.percent === null ? null : <BasisBadges bases={attrition.bases} />}
        </span>
        <span className="block text-xs text-fg-muted">
          Over the {attrition.pairs} of {attrition.expected} participations that state both.
        </span>
      </Tile>
      <Tile term="Recruitment rate" testId="tile-rate">
        {monthly === null ? (
          <Unknown>Unknown</Unknown>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{formatDecimal(monthly)} a month</span>
            <BasisBadges
              bases={lens === "reported" ? ["reported"] : lens === "verified" ? ["verified"] : figure.bases}
            />
          </span>
        )}
        <span className="block text-xs text-fg-muted">
          {categoryLabel(category)} over the {RATE_WINDOW_DAYS} days before {formatDay(asOf)}, from {known.length} of{" "}
          {facts.length} participations.
        </span>
      </Tile>
    </dl>
  );
}

function groupLabel(world: RecruitmentWorld, dimension: RollupDimension, key: string): ReactNode {
  switch (dimension) {
    case "programme":
      return "Programme";
    case "replication":
      return (
        <Link className="text-fg-accent underline" to={replicationPath(key)}>
          {key}
        </Link>
      );
    case "laboratory":
      return (
        <Link className="text-fg-accent underline" to={laboratoryPath(key)}>
          {world.laboratoryName(key)}
        </Link>
      );
    case "country":
      return key === UNKNOWN_GROUP ? <Unknown>Country not recorded</Unknown> : countryName(key);
    case "institution":
      return key === UNKNOWN_GROUP ? <Unknown>Institution not recorded</Unknown> : world.institutionName(key);
  }
}

/** The rollup of the chosen figure by a dimension. */
export function RollupTable({
  groups,
  world,
  dimension,
  name,
}: {
  readonly groups: readonly RollupGroup[];
  readonly world: RecruitmentWorld;
  readonly dimension: RollupDimension;
  readonly name: string;
}) {
  return (
    <Table caption={`${name} by ${ROLLUP_DIMENSION_LABELS[dimension].toLowerCase()}`} data-testid="rollup-table">
      <TableHead>
        <TableRow>
          <TableHeaderCell>{ROLLUP_DIMENSION_LABELS[dimension]}</TableHeaderCell>
          <TableHeaderCell>{name}</TableHeaderCell>
          <TableHeaderCell>Target</TableHeaderCell>
          <TableHeaderCell>Completion</TableHeaderCell>
          <TableHeaderCell>Active sites</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {groups.map((group) => (
          <TableRow key={group.key} data-group={group.key}>
            <TableCell>{groupLabel(world, dimension, group.key)}</TableCell>
            <TableCell>
              <Figure figure={group.figure} testId={`rollup-${group.key}`} />
            </TableCell>
            <TableCell>
              <Figure figure={group.target} basisLabel="Agreed target" />
            </TableCell>
            <TableCell>
              <Percent value={group.completion.percent} />
              <span className="block text-xs text-fg-muted">
                from {group.completion.pairs} of {group.completion.expected}
              </span>
            </TableCell>
            <TableCell className="tabular-nums">{formatCount(group.activeSites)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The figure at the end of each month, each reconstructed from the reports as they stood then. */
export function TrendTable({
  facts,
  world,
  settings,
  name,
}: {
  readonly facts: readonly ParticipationFacts[];
  readonly world: RecruitmentWorld;
  readonly settings: RecruitmentSettings;
  readonly name: string;
}) {
  const { asOf, lens, modality, category } = settings;
  const points = useMemo(
    () =>
      monthlyTrend(
        facts,
        world.data.facts,
        lens,
        modality,
        category,
        startOfMonthsBefore(asOf, TREND_MONTHS - 1),
        asOf,
      ),
    [facts, world.data.facts, lens, modality, category, asOf],
  );
  const largest = Math.max(1, ...points.map((point) => point.figure.value ?? 0));
  return (
    <Table caption={`${name} at the end of each month`} data-testid="trend-table">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Month</TableHeaderCell>
          <TableHeaderCell>{name}</TableHeaderCell>
          <TableHeaderCell>Change in the month</TableHeaderCell>
          <TableHeaderCell className="w-1/3">
            <span className="sr-only">Bar</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {points.map((point) => (
          <TableRow key={point.date}>
            <TableCell>{point.date === asOf ? `${formatDay(asOf)}` : formatMonth(point.date)}</TableCell>
            <TableCell>
              <Figure figure={point.figure} />
            </TableCell>
            <TableCell className="tabular-nums">
              {point.change === null ? <Unknown>Unknown</Unknown> : formatCount(point.change)}
            </TableCell>
            <TableCell>
              {point.figure.value === null ? null : (
                <span aria-hidden="true" className="block h-3 rounded-pill bg-surface-muted">
                  <span
                    className="block h-3 rounded-pill bg-accent"
                    style={{ width: `${(point.figure.value / largest) * 100}%` }}
                  />
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface ParticipationRow {
  readonly id: string;
  readonly label: string;
  readonly fact: ParticipationFacts;
  readonly latest: string | null;
  readonly reported: ReturnType<typeof resolvedValue>;
  readonly verified: ReturnType<typeof resolvedValue>;
}

type ParticipationSort = "label" | "latest";

/** Each participation with its lab-reported and verified value side by side. */
export function ParticipationsTable({
  facts,
  world,
  settings,
  name,
}: {
  readonly facts: readonly ParticipationFacts[];
  readonly world: RecruitmentWorld;
  readonly settings: RecruitmentSettings;
  readonly name: string;
}) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<ParticipationSort>("label");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const rows = useMemo((): ParticipationRow[] => {
    const states = resolveAll(
      facts.map((fact) => fact.id),
      world.data.facts,
      { date: settings.asOf },
    );
    const built = facts.map((fact) => {
      const state = states.get(fact.id);
      return {
        id: fact.id,
        label: world.participationLabel(fact.id),
        fact,
        latest: state?.latestAsOfDate ?? null,
        reported: state === undefined ? undefined : resolvedValue(state.reported, settings.modality, settings.category),
        verified: state === undefined ? undefined : resolvedValue(state.verified, settings.modality, settings.category),
      };
    });
    const sign = direction === "asc" ? 1 : -1;
    return built.sort((a, b) =>
      sortKey === "label"
        ? sign * a.label.localeCompare(b.label, "en-GB")
        : sign * ((a.latest ?? "") < (b.latest ?? "") ? -1 : (a.latest ?? "") > (b.latest ?? "") ? 1 : 0),
    );
  }, [facts, world, settings, sortKey, direction]);
  const columns: readonly RecordColumn<ParticipationRow, ParticipationSort>[] = [
    {
      id: "participation",
      header: "Participation",
      sortKey: "label",
      cell: (row) => (
        <Link className="text-fg-accent underline" to={participationRecruitmentPath(row.id)}>
          {row.label}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) =>
        PARTICIPATION_STATUS_LABELS[row.fact.status as keyof typeof PARTICIPATION_STATUS_LABELS] ?? row.fact.status,
    },
    {
      id: "latest",
      header: "Latest report",
      sortKey: "latest",
      cell: (row) => (row.latest === null ? <Unknown>None</Unknown> : formatDay(row.latest)),
    },
    { id: "reported", header: `${name}, reported`, cell: (row) => <ValueCell value={row.reported} /> },
    { id: "verified", header: `${name}, verified`, cell: (row) => <ValueCell value={row.verified} /> },
  ];
  if (rows.length === 0) {
    return (
      <EmptyState title="No participations to show" description="No participation of a scope you hold has started." />
    );
  }
  return (
    <RecordTable
      caption={`Participations, ${name.toLowerCase()}`}
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      rowLabel={(row) => row.label}
      sortKey={sortKey}
      direction={direction}
      onSort={(key) => {
        if (key === sortKey) setDirection(direction === "asc" ? "desc" : "asc");
        else {
          setSortKey(key);
          setDirection("asc");
        }
      }}
      onOpen={(row) => navigate(participationRecruitmentPath(row.id))}
      openKey={null}
      {...(rows.length > 40 ? { virtualise: { rowHeight: 52, viewportHeight: 520 } } : {})}
      data-testid="participations-table"
    />
  );
}

/** The imported historical figures of some replications, which stand apart from live reports. */
export function ImportedHistory({
  aggregates,
  replicationIds,
}: {
  readonly aggregates: readonly ImportedAggregate[];
  readonly replicationIds: ReadonlySet<string>;
}) {
  const figures = importedFigures(aggregates, replicationIds);
  return (
    <section aria-labelledby="imported-history" className="grid gap-2" data-testid="imported-history">
      <h2 id="imported-history" className="text-lg text-fg">
        Imported history
      </h2>
      <p className="max-w-reading text-sm text-fg-secondary">
        Figures from the historical coordination workbooks, as the sources state them. They are never added to the
        reports above, and a figure that describes several replications together is shown once, for all of them.
      </p>
      {figures.length === 0 ? (
        <p className="text-sm text-fg-muted">No historical figures were imported for these replications.</p>
      ) : (
        <Table caption="Imported historical figures">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Figure</TableHeaderCell>
              <TableHeaderCell>Replications</TableHeaderCell>
              <TableHeaderCell>Value</TableHeaderCell>
              <TableHeaderCell>Snapshot</TableHeaderCell>
              <TableHeaderCell>Basis</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {figures.map((figure) => (
              <TableRow key={`${figure.metricKey}:${figure.replicationIds.join()}:${figure.valueSource}`}>
                <TableCell>{HISTORICAL_METRIC_LABELS[figure.metricKey] ?? figure.metricKey}</TableCell>
                <TableCell>{figure.replicationIds.join(" and ")}</TableCell>
                <TableCell className="tabular-nums">
                  {figure.valueNumeric === null ? (
                    <span>
                      {figure.valueSource} <Unknown>(not a number)</Unknown>
                    </span>
                  ) : (
                    formatCount(figure.valueNumeric)
                  )}
                </TableCell>
                <TableCell>
                  {figure.snapshotDate === null ? <Unknown>No date given</Unknown> : formatDay(figure.snapshotDate)}
                </TableCell>
                <TableCell>
                  <BasisBadges bases={["imported"]} />
                  {figure.dataOrigin === "demo" ? <Badge tone="outline">Demonstration</Badge> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** How the milestones of some replications stand on a date. */
export function MilestonesSummary({
  viewer,
  replicationIds,
  asOf,
}: {
  readonly viewer: Viewer;
  readonly replicationIds: ReadonlySet<string> | "all";
  readonly asOf: string;
}) {
  const tasks = useTaskData(viewer);
  return (
    <section aria-labelledby="milestones" className="grid gap-2" data-testid="milestones">
      <h2 id="milestones" className="text-lg text-fg">
        Milestones
      </h2>
      <LiveView
        live={tasks}
        loadingLabel="Loading the milestones"
        errorTitle="The milestones could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(data) => {
          const achievement = milestoneAchievement(
            data.tasks
              .filter(
                (task) =>
                  task.kind === "milestone" &&
                  task.archivedAt === null &&
                  (replicationIds === "all" || (task.replicationId !== null && replicationIds.has(task.replicationId))),
              )
              .map((task) => ({
                id: task.id,
                replicationId: task.replicationId,
                dueDate: dayOf(task.dueAt),
                completedDate: dayOf(task.completedAt),
              })),
            asOf,
          );
          return achievement.total === 0 ? (
            <p className="text-sm text-fg-muted">No milestones are planned in the task lists you can read.</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Tile term="Reached on time">{formatCount(achievement.reachedOnTime)}</Tile>
              <Tile term="Reached late">{formatCount(achievement.reachedLate)}</Tile>
              <Tile term="Overdue">{formatCount(achievement.overdue)}</Tile>
              <Tile term="Ahead">{formatCount(achievement.upcoming)}</Tile>
              <Tile term="Without a date">{formatCount(achievement.undated)}</Tile>
            </dl>
          );
        }}
      </LiveView>
    </section>
  );
}

/** The latest totals of every replication, lab-reported and verified apart, which every member reads. */
function LatestTotals({ settings, name }: { readonly settings: RecruitmentSettings; readonly name: string }) {
  const summaries = useLiveQuery({ collection: "replicationSummaries", within: "group", limit: 1_000 });
  return (
    <section aria-labelledby="latest-totals" className="grid gap-2">
      <h2 id="latest-totals" className="text-lg text-fg">
        Latest totals of every replication
      </h2>
      <p className="max-w-reading text-sm text-fg-secondary">
        The sums of the latest values each participation states, which every member may read. Lab-reported and centrally
        verified figures are kept apart.
      </p>
      <LiveView
        live={summaries}
        loadingLabel="Loading the totals"
        errorTitle="The totals could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(items) => {
          const rows = items
            .filter((item) => item.kind === "recruitment")
            .sort((a, b) => (a.replicationId < b.replicationId ? -1 : 1));
          if (rows.length === 0) return <p className="text-sm text-fg-muted">No replication has reports yet.</p>;
          return (
            <Table caption={`Latest totals, ${name.toLowerCase()}`} data-testid="latest-totals">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Replication</TableHeaderCell>
                  <TableHeaderCell>{name}, reported</TableHeaderCell>
                  <TableHeaderCell>{name}, verified</TableHeaderCell>
                  <TableHeaderCell>Latest report</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const cell = (basis: "labReported" | "centrallyVerified") => {
                    const value = row.totals[basis]?.[settings.modality]?.[settings.category];
                    const stating = row.reporting?.[basis]?.[settings.modality]?.[settings.category] ?? 0;
                    return value === undefined ? (
                      <Unknown>Unknown</Unknown>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="tabular-nums" data-value={value}>
                          {formatCount(value)}
                        </span>
                        <BasisBadges bases={[basis === "labReported" ? "reported" : "verified"]} />
                        <span className="text-xs text-fg-muted">
                          from {stating} of {row.participationCount} participations
                        </span>
                      </span>
                    );
                  };
                  return (
                    <TableRow key={row.replicationId} data-replication={row.replicationId}>
                      <TableCell>
                        <Link className="text-fg-accent underline" to={replicationPath(row.replicationId)}>
                          {row.replicationId}
                        </Link>
                      </TableCell>
                      <TableCell data-testid={`latest-reported-${row.replicationId}`}>{cell("labReported")}</TableCell>
                      <TableCell data-testid={`latest-verified-${row.replicationId}`}>
                        {cell("centrallyVerified")}
                      </TableCell>
                      <TableCell>
                        {row.latestAsOfDate === null ? <Unknown>None</Unknown> : formatDay(row.latestAsOfDate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          );
        }}
      </LiveView>
    </section>
  );
}

function ProgrammeRecruitment({ viewer, world }: { readonly viewer: Viewer; readonly world: RecruitmentWorld }) {
  const [settings, change] = useRecruitmentSettings();
  // The summary figures of the historical workbooks are sealed: programme administrators alone read them.
  const sealedReader = useNavigableCapabilities().has("sealed.read");
  const aggregates = useLiveQuery(sealedReader ? ALL_HISTORICAL_AGGREGATES : null);
  const categories = currentCategories(world.data.categories, "all");
  const label = (key: string) => categories.find((category) => category.key === key)?.label ?? key;
  const name = figureName(label(settings.category), settings.modality);
  // The participations whose reports the account may read: all for programme staff, its scopes otherwise.
  const facts = useMemo(
    () => (viewer.staff ? world.facts : world.facts.filter((fact) => viewer.participationScope(fact) !== null)),
    [viewer, world.facts],
  );
  const groups = useMemo(() => {
    const states = resolveAll(
      facts.map((fact) => fact.id),
      world.data.facts,
      { date: settings.asOf },
    );
    return rollupBy(settings.by, facts, states, settings.lens, settings.modality, settings.category);
  }, [facts, world.data.facts, settings]);
  const replicationIds = useMemo(() => new Set(facts.map((fact) => fact.replicationId)), [facts]);
  const aggregatesLive: Live<readonly ImportedAggregate[]> = combineLive([aggregates] as const, (items) =>
    items.map((item) => ({
      metricKey: item.metricKey,
      valueNumeric: item.valueNumeric ?? null,
      valueSource: item.valueSource,
      snapshotDate: item.snapshotDate ?? null,
      replicationIds: item.replicationIds,
      isCurrent: item.isCurrent,
      dataOrigin: item.dataOrigin,
    })),
  );
  return (
    <div className="grid gap-6">
      <RecruitmentControls settings={settings} onChange={change} categories={categories} />
      <LatestTotals settings={settings} name={name} />
      <section aria-labelledby="as-of" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="as-of" className="text-lg text-fg" data-testid="as-of-heading">
            As of {formatDay(settings.asOf)}
          </h2>
          <p className="max-w-reading text-sm text-fg-secondary">
            Worked out from the reports your account may read, as they stood on that day. Corrections replace what they
            correct, withdrawn reports no longer count, and a value no report states is unknown, never zero.
          </p>
          {world.data.truncated ? (
            <p className="text-sm text-fg-accent">
              More reports exist than one page can read, so these figures may be incomplete.
            </p>
          ) : null}
        </div>
        {facts.length === 0 ? (
          <EmptyState
            title="No reports to work from"
            description="Your account reads the reports of the laboratories and replications it belongs to, and it belongs to none. The latest totals above are for every member."
          />
        ) : (
          <>
            <SummaryTiles facts={facts} world={world} settings={settings} categoryLabel={label} />
            <h3 className="text-md text-fg">By {ROLLUP_DIMENSION_LABELS[settings.by].toLowerCase()}</h3>
            <RollupTable groups={groups} world={world} dimension={settings.by} name={name} />
            <h3 className="text-md text-fg">Trend</h3>
            <TrendTable facts={facts} world={world} settings={settings} name={name} />
            <h3 className="text-md text-fg">Participations</h3>
            <ParticipationsTable facts={facts} world={world} settings={settings} name={name} />
          </>
        )}
      </section>
      {sealedReader ? (
        <LiveView
          live={aggregatesLive}
          loadingLabel="Loading the imported history"
          errorTitle="The imported history could not be loaded."
          onRetry={retryFailedLiveData}
        >
          {(items) => <ImportedHistory aggregates={items} replicationIds={replicationIds} />}
        </LiveView>
      ) : null}
      <MilestonesSummary viewer={viewer} replicationIds={viewer.staff ? "all" : replicationIds} asOf={settings.asOf} />
    </div>
  );
}

export function RecruitmentPage() {
  const viewer = useViewer();
  const world = useRecruitmentWorld(viewer);
  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Participants counted by every laboratory, by replication, country, institution and the programme."
        actions={
          <Button asChild size="sm">
            <Link to={COUNT_CATEGORIES_PATH}>Count categories</Link>
          </Button>
        }
      />
      <LiveView
        live={world}
        loadingLabel="Loading recruitment"
        errorTitle="Recruitment could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(loaded) => (viewer === null ? null : <ProgrammeRecruitment viewer={viewer} world={loaded} />)}
      </LiveView>
    </>
  );
}
