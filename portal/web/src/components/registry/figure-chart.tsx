// A bar chart of counts with its own table view. Each bar is a link to the list it was counted
// from, and its label and count are text, so the chart reads the same without the bars. Nothing
// moves: the bars are drawn at their final width, whatever the motion preference.
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { countOf, formatCount } from "@/registry/labels";

export interface ChartFigure {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly to: string;
}

export interface FigureChartProps {
  title: string;
  /** What is counted, in the singular, for example "replication". */
  unit: string;
  figures: readonly ChartFigure[];
  /** What is said when there is nothing to count. */
  empty: string;
}

export function FigureChart({ title, unit, figures, empty }: FigureChartProps) {
  const [asTable, setAsTable] = useState(false);
  const largest = Math.max(1, ...figures.map((figure) => figure.count));
  const headingId = `chart-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="grid content-start gap-2" data-testid={headingId}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-md font-medium text-fg-strong">
          {title}
        </h3>
        {figures.length === 0 ? null : (
          <Button size="sm" variant="ghost" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
            {asTable ? "Show as chart" : "Show as table"}
          </Button>
        )}
      </div>
      {figures.length === 0 ? (
        <p className="text-fg-muted">{empty}</p>
      ) : asTable ? (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="text-micro text-fg-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-1 font-medium">
                Group
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Number of {unit}s
              </th>
            </tr>
          </thead>
          <tbody>
            {figures.map((figure) => (
              <tr key={figure.key} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-1 font-normal">
                  <Link to={figure.to} className="text-fg-accent underline">
                    {figure.label}
                  </Link>
                </th>
                <td className="py-1 text-right tabular-nums">{formatCount(figure.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="grid gap-1">
          {figures.map((figure) => (
            <li key={figure.key}>
              <Link
                to={figure.to}
                className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-2 rounded-control px-1 py-0.5 hover:bg-surface-muted"
              >
                <span className="sr-only">{`${figure.label}: ${countOf(figure.count, unit)}`}</span>
                <span aria-hidden="true" className="truncate text-fg-secondary">
                  {figure.label}
                </span>
                <span aria-hidden="true" className="h-3 rounded-pill bg-surface-muted">
                  <span
                    className="block h-3 rounded-pill bg-accent"
                    style={{ width: `${(figure.count / largest) * 100}%` }}
                  />
                </span>
                <span aria-hidden="true" className="min-w-6 text-right text-fg tabular-nums">
                  {formatCount(figure.count)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
