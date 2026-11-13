// The figures of the programme snapshot on Home, counted from live documents. Each figure says
// which filtered list it was counted from, so that it can link there. Pure, so that it is
// tested by itself.
import { type DataOrigin, SMALL_CELL_THRESHOLD } from "@eegml/shared";
import { DEFAULT_MEMBER_STATE, NO_COUNTRY, serialiseMemberState } from "@/pages/members/member-list";
import {
  DEFAULT_REPLICATION_STATE,
  NO_STATUS,
  type ReplicationListState,
  type ReplicationRow,
  serialiseReplicationState,
  stageText,
} from "@/pages/replications/replication-list";

export interface Figure {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** The filtered list the figure was counted from. */
  readonly to: string;
}

const replicationsWith = (change: Partial<ReplicationListState>) => {
  const query = serialiseReplicationState({ ...DEFAULT_REPLICATION_STATE, ...change }).toString();
  return query === "" ? "/replications" : `/replications?${query}`;
};

/** The replications in each status, in the order of the statuses, and those without one last. */
export function replicationsByStatus(
  rows: readonly Pick<ReplicationRow, "statusKey" | "statusLabel" | "statusPosition">[],
): Figure[] {
  const counts = new Map<string, { label: string; position: number; count: number }>();
  let none = 0;
  for (const row of rows) {
    if (row.statusKey === null) {
      none += 1;
      continue;
    }
    const entry = counts.get(row.statusKey) ?? {
      label: row.statusLabel ?? row.statusKey,
      position: row.statusPosition ?? Number.MAX_SAFE_INTEGER,
      count: 0,
    };
    entry.count += 1;
    counts.set(row.statusKey, entry);
  }
  const figures = [...counts.entries()]
    .sort(([, a], [, b]) => a.position - b.position || a.label.localeCompare(b.label))
    .map(([key, entry]) => ({ key, label: entry.label, count: entry.count, to: replicationsWith({ status: key }) }));
  return none === 0
    ? figures
    : [
        ...figures,
        { key: NO_STATUS, label: "No status recorded", count: none, to: replicationsWith({ status: NO_STATUS }) },
      ];
}

/** The replications at each public stage, in the order of the stages, and those without one last. */
export function replicationsByStage(rows: readonly Pick<ReplicationRow, "stageNumber" | "stageName">[]): Figure[] {
  const counts = new Map<number, { label: string; count: number }>();
  let none = 0;
  for (const row of rows) {
    if (row.stageNumber === null) {
      none += 1;
      continue;
    }
    const entry = counts.get(row.stageNumber) ?? { label: stageText(row) ?? String(row.stageNumber), count: 0 };
    entry.count += 1;
    counts.set(row.stageNumber, entry);
  }
  const figures = [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stage, entry]) => ({
      key: String(stage),
      label: entry.label,
      count: entry.count,
      to: replicationsWith({ stage: String(stage) }),
    }));
  return none === 0
    ? figures
    : [
        ...figures,
        { key: NO_STATUS, label: "No stage recorded", count: none, to: replicationsWith({ stage: NO_STATUS }) },
      ];
}

/**
 * The members in each country, most first. A country with fewer members than the threshold of
 * small groups is never named with its count, as on the analysis page: such countries are counted
 * together. The countries beyond `top` are counted together and link to the whole directory.
 * Members without a country are counted apart.
 */
export function membersByCountry(
  persons: readonly { readonly countryCode: string | null }[],
  countryName: (code: string) => string,
  top = 8,
): Figure[] {
  const membersWith = (country: string) =>
    `/members?${serialiseMemberState({ ...DEFAULT_MEMBER_STATE, country }).toString()}`;
  const counts = new Map<string, number>();
  let none = 0;
  for (const person of persons) {
    if (person.countryCode === null) none += 1;
    else counts.set(person.countryCode, (counts.get(person.countryCode) ?? 0) + 1);
  }
  const small = [...counts.values()].filter((count) => count < SMALL_CELL_THRESHOLD);
  const sorted = [...counts.entries()]
    .filter(([, count]) => count >= SMALL_CELL_THRESHOLD)
    .sort(([codeA, a], [codeB, b]) => b - a || countryName(codeA).localeCompare(countryName(codeB)));
  const figures: Figure[] = sorted
    .slice(0, top)
    .map(([code, count]) => ({ key: code, label: countryName(code), count, to: membersWith(code) }));
  const rest = sorted.slice(top).reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0)
    figures.push({ key: "other", label: `${sorted.length - top} other countries`, count: rest, to: "/members" });
  if (small.length > 0)
    figures.push({
      key: "small",
      label: `${small.length === 1 ? "1 country" : `${small.length} countries`} with fewer than ${SMALL_CELL_THRESHOLD} members each`,
      count: small.reduce((sum, count) => sum + count, 0),
      to: "/members",
    });
  if (none > 0)
    figures.push({ key: NO_COUNTRY, label: "No country recorded", count: none, to: membersWith(NO_COUNTRY) });
  return figures;
}

/**
 * The publications in each status, in the order of the statuses. Each links to the replications
 * that have a publication in that status.
 */
export function publicationsByStatus(statuses: readonly string[], labels: Readonly<Record<string, string>>): Figure[] {
  const order = Object.keys(labels);
  const counts = new Map<string, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([status, count]) => ({
      key: status,
      label: labels[status] ?? status,
      count,
      to: replicationsWith({ publication: status }),
    }));
}

/** The order in which origins are named, the most trustworthy first. */
const ORIGIN_ORDER: readonly DataOrigin[] = ["live", "importedHistorical", "projected", "demo"];

/**
 * Where the counted records come from, in words, so that a total of mixed origins is never
 * read as one kind of fact: "all demonstration data", or "988 demonstration data and 12 live".
 * Null when nothing was counted.
 */
export function originBreakdown(
  origins: readonly DataOrigin[],
  labels: Readonly<Record<DataOrigin, string>>,
  format: (value: number) => string,
): string | null {
  if (origins.length === 0) return null;
  const counts = new Map<DataOrigin, number>();
  for (const origin of origins) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  const present = ORIGIN_ORDER.filter((origin) => counts.has(origin));
  const name = (origin: DataOrigin) => labels[origin].toLowerCase();
  const [only] = present;
  if (present.length === 1 && only !== undefined) return `all ${name(only)}`;
  const parts = present.map((origin) => `${format(counts.get(origin) ?? 0)} ${name(origin)}`);
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}
