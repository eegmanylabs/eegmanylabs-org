// The live reads of the registry of replications and members, described once so that every
// view that needs the same documents shares one listener through the subscription cache.
//
// Every member may read the directory collections as a whole (docs/DATA_MODEL.md, section 15),
// which amount to a few hundred documents, so a view loads them and filters, sorts and
// searches in the browser. Each read stays within the limit of 1,000 documents that the
// security rules allow a list.
import { type ListableCollectionKey, MEMBERS_SCOPE_KEY } from "@eegml/shared";
import { type LiveQuery, type RecordOf, useLiveQuery } from "@/data";

/** The most documents a directory view loads. The security rules refuse a larger list. */
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
  return { collection: "replicationMemberships", within: "group", where: [["replicationId", "==", studyKey]], limit: 200 };
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

export const useReplications = () => useLiveQuery(ALL_REPLICATIONS);
export const usePersons = () => useLiveQuery(ALL_PERSONS);
export const useLaboratories = () => useLiveQuery(ALL_LABORATORIES);
export const useParticipations = () => useLiveQuery(ALL_PARTICIPATIONS);
export const useManuscripts = () => useLiveQuery(ALL_MANUSCRIPTS);
export const useReplicationStatuses = () => useLiveQuery(REPLICATION_STATUS_DEFINITIONS);
