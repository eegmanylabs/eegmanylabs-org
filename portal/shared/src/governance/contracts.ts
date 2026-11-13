// Contracts of the callable functions of governance (docs/SECURITY.md, section 6): the export of
// everything held about one person, the erasure of a person on the approval of a second
// administrator, the periodic access review with its attestations, and the retention sweeps.
// Every one is for programme administrators with the second factor, and writes an audit entry.
// A time crosses the wire as ISO 8601 text with an offset, as in callables.ts.
import type { CallableContract, CallableOutput } from "../callables";
import { roleSchema, roleScopeTypeSchema } from "../capabilities";
import { programmeDecisionSchema } from "../programme-answers";
import { idSchema, uidSchema } from "../schemas/base";
import { roleAssignmentStatusSchema } from "../schemas/identity";
import {
  erasureRequestStatusSchema,
  RETENTION_OUTCOMES_MAX,
  retentionOutcomeSchema,
  reviewPeriodSchema,
} from "../schemas/system";
import { z } from "../zod";
import {
  consentWordingVersionSchema,
  DEMOGRAPHICS_CONSENT_STATUSES,
  demographicsConsentStatusSchema,
  OWN_WORDS_MAX,
} from "./demographics-consent";
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, RETENTION_TARGETS } from "./retention";

const instantSchema = z.iso.datetime({ offset: true });
const noteSchema = z.string().trim().max(2_000).nullable();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const retentionTargetSchema = z.enum(RETENTION_TARGETS);

/** The most documents one export returns. An export that reaches it says so. */
export const PERSON_EXPORT_MAX_DOCUMENTS = 5_000;

/**
 * Everything the portal holds about one person, as JSON: the directory entry and its restricted
 * documents, affiliations, the entries of laboratories, replications and participations, the
 * contributor rows, the accounts linked to the person with their own documents, roles, grants,
 * claims and requests, and the audit entries by or about them. The special-category document is
 * included only while the caller holds an unexpired named grant of `demographics.read`.
 */
export const exportPersonDataContract = {
  name: "exportPersonData",
  input: z.strictObject({ personId: idSchema }),
  output: z.strictObject({
    personId: idSchema,
    exportedAt: instantSchema,
    specialCategoryIncluded: z.boolean(),
    truncated: z.boolean(),
    documents: z.array(z.strictObject({ path: z.string(), data: z.json() })).max(PERSON_EXPORT_MAX_DOCUMENTS),
    accounts: z
      .array(
        z.strictObject({
          uid: uidSchema,
          email: z.string().nullable(),
          emailVerified: z.boolean(),
          disabled: z.boolean(),
          createdAt: instantSchema.nullable(),
          lastSignInAt: instantSchema.nullable(),
        }),
      )
      .max(20),
  }),
} as const satisfies CallableContract;
export type ExportPersonDataOutput = CallableOutput<typeof exportPersonDataContract>;

/**
 * Gives or withdraws the caller's consent to the portal holding their gender and ethnicity
 * (`./demographics-consent.ts`). For a member whose account is linked to their person. Consent
 * is given only to the current wording, which the call names so that the record states what the
 * person read. A withdrawal deletes the values at once, with the copies that an import keeps for
 * a rollback, in the transaction that records it. Each act is audited without a value.
 */
export const setDemographicsConsentContract = {
  name: "setDemographicsConsent",
  input: z.strictObject({
    status: z.enum(DEMOGRAPHICS_CONSENT_STATUSES),
    wordingVersion: consentWordingVersionSchema,
  }),
  output: z.strictObject({
    personId: idSchema,
    status: demographicsConsentStatusSchema,
    at: instantSchema,
    /** For a withdrawal: whether a document of values was deleted. */
    valuesDeleted: z.boolean(),
  }),
} as const satisfies CallableContract;

const ownWordsSchema = z.string().trim().max(OWN_WORDS_MAX).nullable();

/**
 * Saves the caller's own gender and ethnicity in their own words, and confirms the terms that
 * were recorded for them, while their consent is in force. A value of null or an empty text
 * removes what the field held. Audited with the names of the fields and no value.
 */
export const saveOwnDemographicsContract = {
  name: "saveOwnDemographics",
  input: z.strictObject({
    genderSelfDescribed: ownWordsSchema,
    ethnicitySelfDescribed: ownWordsSchema,
    /** True when the person confirms the recorded terms as their own. */
    confirmRecorded: z.boolean(),
  }),
  output: z.strictObject({
    personId: idSchema,
    /** False when nothing is held any more, because every field was empty. */
    held: z.boolean(),
  }),
} as const satisfies CallableContract;

/** Asks for the erasure of one person. Another programme administrator decides it. */
export const requestErasureContract = {
  name: "requestErasure",
  input: z.strictObject({ personId: idSchema, reason: z.string().trim().min(1).max(2_000) }),
  output: z.strictObject({ requestId: idSchema }),
} as const satisfies CallableContract;

/**
 * Approves or rejects a request. Approval applies the erasure: the restricted and
 * special-category documents of the person go, the directory entry keeps its identifier and is
 * anonymised and archived, the identity keys become tombstones and the values of the person in
 * source records and batch changes become a marker. The audit trail keeps every entry, and the
 * values of entries about the person become a marker. An approved request that was interrupted
 * is applied again by approving it again.
 */
export const decideErasureContract = {
  name: "decideErasure",
  input: z.strictObject({ requestId: idSchema, decision: z.enum(["approve", "reject"]), note: noteSchema }),
  output: z.strictObject({
    status: erasureRequestStatusSchema,
    appliedCounts: z.record(z.string().max(100), z.number().int().min(0)),
  }),
} as const satisfies CallableContract;

export const listErasureRequestsContract = {
  name: "listErasureRequests",
  input: z.strictObject({}),
  output: z.strictObject({
    requests: z
      .array(
        z.strictObject({
          requestId: idSchema,
          personId: idSchema,
          personName: z.string().nullable(),
          reason: z.string(),
          status: erasureRequestStatusSchema,
          requestedBy: uidSchema,
          requestedAt: instantSchema,
          decidedBy: uidSchema.nullable(),
          decidedAt: instantSchema.nullable(),
          decisionNote: z.string().nullable(),
          appliedAt: instantSchema.nullable(),
          appliedCounts: z.record(z.string().max(100), z.number().int().min(0)),
        }),
      )
      .max(200),
  }),
} as const satisfies CallableContract;
export type ListedErasureRequest = CallableOutput<typeof listErasureRequestsContract>["requests"][number];

/** Grants that end within this many days are marked as expiring in the access review. */
export const ACCESS_REVIEW_EXPIRING_DAYS = 30;

/** The most accounts one access review lists. A review that reaches it says so and cannot be attested. */
export const ACCESS_REVIEW_ACCOUNTS_MAX = 2_000;

/**
 * The periodic access review: every account that holds a role, a grant, the membership of a
 * group or the confirmed membership of a replication team, what it holds, who appointed it,
 * when it last signed in and which grants end soon; the overrides of the capability matrix,
 * which change what every holder of a role may do; and the attestations of the current period.
 * The hash of the listing binds an attestation to what the reviewer saw, overrides included.
 */
export const getAccessReviewContract = {
  name: "getAccessReview",
  input: z.strictObject({}),
  output: z.strictObject({
    period: reviewPeriodSchema,
    listingSha256: sha256Schema,
    accounts: z
      .array(
        z.strictObject({
          uid: uidSchema,
          name: z.string().nullable(),
          suspended: z.boolean(),
          lastSignInAt: instantSchema.nullable(),
          roles: z
            .array(
              z.strictObject({
                role: roleSchema,
                scopeType: roleScopeTypeSchema,
                scopeId: z.string(),
                status: roleAssignmentStatusSchema,
                /** Who granted the role: an account, or trusted code; null while it awaits approval. */
                grantedBy: z.string().nullable(),
                expiresAt: instantSchema.nullable(),
                expiringSoon: z.boolean(),
              }),
            )
            .max(200),
          /** Groups whose shared records the account reads, with its role in each. */
          groups: z.array(z.strictObject({ groupId: idSchema, name: z.string(), role: z.string() })).max(200),
          /** Replications whose records the account reads through a confirmed team membership. */
          teamReplicationIds: z.array(idSchema).max(200),
          grants: z
            .array(
              z.strictObject({
                kind: z.enum(["capability", "record"]),
                name: z.string(),
                expiresAt: instantSchema.nullable(),
                expiringSoon: z.boolean(),
              }),
            )
            .max(200),
        }),
      )
      .max(ACCESS_REVIEW_ACCOUNTS_MAX),
    /** True when more accounts hold rights than one review lists. Such a listing cannot be attested. */
    truncated: z.boolean(),
    /** The overrides of the default capability matrix, role by role. */
    overrides: z.array(z.strictObject({ role: roleSchema, capability: z.string(), allowed: z.boolean() })).max(500),
    attestations: z
      .array(
        z.strictObject({
          reviewerUid: uidSchema,
          attestedAt: instantSchema,
          matchesCurrentListing: z.boolean(),
          note: z.string().nullable(),
        }),
      )
      .max(100),
  }),
} as const satisfies CallableContract;
export type AccessReview = CallableOutput<typeof getAccessReviewContract>;

/** Records that the caller reviewed the listing of the current period whose hash they name. */
export const attestAccessReviewContract = {
  name: "attestAccessReview",
  input: z.strictObject({ period: reviewPeriodSchema, listingSha256: sha256Schema, note: noteSchema }),
  output: z.strictObject({ period: reviewPeriodSchema, attestedAt: instantSchema }),
} as const satisfies CallableContract;

const retentionRunSchema = z.strictObject({
  runId: idSchema,
  trigger: z.enum(["schedule", "manual"]),
  dryRun: z.boolean(),
  startedAt: instantSchema,
  outcomes: z.array(retentionOutcomeSchema).max(RETENTION_OUTCOMES_MAX),
});
export type RetentionRun = z.output<typeof retentionRunSchema>;

const periodsSchema = z.record(retentionTargetSchema, z.number().int().nullable());

/** The configured periods, null where none is, and the latest sweeps. */
/**
 * The retention of the raw material of the migration, which the programme decided
 * (docs/MIGRATION_PLAN.md, section 11, questions 20 and 21): kept until an administrator marks
 * the migration verified, and for three years after; then the outreach records of source F for
 * people who never joined are deleted. Every other raw record and export file is kept, and
 * nothing deletes them.
 */
const migrationRetentionSchema = z.strictObject({
  /** When the migration was marked verified, or null while it is not. */
  verifiedAt: z.iso.datetime().nullable(),
  /** The account of the administrator who marked it, or null while it is not marked. */
  verifiedBy: uidSchema.nullable(),
  /** The instant from which the outreach records of people who never joined may be deleted, or null while unverified. */
  deletableFrom: z.iso.datetime().nullable(),
  /** The decision that the retention follows. */
  decision: programmeDecisionSchema,
});
export type MigrationRetention = z.output<typeof migrationRetentionSchema>;

export const getRetentionContract = {
  name: "getRetention",
  input: z.strictObject({}),
  output: z.strictObject({
    periods: periodsSchema,
    runs: z.array(retentionRunSchema).max(20),
    migration: migrationRetentionSchema,
  }),
} as const satisfies CallableContract;

/**
 * Marks the migration verified, which starts the three years after which the outreach records
 * of people who never joined are deleted. For a programme administrator with the second factor. A
 * later mark, with its reason, moves the start to the moment it is made: the three years can be
 * made to start later and never earlier, so a mistaken mark only lengthens what is kept.
 */
export const markMigrationVerifiedContract = {
  name: "markMigrationVerified",
  input: z.strictObject({ note: z.string().trim().min(1).max(2_000) }),
  output: migrationRetentionSchema,
} as const satisfies CallableContract;
export type RetentionOverview = CallableOutput<typeof getRetentionContract>;

/** Sets or clears the period of one target. Clearing it means that the target is never swept. */
export const setRetentionPeriodContract = {
  name: "setRetentionPeriod",
  input: z.strictObject({
    target: retentionTargetSchema,
    days: z.number().int().min(RETENTION_MIN_DAYS).max(RETENTION_MAX_DAYS).nullable(),
  }),
  output: z.strictObject({ periods: periodsSchema }),
} as const satisfies CallableContract;

/** Runs a sweep now. A dry run counts what would go and deletes nothing. */
export const runRetentionSweepContract = {
  name: "runRetentionSweep",
  input: z.strictObject({ dryRun: z.boolean() }),
  output: retentionRunSchema,
} as const satisfies CallableContract;
