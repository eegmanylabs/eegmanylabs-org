// The list of replications as rows: what each row shows, how the list is searched, filtered and
// sorted, and how that state is written into the address so that a filtered view can be shared
// and survives a reload. Pure, so that it is tested by itself.
import type { DataOrigin } from "@eegml/shared";
import { matchesSearch, searchWords } from "@eegml/shared";
import type { SortDirection } from "@/components/ui/sort-header";

/** What a row needs from the documents behind it. */
export interface ReplicationSource {
  readonly id: string;
  readonly studyKey: string;
  readonly shortTitle?: string;
  readonly originalTitle?: string;
  readonly originalAuthors?: string;
  readonly originalYear?: number;
  readonly statusKey: string | null;
  readonly publicStageNumber?: number;
  readonly publicStageName?: string;
  readonly theme?: string;
  readonly psychConstruct?: string;
  readonly leadPersonIds: readonly string[];
  readonly selectionStatus: "selected" | "withdrawn";
  readonly dataOrigin: DataOrigin;
  readonly archivedAt: unknown;
}

export interface StatusOption {
  readonly key: string;
  readonly label: string;
  readonly position: number;
}

/**
 * | Lead state    | Meaning                                                                       |
 * |---------------|-------------------------------------------------------------------------------|
 * | `confirmed`   | The replication names confirmed leads                                         |
 * | `needsReview` | No lead is confirmed, and a lead membership the caller may see awaits review   |
 * | `none`        | No lead is confirmed, and the caller sees no lead that awaits review           |
 */
export type LeadState = "confirmed" | "needsReview" | "none";

export interface ReplicationRow {
  readonly studyKey: string;
  readonly title: string | null;
  readonly originalAuthors: string | null;
  readonly originalYear: number | null;
  /** The key of the status, null where none is recorded. */
  readonly statusKey: string | null;
  /** The label of the status, or its key where the programme no longer configures it. */
  readonly statusLabel: string | null;
  readonly statusPosition: number | null;
  readonly stageNumber: number | null;
  readonly stageName: string | null;
  readonly theme: string | null;
  readonly construct: string | null;
  readonly leadNames: readonly string[];
  readonly leadState: LeadState;
  readonly laboratoryCount: number;
  readonly publicationCount: number;
  /** The statuses of the publications of the replication, one for each publication. */
  readonly publicationStatuses: readonly string[];
  readonly withdrawn: boolean;
  readonly dataOrigin: DataOrigin;
  /** Other spellings of the identifier, which the search also looks in. */
  readonly aliases: readonly string[];
}

export interface RowInputs {
  readonly replications: readonly ReplicationSource[];
  readonly statuses: readonly StatusOption[];
  /** The name of each person, by identifier. */
  readonly personNames: ReadonlyMap<string, string>;
  /** The replications for which the caller sees a lead membership that awaits review. */
  readonly leadsToReview: ReadonlySet<string>;
  /** The number of laboratories that take part in each replication. */
  readonly laboratoryCounts: ReadonlyMap<string, number>;
  /** The status of each publication of each replication. */
  readonly publicationStatuses: ReadonlyMap<string, readonly string[]>;
  readonly aliases: ReadonlyMap<string, readonly string[]>;
}

/** One row for each replication that is not archived. */
export function buildReplicationRows(inputs: RowInputs): ReplicationRow[] {
  const statuses = new Map(inputs.statuses.map((status) => [status.key, status]));
  return inputs.replications
    .filter((replication) => replication.archivedAt == null)
    .map((replication) => {
      const status = replication.statusKey === null ? undefined : statuses.get(replication.statusKey);
      const leadNames = replication.leadPersonIds.map((id) => inputs.personNames.get(id) ?? id);
      return {
        studyKey: replication.studyKey,
        title: replication.shortTitle ?? replication.originalTitle ?? null,
        originalAuthors: replication.originalAuthors ?? null,
        originalYear: replication.originalYear ?? null,
        statusKey: replication.statusKey,
        statusLabel: replication.statusKey === null ? null : (status?.label ?? replication.statusKey),
        statusPosition: status?.position ?? null,
        stageNumber: replication.publicStageNumber ?? null,
        stageName: replication.publicStageName ?? null,
        theme: replication.theme ?? null,
        construct: replication.psychConstruct ?? null,
        leadNames,
        leadState:
          leadNames.length > 0 ? "confirmed" : inputs.leadsToReview.has(replication.studyKey) ? "needsReview" : "none",
        laboratoryCount: inputs.laboratoryCounts.get(replication.studyKey) ?? 0,
        publicationCount: inputs.publicationStatuses.get(replication.studyKey)?.length ?? 0,
        publicationStatuses: inputs.publicationStatuses.get(replication.studyKey) ?? [],
        withdrawn: replication.selectionStatus === "withdrawn",
        dataOrigin: replication.dataOrigin,
        aliases: inputs.aliases.get(replication.studyKey) ?? [],
      };
    });
}

/** The value of the status filter that stands for "no status recorded". */
export const NO_STATUS = "none";

export const LISTINGS = ["all", "listed", "withdrawn"] as const;
export type Listing = (typeof LISTINGS)[number];

export const REPLICATION_SORT_KEYS = [
  "studyKey",
  "original",
  "title",
  "status",
  "stage",
  "theme",
  "construct",
  "leads",
  "laboratories",
  "publications",
] as const;
export type ReplicationSortKey = (typeof REPLICATION_SORT_KEYS)[number];

export interface ReplicationListState {
  readonly query: string;
  /** A status key, `NO_STATUS`, or null for every status. */
  readonly status: string | null;
  /** A stage number as text, `NO_STATUS` for no stage, or null for every stage. */
  readonly stage: string | null;
  readonly theme: string | null;
  readonly listing: Listing;
  /** A status of publications: the replications that have a publication in it. Null for every replication. */
  readonly publication: string | null;
  readonly sort: ReplicationSortKey;
  readonly direction: SortDirection;
  /** The study identifier shown in the side panel, or null. */
  readonly open: string | null;
}

export const DEFAULT_REPLICATION_STATE: ReplicationListState = {
  query: "",
  status: null,
  stage: null,
  theme: null,
  listing: "all",
  publication: null,
  sort: "studyKey",
  direction: "asc",
  open: null,
};

const oneOf = <T extends string>(values: readonly T[], value: string | null, fallback: T): T =>
  value !== null && (values as readonly string[]).includes(value) ? (value as T) : fallback;

const text = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value);

/** Reads the state of the list from the query of the address. Unknown values fall back to the default. */
export function parseReplicationState(params: URLSearchParams): ReplicationListState {
  return {
    query: params.get("q") ?? "",
    status: text(params.get("status")),
    stage: text(params.get("stage")),
    theme: text(params.get("theme")),
    listing: oneOf(LISTINGS, params.get("listing"), DEFAULT_REPLICATION_STATE.listing),
    publication: text(params.get("publication")),
    sort: oneOf(REPLICATION_SORT_KEYS, params.get("sort"), DEFAULT_REPLICATION_STATE.sort),
    direction: params.get("dir") === "desc" ? "desc" : "asc",
    open: text(params.get("open")),
  };
}

/** Writes the state into a query. Defaults are left out, so the plain list has a plain address. */
export function serialiseReplicationState(state: ReplicationListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query !== "") params.set("q", state.query);
  if (state.status !== null) params.set("status", state.status);
  if (state.stage !== null) params.set("stage", state.stage);
  if (state.theme !== null) params.set("theme", state.theme);
  if (state.listing !== DEFAULT_REPLICATION_STATE.listing) params.set("listing", state.listing);
  if (state.publication !== null) params.set("publication", state.publication);
  if (state.sort !== DEFAULT_REPLICATION_STATE.sort) params.set("sort", state.sort);
  if (state.direction !== DEFAULT_REPLICATION_STATE.direction) params.set("dir", state.direction);
  if (state.open !== null) params.set("open", state.open);
  return params;
}

/** Whether a row matches the search: the identifier, the aliases, the titles and the authors. */
export function matchesReplicationQuery(row: ReplicationRow, query: string): boolean {
  return matchesSearch(searchWords(query), [
    row.studyKey,
    ...row.aliases,
    row.title,
    row.originalAuthors,
    row.originalYear?.toString(),
  ]);
}

/** Applies the search and the filters. */
export function filterReplications(
  rows: readonly ReplicationRow[],
  state: Pick<ReplicationListState, "query" | "status" | "stage" | "theme" | "listing" | "publication">,
): ReplicationRow[] {
  return rows.filter(
    (row) =>
      matchesReplicationQuery(row, state.query) &&
      (state.status === null ||
        (state.status === NO_STATUS ? row.statusKey === null : row.statusKey === state.status)) &&
      (state.stage === null ||
        (state.stage === NO_STATUS ? row.stageNumber === null : String(row.stageNumber) === state.stage)) &&
      (state.theme === null || row.theme === state.theme) &&
      (state.listing === "all" || (state.listing === "withdrawn") === row.withdrawn) &&
      (state.publication === null || row.publicationStatuses.includes(state.publication)),
  );
}

const byText = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "en", { sensitivity: "base" });

/**
 * Compares two values of which either may be missing. A missing value comes last whichever way
 * the list is sorted, because an unknown is never smaller or larger than a known value.
 */
function withMissingLast<T>(
  a: T | null,
  b: T | null,
  direction: SortDirection,
  compare: (a: T, b: T) => number,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? compare(a, b) : compare(b, a);
}

const numeric = (a: number, b: number) => a - b;

interface StatusOrder {
  readonly position: number;
  readonly label: string;
}

const statusOrder = (row: ReplicationRow): StatusOrder | null =>
  row.statusKey === null
    ? null
    : { position: row.statusPosition ?? Number.MAX_SAFE_INTEGER, label: row.statusLabel ?? row.statusKey };

const compareStatusOrder = (a: StatusOrder, b: StatusOrder) => a.position - b.position || byText(a.label, b.label);

function compareRows(a: ReplicationRow, b: ReplicationRow, key: ReplicationSortKey, direction: SortDirection): number {
  switch (key) {
    case "studyKey":
      return withMissingLast(a.studyKey, b.studyKey, direction, byText);
    case "original":
      return (
        withMissingLast(a.originalAuthors, b.originalAuthors, direction, byText) ||
        withMissingLast(a.originalYear, b.originalYear, direction, numeric)
      );
    case "title":
      return withMissingLast(a.title, b.title, direction, byText);
    case "status":
      // In the order the programme gives its statuses; a status it no longer configures after those.
      return withMissingLast(statusOrder(a), statusOrder(b), direction, compareStatusOrder);
    case "stage":
      return withMissingLast(a.stageNumber, b.stageNumber, direction, numeric);
    case "theme":
      return withMissingLast(a.theme, b.theme, direction, byText);
    case "construct":
      return withMissingLast(a.construct, b.construct, direction, byText);
    case "leads":
      return withMissingLast(a.leadNames[0] ?? null, b.leadNames[0] ?? null, direction, byText);
    case "laboratories":
      return withMissingLast(a.laboratoryCount, b.laboratoryCount, direction, numeric);
    case "publications":
      return withMissingLast(a.publicationCount, b.publicationCount, direction, numeric);
  }
}

/** Sorts rows by a column. Ties fall back to the study identifier, so the order is stable. */
export function sortReplications(
  rows: readonly ReplicationRow[],
  key: ReplicationSortKey,
  direction: SortDirection,
): ReplicationRow[] {
  return [...rows].sort((a, b) => compareRows(a, b, key, direction) || byText(a.studyKey, b.studyKey));
}

/** The distinct values of the filters, from the rows, in a useful order. */
export function filterOptions(rows: readonly ReplicationRow[]) {
  const statuses = new Map<string, { label: string; position: number }>();
  const stages = new Map<number, string | null>();
  const themes = new Set<string>();
  for (const row of rows) {
    if (row.statusKey !== null) {
      statuses.set(row.statusKey, {
        label: row.statusLabel ?? row.statusKey,
        position: row.statusPosition ?? Number.MAX_SAFE_INTEGER,
      });
    }
    if (row.stageNumber !== null) stages.set(row.stageNumber, row.stageName);
    if (row.theme !== null) themes.add(row.theme);
  }
  return {
    statuses: [...statuses.entries()]
      .sort(([, a], [, b]) => a.position - b.position || byText(a.label, b.label))
      .map(([key, { label }]) => ({ key, label })),
    stages: [...stages.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, name]) => ({ number, name: name === null ? name : stageLabel(name) })),
    themes: [...themes].sort(byText),
    hasNoStatus: rows.some((row) => row.statusKey === null),
    hasNoStage: rows.some((row) => row.stageNumber === null),
  };
}

/**
 * The name of a stage as a reader sees it. A source that stores a machine value, such as
 * `data_collection`, reads as "Data collection"; a name written for people stays as it is.
 */
export function stageLabel(name: string): string {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(name)) return name;
  const words = name.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** How the stage reads, for example "3. Data collection". */
export function stageText(row: Pick<ReplicationRow, "stageNumber" | "stageName">): string | null {
  const name = row.stageName === null ? null : stageLabel(row.stageName);
  if (row.stageNumber === null) return name;
  return name === null ? `Stage ${row.stageNumber}` : `${row.stageNumber}. ${name}`;
}
