// Contracts of the callable functions. The web client and the functions both import these, so
// a function's name, input and output are declared once and cannot drift apart.
//
// Every function below requires a signed-in caller whose account is in good standing. Where a
// row of a table names a capability, the function reads the caller's access document and asks
// `can` for it, and it also asks for the caller's second factor wherever that access document
// says one is required. A time crosses the wire as an ISO 8601 text with an offset.
import { grantableCapabilitySchema, roleSchema, roleScopeTypeSchema } from "./capabilities";
import { entityTypeSchema } from "./entities";
import { hasValidOrcidCheckDigit } from "./identifiers";
import { nameFold } from "./ids";
import {
  countryCodeSchema,
  idListSchema,
  idSchema,
  keySchema,
  LIMITS,
  orcidSchema,
  shortTextSchema,
  uidSchema,
  urlSchema,
} from "./schemas/base";
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
import { reconciliationStatusSchema } from "./schemas/provenance";
import { replicationMembershipRoleSchema, reviewStatusSchema, studyKeySchema } from "./schemas/replications";
import { auditActionSchema, auditActorKindSchema } from "./schemas/system";
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
