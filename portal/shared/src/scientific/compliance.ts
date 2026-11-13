// Protocol compliance of each laboratory in a replication (requirement R12.3): whether the
// laboratory follows the current approved version of the protocol, whether its team has
// acknowledged that version, and which deviations it has reported and not yet resolved.
import type {
  ParticipationAcknowledgementDoc,
  ParticipationDeviationDoc,
  ParticipationDoc,
  ParticipationTeamMemberDoc,
} from "../schemas/participation";
import type { ReplicationProtocolVersionDoc } from "../schemas/replications";

type Stored<T> = T & { readonly id: string };

/**
 * | State                     | Meaning                                                                       |
 * |---------------------------|-------------------------------------------------------------------------------|
 * | `noApprovedVersion`       | The protocol the laboratory follows has no approved version                   |
 * | `outdatedVersion`         | The laboratory follows a version that a later approved one has superseded      |
 * | `awaitingAcknowledgement` | Someone of its team has not acknowledged the current version                  |
 * | `openDeviations`          | Every acknowledgement is in, and deviations are still open or under review    |
 * | `compliant`               | The current version is acknowledged by the whole team and nothing is open     |
 * | `noProtocol`              | The participation names no protocol                                           |
 * | `noTeam`                  | The participation has nobody on its team to acknowledge the version            |
 */
export type ComplianceState =
  | "noProtocol"
  | "noApprovedVersion"
  | "outdatedVersion"
  | "noTeam"
  | "awaitingAcknowledgement"
  | "openDeviations"
  | "compliant";

export interface ParticipationCompliance {
  readonly participationId: string;
  readonly laboratoryId: string;
  readonly state: ComplianceState;
  /** The approved version that holds now, or null. */
  readonly currentVersionId: string | null;
  /** The version the participation names, or null. */
  readonly followedVersionId: string | null;
  readonly teamSize: number;
  /** The people of the team who have acknowledged the current version. */
  readonly acknowledgedBy: readonly string[];
  /** The people of the team who have not. */
  readonly awaiting: readonly string[];
  readonly openDeviations: { readonly minor: number; readonly major: number; readonly critical: number };
}

/** The approved version of a protocol that holds now: the approved one with the latest approval. */
export function currentApprovedVersion(
  versions: readonly Stored<ReplicationProtocolVersionDoc>[],
  protocolId: string,
): Stored<ReplicationProtocolVersionDoc> | null {
  const approved = versions.filter(
    (version) =>
      version.protocolId === protocolId &&
      version.status === "approved" &&
      version.archivedAt === null &&
      version.approvedAt !== null,
  );
  approved.sort((a, b) => (b.approvedAt?.toMillis() ?? 0) - (a.approvedAt?.toMillis() ?? 0));
  return approved[0] ?? null;
}

/** The compliance of one participation, from what the reader holds of it. */
export function participationCompliance(
  participation: Stored<Pick<ParticipationDoc, "laboratoryId" | "protocolId" | "protocolVersionId">>,
  versions: readonly Stored<ReplicationProtocolVersionDoc>[],
  team: readonly Pick<ParticipationTeamMemberDoc, "personId" | "archivedAt">[],
  acknowledgements: readonly Pick<ParticipationAcknowledgementDoc, "personId" | "protocolVersionId">[],
  deviations: readonly Pick<ParticipationDeviationDoc, "severity" | "status" | "archivedAt">[],
): ParticipationCompliance {
  const open = { minor: 0, major: 0, critical: 0 };
  for (const deviation of deviations) {
    if (deviation.archivedAt === null && deviation.status !== "resolved") open[deviation.severity] += 1;
  }
  const people = [...new Set(team.filter((member) => member.archivedAt === null).map((member) => member.personId))];
  const current =
    participation.protocolId === undefined ? null : currentApprovedVersion(versions, participation.protocolId);
  const acknowledgedBy =
    current === null
      ? []
      : people.filter((person) =>
          acknowledgements.some((ack) => ack.personId === person && ack.protocolVersionId === current.id),
        );
  const awaiting = people.filter((person) => !acknowledgedBy.includes(person));
  const followed = participation.protocolVersionId ?? null;
  const state: ComplianceState =
    participation.protocolId === undefined
      ? "noProtocol"
      : current === null
        ? "noApprovedVersion"
        : followed !== null && followed !== current.id
          ? "outdatedVersion"
          : people.length === 0
            ? "noTeam"
            : awaiting.length > 0
              ? "awaitingAcknowledgement"
              : open.minor + open.major + open.critical > 0
                ? "openDeviations"
                : "compliant";
  return {
    participationId: participation.id,
    laboratoryId: participation.laboratoryId,
    state,
    currentVersionId: current?.id ?? null,
    followedVersionId: followed,
    teamSize: people.length,
    acknowledgedBy,
    awaiting,
    openDeviations: open,
  };
}

export const COMPLIANCE_STATE_LABELS: Readonly<Record<ComplianceState, string>> = {
  noProtocol: "No protocol named",
  noApprovedVersion: "No approved version",
  outdatedVersion: "Follows an earlier version",
  noTeam: "No team recorded",
  awaitingAcknowledgement: "Awaiting acknowledgement",
  openDeviations: "Open deviations",
  compliant: "Compliant",
};
