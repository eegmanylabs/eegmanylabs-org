import { Link } from "react-router";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import type { RecordOf } from "@/data";
import { CreateParticipationDialog } from "@/pages/participations/CreateParticipationDialog";
import { ParticipationCard } from "@/pages/participations/ParticipationCard";
import { formatCount, HISTORICAL_METRIC_LABELS } from "@/registry/labels";
import { laboratoryPath } from "@/registry/paths";
import type { Viewer } from "@/registry/viewer";
import { Section } from "./OverviewTab";

type Aggregate = RecordOf<"historicalAggregates">;

/** The figures of the main experiment and of the resting state, which are shown side by side and never added. */
const MAIN = "totalNMainCollected";
const REST = "totalNRest";

function Figure({
  aggregate,
  studyKey,
  showOrigin,
}: {
  aggregate: Aggregate | undefined;
  studyKey: string;
  /** Whether the figure carries its own origin, because the figures of the section differ in origin. */
  showOrigin: boolean;
}) {
  if (aggregate === undefined) return <Unknown>Not in the source</Unknown>;
  const others = aggregate.replicationIds.filter((id) => id !== studyKey);
  return (
    <span className="grid gap-0.5">
      {showOrigin ? (
        <span>
          <OriginBadge origin={aggregate.dataOrigin} showLive />
        </span>
      ) : null}
      <span className="text-lg font-medium text-fg-strong tabular-nums">
        {aggregate.valueNumeric === undefined ? aggregate.valueSource : formatCount(aggregate.valueNumeric)}
      </span>
      {aggregate.valueNumeric === undefined ? (
        <span className="text-xs text-fg-muted">As written in the source. It could not be read as a number.</span>
      ) : aggregate.valueSource.trim() !== String(aggregate.valueNumeric) ? (
        <span className="text-xs text-fg-muted">The source says: {aggregate.valueSource}</span>
      ) : null}
      {others.length === 0 ? null : (
        <span className="text-xs text-fg-muted">
          This figure describes {studyKey} and {others.join(" and ")} together. It is not divided between them.
        </span>
      )}
      <span className="text-xs text-fg-muted">
        {aggregate.snapshotDate === undefined ? "No as-of date in the source" : `As of ${aggregate.snapshotDate}`}
      </span>
    </span>
  );
}

export interface LaboratoriesTabProps {
  studyKey: string;
  viewer: Viewer;
  participations: readonly RecordOf<"participations">[];
  laboratories: readonly RecordOf<"laboratories">[];
  /** The directory, for the choice of a local lead. Read only for those who add laboratories. */
  persons: readonly RecordOf<"persons">[];
  /** The names of the people the participations name. */
  personNames: ReadonlyMap<string, string>;
  requirements: readonly RecordOf<"replicationEquipmentRequirements">[];
  currentEquipment: readonly RecordOf<"laboratoryEquipment">[];
  aggregates: readonly Aggregate[];
}

export function LaboratoriesTab({
  studyKey,
  viewer,
  participations,
  laboratories,
  persons,
  personNames,
  requirements,
  currentEquipment,
  aggregates,
}: LaboratoriesTabProps) {
  const current = aggregates.filter((aggregate) => aggregate.isCurrent && aggregate.archivedAt === null);
  const byMetric = new Map(current.map((aggregate) => [aggregate.metricKey, aggregate]));
  const others = current.filter((aggregate) => aggregate.metricKey !== MAIN && aggregate.metricKey !== REST);
  // Each figure is labelled with the origin of its own record: once for the section where they
  // all agree, and beside each figure where they do not.
  const origins = [...new Set(current.map((aggregate) => aggregate.dataOrigin))];
  const sectionOrigin = origins.length === 1 ? origins[0] : undefined;
  const perFigure = sectionOrigin === undefined;
  const laboratoryNames = new Map(laboratories.map((laboratory) => [laboratory.id, laboratory.name]));
  const adds = viewer.access.member && viewer.can("participations.manage", { replicationId: studyKey });
  const taking = new Set(participations.map((participation) => participation.laboratoryId));
  const sorted = [...participations].sort((a, b) =>
    (laboratoryNames.get(a.laboratoryId) ?? a.laboratoryId).localeCompare(
      laboratoryNames.get(b.laboratoryId) ?? b.laboratoryId,
      "en",
    ),
  );
  return (
    <div className="grid gap-4">
      <Section
        title="Laboratories in the portal"
        aside={
          adds ? (
            <CreateParticipationDialog
              studyKey={studyKey}
              laboratories={laboratories
                .filter((laboratory) => laboratory.archivedAt === null && !taking.has(laboratory.id))
                .map((laboratory) => ({ id: laboratory.id, name: laboratory.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "en"))}
              registeredCount={laboratories.filter((laboratory) => laboratory.archivedAt === null).length}
              canCreateLaboratory={viewer.can("labs.manage", "programme")}
              persons={persons
                .filter((person) => person.archivedAt === null)
                .map((person) => ({ id: person.id, name: person.displayName, laboratoryIds: person.laboratoryIds }))}
            />
          ) : undefined
        }
      >
        {participations.length === 0 ? (
          <p className="text-fg-secondary" data-testid="no-participations">
            No laboratory is linked to this replication in the portal yet. A laboratory is linked when it has registered
            in the portal and takes part in a replication, either because the replication's leads invited it or because
            it registered its interest and the leads confirmed it.
            {current.length === 0
              ? ""
              : " The figures below come from the programme's historical records and are kept apart."}
          </p>
        ) : (
          <div className="grid gap-3">
            {sorted.map((participation) => {
              const name = laboratoryNames.get(participation.laboratoryId) ?? participation.laboratoryId;
              return (
                <ParticipationCard
                  key={participation.id}
                  participation={participation}
                  viewer={viewer}
                  title={
                    <Link to={laboratoryPath(participation.laboratoryId)} className="hover:text-fg-accent">
                      {name}
                    </Link>
                  }
                  label={`${name} in ${studyKey}`}
                  requirements={requirements}
                  currentConfigurations={currentEquipment.filter(
                    (configuration) =>
                      configuration.laboratoryId === participation.laboratoryId && configuration.archivedAt === null,
                  )}
                  personNames={personNames}
                />
              );
            })}
          </div>
        )}
      </Section>
      {current.length === 0 ? null : (
        <Section
          title={sectionOrigin === "demo" ? "Demonstration figures" : "Imported historical figures"}
          aside={sectionOrigin === undefined ? undefined : <OriginBadge origin={sectionOrigin} showLive />}
          testId="historical-figures"
        >
          <p className="text-fg-secondary">
            {sectionOrigin === "demo"
              ? "Invented figures of the demonstration world, for the whole replication. They describe no real study."
              : "Figures for the whole replication from a historical workbook of the programme. The source gives no date for them, so they may be out of date. They are not live reports from laboratories."}
          </p>
          {byMetric.has(MAIN) || byMetric.has(REST) ? (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="modalities">
              <div className="grid gap-1 rounded-control border border-border p-3">
                <h3 className="text-sm text-fg-secondary">Participants collected, main experiment</h3>
                <Figure aggregate={byMetric.get(MAIN)} studyKey={studyKey} showOrigin={perFigure} />
              </div>
              <div className="grid gap-1 rounded-control border border-border p-3">
                <h3 className="text-sm text-fg-secondary">Participants collected, resting state</h3>
                <Figure aggregate={byMetric.get(REST)} studyKey={studyKey} showOrigin={perFigure} />
              </div>
              <p className="text-xs text-fg-muted sm:col-span-2">
                A participant may have taken part in both, so the two figures are never added together.
              </p>
            </div>
          ) : null}
          {others.length === 0 ? null : (
            <dl className="grid gap-3 sm:grid-cols-2">
              {others.map((aggregate) => (
                <div key={aggregate.id} className="grid gap-1 rounded-control border border-border p-3">
                  <dt className="text-sm text-fg-secondary">
                    {HISTORICAL_METRIC_LABELS[aggregate.metricKey] ?? aggregate.metricKey}
                  </dt>
                  <dd>
                    <Figure aggregate={aggregate} studyKey={studyKey} showOrigin={perFigure} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      )}
    </div>
  );
}
