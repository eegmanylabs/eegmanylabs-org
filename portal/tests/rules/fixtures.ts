// One fixture for every enforced entry of the collection registry: a stored document, what the
// rules can know of it, the queries that prove its scope, and the writes that the registry
// grants. The matrix test runs every kind of caller against every fixture.
// Everything here is synthetic: invented people, studies and laboratories on the example.org domain.
import {
  acknowledgementId,
  type CollectionKey,
  capabilityGrantId,
  entityRefId,
  generatedDocumentId,
  historicalAggregateId,
  hypothesisId,
  integrationMappingId,
  labClaimId,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  type PageAccessFacts,
  pageContentChunkId,
  pagePermissionId,
  pagePresenceId,
  recordGrantId,
  replicationMembershipId,
  replicationScopeKey,
  roleAssignmentId,
  searchIndexId,
  sequenceId,
  sourceTabKey,
  statusDefinitionId,
  studyAliasId,
  syncCellStateId,
  syncMappingId,
  tagId,
  unitScopeKeys,
  userWriteContext,
} from "@eegml/shared";
import {
  Bytes,
  doc,
  type Firestore,
  serverTimestamp,
  Timestamp,
  type WhereFilterOp,
  writeBatch,
} from "firebase/firestore";
import type { Known } from "./policy";
import {
  accessDocuments,
  appended,
  autoId,
  MEMBER_PERSON,
  MEMBER_UID,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  SECOND_PARTICIPATION,
  STORED_AT,
  stored,
  uidOfCaller,
} from "./world";

/** A query constraint, and what it proves about every document the query could return. */
export type ListConstraint = readonly [field: string, operator: WhereFilterOp, value: unknown];

export interface ListCase {
  readonly where: ListConstraint;
  /**
   * Further constraints that every list of the collection names, where the rules read another
   * document by a field of the listed ones: a thread's page by `targetId`, a shared view's
   * database by `collectionKey`. They prove nothing of the scope.
   */
  readonly also?: readonly ListConstraint[];
  readonly proves: Known;
}

/** A document that a client creates. */
export interface CreateCase {
  /** One identifier for each parameter of the path of the entry. */
  readonly ids: readonly string[];
  /** What is known of the new record, where it differs from the stored record of the fixture. */
  readonly subject?: Known;
  /** The fields of the document without the standard ones, for a caller with the given uid. */
  readonly data: (uid: string) => Record<string, unknown>;
}

export interface Fixture {
  /** The identifiers of the stored document, one for each parameter of the path of the entry. */
  readonly ids: readonly string[];
  /** The stored document, which is a valid document of the schema of the entry. */
  readonly seed: Record<string, unknown>;
  /** Everything the rules can know of the stored document. */
  readonly subject: Known;
  /** Constraints with which a caller limits a list to a scope. */
  readonly listBy?: readonly ListCase[];
  readonly create?: CreateCase;
  /** The fields that an update changes, which every writer of the entry may change. */
  readonly update?: (uid: string) => Record<string, unknown>;
  /**
   * The delete as the registry allows it, where a plain delete of the stored document is refused
   * to everyone: the update of a page, which goes only in the transaction of a compaction.
   */
  readonly remove?: RemoveCase;
}

/** A delete that the registry allows only together with other writes. */
export interface RemoveCase {
  /** What the delete goes with, in words. */
  readonly how: string;
  /** The other documents that the request writes, which the matrix puts back. */
  readonly touches: readonly string[];
  run(db: Firestore, uid: string): Promise<unknown>;
}

const REPLICATION_KEY = replicationScopeKey(OWN_REPLICATION);
const LABORATORY_KEY = laboratoryScopeKey(OWN_LABORATORY);

const OWNED: Known = { ownerUid: OWNER_UID };
const IN_REPLICATION: Known = { replicationId: OWN_REPLICATION, laboratoryId: null, scopeKeys: [REPLICATION_KEY] };
const IN_LABORATORY: Known = { replicationId: null, laboratoryId: OWN_LABORATORY, scopeKeys: [LABORATORY_KEY] };
const IN_UNIT: Known = {
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: [REPLICATION_KEY, LABORATORY_KEY],
};
const UNSCOPED: Known = {};

const BY_OWNER: ListCase = { where: ["uid", "==", OWNER_UID], proves: { ownerUid: OWNER_UID } };
const BY_REPLICATION: ListCase = {
  where: ["replicationId", "==", OWN_REPLICATION],
  proves: { replicationId: OWN_REPLICATION },
};
const BY_LABORATORY: ListCase = {
  where: ["laboratoryId", "==", OWN_LABORATORY],
  proves: { laboratoryId: OWN_LABORATORY },
};
const BY_REPLICATION_KEY: ListCase = {
  where: ["scopeKeys", "array-contains", REPLICATION_KEY],
  proves: { scopeKeys: [REPLICATION_KEY] },
};
const BY_LABORATORY_KEY: ListCase = {
  where: ["scopeKeys", "array-contains", LABORATORY_KEY],
  proves: { scopeKeys: [LABORATORY_KEY] },
};
const BY_MEMBERS_KEY: ListCase = {
  where: ["scopeKeys", "array-contains", MEMBERS_SCOPE_KEY],
  proves: { scopeKeys: [MEMBERS_SCOPE_KEY], memberVisible: true },
};

const UNIT_FIELDS = {
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
};

const SHORT_HASH = "0123456789abcdef0123";
const SHA_256 = "0123456789abcdef".repeat(4);
const PROGRAMME = "synthetic-programme";
const PROTOCOL = "protocol-1";
const PROTOCOL_VERSION = "version-1";
/** A version that a lead approved, which is what a person acknowledges. */
const APPROVED_VERSION = "version-0";
const MANUSCRIPT = "manuscript-1";
const CONTRIBUTOR_TABLE = "table-1";
const CONTRIBUTOR = "contributor-1";
const SECOND_CONTRIBUTOR = "contributor-2";
const SOURCE = "F";
const BATCH = "batch-1";
const SOURCE_RECORD = "source-record-1";
/** The task list and the task of the world. */
const TASK_LIST = autoId("stored task list");
const TASK = autoId("stored task");
const INTEGRITY_RUN = "run-1";
const SYNC_MAPPING = syncMappingId("F", sourceTabKey("Synthetic tab"), "core:laboratories");
const EARLIER = Timestamp.fromDate(new Date("2025-11-01T09:00:00Z"));
/** The dataset of the world, its storage server, its copy and its listing. */
const DATASET = "SyntheticStudy2001-own-main";
const STORAGE_ENDPOINT = "synthetic-sftp";
const STORAGE_REF = autoId("stored storage ref");
const MANIFEST = autoId("stored manifest");

const document = (fields: Record<string, unknown>) => ({ ...stored(), ...fields });
const appendedDocument = (fields: Record<string, unknown>) => ({ ...appended(), ...fields });

const person = (displayName: string, slug: string, userId: string | null) =>
  document({
    slug,
    displayName,
    laboratoryIds: userId === OWNER_UID ? [OWN_LABORATORY] : [],
    replicationIds: userId === OWNER_UID ? [OWN_REPLICATION] : [],
    isCoreTeam: false,
    publicListing: "member",
    coreRoles: [],
    userId,
    claimedAt: userId === null ? null : STORED_AT,
    custom: {},
    dataOrigin: "demo",
  });

const laboratory = (name: string, slug: string) =>
  document({ slug, name, status: "active", custom: {}, dataOrigin: "demo" });

const replication = (studyKey: string) =>
  document({
    programmeId: PROGRAMME,
    studyKey,
    shortTitle: `Synthetic study ${studyKey.slice(-4)}`,
    citationStatus: "unverified",
    statusKey: "planning",
    statusHistoryId: null,
    selectionStatus: "selected",
    leadPersonIds: [],
    vocabulary: [],
    custom: {},
    dataOrigin: "demo",
  });

const participation = (replicationId: string, laboratoryId: string) =>
  document({
    replicationId,
    laboratoryId,
    scopeKeys: unitScopeKeys(replicationId, laboratoryId),
    status: "invited",
    statusHistoryId: null,
    readinessStatus: "notStarted",
    custom: {},
    dataOrigin: "demo",
  });

const contributor = () =>
  document({
    surnameSource: "Synthetic",
    creditRoles: { investigation: true },
    reviewStatus: "needsReview",
    replicationId: OWN_REPLICATION,
    manuscriptId: null,
    contributorTableId: CONTRIBUTOR_TABLE,
    personId: null,
    scopeKeys: [REPLICATION_KEY],
  });

const entityReference = { entityType: "replication", entityId: OWN_REPLICATION } as const;
const OWN_REFERENCE = entityRefId("replication", OWN_REPLICATION);
const NEW_REFERENCE = entityRefId("laboratory", OWN_LABORATORY);
const newEntityReference = { entityType: "laboratory", entityId: OWN_LABORATORY } as const;

/**
 * The fixture of every enforced entry. A meta-test fails when an enforced entry has none, when
 * a fixture names an entry that is not enforced, and when a fixture lacks the write that the
 * registry grants.
 */
// The workspace: the body page of the owning replication, which the owning laboratory shares.
// Every member reads it, the replication's team and the laboratory's members comment on it, the
// team edits it, and the managers of either unit hold full access without being listed.
const PAGE = entityRefId("replication", OWN_REPLICATION);
const PAGE_PATH = `pages/${PAGE}`;
const PAGE_SCOPE = [LABORATORY_KEY, MEMBERS_SCOPE_KEY, REPLICATION_KEY];
/** The tabs of the stored presence on the page and of a new one. */
const STORED_TAB = "StoredTabAbCdEfGhIjK";
const NEW_TAB = "NewTabAbCdEfGhIjKlMn";
/** The author of the stored comment: a member of the laboratory, who may comment on the page. */
export const COMMENT_AUTHOR_UID = uidOfCaller("ownLabMember");
const PAGE_LEVELS = { comment: [LABORATORY_KEY, REPLICATION_KEY], edit: [REPLICATION_KEY], full: [] };
const PAGE_FACTS: PageAccessFacts = {
  accessMode: "inherit",
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: PAGE_SCOPE,
  levelKeys: PAGE_LEVELS,
};
const ON_PAGE: Known = {
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: PAGE_SCOPE,
  memberVisible: true,
  page: PAGE_FACTS,
};
const PAGE_SCOPE_FIELDS = { replicationId: OWN_REPLICATION, laboratoryId: OWN_LABORATORY, scopeKeys: PAGE_SCOPE };
const THREAD = autoId("stored thread");
const VERSION = "version-1";
/** A Yjs update or snapshot as it is stored: two bytes are enough for the rules. */
const yjsBytes = () => Bytes.fromUint8Array(new Uint8Array([0, 0]));
/** The head of the content that the stored page names: generation 1, whose one chunk is a supporting document. */
const CONTENT_HEAD = {
  generation: 1,
  chunkCount: 1,
  byteLength: 2,
  stateVector: yjsBytes(),
  compactedAt: STORED_AT,
};
/** The generation that the compaction of the matrix moves the page to, whose chunk is a supporting document. */
const COMPACTED_GENERATION = 3;

/** The stored database of the workspace, beneath the page, and the definition of its status. */
const DATABASE = autoId("stored database");
const STATUS_PROPERTY = {
  key: "status",
  name: "Status",
  type: "status",
  config: { options: [{ id: "active", name: "Active" }] },
  order: "i",
  archivedAt: null,
};

export const FIXTURES: { readonly [K in CollectionKey]?: Fixture } = {
  // Identity and access.
  users: {
    ids: [OWNER_UID],
    seed: document({
      emailLower: "owner.account@example.org",
      displayName: "Synthetic Owner",
      personId: OWNER_PERSON,
      status: "active",
      mfaEnrolled: false,
      lastSeenAt: STORED_AT,
      dataOrigin: "demo",
    }),
    subject: OWNED,
  },
  userFavourites: {
    ids: [OWNER_UID, OWN_REFERENCE],
    seed: document({ uid: OWNER_UID, ...entityReference }),
    subject: OWNED,
    create: { ids: [OWNER_UID, NEW_REFERENCE], data: () => ({ uid: OWNER_UID, ...newEntityReference }) },
    update: () => ({}),
  },
  userRecents: {
    ids: [OWNER_UID, OWN_REFERENCE],
    seed: document({ uid: OWNER_UID, ...entityReference }),
    subject: OWNED,
    create: { ids: [OWNER_UID, NEW_REFERENCE], data: () => ({ uid: OWNER_UID, ...newEntityReference }) },
    update: () => ({}),
  },
  userNotifications: {
    ids: [OWNER_UID, "notification-1"],
    seed: document({
      uid: OWNER_UID,
      type: "mention",
      ...entityReference,
      eventId: "event-1",
      payload: {},
      readAt: null,
      emailedAt: null,
    }),
    subject: OWNED,
    update: () => ({ readAt: serverTimestamp() }),
  },
  userSubscriptions: {
    ids: [OWNER_UID, OWN_REFERENCE],
    seed: document({ uid: OWNER_UID, ...entityReference, level: "all" }),
    subject: OWNED,
    create: {
      ids: [OWNER_UID, NEW_REFERENCE],
      data: () => ({ uid: OWNER_UID, ...newEntityReference, level: "mentions" }),
    },
    update: () => ({ level: "none" }),
  },
  userPreferences: {
    ids: [OWNER_UID],
    seed: document({
      channels: { inApp: true, email: false },
      digestFrequency: "weekly",
      quietHours: null,
      typeSwitches: {},
    }),
    subject: OWNED,
    create: {
      ids: [MEMBER_UID],
      subject: { ownerUid: MEMBER_UID },
      data: () => ({
        channels: { inApp: true, email: true },
        digestFrequency: "daily",
        quietHours: { start: "22:00", end: "07:30", timeZone: "Europe/London" },
        typeSwitches: { mention: true },
      }),
    },
    update: () => ({ digestFrequency: "off" }),
  },
  access: {
    ids: [OWNER_UID],
    seed: accessDocuments()[`access/${OWNER_UID}`] ?? {},
    subject: OWNED,
  },
  roleAssignments: {
    ids: [roleAssignmentId(uidOfCaller("ownLead"), "replication_lead", "replication", OWN_REPLICATION)],
    seed: document({
      uid: uidOfCaller("ownLead"),
      role: "replication_lead",
      scopeType: "replication",
      scopeId: OWN_REPLICATION,
      status: "active",
      grantedBy: uidOfCaller("admin"),
      grantedAt: STORED_AT,
      expiresAt: null,
      revokedBy: null,
      revokedAt: null,
      history: [],
    }),
    subject: UNSCOPED,
  },
  roleCapabilities: {
    ids: ["core_team"],
    seed: document({ role: "core_team", overrides: { importsRollback: true } }),
    subject: UNSCOPED,
  },
  capabilityGrants: {
    ids: [capabilityGrantId(OWNER_UID, "demographics.read")],
    seed: document({
      uid: OWNER_UID,
      capability: "demographics.read",
      grantedBy: uidOfCaller("admin"),
      grantedAt: STORED_AT,
      reason: "Synthetic grant for an equality report.",
      expiresAt: null,
      revokedBy: null,
      revokedAt: null,
      history: [],
    }),
    subject: UNSCOPED,
  },
  recordGrants: {
    ids: [recordGrantId(OWNER_UID, "replication", OWN_REPLICATION)],
    seed: document({
      uid: OWNER_UID,
      ...entityReference,
      level: "view",
      grantedBy: uidOfCaller("admin"),
      grantedAt: STORED_AT,
      expiresAt: null,
      revokedAt: null,
    }),
    subject: UNSCOPED,
  },
  groups: {
    ids: ["synthetic-working-group"],
    seed: document({
      groupKey: "synthetic-working-group",
      kind: "workingGroup",
      name: "Synthetic working group",
      replicationId: null,
      laboratoryId: null,
      pageId: null,
      memberUids: [OWNER_UID],
      roles: { [OWNER_UID]: "manager" },
      unclaimedPersonIds: [],
    }),
    subject: UNSCOPED,
  },
  externalAccounts: {
    ids: ["account-1"],
    seed: document({
      ownerType: "replication",
      ownerId: OWN_REPLICATION,
      system: "osf",
      accountName: "synthetic-study-2001",
      scopeKeys: [REPLICATION_KEY],
    }),
    subject: IN_REPLICATION,
    listBy: [BY_REPLICATION_KEY],
    create: {
      ids: [autoId("accountNew")],
      data: () => ({
        ownerType: "replication",
        ownerId: OWN_REPLICATION,
        system: "github",
        accountName: "synthetic-team",
        scopeKeys: [REPLICATION_KEY],
      }),
    },
    update: () => ({ accountName: "synthetic-study-2001-renamed" }),
  },
  invitations: {
    ids: ["invitation-1"],
    seed: document({
      email: "invited.person@example.org",
      personId: null,
      role: "lab_member",
      scopeType: "laboratory",
      scopeId: OWN_LABORATORY,
      tokenHash: SHA_256,
      expiresAt: STORED_AT,
      acceptedAt: null,
      invitedBy: uidOfCaller("admin"),
      revokedAt: null,
    }),
    subject: UNSCOPED,
  },
  accountClaims: {
    ids: [OWNER_UID],
    seed: document({ uid: OWNER_UID, status: "approved", personId: OWNER_PERSON, submittedAt: STORED_AT }),
    subject: OWNED,
  },
  accountClaimReview: {
    ids: [OWNER_UID],
    seed: document({
      uid: OWNER_UID,
      candidatePersonIds: [OWNER_PERSON],
      matchBasis: "primaryEmail",
      evidence: {},
      reviewedBy: null,
      reviewedAt: null,
      history: [],
    }),
    subject: UNSCOPED,
  },
  labClaims: {
    ids: [labClaimId(OWNER_UID, OWN_LABORATORY)],
    seed: document({
      laboratoryId: OWN_LABORATORY,
      uid: OWNER_UID,
      requestedRole: "representative",
      status: "pendingReview",
      submittedAt: STORED_AT,
    }),
    subject: { ownerUid: OWNER_UID, laboratoryId: OWN_LABORATORY },
    listBy: [BY_OWNER, BY_LABORATORY],
  },
  labClaimReview: {
    ids: [labClaimId(OWNER_UID, OWN_LABORATORY)],
    seed: document({ evidence: { affiliationMatch: true }, reviewedBy: null, reviewedAt: null, history: [] }),
    subject: { laboratoryId: OWN_LABORATORY },
  },
  correctionRequests: {
    ids: ["request-1"],
    seed: document({
      uid: OWNER_UID,
      entityType: "person",
      entityId: OWNER_PERSON,
      field: "displayName",
      proposedValue: "Synthetic Owner-Example",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    }),
    subject: OWNED,
    listBy: [BY_OWNER],
    create: {
      ids: [autoId("requestNew")],
      data: (uid) => ({
        uid,
        entityType: "laboratory",
        entityId: OWN_LABORATORY,
        field: "city",
        proposedValue: "Synthetic City",
        message: "The city on the profile is out of date.",
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
      }),
    },
    update: () => ({ status: "withdrawn" }),
  },
  persons: {
    ids: [OWNER_PERSON],
    seed: person("Synthetic Owner", "synthetic-owner", OWNER_UID),
    subject: OWNED,
    update: () => ({ scholarUrl: "https://example.org/scholar/synthetic-owner" }),
  },
  personContact: {
    ids: [OWNER_PERSON],
    seed: document({
      emails: [{ email: "owner.account@example.org", kind: "primary", verifiedAt: null, claimEligible: true }],
    }),
    subject: { ownerUid: OWNER_UID, replicationId: OWN_REPLICATION, laboratoryId: OWN_LABORATORY },
  },
  personAddress: {
    ids: [OWNER_PERSON],
    seed: document({ postalAddress: "1 Synthetic Street, Example Town" }),
    subject: OWNED,
    create: {
      ids: [MEMBER_PERSON],
      subject: { ownerUid: MEMBER_UID },
      data: () => ({ postalAddress: "2 Synthetic Street, Example Town" }),
    },
    update: () => ({ postalAddress: "3 Synthetic Street, Example Town" }),
  },
  personNotes: {
    ids: [OWNER_PERSON],
    seed: document({ privateNotes: "Synthetic note for administrators." }),
    subject: UNSCOPED,
    create: { ids: [MEMBER_PERSON], data: () => ({ privateNotes: "A second synthetic note." }) },
    update: () => ({ privateNotes: "Synthetic note, revised." }),
  },
  personDemographics: {
    ids: [OWNER_PERSON],
    seed: document({ genderSource: "synthetic value", ethnicitySource: "synthetic value", recordedAt: STORED_AT }),
    subject: OWNED,
  },
  personAffiliations: {
    ids: [OWNER_PERSON, "affiliation-1"],
    seed: document({ personId: OWNER_PERSON, affiliationSource: "Synthetic University", isPrimary: true }),
    subject: OWNED,
    create: {
      ids: [OWNER_PERSON, autoId("affiliationNew")],
      data: () => ({ personId: OWNER_PERSON, affiliationSource: "Example Institute", isPrimary: false }),
    },
    update: () => ({ roleTitle: "Researcher" }),
  },
  personEmailIndex: {
    ids: [SHORT_HASH],
    seed: document({ personIds: [OWNER_PERSON], claimEligiblePersonIds: [OWNER_PERSON] }),
    subject: UNSCOPED,
  },
  identityKeys: {
    ids: [SHORT_HASH],
    seed: document({
      entityType: "person",
      keyKind: "slug",
      entityIds: [OWNER_PERSON],
      status: "active",
      mergedIntoId: null,
    }),
    subject: UNSCOPED,
  },
  institutions: {
    ids: ["institution-1"],
    seed: document({ name: "Synthetic University", countryCode: "GB", emailDomains: ["example.org"] }),
    subject: UNSCOPED,
    update: () => ({ city: "Example Town" }),
  },

  // Programme, laboratories and equipment.
  programmes: {
    ids: [PROGRAMME],
    seed: document({ key: PROGRAMME, name: "Synthetic programme", parentId: null, kind: "programme" }),
    subject: UNSCOPED,
    create: {
      ids: ["synthetic-subproject"],
      data: () => ({
        key: "synthetic-subproject",
        name: "Synthetic subproject",
        parentId: PROGRAMME,
        kind: "subproject",
      }),
    },
    update: () => ({ description: "A programme that exists only in tests." }),
  },
  laboratories: {
    ids: [OWN_LABORATORY],
    seed: laboratory("Synthetic Laboratory One", "synthetic-laboratory-one"),
    subject: IN_LABORATORY,
    update: () => ({ city: "Example Town" }),
  },
  laboratoryDetail: {
    ids: [OWN_LABORATORY],
    seed: document({ address: "1 Laboratory Road, Example Town", internalNotes: "Synthetic note." }),
    subject: IN_LABORATORY,
    create: {
      ids: [OTHER_LABORATORY],
      subject: { replicationId: null, laboratoryId: OTHER_LABORATORY },
      data: () => ({ address: "2 Laboratory Road, Example Town" }),
    },
    update: () => ({ internalNotes: "Synthetic note, revised." }),
  },
  laboratoryMembers: {
    ids: [OWN_LABORATORY, OWNER_PERSON],
    seed: document({
      laboratoryId: OWN_LABORATORY,
      personId: OWNER_PERSON,
      role: "member",
      isAuthorisedRepresentative: false,
      earlierPeriods: [],
      status: "confirmed",
    }),
    subject: IN_LABORATORY,
    create: {
      ids: [OWN_LABORATORY, MEMBER_PERSON],
      data: () => ({
        laboratoryId: OWN_LABORATORY,
        personId: MEMBER_PERSON,
        role: "member",
        isAuthorisedRepresentative: false,
        earlierPeriods: [],
        status: "proposed",
      }),
    },
    update: () => ({ endDate: "2026-03-31" }),
  },
  laboratoryEquipment: {
    ids: [OWN_LABORATORY, "configuration-1"],
    seed: document({
      laboratoryId: OWN_LABORATORY,
      name: "Synthetic booth",
      isCurrent: true,
      validFrom: STORED_AT,
      validTo: null,
      supersedesId: null,
      channelCount: 64,
    }),
    subject: IN_LABORATORY,
  },

  // Replications and scientific definition.
  replications: {
    ids: [OWN_REPLICATION],
    seed: replication(OWN_REPLICATION),
    subject: IN_REPLICATION,
    create: {
      ids: ["SyntheticStudy2003"],
      subject: { replicationId: "SyntheticStudy2003", laboratoryId: null },
      data: () => ({
        programmeId: PROGRAMME,
        studyKey: "SyntheticStudy2003",
        shortTitle: "Synthetic study 2003",
        citationStatus: "unverified",
        statusKey: null,
        statusHistoryId: null,
        selectionStatus: "selected",
        leadPersonIds: [],
        vocabulary: [],
        custom: {},
        dataOrigin: "live",
      }),
    },
    update: () => ({ shortTitle: "Synthetic study, renamed" }),
  },
  replicationDetail: {
    ids: [OWN_REPLICATION],
    seed: document({ notesSource: "Synthetic source note.", internalNotes: "Synthetic internal note." }),
    subject: IN_REPLICATION,
    create: {
      ids: [OTHER_REPLICATION],
      subject: { replicationId: OTHER_REPLICATION, laboratoryId: null },
      data: () => ({ internalNotes: "A first internal note." }),
    },
    update: () => ({ internalNotes: "Synthetic internal note, revised." }),
  },
  replicationAliases: {
    ids: [OWN_REPLICATION, studyAliasId("bids", "SyntheticStudy")],
    seed: document({
      replicationId: OWN_REPLICATION,
      alias: "SyntheticStudy",
      aliasFolded: "syntheticstudy",
      scheme: "bids",
      isCanonical: false,
    }),
    subject: IN_REPLICATION,
  },
  replicationMemberships: {
    ids: [OWN_REPLICATION, replicationMembershipId(OWNER_PERSON, "member")],
    seed: document({
      replicationId: OWN_REPLICATION,
      personId: OWNER_PERSON,
      role: "member",
      isCurrent: true,
      earlierPeriods: [],
      reviewStatus: "confirmed",
    }),
    subject: { ...IN_REPLICATION, memberVisible: true },
    listBy: [{ where: ["reviewStatus", "==", "confirmed"], proves: { memberVisible: true } }, BY_REPLICATION],
    create: {
      ids: [OWN_REPLICATION, replicationMembershipId(MEMBER_PERSON, "analyst")],
      data: () => ({
        replicationId: OWN_REPLICATION,
        personId: MEMBER_PERSON,
        role: "analyst",
        isCurrent: true,
        earlierPeriods: [],
        reviewStatus: "needsReview",
      }),
    },
    update: () => ({ isCurrent: false, endDate: "2026-03-31" }),
  },
  replicationHypotheses: {
    ids: [OWN_REPLICATION, hypothesisId(1)],
    seed: document({
      replicationId: OWN_REPLICATION,
      hypothesisNumber: "1",
      text: "A synthetic effect is larger in one condition than in the other.",
      scientificReviewStatus: "unverified",
      analysisStatus: "notStarted",
      resultReviewedBy: null,
      resultReviewedAt: null,
    }),
    subject: IN_REPLICATION,
    create: {
      ids: [OWN_REPLICATION, hypothesisId(2)],
      data: () => ({
        replicationId: OWN_REPLICATION,
        hypothesisNumber: "2",
        text: "A second synthetic effect is absent.",
        preregistrationUrl: "https://example.org/preregistration",
        scientificReviewStatus: "unverified",
        analysisStatus: "notStarted",
        resultReviewedBy: null,
        resultReviewedAt: null,
      }),
    },
    update: () => ({ expectedEffect: "A medium effect.", analysisStatus: "inProgress" }),
  },
  replicationProtocols: {
    ids: [OWN_REPLICATION, PROTOCOL],
    seed: document({ replicationId: OWN_REPLICATION, title: "Synthetic protocol", currentVersionId: PROTOCOL_VERSION }),
    subject: IN_REPLICATION,
    create: {
      ids: [OWN_REPLICATION, autoId("protocolNew")],
      data: () => ({ replicationId: OWN_REPLICATION, title: "Second synthetic protocol", currentVersionId: null }),
    },
    update: () => ({ description: "The protocol of a study that exists only in tests." }),
  },
  replicationProtocolVersions: {
    ids: [OWN_REPLICATION, PROTOCOL_VERSION],
    seed: document({
      replicationId: OWN_REPLICATION,
      protocolId: PROTOCOL,
      versionLabel: "1.0",
      status: "draft",
      approvedBy: null,
      approvedAt: null,
    }),
    subject: IN_REPLICATION,
    create: {
      ids: [OWN_REPLICATION, autoId("versionNew")],
      data: () => ({
        replicationId: OWN_REPLICATION,
        protocolId: PROTOCOL,
        versionLabel: "1.1",
        status: "draft",
        approvedBy: null,
        approvedAt: null,
      }),
    },
    update: () => ({ changeSummary: "Clarifies the order of the blocks." }),
  },
  replicationEquipmentRequirements: {
    ids: [OWN_REPLICATION, "min-channels"],
    seed: document({
      replicationId: OWN_REPLICATION,
      requirementKey: "min-channels",
      operator: "atLeast",
      value: 32,
      isMandatory: true,
    }),
    subject: IN_REPLICATION,
    create: {
      ids: [OWN_REPLICATION, "eye-tracker"],
      data: () => ({
        replicationId: OWN_REPLICATION,
        requirementKey: "eye-tracker",
        operator: "present",
        isMandatory: false,
      }),
    },
    update: () => ({ note: "Sixty-four channels are preferred." }),
  },
  replicationSummaries: {
    ids: [OWN_REPLICATION, "recruitment"],
    seed: document({
      replicationId: OWN_REPLICATION,
      kind: "recruitment",
      totals: { labReported: { main: { tested: 12 } } },
      participationCount: 1,
      reportCount: 1,
      latestAsOfDate: "2026-01-01",
      computedAt: STORED_AT,
    }),
    subject: IN_REPLICATION,
  },
  statusHistory: {
    ids: ["history-1"],
    seed: appendedDocument({
      entityType: "replication",
      entityId: OWN_REPLICATION,
      fromStatusKey: null,
      toStatusKey: "planning",
      effectiveAt: STORED_AT,
      recordedAt: STORED_AT,
      changedBy: uidOfCaller("admin"),
      source: "manual",
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
    }),
    subject: { scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY], memberVisible: true },
    listBy: [BY_MEMBERS_KEY, BY_REPLICATION_KEY],
  },
  historicalAggregates: {
    ids: [historicalAggregateId("nLabsSigned", SOURCE_RECORD)],
    seed: document({
      replicationIds: [OWN_REPLICATION],
      metricKey: "nLabsSigned",
      valueSource: "12",
      valueNumeric: 12,
      sourceRecordId: SOURCE_RECORD,
      isCurrent: true,
      dataOrigin: "importedHistorical",
    }),
    subject: UNSCOPED,
  },
  candidateStudies: {
    ids: ["candidate-1"],
    seed: document({
      programmeId: PROGRAMME,
      originalTitle: "A synthetic paper",
      selectionStatus: "shortlisted",
      replicationId: null,
      dataOrigin: "demo",
    }),
    subject: UNSCOPED,
    create: {
      ids: ["candidate-new"],
      data: () => ({
        programmeId: PROGRAMME,
        originalTitle: "Another synthetic paper",
        originalYear: 2004,
        selectionStatus: "rankedCandidate",
        replicationId: null,
        dataOrigin: "live",
      }),
    },
    update: () => ({ selectionStatus: "withdrawn" }),
  },
  studyAliasIndex: {
    ids: ["syntheticstudy"],
    seed: document({ replicationIds: [OWN_REPLICATION] }),
    subject: UNSCOPED,
  },
  statusDefinitions: {
    ids: [statusDefinitionId("replication", "planning")],
    seed: document({
      entityType: "replication",
      key: "planning",
      label: "Planning",
      category: "notStarted",
      position: 1,
      isDefault: false,
    }),
    subject: UNSCOPED,
    create: {
      ids: [statusDefinitionId("replication", "synthetic-status")],
      data: () => ({
        entityType: "replication",
        key: "synthetic-status",
        label: "Synthetic status",
        category: "active",
        position: 20,
        isDefault: false,
      }),
    },
    update: () => ({ label: "Planning the study" }),
  },
  vocabularyTerms: {
    ids: ["term-1"],
    seed: document({
      sourceId: "term-1",
      name: "Synthetic construct",
      sameAsSource: [],
      labelsSource: ["Synthetic construct"],
      kind: "construct",
      isDeprecated: false,
    }),
    subject: UNSCOPED,
    create: {
      ids: ["term-new"],
      data: () => ({
        name: "Second synthetic construct",
        sameAsSource: [],
        labelsSource: [],
        kind: "construct",
        isDeprecated: false,
      }),
    },
    update: () => ({ description: "A term that exists only in tests." }),
  },
  predictionMarketItems: {
    ids: ["item-1"],
    seed: document({ questionText: "Will the synthetic effect replicate?", choices: ["Yes", "No"] }),
    subject: UNSCOPED,
    create: {
      ids: [autoId("itemNew")],
      data: () => ({
        replicationId: OWN_REPLICATION,
        questionText: "Will the second synthetic effect replicate?",
        choices: ["Yes", "No"],
      }),
    },
    update: () => ({ choices: ["Yes", "No", "Unsure"] }),
  },

  // Participation.
  participations: {
    ids: [OWN_PARTICIPATION],
    seed: participation(OWN_REPLICATION, OWN_LABORATORY),
    subject: IN_UNIT,
    // No client creates a participation: createParticipation writes it with its checklist.
    update: () => ({ targetNMain: 48, readinessStatus: "inProgress" }),
  },
  participationDetail: {
    ids: [OWN_PARTICIPATION],
    seed: document({
      ethicsStatus: "submitted",
      trainingStatus: "notStarted",
      readinessApprovedBy: null,
      readinessApprovedAt: null,
    }),
    subject: IN_UNIT,
    create: {
      ids: [SECOND_PARTICIPATION],
      subject: { replicationId: OWN_REPLICATION, laboratoryId: OTHER_LABORATORY },
      data: () => ({
        ethicsStatus: "unknown",
        trainingStatus: "unknown",
        readinessApprovedBy: null,
        readinessApprovedAt: null,
      }),
    },
    update: () => ({ ethicsStatus: "approved", ethicsReference: "SYN-2026-001" }),
  },
  participationChecklist: {
    ids: [OWN_PARTICIPATION, "ethics"],
    seed: document({
      participationId: OWN_PARTICIPATION,
      templateKey: "onboarding",
      templateItemKey: "ethics",
      label: "Ethics approval",
      status: "notStarted",
      completedBy: null,
      completedAt: null,
      position: 3,
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_LABORATORY, BY_REPLICATION_KEY],
    update: () => ({ status: "inProgress", note: "The application has been sent." }),
  },
  participationTeamMembers: {
    ids: [OWN_PARTICIPATION, OWNER_PERSON],
    seed: document({
      participationId: OWN_PARTICIPATION,
      personId: OWNER_PERSON,
      role: "experimenter",
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION, BY_LABORATORY],
    create: {
      ids: [OWN_PARTICIPATION, MEMBER_PERSON],
      data: () => ({ participationId: OWN_PARTICIPATION, personId: MEMBER_PERSON, role: "analyst", ...UNIT_FIELDS }),
    },
    update: () => ({ role: "dataManager" }),
  },
  participationAcknowledgements: {
    ids: [OWN_PARTICIPATION, acknowledgementId(OWNER_PERSON, PROTOCOL_VERSION)],
    seed: appendedDocument({
      participationId: OWN_PARTICIPATION,
      protocolId: PROTOCOL,
      protocolVersionId: PROTOCOL_VERSION,
      personId: OWNER_PERSON,
      acknowledgedAt: STORED_AT,
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION, BY_LABORATORY],
    // The person of the account `owner` is on the team of the participation and acknowledges
    // the approved version in its own name.
    create: {
      ids: [OWN_PARTICIPATION, acknowledgementId(OWNER_PERSON, APPROVED_VERSION)],
      subject: { ...IN_UNIT, ownerUid: OWNER_UID },
      data: () => ({
        participationId: OWN_PARTICIPATION,
        protocolId: PROTOCOL,
        protocolVersionId: APPROVED_VERSION,
        personId: OWNER_PERSON,
        acknowledgedAt: serverTimestamp(),
        ...UNIT_FIELDS,
      }),
    },
  },
  participationDeviations: {
    ids: [OWN_PARTICIPATION, "deviation-1"],
    seed: document({
      participationId: OWN_PARTICIPATION,
      description: "A block was presented in the wrong order.",
      severity: "minor",
      occurredAt: EARLIER,
      reportedBy: uidOfCaller("ownCoordinator"),
      status: "open",
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION, BY_LABORATORY],
    create: {
      ids: [OWN_PARTICIPATION, autoId("deviationNew")],
      data: (uid) => ({
        participationId: OWN_PARTICIPATION,
        description: "One recording was stopped early.",
        severity: "major",
        occurredAt: EARLIER,
        reportedBy: uid,
        status: "open",
        ...UNIT_FIELDS,
      }),
    },
    update: () => ({ status: "underReview", correctiveAction: "The block order is now checked before a session." }),
  },
  checklistTemplates: {
    ids: ["onboarding"],
    seed: document({ key: "onboarding", items: [{ key: "ethics", label: "Ethics approval" }] }),
    subject: UNSCOPED,
    create: {
      ids: ["synthetic-template"],
      data: () => ({ key: "synthetic-template", items: [{ key: "first-step", label: "First step" }] }),
    },
    update: () => ({
      items: [
        { key: "ethics", label: "Ethics approval" },
        { key: "training", label: "Training" },
      ],
    }),
  },
  outreachContacts: {
    ids: ["contact-1"],
    seed: document({
      replicationId: OWN_REPLICATION,
      labNameSource: "Synthetic Laboratory Three",
      contactEmail: "contact.person@example.org",
      firstContactSource: "1/2/2019",
      sourceRecordId: SOURCE_RECORD,
      scopeKeys: [REPLICATION_KEY],
    }),
    subject: IN_REPLICATION,
    listBy: [BY_REPLICATION],
  },

  // Recruitment.
  countCategories: {
    ids: ["tested"],
    seed: document({
      key: "tested",
      label: "Tested",
      definition: "Participants who completed a session.",
      position: 5,
      isCore: true,
    }),
    subject: UNSCOPED,
    create: {
      ids: ["synthetic-category"],
      data: () => ({
        key: "synthetic-category",
        label: "Synthetic category",
        definition: "A category that exists only in tests.",
        position: 50,
        isCore: false,
        replicationId: OWN_REPLICATION,
      }),
    },
    update: () => ({ label: "Tested in the laboratory" }),
  },

  recruitmentReports: {
    ids: [autoId("stored recruitment report")],
    seed: appendedDocument({
      participationId: OWN_PARTICIPATION,
      ...UNIT_FIELDS,
      asOfDate: "2026-01-31",
      reportKind: "cumulative",
      basis: "labReported",
      entryKind: "new",
      counts: { main: { tested: 12 }, rest: { tested: 10 }, participants: { tested: 13 } },
      exclusions: [],
      reportedBy: uidOfCaller("ownCoordinator"),
      source: "manual",
      dataOrigin: "live",
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION_KEY, BY_LABORATORY_KEY, BY_REPLICATION, BY_LABORATORY],
  },
  plannedPauses: {
    ids: [autoId("stored planned pause")],
    seed: document({
      participationId: OWN_PARTICIPATION,
      ...UNIT_FIELDS,
      startsOn: "2026-07-01",
      endsOn: "2026-07-31",
      reason: "The synthetic laboratory closes for the summer.",
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION_KEY, BY_LABORATORY_KEY, BY_REPLICATION, BY_LABORATORY],
    create: {
      ids: [autoId("new planned pause")],
      data: () => ({
        participationId: OWN_PARTICIPATION,
        ...UNIT_FIELDS,
        startsOn: "2026-08-01",
        endsOn: "2026-08-14",
      }),
    },
    update: () => ({ endsOn: "2026-07-15" }),
  },
  forecastRuns: {
    ids: [autoId("stored forecast run")],
    seed: appendedDocument({
      replicationId: OWN_REPLICATION,
      generatedAt: STORED_AT,
      generatedBy: uidOfCaller("ownLead"),
      methodVersion: "recruitment-forecast/1",
      assumptions: { stated: { windowDays: 90 } },
      scenarios: { optimistic: {}, central: {}, conservative: {} },
      inputsAsOf: "2026-01-31",
      dataOrigin: "projected",
    }),
    subject: UNSCOPED,
  },

  // Tasks.
  taskLists: {
    ids: [TASK_LIST],
    seed: document({
      name: "Synthetic plan",
      kind: "project",
      ownerUid: null,
      scopeType: "replication",
      scopeId: OWN_REPLICATION,
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [REPLICATION_KEY],
    }),
    subject: IN_REPLICATION,
    listBy: [BY_REPLICATION_KEY],
  },
  tasks: {
    ids: [TASK],
    seed: document({
      listId: TASK_LIST,
      ownerUid: null,
      parentId: null,
      ancestorIds: [],
      order: "i",
      kind: "task",
      title: "Pilot the synthetic paradigm",
      mentionUids: [],
      statusKey: "toDo",
      statusHistoryId: null,
      priority: "high",
      completedAt: null,
      assigneeUids: [MEMBER_UID],
      collaboratorUids: [],
      followerUids: [],
      unclaimedParticipants: [],
      dependsOn: {},
      links: [],
      checklist: {},
      tagIds: [],
      custom: {},
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [REPLICATION_KEY],
    }),
    subject: { ...IN_REPLICATION, participantUids: [MEMBER_UID] },
    listBy: [
      BY_REPLICATION_KEY,
      { where: ["assigneeUids", "array-contains", MEMBER_UID], proves: { participantUids: [MEMBER_UID] } },
    ],
  },
  tags: {
    ids: [tagId("Pilot")],
    seed: document({ name: "Pilot", nameFolded: "pilot", colour: "coral" }),
    subject: UNSCOPED,
    create: {
      ids: [tagId("Synthetic tag")],
      data: () => ({ name: "Synthetic tag", nameFolded: "synthetictag" }),
    },
    update: () => ({ colour: "graphite" }),
  },
  reminders: {
    ids: [autoId("stored reminder")],
    seed: document({
      uid: OWNER_UID,
      entityType: "task",
      entityId: TASK,
      remindAt: STORED_AT,
      sentAt: null,
      channel: "inApp",
    }),
    subject: OWNED,
    listBy: [BY_OWNER],
    // A reminder is set through the callable function `setReminder`, never by a client.
    update: () => ({ channel: "email" }),
  },

  // Datasets. Functions write all of it; the fixtures prove who reads what.
  storageEndpoints: {
    ids: [STORAGE_ENDPOINT],
    seed: document({
      key: STORAGE_ENDPOINT,
      name: "Synthetic institutional EEG server",
      protocol: "sftp",
      scanMode: "remote",
      status: "active",
      lastCheckedAt: STORED_AT,
      lastSeenAt: STORED_AT,
      scopeKeys: [REPLICATION_KEY, LABORATORY_KEY],
    }),
    subject: UNSCOPED,
  },
  storageEndpointConnection: {
    ids: [STORAGE_ENDPOINT],
    seed: document({ host: "sftp.synthetic.example.org", basePath: "eeg", credentialRef: "STORAGE_SYNTHETIC" }),
    subject: UNSCOPED,
  },
  datasets: {
    ids: [DATASET],
    seed: document({
      datasetKey: DATASET,
      replicationId: OWN_REPLICATION,
      laboratoryId: OWN_LABORATORY,
      participationId: OWN_PARTICIPATION,
      scopeKeys: [REPLICATION_KEY, LABORATORY_KEY],
      title: "Synthetic flanker recordings",
      modality: "main",
      expectedManifestId: null,
      availability: "available",
      lastSeenAt: STORED_AT,
      workflowStatusKey: "received",
      statusHistoryId: null,
      bidsConversionStatus: "notStarted",
      bidsStatus: "notStarted",
      qcStatus: "notStarted",
      analysisReady: false,
      custom: {},
      dataOrigin: "demo",
    }),
    subject: IN_UNIT,
  },
  datasetWorkflows: {
    ids: [OWN_REPLICATION],
    seed: document({
      replicationId: OWN_REPLICATION,
      states: [
        { key: "received", label: "Received", category: "notStarted", analysisReady: false },
        { key: "ready", label: "Ready", category: "done", analysisReady: true },
      ],
      transitions: { received: ["ready"] },
      initialKey: "received",
    }),
    subject: UNSCOPED,
  },
  datasetDetail: {
    ids: [DATASET],
    seed: document({
      metadata: { amplifier: "Synthetic amplifier" },
      bidsMissingMetadata: ["SYNTHETIC_MISSING: /sub-01"],
    }),
    subject: IN_UNIT,
  },
  datasetStorageRefs: {
    ids: [DATASET, STORAGE_REF],
    seed: document({
      datasetId: DATASET,
      endpointKey: STORAGE_ENDPOINT,
      role: "primary",
      availability: "available",
      verifiedAt: null,
      verifiedBy: null,
      verificationManifestId: null,
      validFrom: STORED_AT,
      validTo: null,
      relocatedFromRefId: null,
      lastSeenAt: STORED_AT,
      lastScanAt: STORED_AT,
      lastScanStatus: "ok",
      latestManifestId: MANIFEST,
      viewerSupport: [],
      viewerLinkTools: [],
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION_KEY, BY_LABORATORY_KEY, BY_REPLICATION, BY_LABORATORY],
  },
  datasetStorageRefLocation: {
    ids: [DATASET, STORAGE_REF],
    seed: document({ uri: "DemoStudy/flanker" }),
    subject: IN_UNIT,
  },
  datasetManifests: {
    ids: [DATASET, MANIFEST],
    seed: appendedDocument({
      datasetId: DATASET,
      kind: "listing",
      storageRefId: STORAGE_REF,
      listedAt: STORED_AT,
      origin: "scan",
      fileCount: 1,
      totalSizeBytes: 10,
      chunkCount: 1,
      expectedManifestId: null,
      counts: { present: 1 },
      checksumCount: 0,
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION, BY_LABORATORY],
  },
  datasetManifestFileChunks: {
    ids: [DATASET, MANIFEST, sequenceId(0)],
    seed: appendedDocument({
      datasetId: DATASET,
      manifestId: MANIFEST,
      index: 0,
      files: [{ relativePath: "sub-01/eeg/sub-01_task-flanker_eeg.eeg", sizeBytes: 10, status: "present" }],
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION, BY_LABORATORY],
  },
  datasetTransfers: {
    ids: [DATASET, autoId("stored transfer")],
    seed: document({
      datasetId: DATASET,
      fromRefId: STORAGE_REF,
      toRefId: autoId("destination ref"),
      status: "initiated",
      approval: "pending",
      reason: "A synthetic mirror.",
      initiatedBy: uidOfCaller("ownLead"),
      initiatedAt: STORED_AT,
      decidedBy: null,
      decidedAt: null,
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION_KEY, BY_LABORATORY_KEY, BY_REPLICATION, BY_LABORATORY],
  },
  datasetQcAssessments: {
    ids: [DATASET, autoId("stored assessment")],
    seed: appendedDocument({
      datasetId: DATASET,
      level: "dataset",
      assessedBy: uidOfCaller("ownCoordinator"),
      tool: "Synthetic pipeline",
      outcome: "pass",
      assessedAt: STORED_AT,
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION_KEY, BY_LABORATORY_KEY, BY_REPLICATION, BY_LABORATORY],
  },
  datasetAccessEvents: {
    ids: [DATASET, autoId("stored access event")],
    seed: appendedDocument({
      datasetId: DATASET,
      uid: uidOfCaller("ownLead"),
      action: "viewLocation",
      targetId: STORAGE_REF,
      ...UNIT_FIELDS,
    }),
    subject: IN_UNIT,
    listBy: [BY_REPLICATION, BY_LABORATORY],
  },
  datasetViewerLinks: {
    ids: [DATASET, autoId("stored viewer link")],
    seed: document({
      datasetId: DATASET,
      storageRefId: STORAGE_REF,
      tool: "electroTag",
      url: "https://viewer.example.org/synthetic",
    }),
    subject: IN_UNIT,
  },

  // Scientific outputs and governance.
  manuscripts: {
    ids: [MANUSCRIPT],
    seed: document({
      replicationId: OWN_REPLICATION,
      title: "A synthetic stage 1 registered report",
      kind: "stage1Rr",
      status: "planned",
      statusHistoryId: null,
      custom: {},
      scopeKeys: [REPLICATION_KEY],
    }),
    subject: IN_REPLICATION,
    create: {
      ids: [autoId("manuscriptNew")],
      data: () => ({
        replicationId: OWN_REPLICATION,
        title: "A synthetic data paper",
        kind: "dataPaper",
        status: "planned",
        statusHistoryId: null,
        custom: {},
        scopeKeys: [REPLICATION_KEY],
      }),
    },
    update: () => ({ journal: "Journal of Synthetic Results" }),
  },
  manuscriptEvents: {
    ids: [MANUSCRIPT, "event-1"],
    seed: document({
      manuscriptId: MANUSCRIPT,
      kind: "submission",
      occurredAt: EARLIER,
      documentLinkIds: [],
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [REPLICATION_KEY],
    }),
    subject: IN_REPLICATION,
    create: {
      ids: [MANUSCRIPT, autoId("eventNew")],
      data: () => ({
        manuscriptId: MANUSCRIPT,
        kind: "decision",
        outcome: "minorRevision",
        occurredAt: EARLIER,
        documentLinkIds: [],
        replicationId: OWN_REPLICATION,
        laboratoryId: null,
        scopeKeys: [REPLICATION_KEY],
      }),
    },
    update: () => ({ summary: "Submitted to the journal." }),
  },
  contributorTables: {
    ids: [CONTRIBUTOR_TABLE],
    seed: document({ replicationId: OWN_REPLICATION, sourceKey: SOURCE, scopeKeys: [REPLICATION_KEY] }),
    subject: IN_REPLICATION,
    listBy: [BY_REPLICATION, BY_REPLICATION_KEY],
    create: {
      ids: [autoId("tableNew")],
      data: () => ({
        replicationId: OWN_REPLICATION,
        sourceKey: SOURCE,
        isPublished: false,
        scopeKeys: [REPLICATION_KEY],
      }),
    },
    update: () => ({ isPublished: true, publicationUrl: "https://example.org/contributors" }),
  },
  contributors: {
    ids: [CONTRIBUTOR],
    seed: contributor(),
    subject: IN_REPLICATION,
    create: {
      ids: [autoId("contributorNew")],
      data: () => ({
        firstNameSource: "Example",
        surnameSource: "Contributor",
        creditRoles: {},
        reviewStatus: "needsReview",
        replicationId: OWN_REPLICATION,
        manuscriptId: null,
        contributorTableId: CONTRIBUTOR_TABLE,
        personId: null,
        scopeKeys: [REPLICATION_KEY],
      }),
    },
    update: () => ({ reviewStatus: "confirmed", personId: OWNER_PERSON }),
  },
  contributorContact: {
    ids: [CONTRIBUTOR],
    seed: document({ email: "synthetic.contributor@example.org", fundingStatement: "Funded by a synthetic grant." }),
    subject: IN_REPLICATION,
    create: { ids: [SECOND_CONTRIBUTOR], data: () => ({ email: "second.contributor@example.org" }) },
    update: () => ({ fundingStatement: "Funded by two synthetic grants." }),
  },
  documentLinks: {
    ids: ["link-1"],
    seed: document({
      ...entityReference,
      kind: "osf",
      url: "https://example.org/synthetic-project",
      accessStatus: "unknown",
      lastCheckedAt: null,
      restricted: false,
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
    }),
    subject: { ...IN_REPLICATION, scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY], memberVisible: true },
    listBy: [BY_MEMBERS_KEY, BY_REPLICATION_KEY],
    create: {
      ids: [autoId("linkNew")],
      data: () => ({
        ...entityReference,
        kind: "googleDoc",
        url: "https://example.org/synthetic-document",
        title: "Synthetic analysis plan",
        accessStatus: "unknown",
        lastCheckedAt: null,
        restricted: false,
        replicationId: OWN_REPLICATION,
        laboratoryId: null,
        scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
      }),
    },
    update: () => ({ title: "Synthetic project on a repository" }),
  },

  // Provenance, migration and integrations.
  sources: {
    ids: [SOURCE],
    seed: document({
      key: SOURCE,
      title: "Synthetic contributor sheet",
      kind: "googleSheet",
      authority: "historical",
      syncPolicy: "repeatable",
      accessStatus: "restricted",
      lastFetchedAt: null,
    }),
    subject: UNSCOPED,
  },
  sourceLocation: {
    ids: [SOURCE],
    seed: document({ url: "https://example.org/synthetic-sheet", externalId: "synthetic-external-id" }),
    subject: UNSCOPED,
  },
  sourceTabs: {
    ids: [SOURCE, sourceTabKey("Synthetic tab")],
    seed: document({
      sourceKey: SOURCE,
      tabKey: sourceTabKey("Synthetic tab"),
      name: "Synthetic tab",
      visibility: "visible",
      lastSeenAt: STORED_AT,
    }),
    subject: UNSCOPED,
  },
  importBatches: {
    ids: [BATCH],
    seed: document({
      sourceKey: SOURCE,
      mode: "apply",
      status: "applied",
      contentHash: SHA_256,
      startedBy: "system:import",
      startedAt: STORED_AT,
      finishedAt: STORED_AT,
      stats: { created: 1 },
    }),
    subject: UNSCOPED,
  },
  importBatchChanges: {
    ids: [BATCH, sequenceId(1)],
    seed: appendedDocument({
      batchId: BATCH,
      documentPath: `persons/${OWNER_PERSON}`,
      operation: "create",
      relation: "created",
      sourceRecordIds: [SOURCE_RECORD],
      before: null,
      after: { displayName: "Synthetic Owner" },
    }),
    subject: UNSCOPED,
  },
  importBatchChangeState: {
    ids: [BATCH, sequenceId(1)],
    seed: appendedDocument({ before: null, after: { genderSource: "synthetic value" } }),
    subject: UNSCOPED,
  },
  importBatchSeenRecords: {
    ids: [BATCH, sequenceId(0)],
    seed: appendedDocument({ batchId: BATCH, index: 0, sourceRecordIds: [SOURCE_RECORD] }),
    subject: UNSCOPED,
  },
  importBatchLog: {
    ids: [BATCH, sequenceId(1)],
    seed: appendedDocument({ batchId: BATCH, level: "info", message: "One row read." }),
    subject: UNSCOPED,
  },
  sourceRecords: {
    ids: [SOURCE_RECORD],
    seed: document({
      sourceKey: SOURCE,
      tabKey: sourceTabKey("Synthetic tab"),
      rowKey: "synthetic-row-1",
      raw: { Name: "Synthetic Owner", Laboratory: "Synthetic Laboratory One" },
      rawHash: SHORT_HASH,
      observedOn: "2026-01-01",
      firstSeenBatchId: BATCH,
      lastSeenBatchId: BATCH,
      supersededById: null,
    }),
    subject: UNSCOPED,
  },
  sourceRecordSpecial: {
    ids: [SOURCE_RECORD],
    seed: document({ sourceRecordId: SOURCE_RECORD, raw: { Gender: "synthetic value" } }),
    subject: UNSCOPED,
  },
  sourceRecordRawChunks: {
    ids: [SOURCE_RECORD, sequenceId(0)],
    seed: appendedDocument({ sourceRecordId: SOURCE_RECORD, index: 0, raw: { Notes: "Synthetic continuation." } }),
    subject: UNSCOPED,
  },
  reconciliationItems: {
    ids: ["fingerprint-1"],
    seed: document({
      kind: "valueConflict",
      entityRefs: [{ entityType: "person", entityId: OWNER_PERSON }],
      field: "displayName",
      candidates: [{ key: "a", valueSource: "Synthetic Owner", sourceRecordId: SOURCE_RECORD }],
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      batchId: BATCH,
    }),
    subject: UNSCOPED,
  },
  integrationMappings: {
    ids: [integrationMappingId("quire", "task", "synthetic-external-task")],
    seed: document({ entityType: "task", entityId: "task-1", system: "quire", externalId: "synthetic-external-task" }),
    subject: UNSCOPED,
  },
  integrationConnections: {
    ids: ["googleSheets"],
    seed: document({
      system: "googleSheets",
      status: "dryRun",
      adapter: "fake",
      identity: "google-workspace-fake@example.org",
      config: {},
      credentialRef: "SYNTHETIC_SECRET_NAME",
      lastSuccessAt: null,
      lastErrorAt: null,
    }),
    subject: UNSCOPED,
  },
  driveChannels: {
    ids: ["synthetic-channel"],
    seed: document({
      channelId: "synthetic-channel",
      resourceId: "synthetic-resource",
      tokenHash: SHA_256,
      expiresAt: STORED_AT,
      lastMessageNumber: 1,
      lastMessageAt: null,
      stoppedAt: null,
    }),
    subject: UNSCOPED,
  },
  syncMappings: {
    ids: [SYNC_MAPPING],
    seed: document({
      name: "Synthetic directory",
      connectionId: "googleSheets",
      sourceKey: SOURCE,
      tabKey: sourceTabKey("Synthetic tab"),
      collectionKey: "core:laboratories",
      keyStrategy: "keyColumn",
      keyColumn: "Laboratory key",
      columnMap: [{ field: "city", column: "City", direction: "bidirectional" }],
      sheetOnlyRows: "propose",
      appOnlyRecords: "append",
      cellCeiling: 100,
      mode: "dryRun",
      status: "active",
      approvedBy: null,
      approvedAt: null,
      lastRunId: null,
      lastRunAt: null,
      lastSuccessAt: null,
    }),
    subject: UNSCOPED,
  },
  syncMappingCellState: {
    ids: [SYNC_MAPPING, syncCellStateId(OWN_LABORATORY, "city")],
    seed: document({
      mappingId: SYNC_MAPPING,
      recordId: OWN_LABORATORY,
      rowKey: "synthetic-lab-one",
      field: "city",
      appValue: "Exampleton",
      sheetValue: "Exampleton",
      syncedAt: STORED_AT,
      unstable: false,
    }),
    subject: UNSCOPED,
  },
  syncLeases: {
    ids: [SOURCE],
    seed: document({ sourceKey: SOURCE, runId: "run-1", expiresAt: STORED_AT }),
    subject: UNSCOPED,
  },
  syncRuns: {
    ids: ["run-1"],
    seed: document({
      kind: "sheetSync",
      mappingId: SYNC_MAPPING,
      mode: "dryRun",
      trigger: "manual",
      status: "succeeded",
      attempts: 1,
      maxAttempts: 6,
      nextAttemptAt: null,
      requestedBy: "system:test",
      queuedAt: STORED_AT,
      startedAt: STORED_AT,
      finishedAt: STORED_AT,
      stats: { cellsToSheet: 0 },
      plan: [
        { action: "writeApp", rowKey: "synthetic-lab-one", field: "city", before: "Exampleton", after: "Sampleville" },
      ],
    }),
    subject: UNSCOPED,
  },
  syncConflicts: {
    ids: ["conflict-1"],
    seed: document({
      origin: "sheet",
      mappingId: SYNC_MAPPING,
      entityType: "laboratory",
      entityId: OWN_LABORATORY,
      recordId: OWN_LABORATORY,
      rowKey: "synthetic-lab-one",
      field: "city",
      label: "City of Synthetic Laboratory One",
      baseValue: "Exampleton",
      appValue: "Sampleville",
      sheetValue: "Testbury",
      detectedAt: STORED_AT,
      lastSeenAt: STORED_AT,
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    }),
    subject: UNSCOPED,
  },
  syncReviewItems: {
    ids: ["review-1"],
    seed: document({
      mappingId: SYNC_MAPPING,
      kind: "missingRow",
      rowKey: "synthetic-lab-one",
      detail: "The row has gone from the sheet.",
      status: "open",
      detectedAt: STORED_AT,
      lastSeenAt: STORED_AT,
      resolvedBy: null,
      resolvedAt: null,
    }),
    subject: UNSCOPED,
  },
  documentTemplates: {
    ids: ["synthetic-template"],
    seed: document({
      key: "synthetic-template",
      name: "Synthetic progress",
      kind: "replicationProgress",
      entityType: "replication",
      externalDocumentId: "synthetic-template-document",
      targetFolderId: "synthetic-folder",
      managedSections: ["overview", "laboratories"],
      enabled: true,
      mode: "dryRun",
      approvedBy: null,
      approvedAt: null,
    }),
    subject: UNSCOPED,
  },
  generatedDocuments: {
    ids: [generatedDocumentId("synthetic-template", "replication", OWN_REPLICATION)],
    seed: document({
      templateKey: "synthetic-template",
      ...entityReference,
      title: "Synthetic progress of the study",
      externalDocumentId: "synthetic-generated-document",
      url: "https://docs.google.com/document/d/synthetic-generated-document/edit",
      managedSections: {
        overview: { rangeName: "portal:overview", status: "current", textHash: SHORT_HASH, generatedAt: STORED_AT },
      },
      lastGeneratedAt: STORED_AT,
      status: "current",
      restricted: false,
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
    }),
    subject: { ...IN_REPLICATION, scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY], memberVisible: true },
    listBy: [BY_MEMBERS_KEY, BY_REPLICATION_KEY],
  },

  // Workspace.
  pages: {
    ids: [PAGE],
    seed: document({
      parentPageId: null,
      ancestorPageIds: [],
      entityType: "replication",
      entityId: OWN_REPLICATION,
      kind: "entity",
      title: "Notes on the synthetic study",
      order: "i",
      isTemplate: false,
      accessMode: "inherit",
      ...PAGE_SCOPE_FIELDS,
      levelKeys: PAGE_LEVELS,
      contentHead: CONTENT_HEAD,
      mentionUids: [],
      tagIds: [],
      lastEditedBy: null,
    }),
    subject: ON_PAGE,
    listBy: [BY_MEMBERS_KEY],
    update: () => ({ title: "Notes on the synthetic study, renamed", icon: "🧠" }),
  },
  pageContent: {
    ids: [PAGE, pageContentChunkId(0, 0)],
    // A chunk of a generation before the one the page names, which a compaction removes.
    seed: appendedDocument({ pageId: PAGE, generation: 0, index: 0, snapshot: yjsBytes() }),
    subject: ON_PAGE,
    create: {
      ids: [PAGE, pageContentChunkId(2, 0)],
      data: () => ({ pageId: PAGE, generation: 2, index: 0, snapshot: yjsBytes() }),
    },
  },
  pageUpdates: {
    ids: [PAGE, autoId("stored update")],
    seed: appendedDocument({
      pageId: PAGE,
      updateId: "storedupdate",
      index: 0,
      count: 1,
      update: yjsBytes(),
      uid: uidOfCaller("ownTeam"),
      clientId: 7,
    }),
    subject: ON_PAGE,
    create: {
      ids: [PAGE, autoId("new update")],
      data: (uid) => ({
        pageId: PAGE,
        updateId: "newupdate",
        index: 0,
        count: 1,
        update: yjsBytes(),
        uid,
        clientId: 8,
      }),
    },
    remove: {
      how: "in a compaction that moves the page to a later generation",
      touches: [PAGE_PATH],
      run: (db, uid) => {
        const batch = writeBatch(db);
        // The delete goes first, so that the rules decide it even where they refuse the move.
        batch.delete(doc(db, `${PAGE_PATH}/updates/${autoId("stored update")}`));
        batch.update(doc(db, PAGE_PATH), {
          contentHead: {
            generation: COMPACTED_GENERATION,
            chunkCount: 1,
            byteLength: 2,
            stateVector: yjsBytes(),
            compactedAt: serverTimestamp(),
          },
          updatedAt: serverTimestamp(),
          updatedBy: uid,
          writeContext: userWriteContext(),
        });
        return batch.commit();
      },
    },
  },
  pageVersions: {
    ids: [PAGE, VERSION],
    seed: appendedDocument({
      pageId: PAGE,
      label: "Before the data freeze",
      kind: "manual",
      chunkCount: 1,
      byteLength: 2,
    }),
    subject: ON_PAGE,
  },
  pageVersionChunks: {
    ids: [PAGE, VERSION, sequenceId(0)],
    seed: appendedDocument({ pageId: PAGE, versionId: VERSION, index: 0, snapshot: yjsBytes() }),
    subject: ON_PAGE,
  },
  pagePermissions: {
    ids: [PAGE, pagePermissionId("user", MEMBER_UID)],
    seed: document({ pageId: PAGE, principalType: "user", principalId: MEMBER_UID, level: "view" }),
    subject: ON_PAGE,
  },
  pagePresence: {
    ids: [PAGE, pagePresenceId(OWNER_UID, STORED_TAB)],
    seed: document({
      pageId: PAGE,
      uid: OWNER_UID,
      tab: STORED_TAB,
      clientId: 7,
      clock: 1,
      state: JSON.stringify({ user: { name: "Owner Example", color: "var(--accent)" } }),
    }),
    subject: { ...ON_PAGE, ownerUid: OWNER_UID },
    create: {
      ids: [PAGE, pagePresenceId(OWNER_UID, NEW_TAB)],
      data: (uid) => ({
        pageId: PAGE,
        uid,
        tab: NEW_TAB,
        clientId: 8,
        clock: 1,
        state: JSON.stringify({ user: { name: "Owner Example", color: "var(--accent)" } }),
      }),
    },
    update: () => ({ clock: 2, state: JSON.stringify({ user: { name: "Owner Example" }, cursor: null }) }),
  },
  threads: {
    ids: [THREAD],
    seed: document({
      targetType: "page",
      targetId: PAGE,
      anchor: { blockId: "block-1", from: '{"type":null}', to: '{"type":null}', quote: "below ten kilo-ohm" },
      restricted: false,
      ...PAGE_SCOPE_FIELDS,
      resolvedAt: null,
      resolvedBy: null,
    }),
    subject: ON_PAGE,
    listBy: [{ ...BY_MEMBERS_KEY, also: [["targetId", "==", PAGE]] }],
    create: {
      ids: [autoId("new thread")],
      data: () => ({
        targetType: "page",
        targetId: PAGE,
        anchor: { blockId: "block-2", quote: "impedance" },
        restricted: false,
        ...PAGE_SCOPE_FIELDS,
        resolvedAt: null,
        resolvedBy: null,
      }),
    },
    update: (uid) => ({ resolvedAt: serverTimestamp(), resolvedBy: uid }),
  },
  threadComments: {
    ids: [THREAD, autoId("stored comment")],
    seed: document({
      threadId: THREAD,
      authorUid: COMMENT_AUTHOR_UID,
      body: "A synthetic comment about the impedance.",
      mentionUids: [],
      editedAt: null,
      deletedAt: null,
      ...PAGE_SCOPE_FIELDS,
    }),
    subject: { ...ON_PAGE, authorUid: COMMENT_AUTHOR_UID },
    listBy: [BY_MEMBERS_KEY],
    create: {
      ids: [THREAD, autoId("new comment")],
      data: (uid) => ({
        threadId: THREAD,
        authorUid: uid,
        body: "A second synthetic comment.",
        mentionUids: [MEMBER_UID],
        editedAt: null,
        deletedAt: null,
        ...PAGE_SCOPE_FIELDS,
      }),
    },
    update: () => ({ body: "The synthetic comment, edited.", editedAt: serverTimestamp() }),
  },

  // Databases, custom properties, views and dashboards.
  databases: {
    ids: [DATABASE],
    seed: document({
      name: "Synthetic sites",
      parentPageId: PAGE,
      isTemplate: false,
      properties: { status: STATUS_PROPERTY },
      scopeKeys: PAGE_SCOPE,
      levelKeys: PAGE_LEVELS,
    }),
    subject: ON_PAGE,
    listBy: [BY_MEMBERS_KEY],
    update: () => ({ name: "Synthetic sites, renamed", icon: "🧪", description: "Sites of the synthetic study." }),
  },
  databaseRows: {
    ids: [DATABASE, autoId("stored row")],
    seed: document({
      databaseId: DATABASE,
      title: "Synthetic site one",
      values: { status: "active" },
      order: "i",
      pageId: null,
      tagIds: [],
    }),
    subject: ON_PAGE,
  },
  collectionSchemas: {
    ids: ["core:participations"],
    seed: document({
      collectionKey: "core:participations",
      properties: {
        siteNote: {
          ...STATUS_PROPERTY,
          key: "siteNote",
          name: "Site note",
          type: "text",
          config: {},
          audience: "member",
        },
      },
    }),
    subject: UNSCOPED,
  },
  replicationCustom: {
    ids: [OWN_REPLICATION],
    seed: document({ custom: { budgetCode: "SYN-001" } }),
    subject: IN_REPLICATION,
  },
  laboratoryCustom: {
    ids: [OWN_LABORATORY],
    seed: document({ custom: { roomNumber: "B12" } }),
    subject: IN_LABORATORY,
  },
  participationCustom: {
    ids: [OWN_PARTICIPATION],
    seed: document({ custom: { ethicsContact: "Synthetic Ethics Office" } }),
    subject: IN_UNIT,
  },
  personCustom: {
    ids: [OWNER_PERSON],
    seed: document({ custom: { telephone: "+44 0000 000000" } }),
    subject: { ownerUid: OWNER_UID, replicationId: OWN_REPLICATION, laboratoryId: OWN_LABORATORY },
  },
  views: {
    ids: [autoId("stored view")],
    seed: document({
      collectionKey: "core:participations",
      name: "My participations",
      type: "table",
      config: { sorts: [{ property: "status", direction: "ascending" }] },
      ownerUid: OWNER_UID,
      isShared: false,
      pageId: null,
      order: "i",
    }),
    subject: { ownerUid: OWNER_UID, memberVisible: false },
    listBy: [
      { where: ["ownerUid", "==", OWNER_UID], proves: { ownerUid: OWNER_UID } },
      {
        where: ["isShared", "==", true],
        also: [["collectionKey", "==", "core:participations"]],
        proves: { memberVisible: true },
      },
    ],
  },
  progressUpdates: {
    ids: [autoId("stored progress update")],
    seed: appendedDocument({
      entityType: "replication",
      entityId: OWN_REPLICATION,
      authorUid: uidOfCaller("ownTeam"),
      body: "Piloting finished at the synthetic laboratory.",
      mentionUids: [],
      pinned: true,
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
    }),
    subject: UNSCOPED,
  },
  dashboards: {
    ids: [autoId("stored dashboard")],
    seed: document({
      scopeType: "user",
      scopeId: OWNER_UID,
      ownerUid: OWNER_UID,
      name: "My dashboard",
      widgets: { notes: { type: "note", config: { title: "Notes", text: "Synthetic note." }, x: 0, y: 0, w: 4, h: 2 } },
      replicationId: null,
      laboratoryId: null,
      scopeKeys: [`user:${OWNER_UID}`],
    }),
    subject: { ownerUid: OWNER_UID, memberVisible: false },
    listBy: [
      { where: ["ownerUid", "==", OWNER_UID], proves: { ownerUid: OWNER_UID } },
      { where: ["ownerUid", "==", null], proves: { memberVisible: true } },
    ],
  },

  // Events, audit, automation, notifications and search.
  activity: {
    ids: ["event-activity-1"],
    seed: appendedDocument({
      actorUid: uidOfCaller("ownTeam"),
      action: "page.edited",
      entityType: "page",
      entityId: PAGE,
      title: "Notes on the synthetic study",
      changedFields: ["content"],
      ...PAGE_SCOPE_FIELDS,
    }),
    subject: ON_PAGE,
    listBy: [BY_MEMBERS_KEY],
  },
  searchIndex: {
    ids: [searchIndexId("page", PAGE, 0)],
    seed: document({
      entityType: "page",
      entityId: PAGE,
      part: 0,
      title: "Notes on the synthetic study",
      tokens: ["notes", "synthetic", "study"],
      kind: "entity",
      ...PAGE_SCOPE_FIELDS,
    }),
    subject: UNSCOPED,
  },
  auditEvents: {
    ids: ["event-1"],
    seed: appendedDocument({
      actorUid: OWNER_UID,
      actorKind: "user",
      action: "account.created",
      documentPath: `users/${OWNER_UID}`,
      entityType: "user",
      entityId: OWNER_UID,
      changes: [],
      context: {
        origin: "user",
        depth: 0,
        correlationId: null,
        causationId: null,
        requestId: null,
        ipHash: null,
        userAgent: null,
      },
    }),
    subject: OWNED,
  },
  mail: {
    ids: ["mail-1"],
    seed: document({
      toAddress: "owner.account@example.org",
      subject: "Synthetic message",
      textBody: "A message that exists only in tests.",
      templateKey: "claimDecision",
      status: "queued",
      attempts: 0,
      sentAt: null,
    }),
    subject: OWNED,
  },
  integrityReports: {
    ids: [INTEGRITY_RUN],
    seed: document({
      startedAt: STORED_AT,
      finishedAt: STORED_AT,
      status: "completed",
      counts: { orphanedReference: 1 },
    }),
    subject: UNSCOPED,
  },
  integrityReportFindings: {
    ids: [INTEGRITY_RUN, sequenceId(1)],
    seed: appendedDocument({
      runId: INTEGRITY_RUN,
      check: "orphanedReference",
      documentPath: `participations/${OWN_PARTICIPATION}`,
      field: "protocolId",
    }),
    subject: UNSCOPED,
  },
  systemSettings: {
    ids: [],
    seed: document({ featureFlags: {}, maintenanceMode: false, listLimit: 200, retention: { mail: 90 } }),
    subject: UNSCOPED,
  },
};

/**
 * Documents that the fixtures refer to and that are no fixture themselves: the second
 * replication and laboratory, a participation and a contributor without private documents, and
 * the person of the account `member`.
 */
export const SUPPORTING_DOCUMENTS: Readonly<Record<string, Record<string, unknown>>> = {
  // The chunk of the generation that the stored page names, and of the generation that the
  // compaction of the matrix moves it to.
  [`${PAGE_PATH}/content/${pageContentChunkId(CONTENT_HEAD.generation, 0)}`]: appendedDocument({
    pageId: PAGE,
    generation: CONTENT_HEAD.generation,
    index: 0,
    snapshot: yjsBytes(),
  }),
  [`${PAGE_PATH}/content/${pageContentChunkId(COMPACTED_GENERATION, 0)}`]: appendedDocument({
    pageId: PAGE,
    generation: COMPACTED_GENERATION,
    index: 0,
    snapshot: yjsBytes(),
  }),
  [`replications/${OTHER_REPLICATION}`]: replication(OTHER_REPLICATION),
  [`laboratories/${OTHER_LABORATORY}`]: laboratory("Synthetic Laboratory Two", "synthetic-laboratory-two"),
  [`participations/${SECOND_PARTICIPATION}`]: participation(OWN_REPLICATION, OTHER_LABORATORY),
  [`persons/${MEMBER_PERSON}`]: person("Synthetic Member", "synthetic-member", MEMBER_UID),
  [`contributors/${SECOND_CONTRIBUTOR}`]: contributor(),
  [`replications/${OWN_REPLICATION}/protocolVersions/${APPROVED_VERSION}`]: document({
    replicationId: OWN_REPLICATION,
    protocolId: PROTOCOL,
    versionLabel: "0.9",
    status: "approved",
    approvedBy: uidOfCaller("ownLead"),
    approvedAt: STORED_AT,
  }),
};
