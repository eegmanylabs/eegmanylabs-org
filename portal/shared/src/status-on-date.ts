// The status of a record as it stood at a moment (R7.6), read from its status history: every
// change is an entry with the time it took effect and the time it was recorded, and of two
// entries that took effect at the same time the one recorded later holds (docs/DATA_MODEL.md,
// section 5).

/** What the reconstruction needs of an entry of the status history. */
export interface StatusHistoryEntry {
  readonly toStatusKey: string;
  readonly effectiveAt: Date;
  readonly recordedAt: Date;
}

/** The status at a moment: the entry that holds then, or none where no entry had taken effect. */
export type StatusAt<E extends StatusHistoryEntry> =
  | { readonly kind: "status"; readonly statusKey: string; readonly entry: E; readonly recordedLater: boolean }
  | { readonly kind: "none" };

/**
 * The status that held just before `before`: of the entries that took effect earlier, the one
 * that took effect last, and of those that took effect together the one recorded last.
 * `recordedLater` says that the entry was recorded at or after `before`, so that at the time
 * itself the history did not yet say so: a change entered afterwards with an earlier effective
 * time.
 */
export function statusAt<E extends StatusHistoryEntry>(entries: readonly E[], before: Date): StatusAt<E> {
  let holding: E | null = null;
  for (const entry of entries) {
    if (entry.effectiveAt.getTime() >= before.getTime()) continue;
    if (
      holding === null ||
      entry.effectiveAt.getTime() > holding.effectiveAt.getTime() ||
      (entry.effectiveAt.getTime() === holding.effectiveAt.getTime() &&
        entry.recordedAt.getTime() > holding.recordedAt.getTime())
    ) {
      holding = entry;
    }
  }
  if (holding === null) return { kind: "none" };
  return {
    kind: "status",
    statusKey: holding.toStatusKey,
    entry: holding,
    recordedLater: holding.recordedAt.getTime() >= before.getTime(),
  };
}
