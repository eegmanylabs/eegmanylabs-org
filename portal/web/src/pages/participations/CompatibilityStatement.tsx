// What a laboratory's current equipment says against the requirements of a replication, from
// `equipmentCompatibility` of the shared package, which the laboratory page, the replication
// page and the readiness matrix all use. An unknown is said as unknown, never as met.
import type { CompatibilityReport } from "@eegml/shared";
import { Badge } from "@/components/ui/badge";
import type { RecordOf } from "@/data";
import { COMPATIBILITY_LABELS, REQUIREMENT_OUTCOME_LABELS } from "@/registry/labels";

type Configuration = RecordOf<"laboratoryEquipment">;

/**
 * The configuration a participation is compared with: the one it names where that is still
 * current, and otherwise the laboratory's current configuration, the first by name where it has
 * several. Null where the laboratory has none.
 */
export function configurationFor(
  participation: { readonly equipmentConfigurationId?: string | undefined },
  current: readonly Configuration[],
): Configuration | null {
  const named = current.find((configuration) => configuration.id === participation.equipmentConfigurationId);
  if (named !== undefined) return named;
  return [...current].sort((a, b) => a.name.localeCompare(b.name, "en"))[0] ?? null;
}

const OUTCOME_TONES = { met: "neutral", missing: "accent", unknown: "outline" } as const;

export function CompatibilityStatement({
  report,
  configurationName,
}: {
  report: CompatibilityReport;
  configurationName: string | null;
}) {
  return (
    <div className="grid gap-2" data-testid="compatibility">
      <p className="flex flex-wrap items-center gap-2">
        <Badge
          tone={report.overall === "incompatible" ? "accent" : report.overall === "compatible" ? "neutral" : "outline"}
        >
          {COMPATIBILITY_LABELS[report.overall]}
        </Badge>
        {configurationName === null ? null : (
          <span className="text-xs text-fg-muted">Compared with the configuration {configurationName}</span>
        )}
      </p>
      {report.checks.length === 0 ? null : (
        <ul className="grid gap-1">
          {report.checks.map((check) => (
            <li key={check.requirementKey} className="flex flex-wrap items-start gap-2" data-outcome={check.outcome}>
              <Badge tone={OUTCOME_TONES[check.outcome]}>{REQUIREMENT_OUTCOME_LABELS[check.outcome]}</Badge>
              <span className="min-w-0 flex-1 text-fg-secondary">
                {check.explanation}
                {check.isMandatory ? "" : " Not mandatory for this replication."}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
