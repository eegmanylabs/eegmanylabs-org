// One participation of a laboratory in a replication (decision D-008), as the laboratory page,
// the replication page and the readiness matrix show it: its status and readiness, the local
// lead, the targets of the main experiment and of the resting state kept apart, the
// compatibility of the laboratory's current equipment, the onboarding checklist and the
// restricted details. What is restricted is asked for only where the rules allow the account
// to read it, and is then shown; for anyone else the card says who can see it.
import { type EquipmentRequirement, equipmentCompatibility, type ParticipationSide } from "@eegml/shared";
import type { ReactNode } from "react";
import { formatDate } from "@/app/labels";
import { Detail, Details } from "@/components/registry/details";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { type RecordOf, useLiveDocument, useLiveQuery } from "@/data";
import {
  ETHICS_STATUS_LABELS,
  formatCount,
  PARTICIPATION_STATUS_LABELS,
  READINESS_LABELS,
  TRAINING_STATUS_LABELS,
} from "@/registry/labels";
import { checklistOfParticipation, type ParticipationRecord } from "@/registry/queries";
import type { Viewer } from "@/registry/viewer";
import { ChecklistSection } from "./ChecklistSection";
import { CompatibilityStatement, configurationFor } from "./CompatibilityStatement";
import { EquipmentOverrideDialog, OnboardingDetailDialog, ParticipationStatusDialog } from "./ParticipationDialogs";

export interface ParticipationCardProps {
  readonly participation: ParticipationRecord;
  readonly viewer: Viewer;
  /** The heading of the card: a link to the laboratory or to the replication. */
  readonly title: ReactNode;
  /** What the participation is called in words, for the names of its controls. */
  readonly label: string;
  readonly requirements: readonly EquipmentRequirement[];
  /** The current configurations of the laboratory. */
  readonly currentConfigurations: readonly RecordOf<"laboratoryEquipment">[];
  readonly personNames: ReadonlyMap<string, string>;
}

const target = (value: number | undefined) =>
  value === undefined ? <Unknown /> : <span className="tabular-nums">{formatCount(value)}</span>;

export function ParticipationCard({
  participation,
  viewer,
  title,
  label,
  requirements,
  currentConfigurations,
  personNames,
}: ParticipationCardProps) {
  const { replicationId, laboratoryId } = participation;
  const scope = viewer.participationScope(participation);
  const checklist = useLiveQuery(checklistOfParticipation(participation.id, scope));
  const detail = useLiveDocument("participationDetail", scope === null ? null : [participation.id]);
  const unit = { replicationId, laboratoryId };
  const live = participation.archivedAt === null && viewer.access.member;
  const manages = live && viewer.can("participations.manage", unit);
  const forReplication = live && viewer.can("participations.manage", { replicationId });
  const labMember = live && viewer.access.memberLaboratoryIds.includes(laboratoryId);
  const forLaboratory = live && viewer.can("participations.manage", { laboratoryId });
  const sides = new Set<ParticipationSide>([
    ...(forLaboratory ? (["laboratory"] as const) : []),
    ...(forReplication ? (["replication"] as const) : []),
  ]);
  const configuration = configurationFor(participation, currentConfigurations);
  const report = equipmentCompatibility(requirements, configuration);
  const needsOverride =
    report.overall === "incompatible" || report.overall === "unknown" || report.overall === "noConfiguration";
  const stored = detail.status === "ready" ? detail.data : null;

  return (
    <article
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      aria-label={`Participation of ${label}`}
      data-testid="participation"
      data-participation={participation.id}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h3 className="text-md font-medium text-fg-strong">{title}</h3>
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" data-testid="participation-status">
              {PARTICIPATION_STATUS_LABELS[participation.status]}
            </Badge>
            <Badge tone="outline">{READINESS_LABELS[participation.readinessStatus]}</Badge>
            <OriginBadge origin={participation.dataOrigin} />
          </p>
        </div>
        {manages ? (
          <ParticipationStatusDialog
            participationId={participation.id}
            current={participation.status}
            label={label}
            sides={sides}
            readinessApproved={participation.readinessStatus === "approved"}
          />
        ) : null}
      </header>
      <Details>
        <Detail term="Local lead">
          {participation.localLeadPersonId === undefined ? (
            <Unknown />
          ) : (
            (personNames.get(participation.localLeadPersonId) ?? participation.localLeadPersonId)
          )}
        </Detail>
        <Detail term="Target, main experiment">{target(participation.targetNMain)}</Detail>
        <Detail term="Target, resting state">{target(participation.targetNRest)}</Detail>
      </Details>
      <p className="text-xs text-fg-muted">
        The two targets are kept apart and never added: a participant can take part in both.
      </p>
      <section className="grid gap-2" aria-label={`Equipment of ${label}`}>
        <h4 className="text-sm font-medium text-fg-strong">Equipment</h4>
        <CompatibilityStatement report={report} configurationName={configuration?.name ?? null} />
        {stored === null ? null : stored.equipmentOverrideJustification === undefined ? null : (
          <p className="rounded-control border border-border p-2 text-fg-secondary" data-testid="equipment-override">
            Override recorded: {stored.equipmentOverrideJustification}
          </p>
        )}
        {manages && stored !== null && (needsOverride || stored.equipmentOverrideJustification !== undefined) ? (
          <div>
            <EquipmentOverrideDialog
              uid={viewer.uid}
              participationId={participation.id}
              current={stored.equipmentOverrideJustification}
              label={label}
            />
          </div>
        ) : null}
      </section>
      <section className="grid gap-2" aria-label={`Onboarding of ${label}`}>
        <h4 className="text-sm font-medium text-fg-strong">Onboarding</h4>
        {scope === null ? (
          <p className="text-fg-muted">
            The checklist and the onboarding details are visible to the laboratory, the team of the replication and the
            programme.
          </p>
        ) : checklist.status === "ready" ? (
          <ChecklistSection
            items={checklist.data}
            rights={{ manages, forReplication, labMember }}
            uid={viewer.uid}
            label={label}
          />
        ) : checklist.status === "error" ? (
          <p className="text-fg-accent">The checklist could not be loaded. Reload the page to try again.</p>
        ) : (
          <p className="text-fg-muted">Loading the checklist</p>
        )}
      </section>
      {scope === null || detail.status !== "ready" ? null : stored === null ? (
        <p className="text-fg-muted">No onboarding details are recorded.</p>
      ) : (
        <section className="grid gap-2" aria-label={`Onboarding details of ${label}`} data-testid="onboarding-details">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-fg-strong">Onboarding details</h4>
            {manages ? (
              <OnboardingDetailDialog
                uid={viewer.uid}
                participationId={participation.id}
                detail={stored}
                label={label}
              />
            ) : null}
          </div>
          <Details>
            <Detail term="Ethics">{ETHICS_STATUS_LABELS[stored.ethicsStatus]}</Detail>
            <Detail term="Ethics reference">{stored.ethicsReference ?? <Unknown />}</Detail>
            <Detail term="Training">{TRAINING_STATUS_LABELS[stored.trainingStatus]}</Detail>
            <Detail term="Readiness approved">
              {stored.readinessApprovedAt === null ? (
                <Unknown>Not approved</Unknown>
              ) : (
                formatDate(stored.readinessApprovedAt.toDate())
              )}
            </Detail>
            <Detail term="Notes">{stored.notes ?? <Unknown>None</Unknown>}</Detail>
          </Details>
        </section>
      )}
    </article>
  );
}
