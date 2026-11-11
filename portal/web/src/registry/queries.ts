// The live reads of the registry of replications and members, described once so that every
// view that needs the same documents shares one listener through the subscription cache.
//
// Every member may read the directory collections as a whole (docs/DATA_MODEL.md, section 15),
// so a view loads them and filters, sorts and searches in the browser. Each query stays within
// the limit of 1,000 documents that the security rules allow a list, and the top-level
// directories are read in pages of that size (`useLiveCollection`), so a directory of more
// than 1,000 records, such as the programme's members, is read whole.
import { type ListableCollectionKey, MEMBERS_SCOPE_KEY } from "@eegml/shared";
import { useMemo } from "react";
import { type Live, type LiveQuery, type PagedItems, type RecordOf, useLiveCollection, useLiveQuery } from "@/data";

/** The most documents one query of a directory reads. The security rules refuse a larger list. */
export const DIRECTORY_LIMIT = 1_000;

const whole = <K extends ListableCollectionKey>(collection: K, within: LiveQuery<K>["within"]): LiveQuery<K> => ({
  collection,
  within,
  limit: DIRECTORY_LIMIT,
});

export const ALL_REPLICATIONS = whole("replications", []);
export const ALL_PERSONS = whole("persons", []);
export const ALL_LABORATORIES = whole("laboratories", []);
export const ALL_PARTICIPATIONS = whole("participations", []);
export const ALL_MANUSCRIPTS = whole("manuscripts", []);
export const ALL_ALIASES = whole("replicationAliases", "group");
export const ALL_INSTITUTIONS = whole("institutions", []);
/** The equipment requirements of every replication, which every member reads. */
export const ALL_REQUIREMENTS = whole("replicationEquipmentRequirements", "group");

/** The current equipment configuration of every laboratory, one for each chain. */
export const CURRENT_EQUIPMENT: LiveQuery<"laboratoryEquipment"> = {
  collection: "laboratoryEquipment",
  within: "group",
  where: [["isCurrent", "==", true]],
  limit: DIRECTORY_LIMIT,
};

/** Every equipment configuration of one laboratory, current and closed, which is its history. */
export function equipmentOfLaboratory(laboratoryId: string): LiveQuery<"laboratoryEquipment"> {
  return { collection: "laboratoryEquipment", within: [laboratoryId], limit: 200 };
}

/** The member entries of one laboratory. */
export function membersOfLaboratory(laboratoryId: string): LiveQuery<"laboratoryMembers"> {
  return { collection: "laboratoryMembers", within: [laboratoryId], limit: 200 };
}

/**
 * The onboarding checklist of one participation. Programme staff read it whole; anyone else
 * asks only for what carries a scope key they hold, which is what the rules can allow. Null
 * for a viewer who holds no scope of the participation, who may not read it at all.
 */
export function checklistOfParticipation(
  participationId: string,
  scope: "all" | readonly string[] | null,
): LiveQuery<"participationChecklist"> | null {
  if (scope === null) return null;
  return {
    collection: "participationChecklist",
    within: [participationId],
    ...(scope === "all" ? {} : { where: [["scopeKeys", "array-contains-any", [...scope]]] as const }),
    limit: 50,
  };
}

/**
 * The checklist items the viewer may read across participations, for the readiness matrix:
 * every one for programme staff, and those of the viewer's scopes for anyone else.
 */
export function checklistsInScope(scope: "all" | readonly string[]): LiveQuery<"participationChecklist"> | null {
  if (scope !== "all" && scope.length === 0) return null;
  return {
    collection: "participationChecklist",
    within: "group",
    ...(scope === "all" ? {} : { where: [["scopeKeys", "array-contains-any", [...scope]]] as const }),
    limit: DIRECTORY_LIMIT,
  };
}

/** The status history of the participations of one laboratory, latest first, which every member reads. */
export function statusHistoryOfLaboratory(laboratoryId: string): LiveQuery<"statusHistory"> {
  return {
    collection: "statusHistory",
    within: [],
    where: [
      ["laboratoryId", "==", laboratoryId],
      ["scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: 200,
  };
}

/** The status history of one participation, latest first. */
export function statusHistoryOfParticipation(participationId: string): LiveQuery<"statusHistory"> {
  return {
    collection: "statusHistory",
    within: [],
    where: [
      ["entityType", "==", "participation"],
      ["entityId", "==", participationId],
      ["scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: 100,
  };
}

/** The statuses that the programme configures for replications, in their order. */
export const REPLICATION_STATUS_DEFINITIONS: LiveQuery<"statusDefinitions"> = {
  collection: "statusDefinitions",
  within: [],
  where: [["entityType", "==", "replication"]],
  limit: 100,
};

/** The confirmed memberships of every replication, which every member reads. */
export const CONFIRMED_MEMBERSHIPS: LiveQuery<"replicationMemberships"> = {
  collection: "replicationMemberships",
  within: "group",
  where: [["reviewStatus", "==", "confirmed"]],
  limit: DIRECTORY_LIMIT,
};

/**
 * The memberships that wait for review, across replications. Only programme administrators and
 * the core team, signed in with their second factor, may list them: pass null for anyone else.
 */
export const MEMBERSHIPS_TO_REVIEW: LiveQuery<"replicationMemberships"> = {
  collection: "replicationMemberships",
  within: "group",
  where: [["reviewStatus", "==", "needsReview"]],
  limit: DIRECTORY_LIMIT,
};

/** Every membership of one replication, which its team, the core team and administrators read. */
export function membershipsOfReplication(studyKey: string): LiveQuery<"replicationMemberships"> {
  return {
    collection: "replicationMemberships",
    within: "group",
    where: [["replicationId", "==", studyKey]],
    limit: 200,
  };
}

/** The confirmed memberships of one person, across replications. */
export function confirmedMembershipsOfPerson(personId: string): LiveQuery<"replicationMemberships"> {
  return {
    collection: "replicationMemberships",
    within: "group",
    where: [
      ["personId", "==", personId],
      ["reviewStatus", "==", "confirmed"],
    ],
    limit: 200,
  };
}

/** The member entries of one person, across laboratories. */
export function laboratoryEntriesOfPerson(personId: string): LiveQuery<"laboratoryMembers"> {
  return { collection: "laboratoryMembers", within: "group", where: [["personId", "==", personId]], limit: 200 };
}

/**
 * The entries of the status history of a replication, latest first. Every member reads them,
 * because they carry the key `members` as the replication's audience.
 */
export function statusHistoryOfReplication(studyKey: string): LiveQuery<"statusHistory"> {
  return {
    collection: "statusHistory",
    within: [],
    where: [
      ["entityType", "==", "replication"],
      ["entityId", "==", studyKey],
      ["scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: 200,
  };
}

/**
 * The document links of a replication that the caller may read: those every member reads, and
 * the restricted ones of a scope the caller holds. `scopeKeys` are the caller's own, at most 30.
 */
export function documentLinksOfReplication(studyKey: string, scopeKeys: readonly string[]): LiveQuery<"documentLinks"> {
  return {
    collection: "documentLinks",
    within: [],
    where: [
      ["entityType", "==", "replication"],
      ["entityId", "==", studyKey],
      ["scopeKeys", "array-contains-any", scopeKeys],
    ],
    limit: 200,
  };
}

export function hypothesesOfReplication(studyKey: string): LiveQuery<"replicationHypotheses"> {
  return { collection: "replicationHypotheses", within: [studyKey], limit: 200 };
}

export function aliasesOfReplication(studyKey: string): LiveQuery<"replicationAliases"> {
  return { collection: "replicationAliases", within: [studyKey], limit: 200 };
}

export function contributorsOfReplication(studyKey: string): LiveQuery<"contributors"> {
  return { collection: "contributors", within: [], where: [["replicationId", "==", studyKey]], limit: DIRECTORY_LIMIT };
}

export function historicalAggregatesOfReplication(studyKey: string): LiveQuery<"historicalAggregates"> {
  return {
    collection: "historicalAggregates",
    within: [],
    where: [["replicationIds", "array-contains", studyKey]],
    limit: 200,
  };
}

/** The affiliations of one person. */
export function affiliationsOfPerson(personId: string): LiveQuery<"personAffiliations"> {
  return { collection: "personAffiliations", within: [personId], limit: 50 };
}

/** The account's own requests to represent or register a laboratory, which the rules let it read. */
export function ownLabClaims(uid: string): LiveQuery<"labClaims"> {
  return { collection: "labClaims", within: [], where: [["uid", "==", uid]], limit: 50 };
}

/** The records the account has starred, latest first. */
export function favouritesOf(uid: string): LiveQuery<"userFavourites"> {
  return { collection: "userFavourites", within: [uid], orderBy: [["updatedAt", "desc"]], limit: 50 };
}

/** The records the account opened most recently, latest first. */
export function recentsOf(uid: string): LiveQuery<"userRecents"> {
  return { collection: "userRecents", within: [uid], orderBy: [["updatedAt", "desc"]], limit: 10 };
}

export type ReplicationRecord = RecordOf<"replications">;
export type PersonRecord = RecordOf<"persons">;
export type LaboratoryRecord = RecordOf<"laboratories">;
export type ParticipationRecord = RecordOf<"participations">;

/** A whole top-level directory, read in pages, with whether it ran past the most pages that are read. */
export function useDirectory<K extends ListableCollectionKey>(
  query: LiveQuery<K> | null,
): Live<PagedItems<RecordOf<K>>> {
  return useLiveCollection(query);
}

/** The documents of a whole top-level directory, read in pages. */
export function useDirectoryItems<K extends ListableCollectionKey>(
  query: LiveQuery<K> | null,
): Live<readonly RecordOf<K>[]> {
  const live = useLiveCollection(query);
  return useMemo(() => (live.status === "ready" ? { ...live, data: live.data.items } : live), [live]);
}

export const useReplications = () => useDirectoryItems(ALL_REPLICATIONS);
export const usePersons = () => useDirectoryItems(ALL_PERSONS);
export const useLaboratories = () => useDirectoryItems(ALL_LABORATORIES);
export const useInstitutions = () => useDirectoryItems(ALL_INSTITUTIONS);
export const useCurrentEquipment = () => useLiveQuery(CURRENT_EQUIPMENT);
export const useRequirements = () => useLiveQuery(ALL_REQUIREMENTS);
export const useParticipations = () => useDirectoryItems(ALL_PARTICIPATIONS);
export const useManuscripts = () => useDirectoryItems(ALL_MANUSCRIPTS);
export const useReplicationStatuses = () => useLiveQuery(REPLICATION_STATUS_DEFINITIONS);
