// How a figure of recruitment is shown. Every figure names its origin and basis (reported,
// verified, imported or projected) and says when it is incomplete, and an unknown value is said
// in words, never shown as zero (D-009, docs/DATA_MODEL.md, section 15).
import {
  FIGURE_BASIS_LABELS,
  type FigureBasis,
  RECRUITMENT_MODALITY_LABELS,
  type RecruitmentModality,
  type ResolvedValue,
  type RollupFigure,
} from "@eegml/shared";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { formatCount } from "@/registry/labels";
import { formatDay } from "./dates";

const decimals = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export function formatDecimal(value: number): string {
  return decimals.format(value);
}

/** The labels of the bases of a figure, as small badges. */
export function BasisBadges({ bases }: { readonly bases: readonly FigureBasis[] }) {
  if (bases.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {bases.map((basis) => (
        <Badge key={basis} tone="outline" data-basis={basis}>
          {FIGURE_BASIS_LABELS[basis]}
        </Badge>
      ))}
    </span>
  );
}

/**
 * A summed figure: its value or "Unknown", its bases, and how many of those expected stated it.
 * `basisLabel` names the basis in place of the bases of reports, for a figure such as an agreed
 * target that no report states.
 */
export function Figure({
  figure,
  testId,
  basisLabel,
}: {
  readonly figure: RollupFigure;
  readonly testId?: string;
  readonly basisLabel?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid={testId}>
      {figure.value === null ? (
        <Unknown>Unknown</Unknown>
      ) : (
        <span className="text-fg tabular-nums" data-value={figure.value}>
          {formatCount(figure.value)}
        </span>
      )}
      {basisLabel === undefined ? (
        <BasisBadges bases={figure.bases} />
      ) : figure.value === null ? null : (
        <Badge tone="outline">{basisLabel}</Badge>
      )}
      {figure.demo ? <Badge tone="outline">Demonstration</Badge> : null}
      {figure.expected > 0 && !figure.complete ? (
        <span className="text-xs text-fg-muted">
          Incomplete: {figure.known} of {figure.expected} stated
        </span>
      ) : null}
    </span>
  );
}

/** One resolved value of a participation, or "Unknown", with the date it holds for. */
export function ValueCell({ value, testId }: { readonly value: ResolvedValue | undefined; readonly testId?: string }) {
  if (value === undefined) {
    return (
      <span data-testid={testId}>
        <Unknown>Unknown</Unknown>
      </span>
    );
  }
  return (
    <span className="grid" data-testid={testId}>
      <span className="text-fg tabular-nums" data-value={value.value}>
        {formatCount(value.value)}
      </span>
      <span className="text-xs text-fg-muted">as of {formatDay(value.asOfDate)}</span>
    </span>
  );
}

/** A percentage, or "Unknown". */
export function Percent({ value, testId }: { readonly value: number | null; readonly testId?: string }) {
  return value === null ? (
    <span data-testid={testId}>
      <Unknown>Unknown</Unknown>
    </span>
  ) : (
    <span className="tabular-nums" data-testid={testId}>
      {formatDecimal(value)}%
    </span>
  );
}

/** The modality and category of a figure in words, for example "Tested, main experiment". */
export function figureName(categoryLabel: string, modality: RecruitmentModality): string {
  return `${categoryLabel}, ${RECRUITMENT_MODALITY_LABELS[modality].toLowerCase()}`;
}
