// Contracts of the callable functions. The web client and the functions both import these, so
// a function's name, input and output are declared once and cannot drift apart.
//
// Every function below requires a signed-in caller whose account is in good standing. Where a
// row of a table names a capability, the function reads the caller's access document and asks
// `can` for it, and it also asks for the caller's second factor wherever that access document
// says one is required. A time crosses the wire as an ISO 8601 text with an offset.
import { grantableCapabilitySchema, roleSchema, roleScopeTypeSchema } from "./capabilities";
import { hasControlCharacter, storagePathProblem } from "./datasets/paths";
import { DOCUMENT_TEMPLATE_KINDS } from "./docs/templates";
import { entityTypeSchema } from "./entities";
import { hasValidOrcidCheckDigit } from "./identifiers";
import { nameFold } from "./ids";
import { ORDER_KEY_MAX_LENGTH } from "./order";
import { forecastAssumptionsSchema } from "./recruitment-forecast";
import {
  countryCodeSchema,
  idListSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  mapKeySchema,
  orcidSchema,
  shortTextSchema,
  uidSchema,
  urlSchema,
} from "./schemas/base";
import {
  bidsConversionStatusSchema,
  bidsStatusSchema,
  DATASET_WORKFLOW_MAX_STATES,
  datasetModalitySchema,
  datasetWorkflowStateSchema,
  manifestFileStatusSchema,
  manifestKindSchema,
  qcExclusionSchema,
  qcLevelSchema,
  qcOutcomeSchema,
  qcStatusSchema,
  storageAllowedPrefixesSchema,
  storageEndpointStatusSchema,
  storageProtocolSchema,
  storageRefRoleSchema,
  storageScanModeSchema,
  storageScanStatusSchema,
  storageSecretNameSchema,
  transferApprovalSchema,
  transferStatusSchema,
  viewerToolSchema,
} from "./schemas/datasets";
import {
  claimMatchBasisSchema,
  claimStatusSchema,
  correctionRequestStatusSchema,
  emailKindSchema,
  labClaimRoleSchema,
  roleAssignmentStatusSchema,
  userStatusSchema,
} from "./schemas/identity";
import { participationStatusSchema } from "./schemas/participation";
import { laboratoryMemberRoleSchema, laboratoryMemberStatusSchema } from "./schemas/programme";
import {
  GOOGLE_SYSTEMS,
  integrationConnectionStatusSchema,
  reconciliationStatusSchema,
  secretNameSchema,
} from "./schemas/provenance";
import { reportEntryKindSchema, reportKindSchema } from "./schemas/recruitment";
import {
  recruitmentBasisSchema,
  recruitmentModalitySchema,
  replicationMembershipRoleSchema,
  reviewStatusSchema,
  studyKeySchema,
} from "./schemas/replications";
import { auditActionSchema, auditActorKindSchema } from "./schemas/system";
import {
  recurrenceRuleSchema,
  reminderChannelSchema,
  reminderEntityTypeSchema,
  taskDependencyKindSchema,
  taskKindSchema,
  taskListKindSchema,
  taskParticipantRoleSchema,
  taskPrioritySchema,
  taskScopeTypeSchema,
} from "./schemas/tasks";
import {
  PROGRESS_UPDATE_MAX_LENGTH,
  pageAccessModeSchema,
  pageLevelSchema,
  progressUpdateEntityTypeSchema,
  propertyAudienceSchema,
  propertyTypeSchema,
  viewTypeSchema,
} from "./schemas/workspace";
import { ROW_POLICIES, SYNC_DIRECTIONS } from "./sync/planner";
import { SYNC_TARGET_KEYS, type SyncTargetKey } from "./sync/targets";
import { dashboardWidgetInputSchema } from "./views/dashboard";
import { propertyConfigSchema, viewCollectionKeySchema, viewConfigSchema, viewScopeSchema } from "./views/model";
import { z } from "./zod";

export interface CallableContract<Input extends z.ZodType = z.ZodType, Output extends z.ZodType = z.ZodType> {
  /** Exported name of the function, which is also the name the client calls. */
  readonly name: string;
  readonly input: Input;
  readonly output: Output;
}

export type CallableInput<C extends CallableContract> = z.input<C["input"]>;
export type CallableOutput<C extends CallableContract> = z.output<C["output"]>;

/**
 * Registers the caller's account after sign-in and reports what the account is linked to.
 * Takes no arguments: everything it uses comes from the caller's own sign-in token.
 */
export const sessionStartContract = {
  name: "sessionStart",
  input: z.strictObject({}),
  output: z.strictObject({
    member: z.boolean(),
    personId: z.string().min(1).nullable(),
  }),
} as const satisfies CallableContract;

export type SessionStartOutput = CallableOutput<typeof sessionStartContract>;

/** What takes no arguments: everything such a function uses comes from the caller's own sign-in token. */
const noArguments = z.strictObject({});

/** A reason or a note that a person types: trimmed, never empty, 2,000 characters at most. */
const reasonSchema = z.string().trim().min(1).max(2_000);

/** An instant as ISO 8601 text with an offset, for example `2027-01-31T12:00:00Z`. */
const instantSchema = z.iso.datetime({ offset: true });

/**
 * Links the caller's account to the person whose record carries the caller's verified email
 * address (decision D-005). It takes no arguments, so nobody can ask about another address.
 *
 * | Status          | Meaning                                                                      |
 * |-----------------|------------------------------------------------------------------------------|
 * | `linked`        | The account is linked to `personId`. A repeated call gives the same answer   |
 * | `pendingReview` | A reviewer has to decide. The answer never says why                          |
 * | `rejected`      | A reviewer has decided against the claim. `requestAccess` asks again         |
 * | `noMatch`       | No person carries the address. Nothing was changed. `requestAccess` asks for access |
 */
export const claimProfileContract = {
  name: "claimProfile",
  input: noArguments,
  output: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("linked"), personId: idSchema }),
    /** `statementGiven`: whether the caller has told the reviewer about themselves with `requestAccess`. */
    z.strictObject({ status: z.literal("pendingReview"), statementGiven: z.boolean() }),
    z.strictObject({ status: z.literal("rejected") }),
    z.strictObject({ status: z.literal("noMatch") }),
  ]),
} as const satisfies CallableContract;
export type ClaimProfileOutput = CallableOutput<typeof claimProfileContract>;

/**
 * Asks a reviewer for access on behalf of a signed-in caller whose address matched nobody. One
 * request may be open per account. A caller whose claim a match sent to review may send the
 * same statement once, to help the reviewer. The answer is always `pendingReview`.
 */
export const requestAccessContract = {
  name: "requestAccess",
  input: z.strictObject({
    /** The name the caller states. It identifies nobody until a reviewer has decided. */
    statedName: z.string().trim().min(1).max(200),
    affiliation: z.string().trim().min(1).max(300),
    message: z.string().trim().min(1).max(2_000),
  }),
  output: z.strictObject({ status: z.literal("pendingReview") }),
} as const satisfies CallableContract;

const claimCandidateSchema = z.strictObject({
  personId: idSchema,
  displayName: shortTextSchema,
  affiliationSummary: shortTextSchema.nullable(),
  /** Whether another account has claimed the person already. */
  claimed: z.boolean(),
  /** How the person's record holds the claimant's address, or null where it does not hold it. */
  addressKind: emailKindSchema.nullable(),
  institutionId: idSchema.nullable(),
  laboratoryIds: idListSchema,
  replicationIds: idListSchema,
});

/**
 * Why a claim waits for a reviewer, as the claim function recorded it.
 *
 * | Reason               | The claimant's verified address                                  |
 * |----------------------|------------------------------------------------------------------|
 * | `severalCandidates`  | Is held by more than one person                                  |
 * | `notClaimEligible`   | Is held by one person in a way that no claim may rest on         |
 * | `addressNotOnRecord` | Is in the index, and the person's contact document lacks it      |
 * | `personUnavailable`  | Belongs to a person who is missing or archived                   |
 * | `alreadyClaimed`     | Belongs to a person whom another account has claimed             |
 * | `requestedAccess`    | Matched nobody, and the claimant asked for access                |
 */
export const claimReviewReasonSchema = z.enum([
  "severalCandidates",
  "notClaimEligible",
  "addressNotOnRecord",
  "personUnavailable",
  "alreadyClaimed",
  "requestedAccess",
]);
export type ClaimReviewReason = z.output<typeof claimReviewReasonSchema>;

/**
 * Lists account claims for reviewers, oldest first. Capability: `claims.review`. No security
 * rule lets a reviewer list claims, so this function is the review queue.
 */
export const listAccountClaimsContract = {
  name: "listAccountClaims",
  input: z.strictObject({
    status: claimStatusSchema.default("pendingReview"),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  output: z.strictObject({
    claims: z
      .array(
        z.strictObject({
          uid: uidSchema,
          status: claimStatusSchema,
          submittedAt: instantSchema,
          matchBasis: claimMatchBasisSchema,
          /** The verified sign-in address of the claimant, which a reviewer needs to decide. */
          emailLower: z.string().max(320),
          /** The name the account gives itself. It is self-asserted. */
          displayName: z.string().nullable(),
          /** The person the claim is approved for, once it is. */
          personId: idSchema.nullable(),
          /** Why the claim waits for a reviewer. Null for a claim that is decided. */
          reviewReason: claimReviewReasonSchema.nullable(),
          candidates: z.array(claimCandidateSchema).max(50),
          /** What the claimant wrote, with `requestAccess`, to ask for access or to help a reviewer. */
          request: z.strictObject({ statedName: z.string(), affiliation: z.string(), message: z.string() }).nullable(),
        }),
      )
      .max(100),
  }),
} as const satisfies CallableContract;
export type ListAccountClaimsOutput = CallableOutput<typeof listAccountClaimsContract>;

/**
 * Decides a claim that awaits review. Capability: `claims.review`. An approval links the
 * account to the chosen person exactly as a match would, and is refused for a person whom
 * another account has claimed. Nobody decides the claim of their own account, and a link to a
 * person who is not among the claim's candidates is for programme administrators only.
 * `approveAsNewMember` admits someone whom no record names yet: it creates the person, live,
 * with the name and affiliation the reviewer confirms, and links the account in the same
 * transaction. It needs `people.manage` as well.
 */
export const reviewAccountClaimContract = {
  name: "reviewAccountClaim",
  input: z.discriminatedUnion("decision", [
    z.strictObject({
      uid: uidSchema,
      decision: z.literal("approve"),
      personId: idSchema,
      note: reasonSchema.exactOptional(),
    }),
    z.strictObject({
      uid: uidSchema,
      decision: z.literal("approveAsNewMember"),
      displayName: z.string().trim().min(1).max(LIMITS.shortText),
      affiliation: z.string().trim().min(1).max(LIMITS.shortText).exactOptional(),
      note: reasonSchema.exactOptional(),
    }),
    z.strictObject({ uid: uidSchema, decision: z.literal("reject"), note: reasonSchema }),
  ]),
  output: z.strictObject({
    status: claimStatusSchema.extract(["approved", "rejected"]),
    personId: idSchema.nullable(),
  }),
} as const satisfies CallableContract;

/**
 * Reverses a wrong link between an account and a person, and revokes the role assignments
 * that the claim created. Capability: `roles.manage`.
 */
export const unlinkAccountClaimContract = {
  name: "unlinkAccountClaim",
  input: z.strictObject({ uid: uidSchema, reason: reasonSchema }),
  output: z.strictObject({ personId: idSchema, revokedRoleAssignments: z.number().int().min(0) }),
} as const satisfies CallableContract;

/**
 * Grants, approves or revokes a role assignment. Capability: `roles.manage`.
 *
 * | Action    | Effect                                                                           |
 * |-----------|----------------------------------------------------------------------------------|
 * | `grant`   | The assignment of the role to the account for the scope becomes active           |
 * | `approve` | An assignment that awaits approval becomes active                                |
 * | `revoke`  | An active or pending assignment is revoked, with a reason                        |
 *
 * Only a programme administrator changes a programme role (`programme_admin` or `core_team`).
 * A caller never changes an assignment of `programme_admin` to their own account, such an
 * assignment never carries an expiry time, and the last active programme administrator is
 * never revoked.
 */
export const setRoleAssignmentContract = {
  name: "setRoleAssignment",
  input: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("grant"),
      uid: uidSchema,
      role: roleSchema,
      scopeType: roleScopeTypeSchema,
      /** The programme key, a study identifier, a laboratory identifier or a group key. */
      scopeId: idSchema,
      reason: reasonSchema.exactOptional(),
      /** When the assignment ends by itself. Null or absent for one that does not. */
      expiresAt: instantSchema.nullable().exactOptional(),
    }),
    z.strictObject({ action: z.literal("approve"), assignmentId: idSchema }),
    z.strictObject({ action: z.literal("revoke"), assignmentId: idSchema, reason: reasonSchema }),
  ]),
  output: z.strictObject({ assignmentId: idSchema, status: roleAssignmentStatusSchema }),
} as const satisfies CallableContract;

/**
 * Grants a named capability to an account, or revokes the grant. Capability: `roles.manage`.
 * A grant of `demographics.read` must carry an expiry time. Nobody grants to their own account,
 * and only a programme administrator grants or revokes a sensitive capability.
 */
export const setCapabilityGrantContract = {
  name: "setCapabilityGrant",
  input: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("grant"),
      uid: uidSchema,
      capability: grantableCapabilitySchema,
      reason: reasonSchema,
      expiresAt: instantSchema.nullable().exactOptional(),
    }),
    z.strictObject({
      action: z.literal("revoke"),
      uid: uidSchema,
      capability: grantableCapabilitySchema,
      reason: reasonSchema,
    }),
  ]),
  output: z.strictObject({ grantId: idSchema, active: z.boolean() }),
} as const satisfies CallableContract;

/** The roles whose capabilities an override can change: every role but the two that take none. */
export const OVERRIDABLE_ROLES = ["core_team", "replication_lead", "lab_coordinator", "lab_member"] as const;

/**
 * Sets or clears one override of the capability matrix. For programme administrators who hold
 * `roles.manage`. `allowed` null clears the override, so the default of the matrix applies again.
 */
export const setRoleCapabilityOverrideContract = {
  name: "setRoleCapabilityOverride",
  input: z.strictObject({
    role: z.enum(OVERRIDABLE_ROLES),
    capability: grantableCapabilitySchema,
    allowed: z.boolean().nullable(),
  }),
  output: z.strictObject({
    role: z.enum(OVERRIDABLE_ROLES),
    /** The overrides of the role after the change, keyed by capability name. */
    overrides: z.partialRecord(grantableCapabilitySchema, z.boolean()),
  }),
} as const satisfies CallableContract;

/**
 * Suspends an account or lifts its suspension. Capability: `users.suspend`. A caller never
 * suspends their own account, the last active programme administrator is never suspended, and
 * only a programme administrator suspends or reinstates programme staff.
 */
export const setUserStatusContract = {
  name: "setUserStatus",
  input: z.strictObject({ uid: uidSchema, status: userStatusSchema, reason: reasonSchema }),
  output: z.strictObject({ uid: uidSchema, status: userStatusSchema }),
} as const satisfies CallableContract;

/** A name that a person types: trimmed, and holding at least one letter or digit, which its name key needs. */
const organisationNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.shortText)
  .refine((name) => nameFold(name) !== "", { error: "The name needs at least one letter or digit" });

/** An optional text that a person types: trimmed, and absent rather than empty. */
const optionalTextSchema = z.string().trim().min(1).max(LIMITS.shortText).exactOptional();

/**
 * The institution of a laboratory that is registered or created: one that exists, or a new one
 * with its country and city, which is created with the laboratory.
 */
export const institutionChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("existing"), institutionId: idSchema }),
  z.strictObject({
    kind: z.literal("new"),
    name: organisationNameSchema,
    countryCode: countryCodeSchema,
    city: z.string().trim().min(1).max(LIMITS.shortText),
  }),
]);
export type InstitutionChoice = z.output<typeof institutionChoiceSchema>;

/** A laboratory as a member registers it or an administrator creates it. */
export const laboratoryInputSchema = z.strictObject({
  name: organisationNameSchema,
  institution: institutionChoiceSchema,
  department: optionalTextSchema,
  website: urlSchema.exactOptional(),
});
export type LaboratoryInput = z.output<typeof laboratoryInputSchema>;

/**
 * Asks to represent a laboratory, or registers a new one. For a member whose account is linked
 * to a person. One request per account and laboratory may be open. The evidence is computed on
 * the server.
 *
 * | Input        | Asks for                                                                       |
 * |--------------|--------------------------------------------------------------------------------|
 * | `laboratoryId` | The role in a laboratory that exists                                         |
 * | `proposal`   | A new laboratory, which a reviewer creates on approval. It takes the identifier of its name key at its institution, so a laboratory that exists under that key already is reported as `duplicate` and shown to the reviewer beside the one that exists |
 */
export const requestLabClaimContract = {
  name: "requestLabClaim",
  input: z.union([
    z.strictObject({
      laboratoryId: idSchema,
      requestedRole: labClaimRoleSchema,
      message: reasonSchema.exactOptional(),
    }),
    z.strictObject({
      proposal: laboratoryInputSchema,
      requestedRole: labClaimRoleSchema,
      message: reasonSchema.exactOptional(),
    }),
  ]),
  output: z.strictObject({
    claimId: idSchema,
    laboratoryId: idSchema,
    status: z.literal("pendingReview"),
    /** Whether a proposed laboratory exists already under the same name at the same institution. */
    duplicate: z.boolean(),
  }),
} as const satisfies CallableContract;

/**
 * Decides a request to represent a laboratory. Capability: `labs.claims.review`, which
 * programme administrators and the core team hold everywhere and a coordinator holds for the
 * laboratory. A rejection needs a note. Nobody decides their own request.
 */
export const reviewLabClaimContract = {
  name: "reviewLabClaim",
  input: z.discriminatedUnion("decision", [
    z.strictObject({ claimId: idSchema, decision: z.literal("approve"), note: reasonSchema.exactOptional() }),
    z.strictObject({ claimId: idSchema, decision: z.literal("reject"), note: reasonSchema }),
  ]),
  output: z.strictObject({ claimId: idSchema, status: claimStatusSchema.extract(["approved", "rejected"]) }),
} as const satisfies CallableContract;

/**
 * Withdraws the caller's own request to represent or register a laboratory while it waits for
 * review. Only the account that sent the request withdraws it, and a decided request stays as
 * it was decided. A new request may be sent afterwards.
 */
export const withdrawLabClaimContract = {
  name: "withdrawLabClaim",
  input: z.strictObject({ claimId: idSchema }),
  output: z.strictObject({ claimId: idSchema, status: z.literal("withdrawn") }),
} as const satisfies CallableContract;

/**
 * Creates a laboratory directly, with a new institution where one is entered. Capability:
 * `labs.manage` for the programme: programme administrators and the core team. The laboratory
 * takes the identifier of its name key at its institution, and one that exists already under
 * that key is refused as a duplicate (`already-exists`), with nothing written.
 */
export const createLaboratoryContract = {
  name: "createLaboratory",
  input: laboratoryInputSchema,
  output: z.strictObject({ laboratoryId: idSchema, institutionId: idSchema, institutionCreated: z.boolean() }),
} as const satisfies CallableContract;

/** The fields of an equipment configuration that a person states. Each may be left out, which means unknown. */
export const equipmentConfigurationInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(LIMITS.shortText),
  amplifierManufacturer: optionalTextSchema,
  amplifierModel: optionalTextSchema,
  capType: optionalTextSchema,
  electrodeType: optionalTextSchema,
  channelCount: z.number().int().min(1).max(4_096).exactOptional(),
  samplingRatesHz: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(50).exactOptional(),
  referenceScheme: optionalTextSchema,
  triggerMethod: optionalTextSchema,
  presentationSoftware: optionalTextSchema,
  stimulusComputer: optionalTextSchema,
  displayRefreshHz: z.number().positive().max(10_000).exactOptional(),
  eyeTracker: optionalTextSchema,
  responseDevices: z.array(z.string().trim().min(1).max(LIMITS.shortText)).min(1).max(50).exactOptional(),
  notes: z.string().trim().min(1).max(LIMITS.longText).exactOptional(),
});
export type EquipmentConfigurationInput = z.output<typeof equipmentConfigurationInputSchema>;

/**
 * Saves an equipment configuration of a laboratory. Capability: `labs.manage` for the
 * laboratory: its coordinators, the core team and programme administrators.
 *
 * With `replacesConfigurationId` null it opens a new configuration of its own. Naming the
 * current configuration replaces it: in one transaction the old one is closed (`validTo` set,
 * `isCurrent` cleared) and a new one opens that names it in `supersedesId`, so a closed
 * configuration never changes. A configuration that is no longer current is refused. A save
 * that changes nothing writes nothing and answers `changed: false`.
 */
export const saveEquipmentConfigurationContract = {
  name: "saveEquipmentConfiguration",
  input: z.strictObject({
    laboratoryId: idSchema,
    replacesConfigurationId: idSchema.nullable(),
    configuration: equipmentConfigurationInputSchema,
  }),
  output: z.strictObject({
    laboratoryId: idSchema,
    configurationId: idSchema,
    supersededId: idSchema.nullable(),
    changed: z.boolean(),
  }),
} as const satisfies CallableContract;

const targetCountSchema = z.number().int().min(0).max(1_000_000);

/**
 * Creates the participation of a laboratory in a replication, which is the only way one is
 * created. As `invited` (the default) it speaks for the replication: capability
 * `participations.manage` for the replication, held by its leads, the core team and programme
 * administrators. As `interested` it speaks for the laboratory: the same capability for the
 * laboratory, held by its coordinators. The participation takes the identifier that joins the
 * two, so a second one is refused (`already-exists`). In one transaction it writes the
 * participation, its restricted detail, one checklist item for each item of the onboarding
 * template, the entry of the status history and the audit entry.
 */
export const createParticipationContract = {
  name: "createParticipation",
  input: z.strictObject({
    replicationId: studyKeySchema,
    laboratoryId: idSchema,
    localLeadPersonId: idSchema.exactOptional(),
    /** The participants the laboratory aims to record in the main experiment. Kept apart from resting state. */
    targetNMain: targetCountSchema.exactOptional(),
    /** The participants the laboratory aims to record at rest. Never added to the main figure. */
    targetNRest: targetCountSchema.exactOptional(),
    reason: reasonSchema.exactOptional(),
    /** `invited` when the replication invites the laboratory, `interested` when the laboratory offers to take part. */
    status: z.enum(["invited", "interested"]).exactOptional(),
  }),
  output: z.strictObject({
    participationId: idSchema,
    status: z.enum(["invited", "interested"]),
    statusHistoryId: idSchema,
    checklistItems: z.number().int().min(0),
  }),
} as const satisfies CallableContract;

/**
 * Changes the status of a participation, with a reason, an entry of the status history and the
 * audit entry in one transaction. Capability: `participations.manage` for the side that decides
 * the move in `PARTICIPATION_TRANSITIONS`: the laboratory answers an invitation, starts its
 * onboarding and withdraws, and the replication decides everything from readiness onwards. A
 * move that the table does not hold is refused, and so is a move into collection while
 * readiness is not approved. The call states the status the caller saw, and is refused when the
 * stored status says anything else.
 */
export const setParticipationStatusContract = {
  name: "setParticipationStatus",
  input: z.strictObject({
    participationId: idSchema,
    fromStatus: participationStatusSchema,
    toStatus: participationStatusSchema,
    reason: reasonSchema,
  }),
  output: z.strictObject({ participationId: idSchema, status: participationStatusSchema, statusHistoryId: idSchema }),
} as const satisfies CallableContract;

/** What a reviewer decides about one lead membership of a conflict. */
export const leadOutcomeSchema = z.enum(["current", "former", "wrong"]);
export type LeadOutcome = z.output<typeof leadOutcomeSchema>;

const fingerprintSchema = idSchema;
const optionalNoteSchema = reasonSchema.exactOptional();

/**
 * Decides an item of the reconciliation queue. Capability: `reconciliation.resolve` for the
 * programme. A decided item never reopens: a second decision is refused. The decision, the
 * changes it makes and the audit entry are written in one transaction.
 *
 * | Action            | For items of the kind   | Effect                                                     |
 * |-------------------|-------------------------|------------------------------------------------------------|
 * | `dismiss`         | Any                     | The item is closed as dismissed, with a note, and nothing else changes |
 * | `decideLeads`     | `conflictingLead`       | Each named lead membership of the replication becomes current, former or wrong and is confirmed; a wrong one is archived. The current confirmed leads of the replication are recomputed |
 * | `chooseValue`     | `valueConflict`         | The value of one candidate is set on the record, and its source record is named for the field |
 * | `keepCurrent`     | `valueConflict`         | The record keeps its value; the decision is stored          |
 * | `distinctPersons` | `duplicatePerson`       | The two records are different people; the decision is stored |
 * | `mergePersons`    | `duplicatePerson`       | Every reference to `mergePersonId` moves to `keepPersonId`, through the identity keys and the source links, and the merged record is archived |
 */
export const resolveReconciliationItemContract = {
  name: "resolveReconciliationItem",
  input: z.discriminatedUnion("action", [
    z.strictObject({ fingerprint: fingerprintSchema, action: z.literal("dismiss"), note: reasonSchema }),
    z.strictObject({
      fingerprint: fingerprintSchema,
      action: z.literal("decideLeads"),
      memberships: z
        .array(
          z.strictObject({ personId: idSchema, role: replicationMembershipRoleSchema, outcome: leadOutcomeSchema }),
        )
        .min(1)
        .max(20),
      note: optionalNoteSchema,
    }),
    z.strictObject({
      fingerprint: fingerprintSchema,
      action: z.literal("chooseValue"),
      candidateKey: z.string().min(1).max(LIMITS.shortText),
      note: optionalNoteSchema,
    }),
    z.strictObject({ fingerprint: fingerprintSchema, action: z.literal("keepCurrent"), note: optionalNoteSchema }),
    z.strictObject({ fingerprint: fingerprintSchema, action: z.literal("distinctPersons"), note: optionalNoteSchema }),
    z.strictObject({
      fingerprint: fingerprintSchema,
      action: z.literal("mergePersons"),
      keepPersonId: idSchema,
      mergePersonId: idSchema,
      note: optionalNoteSchema,
    }),
  ]),
  output: z.strictObject({
    fingerprint: fingerprintSchema,
    status: reconciliationStatusSchema.extract(["resolved", "dismissed"]),
    /** The number of documents the decision changed, the item itself not included. */
    changedDocuments: z.number().int().min(0),
  }),
} as const satisfies CallableContract;

const rollbackCountsSchema = z.strictObject({
  restored: z.number().int().min(0),
  removed: z.number().int().min(0),
  itemsWithdrawn: z.number().int().min(0),
  /** Items of the queue that a reviewer has decided since. They are left as they are. */
  itemsLeft: z.number().int().min(0),
});

/**
 * Rolls an import batch back from its change log, with the logic of the import tools
 * (`planBatchRollback`). Capability: `imports.rollback` for the programme. Without `confirm`
 * it changes nothing and answers what a rollback would do, which the interface shows for
 * confirmation. With it, it reverses the batch. A batch any of whose documents has changed
 * since is refused as a whole, with the paths of those documents.
 */
export const rollbackImportBatchContract = {
  name: "rollbackImportBatch",
  input: z.strictObject({ batchId: idSchema, confirm: z.boolean() }),
  output: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("nothingToReverse"), reason: z.string().max(500) }),
    z.strictObject({ status: z.literal("refused"), changedDocuments: z.array(z.string().max(1_500)).max(1_000) }),
    z.strictObject({
      status: z.literal("planned"),
      counts: rollbackCountsSchema,
      /** Each document the rollback would change, with what it would do to it. */
      documents: z
        .array(
          z.strictObject({ path: z.string().max(1_500), action: z.enum(["restore", "remove", "withdraw", "keep"]) }),
        )
        .max(1_000),
      /** Whether more documents would change than `documents` lists. */
      truncated: z.boolean(),
    }),
    z.strictObject({ status: z.literal("rolledBack"), counts: rollbackCountsSchema }),
  ]),
} as const satisfies CallableContract;

/**
 * Records the outcome of a correction request and notifies whoever made it. Capability:
 * `people.manage`. The function records the decision. With `apply`, an accepted request about
 * a directly edited field of a person (`PERSON_CORRECTION_APPLICABLE_FIELDS`) also sets the
 * proposed value on the person, in the same transaction.
 */
export const resolveCorrectionRequestContract = {
  name: "resolveCorrectionRequest",
  input: z
    .strictObject({
      requestId: idSchema,
      outcome: correctionRequestStatusSchema.extract(["accepted", "rejected"]),
      /** A sentence for the person who asked, shown in their notification. */
      messageToRequester: z.string().trim().min(1).max(500).exactOptional(),
      /** Sets the proposed value on the record. For an accepted request only. */
      apply: z.boolean().exactOptional(),
    })
    .refine((input) => input.apply !== true || input.outcome === "accepted", {
      error: "Only an accepted request is applied",
      path: ["apply"],
    }),
  output: z.strictObject({
    requestId: idSchema,
    status: correctionRequestStatusSchema.extract(["accepted", "rejected"]),
    /** Whether the proposed value was set on the record. */
    applied: z.boolean(),
  }),
} as const satisfies CallableContract;

/**
 * Serves the special-category data of a person. For the person concerned, and for a caller who
 * holds `demographics.read`, an unexpired named grant of it and a satisfied second factor.
 * Every call writes an audit entry that names the reader and the person and never a value.
 */
export const getPersonDemographicsContract = {
  name: "getPersonDemographics",
  input: z.strictObject({ personId: idSchema }),
  output: z.strictObject({
    personId: idSchema,
    /** Null when nothing is recorded for the person. */
    demographics: z
      .strictObject({
        genderSource: z.string().exactOptional(),
        genderCategory: z.string().exactOptional(),
        genderSelfDescribed: z.string().exactOptional(),
        ethnicitySource: z.string().exactOptional(),
        ethnicityCategory: z.string().exactOptional(),
        ethnicitySelfDescribed: z.string().exactOptional(),
        recordedAt: instantSchema,
      })
      .nullable(),
  }),
} as const satisfies CallableContract;
export type PersonDemographics = NonNullable<CallableOutput<typeof getPersonDemographicsContract>["demographics"]>;

/**
 * Sets, changes or removes the ORCID iD of a person and reserves it, so that no two persons
 * hold one iD. For the person concerned, who states with `confirmedOwn` that the iD is their
 * own, and for holders of `people.manage`. `orcid` null removes the iD.
 */
export const setPersonOrcidContract = {
  name: "setPersonOrcid",
  input: z.strictObject({
    personId: idSchema,
    orcid: orcidSchema
      .refine(hasValidOrcidCheckDigit, { error: "The check digit of the ORCID iD does not fit" })
      .nullable(),
    /** True when the caller states that the iD is their own. Required of a person who edits their own record. */
    confirmedOwn: z.boolean(),
  }),
  output: z.strictObject({ personId: idSchema, orcid: orcidSchema.nullable() }),
} as const satisfies CallableContract;

/**
 * Confirms a member entry of a laboratory. For the person concerned, and for holders of
 * `labs.manage` for the programme. The call states the role and the mark that are being
 * confirmed, and is refused when the stored entry says anything else, so a confirmation never
 * covers what its giver did not see.
 */
export const confirmLaboratoryMembershipContract = {
  name: "confirmLaboratoryMembership",
  input: z.strictObject({
    laboratoryId: idSchema,
    personId: idSchema,
    role: laboratoryMemberRoleSchema,
    isAuthorisedRepresentative: z.boolean(),
  }),
  output: z.strictObject({
    laboratoryId: idSchema,
    personId: idSchema,
    status: laboratoryMemberStatusSchema.extract(["confirmed"]),
  }),
} as const satisfies CallableContract;

/**
 * Confirms a membership of a replication. For the person concerned, except in the roles `lead`
 * and `coLead`, and for holders of `replications.manage` for the programme. The call states
 * what is being confirmed, as `confirmLaboratoryMembership` does.
 */
export const confirmReplicationMembershipContract = {
  name: "confirmReplicationMembership",
  input: z.strictObject({
    replicationId: idSchema,
    personId: idSchema,
    role: replicationMembershipRoleSchema,
    isCurrent: z.boolean(),
  }),
  output: z.strictObject({
    replicationId: idSchema,
    personId: idSchema,
    role: replicationMembershipRoleSchema,
    reviewStatus: reviewStatusSchema.extract(["confirmed"]),
  }),
} as const satisfies CallableContract;

/**
 * Changes the status of a replication, which is the only way it changes (decision D-019). For
 * holders of `replications.manage` for the replication: its leads, the core team and
 * programme administrators, with the second factor wherever the access document requires one.
 *
 * The call states the status the caller saw in `fromStatusKey`, null where the replication had
 * none, and is refused when the stored status says anything else, so a change never overrides
 * one that its maker did not see. `toStatusKey` names a status of `statusDefinitions` for
 * replications that is not archived. A reason is required. In one transaction the function
 * sets the status, writes the entry of the status history and writes the audit entry.
 */
export const setReplicationStatusContract = {
  name: "setReplicationStatus",
  input: z.strictObject({
    replicationId: studyKeySchema,
    fromStatusKey: keySchema.nullable(),
    toStatusKey: keySchema,
    reason: reasonSchema,
  }),
  output: z.strictObject({
    replicationId: studyKeySchema,
    statusKey: keySchema,
    statusHistoryId: idSchema,
  }),
} as const satisfies CallableContract;

/** The fields of a replication that name the original study, which a citation check covers. */
export const CITATION_FIELDS = [
  "originalAuthors",
  "originalYear",
  "originalTitle",
  "originalReference",
  "originalDoi",
] as const;
export const citationFieldSchema = z.enum(CITATION_FIELDS);
export type CitationField = z.output<typeof citationFieldSchema>;

/**
 * Changes one field of the citation of the original study while the citation has been checked
 * (`citationStatus` is not `unverified`), which the security rules leave to this function. For
 * holders of `replications.manage` for the replication: its leads, the core team and programme
 * administrators. In one transaction the field changes, `citationStatus` returns to
 * `unverified`, the time, source and metadata of the check are removed, because they describe a
 * citation that no longer exists, and the audit entry is written. `value` is null to remove the
 * field, and is checked against the schema of the replication.
 */
export const editReplicationCitationContract = {
  name: "editReplicationCitation",
  input: z.strictObject({
    replicationId: studyKeySchema,
    field: citationFieldSchema,
    value: z.union([z.string().max(LIMITS.longText), z.number().int()]).nullable(),
  }),
  output: z.strictObject({ replicationId: studyKeySchema, citationStatus: z.literal("unverified") }),
} as const satisfies CallableContract;

/**
 * Ends every session of the caller's own account, the one that makes the call included. Takes
 * no arguments: it only ever concerns the caller. Every session that began before the instant
 * it reports is refused from its next request, by the security rules and by the functions.
 */
export const endAllSessionsContract = {
  name: "endAllSessions",
  input: noArguments,
  output: z.strictObject({ sessionsValidAfter: instantSchema }),
} as const satisfies CallableContract;

const listedRoleSchema = z.strictObject({
  assignmentId: idSchema,
  role: roleSchema,
  scopeType: roleScopeTypeSchema,
  scopeId: idSchema,
  status: roleAssignmentStatusSchema,
  expiresAt: instantSchema.nullable(),
});

/**
 * Lists accounts for the administration console, sorted by name and then by address.
 * Capability: `users.suspend` or `roles.manage`, for the programme.
 *
 * The verified address of an account is given, and searched, only for a caller who holds
 * `people.contact.read` for the programme. For anyone else `emailLower` is null and the search
 * looks at names alone, so the search cannot be used to find out whether an address has an
 * account. `uids` asks for named accounts, for example to put names to the accounts of a list
 * of role assignments.
 */
export const listUsersContract = {
  name: "listUsers",
  input: z.strictObject({
    search: z.string().trim().max(200).default(""),
    status: userStatusSchema.exactOptional(),
    uids: z.array(uidSchema).min(1).max(100).exactOptional(),
    offset: z.number().int().min(0).max(10_000).default(0),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  output: z.strictObject({
    users: z
      .array(
        z.strictObject({
          uid: uidSchema,
          /** The name the account gives itself. It is self-asserted. */
          displayName: z.string().nullable(),
          /** Null unless the caller may see addresses. */
          emailLower: z.string().max(320).nullable(),
          status: userStatusSchema,
          personId: idSchema.nullable(),
          /** The name of the linked person, from the directory. */
          personName: z.string().nullable(),
          lastSeenAt: instantSchema,
          /** Active and pending role assignments of the account. */
          roles: z.array(listedRoleSchema).max(100),
        }),
      )
      .max(100),
    /** How many accounts match, of which `users` is the page that starts at `offset`. */
    total: z.number().int().min(0),
    /** Whether `emailLower` is given and searched. */
    addressesShown: z.boolean(),
  }),
} as const satisfies CallableContract;
export type ListUsersOutput = CallableOutput<typeof listUsersContract>;
export type ListedUser = ListUsersOutput["users"][number];

/** Where a page of the audit trail ends: the instant and the identifier of its last entry. */
const auditCursorSchema = z.strictObject({ at: instantSchema, eventId: idSchema });

/**
 * Reads the audit trail, newest first. Capability: `audit.read`, for the programme. A page
 * holds at most `limit` entries and ends with `next`, the cursor of the following page, or
 * null at the start of the trail. `from` and `to` bound the instant of the entries, both
 * inclusive. A value that the entry withholds stays withheld: the change names the field with
 * `withheld` and carries no value.
 */
export const listAuditEventsContract = {
  name: "listAuditEvents",
  input: z.strictObject({
    actorUid: uidSchema.exactOptional(),
    entityType: entityTypeSchema.exactOptional(),
    action: auditActionSchema.exactOptional(),
    from: instantSchema.exactOptional(),
    to: instantSchema.exactOptional(),
    after: auditCursorSchema.exactOptional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  output: z.strictObject({
    events: z
      .array(
        z.strictObject({
          eventId: idSchema,
          at: instantSchema,
          actorUid: uidSchema.nullable(),
          actorKind: auditActorKindSchema,
          /** The name the acting account gives itself, where it has one. */
          actorName: z.string().nullable(),
          action: auditActionSchema,
          entityType: entityTypeSchema.nullable(),
          entityId: idSchema.nullable(),
          documentPath: z.string(),
          /** Values as JSON: an instant of the database is given as ISO 8601 text. */
          changes: z
            .array(
              z.strictObject({
                field: z.string(),
                before: z.json().exactOptional(),
                after: z.json().exactOptional(),
                withheld: z.literal(true).exactOptional(),
              }),
            )
            .max(1_000),
        }),
      )
      .max(100),
    next: auditCursorSchema.nullable(),
  }),
} as const satisfies CallableContract;
export type ListAuditEventsOutput = CallableOutput<typeof listAuditEventsContract>;
export type ListedAuditEvent = ListAuditEventsOutput["events"][number];

// The workspace (docs/DATA_MODEL.md, section 9). A page is created, moved and shared through
// these functions, because each resolves the audience of the page, and of every page that
// inherits from it, in one transaction with its audit entry.

/** A title as a person types it: trimmed and never empty. */
const pageTitleSchema = z.string().trim().min(1).max(LIMITS.shortText);
/** An icon of a page: one emoji or short symbol. */
export const pageIconSchema = z.string().trim().min(1).max(16);
const orderKeySchema = z
  .string()
  .max(ORDER_KEY_MAX_LENGTH)
  .regex(/^[0-9a-z]*[1-9a-z]$/);

/**
 * Creates a page: at the top of the programme's workspace (`parentPageId` null), which every
 * member may, or beneath a page on which the caller holds `edit`. A page made from a template,
 * which the caller may read, starts with a copy of its content and names it in
 * `templateSourceId`. The new page goes after its last sibling.
 */
export const createPageContract = {
  name: "createPage",
  input: z.strictObject({
    parentPageId: idSchema.nullable(),
    title: pageTitleSchema,
    icon: pageIconSchema.optional(),
    templatePageId: idSchema.optional(),
    /** A meeting page, which the interface starts with the sections of a meeting. */
    kind: z.enum(["custom", "meeting"]).optional(),
  }),
  output: z.strictObject({ pageId: idSchema }),
} as const satisfies CallableContract;

/** The records that have a body page: notes on a replication, a laboratory or a member, and the description of a task. */
export const ENTITY_PAGE_TYPES = ["replication", "laboratory", "person", "task"] as const;
export const entityPageTypeSchema = z.enum(ENTITY_PAGE_TYPES);
export type EntityPageType = z.output<typeof entityPageTypeSchema>;

/**
 * The body page of a replication, a laboratory or a member, created on first use for any member,
 * who may read every one of these records. Its identifier is `entityType__entityId` and its
 * audience follows the record. A repeated call creates nothing.
 */
export const openEntityPageContract = {
  name: "openEntityPage",
  input: z.strictObject({ entityType: entityPageTypeSchema, entityId: idSchema }),
  output: z.strictObject({ pageId: idSchema, created: z.boolean() }),
} as const satisfies CallableContract;

/**
 * Moves a page beneath another page, or to the top of the workspace, at the place that `order`
 * names among its new siblings. The caller holds `edit` on the page and on its new parent. A
 * page that inherits takes the audience of its new parent, and so does every page beneath it
 * that inherits. The body page of a record stays where it is.
 */
export const movePageContract = {
  name: "movePage",
  input: z.strictObject({ pageId: idSchema, parentPageId: idSchema.nullable(), order: orderKeySchema }),
  output: z.strictObject({}),
} as const satisfies CallableContract;

const pagePermissionInputSchema = z.strictObject({
  principalType: z.enum(["user", "group"]),
  principalId: idSchema,
  level: pageLevelSchema,
});

/**
 * Sets who may read and change a page. The caller holds `full` on it. `inherit` follows the page
 * above it or the record it belongs to, and `restricted` opens the page to the listed users and
 * groups alone, at their levels, with the caller at `full` whatever the list says. The audience of
 * the page and of every page beneath it that inherits, and of their threads, comments, activity
 * and search entries, changes in the same transaction.
 */
export const setPageSharingContract = {
  name: "setPageSharing",
  input: z.strictObject({
    pageId: idSchema,
    accessMode: pageAccessModeSchema,
    permissions: z.array(pagePermissionInputSchema).max(100),
  }),
  output: z.strictObject({}),
} as const satisfies CallableContract;

/**
 * What the sharing dialog of a page shows to a holder of `full`: the access mode, the listed
 * principals with their names, and the groups that may be added.
 */
export const getPageSharingContract = {
  name: "getPageSharing",
  input: z.strictObject({ pageId: idSchema }),
  output: z.strictObject({
    accessMode: pageAccessModeSchema,
    permissions: z
      .array(
        z.strictObject({
          principalType: z.enum(["user", "group", "role"]),
          principalId: idSchema,
          level: pageLevelSchema,
          /** The name of the person or the group, or null where it is not known. */
          name: shortTextSchema.nullable(),
        }),
      )
      .max(100),
    groups: z.array(z.strictObject({ groupKey: keySchema, name: shortTextSchema })).max(500),
  }),
} as const satisfies CallableContract;

export const pageVersionRequestKindSchema = z.enum(["manual", "auto", "restore"]);

/**
 * Saves the content of a page as it is stored now as a version. The caller holds `edit`. A
 * version of the kind `auto`, which the editor asks for after a quiet spell, is saved only when
 * the content has changed since the latest version, and `versionId` is null otherwise. A version
 * of the kind `restore` records the content after an earlier version was restored, which the
 * editor writes as a new change, and names that version.
 */
export const savePageVersionContract = {
  name: "savePageVersion",
  input: z.strictObject({
    pageId: idSchema,
    kind: pageVersionRequestKindSchema,
    label: pageTitleSchema.optional(),
    restoredFromVersionId: idSchema.optional(),
  }),
  output: z.strictObject({ versionId: idSchema.nullable() }),
} as const satisfies CallableContract;

/**
 * Searches the index of the workspace for every word of a query, and returns only the entries
 * whose audience includes the caller. Restricted pages are found by their principals alone.
 */
export const searchWorkspaceContract = {
  name: "searchWorkspace",
  input: z.strictObject({
    query: z.string().trim().min(1).max(200),
    /** The kinds of indexed result kept, or every kind where absent. Records are found by the client in what it reads. */
    kinds: z
      .array(z.enum(["page", "comment", "document"]))
      .min(1)
      .max(3)
      .optional(),
    /** Keeps only the results of one replication. */
    replicationId: idSchema.optional(),
  }),
  output: z.strictObject({
    results: z
      .array(
        z.strictObject({
          entityType: entityTypeSchema,
          entityId: idSchema,
          title: z.string().max(1_000),
          kind: keySchema,
          /** For a comment or a document: the record it belongs to, which the result opens. */
          targetEntityType: entityTypeSchema.optional(),
          targetEntityId: idSchema.optional(),
        }),
      )
      .max(50),
  }),
} as const satisfies CallableContract;
export type WorkspaceSearchResult = CallableOutput<typeof searchWorkspaceContract>["results"][number];

// Databases, custom properties, views and dashboards (D-011, docs/DATA_MODEL.md, section 9). A
// property definition, a value of a property and a widget may each be a list or a map, which no
// security rule can check element by element, so these functions validate and write them.

/**
 * Creates a database beneath a page on which the caller holds `edit`. It copies the audience of
 * the page and starts with a status property, so that a board can be drawn at once.
 */
export const createDatabaseContract = {
  name: "createDatabase",
  input: z.strictObject({ parentPageId: idSchema, name: pageTitleSchema, icon: pageIconSchema.optional() }),
  output: z.strictObject({ databaseId: idSchema }),
} as const satisfies CallableContract;

/** The name of a property as a person types it. */
const propertyNameSchema = z.string().trim().min(1).max(100);

/**
 * Adds a property to a collection, changes one, or archives it. For a database (`db:<id>`) the
 * caller holds `edit` on its parent page. For a core collection (`core:<name>`) the caller holds
 * `lookups.manage` for the programme, states the audience of the property, and may never take
 * the identifier of a core field. The type of a property never changes once it holds values.
 */
export const savePropertyContract = {
  name: "saveProperty",
  input: z.strictObject({
    collectionKey: viewCollectionKeySchema,
    propertyId: mapKeySchema.optional(),
    name: propertyNameSchema,
    type: propertyTypeSchema,
    config: propertyConfigSchema,
    audience: propertyAudienceSchema.optional(),
    archived: z.boolean().optional(),
  }),
  output: z.strictObject({ propertyId: mapKeySchema }),
} as const satisfies CallableContract;

/** The most records one call changes, which keeps its transaction within Firestore's limit. */
export const SAVE_RECORDS_MAX = 100;

/**
 * Changes the values of records, creates rows of a database and archives them, in one
 * transaction with an audit entry for each record. A row of a database is changed by the editors
 * of the database. A core record takes values of its custom properties and of the core fields
 * that the view registry lets a client change, from those who may change the record; a value of
 * a restricted property goes to the record's `private/custom`. Every value is checked against
 * its property, and a computed property takes none.
 */
export const saveRecordsContract = {
  name: "saveRecords",
  input: z.strictObject({
    collectionKey: viewCollectionKeySchema,
    changes: z
      .array(
        z.strictObject({
          /** The record to change, or none for a new row of a database. */
          recordId: idSchema.optional(),
          /** The title of a row of a database. */
          title: z.string().trim().max(LIMITS.shortText).optional(),
          values: z.record(mapKeySchema, z.json()),
        }),
      )
      .max(SAVE_RECORDS_MAX),
    /** Rows of a database to archive. */
    archive: z.array(idSchema).max(SAVE_RECORDS_MAX).optional(),
  }),
  output: z.strictObject({ recordIds: z.array(idSchema).max(SAVE_RECORDS_MAX) }),
} as const satisfies CallableContract;

/**
 * Saves a view: a new one for the caller, or one the caller owns, or a shared one for programme
 * administrators and the core team. A view is the caller's own until `isShared` is set.
 */
export const saveViewContract = {
  name: "saveView",
  input: z.strictObject({
    viewId: idSchema.optional(),
    collectionKey: viewCollectionKeySchema,
    name: pageTitleSchema,
    type: viewTypeSchema,
    config: viewConfigSchema,
    scope: viewScopeSchema.nullable(),
    isShared: z.boolean(),
    pageId: idSchema.nullable(),
  }),
  output: z.strictObject({ viewId: idSchema }),
} as const satisfies CallableContract;

/** The scopes that have a dashboard of their own, which a function creates when it is first opened. */
export const scopeDashboardTypeSchema = z.enum(["programme", "replication", "laboratory"]);

/**
 * The dashboard of the programme, a replication or a laboratory, created with its default
 * widgets on first use for any member, who may read every one of them. A repeated call creates
 * nothing.
 */
export const openDashboardContract = {
  name: "openDashboard",
  input: z.strictObject({ scopeType: scopeDashboardTypeSchema, scopeId: idSchema }),
  output: z.strictObject({ dashboardId: idSchema, created: z.boolean() }),
} as const satisfies CallableContract;

/**
 * Creates a personal dashboard for the caller, or changes a dashboard: its name, and the widgets
 * it names, each replaced whole or removed with null, so that two people who change different
 * widgets at once both keep their change. A personal dashboard is changed by its owner alone, and
 * any other by holders of `pages.manage` for its scope.
 */
export const saveDashboardContract = {
  name: "saveDashboard",
  input: z.strictObject({
    dashboardId: idSchema.optional(),
    name: pageTitleSchema.optional(),
    widgets: z.record(mapKeySchema, dashboardWidgetInputSchema.nullable()),
    archived: z.boolean().optional(),
  }),
  output: z.strictObject({ dashboardId: idSchema }),
} as const satisfies CallableContract;

// ===== Tasks =====

/** One participant who has no account yet, by person. */
const unclaimedParticipantInputSchema = z.strictObject({
  personId: idSchema,
  role: taskParticipantRoleSchema,
});

/** A record that a task links to: one that exists and that the caller may open, a dataset among them. */
const taskLinkInputSchema = z.strictObject({ entityType: entityTypeSchema, entityId: idSchema });

const checklistInputSchema = z.record(
  mapKeySchema,
  z.strictObject({ label: z.string().trim().min(1).max(LIMITS.shortText), done: z.boolean(), order: orderKeySchema }),
);

/**
 * The fields of a task that a change may set. A field that is absent stays as it is, and null
 * clears a field that may be empty. The lists and the maps are replaced whole.
 */
export const taskPatchSchema = z.strictObject({
  title: z.string().trim().min(1).max(LIMITS.shortText).optional(),
  kind: taskKindSchema.optional(),
  priority: taskPrioritySchema.optional(),
  startAt: instantSchema.nullable().optional(),
  dueAt: instantSchema.nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(1_000_000).nullable().optional(),
  progressPercent: z.number().int().min(0).max(100).nullable().optional(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  assigneeUids: z.array(uidSchema).max(50).optional(),
  collaboratorUids: z.array(uidSchema).max(50).optional(),
  followerUids: z.array(uidSchema).max(100).optional(),
  unclaimedParticipants: z.array(unclaimedParticipantInputSchema).max(100).optional(),
  dependsOn: z.record(mapKeySchema, taskDependencyKindSchema).optional(),
  links: z.array(taskLinkInputSchema).max(100).optional(),
  checklist: checklistInputSchema.optional(),
  tagIds: z.array(idSchema).max(50).optional(),
  archived: z.boolean().optional(),
});
export type TaskPatch = z.output<typeof taskPatchSchema>;

/** The most tasks one call changes, and the most a list made from a template copies. */
export const TASK_BATCH_MAX = 100;
export const TASK_TEMPLATE_MAX = 400;

/**
 * Creates a task list: a personal list of the caller, or a project or template list of the
 * programme, a replication, a laboratory or a group for the holders of `tasks.manage` there.
 * A list made from a template copies the template's tasks, with their tree, their order, their
 * checklists reopened and their dependencies, and names the template in `templateSourceId`.
 */
export const createTaskListContract = {
  name: "createTaskList",
  input: z.strictObject({
    name: z.string().trim().min(1).max(LIMITS.shortText),
    kind: taskListKindSchema,
    scopeType: taskScopeTypeSchema,
    /** The replication, the laboratory or the group; the programme key; the caller's uid for a personal list. */
    scopeId: idSchema,
    templateListId: idSchema.optional(),
  }),
  output: z.strictObject({ listId: idSchema, copiedTasks: z.number().int().min(0) }),
} as const satisfies CallableContract;

/** Renames a task list, or archives or restores it, for those who manage it. */
export const updateTaskListContract = {
  name: "updateTaskList",
  input: z.strictObject({
    listId: idSchema,
    name: z.string().trim().min(1).max(LIMITS.shortText).optional(),
    archived: z.boolean().optional(),
  }),
  output: z.strictObject({}),
} as const satisfies CallableContract;

/**
 * Creates a task in a list, at the top of the list or beneath a task of it, at the end of its
 * siblings or at `index` among them, for those who manage the list. Its first status is the
 * default status of tasks, with its first history entry. The assignees are notified.
 */
export const createTaskContract = {
  name: "createTask",
  input: z.strictObject({
    listId: idSchema,
    parentId: idSchema.nullable(),
    index: z.number().int().min(0).optional(),
    fields: taskPatchSchema.extend({ title: z.string().trim().min(1).max(LIMITS.shortText) }),
  }),
  output: z.strictObject({ taskId: idSchema }),
} as const satisfies CallableContract;

/**
 * Changes tasks: one, or many at once for a bulk edit, in one transaction with an audit entry
 * for each. The managers of a list change every field. An assignee or a collaborator changes the
 * progress, the estimate and the checklist, and anyone who reads a task follows it or stops
 * following it. A dependency that would close a cycle is refused, and so is a link to a record
 * that does not exist or that the caller may not open.
 */
export const updateTasksContract = {
  name: "updateTasks",
  input: z.strictObject({
    changes: z
      .array(z.strictObject({ taskId: idSchema, patch: taskPatchSchema }))
      .min(1)
      .max(TASK_BATCH_MAX),
  }),
  output: z.strictObject({ taskIds: z.array(idSchema).max(TASK_BATCH_MAX) }),
} as const satisfies CallableContract;

/**
 * Moves a task, with every task beneath it, beneath another task or to the top of a list, which
 * may be another list, at `index` among its new siblings. The ancestors, the owner and the scope
 * fields of every task of the subtree are rewritten in one transaction. A move beneath the task
 * itself or one of its descendants is refused. The caller manages the list the task leaves and
 * the list it joins.
 */
export const moveTaskContract = {
  name: "moveTask",
  input: z.strictObject({
    taskId: idSchema,
    listId: idSchema,
    parentId: idSchema.nullable(),
    index: z.number().int().min(0),
  }),
  output: z.strictObject({ movedTasks: z.number().int().min(1) }),
} as const satisfies CallableContract;

/**
 * Changes the status of tasks, each from the status the caller saw, with a dated history entry
 * for each, for the managers of their lists and their assignees and collaborators. A finished
 * status sets `completedAt` and any other clears it. The assignees and the followers are told,
 * apart from the caller.
 */
export const setTaskStatusContract = {
  name: "setTaskStatus",
  input: z.strictObject({
    tasks: z
      .array(z.strictObject({ taskId: idSchema, fromStatusKey: keySchema }))
      .min(1)
      .max(TASK_BATCH_MAX),
    toStatusKey: keySchema,
    reason: reasonSchema.optional(),
  }),
  output: z.strictObject({ statusHistoryIds: z.array(idSchema).max(TASK_BATCH_MAX) }),
} as const satisfies CallableContract;

/**
 * Sets a reminder of the caller about a task they read, delivered among their notifications at
 * its time. The time lies between an hour ago and two years ahead, and a user holds at most
 * `REMINDERS_PER_USER_MAX` reminders that are not sent yet.
 */
export const setReminderContract = {
  name: "setReminder",
  input: z.strictObject({
    entityType: reminderEntityTypeSchema,
    entityId: idSchema,
    remindAt: instantSchema,
    channel: reminderChannelSchema,
  }),
  output: z.strictObject({ reminderId: idSchema }),
} as const satisfies CallableContract;

/** The most members one progress update mentions. */
export const PROGRESS_UPDATE_MENTIONS_MAX = 10;

/**
 * Posts a progress update to the feed of a replication, a laboratory or a member: by its team,
 * by its members, or by the member and those who manage people. The update is dated and never
 * changes. Those who follow the record and the members it mentions are told.
 */
export const postProgressUpdateContract = {
  name: "postProgressUpdate",
  input: z.strictObject({
    entityType: progressUpdateEntityTypeSchema,
    entityId: idSchema,
    body: z.string().trim().min(1).max(PROGRESS_UPDATE_MAX_LENGTH),
    mentionUids: z.array(uidSchema).max(PROGRESS_UPDATE_MENTIONS_MAX),
    pinned: z.boolean(),
  }),
  output: z.strictObject({ updateId: idSchema }),
} as const satisfies CallableContract;

// ===== Recruitment =====

/** The most reports one call files: one for each row that changed in a table of participations. */
export const RECRUITMENT_BATCH_MAX = 100;

/** The most categories one report states for one modality. */
export const REPORT_CATEGORIES_MAX = 50;

/** A count as a person enters it: a whole number from zero. */
const countInputSchema = z.number().int().min(0).max(1_000_000);

/** Counts by modality and category. A key that is left out is unknown and stays so. */
export const reportCountsInputSchema = z.partialRecord(
  recruitmentModalitySchema,
  z.record(keySchema, countInputSchema).refine((counts) => Object.keys(counts).length <= REPORT_CATEGORIES_MAX, {
    error: `A report states at most ${REPORT_CATEGORIES_MAX} categories for one modality`,
  }),
);

/** One exclusion: how many participants of one modality were excluded, for a reason of the vocabulary. */
export const reportExclusionInputSchema = z.strictObject({
  modality: recruitmentModalitySchema,
  reasonTermId: idSchema,
  count: z.number().int().min(1).max(1_000_000),
});

/**
 * One report as a person files it. The function adds the scope, the author, the time, the
 * source and the origin, and checks every category and reason against the lookup data.
 */
export const recruitmentReportInputSchema = z
  .strictObject({
    participationId: idSchema,
    /** The date for which the counts hold. A period report holds for the last day of its period. */
    asOfDate: isoDateSchema,
    reportKind: reportKindSchema,
    periodStart: isoDateSchema.optional(),
    periodEnd: isoDateSchema.optional(),
    basis: recruitmentBasisSchema,
    entryKind: reportEntryKindSchema,
    /** The report a correction or a void replaces. */
    correctsReportId: idSchema.optional(),
    /** The lab-reported report a new central verification checks. */
    verifiesReportId: idSchema.optional(),
    counts: reportCountsInputSchema,
    exclusions: z.array(reportExclusionInputSchema).max(50),
    note: reasonSchema.optional(),
  })
  .refine((report) => (report.entryKind === "new") === (report.correctsReportId === undefined), {
    error: "A correction and a void name the report they replace, and a new report names none",
    path: ["correctsReportId"],
  })
  .refine((report) => report.entryKind === "new" || report.note !== undefined, {
    error: "A correction and a void say why in their note",
    path: ["note"],
  })
  .refine(
    (report) =>
      report.entryKind === "void"
        ? Object.keys(report.counts).length === 0 && report.exclusions.length === 0
        : Object.values(report.counts).some((counts) => Object.keys(counts).length > 0),
    { error: "A void carries no counts, and every other report states at least one count", path: ["counts"] },
  )
  .refine((report) => report.basis === "centrallyVerified" || report.verifiesReportId === undefined, {
    error: "Only a central verification names a report it verifies",
    path: ["verifiesReportId"],
  })
  .refine(
    (report) =>
      report.basis !== "centrallyVerified" || report.entryKind !== "new" || report.verifiesReportId !== undefined,
    { error: "A new central verification names the report it verifies", path: ["verifiesReportId"] },
  )
  .refine(
    (report) =>
      report.reportKind === "period"
        ? report.periodStart !== undefined &&
          report.periodEnd !== undefined &&
          report.periodStart <= report.periodEnd &&
          report.asOfDate === report.periodEnd
        : report.periodStart === undefined && report.periodEnd === undefined,
    {
      error:
        "A period report states its start and its end, and holds for its last day; a cumulative report states no period",
      path: ["periodStart"],
    },
  );
export type RecruitmentReportInput = z.output<typeof recruitmentReportInputSchema>;

/**
 * Files recruitment reports, one for each participation that changed, in one transaction with
 * an audit entry for each and the recruitment summary of each replication recomputed. A
 * lab-reported report is filed by whoever holds `recruitment.report` for its laboratory or its
 * replication, and a central verification, or its correction, by the holders of
 * `recruitment.verify`. A correction or a void names a report of the same participation and
 * basis that nothing has replaced yet. A report is never changed afterwards.
 */
export const fileRecruitmentReportsContract = {
  name: "fileRecruitmentReports",
  input: z.strictObject({
    reports: z.array(recruitmentReportInputSchema).min(1).max(RECRUITMENT_BATCH_MAX),
  }),
  output: z.strictObject({ reportIds: z.array(idSchema).max(RECRUITMENT_BATCH_MAX) }),
} as const satisfies CallableContract;

/**
 * Creates or changes a category of participant counts. A global category is for the holders of
 * `lookups.manage`; a category that extends one replication is also for the holders of
 * `replications.manage` there. A key names one category for good: it is never reused by another
 * replication, and a seeded core category is never archived.
 */
export const saveCountCategoryContract = {
  name: "saveCountCategory",
  input: z.strictObject({
    key: keySchema,
    /** Whether the call creates the category, which must then not exist yet. */
    create: z.boolean(),
    label: z.string().trim().min(1).max(LIMITS.shortText),
    definition: z.string().trim().min(1).max(2_000),
    /** The replication the category extends, or null for a global category. Never changes. */
    replicationId: idSchema.nullable(),
    archived: z.boolean(),
  }),
  output: z.strictObject({ key: keySchema }),
} as const satisfies CallableContract;

/**
 * Runs the recruitment forecast of a replication under stated assumptions and stores the run,
 * which never changes afterwards and whose figures are all projected. For the holders of
 * `replications.manage` for the replication: its leads, the core team and administrators.
 */
export const generateForecastContract = {
  name: "generateForecast",
  input: z.strictObject({ replicationId: idSchema, assumptions: forecastAssumptionsSchema }),
  output: z.strictObject({ forecastRunId: idSchema }),
} as const satisfies CallableContract;

// Google Workspace (docs/INTEGRATIONS.md, section 3). Every function below reaches Google only
// through the adapters of the functions, which are in-memory fakes in the emulator, and none
// trusts a file identifier or a record identifier from the browser without checking the caller.

/** A file or folder identifier as Drive gives it. */
const externalFileIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, { error: "Expected a Drive identifier" });

/** The kinds of record a Drive file or folder can be linked to. */
export const driveLinkTargetSchema = z.enum(["replication", "laboratory", "manuscript", "dataset"]);
export type DriveLinkTarget = z.output<typeof driveLinkTargetSchema>;

/**
 * Links a Drive file or folder to a replication, a laboratory, a manuscript or a dataset, from
 * the address a member pasted. The caller manages the target: `replications.manage` for a
 * replication and its manuscripts, `labs.manage` for a laboratory, `datasets.manage` for a
 * dataset of the registry. The function
 * asks Drive for the item's name, type and owner as the portal's account sees it and stores the
 * link with its access status: `shared` when the account can open it, `restricted` when it
 * cannot, in which case the answer names the account to share it with.
 */
export const linkDriveResourceContract = {
  name: "linkDriveResource",
  input: z.strictObject({
    entityType: driveLinkTargetSchema,
    entityId: idSchema,
    address: urlSchema,
    /** Whether the link is for the team of the record only, rather than every member. */
    restricted: z.boolean(),
  }),
  output: z.strictObject({
    linkId: idSchema,
    accessStatus: z.enum(["shared", "restricted", "unreachable"]),
    title: z.string().max(LIMITS.shortText).nullable(),
    /** The account to share the item with, where the portal cannot open it yet. */
    shareWith: z.string().max(LIMITS.shortText).nullable(),
  }),
} as const satisfies CallableContract;

export const driveItemKindSchema = z.enum(["folder", "document", "spreadsheet", "file"]);

export const driveItemSchema = z.strictObject({
  id: externalFileIdSchema,
  name: z.string().max(LIMITS.shortText),
  kind: driveItemKindSchema,
  mimeType: z.string().max(200),
  modifiedAt: z.iso.datetime({ offset: true }).nullable(),
  ownerName: z.string().max(LIMITS.shortText).nullable(),
  lastModifiedBy: z.string().max(LIMITS.shortText).nullable(),
  /** Google's own address for the item, which applies the reader's own permissions. */
  url: urlSchema.nullable(),
});
export type DriveItem = z.output<typeof driveItemSchema>;

/**
 * Lists one folder of a linked Drive folder: its direct children, folders first, one page at a
 * time, as the portal's account sees them. The caller reads the link (its scope, or every
 * member where the link is not restricted), and a folder below the linked one is opened only
 * when Drive places it inside that folder, so a link never opens anything beside it.
 */
export const browseDriveFolderContract = {
  name: "browseDriveFolder",
  input: z.strictObject({
    linkId: idSchema,
    /** A folder inside the linked one. The linked folder itself where absent. */
    folderId: externalFileIdSchema.exactOptional(),
    pageToken: z.string().min(1).max(500).exactOptional(),
  }),
  output: z.strictObject({
    folder: z.strictObject({ id: externalFileIdSchema, name: z.string().max(LIMITS.shortText) }),
    /** The folders from the linked one down to this one, for a breadcrumb. */
    path: z.array(z.strictObject({ id: externalFileIdSchema, name: z.string().max(LIMITS.shortText) })).max(25),
    items: z.array(driveItemSchema).max(1_000),
    nextPageToken: z.string().max(500).nullable(),
  }),
} as const satisfies CallableContract;

/**
 * Describes one file of a linked file or folder: its metadata and Google's own address for it.
 * The same reading rule as `browseDriveFolder` applies. The portal never relays file content
 * (docs/INTEGRATIONS.md, section 3.2): the file opens at Google's address with the reader's own
 * Google permissions.
 */
export const previewDriveFileContract = {
  name: "previewDriveFile",
  input: z.strictObject({ linkId: idSchema, fileId: externalFileIdSchema.exactOptional() }),
  output: z.strictObject({ file: driveItemSchema }),
} as const satisfies CallableContract;

/** Asks Drive again for a linked item's metadata and access, for those who may link to its record. */
export const checkDriveLinkContract = {
  name: "checkDriveLink",
  input: z.strictObject({ linkId: idSchema }),
  output: z.strictObject({
    accessStatus: z.enum(["shared", "restricted", "unreachable"]),
    shareWith: z.string().max(LIMITS.shortText).nullable(),
  }),
} as const satisfies CallableContract;

const syncColumnInputSchema = z.strictObject({
  field: mapKeySchema,
  column: z.string().trim().min(1).max(LIMITS.shortText),
  direction: z.enum(SYNC_DIRECTIONS),
});

/**
 * Creates or changes a mapping of a sheet tab to a portal collection, for holders of
 * `integrations.manage`. The source and its tab must be registered, and the fields are checked
 * against the synchronisation targets, so a special-category or restricted field can never be
 * mapped. A new mapping starts as a dry run: live writes need `controlSyncMapping`.
 */
export const saveSyncMappingContract = {
  name: "saveSyncMapping",
  input: z.strictObject({
    /** The mapping to change. Absent to create one, whose identifier is derived from source, tab and collection. */
    mappingId: idSchema.exactOptional(),
    name: z.string().trim().min(1).max(LIMITS.shortText),
    sourceKey: keySchema,
    tabKey: keySchema,
    collectionKey: z.enum(SYNC_TARGET_KEYS as [SyncTargetKey, ...SyncTargetKey[]]),
    keyColumn: z.string().trim().min(1).max(LIMITS.shortText),
    columns: z.array(syncColumnInputSchema).min(1).max(100),
    sheetOnlyRows: z.enum(ROW_POLICIES.sheetOnly),
    appOnlyRecords: z.enum(ROW_POLICIES.appOnly),
    cellCeiling: z.number().int().min(1).max(5_000),
  }),
  output: z.strictObject({ mappingId: idSchema, created: z.boolean() }),
} as const satisfies CallableContract;

/**
 * Pauses or resumes a mapping, or moves it between dry run and live. `integrations.manage`
 * pauses, resumes and withdraws live approval. Approving live writes is a programme
 * administrator's act alone (docs/INTEGRATIONS.md, section 1), audited with its scope.
 */
export const controlSyncMappingContract = {
  name: "controlSyncMapping",
  input: z.strictObject({
    mappingId: idSchema,
    action: z.enum(["pause", "resume", "approveLive", "withdrawLive"]),
    reason: reasonSchema.exactOptional(),
  }),
  output: z.strictObject({ status: z.enum(["active", "paused", "needsAttention"]), mode: z.enum(["dryRun", "live"]) }),
} as const satisfies CallableContract;

/** Enqueues a run of a mapping now, in its current mode, for holders of `integrations.manage`. One queued run is enough. */
export const requestSyncRunContract = {
  name: "requestSyncRun",
  input: z.strictObject({ mappingId: idSchema }),
  output: z.strictObject({ runId: idSchema, alreadyQueued: z.boolean() }),
} as const satisfies CallableContract;

/** Retries a run that failed or was dead-lettered, or cancels one that has not started, for `integrations.manage`. */
export const controlSyncRunContract = {
  name: "controlSyncRun",
  input: z.strictObject({ runId: idSchema, action: z.enum(["retry", "cancel"]) }),
  output: z.strictObject({ status: z.enum(["queued", "cancelled"]) }),
} as const satisfies CallableContract;

/**
 * Resolves a conflict, for holders of `integrations.manage`: keep the portal value, keep the
 * value of the sheet or document, or keep a merged value. For a sheet the function writes the
 * one cell and the record and sets the base. If either side changed after the conflict was
 * recorded, nothing is written: the conflict is refreshed with the new values and the answer
 * says so. Every resolution is audited with the resolver.
 */
export const resolveSyncConflictContract = {
  name: "resolveSyncConflict",
  input: z.strictObject({
    conflictId: idSchema,
    resolution: z.enum(["keepApp", "keepSheet", "merged"]),
    /** For `merged`: the value to keep, as a person would type it in the sheet. */
    mergedValue: z.string().max(LIMITS.longText).exactOptional(),
    note: reasonSchema.exactOptional(),
  }),
  output: z.strictObject({ status: z.enum(["resolved", "refreshed"]) }),
} as const satisfies CallableContract;

/**
 * Settles a review item that a run raised, for `integrations.manage`: dismiss it, forget the
 * stored state of a row that has gone so that it is appended again on the next run, or clear
 * the mark of an unstable cell. Nothing is ever deleted from the sheet or the portal.
 */
export const resolveSyncReviewItemContract = {
  name: "resolveSyncReviewItem",
  input: z.strictObject({
    itemId: idSchema,
    action: z.enum(["dismiss", "forgetRow", "clearMark"]),
    note: reasonSchema,
  }),
  output: z.strictObject({ status: z.enum(["dismissed", "resolved"]) }),
} as const satisfies CallableContract;

/**
 * Creates or updates the generated document of a template for a record: the programme, a
 * replication or a laboratory. For `integrations.manage`, and for those who manage the record
 * (`replications.manage` or `labs.manage` for it). The work is a queued job, and the answer
 * names the record of the document and the run.
 */
export const generateDocumentContract = {
  name: "generateDocument",
  input: z
    .strictObject({
      /** The template, by its key: what an administrator of the integrations, who reads the templates, names. */
      templateKey: keySchema.exactOptional(),
      /** The template, by its kind: the template of that kind that is in use for the kind of record. */
      kind: z.enum(DOCUMENT_TEMPLATE_KINDS).exactOptional(),
      entityType: z.enum(["programme", "replication", "laboratory"]),
      entityId: idSchema,
    })
    .refine((input) => (input.templateKey === undefined) !== (input.kind === undefined), {
      error: "Name the template by its key or by its kind",
    }),
  output: z.strictObject({ generatedDocumentId: idSchema, runId: idSchema, alreadyQueued: z.boolean() }),
} as const satisfies CallableContract;

/**
 * Registers or changes a document template, for `integrations.manage`: the template document,
 * the shared-drive folder that receives copies, and whether it is in use. Moving a template to
 * live writes is a programme administrator's act alone.
 */
export const saveDocumentTemplateContract = {
  name: "saveDocumentTemplate",
  input: z.strictObject({
    key: keySchema,
    kind: z.enum(DOCUMENT_TEMPLATE_KINDS),
    name: z.string().trim().min(1).max(LIMITS.shortText),
    externalDocumentId: externalFileIdSchema,
    targetFolderId: externalFileIdSchema,
    enabled: z.boolean(),
    mode: z.enum(["dryRun", "live"]),
  }),
  output: z.strictObject({ key: keySchema, created: z.boolean() }),
} as const satisfies CallableContract;

/**
 * Acts on a connection, for `integrations.manage`: test it, pause or resume it, or open a new
 * Drive push channel before the old one expires. Naming the secret that holds a credential
 * needs `integrations.credentials`, and only the name is ever stored.
 */
export const controlIntegrationConnectionContract = {
  name: "controlIntegrationConnection",
  input: z.strictObject({
    system: z.enum(GOOGLE_SYSTEMS),
    action: z.enum(["test", "pause", "resume", "renewChannel", "setCredentialRef"]),
    credentialRef: secretNameSchema.exactOptional(),
  }),
  output: z.strictObject({
    status: integrationConnectionStatusSchema,
    message: z.string().max(LIMITS.longText),
  }),
} as const satisfies CallableContract;

// ===== Datasets =====
//
// The dataset registry (docs/DATA_MODEL.md, section 10). Every write goes through one of these
// functions. `datasets.manage` for the dataset's replication or laboratory lets a caller change
// a dataset; `datasets.paths.read` lets a caller read where its copies are, and every such read
// is recorded in the dataset's access events. Nothing here moves a file: a transfer is recorded
// and requested, and people carry it out with their institutions' own tools.

/**
 * The path of a copy below the base path of its server. The functions store it in normal form
 * (`normaliseStoragePath`); a path that could leave its folder, name the whole server or carry a
 * control character is refused.
 */
export const storagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .superRefine((path, context) => {
    const problem = storagePathProblem(path);
    if (problem !== null) context.addIssue({ code: "custom", message: problem });
  });

/** A value of the free metadata of a dataset: a text, a number or a yes or no. */
const metadataValueSchema = z.union([z.string().max(LIMITS.shortText), z.number(), z.boolean()]);
const metadataSchema = z
  .record(z.string().trim().min(1).max(100), metadataValueSchema)
  .refine((map) => Object.keys(map).length <= 100, { error: "Metadata holds at most 100 entries" });

/** One file of a manifest as a client states it. */
export const manifestFileInputSchema = z.strictObject({
  relativePath: z
    .string()
    .min(1)
    .max(1_024)
    .refine((path) => !hasControlCharacter(path), { error: "A path may not hold a control character" }),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).exactOptional(),
  checksumAlgorithm: z.string().min(1).max(32).exactOptional(),
  checksum: z.string().min(1).max(256).exactOptional(),
  modifiedAt: instantSchema.exactOptional(),
});
export type ManifestFileInput = z.output<typeof manifestFileInputSchema>;

/** The most files one call records. A larger manifest is listed by a scan, which writes it in chunks. */
export const MANIFEST_INPUT_MAX_FILES = 10_000;

const storageConnectionInputSchema = z.strictObject({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/, { error: "A host is a name of letters, digits, dots and hyphens" }),
  port: z.number().int().min(1).max(65_535).exactOptional(),
  basePath: storagePathSchema.exactOptional(),
  /** The name of the secret that holds the read-only credential, never the credential. */
  credentialRef: storageSecretNameSchema.exactOptional(),
  /**
   * The folder below the base path in which each replication or laboratory may name copies.
   * Absent, the folders stored for the server stay as they are.
   */
  allowedPrefixes: storageAllowedPrefixesSchema.exactOptional(),
});

/**
 * Registers or changes a storage server, for holders of `datasets.manage` for the programme.
 * The connection details are written where no client reads them, and naming a secret needs
 * `integrations.credentials` as well.
 */
export const saveStorageEndpointContract = {
  name: "saveStorageEndpoint",
  input: z.strictObject({
    key: keySchema,
    name: shortTextSchema,
    institutionId: idSchema.nullable(),
    ownerPersonId: idSchema.nullable(),
    protocol: storageProtocolSchema,
    scanMode: storageScanModeSchema,
    description: z.string().trim().max(LIMITS.longText),
    retired: z.boolean(),
    connection: storageConnectionInputSchema,
  }),
  output: z.strictObject({ key: keySchema, created: z.boolean() }),
} as const satisfies CallableContract;

/** Checks that a storage server answers, for holders of `datasets.manage` for the programme. */
export const checkStorageEndpointContract = {
  name: "checkStorageEndpoint",
  input: z.strictObject({ key: keySchema }),
  output: z.strictObject({
    status: storageEndpointStatusSchema,
    reachable: z.boolean(),
    message: z.string().max(LIMITS.longText),
  }),
} as const satisfies CallableContract;

/** Gives an administrator the connection details of a storage server to edit them. Audited. */
export const getStorageEndpointConnectionContract = {
  name: "getStorageEndpointConnection",
  input: z.strictObject({ key: keySchema }),
  output: z.strictObject({
    host: z.string().max(253),
    port: z.number().int().nullable(),
    basePath: z.string().max(1_024).nullable(),
    credentialRef: z.string().max(LIMITS.shortText).nullable(),
    allowedPrefixes: storageAllowedPrefixesSchema,
  }),
} as const satisfies CallableContract;

/** The first copy of a dataset, given when it is registered. */
const firstStorageInputSchema = z.strictObject({
  endpointKey: keySchema,
  role: storageRefRoleSchema,
  path: storagePathSchema,
  viewerSupport: z.array(viewerToolSchema).max(5),
});

/**
 * Registers a dataset, for holders of `datasets.manage` for its replication or its laboratory.
 * The key is the dataset's permanent identifier and must be new. The dataset starts in the first
 * state of its replication's workflow, and its first copy may be given at once. No file is moved
 * and no central copy is needed: a copy on an institutional server is enough, or none at all.
 */
export const registerDatasetContract = {
  name: "registerDataset",
  input: z.strictObject({
    datasetKey: keySchema,
    replicationId: studyKeySchema,
    laboratoryId: idSchema.nullable(),
    title: shortTextSchema,
    modality: datasetModalitySchema,
    groupingLabel: shortTextSchema.nullable(),
    sourceInstitutionId: idSchema.nullable(),
    storageOwnerPersonId: idSchema.nullable(),
    protocolId: idSchema.nullable(),
    expectedFileCount: z.number().int().min(0).max(10_000_000).nullable(),
    expectedParticipants: z.number().int().min(0).max(100_000).nullable(),
    metadata: metadataSchema,
    storage: firstStorageInputSchema.nullable(),
  }),
  output: z.strictObject({ datasetKey: keySchema, storageRefId: idSchema.nullable() }),
} as const satisfies CallableContract;

/**
 * Changes the descriptive fields of a dataset, its metadata and its BIDS conversion, for holders
 * of `datasets.manage`. A field that is absent stays as it is, and null clears it.
 */
export const updateDatasetContract = {
  name: "updateDataset",
  input: z.strictObject({
    datasetKey: keySchema,
    title: shortTextSchema.optional(),
    modality: datasetModalitySchema.optional(),
    groupingLabel: shortTextSchema.nullable().optional(),
    sourceInstitutionId: idSchema.nullable().optional(),
    storageOwnerPersonId: idSchema.nullable().optional(),
    protocolId: idSchema.nullable().optional(),
    expectedFileCount: z.number().int().min(0).max(10_000_000).nullable().optional(),
    expectedParticipants: z.number().int().min(0).max(100_000).nullable().optional(),
    bidsConversionStatus: bidsConversionStatusSchema.optional(),
    bidsVersion: z.string().trim().min(1).max(32).nullable().optional(),
    metadata: metadataSchema.optional(),
    bidsMissingMetadata: z.array(shortTextSchema).max(LIMITS.list).optional(),
    bidsNamingMap: z
      .array(z.strictObject({ source: shortTextSchema, bids: shortTextSchema }))
      .max(LIMITS.list)
      .optional(),
    archived: z.boolean().optional(),
  }),
  output: z.strictObject({ datasetKey: keySchema, changedFields: z.array(z.string()) }),
} as const satisfies CallableContract;

/**
 * Moves a dataset to another state of its replication's workflow, for holders of
 * `datasets.manage`. The call states the state the caller saw, the workflow must allow the move,
 * and the history entry is written in the same transaction.
 */
export const setDatasetStatusContract = {
  name: "setDatasetStatus",
  input: z.strictObject({
    datasetKey: keySchema,
    fromStatusKey: keySchema,
    toStatusKey: keySchema,
    reason: reasonSchema,
    /**
     * That the caller saw what the record says against a state that claims the dataset's checks
     * have passed (`datasetContradictions`) and moves it anyway. The problems are kept with the move.
     */
    acknowledgeContradictions: z.boolean().exactOptional(),
  }),
  output: z.strictObject({
    datasetKey: keySchema,
    statusKey: keySchema,
    statusHistoryId: idSchema,
    analysisReady: z.boolean(),
  }),
} as const satisfies CallableContract;

/**
 * Defines the workflow of the datasets of a replication, for holders of `replications.manage`.
 * A state that a dataset of the replication is in cannot be removed.
 */
export const saveDatasetWorkflowContract = {
  name: "saveDatasetWorkflow",
  input: z.strictObject({
    replicationId: studyKeySchema,
    states: z.array(datasetWorkflowStateSchema).min(2).max(DATASET_WORKFLOW_MAX_STATES),
    transitions: z.record(keySchema, z.array(keySchema).max(DATASET_WORKFLOW_MAX_STATES)),
    initialKey: keySchema,
  }),
  output: z.strictObject({ replicationId: studyKeySchema, created: z.boolean() }),
} as const satisfies CallableContract;

/** Adds a copy of a dataset on a storage server, for holders of `datasets.manage`. */
export const addStorageRefContract = {
  name: "addStorageRef",
  input: z.strictObject({
    datasetKey: keySchema,
    endpointKey: keySchema,
    role: storageRefRoleSchema,
    path: storagePathSchema,
    viewerSupport: z.array(viewerToolSchema).max(5),
    note: z.string().trim().max(LIMITS.longText),
  }),
  output: z.strictObject({ storageRefId: idSchema }),
} as const satisfies CallableContract;

/**
 * Changes a copy of a dataset, for holders of `datasets.manage`: its role, the viewers it
 * supports and its note; retires it; or relocates it, which closes it and opens a new copy at
 * the new place that names the old one, so the move stays in the history.
 */
export const changeStorageRefContract = {
  name: "changeStorageRef",
  input: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("update"),
      datasetKey: keySchema,
      storageRefId: idSchema,
      role: storageRefRoleSchema,
      viewerSupport: z.array(viewerToolSchema).max(5),
      note: z.string().trim().max(LIMITS.longText),
    }),
    z.strictObject({
      action: z.literal("retire"),
      datasetKey: keySchema,
      storageRefId: idSchema,
      reason: reasonSchema,
    }),
    z.strictObject({
      action: z.literal("relocate"),
      datasetKey: keySchema,
      storageRefId: idSchema,
      endpointKey: keySchema,
      path: storagePathSchema,
      reason: reasonSchema,
    }),
  ]),
  output: z.strictObject({ storageRefId: idSchema }),
} as const satisfies CallableContract;

/**
 * Scans a copy of a dataset, for holders of `datasets.manage`: lists its files with their sizes,
 * modification times and the checksums the server holds, without reading a recording, and
 * compares the listing with the expected manifest. A server that does not answer, refuses the
 * account or is too slow leaves the last listing in place and marks the copy unavailable.
 */
export const scanStorageRefContract = {
  name: "scanStorageRef",
  input: z.strictObject({ datasetKey: keySchema, storageRefId: idSchema }),
  output: z.strictObject({
    status: storageScanStatusSchema,
    manifestId: idSchema.nullable(),
    counts: z.partialRecord(manifestFileStatusSchema, z.number().int().min(0)),
    message: z.string().max(LIMITS.longText),
  }),
} as const satisfies CallableContract;

/**
 * Records a manifest by hand or from an uploaded file, for holders of `datasets.manage`: the
 * expected files of the dataset, or a listing of one copy made inside the institution. A listing
 * is compared with the latest expected manifest.
 */
export const recordManifestContract = {
  name: "recordManifest",
  input: z.strictObject({
    datasetKey: keySchema,
    kind: manifestKindSchema,
    storageRefId: idSchema.nullable(),
    origin: z.enum(["upload", "manual"]),
    files: z.array(manifestFileInputSchema).min(1).max(MANIFEST_INPUT_MAX_FILES),
  }),
  output: z.strictObject({
    manifestId: idSchema,
    counts: z.partialRecord(manifestFileStatusSchema, z.number().int().min(0)),
  }),
} as const satisfies CallableContract;

/**
 * Gives a holder of `datasets.paths.read` the location of a copy and how its server is reached,
 * and records the read in the dataset's access events and the audit trail.
 */
export const getStorageLocationContract = {
  name: "getStorageLocation",
  input: z.strictObject({ datasetKey: keySchema, storageRefId: idSchema }),
  output: z.strictObject({
    uri: z.string().max(LIMITS.url),
    endpointName: z.string().max(LIMITS.shortText),
    protocol: storageProtocolSchema,
    host: z.string().max(253).nullable(),
    port: z.number().int().nullable(),
    basePath: z.string().max(1_024).nullable(),
  }),
} as const satisfies CallableContract;

/** Saves the viewer link of a copy that declares support for the viewer, for holders of `datasets.manage`. */
export const saveViewerLinkContract = {
  name: "saveViewerLink",
  input: z.strictObject({ datasetKey: keySchema, storageRefId: idSchema, tool: viewerToolSchema, url: urlSchema }),
  output: z.strictObject({ linkId: idSchema }),
} as const satisfies CallableContract;

/** Gives a holder of `datasets.paths.read` the viewer link of a copy, and records the request. */
export const openViewerLinkContract = {
  name: "openViewerLink",
  input: z.strictObject({ datasetKey: keySchema, storageRefId: idSchema, tool: viewerToolSchema }),
  output: z.strictObject({ url: urlSchema }),
} as const satisfies CallableContract;

/**
 * Requests a transfer of a dataset from one copy to another, for holders of `datasets.manage`.
 * The portal moves nothing: the request waits for approval by someone else who manages the
 * dataset, and people carry the transfer out with their institutions' tools.
 */
export const requestTransferContract = {
  name: "requestTransfer",
  input: z.strictObject({ datasetKey: keySchema, fromRefId: idSchema, toRefId: idSchema, reason: reasonSchema }),
  output: z.strictObject({ transferId: idSchema }),
} as const satisfies CallableContract;

/**
 * Moves a transfer on, for holders of `datasets.manage`. Someone other than the requester
 * approves or refuses it. Once approved it is recorded as started, completed or failed, and a
 * completed transfer is verified when the latest listing of its destination matches the latest
 * listing of its source.
 */
export const advanceTransferContract = {
  name: "advanceTransfer",
  input: z.strictObject({
    datasetKey: keySchema,
    transferId: idSchema,
    action: z.enum(["approve", "refuse", "start", "complete", "fail", "verify"]),
    note: z.string().trim().max(LIMITS.longText),
    bytesTransferred: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  }),
  output: z.strictObject({ status: transferStatusSchema, approval: transferApprovalSchema }),
} as const satisfies CallableContract;

/** The largest bids-validator report one call takes, in characters. */
export const BIDS_REPORT_MAX_LENGTH = 4_000_000;

/**
 * Imports the JSON output of a bids-validator run, for holders of `datasets.manage`. The counts
 * go on the registry document and the condensed report, with the missing metadata, into its
 * restricted detail.
 */
export const importBidsReportContract = {
  name: "importBidsReport",
  input: z.strictObject({
    datasetKey: keySchema,
    report: z.string().min(2).max(BIDS_REPORT_MAX_LENGTH),
    validatorVersion: z.string().trim().min(1).max(64),
  }),
  output: z.strictObject({
    bidsStatus: bidsStatusSchema,
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    missingMetadataCount: z.number().int().min(0),
  }),
} as const satisfies CallableContract;

/** A parameter or a metric of an assessment: a text, a number or a yes or no. */
const qcValuesSchema = z
  .record(z.string().trim().min(1).max(100), metadataValueSchema)
  .refine((map) => Object.keys(map).length <= 100, { error: "At most 100 entries" });

/**
 * Records a quality-control assessment of a dataset or of one recording, for holders of
 * `datasets.manage`. Assessments never change: a correction is a new one that names the one it
 * replaces. The latest assessment of the dataset as a whole sets its QC status.
 */
export const recordQcAssessmentContract = {
  name: "recordQcAssessment",
  input: z.strictObject({
    datasetKey: keySchema,
    level: qcLevelSchema,
    recordingLabel: shortTextSchema.nullable(),
    tool: shortTextSchema.nullable(),
    toolVersion: z.string().trim().min(1).max(64).nullable(),
    pipelineVersion: z.string().trim().min(1).max(64).nullable(),
    parameters: qcValuesSchema,
    metrics: qcValuesSchema,
    outcome: qcOutcomeSchema,
    exclusions: z.array(qcExclusionSchema).max(LIMITS.list),
    deviationIds: idListSchema,
    notes: z.string().trim().max(LIMITS.longText),
    supersedesAssessmentId: idSchema.nullable(),
  }),
  output: z.strictObject({ assessmentId: idSchema, qcStatus: qcStatusSchema }),
} as const satisfies CallableContract;

/**
 * Registry of the reasons a function can give for a refusal, beside its message. The interface
 * uses a reason to offer the next step: to sign in again with the second factor, for example.
 *
 * | Reason                 | The caller                                                    |
 * |------------------------|---------------------------------------------------------------|
 * | `secondFactorRequired` | Must present the second factor in this session                |
 * | `emailNotVerified`     | Signed in with an address that the provider has not verified  |
 * | `notLinked`            | Has no linked person yet                                      |
 */
export const CALLABLE_ERROR_REASONS = ["secondFactorRequired", "emailNotVerified", "notLinked"] as const;
export type CallableErrorReason = (typeof CALLABLE_ERROR_REASONS)[number];

/**
 * The `details` of an error whose message a function wrote for the person using the portal.
 * The functions attach it to every error they raise on purpose, and the web client shows a
 * server message only when it is present. An error that the platform or a library produced
 * carries no such mark, so its text never reaches the interface.
 */
export const PUBLIC_ERROR_DETAILS = { public: true } as const;

/** The details of a public error that also states its reason. */
export function publicErrorDetails(reason: CallableErrorReason | null): {
  readonly public: true;
  readonly reason?: CallableErrorReason;
} {
  return reason === null ? PUBLIC_ERROR_DETAILS : { ...PUBLIC_ERROR_DETAILS, reason };
}

export function isPublicErrorDetails(details: unknown): boolean {
  return typeof details === "object" && details !== null && (details as { public?: unknown }).public === true;
}

/** The reason that the details of a public error state, or null. */
export function publicErrorReason(details: unknown): CallableErrorReason | null {
  if (!isPublicErrorDetails(details)) return null;
  const reason = (details as { reason?: unknown }).reason;
  return (CALLABLE_ERROR_REASONS as readonly unknown[]).includes(reason) ? (reason as CallableErrorReason) : null;
}
