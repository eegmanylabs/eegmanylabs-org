// The readiness matrix as data: laboratories by replications, with the onboarding state of each
// participation, and the state of the matrix in the address. Pure, so that it is tested by itself.
import type { DataOrigin, ParticipationStatus } from "@eegml/shared";

export interface MatrixParticipation {
  readonly id: string;
  readonly replicationId: string;
  readonly laboratoryId: string;
  readonly status: ParticipationStatus;
  readonly readinessStatus: "notStarted" | "inProgress" | "readyForReview" | "approved";
  /** Where the participation comes from, which the matrix labels wherever it is not live. */
  readonly dataOrigin: DataOrigin;
}

export interface ChecklistCount {
  readonly settled: number;
  readonly total: number;
}

export interface MatrixCell {
  readonly participation: MatrixParticipation;
  /** The progress of the checklist, or null where the viewer may not read it. */
  readonly progress: ChecklistCount | null;
}

export interface MatrixRow {
  readonly laboratoryId: string;
  readonly name: string;
  readonly countryCode: string | null;
  readonly cells: ReadonlyMap<string, MatrixCell>;
}

export interface ReadinessState {
  readonly replication: string | null;
  readonly country: string | null;
  readonly status: ParticipationStatus | null;
  /** The participation shown beside the matrix, or null. */
  readonly open: string | null;
}

const STATUSES: readonly ParticipationStatus[] = [
  "invited",
  "interested",
  "confirmed",
  "onboarding",
  "ready",
  "collecting",
  "collectionComplete",
  "withdrawn",
  "declined",
];

const text = (value: string | null) => (value === null || value.trim() === "" ? null : value);

export function parseReadinessState(params: URLSearchParams): ReadinessState {
  const status = params.get("status");
  return {
    replication: text(params.get("replication")),
    country: text(params.get("country")),
    status:
      status !== null && (STATUSES as readonly string[]).includes(status) ? (status as ParticipationStatus) : null,
    open: text(params.get("open")),
  };
}

export function serialiseReadinessState(state: ReadinessState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.replication !== null) params.set("replication", state.replication);
  if (state.country !== null) params.set("country", state.country);
  if (state.status !== null) params.set("status", state.status);
  if (state.open !== null) params.set("open", state.open);
  return params;
}

/**
 * The matrix: a row for each laboratory that takes part in a replication, a column for each
 * replication that has a participation, both sorted by name, after the filters. A laboratory
 * whose every participation the filters leave out has no row.
 */
export function buildMatrix(input: {
  readonly participations: readonly MatrixParticipation[];
  readonly laboratories: ReadonlyMap<string, { readonly name: string; readonly countryCode: string | null }>;
  readonly progress: ReadonlyMap<string, ChecklistCount>;
  readonly state: Pick<ReadinessState, "replication" | "country" | "status">;
}): { readonly columns: readonly string[]; readonly rows: readonly MatrixRow[] } {
  const kept = input.participations.filter((participation) => {
    const laboratory = input.laboratories.get(participation.laboratoryId);
    return (
      laboratory !== undefined &&
      (input.state.replication === null || participation.replicationId === input.state.replication) &&
      (input.state.country === null || laboratory.countryCode === input.state.country) &&
      (input.state.status === null || participation.status === input.state.status)
    );
  });
  const columns = [...new Set(kept.map((participation) => participation.replicationId))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const byLaboratory = new Map<string, Map<string, MatrixCell>>();
  for (const participation of kept) {
    const cells = byLaboratory.get(participation.laboratoryId) ?? new Map<string, MatrixCell>();
    cells.set(participation.replicationId, {
      participation,
      progress: input.progress.get(participation.id) ?? null,
    });
    byLaboratory.set(participation.laboratoryId, cells);
  }
  const rows = [...byLaboratory]
    .map(([laboratoryId, cells]) => {
      const laboratory = input.laboratories.get(laboratoryId);
      return {
        laboratoryId,
        name: laboratory?.name ?? laboratoryId,
        countryCode: laboratory?.countryCode ?? null,
        cells,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { columns, rows };
}

/** The progress of every checklist, by participation, counting items done or not applicable. */
export function progressByParticipation(
  items: readonly { readonly participationId: string; readonly status: string; readonly archivedAt: unknown }[],
): Map<string, ChecklistCount> {
  const progress = new Map<string, ChecklistCount>();
  for (const item of items) {
    if (item.archivedAt != null) continue;
    const count = progress.get(item.participationId) ?? { settled: 0, total: 0 };
    progress.set(item.participationId, {
      settled: count.settled + (item.status === "done" || item.status === "notApplicable" ? 1 : 0),
      total: count.total + 1,
    });
  }
  return progress;
}
