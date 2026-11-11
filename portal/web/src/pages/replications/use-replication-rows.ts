// The rows of the list of replications, built live from the documents behind them.
import { useMemo } from "react";
import { type Live, useLiveQuery } from "@/data";
import { combineLive, orEmpty } from "@/registry/combine";
import {
  ALL_ALIASES,
  MEMBERSHIPS_TO_REVIEW,
  useManuscripts,
  useParticipations,
  usePersons,
  useReplicationStatuses,
  useReplications,
} from "@/registry/queries";
import type { Viewer } from "@/registry/viewer";
import { buildReplicationRows, type ReplicationRow } from "./replication-list";

/** The roles in which a membership names a lead. */
const LEADING_ROLES: readonly string[] = ["lead", "coLead"];

const countBy = <T>(items: readonly T[], key: (item: T) => string | null | undefined): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value != null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

export function useReplicationRows(viewer: Viewer | null): Live<readonly ReplicationRow[]> {
  const replications = useReplications();
  const statuses = useReplicationStatuses();
  const persons = usePersons();
  const participations = useParticipations();
  const manuscripts = useManuscripts();
  const aliases = useLiveQuery(ALL_ALIASES);
  // Only the core team and administrators list the memberships that wait for review.
  const toReview = orEmpty(useLiveQuery(viewer?.staff === true ? MEMBERSHIPS_TO_REVIEW : null));

  return useMemo(
    () =>
      combineLive(
        [replications, statuses, persons, participations, manuscripts, aliases, toReview] as const,
        (replicationList, statusList, personList, participationList, manuscriptList, aliasList, reviewList) =>
          buildReplicationRows({
            replications: replicationList,
            statuses: statusList
              .filter((status) => status.archivedAt === null)
              .map((status) => ({ key: status.key, label: status.label, position: status.position })),
            personNames: new Map(personList.map((person) => [person.id, person.displayName])),
            leadsToReview: new Set(
              reviewList
                .filter((membership) => LEADING_ROLES.includes(membership.role) && membership.archivedAt === null)
                .map((membership) => membership.replicationId),
            ),
            laboratoryCounts: countBy(
              participationList.filter(
                (participation) =>
                  participation.archivedAt === null && !["withdrawn", "declined"].includes(participation.status),
              ),
              (participation) => participation.replicationId,
            ),
            publicationStatuses: manuscriptList.reduce((map, manuscript) => {
              if (manuscript.archivedAt !== null || manuscript.replicationId === undefined) return map;
              map.set(manuscript.replicationId, [...(map.get(manuscript.replicationId) ?? []), manuscript.status]);
              return map;
            }, new Map<string, string[]>()),
            aliases: aliasList.reduce((map, alias) => {
              map.set(alias.replicationId, [...(map.get(alias.replicationId) ?? []), alias.alias]);
              return map;
            }, new Map<string, string[]>()),
          }),
      ),
    [replications, statuses, persons, participations, manuscripts, aliases, toReview],
  );
}
