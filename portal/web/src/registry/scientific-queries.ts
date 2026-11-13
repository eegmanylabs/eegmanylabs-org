// The live reads of the scientific workflows of a replication (phase 8). The decision log, the
// protocols, the hypotheses and the prediction-market questions are read by every member. The
// analysis runs, the incidents and their actions, the authorship lists and their entries, and the
// teams, acknowledgements and deviations of the participations are read within their scope, so
// each of those queries states the clause that the security rules check: the keys of the scope
// that the viewer holds, at most 30, or nothing more for programme staff, who read them all.
import type { ListableCollectionKey } from "@eegml/shared";
import type { LiveQuery } from "@/data";

/** What limits a scoped read: every document for programme staff, or the viewer's keys. */
export type ReadScope = "all" | readonly string[];

const SCIENTIFIC_LIMIT = 500;

/** The documents of a replication in a collection read within scope. */
function ofReplication<K extends ListableCollectionKey>(
  collection: K,
  within: LiveQuery<K>["within"],
  studyKey: string,
  scope: ReadScope,
): LiveQuery<K> {
  return {
    collection,
    within,
    // Every collection read here carries `replicationId` and `scopeKeys`, which the type of a
    // filter cannot see for a collection given as a parameter.
    where: (scope === "all"
      ? [["replicationId", "==", studyKey]]
      : [
          ["replicationId", "==", studyKey],
          ["scopeKeys", "array-contains-any", [...scope]],
        ]) as unknown as LiveQuery<K>["where"],
    limit: SCIENTIFIC_LIMIT,
  };
}

export const analysisRunsOfReplication = (studyKey: string, scope: ReadScope) =>
  ofReplication("processingRuns", [], studyKey, scope);

export const incidentsOfReplication = (studyKey: string, scope: ReadScope) =>
  ofReplication("incidents", [], studyKey, scope);

export const risksOfReplication = (studyKey: string, scope: ReadScope) => ofReplication("risks", [], studyKey, scope);

export const incidentActionsOfReplication = (studyKey: string, scope: ReadScope) =>
  ofReplication("incidentActions", "group", studyKey, scope);

export const authorshipListsOfReplication = (studyKey: string, scope: ReadScope) =>
  ofReplication("authorshipLists", [], studyKey, scope);

export const authorshipEntriesOfList = (manuscriptId: string, studyKey: string, scope: ReadScope) =>
  ofReplication("authorshipEntries", [manuscriptId], studyKey, scope);

export const teamMembersOfReplication = (studyKey: string, scope: ReadScope) =>
  ofReplication("participationTeamMembers", "group", studyKey, scope);

export const acknowledgementsOfReplication = (studyKey: string, scope: ReadScope) =>
  ofReplication("participationAcknowledgements", "group", studyKey, scope);

export const deviationsOfReplication = (studyKey: string, scope: ReadScope) =>
  ofReplication("participationDeviations", "group", studyKey, scope);

/** The entries of the decision log of a replication, which every member reads. */
export function decisionsOfReplication(studyKey: string): LiveQuery<"decisions"> {
  return { collection: "decisions", within: [], where: [["scopeId", "==", studyKey]], limit: SCIENTIFIC_LIMIT };
}

/** The protocols of a replication, which every member reads. */
export function protocolsOfReplication(studyKey: string): LiveQuery<"replicationProtocols"> {
  return { collection: "replicationProtocols", within: [studyKey], limit: 100 };
}

/**
 * The hypotheses and the protocols of every replication, which every member reads, offered as the
 * records a task may link to. A select draws them, never a list.
 */
export const ALL_HYPOTHESES: LiveQuery<"replicationHypotheses"> = {
  collection: "replicationHypotheses",
  within: "group",
  limit: 200,
};
export const ALL_PROTOCOLS: LiveQuery<"replicationProtocols"> = {
  collection: "replicationProtocols",
  within: "group",
  limit: 200,
};

/** The versions of the protocols of a replication, which every member reads. */
export function protocolVersionsOfReplication(studyKey: string): LiveQuery<"replicationProtocolVersions"> {
  return { collection: "replicationProtocolVersions", within: [studyKey], limit: SCIENTIFIC_LIMIT };
}

/** The prediction-market and survey questions of a replication, which are sealed: programme administrators alone read them. */
export function predictionItemsOfReplication(studyKey: string): LiveQuery<"predictionMarketItems"> {
  return {
    collection: "predictionMarketItems",
    within: [],
    where: [["replicationId", "==", studyKey]],
    limit: SCIENTIFIC_LIMIT,
  };
}

/** The task lists of a replication that the viewer reads, for planning a milestone. */
export function taskListsOfReplication(studyKey: string, scope: ReadScope): LiveQuery<"taskLists"> {
  return ofReplication("taskLists", [], studyKey, scope);
}
