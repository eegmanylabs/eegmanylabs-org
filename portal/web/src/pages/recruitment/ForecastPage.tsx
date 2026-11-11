// The forecast of a replication (docs/DATA_MODEL.md, section 15): the stated assumptions beside
// the result, which is worked out again in the browser whenever an assumption changes, with the
// method of the shared package that `generateForecast` runs on the server to store a run. Every
// figure of a forecast is projected and is labelled so.
import {
  defaultAssumptions,
  FORECAST_SCENARIO_LABELS,
  FORECAST_SCENARIOS,
  type ForecastAssumptions,
  type ForecastResult,
  forecastAssumptionsSchema,
  forecastRecruitment,
  generateForecastContract,
  isFirestoreTimestamp,
  RECRUITMENT_MODALITY_LABELS,
  readForecastRun,
  type ScenarioResult,
} from "@eegml/shared";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, retryFailedLiveData, useLiveQuery } from "@/data";
import { formatCount } from "@/registry/labels";
import { replicationPath } from "@/registry/paths";
import { currentCategories, forecastRunsOf, pauseFacts } from "@/registry/recruitment-data";
import { useViewer, type Viewer } from "@/registry/viewer";
import { formatDay, formatMonth, today } from "./dates";
import { BasisBadges, formatDecimal } from "./figures";
import { type RecruitmentWorld, useRecruitmentWorld } from "./world";

/** The days in an average month, to state a daily rate per month. */
const DAYS_PER_MONTH = 30.44;

/** The text of each assumption as the form holds it, so that a half-typed number is kept as typed. */
interface Draft {
  readonly modality: "main" | "rest";
  readonly category: string;
  readonly target: string;
  readonly exclusionPercent: string;
  readonly windowDays: string;
  readonly spreadPercent: string;
  readonly inputsAsOf: string;
  readonly includePlannedPauses: boolean;
  readonly activeParticipationIds: readonly string[];
}

const draftOf = (assumptions: ForecastAssumptions): Draft => ({
  modality: assumptions.modality,
  category: assumptions.category,
  target: assumptions.target === null ? "" : String(assumptions.target),
  exclusionPercent: String(Math.round(assumptions.exclusionRate * 1000) / 10),
  windowDays: String(assumptions.windowDays),
  spreadPercent: String(Math.round(assumptions.scenarioSpread * 1000) / 10),
  inputsAsOf: assumptions.inputsAsOf,
  includePlannedPauses: assumptions.includePlannedPauses,
  activeParticipationIds: assumptions.activeParticipationIds,
});

/** The assumptions a draft states, or null where a field does not hold a value the method accepts. */
function assumptionsOf(draft: Draft): ForecastAssumptions | null {
  const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
  const parsed = forecastAssumptionsSchema.safeParse({
    modality: draft.modality,
    category: draft.category,
    target: draft.target.trim() === "" ? null : number(draft.target),
    exclusionRate: number(draft.exclusionPercent) / 100,
    windowDays: number(draft.windowDays),
    scenarioSpread: number(draft.spreadPercent) / 100,
    activeParticipationIds: [...draft.activeParticipationIds].sort(),
    includePlannedPauses: draft.includePlannedPauses,
    inputsAsOf: draft.inputsAsOf,
  });
  return parsed.success ? parsed.data : null;
}

/** A rate a month with its range, the range left out where it adds nothing. */
function monthlyRange(rate: number, low: number | null, high: number | null): string {
  const text = (value: number) => formatDecimal(value * DAYS_PER_MONTH);
  const lower = text(low ?? rate);
  const upper = text(high ?? rate);
  return lower === upper ? text(rate) : `${text(rate)} (${lower} to ${upper})`;
}

/** What a scenario says where no laboratory gives a rate: nothing about how fast or when. */
const NO_RATE = "Unknown: no laboratory has two dated values in the window";

const day = (date: string | null) => (date === null ? <Unknown>Not within five years</Unknown> : formatDay(date));

/** The range of completion dates of a scenario, said once where both ends agree. */
function completionRange(scenario: ScenarioResult) {
  if (scenario.dailyRate === null) return <Unknown>{NO_RATE}</Unknown>;
  const { earliestCompletionDate: earliest, latestCompletionDate: latest } = scenario;
  if (earliest === latest) return day(earliest);
  return (
    <>
      {day(earliest)} to {day(latest)}
    </>
  );
}

/** The central completion of a stored run in words, for the list of stored forecasts. */
function storedCompletion(central: ScenarioResult): string {
  if (central.dailyRate === null) return "central completion unknown, as no laboratory had a rate";
  return central.completionDate === null
    ? "central completion not within five years"
    : `central completion ${formatDay(central.completionDate)}`;
}

/** The result of a forecast, every figure labelled projected. */
function ForecastResultView({
  result,
  world,
  categoryLabel,
  modality,
}: {
  readonly result: ForecastResult;
  readonly world: RecruitmentWorld;
  readonly categoryLabel: string;
  readonly modality: "main" | "rest";
}) {
  const what = `${categoryLabel}, ${RECRUITMENT_MODALITY_LABELS[modality].toLowerCase()}`;
  return (
    <div className="grid gap-4" data-testid="forecast-result">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline" data-basis="projected">
          Projected
        </Badge>
        <span className="text-sm text-fg-secondary">
          Method {result.methodVersion}, from the reports up to {formatDay(result.inputsAsOf)}.
        </span>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1 rounded-tile border border-border bg-surface p-3">
          <dt className="text-xs text-fg-muted">{what}, now</dt>
          <dd className="tabular-nums" data-testid="forecast-current">
            <span className="inline-flex flex-wrap items-center gap-2">
              {formatCount(result.current)}
              <BasisBadges bases={result.currentBases} />
            </span>
            <span className="block text-xs text-fg-muted">
              The value that holds now, not projected, from {result.currentKnown} of {result.currentExpected}{" "}
              participations.
            </span>
          </dd>
        </div>
        <div className="grid gap-1 rounded-tile border border-border bg-surface p-3">
          <dt className="text-xs text-fg-muted">Target after exclusions</dt>
          <dd className="tabular-nums" data-testid="forecast-target">
            {result.target === null ? <Unknown>Unknown</Unknown> : formatCount(result.target)}
            <span className="block text-xs text-fg-muted">
              {result.targetBasis === "stated"
                ? "As stated."
                : result.targetBasis === "agreed"
                  ? "The sum of the agreed targets."
                  : result.targetBasis === "agreedIncomplete"
                    ? "The sum of the agreed targets, some missing."
                    : "No target is known."}
            </span>
          </dd>
        </div>
        <div className="grid gap-1 rounded-tile border border-border bg-surface p-3">
          <dt className="text-xs text-fg-muted">To count before exclusions</dt>
          <dd className="tabular-nums" data-testid="forecast-aim">
            {result.aim === null ? <Unknown>Unknown</Unknown> : formatCount(result.aim)}
          </dd>
        </div>
      </dl>
      <Table caption="Scenarios, projected" data-testid="forecast-scenarios">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Scenario</TableHeaderCell>
            <TableHeaderCell>Rate, projected</TableHeaderCell>
            <TableHeaderCell>Completion, projected</TableHeaderCell>
            <TableHeaderCell>Range</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {FORECAST_SCENARIOS.map((scenario) => {
            const values = result.scenarios[scenario];
            return (
              <TableRow key={scenario} data-scenario={scenario}>
                <TableHeaderCell scope="row" className="font-normal">
                  {FORECAST_SCENARIO_LABELS[scenario]}
                </TableHeaderCell>
                <TableCell className="tabular-nums" data-testid={`rate-${scenario}`}>
                  {values.dailyRate === null ? (
                    <Unknown>{NO_RATE}</Unknown>
                  ) : (
                    `${formatDecimal(values.dailyRate * DAYS_PER_MONTH)} a month`
                  )}
                </TableCell>
                <TableCell data-testid={`completion-${scenario}`}>
                  {values.dailyRate === null ? <Unknown>Unknown</Unknown> : day(values.completionDate)}
                </TableCell>
                <TableCell>{completionRange(values)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {result.scenarios.central.series.length === 0 ? null : (
        <Table caption="Central scenario by month, projected">
          <TableHead>
            <TableRow>
              <TableHeaderCell>End of month</TableHeaderCell>
              <TableHeaderCell>Central, projected</TableHeaderCell>
              <TableHeaderCell>Range, projected</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.scenarios.central.series.map((point) => (
              <TableRow key={point.date}>
                <TableCell>{formatMonth(point.date)}</TableCell>
                <TableCell className="tabular-nums">{formatCount(point.value)}</TableCell>
                <TableCell className="tabular-nums">
                  {point.low === point.high
                    ? formatCount(point.low)
                    : `${formatCount(point.low)} to ${formatCount(point.high)}`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Table caption="Laboratories, as the forecast reads them">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Laboratory</TableHeaderCell>
            <TableHeaderCell>Active</TableHeaderCell>
            <TableHeaderCell>Now</TableHeaderCell>
            <TableHeaderCell>Rate a month</TableHeaderCell>
            <TableHeaderCell>Paused days</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.laboratories.map((laboratory) => (
            <TableRow key={laboratory.participationId}>
              <TableCell>{world.laboratoryName(laboratory.laboratoryId)}</TableCell>
              <TableCell>{laboratory.active ? "Yes" : "No"}</TableCell>
              <TableCell className="tabular-nums">
                {laboratory.current === null ? <Unknown>Unknown</Unknown> : formatCount(laboratory.current)}
              </TableCell>
              <TableCell className="tabular-nums">
                {laboratory.rate === null ? (
                  <Unknown>Too few reports</Unknown>
                ) : (
                  monthlyRange(laboratory.rate, laboratory.rateLow, laboratory.rateHigh)
                )}
              </TableCell>
              <TableCell className="tabular-nums">{formatCount(laboratory.pausedDays)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {result.notes.length === 0 ? null : (
        <ul className="grid list-disc gap-1 pl-5 text-sm text-fg-secondary" aria-label="What limits this forecast">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Forecast({
  viewer,
  world,
  studyKey,
}: {
  readonly viewer: Viewer;
  readonly world: RecruitmentWorld;
  readonly studyKey: string;
}) {
  const toast = useToast();
  const facts = useMemo(() => world.facts.filter((fact) => fact.replicationId === studyKey), [world.facts, studyKey]);
  const reports = useMemo(
    () => world.data.facts.filter((fact) => facts.some((participation) => participation.id === fact.participationId)),
    [world.data.facts, facts],
  );
  const pauses = useMemo(
    () => pauseFacts(world.data.pauses.filter((pause) => pause.replicationId === studyKey)),
    [world.data.pauses, studyKey],
  );
  const categories = currentCategories(world.data.categories, new Set([studyKey]));
  const [draft, setDraft] = useState<Draft>(() => draftOf(defaultAssumptions(facts, today())));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const runs = useLiveQuery(forecastRunsOf(studyKey));
  const assumptions = assumptionsOf(draft);
  const result = useMemo(
    () => (assumptions === null ? null : forecastRecruitment(facts, reports, pauses, assumptions)),
    [facts, reports, pauses, assumptions],
  );
  const canSave = viewer.access.member && viewer.can("replications.manage", { replicationId: studyKey });
  const reads = viewer.staff || facts.some((fact) => viewer.participationScope(fact) !== null);
  const set = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const categoryLabel = categories.find((category) => category.key === draft.category)?.label ?? draft.category;

  const save = async () => {
    if (assumptions === null) return;
    setSaving(true);
    setFailure(null);
    try {
      await callFunction(generateForecastContract, { replicationId: studyKey, assumptions });
      toast.show({
        title: "The forecast has been stored.",
        description: "It is listed under stored forecasts, labelled projected.",
      });
    } catch (error) {
      setFailure(
        error instanceof CallableError ? error.message : "The forecast was not stored. Try again in a moment.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      {reads ? null : (
        <p className="max-w-reading text-sm text-fg-secondary">
          Your account cannot read the reports of this replication, so the forecast below starts from none. Stored
          forecasts, which its leads computed from every report, are listed at the end of the page.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <form
          aria-label="Assumptions"
          className="grid content-start gap-3 rounded-tile border border-border bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void save();
          }}
          data-testid="forecast-assumptions"
        >
          <h2 className="text-lg text-fg">Assumptions</h2>
          <FormField label="Modality">
            {(control) => (
              <Select
                {...control}
                value={draft.modality}
                onChange={(event) => set({ modality: event.target.value === "rest" ? "rest" : "main" })}
              >
                <option value="main">{RECRUITMENT_MODALITY_LABELS.main}</option>
                <option value="rest">{RECRUITMENT_MODALITY_LABELS.rest}</option>
              </Select>
            )}
          </FormField>
          <FormField label="Category projected">
            {(control) => (
              <Select {...control} value={draft.category} onChange={(event) => set({ category: event.target.value })}>
                {categories.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Target after exclusions" hint="Leave empty to use the sum of the agreed targets.">
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                value={draft.target}
                data-testid="assumption-target"
                onChange={(event) => set({ target: event.target.value })}
              />
            )}
          </FormField>
          <FormField
            label="Expected exclusion rate, per cent"
            hint="The share of those counted that will not be usable."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={draft.exclusionPercent}
                data-testid="assumption-exclusion"
                onChange={(event) => set({ exclusionPercent: event.target.value })}
              />
            )}
          </FormField>
          <FormField label="Days of reports behind each rate" hint="From 14 to 730.">
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                value={draft.windowDays}
                data-testid="assumption-window"
                onChange={(event) => set({ windowDays: event.target.value })}
              />
            )}
          </FormField>
          <FormField
            label="Spread of the scenarios, per cent"
            hint="How much faster and slower the optimistic and conservative scenarios go."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={draft.spreadPercent}
                data-testid="assumption-spread"
                onChange={(event) => set({ spreadPercent: event.target.value })}
              />
            )}
          </FormField>
          <FormField label="Reports up to">
            {(control) => (
              <Input
                {...control}
                type="date"
                max={today()}
                value={draft.inputsAsOf}
                onChange={(event) => set({ inputsAsOf: event.target.value })}
              />
            )}
          </FormField>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="size-4 accent-accent-strong"
              checked={draft.includePlannedPauses}
              onChange={(event) => set({ includePlannedPauses: event.target.checked })}
            />
            Count nothing during planned pauses ({pauses.length} planned)
          </label>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium text-fg-secondary">Active laboratories</legend>
            {facts.length === 0 ? (
              <p className="text-sm text-fg-muted">This replication has no laboratories yet.</p>
            ) : null}
            {facts.map((fact) => (
              <label key={fact.id} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-4 accent-accent-strong"
                  checked={draft.activeParticipationIds.includes(fact.id)}
                  onChange={(event) =>
                    set({
                      activeParticipationIds: event.target.checked
                        ? [...draft.activeParticipationIds, fact.id]
                        : draft.activeParticipationIds.filter((id) => id !== fact.id),
                    })
                  }
                />
                {world.laboratoryName(fact.laboratoryId)}
              </label>
            ))}
          </fieldset>
          {assumptions === null ? (
            <p className="text-xs text-fg-accent" role="alert">
              An assumption is out of range: the exclusion rate is from 0 to 95 per cent, the spread from 0 to 90, the
              window from 14 to 730 days and a target a whole number from 1.
            </p>
          ) : null}
          {failure === null ? null : <ErrorState title="Nothing was stored." description={failure} />}
          {canSave ? (
            <Button type="submit" variant="primary" disabled={assumptions === null || saving}>
              {saving ? "Storing…" : "Store this forecast"}
            </Button>
          ) : null}
        </form>
        <section aria-labelledby="result" className="grid content-start gap-3">
          <h2 id="result" className="text-lg text-fg">
            Result
          </h2>
          {result === null ? (
            <EmptyState title="No result" description="Correct the assumptions on the left to see the forecast." />
          ) : (
            <ForecastResultView result={result} world={world} categoryLabel={categoryLabel} modality={draft.modality} />
          )}
        </section>
      </div>
      <section aria-labelledby="method" className="grid gap-2">
        <h2 id="method" className="text-lg text-fg">
          How the forecast works
        </h2>
        <p className="max-w-reading text-sm text-fg-secondary">
          It extrapolates. For each active laboratory it takes the change in its effective cumulative count over the
          chosen days of reports, from the value that held when they begin or, for a laboratory that began to report
          within them, from its first report there, divided by the days between the two reports, and assumes the
          laboratory goes on at that rate, adding nothing on the days of its planned pauses. The optimistic and
          conservative scenarios multiply every rate by one plus and one minus the spread. The range of each scenario
          comes from the slower and the faster half of the window; it is not a confidence interval. A laboratory with
          fewer than two reports in the window adds nothing, and a count no report states counts as nothing, which the
          notes say. Where no laboratory has a rate, the rate and the completion are unknown. Projected counts are whole
          people.
        </p>
      </section>
      <section aria-labelledby="stored" className="grid gap-2">
        <h2 id="stored" className="text-lg text-fg">
          Stored forecasts
        </h2>
        <LiveView
          live={runs}
          loadingLabel="Loading the stored forecasts"
          errorTitle="The stored forecasts could not be loaded."
          onRetry={retryFailedLiveData}
        >
          {(items) =>
            items.length === 0 ? (
              <p className="text-sm text-fg-muted">No forecast has been stored for this replication.</p>
            ) : (
              <ul className="grid gap-2" data-testid="stored-forecasts">
                {items.map((run) => {
                  const read = readForecastRun(run);
                  return (
                    <li
                      key={run.id}
                      className="flex flex-wrap items-center gap-3 rounded-tile border border-border bg-surface p-3"
                    >
                      <Badge tone="outline">Projected</Badge>
                      <span className="text-sm text-fg">
                        {isFirestoreTimestamp(run.generatedAt)
                          ? formatDay(run.generatedAt.toDate().toISOString().slice(0, 10))
                          : "Just now"}
                        , from the reports up to {formatDay(run.inputsAsOf)}
                        {read === null ? "" : `: ${storedCompletion(read.result.scenarios.central)}`}
                      </span>
                      {read === null ? (
                        <span className="text-xs text-fg-muted">Made with another method ({run.methodVersion}).</span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setDraft(draftOf(read.assumptions))}>
                          Use these assumptions
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          }
        </LiveView>
      </section>
    </div>
  );
}

export function ForecastPage() {
  const { studyKey = "" } = useParams();
  const viewer = useViewer();
  const world = useRecruitmentWorld(viewer);
  return (
    <>
      <PageHeader
        title={`Forecast: ${studyKey}`}
        description="When the replication may reach its target, from the rates of its laboratories. Every figure here is projected."
        actions={
          <Button asChild size="sm">
            <Link to={`${replicationPath(studyKey)}?tab=recruitment`}>Recruitment of {studyKey}</Link>
          </Button>
        }
      />
      {viewer === null ? (
        <LoadingState label="Checking your access" />
      ) : (
        <LiveView
          live={world}
          loadingLabel="Loading the forecast"
          errorTitle="The forecast could not be loaded."
          onRetry={retryFailedLiveData}
        >
          {(loaded) =>
            loaded.replications.some((replication) => replication.id === studyKey) ? (
              <Forecast viewer={viewer} world={loaded} studyKey={studyKey} />
            ) : (
              <EmptyState
                title="This replication does not exist"
                description={`No replication has the identifier ${studyKey}.`}
              />
            )
          }
        </LiveView>
      )}
    </>
  );
}
