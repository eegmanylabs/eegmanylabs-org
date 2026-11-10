// Contracts of the callable functions. The web client and the functions both import these, so
// a function's name, input and output are declared once and cannot drift apart.
//
// Every function below requires a signed-in caller whose account is in good standing. Where a
// row of a table names a capability, the function reads the caller's access document and asks
// `can` for it, and it also asks for the caller's second factor wherever that access document
// says one is required. A time crosses the wire as an ISO 8601 text with an offset.
import { grantableCapabilitySchema, roleSchema, roleScopeTypeSchema } from "./capabilities";
import { hasValidOrcidCheckDigit } from "./identifiers";
import { idSchema, orcidSchema, shortTextSchema, uidSchema } from "./schemas/base";
import {
  claimMatchBasisSchema,
  claimStatusSchema,
  correctionRequestStatusSchema,
  labClaimRoleSchema,
  roleAssignmentStatusSchema,
  userStatusSchema,
} from "./schemas/identity";
import { laboratoryMemberRoleSchema, laboratoryMemberStatusSchema } from "./schemas/programme";
import { replicationMembershipRoleSchema, reviewStatusSchema } from "./schemas/replications";
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
    z.strictObject({ status: z.literal("pendingReview") }),
    z.strictObject({ status: z.literal("rejected") }),
    z.strictObject({ status: z.literal("noMatch") }),
  ]),
} as const satisfies CallableContract;
export type ClaimProfileOutput = CallableOutput<typeof claimProfileContract>;

/**
 * Asks a reviewer for access on behalf of a signed-in caller whose address matched nobody. One
 * request may be open per account. The answer is always `pendingReview`.
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
});

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
          candidates: z.array(claimCandidateSchema).max(50),
          /** What the claimant wrote, for a request made with `requestAccess`. */
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
 * another account has claimed.
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
 * A caller never changes an assignment of `programme_admin` to their own account, and the last
 * active programme administrator is never revoked.
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
 * A grant of `demographics.read` must carry an expiry time.
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
 * suspends their own account, and the last active programme administrator is never suspended.
 */
export const setUserStatusContract = {
  name: "setUserStatus",
  input: z.strictObject({ uid: uidSchema, status: userStatusSchema, reason: reasonSchema }),
  output: z.strictObject({ uid: uidSchema, status: userStatusSchema }),
} as const satisfies CallableContract;

/**
 * Asks to represent a laboratory. For a member whose account is linked to a person. One request
 * per account and laboratory may be open. The evidence is computed on the server.
 */
export const requestLabClaimContract = {
  name: "requestLabClaim",
  input: z.strictObject({
    laboratoryId: idSchema,
    requestedRole: labClaimRoleSchema,
    message: reasonSchema.exactOptional(),
  }),
  output: z.strictObject({ claimId: idSchema, status: z.literal("pendingReview") }),
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
 * Records the outcome of a correction request and notifies whoever made it. Capability:
 * `people.manage`. The function records the decision. It does not edit the record.
 */
export const resolveCorrectionRequestContract = {
  name: "resolveCorrectionRequest",
  input: z.strictObject({
    requestId: idSchema,
    outcome: correctionRequestStatusSchema.extract(["accepted", "rejected"]),
    /** A sentence for the person who asked, shown in their notification. */
    messageToRequester: z.string().trim().min(1).max(500).exactOptional(),
  }),
  output: z.strictObject({
    requestId: idSchema,
    status: correctionRequestStatusSchema.extract(["accepted", "rejected"]),
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
