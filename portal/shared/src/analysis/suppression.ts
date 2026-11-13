// Small-cell suppression for analysis views and their exports (requirement R15.10). A count of
// fewer than `SMALL_CELL_THRESHOLD` people in a group can point at an individual, so it is shown
// as suppressed and never as a number. Where exactly one cell of a breakdown is suppressed, the
// next smallest is suppressed too, so that the hidden value cannot be worked out from the total.
// The total of the breakdown is shown only where no cell is suppressed.

/** The smallest count shown: a group of fewer than five people is suppressed. */
export const SMALL_CELL_THRESHOLD = 5;

export type SuppressedCount = { readonly suppressed: false; readonly count: number } | { readonly suppressed: true };

export interface SuppressedBreakdown {
  readonly cells: readonly { readonly key: string; readonly value: SuppressedCount }[];
  /** The total, or null where a cell is suppressed. */
  readonly total: number | null;
  readonly suppressedCells: number;
}

export function suppressSmallCells(
  counts: Readonly<Record<string, number>>,
  threshold: number = SMALL_CELL_THRESHOLD,
): SuppressedBreakdown {
  const entries = Object.entries(counts).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const hidden = new Set(entries.filter(([, count]) => count > 0 && count < threshold).map(([key]) => key));
  if (hidden.size === 1) {
    const next = entries
      .filter(([key, count]) => !hidden.has(key) && count > 0)
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (next !== undefined) hidden.add(next[0]);
  }
  const cells = entries.map(([key, count]) => ({
    key,
    value: hidden.has(key) ? ({ suppressed: true } as const) : ({ suppressed: false, count } as const),
  }));
  return {
    cells,
    total: hidden.size === 0 ? entries.reduce((sum, [, count]) => sum + count, 0) : null,
    suppressedCells: hidden.size,
  };
}

/** How a suppressed cell reads, in an interface and in an export. */
export const SUPPRESSED_TEXT = `Fewer than ${SMALL_CELL_THRESHOLD}`;

/** The one cell that stands for every suppressed group of a release of special-category counts. */
export const SUPPRESSED_GROUP_LABEL = "Other or suppressed";

/** How many groups of special-category values must reach the threshold before any is named. */
export const NAMED_GROUPS_MINIMUM = 2;

export interface DemographicRelease {
  /** The people of the scope, or null wherever a group is suppressed. */
  readonly people: number | null;
  readonly cells: readonly { readonly category: string; readonly count: number | null }[];
  /** The total, or null wherever a group is suppressed. */
  readonly total: number | null;
}

/**
 * What may be released of the counts of a special-category field for one scope (requirement
 * R15.10). Suppressing small cells alone is not enough here, because the number of people in the
 * scope and the categories of the suppressed cells together can state a person's value: one
 * person and one suppressed cell, or a few people who all share a category. So:
 *
 * - a scope of fewer people than the threshold releases nothing but that fact;
 * - suppressed groups are folded into one unnamed cell, so no category is named without a count
 *   of at least the threshold;
 * - a value is named only while at least `NAMED_GROUPS_MINIMUM` values reach the threshold, so a
 *   group that everyone of a scope shares is never stated;
 * - the number of people and the total are withheld wherever any group is suppressed.
 *
 * Categories in `exempt` (such as "Not recorded") are no special-category value: they are shown
 * like the others but do not count towards the values named.
 */
export function releaseDemographicCounts(
  counts: Readonly<Record<string, number>>,
  exempt: ReadonlySet<string> = new Set(),
  threshold: number = SMALL_CELL_THRESHOLD,
): DemographicRelease {
  const people = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (people < threshold) return { people: null, cells: [], total: null };
  const breakdown = suppressSmallCells(counts, threshold);
  const shownValues = breakdown.cells.filter((cell) => !cell.value.suppressed && !exempt.has(cell.key)).length;
  const nameValues = shownValues >= NAMED_GROUPS_MINIMUM;
  const cells: { category: string; count: number | null }[] = [];
  let folded = false;
  for (const cell of breakdown.cells) {
    if (cell.value.suppressed || (!nameValues && !exempt.has(cell.key))) {
      if (cell.value.suppressed || cell.value.count > 0) folded = true;
      continue;
    }
    cells.push({ category: cell.key, count: cell.value.count });
  }
  if (folded) cells.push({ category: SUPPRESSED_GROUP_LABEL, count: null });
  return { people: folded ? null : people, cells, total: folded ? null : people };
}
