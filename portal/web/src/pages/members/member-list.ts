// The members directory as rows: what each row shows, how the directory is searched, filtered
// and sorted, and how that state is written into the address. Pure, so that it is tested by
// itself, and fast enough for thousands of rows.
import type { DataOrigin } from "@eegml/shared";
import { fold } from "@eegml/shared";
import type { SortDirection } from "@/components/ui/sort-header";

/** What a row needs from the directory document of a person. */
export interface PersonSource {
  readonly id: string;
  readonly displayName: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly affiliationSummary?: string;
  readonly countryCode?: string;
  readonly replicationIds: readonly string[];
  readonly isCoreTeam: boolean;
  readonly coreRoles: readonly string[];
  readonly userId: string | null;
  readonly dataOrigin: DataOrigin;
  readonly archivedAt: unknown;
}

export interface MemberRow {
  readonly id: string;
  readonly name: string;
  /** Family name first, the way a directory is ordered. */
  readonly sortName: string;
  readonly affiliation: string | null;
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly replicationIds: readonly string[];
  readonly isCoreTeam: boolean;
  readonly coreRoles: readonly string[];
  readonly claimed: boolean;
  readonly dataOrigin: DataOrigin;
  /** The folded texts that the search looks in, computed once. */
  readonly searchText: string;
}

/** One row for each person who is not archived. */
export function buildMemberRows(
  persons: readonly PersonSource[],
  countryName: (code: string) => string,
): MemberRow[] {
  return persons
    .filter((person) => person.archivedAt == null)
    .map((person) => {
      const affiliation = person.affiliationSummary ?? null;
      return {
        id: person.id,
        name: person.displayName,
        sortName: [person.familyName, person.givenName, person.displayName].filter(Boolean).join(" "),
        affiliation,
        countryCode: person.countryCode ?? null,
        countryName: person.countryCode === undefined ? null : countryName(person.countryCode),
        replicationIds: person.replicationIds,
        isCoreTeam: person.isCoreTeam,
        coreRoles: person.coreRoles,
        claimed: person.userId !== null,
        dataOrigin: person.dataOrigin,
        searchText: fold([person.displayName, person.givenName, person.familyName, affiliation].filter(Boolean).join(" ")),
      };
    });
}

/** The value of the country filter that stands for "no country recorded". */
export const NO_COUNTRY = "none";

export const MEMBER_SORT_KEYS = ["name", "affiliation", "country", "replications", "core", "claimed"] as const;
export type MemberSortKey = (typeof MEMBER_SORT_KEYS)[number];

export interface MemberListState {
  readonly query: string;
  /** A country code, `NO_COUNTRY`, or null for every country. */
  readonly country: string | null;
  /** A study identifier, or null for every replication. */
  readonly replication: string | null;
  /** Whether to show the core team only. */
  readonly coreTeam: boolean;
  readonly sort: MemberSortKey;
  readonly direction: SortDirection;
  readonly open: string | null;
}

export const DEFAULT_MEMBER_STATE: MemberListState = {
  query: "",
  country: null,
  replication: null,
  coreTeam: false,
  sort: "name",
  direction: "asc",
  open: null,
};

const text = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value);

export function parseMemberState(params: URLSearchParams): MemberListState {
  const sort = params.get("sort");
  return {
    query: params.get("q") ?? "",
    country: text(params.get("country")),
    replication: text(params.get("replication")),
    coreTeam: params.get("core") === "yes",
    sort: sort !== null && (MEMBER_SORT_KEYS as readonly string[]).includes(sort) ? (sort as MemberSortKey) : "name",
    direction: params.get("dir") === "desc" ? "desc" : "asc",
    open: text(params.get("open")),
  };
}

export function serialiseMemberState(state: MemberListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query !== "") params.set("q", state.query);
  if (state.country !== null) params.set("country", state.country);
  if (state.replication !== null) params.set("replication", state.replication);
  if (state.coreTeam) params.set("core", "yes");
  if (state.sort !== DEFAULT_MEMBER_STATE.sort) params.set("sort", state.sort);
  if (state.direction !== DEFAULT_MEMBER_STATE.direction) params.set("dir", state.direction);
  if (state.open !== null) params.set("open", state.open);
  return params;
}

/** Applies the search, across name and affiliation, and the filters. */
export function filterMembers(
  rows: readonly MemberRow[],
  state: Pick<MemberListState, "query" | "country" | "replication" | "coreTeam">,
): MemberRow[] {
  const words = fold(state.query).split("-").filter(Boolean);
  return rows.filter(
    (row) =>
      words.every((word) => row.searchText.includes(word)) &&
      (state.country === null ||
        (state.country === NO_COUNTRY ? row.countryCode === null : row.countryCode === state.country)) &&
      (state.replication === null || row.replicationIds.includes(state.replication)) &&
      (!state.coreTeam || row.isCoreTeam),
  );
}

const collator = new Intl.Collator("en", { sensitivity: "base" });

/** Compares values of which either may be missing, with a missing value last either way. */
function missingLast<T>(a: T | null, b: T | null, direction: SortDirection, compare: (a: T, b: T) => number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? compare(a, b) : compare(b, a);
}

function compareMembers(a: MemberRow, b: MemberRow, key: MemberSortKey, direction: SortDirection): number {
  const flip = (value: number) => (direction === "asc" ? value : -value);
  switch (key) {
    case "name":
      return flip(collator.compare(a.sortName, b.sortName));
    case "affiliation":
      return missingLast(a.affiliation, b.affiliation, direction, collator.compare);
    case "country":
      return missingLast(a.countryName, b.countryName, direction, collator.compare);
    case "replications":
      return flip(a.replicationIds.length - b.replicationIds.length);
    case "core":
      return flip(Number(a.isCoreTeam) - Number(b.isCoreTeam));
    case "claimed":
      return flip(Number(a.claimed) - Number(b.claimed));
  }
}

/** Sorts rows by a column. Ties fall back to the name, so the order is stable. */
export function sortMembers(rows: readonly MemberRow[], key: MemberSortKey, direction: SortDirection): MemberRow[] {
  return [...rows].sort(
    (a, b) => compareMembers(a, b, key, direction) || collator.compare(a.sortName, b.sortName) || collator.compare(a.id, b.id),
  );
}

/** The countries that occur in the directory, by name. */
export function countryOptions(rows: readonly MemberRow[]): { code: string; name: string }[] {
  const countries = new Map<string, string>();
  for (const row of rows) {
    if (row.countryCode !== null && row.countryName !== null) countries.set(row.countryCode, row.countryName);
  }
  return [...countries.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => collator.compare(a.name, b.name));
}
