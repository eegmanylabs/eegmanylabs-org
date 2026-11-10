// Identity and access (docs/DATA_MODEL.md, section 3): logins, what a login may do, claims,
// persons and the lookups that find a person, a laboratory or an institution again.
import {
  capabilityFieldSchema,
  grantableCapabilitySchema,
  programmeRoleSchema,
  roleSchema,
  roleScopeTypeSchema,
} from "../capabilities";
import { dataOriginSchema } from "../data-origin";
import { entityTypeSchema } from "../entities";
import { DISPLAY_NAME_MAX_LENGTH, normaliseEmail } from "../identifiers";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  boundedRecord,
  countryCodeSchema,
  customValuesSchema,
  documentBaseSchema,
  entityRefShape,
  freeMapSchema,
  idListSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  mapKeySchema,
  orcidSchema,
  provenanceShape,
  scopeKeySchema,
  scopeKeysSchema,
  shortTextSchema,
  uidListSchema,
  uidSchema,
  urlSchema,
  verbatimSchema,
} from "./base";

/**
 * | Status      | Meaning                                              |
 * |-------------|------------------------------------------------------|
 * | `active`    | The account may use the portal                       |
 * | `suspended` | An administrator has stopped the account from acting |
 *
 * The status is the copy of the suspension that the account's profile shows. The copy that
 * security rules and functions enforce is `suspended` in `access/{uid}`. Trusted code changes
 * the two together.
 */
export const USER_STATUSES = ["active", "suspended"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.output<typeof userStatusSchema>;

/** `users/{uid}`: the profile of one Firebase Authentication account. Maintained by functions. */
export const userDocSchema = documentBaseSchema.extend({
  /** The verified sign-in address in canonical form (see `normaliseEmail`). */
  emailLower: z.string().min(3).max(320),
  /**
   * The name the account gives itself, normalised with `normaliseDisplayName`. Any signed-in
   * account can choose it, so it never identifies anyone and is never shown as verified.
   */
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).nullable(),
  /** The person profile this account has claimed, or null while it has claimed none. */
  personId: idSchema.nullable(),
  status: userStatusSchema,
  /** Whether the account has enrolled a second factor. */
  mfaEnrolled: z.boolean(),
  /** When the portal last started with this account signed in. */
  lastSeenAt: timestampSchema,
  /** Demonstration accounts are labelled, so that they are never mistaken for members. */
  dataOrigin: dataOriginSchema,
});
export type UserDoc = z.output<typeof userDocSchema>;

/** `users/{uid}/favourites/{entityType__entityId}`: a record the user has marked. */
export const userFavouriteDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  ...entityRefShape,
});
export type UserFavouriteDoc = z.output<typeof userFavouriteDocSchema>;

/** `users/{uid}/recents/{entityType__entityId}`: a record the user has opened. `updatedAt` is the latest visit. */
export const userRecentDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  ...entityRefShape,
});
export type UserRecentDoc = z.output<typeof userRecentDocSchema>;

export const notificationTypeSchema = z.enum([
  "mention",
  "assignment",
  "comment",
  "statusChange",
  "dueSoon",
  "overdue",
  "reminder",
  "claimDecision",
  "roleDecision",
  "protocolUpdate",
  "milestone",
  "integrationFailure",
]);
export type NotificationType = z.output<typeof notificationTypeSchema>;

/** `users/{uid}/notifications/{id}`: written by functions. The user may set `readAt` and nothing else. */
export const userNotificationDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  type: notificationTypeSchema,
  ...entityRefShape,
  /** The event, or the reminder, that caused the notification. */
  eventId: idSchema,
  payload: freeMapSchema,
  readAt: timestampSchema.nullable(),
  emailedAt: timestampSchema.nullable(),
});
export type UserNotificationDoc = z.output<typeof userNotificationDocSchema>;

export const subscriptionLevelSchema = z.enum(["all", "mentions", "none"]);

/** `users/{uid}/subscriptions/{entityType__entityId}`: how closely the user follows a record. */
export const userSubscriptionDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  ...entityRefShape,
  level: subscriptionLevelSchema,
});
export type UserSubscriptionDoc = z.output<typeof userSubscriptionDocSchema>;

export const digestFrequencySchema = z.enum(["off", "daily", "weekly"]);

const clockTimeSchema = z
  .string()
  .max(5)
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { error: "Expected a time such as 22:30" });

/** `users/{uid}/settings/preferences`: the notification preferences of one user. */
export const userPreferencesDocSchema = documentBaseSchema.extend({
  channels: z.strictObject({ inApp: z.boolean(), email: z.boolean() }),
  digestFrequency: digestFrequencySchema,
  quietHours: z
    .strictObject({
      start: clockTimeSchema,
      end: clockTimeSchema,
      /** An IANA time zone name, for example `Europe/London`. */
      timeZone: z.string().min(1).max(64),
    })
    .nullable(),
  typeSwitches: z.partialRecord(notificationTypeSchema, z.boolean()),
});
export type UserPreferencesDoc = z.output<typeof userPreferencesDocSchema>;

export const pendingRoleSchema = z.strictObject({
  role: roleSchema,
  scopeType: roleScopeTypeSchema,
  scopeId: idSchema,
});
export type PendingRole = z.output<typeof pendingRoleSchema>;

/** The scopes in which an account holds a capability. `programme` means everywhere. */
export const capabilityScopesSchema = z.array(scopeKeySchema).min(1).max(LIMITS.list);

/** A record key of the form `entityType__entityId`, as `entityRefId` builds it. */
const recordKeySchema = idSchema;

/**
 * `access/{uid}`: the resolved access set of one account. Security rules and functions read
 * this document on every request, so it is the authority for authorisation, and a change to it
 * takes effect on the next request. Only functions write it, with the result of `resolveAccess`.
 */
export const accessDocSchema = documentBaseSchema.extend({
  /** True once the account is an approved member. An account whose only role is `external_collaborator` is none. */
  member: z.boolean(),
  /** The person profile this account is linked to, or null while it is unlinked. */
  personId: idSchema.nullable(),
  /** The programme roles the account holds. The rules grant what they imply only while `mfaEnrolled` is true. */
  programmeRoles: z.array(programmeRoleSchema).max(2),
  leadReplicationIds: idListSchema,
  /** Replications in which the linked person has a confirmed membership in a role other than lead: read scope alone. */
  teamReplicationIds: idListSchema,
  coordinatorLaboratoryIds: idListSchema,
  memberLaboratoryIds: idListSchema,
  /**
   * The replications and the laboratories for which the account holds `people.contact.read`
   * through a role of its own there. A rule compares them with the units that the directory
   * document of a person names, which it could not do with the scope keys of `capabilities`.
   */
  contactReplicationIds: idListSchema,
  contactLaboratoryIds: idListSchema,
  groupKeys: idListSchema,
  /** Every scope key the account holds, in the forms of `scopeKeySchema`. */
  scopeKeys: scopeKeysSchema,
  /** The keys of the replications the account leads and the laboratories it coordinates. */
  manageScopeKeys: scopeKeysSchema,
  /** The records shared with the account through `recordGrants`, each as `entityType__entityId`. */
  sharedRecordKeys: z.array(recordKeySchema).max(LIMITS.list),
  /** Those of the shared records that the account may also edit. */
  editableRecordKeys: z.array(recordKeySchema).max(LIMITS.list),
  /** Roles that await approval. They confer nothing and are listed so that the interface can say so. */
  pendingRoles: z.array(pendingRoleSchema).max(LIMITS.list),
  /**
   * The capabilities the account holds, keyed in camelCase (`demographicsRead` for
   * `demographics.read`), each with the scope keys in which it holds. Read it with `can`.
   */
  capabilities: z.partialRecord(capabilityFieldSchema, capabilityScopesSchema),
  /**
   * Whether the second factor of the account is in place: the account has enrolled one, or the
   * system setting `requireSecondFactor` waives it for a holder of a programme role or of a
   * named grant. The security rules grant the powers of a programme role only beside it.
   */
  mfaEnrolled: z.boolean(),
  /**
   * True when the account holds a programme role or a named capability grant and must
   * therefore enrol a second factor and present it in the session. Until it has enrolled one,
   * those powers are withheld from `capabilities` and `scopeKeys`. False for such an account
   * only while `requireSecondFactor` of `system/settings` is false.
   */
  secondFactorRequired: z.boolean(),
  /**
   * Sessions that began before this instant are refused, which is how every session of an
   * account is ended at once. Null while no such instant has been set.
   */
  sessionsValidAfter: timestampSchema.nullable(),
  /** True while an administrator has stopped the account from acting. A suspended account is refused everything. */
  suspended: z.boolean(),
});
export type AccessDoc = z.output<typeof accessDocSchema>;

export const roleAssignmentStatusSchema = z.enum(["pendingApproval", "active", "revoked", "expired"]);
export type RoleAssignmentStatus = z.output<typeof roleAssignmentStatusSchema>;

const grantPeriodShape = {
  grantedBy: actorSchema.nullable(),
  grantedAt: timestampSchema.nullable(),
  expiresAt: timestampSchema.nullable(),
  revokedBy: actorSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  reason: longTextSchema.exactOptional(),
};

/** An earlier period of a role assignment that has since been granted again. */
export const roleAssignmentPeriodSchema = z.strictObject({ status: roleAssignmentStatusSchema, ...grantPeriodShape });

/**
 * `roleAssignments/{uid__role__scopeType__scopeId}`: the source of truth for roles, which are
 * grants to logins. A role implied by imported data starts as `pendingApproval` (D-005).
 */
export const roleAssignmentDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  role: roleSchema,
  scopeType: roleScopeTypeSchema,
  scopeId: idSchema,
  status: roleAssignmentStatusSchema,
  ...grantPeriodShape,
  history: z.array(roleAssignmentPeriodSchema).max(LIMITS.list),
});
export type RoleAssignmentDoc = z.output<typeof roleAssignmentDocSchema>;

/** `roleCapabilities/{role}`: overrides of the default capability matrix for one role. */
export const roleCapabilitiesDocSchema = documentBaseSchema.extend({
  role: roleSchema,
  /** Capability, keyed in camelCase, to whether the role holds it. A capability that is absent follows the default. */
  overrides: z.partialRecord(capabilityFieldSchema, z.boolean()),
});
export type RoleCapabilitiesDoc = z.output<typeof roleCapabilitiesDocSchema>;

const capabilityGrantPeriodShape = {
  grantedBy: actorSchema,
  grantedAt: timestampSchema,
  reason: longTextSchema,
  expiresAt: timestampSchema.nullable(),
  revokedBy: actorSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
};

/** `capabilityGrants/{uid__capability}`: a named capability granted to one user, with a reason. */
export const capabilityGrantDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  capability: grantableCapabilitySchema,
  ...capabilityGrantPeriodShape,
  history: z.array(z.strictObject(capabilityGrantPeriodShape)).max(LIMITS.list),
});
export type CapabilityGrantDoc = z.output<typeof capabilityGrantDocSchema>;

export const recordGrantLevelSchema = z.enum(["view", "edit"]);

/**
 * `recordGrants/{uid__entityType__entityId}`: a record shared with one user. A grant covers
 * the record itself and none of its restricted or scoped children.
 */
export const recordGrantDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  ...entityRefShape,
  level: recordGrantLevelSchema,
  grantedBy: actorSchema,
  grantedAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  reason: longTextSchema.exactOptional(),
});
export type RecordGrantDoc = z.output<typeof recordGrantDocSchema>;

export const groupKindSchema = z.enum(["replicationTeam", "labTeam", "workingGroup", "custom"]);
export const groupMemberRoleSchema = z.enum(["manager", "member"]);

/** `groups/{groupKey}`: directory fields of a group. Its roles are unrelated to those of `roleAssignments`. */
export const groupDocSchema = documentBaseSchema.extend({
  groupKey: keySchema,
  kind: groupKindSchema,
  name: shortTextSchema,
  replicationId: idSchema.nullable(),
  laboratoryId: idSchema.nullable(),
  /** The root page of the group's workspace. */
  pageId: idSchema.nullable(),
  memberUids: uidListSchema,
  roles: boundedRecord(mapKeySchema, groupMemberRoleSchema),
  /** Members who have no login yet. */
  unclaimedPersonIds: idListSchema,
});
export type GroupDoc = z.output<typeof groupDocSchema>;

export const externalAccountOwnerTypeSchema = z.enum(["person", "group", "laboratory", "replication"]);
export const externalSystemSchema = z.enum(["cloud", "bids", "eegnet", "sftp", "osf", "github", "google", "quire"]);

/** `externalAccounts/{id}`: an account name in an external system. Never a secret. */
export const externalAccountDocSchema = documentBaseSchema.extend({
  ownerType: externalAccountOwnerTypeSchema,
  ownerId: idSchema,
  system: externalSystemSchema,
  accountName: shortTextSchema,
  notes: longTextSchema.exactOptional(),
  scopeKeys: scopeKeysSchema,
  ...provenanceShape,
});
export type ExternalAccountDoc = z.output<typeof externalAccountDocSchema>;

/** `invitations/{id}`: an invitation to an address. Only its token hash is stored. */
export const invitationDocSchema = documentBaseSchema.extend({
  email: z.email().max(320),
  personId: idSchema.nullable(),
  role: roleSchema,
  scopeType: roleScopeTypeSchema,
  scopeId: idSchema,
  tokenHash: z
    .string()
    .max(64)
    .regex(/^[0-9a-f]{64}$/, { error: "Expected a SHA-256 hash in hexadecimal" }),
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  invitedBy: actorSchema,
  revokedAt: timestampSchema.nullable(),
});
export type InvitationDoc = z.output<typeof invitationDocSchema>;

export const claimStatusSchema = z.enum(["pendingReview", "approved", "rejected", "withdrawn"]);
export type ClaimStatus = z.output<typeof claimStatusSchema>;

/** `accountClaims/{uid}`: what a user may know of their own claim. */
export const accountClaimDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  status: claimStatusSchema,
  /** Set on approval. */
  personId: idSchema.nullable(),
  submittedAt: timestampSchema,
});
export type AccountClaimDoc = z.output<typeof accountClaimDocSchema>;

export const claimMatchBasisSchema = z.enum(["primaryEmail", "secondaryEmail", "invitation", "manual"]);

const claimDecisionShape = {
  reviewedBy: actorSchema.nullable(),
  reviewedAt: timestampSchema.nullable(),
  decisionNote: longTextSchema.exactOptional(),
};

/** `accountClaims/{uid}/private/review`: the evidence and the decision, for reviewers. */
export const accountClaimReviewDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  candidatePersonIds: idListSchema,
  matchBasis: claimMatchBasisSchema,
  evidence: freeMapSchema,
  ...claimDecisionShape,
  /** The earlier attempts of the same login. */
  history: z
    .array(z.strictObject({ status: claimStatusSchema, matchBasis: claimMatchBasisSchema, ...claimDecisionShape }))
    .max(LIMITS.list),
});
export type AccountClaimReviewDoc = z.output<typeof accountClaimReviewDocSchema>;

export const labClaimRoleSchema = z.enum(["coordinator", "representative"]);

/** `labClaims/{uid__laboratoryId}`: a request by a claimed member to represent a laboratory. */
export const labClaimDocSchema = documentBaseSchema.extend({
  laboratoryId: idSchema,
  uid: uidSchema,
  requestedRole: labClaimRoleSchema,
  status: claimStatusSchema,
  submittedAt: timestampSchema,
});
export type LabClaimDoc = z.output<typeof labClaimDocSchema>;

/** `labClaims/{claimId}/private/review`: the evidence and the decision of a laboratory claim. */
export const labClaimReviewDocSchema = documentBaseSchema.extend({
  /** Includes the affiliation match and the institutional email domain. */
  evidence: freeMapSchema,
  ...claimDecisionShape,
  /** The earlier requests of the same user for the same laboratory. */
  history: z
    .array(z.strictObject({ status: claimStatusSchema, requestedRole: labClaimRoleSchema, ...claimDecisionShape }))
    .max(LIMITS.list),
});
export type LabClaimReviewDoc = z.output<typeof labClaimReviewDocSchema>;

/**
 * The fields that hold special-category data. They are never audited with their values, never
 * indexed for search and never the subject of a correction request.
 */
export const SPECIAL_CATEGORY_FIELDS = [
  "genderSource",
  "genderCategory",
  "genderSelfDescribed",
  "ethnicitySource",
  "ethnicityCategory",
  "ethnicitySelfDescribed",
] as const;

export const correctionRequestStatusSchema = z.enum(["open", "accepted", "rejected", "withdrawn"]);

/**
 * What the name of a field holds, in any case, when the field belongs to the special categories.
 * A correction request is read by everyone who resolves the review queue, so it never names such
 * a field, however the name is spelt. The security rules refuse the same names.
 */
export const SPECIAL_CATEGORY_NAME_PARTS = ["gender", "ethnic", "demograph"] as const;

/** Whether the name of a field says that it holds special-category data. */
export function namesSpecialCategory(field: string): boolean {
  const lowered = field.toLowerCase();
  return (
    (SPECIAL_CATEGORY_FIELDS as readonly string[]).includes(field) ||
    SPECIAL_CATEGORY_NAME_PARTS.some((part) => lowered.includes(part))
  );
}

/**
 * The field that a correction request is about: the name of a top-level field as the schemas
 * spell one, which is letters and digits with a letter first, so that white space or a full stop
 * cannot disguise it.
 */
export const correctableFieldSchema = z
  .string()
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, { error: "Expected the name of a field" })
  .refine((field) => !namesSpecialCategory(field), {
    error: "A correction request never names a special-category field",
  });

/** `correctionRequests/{id}`: a member's request to correct an imported record. */
export const correctionRequestDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  ...entityRefShape,
  field: correctableFieldSchema,
  proposedValue: z.union([z.string().max(LIMITS.longText), z.number(), z.boolean()]),
  message: longTextSchema.exactOptional(),
  status: correctionRequestStatusSchema,
  resolvedBy: actorSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
});
export type CorrectionRequestDoc = z.output<typeof correctionRequestDocSchema>;

export const publicListingSchema = z.enum(["none", "member", "coreTeam"]);

/**
 * The directory fields of a person that the person may edit directly: the three profile
 * addresses. Every other field is for administrators, and the ORCID iD changes through a
 * callable function for everyone, because imports find a person again by it: the function
 * reserves the identity key in the same transaction and refuses an iD that another person holds.
 */
export const PERSON_SELF_EDITABLE_FIELDS = ["scholarUrl", "universityUrl", "labUrl"] as const;

/**
 * `persons/{personId}`: the directory document of a person, readable by members. `isCoreTeam`
 * and `coreRoles` are directory facts taken from the public website and grant nothing.
 */
export const personDocSchema = documentBaseSchema.extend({
  /** Reserved as an identity key. Immutable for clients. */
  slug: keySchema,
  givenName: shortTextSchema.exactOptional(),
  middleName: shortTextSchema.exactOptional(),
  familyName: shortTextSchema.exactOptional(),
  displayName: shortTextSchema,
  orcid: orcidSchema.exactOptional(),
  countryCode: countryCodeSchema.exactOptional(),
  countrySource: verbatimSchema.exactOptional(),
  /** Derived from the primary affiliation. */
  affiliationSummary: shortTextSchema.exactOptional(),
  institutionId: idSchema.exactOptional(),
  /** Derived from confirmed member entries of laboratories. */
  laboratoryIds: idListSchema,
  /** Derived from current, confirmed memberships of replications. */
  replicationIds: idListSchema,
  isCoreTeam: z.boolean(),
  publicListing: publicListingSchema,
  websitePersonId: shortTextSchema.exactOptional(),
  coreRoles: z.array(shortTextSchema).max(50),
  headshotFilename: shortTextSchema.exactOptional(),
  scholarUrl: urlSchema.exactOptional(),
  universityUrl: urlSchema.exactOptional(),
  labUrl: urlSchema.exactOptional(),
  /** The login that has claimed this person, or null until one has. Filled by the claim function only. */
  userId: uidSchema.nullable(),
  claimedAt: timestampSchema.nullable(),
  custom: customValuesSchema,
  dataOrigin: dataOriginSchema,
  ...provenanceShape,
});
export type PersonDoc = z.output<typeof personDocSchema>;

export const emailKindSchema = z.enum(["primary", "secondary", "historical"]);

export const personEmailSchema = z.strictObject({
  /** Stored in canonical form: trimmed and in lower case. */
  email: z
    .email()
    .max(320)
    .refine((email) => email === normaliseEmail(email), { error: "An address is stored trimmed and in lower case" }),
  kind: emailKindSchema,
  sourceRecordId: idSchema.exactOptional(),
  verifiedAt: timestampSchema.nullable(),
  claimEligible: z.boolean(),
});

/** `persons/{personId}/private/contact`: the email addresses of a person. Written by functions only. */
export const personContactDocSchema = documentBaseSchema.extend({
  emails: z
    .array(personEmailSchema)
    .max(20)
    .refine((emails) => emails.filter((entry) => entry.kind === "primary").length <= 1, {
      error: "A person has one primary address at most",
    }),
  ...provenanceShape,
});
export type PersonContactDoc = z.output<typeof personContactDocSchema>;

/** `persons/{personId}/private/address`: for the person and administrators. */
export const personAddressDocSchema = documentBaseSchema.extend({
  postalAddress: z.string().max(2_000),
});
export type PersonAddressDoc = z.output<typeof personAddressDocSchema>;

/** `persons/{personId}/private/notes`: for administrators. */
export const personNotesDocSchema = documentBaseSchema.extend({
  privateNotes: z.string().max(LIMITS.longText),
});
export type PersonNotesDoc = z.output<typeof personNotesDocSchema>;

/**
 * `persons/{personId}/special/demographics`: special-category data. No client can read this
 * document. A callable function serves it after checking the caller's grant and second factor.
 * Source terms are verbatim and the standardised categories are optional.
 */
export const personDemographicsDocSchema = documentBaseSchema.extend({
  genderSource: verbatimSchema.exactOptional(),
  genderCategory: keySchema.exactOptional(),
  genderSelfDescribed: verbatimSchema.exactOptional(),
  ethnicitySource: verbatimSchema.exactOptional(),
  ethnicityCategory: keySchema.exactOptional(),
  ethnicitySelfDescribed: verbatimSchema.exactOptional(),
  sourceRecordId: idSchema.exactOptional(),
  recordedAt: timestampSchema,
  ...provenanceShape,
});
export type PersonDemographicsDoc = z.output<typeof personDemographicsDocSchema>;

/** `persons/{personId}/affiliations/{id}`: an affiliation of a person, who may hold several. */
export const personAffiliationDocSchema = documentBaseSchema.extend({
  personId: idSchema,
  institutionId: idSchema.exactOptional(),
  laboratoryId: idSchema.exactOptional(),
  affiliationSource: verbatimSchema.exactOptional(),
  roleTitle: shortTextSchema.exactOptional(),
  isPrimary: z.boolean(),
  startDate: isoDateSchema.exactOptional(),
  endDate: isoDateSchema.exactOptional(),
  ...provenanceShape,
});
export type PersonAffiliationDoc = z.output<typeof personAffiliationDocSchema>;

/** `personEmailIndex/{emailHash}`: claim matching without exposing an address. No client can read it. */
export const personEmailIndexDocSchema = documentBaseSchema.extend({
  /** Every person who carries the address. More than one is a data error that goes to review. */
  personIds: idListSchema.min(1),
  /** Those of them whose address is eligible for a claim. */
  claimEligiblePersonIds: idListSchema,
});
export type PersonEmailIndexDoc = z.output<typeof personEmailIndexDocSchema>;

export const identityEntityTypeSchema = entityTypeSchema.extract(["person", "laboratory", "institution"]);
export const identityKeyKindSchema = z.enum(["websitePersonId", "email", "orcid", "ror", "slug", "nameAffiliation"]);
export const identityKeyStatusSchema = z.enum(["active", "merged", "erased"]);

/**
 * `identityKeys/{keyHash}`: how an import finds a person, a laboratory or an institution again.
 * A second entity marks an ambiguity that goes to review. The keys of a merged or erased record
 * stay as tombstones.
 */
export const identityKeyDocSchema = documentBaseSchema.extend({
  entityType: identityEntityTypeSchema,
  keyKind: identityKeyKindSchema,
  entityIds: idListSchema.min(1),
  status: identityKeyStatusSchema,
  mergedIntoId: idSchema.nullable(),
});
export type IdentityKeyDoc = z.output<typeof identityKeyDocSchema>;

/**
 * `institutionCandidates/{id}`: the review queue for affiliation strings
 * (docs/MIGRATION_PLAN.md, section 3.5). Each distinct folded string that a source writes as an
 * affiliation is one candidate. An institution exists only once a reviewer has confirmed it, and
 * the mapping from a candidate to its institution is a stored decision that no import changes.
 */
export const institutionCandidateDocSchema = documentBaseSchema.extend({
  /** The lookup fold of the affiliation string, from which the identifier is built. */
  affiliationFolded: z
    .string()
    .min(1)
    .max(LIMITS.longText)
    .regex(/^[a-z0-9]+$/, { error: "Expected a folded affiliation" }),
  /** Every raw spelling that folds to this candidate, exactly as the sources write it. */
  affiliationsSource: z.array(verbatimSchema).max(LIMITS.list),
  /** The institution a reviewer has mapped the candidate to, or null until one has. */
  institutionId: idSchema.nullable(),
  ...provenanceShape,
});
export type InstitutionCandidateDoc = z.output<typeof institutionCandidateDocSchema>;

/** `institutions/{id}`: unique on normalised name and country through `identityKeys`. */
export const institutionDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  shortName: shortTextSchema.exactOptional(),
  countryCode: countryCodeSchema.exactOptional(),
  city: shortTextSchema.exactOptional(),
  rorId: z
    .string()
    .max(9)
    .regex(/^0[a-hj-km-np-tv-z0-9]{6}[0-9]{2}$/, { error: "Expected a ROR identifier" })
    .exactOptional(),
  website: urlSchema.exactOptional(),
  /** Email domains of the institution, in lower case. */
  emailDomains: z.array(z.string().min(3).max(253)).max(50),
  ...provenanceShape,
});
export type InstitutionDoc = z.output<typeof institutionDocSchema>;
