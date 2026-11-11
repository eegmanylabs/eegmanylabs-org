// The moves of a participation from one status to another, and who decides each (decision
// D-008). `setParticipationStatus` refuses every move that is not in this table and every
// caller who does not speak for the side that decides it, and the interface offers only what
// the table allows the viewer.
//
// | From                 | To                   | Decided by    | Also needs                     |
// |----------------------|----------------------|---------------|--------------------------------|
// | `invited`            | `confirmed`, `declined` | laboratory |                                |
// | `interested`         | `confirmed`, `declined` | replication |                               |
// | `confirmed`          | `onboarding`         | laboratory    |                                |
// | `onboarding`         | `ready`              | replication   |                                |
// | `ready`              | `onboarding`         | replication   |                                |
// | `ready`              | `collecting`         | replication   | Readiness approved and signed  |
// | `collecting`         | `collectionComplete` | replication   |                                |
// | `collectionComplete` | `collecting`         | replication   |                                |
// | `declined`, `withdrawn` | `invited`         | replication   |                                |
// | Any status before `collectionComplete` | `withdrawn` | laboratory or replication |      |
//
// The laboratory speaks for itself through a holder of `participations.manage` for the
// laboratory, and the replication through a holder of it for the replication. Programme
// administrators and the core team hold it for the programme, so they speak for both.
import type { ParticipationStatus } from "./schemas/participation";

export type ParticipationSide = "laboratory" | "replication";

export interface ParticipationTransition {
  readonly from: ParticipationStatus;
  readonly to: ParticipationStatus;
  /** Either side may decide the move when both are named. */
  readonly decidedBy: readonly ParticipationSide[];
  /** The move needs readiness approved, with the approval signed in the restricted detail. */
  readonly requiresApprovedReadiness: boolean;
}

const LABORATORY: readonly ParticipationSide[] = ["laboratory"];
const REPLICATION: readonly ParticipationSide[] = ["replication"];
const EITHER: readonly ParticipationSide[] = ["laboratory", "replication"];

const move = (
  from: ParticipationStatus,
  to: ParticipationStatus,
  decidedBy: readonly ParticipationSide[],
  requiresApprovedReadiness = false,
): ParticipationTransition => ({ from, to, decidedBy, requiresApprovedReadiness });

/** The statuses from which a participation may still be withdrawn. */
const WITHDRAWABLE: readonly ParticipationStatus[] = [
  "invited",
  "interested",
  "confirmed",
  "onboarding",
  "ready",
  "collecting",
];

export const PARTICIPATION_TRANSITIONS: readonly ParticipationTransition[] = [
  move("invited", "confirmed", LABORATORY),
  move("invited", "declined", LABORATORY),
  move("interested", "confirmed", REPLICATION),
  move("interested", "declined", REPLICATION),
  move("confirmed", "onboarding", LABORATORY),
  move("onboarding", "ready", REPLICATION),
  move("ready", "onboarding", REPLICATION),
  move("ready", "collecting", REPLICATION, true),
  move("collecting", "collectionComplete", REPLICATION),
  move("collectionComplete", "collecting", REPLICATION),
  move("declined", "invited", REPLICATION),
  move("withdrawn", "invited", REPLICATION),
  ...WITHDRAWABLE.map((from) => move(from, "withdrawn", EITHER)),
];

/** The move from one status to another, or null where the table has no such move. */
export function participationTransition(
  from: ParticipationStatus,
  to: ParticipationStatus,
): ParticipationTransition | null {
  return PARTICIPATION_TRANSITIONS.find((entry) => entry.from === from && entry.to === to) ?? null;
}

/** The moves out of a status that a caller who speaks for the given sides may decide. */
export function transitionsFor(
  from: ParticipationStatus,
  sides: ReadonlySet<ParticipationSide>,
): ParticipationTransition[] {
  return PARTICIPATION_TRANSITIONS.filter(
    (entry) => entry.from === from && entry.decidedBy.some((side) => sides.has(side)),
  );
}
