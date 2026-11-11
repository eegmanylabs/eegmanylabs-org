// The widgets of a dashboard: a view of a collection, a figure from a rollup, a chart of a
// grouped count or sum with its text alternative and its table, the activity of the workspace
// and a note. Each computes from the same documents as every other view (D-011).
import {
  aggregate,
  type Bucket,
  computeView,
  type DashboardWidget,
  groupedAggregate,
  type Measure,
  type ViewConfig,
  type ViewScope,
} from "@eegml/shared";
import { useMemo, useState } from "react";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import type { Viewer } from "@/registry/viewer";
import { useViewData, type ViewData } from "./use-view-data";
import { settingsOf, type ViewSettings, ViewSurface } from "./ViewSurface";

export interface WidgetProps {
  readonly widget: DashboardWidget;
  readonly viewer: Viewer;
  readonly secondFactor: boolean;
  /** Keeps a change to the view of a widget, where the viewer may change the dashboard. */
  readonly onChange: ((widget: DashboardWidget) => void) | null;
}

const MEASURE_LABELS: Readonly<Record<Measure["kind"], string>> = { count: "Count", sum: "Sum", rollup: "Value" };

function formatFigure(value: number | null): string {
  if (value === null) return "Unknown";
  return value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** The records of a widget's collection that pass its configuration, with the data they came from. */
function useWidgetRecords(
  collectionKey: string,
  config: ViewConfig,
  scope: ViewScope | null,
  viewer: Viewer,
  secondFactor: boolean,
) {
  const live = useViewData(collectionKey, viewer, secondFactor);
  return { live, compute: (data: ViewData) => computeView(data.collection, config, scope, data.context) };
}

function KpiWidget({ widget, viewer, secondFactor }: WidgetProps) {
  if (widget.type !== "kpi") return null;
  const { config } = widget;
  return (
    <KpiFigure
      collectionKey={config.collectionKey}
      config={config.config}
      scope={config.scope}
      measure={config.measure}
      viewer={viewer}
      secondFactor={secondFactor}
    />
  );
}

function KpiFigure(props: {
  readonly collectionKey: string;
  readonly config: ViewConfig;
  readonly scope: ViewScope | null;
  readonly measure: Measure;
  readonly viewer: Viewer;
  readonly secondFactor: boolean;
}) {
  const { live, compute } = useWidgetRecords(
    props.collectionKey,
    props.config,
    props.scope,
    props.viewer,
    props.secondFactor,
  );
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the figure"
      errorTitle="The figure could not be computed"
      onRetry={retryFailedLiveData}
    >
      {(data) => {
        const result = compute(data);
        const value = aggregate(result.records, props.measure, data.collection.properties);
        const measured = props.measure.kind === "count" ? null : props.measure.property;
        const percent =
          data.collection.properties.find((property) => property.id === measured)?.config.numberFormat === "percent";
        const unit = percent ? "%" : "";
        return (
          <p className="text-3xl text-fg" data-testid="kpi-value">
            {formatFigure(value)}
            {value === null ? "" : unit}
            <span className="block text-xs text-fg-muted">
              {MEASURE_LABELS[props.measure.kind]} over {result.records.length}{" "}
              {result.records.length === 1 ? "record" : "records"}
            </span>
          </p>
        );
      }}
    </LiveView>
  );
}

/** A bar chart of buckets, with a sentence that says what it shows and a table of the same figures. */
export function BarChart({ title, buckets }: { readonly title: string; readonly buckets: readonly Bucket[] }) {
  const [asTable, setAsTable] = useState(false);
  const known = buckets.map((bucket) => bucket.value ?? 0);
  const largest = Math.max(1, ...known);
  const summary =
    buckets.length === 0
      ? "There is nothing to chart."
      : `${title}: ${buckets.map((bucket) => `${bucket.label} ${formatFigure(bucket.value)}`).join("; ")}.`;
  return (
    <figure className="grid gap-2">
      <figcaption className="sr-only">{summary}</figcaption>
      <Button
        size="sm"
        variant="ghost"
        className="justify-self-end"
        aria-pressed={asTable}
        onClick={() => setAsTable(!asTable)}
      >
        {asTable ? "Show as a chart" : "Show as a table"}
      </Button>
      {asTable ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th scope="col" className="py-1 font-medium">
                Group
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-b border-border">
                <th scope="row" className="py-1 text-left font-normal">
                  {bucket.label}
                </th>
                <td className="py-1 text-right tabular-nums">{formatFigure(bucket.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul aria-hidden="true" className="grid gap-1.5">
          {buckets.map((bucket) => (
            <li
              key={bucket.key}
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
            >
              <span className="truncate text-fg-secondary">{bucket.label}</span>
              <span className="h-4 rounded-r-sm border border-border bg-surface-muted">
                <span
                  className="block h-full rounded-r-sm bg-accent-strong"
                  style={{ width: `${((bucket.value ?? 0) / largest) * 100}%` }}
                />
              </span>
              <span className="text-right tabular-nums">{formatFigure(bucket.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function ChartWidget({ widget, viewer, secondFactor }: WidgetProps) {
  const chart = widget.type === "chart" ? widget.config : null;
  const { live, compute } = useWidgetRecords(
    chart?.collectionKey ?? "core:participations",
    chart?.config ?? {},
    chart?.scope ?? null,
    viewer,
    secondFactor,
  );
  if (chart === null) return null;
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the chart"
      errorTitle="The chart could not be drawn"
      onRetry={retryFailedLiveData}
    >
      {(data) => {
        const groupBy = data.collection.properties.find((property) => property.id === chart.groupBy);
        if (groupBy === undefined)
          return <p className="text-fg-muted">The property this chart is grouped by no longer exists.</p>;
        const buckets = groupedAggregate(
          compute(data).records,
          groupBy,
          chart.measure,
          data.collection.properties,
          data.context,
        );
        return <BarChart title={chart.title} buckets={buckets} />;
      }}
    </LiveView>
  );
}

function ViewWidget({ widget, viewer, secondFactor, onChange }: WidgetProps) {
  const view = widget.type === "view" ? widget.config : null;
  const initial = useMemo(() => settingsOf(view?.type ?? "table", view?.config ?? {}), [view]);
  const [settings, setSettings] = useState<ViewSettings>(initial);
  if (view === null) return null;
  return (
    <ViewSurface
      collectionKey={view.collectionKey}
      viewer={viewer}
      secondFactor={secondFactor}
      settings={settings}
      onSettings={(next) => {
        setSettings(next);
        if (onChange !== null && widget.type === "view") {
          onChange({ ...widget, config: { ...widget.config, type: next.type, config: next.config } });
        }
      }}
      scope={view.scope}
      viewId={view.viewId ?? null}
      onViewId={() => undefined}
      caption={view.title}
      height={Math.max(160, widget.h * 88 - 150)}
      compact
    />
  );
}

/** What an activity entry says, in words. */
const ACTION_LABELS: Readonly<Record<string, string>> = { "page.edited": "edited" };

function ActivityWidget({ widget, viewer }: WidgetProps) {
  const limit = widget.type === "activity" ? widget.config.limit : 10;
  const live = useLiveQuery<"activity">(
    viewer.staff
      ? { collection: "activity", within: [], orderBy: [["createdAt", "desc"]], limit: 20 }
      : {
          collection: "activity",
          within: [],
          where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]],
          orderBy: [["createdAt", "desc"]],
          limit: 20,
        },
  );
  const people = useViewData("core:persons", viewer, false);
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the activity"
      errorTitle="The activity could not be loaded"
      onRetry={retryFailedLiveData}
    >
      {(entries: readonly RecordOf<"activity">[]) =>
        entries.length === 0 ? (
          <p className="text-fg-muted">Nothing has happened in the workspace yet.</p>
        ) : (
          <ol className="grid gap-1.5 text-sm">
            {entries.slice(0, limit).map((entry) => {
              const name =
                entry.actorUid === null || people.status !== "ready"
                  ? "Someone"
                  : (people.data.context.personName(entry.actorUid) ?? "A member");
              return (
                <li key={entry.id} className="flex flex-wrap gap-x-1">
                  <span className="font-medium">{name}</span>
                  <span>{ACTION_LABELS[entry.action] ?? entry.action}</span>
                  {entry.entityType === "page" ? (
                    <a className="text-fg-accent underline" href={`#/pages/${entry.entityId}`}>
                      {entry.title ?? "a page"}
                    </a>
                  ) : (
                    <span>{entry.title ?? entry.entityType}</span>
                  )}
                  <time className="text-fg-muted" dateTime={new Date(entry.createdAt.toMillis()).toISOString()}>
                    {new Date(entry.createdAt.toMillis()).toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </li>
              );
            })}
          </ol>
        )
      }
    </LiveView>
  );
}

function NoteWidget({ widget }: WidgetProps) {
  if (widget.type !== "note") return null;
  return (
    <p className="text-sm whitespace-pre-wrap">
      {widget.config.text === "" ? "This note is empty." : widget.config.text}
    </p>
  );
}

export function WidgetBody(props: WidgetProps) {
  switch (props.widget.type) {
    case "view":
      return <ViewWidget {...props} />;
    case "kpi":
      return <KpiWidget {...props} />;
    case "chart":
      return <ChartWidget {...props} />;
    case "activity":
      return <ActivityWidget {...props} />;
    case "note":
      return <NoteWidget {...props} />;
  }
}
