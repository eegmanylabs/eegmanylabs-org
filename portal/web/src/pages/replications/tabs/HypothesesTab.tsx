import { Detail, Details } from "@/components/registry/details";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import type { RecordOf } from "@/data";
import { SCIENTIFIC_REVIEW_LABELS } from "@/registry/labels";

/** A label as a source gave it, which nobody has reviewed scientifically. */
function SourceValue({ value }: { value: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{value}</span>
      <Badge tone="outline">Unverified source value</Badge>
    </span>
  );
}

/** Sorts hypotheses by their number where it reads as one, and by identifier otherwise. */
function byNumber(a: RecordOf<"replicationHypotheses">, b: RecordOf<"replicationHypotheses">): number {
  const numberA = Number.parseInt(a.hypothesisNumber, 10);
  const numberB = Number.parseInt(b.hypothesisNumber, 10);
  if (Number.isNaN(numberA) || Number.isNaN(numberB)) return a.id.localeCompare(b.id);
  return numberA - numberB;
}

export interface HypothesesTabProps {
  hypotheses: readonly RecordOf<"replicationHypotheses">[];
  /** The verbatim "replicated" labels by hypothesis, or null where the caller may not read them. */
  replicatedLabels: Readonly<Record<string, string>> | null;
}

export function HypothesesTab({ hypotheses, replicatedLabels }: HypothesesTabProps) {
  const sorted = [...hypotheses].filter((hypothesis) => hypothesis.archivedAt === null).sort(byNumber);
  return (
    <div className="grid gap-4">
      <p className="text-fg-secondary">
        The labels "null or significant" and "replicated" are copied from the programme's historical records. Nobody has
        reviewed them scientifically, so they say nothing yet about the outcome of a replication.
      </p>
      <ol className="grid gap-3">
        {sorted.map((hypothesis) => {
          const replicated = replicatedLabels?.[hypothesis.id];
          return (
            <li
              key={hypothesis.id}
              className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
              data-testid="hypothesis"
            >
              <h2 className="text-md font-medium text-fg-strong">Hypothesis {hypothesis.hypothesisNumber}</h2>
              <p className="whitespace-pre-wrap">{hypothesis.text}</p>
              <Details>
                <Detail term="Null or significant">
                  {hypothesis.nullSigSource === undefined ? (
                    <Unknown />
                  ) : (
                    <SourceValue value={hypothesis.nullSigSource} />
                  )}
                </Detail>
                <Detail term="Replicated">
                  {replicatedLabels === null ? (
                    <Unknown>Shown to the team of the replication and to the programme only</Unknown>
                  ) : replicated === undefined ? (
                    <Unknown />
                  ) : (
                    <SourceValue value={replicated} />
                  )}
                </Detail>
                <Detail term="Scientific review">{SCIENTIFIC_REVIEW_LABELS[hypothesis.scientificReviewStatus]}</Detail>
              </Details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
