// The pipeline of datasets: how many are in each state of the workflow, and how many at each
// status of quality control. The registry and the programme's home show it; the counts come from
// the registry documents that every member reads.
import { DEFAULT_DATASET_WORKFLOW } from "@eegml/shared";
import { originBreakdown } from "@/pages/home/snapshot";
import { DATA_ORIGIN_LABELS, formatCount } from "@/registry/labels";
import { QC_STATUS_LABELS } from "./dataset-format";
import { type DatasetRow, pipelineOf } from "./dataset-list";

export function DatasetPipeline({ rows, title }: { rows: readonly DatasetRow[]; title: string }) {
  const { stages, qc } = pipelineOf(rows, DEFAULT_DATASET_WORKFLOW.states);
  const origins = originBreakdown(
    rows.map((row) => row.dataOrigin),
    DATA_ORIGIN_LABELS,
    formatCount,
  );
  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="dataset-pipeline"
    >
      <h2 className="text-md font-medium text-fg-strong">{title}</h2>
      {origins === null ? null : (
        <p className="text-xs text-fg-secondary">
          Counted from {formatCount(rows.length)} {rows.length === 1 ? "record" : "records"}: {origins}.
        </p>
      )}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stages.map((stage) => (
          <li key={stage.key} className="grid gap-0.5 rounded-control border border-border px-3 py-2">
            <span className="text-xs text-fg-muted">{stage.label}</span>
            <span className="text-lg tabular-nums text-fg-strong">{formatCount(stage.count)}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <span className="text-fg-secondary">QC status:</span>
        <dl className="flex flex-wrap gap-x-5 gap-y-1" aria-label="QC status">
          {(Object.keys(QC_STATUS_LABELS) as (keyof typeof QC_STATUS_LABELS)[]).map((status) => (
            <div key={status} className="flex gap-1.5">
              <dt className="text-fg-secondary">{QC_STATUS_LABELS[status]}</dt>
              <dd className="tabular-nums text-fg-strong">{formatCount(qc[status])}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
