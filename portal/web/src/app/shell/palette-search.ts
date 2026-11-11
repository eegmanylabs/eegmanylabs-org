// What the command palette finds for a query: records, destinations and the actions of the
// current page, grouped by kind and ranked. Pure, so that it is tested by itself. The items are
// built from the directory documents the account may load, which hold no restricted field.
import { searchFold as fold, searchWords } from "@eegml/shared";

export const PALETTE_KINDS = ["recent", "action", "destination", "replication", "member", "laboratory"] as const;
export type PaletteKind = (typeof PALETTE_KINDS)[number];

export const PALETTE_KIND_LABELS: Readonly<Record<PaletteKind, string>> = {
  recent: "Recent",
  action: "On this page",
  destination: "Go to",
  replication: "Replications",
  member: "Members",
  laboratory: "Laboratories",
};

export interface PaletteItem {
  /** Unique among the items of one search. */
  readonly id: string;
  readonly kind: PaletteKind;
  readonly label: string;
  /** A second line, such as a title or an affiliation. */
  readonly detail?: string;
  /** Other texts that find the item, such as the other spellings of a study identifier. */
  readonly keywords: readonly string[];
}

export interface PaletteGroup<T extends PaletteItem> {
  readonly kind: PaletteKind;
  readonly items: readonly T[];
}

/**
 * How well an item matches the folded words of a query: every word must be found in the label,
 * the detail or a keyword. A label that starts with the query ranks first, then a label that
 * contains it, then any other match. Zero means no match.
 */
export function matchScore(item: PaletteItem, query: string): number {
  const typed = searchWords(query);
  if (typed === null) return 1;
  if (typed.length === 0) return 0;
  const folded = fold(query);
  const label = fold(item.label);
  const texts = [label, ...(item.detail === undefined ? [] : [fold(item.detail)]), ...item.keywords.map(fold)];
  const words = folded.split("-").filter(Boolean);
  if (!words.every((word) => texts.some((text) => text.includes(word)))) return 0;
  if (label.startsWith(folded) || item.keywords.some((keyword) => fold(keyword) === folded)) return 3;
  if (label.includes(folded)) return 2;
  return 1;
}

/**
 * Groups the items that match a query, best first within each group, with at most `perGroup`
 * of each kind. The groups follow the order of `PALETTE_KINDS`. While nothing has been typed,
 * the recent items, the actions and the destinations are offered in the order given; records
 * appear once something has been typed.
 */
export function searchPalette<T extends PaletteItem>(
  items: readonly T[],
  query: string,
  perGroup = 8,
): PaletteGroup<T>[] {
  const typed = searchWords(query) !== null;
  const scored = items
    .filter((item) =>
      typed ? item.kind !== "recent" : item.kind === "recent" || item.kind === "action" || item.kind === "destination",
    )
    .map((item) => ({ item, score: matchScore(item, query) }))
    .filter(({ score }) => score > 0);
  return PALETTE_KINDS.map((kind) => ({
    kind,
    items: scored
      .filter(({ item }) => item.kind === kind)
      // Without a query, every item keeps the order it was given, which for recent items is the latest first.
      .sort((a, b) =>
        typed ? b.score - a.score || a.item.label.localeCompare(b.item.label, "en", { sensitivity: "base" }) : 0,
      )
      .slice(0, perGroup)
      .map(({ item }) => item),
  })).filter((group) => group.items.length > 0);
}
