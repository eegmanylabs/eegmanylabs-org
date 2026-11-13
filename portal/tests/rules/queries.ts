// The list queries of the first slice that need more than a plain read of a collection: the
// queries by which a scoped caller limits a list to what it may read, and the queries that
// filter on one field and sort on another. Each is described as data, in the terms of the web
// data layer, with the caller that makes it. Two tests read this catalogue: one runs every query
// against the security rules, and one derives the indexes that portal/firestore.indexes.json
// must declare, so that a query, its rule and its index are added together.
// Everything here is synthetic: fictitious accounts, people and studies on the example.org domain.
import type { ListableCollectionKey } from "@eegml/shared";
import { COLLECTIONS, entityRefId, laboratoryScopeKey, MEMBERS_SCOPE_KEY, replicationScopeKey } from "@eegml/shared";
import type { DocumentData, Firestore, Query } from "firebase/firestore";
import type { LiveQuery, QueryOperator, QueryValue } from "../../web/src/data/query-spec";
import { queryReference } from "../../web/src/data/refs";
import {
  autoId,
  CALLERS,
  type CallerKind,
  MEMBER_UID,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
} from "./world";

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
/** The page and the thread of the world (fixtures.ts). */
const PAGE = entityRefId("replication", OWN_REPLICATION);
const THREAD = autoId("stored thread");
/** The dataset of the world (fixtures.ts). */
const DATASET = "SyntheticStudy2001-own-main";

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

  // Made by the list of replications and the review queue of memberships, for the programme.
  catalogued("the memberships that wait for review, across replications", "coreTeam", null, {
    collection: "replicationMemberships",
    within: "group",
    where: [["reviewStatus", "==", "needsReview"]],
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
  catalogued("the document links of a replication and of its records", "member", "scopeKeys", {
    collection: "documentLinks",
    within: [],
    where: [
      ["replicationId", "==", OWN_REPLICATION],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    limit: LIMIT,
  }),
  catalogued("the document links of a laboratory that the caller may read", "member", "scopeKeys", {
    collection: "documentLinks",
    within: [],
    where: [
      ["entityType", "==", "laboratory"],
      ["entityId", "==", OWN_LABORATORY],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    limit: LIMIT,
  }),
  catalogued("the generated documents of a replication that the caller may read", "member", "scopeKeys", {
    collection: "generatedDocuments",
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
  catalogued("a member's own requests to represent or register a laboratory", "owner", "uid", {
    collection: "labClaims",
    within: [],
    where: [["uid", "==", OWNER_UID]],
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

  // Made by the member page and by Home, for any member.
  catalogued("the laboratories that list one person, for the member page", "member", null, {
    collection: "laboratoryMembers",
    within: "group",
    where: [["personId", "==", OWNER_PERSON]],
    limit: LIMIT,
  }),
  catalogued("the status history of a replication, which every member reads", "member", "scopeKeys", {
    collection: "statusHistory",
    within: [],
    where: [
      ["entityType", "==", "replication"],
      ["entityId", "==", OWN_REPLICATION],
      ["scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: LIMIT,
  }),

  // Made by the laboratory page, the replication page and the readiness matrix.
  catalogued("the current equipment configurations of every laboratory", "member", null, {
    collection: "laboratoryEquipment",
    within: "group",
    where: [["isCurrent", "==", true]],
    limit: LIMIT,
  }),
  catalogued("the checklist of one participation, for a caller in its scope", "ownLabMember", "scopeKeys", {
    collection: "participationChecklist",
    within: [OWN_PARTICIPATION],
    where: [["scopeKeys", "array-contains-any", heldBy("ownLabMember")]],
    limit: LIMIT,
  }),
  catalogued("the status history of the participations of a laboratory, latest first", "member", "scopeKeys", {
    collection: "statusHistory",
    within: [],
    where: [
      ["laboratoryId", "==", OWN_LABORATORY],
      ["scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: LIMIT,
  }),
  catalogued("the open items of the reconciliation queue", "admin", null, {
    collection: "reconciliationItems",
    within: [],
    where: [["status", "==", "open"]],
    limit: LIMIT,
  }),

  // The workspace. Programme administrators and the core team read every page, so their
  // queries name no scope, and every other reader names the keys of the session.
  catalogued("the pages of the workspace that a member reads", "member", "scopeKeys", {
    collection: "pages",
    within: [],
    where: [
      ["kind", "==", "custom"],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    limit: 1_000,
  }),
  catalogued("every page of the workspace, for the programme", "admin", null, {
    collection: "pages",
    within: [],
    where: [["kind", "==", "custom"]],
    limit: 1_000,
  }),
  // The titles of every page a reader may open, which the activity of a dashboard names.
  catalogued("every page that a member reads", "member", "scopeKeys", {
    collection: "pages",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("member")]],
    limit: 1_000,
  }),
  catalogued("every page, for the programme", "admin", null, {
    collection: "pages",
    within: [],
    limit: 1_000,
  }),
  catalogued("the presence of the other tabs on a page", "member", null, {
    collection: "pagePresence",
    within: [PAGE],
    where: [["tab", "!=", "OwnTabAbCdEfGhIjKlMn"]],
    limit: 100,
  }),
  catalogued("the threads of a page", "ownLabMember", "scopeKeys", {
    collection: "threads",
    within: [],
    where: [
      ["targetId", "==", PAGE],
      ["scopeKeys", "array-contains-any", heldBy("ownLabMember")],
    ],
    limit: LIMIT,
  }),
  catalogued("the threads of a page, for the programme", "admin", null, {
    collection: "threads",
    within: [],
    where: [["targetId", "==", PAGE]],
    limit: LIMIT,
  }),
  // A comment is read as its thread, whose page decides, so the query names no scope.
  catalogued("the comments of a thread", "ownLabMember", null, {
    collection: "threadComments",
    within: [THREAD],
    limit: LIMIT,
  }),
  catalogued("the versions of a page, newest first", "member", null, {
    collection: "pageVersions",
    within: [PAGE],
    orderBy: [["createdAt", "desc"]],
    limit: 50,
  }),
  catalogued("the updates of a page that other editors wrote", "ownTeam", null, {
    collection: "pageUpdates",
    within: [PAGE],
    where: [["clientId", "!=", 42]],
    limit: 1_000,
  }),
  catalogued("the activity of a page, newest first", "member", "scopeKeys", {
    collection: "activity",
    within: [],
    where: [
      ["entityId", "==", PAGE],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    orderBy: [["createdAt", "desc"]],
    limit: 50,
  }),
  catalogued("the activity of a page, newest first, for the programme", "admin", null, {
    collection: "activity",
    within: [],
    where: [["entityId", "==", PAGE]],
    orderBy: [["createdAt", "desc"]],
    limit: 50,
  }),
  // Databases, views and dashboards (D-011). A database copies the audience of its page.
  catalogued("the databases beneath a page that a member reads", "member", "scopeKeys", {
    collection: "databases",
    within: [],
    where: [
      ["parentPageId", "==", PAGE],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    limit: LIMIT,
  }),
  catalogued("the databases beneath a page, for the programme", "admin", null, {
    collection: "databases",
    within: [],
    where: [["parentPageId", "==", PAGE]],
    limit: LIMIT,
  }),
  catalogued("every database that a member reads", "member", "scopeKeys", {
    collection: "databases",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("member")]],
    limit: 1_000,
  }),
  catalogued("the views of a collection that the caller owns", "owner", "ownerUid", {
    collection: "views",
    within: [],
    where: [
      ["collectionKey", "==", "core:participations"],
      ["ownerUid", "==", OWNER_UID],
    ],
    limit: LIMIT,
  }),
  catalogued("the shared views of a collection", "member", "isShared", {
    collection: "views",
    within: [],
    where: [
      ["collectionKey", "==", "core:participations"],
      ["isShared", "==", true],
    ],
    limit: LIMIT,
  }),
  catalogued("the personal dashboards of the caller", "owner", "ownerUid", {
    collection: "dashboards",
    within: [],
    where: [["ownerUid", "==", OWNER_UID]],
    limit: LIMIT,
  }),
  catalogued("the dashboards of the programme, the replications and the laboratories", "member", "ownerUid", {
    collection: "dashboards",
    within: [],
    where: [["ownerUid", "==", null]],
    limit: LIMIT,
  }),

  catalogued("the latest activity that a member reads, for a dashboard", "member", "scopeKeys", {
    collection: "activity",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("member")]],
    orderBy: [["createdAt", "desc"]],
    limit: 20,
  }),

  catalogued("the latest activity of one replication, for its dashboard", "ownTeam", "scopeKeys", {
    collection: "activity",
    within: [],
    where: [["scopeKeys", "array-contains", replicationScopeKey(OWN_REPLICATION)]],
    orderBy: [["createdAt", "desc"]],
    limit: 20,
  }),

  catalogued("the latest activity of one laboratory, for its dashboard", "ownLabMember", "scopeKeys", {
    collection: "activity",
    within: [],
    where: [["scopeKeys", "array-contains", laboratoryScopeKey(OWN_LABORATORY)]],
    orderBy: [["createdAt", "desc"]],
    limit: 20,
  }),

  // Made by the trigger that records a spell of editing, with the Admin SDK.
  catalogued("the latest spell of editing of one account on a page", null, null, {
    collection: "activity",
    within: [],
    where: [
      ["entityId", "==", PAGE],
      ["actorUid", "==", "uid-own-team"],
      ["createdAt", ">=", new Date("2026-01-01T00:00:00Z")],
    ],
    limit: 1,
  }),

  // Made by the merge of two records of a person, with the Admin SDK.
  catalogued("the memberships of one person, across replications", null, null, {
    collection: "replicationMemberships",
    within: "group",
    where: [["personId", "==", OWNER_PERSON]],
    limit: LIMIT,
  }),
  catalogued("the team entries of one person, across participations", null, null, {
    collection: "participationTeamMembers",
    within: "group",
    where: [["personId", "==", OWNER_PERSON]],
    limit: LIMIT,
  }),

  // Made by the claim functions with the Admin SDK, to find the roles that the records about a
  // person imply for the person's account.
  catalogued("the member entries of one person, across laboratories", null, null, {
    collection: "laboratoryMembers",
    within: "group",
    where: [["personId", "==", OWNER_PERSON]],
    limit: LIMIT,
  }),

  catalogued("the meetings of the workspace a member reads", "member", "scopeKeys", {
    collection: "pages",
    within: [],
    where: [
      ["kind", "==", "meeting"],
      ["scopeKeys", "array-contains-any", heldBy("member")],
    ],
    limit: 1_000,
  }),

  // Tasks (section 8). The browser reads the lists and the tasks a caller may read, by scope and
  // as owner or participant, and filters them by list itself (section 15).
  catalogued("the task lists a caller reads by scope", "ownTeam", "scopeKeys", {
    collection: "taskLists",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("ownTeam")]],
    limit: 1_000,
  }),
  catalogued("the personal task lists of a caller", "owner", "ownerUid", {
    collection: "taskLists",
    within: [],
    where: [["ownerUid", "==", OWNER_UID]],
    limit: 1_000,
  }),
  catalogued("the tasks a caller reads by scope", "ownTeam", "scopeKeys", {
    collection: "tasks",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("ownTeam")]],
    limit: 1_000,
  }),
  catalogued("the tasks of the personal lists of a caller", "owner", "ownerUid", {
    collection: "tasks",
    within: [],
    where: [["ownerUid", "==", OWNER_UID]],
    limit: 1_000,
  }),
  catalogued("the tasks a caller is assigned to, whatever their list", "member", "assigneeUids", {
    collection: "tasks",
    within: [],
    where: [["assigneeUids", "array-contains", MEMBER_UID]],
    limit: 1_000,
  }),
  catalogued("the tasks a caller collaborates on, whatever their list", "member", "collaboratorUids", {
    collection: "tasks",
    within: [],
    where: [["collaboratorUids", "array-contains", MEMBER_UID]],
    limit: 1_000,
  }),
  catalogued("the tasks a caller follows, whatever their list", "member", "followerUids", {
    collection: "tasks",
    within: [],
    where: [["followerUids", "array-contains", MEMBER_UID]],
    limit: 1_000,
  }),
  catalogued("the reminders of a caller", "owner", "uid", {
    collection: "reminders",
    within: [],
    where: [["uid", "==", OWNER_UID]],
    limit: LIMIT,
  }),
  catalogued("the progress updates of a record, newest first", "member", null, {
    collection: "progressUpdates",
    within: [],
    where: [
      ["entityType", "==", "replication"],
      ["entityId", "==", OWN_REPLICATION],
    ],
    orderBy: [["createdAt", "desc"]],
    limit: LIMIT,
  }),

  // Recruitment. A member reads the reports and pauses of the scopes it holds, and the browser
  // works out the effective values from them; programme staff read the collections whole.
  catalogued("the recruitment reports of every scope a caller holds", "ownLabMember", "scopeKeys", {
    collection: "recruitmentReports",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("ownLabMember")]],
    limit: 1_000,
  }),
  catalogued("the recruitment reports of a replication, for its leads", "ownLead", "replicationId", {
    collection: "recruitmentReports",
    within: [],
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: 1_000,
  }),
  catalogued("the recruitment reports of a laboratory, for its coordinators", "ownCoordinator", "laboratoryId", {
    collection: "recruitmentReports",
    within: [],
    where: [["laboratoryId", "==", OWN_LABORATORY]],
    limit: 1_000,
  }),
  catalogued("the planned pauses of every scope a caller holds", "ownCoordinator", "scopeKeys", {
    collection: "plannedPauses",
    within: [],
    where: [["scopeKeys", "array-contains-any", heldBy("ownCoordinator")]],
    limit: 1_000,
  }),
  catalogued("the forecast runs of a replication, newest first", "member", null, {
    collection: "forecastRuns",
    within: [],
    where: [["replicationId", "==", OWN_REPLICATION]],
    orderBy: [["generatedAt", "desc"]],
    limit: 50,
  }),

  // Made by the functions of tasks and of reminders with the Admin SDK.
  catalogued("the in-app reminders that are due and not yet sent", null, null, {
    collection: "reminders",
    within: [],
    where: [
      ["channel", "==", "inApp"],
      ["sentAt", "==", null],
      ["remindAt", "<=", new Date("2026-01-01T00:00:00Z")],
    ],
    limit: LIMIT,
  }),
  catalogued("the reminders of a user that are not yet sent, which setReminder counts", null, null, {
    collection: "reminders",
    within: [],
    where: [
      ["uid", "==", OWNER_UID],
      ["sentAt", "==", null],
    ],
    limit: LIMIT,
  }),
  catalogued("the latest update of an author on a record, which postProgressUpdate waits a minute after", null, null, {
    collection: "progressUpdates",
    within: [],
    where: [
      ["authorUid", "==", OWNER_UID],
      ["entityId", "==", OWN_REPLICATION],
      ["createdAt", ">", new Date("2026-01-01T00:00:00Z")],
    ],
    limit: 1,
  }),
  catalogued("the tasks of a list beneath one parent, where a task is placed", null, null, {
    collection: "tasks",
    within: [],
    where: [
      ["listId", "==", "list-1"],
      ["parentId", "==", null],
    ],
    limit: 1_000,
  }),
  catalogued("the accounts that follow a record, across users", null, null, {
    collection: "userSubscriptions",
    within: "group",
    where: [
      ["entityType", "==", "replication"],
      ["entityId", "==", OWN_REPLICATION],
      ["level", "==", "all"],
    ],
    limit: 1_000,
  }),
  // The dataset registry: what sits beneath one dataset, within its scope, and the listings and
  // the record of reads, for a holder of datasets.paths.read in the replication or the laboratory.
  catalogued("the copies of a dataset, within a scope the caller holds", "ownLabMember", "scopeKeys", {
    collection: "datasetStorageRefs",
    within: [DATASET],
    where: [["scopeKeys", "array-contains-any", heldBy("ownLabMember")]],
    limit: LIMIT,
  }),
  catalogued("the copies held on one storage server, across datasets", null, null, {
    collection: "datasetStorageRefs",
    within: "group",
    where: [["endpointKey", "==", "bremen-sftp"]],
    limit: 2_000,
  }),
  catalogued("the transfers of a dataset, within a scope the caller holds", "ownTeam", "scopeKeys", {
    collection: "datasetTransfers",
    within: [DATASET],
    where: [["scopeKeys", "array-contains-any", heldBy("ownTeam")]],
    limit: LIMIT,
  }),
  catalogued("the quality assessments of a dataset, within a scope the caller holds", "ownLabMember", "scopeKeys", {
    collection: "datasetQcAssessments",
    within: [DATASET],
    where: [["scopeKeys", "array-contains-any", heldBy("ownLabMember")]],
    limit: LIMIT,
  }),
  catalogued("the listings of a dataset, for a lead of its replication", "ownLead", "replicationId", {
    collection: "datasetManifests",
    within: [DATASET],
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the listings of a dataset, for a coordinator of its laboratory", "ownCoordinator", "laboratoryId", {
    collection: "datasetManifests",
    within: [DATASET],
    where: [["laboratoryId", "==", OWN_LABORATORY]],
    limit: LIMIT,
  }),
  catalogued("the files of a listing, for a lead of the replication", "ownLead", "replicationId", {
    collection: "datasetManifestFileChunks",
    within: [DATASET, autoId("stored manifest")],
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued(
    "the reads of the locations of a dataset, for a coordinator of its laboratory",
    "ownCoordinator",
    "laboratoryId",
    {
      collection: "datasetAccessEvents",
      within: [DATASET],
      where: [["laboratoryId", "==", OWN_LABORATORY]],
      limit: LIMIT,
    },
  ),
  catalogued("the deviations of one participation, within a scope the caller holds", "ownLabMember", "scopeKeys", {
    collection: "participationDeviations",
    within: [OWN_PARTICIPATION],
    where: [["scopeKeys", "array-contains-any", heldBy("ownLabMember")]],
    limit: LIMIT,
  }),
  catalogued("the documents linked to a dataset that the caller reads", "ownLabMember", "scopeKeys", {
    collection: "documentLinks",
    within: [],
    where: [
      ["entityType", "==", "dataset"],
      ["entityId", "==", DATASET],
      ["scopeKeys", "array-contains-any", heldBy("ownLabMember")],
    ],
    limit: LIMIT,
  }),
  catalogued("the status history of a dataset, latest first, which every member reads", "member", "scopeKeys", {
    collection: "statusHistory",
    within: [],
    where: [
      ["entityType", "==", "dataset"],
      ["entityId", "==", DATASET],
      ["scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]],
    ],
    orderBy: [["effectiveAt", "desc"]],
    limit: LIMIT,
  }),
  // The scientific workflows of phase 8 (web/src/registry/scientific-queries.ts): what is read
  // within scope is asked for by replication together with the caller's keys, or by replication
  // alone for programme staff.
  ...(
    [
      ["the analysis runs of a replication", "processingRuns", []],
      ["the incidents of a replication", "incidents", []],
      ["the actions of the incidents of a replication", "incidentActions", "group"],
      ["the authorship lists of a replication", "authorshipLists", []],
      ["the entries of an authorship list", "authorshipEntries", ["manuscript-1"]],
      ["the teams of the participations of a replication", "participationTeamMembers", "group"],
      ["the protocol acknowledgements of a replication", "participationAcknowledgements", "group"],
      ["the deviations of a replication", "participationDeviations", "group"],
      ["the task lists of a replication, for planning a milestone", "taskLists", []],
    ] as const
  ).flatMap(([purpose, collection, within]) => [
    // A member of a laboratory of the replication, who is not on its team, reads by the keys alone.
    catalogued(`${purpose}, within a scope the caller holds`, "ownLabMember", "scopeKeys", {
      collection,
      within,
      where: [
        ["replicationId", "==", OWN_REPLICATION],
        ["scopeKeys", "array-contains-any", heldBy("ownLabMember")],
      ],
      limit: LIMIT,
    } as LiveQuery<typeof collection>),
    catalogued(`${purpose}, for the programme`, "admin", null, {
      collection,
      within,
      where: [["replicationId", "==", OWN_REPLICATION]],
      limit: LIMIT,
    } as LiveQuery<typeof collection>),
  ]),
  // The views of these records (web/src/registry/scientific-data.ts) read them across
  // replications: within the keys the caller holds, or all of them for programme staff.
  ...(
    [
      ["the analysis runs", "processingRuns", []],
      ["the incidents", "incidents", []],
      ["the actions of the incidents", "incidentActions", "group"],
    ] as const
  ).flatMap(([purpose, collection, within]) => [
    catalogued(`${purpose} of every scope a caller holds, for a view`, "ownLabMember", "scopeKeys", {
      collection,
      within,
      where: [["scopeKeys", "array-contains-any", heldBy("ownLabMember")]],
      limit: LIMIT,
    } as LiveQuery<typeof collection>),
    catalogued(`${purpose} of the programme, for a view`, "admin", null, {
      collection,
      within,
      limit: LIMIT,
    } as LiveQuery<typeof collection>),
  ]),
  catalogued("a person's entries on every authorship list, for listMyAuthorshipEntries", null, null, {
    collection: "authorshipEntries",
    within: "group",
    where: [["personId", "==", "person-ivy"]],
    limit: 500,
  }),
  catalogued("the decision log of the programme, for a view, which every member reads", "member", null, {
    collection: "decisions",
    within: [],
    limit: LIMIT,
  }),
  catalogued("the hypotheses of every replication, for a view, which every member reads", "member", null, {
    collection: "replicationHypotheses",
    within: "group",
    limit: LIMIT,
  }),
  catalogued("the decision log of a replication, which every member reads", "member", null, {
    collection: "decisions",
    within: [],
    where: [["scopeId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
  catalogued("the prediction-market questions of a replication, which every member reads", "member", null, {
    collection: "predictionMarketItems",
    within: [],
    where: [["replicationId", "==", OWN_REPLICATION]],
    limit: LIMIT,
  }),
];
