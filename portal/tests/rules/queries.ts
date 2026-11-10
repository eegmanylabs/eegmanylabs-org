// The list queries of the first slice that need more than a plain read of a collection: the
// queries by which a scoped caller limits a list to what it may read, and the queries that
// filter on one field and sort on another. Each is described as data, in the terms of the web
// data layer, with the caller that makes it. Two tests read this catalogue: one runs every query
// against the security rules, and one derives the indexes that portal/firestore.indexes.json
// must declare, so that a query, its rule and its index are added together.
// Everything here is synthetic: fictitious accounts, people and studies on the example.org domain.
import type { ListableCollectionKey } from "@eegml/shared";
import { COLLECTIONS, MEMBERS_SCOPE_KEY } from "@eegml/shared";
import type { DocumentData, Firestore, Query } from "firebase/firestore";
import type { LiveQuery, QueryOperator, QueryValue } from "../../web/src/data/query-spec";
import { queryReference } from "../../web/src/data/refs";
import { CALLERS, type CallerKind, OWN_LABORATORY, OWN_REPLICATION, OWNER_PERSON, OWNER_UID } from "./world";

/** A query without the type of its collection, for code that treats every query alike. */
export interface QueryShape {
  /** The name of the collection, which is what an index is declared for. */
  readonly collectionId: string;
  readonly acrossParents: boolean;
  readonly where: readonly (readonly [field: string, operator: QueryOperator, value: QueryValue])[];
  readonly orderBy: readonly (readonly [field: string, direction: "asc" | "desc"])[];
}

export interface CataloguedQuery {
  /** What the query is for, in words. */
  readonly purpose: string;
  /** The caller that makes it. Null for a query that only trusted code makes, with the Admin SDK. */
  readonly caller: CallerKind | null;
  /**
   * The field whose clause limits the query to what the caller may read. Without that clause
   * the rules refuse the query. Null where the caller may read the whole collection.
   */
  readonly scopedBy: string | null;
  readonly shape: QueryShape;
  /** The query itself, and the same query without the clause that limits it to a scope. */
  build(db: Firestore): Query<DocumentData, DocumentData>;
  buildWithoutScope(db: Firestore): Query<DocumentData, DocumentData>;
}

function catalogued<K extends ListableCollectionKey>(
  purpose: string,
  caller: CallerKind | null,
  scopedBy: string | null,
  description: LiveQuery<K>,
): CataloguedQuery {
  const where = description.where ?? [];
  const unscoped: LiveQuery<K> = { ...description, where: where.filter(([field]) => field !== scopedBy) };
  return {
    purpose,
    caller,
    scopedBy,
    shape: {
      collectionId: COLLECTIONS[description.collection].collectionId,
      acrossParents: description.within === "group",
      where,
      orderBy: description.orderBy ?? [],
    },
    build: (db) => queryReference(db, description) as Query<DocumentData, DocumentData>,
    buildWithoutScope: (db) => queryReference(db, unscoped) as Query<DocumentData, DocumentData>,
  };
}

const heldBy = (kind: CallerKind): readonly string[] => CALLERS[kind].access?.scopeKeys ?? [];
const LIMIT = 200;

export const QUERY_CATALOGUE: readonly CataloguedQuery[] = [
  // What sits beneath participations, read across them within a scope.
  catalogued("the onboarding checklists of a laboratory, across its participations", "ownCoordinator", "laboratoryId", {
    collection: "participationChecklist",
    within: "group",
    where: [["laboratoryId", "==", OWN_LABORATORY]],
    limit: LIMIT,
  }),
  catalogued("the onboarding checklists of a replication, across its laboratories", "ownLead", "replicationId", {
    collection: "participationChecklist",
    within: "group",
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the onboarding checklists of every scope a caller holds", "ownLabMember", "scopeKeys", {
    collection: "participationChecklist",
    within: "group",
    where: [["scopeKeys", "array-contains-any", heldBy("ownLabMember")]],
    limit: LIMIT,
  }),
  catalogued("the people who work on a replication, across its laboratories", "ownLead", "replicationId", {
    collection: "participationTeamMembers",
    within: "group",
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the people of a laboratory who work on its replications", "ownCoordinator", "laboratoryId", {
    collection: "participationTeamMembers",
    within: "group",
    where: [["laboratoryId", "==", OWN_LABORATORY]],
    limit: LIMIT,
  }),
  catalogued("the deviations of a replication, across its laboratories", "ownLead", "replicationId", {
    collection: "participationDeviations",
    within: "group",
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the deviations of a laboratory, across its participations", "ownCoordinator", "laboratoryId", {
    collection: "participationDeviations",
    within: "group",
    where: [["laboratoryId", "==", OWN_LABORATORY]],
    limit: LIMIT,
  }),
  catalogued("the protocol acknowledgements of a replication, across its laboratories", "ownLead", "replicationId", {
    collection: "participationAcknowledgements",
    within: "group",
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued(
    "the protocol acknowledgements of a laboratory, across its participations",
    "ownCoordinator",
    "laboratoryId",
    {
      collection: "participationAcknowledgements",
      within: "group",
      where: [["laboratoryId", "==", OWN_LABORATORY]],
      limit: LIMIT,
    },
  ),

  // Memberships of replications.
  catalogued("the confirmed memberships of every replication", "member", "reviewStatus", {
    collection: "replicationMemberships",
    within: "group",
    where: [["reviewStatus", "==", "confirmed"]],
    limit: LIMIT,
  }),
  catalogued("every membership of a replication, for its team", "ownTeam", "replicationId", {
    collection: "replicationMemberships",
    within: "group",
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the confirmed memberships of one person, across replications", "member", "reviewStatus", {
    collection: "replicationMemberships",
    within: "group",
    where: [
      ["personId", "==", OWNER_PERSON],
      ["reviewStatus", "==", "confirmed"],
    ],
    limit: LIMIT,
  }),

  // Records that carry the audience of their target.
  catalogued("the status history of a record, latest first", "member", "scopeKeys", {
    collection: "statusHistory",
    within: [],
    where: [
      ["entityType", "==", "replication"],
      ["entityId", "==", OWN_REPLICATION],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: LIMIT,
  }),
  catalogued("the document links of a record", "member", "scopeKeys", {
    collection: "documentLinks",
    within: [],
    where: [
      ["entityType", "==", "replication"],
      ["entityId", "==", OWN_REPLICATION],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    limit: LIMIT,
  }),
  catalogued("the document links that every member may read", "member", "scopeKeys", {
    collection: "documentLinks",
    within: [],
    where: [["scopeKeys", "array-contains", MEMBERS_SCOPE_KEY]],
    limit: LIMIT,
  }),
  catalogued("the contributor tables of a replication", "ownLead", "replicationId", {
    collection: "contributorTables",
    within: [],
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the outreach correspondence of a replication", "ownLead", "replicationId", {
    collection: "outreachContacts",
    within: [],
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the external accounts of every scope a caller holds", "ownTeam", "scopeKeys", {
    collection: "externalAccounts",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("ownTeam")]],
    limit: LIMIT,
  }),

  // Queues and a user's own records.
  catalogued("a member's own correction requests, newest first", "owner", "uid", {
    collection: "correctionRequests",
    within: [],
    where: [["uid", "==", OWNER_UID]],
    orderBy: [["createdAt", "desc"]],
    limit: LIMIT,
  }),
  catalogued("the open correction requests, oldest first", "admin", null, {
    collection: "correctionRequests",
    within: [],
    where: [["status", "==", "open"]],
    orderBy: [["createdAt", "asc"]],
    limit: LIMIT,
  }),
  catalogued(
    "the requests to represent a laboratory that await a decision, oldest first",
    "ownCoordinator",
    "laboratoryId",
    {
      collection: "labClaims",
      within: [],
      where: [
        ["laboratoryId", "==", OWN_LABORATORY],
        ["status", "==", "pendingReview"],
      ],
      orderBy: [["submittedAt", "asc"]],
      limit: LIMIT,
    },
  ),
  catalogued(
    "the requests to represent any of a coordinator's laboratories that await a decision, oldest first",
    "ownCoordinator",
    "laboratoryId",
    {
      collection: "labClaims",
      within: [],
      where: [
        ["laboratoryId", "in", [OWN_LABORATORY]],
        ["status", "==", "pendingReview"],
      ],
      orderBy: [["submittedAt", "asc"]],
      limit: LIMIT,
    },
  ),
  catalogued("the requests to represent any laboratory that await a decision, oldest first", "admin", null, {
    collection: "labClaims",
    within: [],
    where: [["status", "==", "pendingReview"]],
    orderBy: [["submittedAt", "asc"]],
    limit: LIMIT,
  }),
  catalogued("a user's unread notifications, newest first", "owner", null, {
    collection: "userNotifications",
    within: [OWNER_UID],
    where: [["readAt", "==", null]],
    orderBy: [["createdAt", "desc"]],
    limit: LIMIT,
  }),

  // Made by the import tools with the Admin SDK, which no rule decides.
  catalogued("the changes of every batch that came from given source records", null, null, {
    collection: "importBatchChanges",
    within: "group",
    where: [["sourceRecordIds", "array-contains-any", ["source-record-1"]]],
    limit: LIMIT,
  }),

  // Made by listAuditEvents with the Admin SDK: the trail, newest first, by one of its filters.
  // A range on the time of the entries uses the same index.
  ...(["actorUid", "entityType", "action"] as const).map((field) =>
    catalogued(`the audit trail by ${field}, newest first`, null, null, {
      collection: "auditEvents",
      within: [],
      where: [[field, "==", "value-synthetic"]],
      orderBy: [["createdAt", "desc"]],
      limit: LIMIT,
    }),
  ),

  // Made by the claim functions with the Admin SDK, to find the roles that the records about a
  // person imply for the person's account.
  catalogued("the member entries of one person, across laboratories", null, null, {
    collection: "laboratoryMembers",
    within: "group",
    where: [["personId", "==", OWNER_PERSON]],
    limit: LIMIT,
  }),
];
