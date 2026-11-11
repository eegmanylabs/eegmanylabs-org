// The list of laboratories as rows: what each row shows, how the list is searched, filtered and
// sorted, and how that state is written into the address so that a filtered view can be shared
// and survives a reload. Pure, so that it is tested by itself. It follows the lists of
// replications and members.
import type { DataOrigin } from "@eegml/shared";
import { matchesSearch, searchWords } from "@eegml/shared";
import type { SortDirection } from "@/components/ui/sort-header";

export interface LaboratorySource {
  readonly id: string;
  readonly name: string;
  readonly institutionId?: string;
  readonly department?: string;
  readonly countryCode?: string;
  readonly city?: string;
  readonly piPersonId?: string;
  readonly status: "unverified" | "active" | "inactive";
  readonly dataOrigin: DataOrigin;
  readonly archivedAt: unknown;
}

export interface LaboratoryRow {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  readonly department: string | null;
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly city: string | null;
  readonly principalInvestigator: string | null;
  readonly status: LaboratorySource["status"];
  /** The replications the laboratory takes part in, by study identifier, in order. */
  readonly replicationIds: readonly string[];
  readonly dataOrigin: DataOrigin;
}

export interface LaboratoryRowInputs {
  readonly laboratories: readonly LaboratorySource[];
  readonly institutionNames: ReadonlyMap<string, string>;
  readonly personNames: ReadonlyMap<string, string>;
  /** The replications of each laboratory, from the participations that are not archived. */
  readonly replicationsOf: ReadonlyMap<string, readonly string[]>;
  readonly countryName: (code: string) => string;
}

/** One row for each laboratory that is not archived. */
export function buildLaboratoryRows(inputs: LaboratoryRowInputs): LaboratoryRow[] {
  return inputs.laboratories
    .filter((laboratory) => laboratory.archivedAt == null)
    .map((laboratory) => ({
      id: laboratory.id,
      name: laboratory.name,
      institution:
        laboratory.institutionId === undefined
          ? null
          : (inputs.institutionNames.get(laboratory.institutionId) ?? laboratory.institutionId),
      department: laboratory.department ?? null,
      countryCode: laboratory.countryCode ?? null,
      countryName: laboratory.countryCode === undefined ? null : inputs.countryName(laboratory.countryCode),
      city: laboratory.city ?? null,
      principalInvestigator:
        laboratory.piPersonId === undefined
          ? null
          : (inputs.personNames.get(laboratory.piPersonId) ?? laboratory.piPersonId),
      status: laboratory.status,
      replicationIds: [...(inputs.replicationsOf.get(laboratory.id) ?? [])].sort(),
      dataOrigin: laboratory.dataOrigin,
    }));
}

export const LABORATORY_SORT_KEYS = ["name", "institution", "country", "city", "replications"] as const;
export type LaboratorySortKey = (typeof LABORATORY_SORT_KEYS)[number];

export interface LaboratoryListState {
  readonly query: string;
  /** A country code, or null for every country. */
  readonly country: string | null;
  /** A study identifier: the laboratories that take part in it. Null for every laboratory. */
  readonly replication: string | null;
  readonly sort: LaboratorySortKey;
  readonly direction: SortDirection;
  /** The laboratory shown in the side panel, or null. */
  readonly open: string | null;
}

export const DEFAULT_LABORATORY_STATE: LaboratoryListState = {
  query: "",
  country: null,
  replication: null,
  sort: "name",
  direction: "asc",
  open: null,
};

const text = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value);

export function parseLaboratoryState(params: URLSearchParams): LaboratoryListState {
  const sort = params.get("sort");
  return {
    query: params.get("q") ?? "",
    country: text(params.get("country")),
    replication: text(params.get("replication")),
    sort:
      sort !== null && (LABORATORY_SORT_KEYS as readonly string[]).includes(sort)
        ? (sort as LaboratorySortKey)
        : DEFAULT_LABORATORY_STATE.sort,
    direction: params.get("dir") === "desc" ? "desc" : "asc",
    open: text(params.get("open")),
  };
}

/** Writes the state into a query. Defaults are left out, so the plain list has a plain address. */
export function serialiseLaboratoryState(state: LaboratoryListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query !== "") params.set("q", state.query);
  if (state.country !== null) params.set("country", state.country);
  if (state.replication !== null) params.set("replication", state.replication);
  if (state.sort !== DEFAULT_LABORATORY_STATE.sort) params.set("sort", state.sort);
  if (state.direction !== DEFAULT_LABORATORY_STATE.direction) params.set("dir", state.direction);
  if (state.open !== null) params.set("open", state.open);
  return params;
}

/** Whether a row matches the search: its name, institution, department, city and country. */
export function matchesLaboratoryQuery(row: LaboratoryRow, query: string): boolean {
  return matchesSearch(searchWords(query), [row.name, row.institution, row.department, row.city, row.countryName]);
}

export function filterLaboratories(
  rows: readonly LaboratoryRow[],
  state: Pick<LaboratoryListState, "query" | "country" | "replication">,
): LaboratoryRow[] {
  return rows.filter(
    (row) =>
      matchesLaboratoryQuery(row, state.query) &&
      (state.country === null || row.countryCode === state.country) &&
      (state.replication === null || row.replicationIds.includes(state.replication)),
  );
}

const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/** A missing value comes last whichever way the list is sorted: an unknown is never smaller or larger. */
function missingLast<T>(a: T | null, b: T | null, direction: SortDirection, compare: (a: T, b: T) => number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? compare(a, b) : compare(b, a);
}

export function sortLaboratories(
  rows: readonly LaboratoryRow[],
  key: LaboratorySortKey,
  direction: SortDirection,
): LaboratoryRow[] {
  const compare = (a: LaboratoryRow, b: LaboratoryRow): number => {
    switch (key) {
      case "name":
        return missingLast(a.name, b.name, direction, byText);
      case "institution":
        return missingLast(a.institution, b.institution, direction, byText);
      case "country":
        return missingLast(a.countryName, b.countryName, direction, byText);
      case "city":
        return missingLast(a.city, b.city, direction, byText);
      case "replications":
        return missingLast(a.replicationIds.length, b.replicationIds.length, direction, (x, y) => x - y);
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || byText(a.name, b.name) || byText(a.id, b.id));
}

/** The countries and replications that the filters offer, from the rows, in a useful order. */
export function laboratoryFilterOptions(rows: readonly LaboratoryRow[]) {
  const countries = new Map<string, string>();
  const replications = new Set<string>();
  for (const row of rows) {
    if (row.countryCode !== null) countries.set(row.countryCode, row.countryName ?? row.countryCode);
    for (const id of row.replicationIds) replications.add(id);
  }
  return {
    countries: [...countries].sort(([, a], [, b]) => byText(a, b)).map(([code, name]) => ({ code, name })),
    replications: [...replications].sort(byText),
  };
}
