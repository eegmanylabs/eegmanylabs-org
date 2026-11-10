// The collection registry: one entry for every collection, subcollection and fixed-name
// document of docs/DATA_MODEL.md, and the single place where a path is spelled out.
//
// The security rules, their tests, the integrity checker, the audit trigger, the web data layer
// and later the view engine all read this registry, so an entry states everything they need:
// the path, how the identifier is formed, who may read, who may write, how sensitive the content
// is and whether the rules for it are written yet. A unit test compares the registry with the
// tables of the data model in both directions, so neither can change without the other.
import type { GrantableCapability, Role } from "./capabilities";
import type { EntityType } from "./entities";
import { type IdBuilderName, splitNestedEntityId } from "./ids";
import { PROVENANCE_FIELDS } from "./schemas/base";
import * as datasets from "./schemas/datasets";
import * as identity from "./schemas/identity";
import * as outputs from "./schemas/outputs";
import * as participation from "./schemas/participation";
import * as programme from "./schemas/programme";
import * as provenance from "./schemas/provenance";
import * as recruitment from "./schemas/recruitment";
import * as replications from "./schemas/replications";
import * as system from "./schemas/system";
import * as tasks from "./schemas/tasks";
import * as workspace from "./schemas/workspace";
import type { z } from "./zod";

/**
 * The access tiers of docs/DATA_MODEL.md, section 2.
 *
 * | Tier       | Who                                                                                   |
 * |------------|---------------------------------------------------------------------------------------|
 * | `MEMBER`   | Any signed-in user with an approved membership                                        |
 * | `SCOPED`   | Programme administrators, the core team, and users who hold one of the document's scope keys |
 * | `SELF`     | The user who owns the document                                                        |
 * | `ADMIN`    | Programme administrators, and the core team where the capability matrix allows        |
 * | `FUNCTION` | No client at all: Cloud Functions and Admin SDK tools only                            |
 */
export const ACCESS_TIERS = ["MEMBER", "SCOPED", "SELF", "ADMIN", "FUNCTION"] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

/**
 * Who may read the documents of an entry: a caller who satisfies one of the tiers.
 *
 * `scopeFields` names what the tiers compare with the caller. A plain name is a field of the
 * document, `parent.<field>` is a field of the parent document, and `{name}` is a parameter of
 * the path.
 */
export interface ReadRule {
  readonly tiers: readonly AccessTier[];
  readonly scopeFields: readonly string[];
  /** What narrows the tiers further, in words, for the rules to implement. */
  readonly condition: string | null;
  /**
   * The capability that decides the read, where the capability matrix does. With one, the tier
   * `ADMIN` is whoever holds the capability for the programme as a whole: a programme
   * administrator always, and the core team or the holder of a named grant where the matrix
   * confers it. The tier `SCOPED` is then whoever holds the capability for a replication or a
   * laboratory that the scope fields name, in place of every holder of a scope key. An entry
   * whose rules are written names one wherever it uses the tier `ADMIN`.
   */
  readonly capability: GrantableCapability | null;
}

/**
 * Who may write a document directly from a browser.
 *
 * | Writer       | Who                                                                          |
 * |--------------|------------------------------------------------------------------------------|
 * | A role       | A holder of the role whose scope covers the document: a programme role everywhere, `replication_lead` for the document's replication, `lab_coordinator` and `lab_member` for its laboratory |
 * | `self`       | The user who owns the document                                               |
 * | `member`     | Any approved member                                                          |
 * | `author`     | The user who created the document                                            |
 * | `participant`| A user named in one of the participant arrays of the document                |
 * | `commenter`  | A holder of the level `comment` or above on the page or the target           |
 * | `editor`     | A holder of the level `edit` or above                                        |
 * | `fullAccess` | A holder of the level `full`                                                 |
 */
export type Writer = Role | "self" | "member" | "author" | "participant" | "commenter" | "editor" | "fullAccess";

export type WriteOperation = "create" | "update" | "delete";

/** One group of writers and what they may do. Core records are archived through `archivedAt` and never deleted. */
export interface ClientWriteGrant {
  readonly writers: readonly Writer[];
  readonly operations: readonly WriteOperation[];
  /** The capability that names this right in the capability matrix, where one does. */
  readonly capability: GrantableCapability | null;
  /** When set, the only fields these writers may set or change. */
  readonly onlyFields: readonly string[] | null;
  readonly condition: string | null;
}

/**
 * Who may write the documents of an entry. `function` means that no client writes at all:
 * callable functions, triggers, scheduled jobs and Admin SDK tools do. A client write is
 * validated by the rules, sets `updatedBy` and `updatedAt`, and never changes the fields that
 * `clientImmutableFields` lists or the `functionOnlyFields` of the entry.
 *
 * Every writer is an approved member, the writer `self` included. A signed-in account without
 * a membership satisfies the tier `SELF` for reading only, which is what the claim flow needs,
 * so that an account alone opens nothing to write to (docs/SECURITY.md, section 4).
 */
export type WriteRule =
  | { readonly mode: "function" }
  | {
      readonly mode: "client";
      readonly grants: readonly ClientWriteGrant[];
      /** What ties a scoped writer to the document, in the notation of `ReadRule.scopeFields`. */
      readonly scopeFields: readonly string[];
      /** Fields of the document that only trusted code sets, such as a status or a derived copy. */
      readonly functionOnlyFields: readonly string[];
    };

/**
 * How the identifier of a document is formed.
 *
 * | Kind      | Identifier                                                                       |
 * |-----------|----------------------------------------------------------------------------------|
 * | `auto`    | Generated by Firestore for a record made in the portal, and derived from the natural key of the source record by an importer |
 * | `key`     | A stable key used as it stands, such as a uid or a study identifier. `field` is the field that repeats it, where one does |
 * | `fixed`   | A fixed document name                                                            |
 * | `builder` | Built by the named function of ids.ts from the named fields, in the order of its arguments. No fields are named where the natural key is not stored in the document |
 */
export type IdentifierRule =
  | { readonly kind: "auto"; readonly note: string | null }
  | { readonly kind: "key"; readonly of: string; readonly field: string | null }
  | { readonly kind: "fixed"; readonly name: string }
  | {
      readonly kind: "builder";
      readonly builder: IdBuilderName;
      readonly fields: readonly string[];
      readonly note: string | null;
    };

/**
 * The data classes of docs/SECURITY.md, section 2.
 *
 * | Class        | Content                                                                         |
 * |--------------|---------------------------------------------------------------------------------|
 * | `public`     | Reference data with nothing private in it                                       |
 * | `member`     | What members work with, subject to scope                                        |
 * | `restricted` | Contact details, correspondence, notes, storage locations, raw rows, access records |
 * | `special`    | Special-category data: gender and ethnicity                                     |
 */
export const DATA_CLASSES = ["public", "member", "restricted", "special"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/**
 * | Value              | Meaning                                                                    |
 * |--------------------|----------------------------------------------------------------------------|
 * | `enforced`         | The security rules implement the entry, and tests attack them              |
 * | `deniedUntilBuilt` | Every client is refused every read and write until the feature is built    |
 */
export const ENFORCEMENTS = ["enforced", "deniedUntilBuilt"] as const;
export type Enforcement = (typeof ENFORCEMENTS)[number];

export interface CollectionFlags {
  /** Documents are created once and never updated. Their schema carries the shorter set of standard fields. */
  readonly appendOnly: boolean;
  /** The audit trigger records writes to the collection. Off for derived and bulk content. */
  readonly audited: boolean;
  /** An importer may create documents here, which then carry the provenance fields. */
  readonly importable: boolean;
  /** Documents feed the search index. */
  readonly searchable: boolean;
}

/** One string for each parameter of a path template. A template that is not known exactly takes any number. */
type PathParameters<Template extends string> = string extends Template
  ? string[]
  : Template extends `${string}{${string}}${infer Rest}`
    ? [string, ...PathParameters<Rest>]
    : [];
type WithoutLast<Tuple extends unknown[]> = Tuple extends [...infer Head, unknown] ? Head : [];
/** The parameters of the collection of a template: all of them for a fixed-name document, and all but the last otherwise. */
type CollectionParameters<Template extends string> = string extends Template
  ? string[]
  : Template extends `${string}}`
    ? WithoutLast<PathParameters<Template>>
    : PathParameters<Template>;

interface Definition<Template extends string, Schema extends z.ZodObject> {
  /** The path of a document, with a parameter in braces for each identifier, as the data model writes it. */
  readonly path: Template;
  /** The path under which the data model lists the entry, where one row of it stands for several entries. */
  readonly documentedAs: string;
  readonly identifier: IdentifierRule;
  readonly read: ReadRule;
  readonly write: WriteRule;
  readonly dataClass: DataClass;
  readonly flags: CollectionFlags;
  readonly enforcement: Enforcement;
  readonly schema: Schema;
}

export interface CollectionEntry<
  Key extends string = string,
  Template extends string = string,
  Schema extends z.ZodObject = z.ZodObject,
> extends Definition<Template, Schema> {
  /** The stable key of the entry. It never changes once code refers to it. */
  readonly key: Key;
  /** The key of the entry of the parent document, or null for a top-level collection. */
  readonly parent: string | null;
  /** The name of the collection, which is what a collection-group query addresses. */
  readonly collectionId: string;
  /** The version that the schema accepts and that a writer stamps on a new document. */
  readonly schemaVersion: number;
  /** The path of one document. Takes one identifier for each parameter of `path`, in order. */
  docPath(...ids: PathParameters<Template>): string;
  /** The path of the collection that holds the documents. Takes the identifiers of the ancestors. */
  collectionPath(...ids: CollectionParameters<Template>): string;
}

/** Rejects values that would change the shape of a path when used as a document identifier. */
function segment(value: string): string {
  if (value.length === 0 || value.includes("/") || value === "." || value === "..") {
    throw new RangeError("A document identifier must be a non-empty string without slashes.");
  }
  return value;
}

const PARAMETER = /^\{[^{}/]+\}$/;

function fillPath(template: string, ids: readonly string[], segmentCount?: number): string {
  const segments = template.split("/").slice(0, segmentCount);
  const expected = segments.filter((part) => PARAMETER.test(part)).length;
  if (ids.length !== expected) {
    throw new RangeError(`The path ${template} takes ${expected} identifier(s), and ${ids.length} were given.`);
  }
  let next = 0;
  return segments.map((part) => (PARAMETER.test(part) ? segment(ids[next++] ?? "") : part)).join("/");
}

const DEFAULT_FLAGS: CollectionFlags = { appendOnly: false, audited: true, importable: false, searchable: false };

function define<const Template extends string, Schema extends z.ZodObject>(spec: {
  readonly path: Template;
  readonly schema: Schema;
  readonly id: IdentifierRule;
  readonly read: ReadRule;
  readonly write: WriteRule;
  readonly dataClass: DataClass;
  readonly enforcement: Enforcement;
  readonly flags?: Partial<CollectionFlags>;
  readonly documentedAs?: string;
}): Definition<Template, Schema> {
  return {
    path: spec.path,
    documentedAs: spec.documentedAs ?? spec.path,
    identifier: spec.id,
    read: spec.read,
    write: spec.write,
    dataClass: spec.dataClass,
    flags: { ...DEFAULT_FLAGS, ...spec.flags },
    enforcement: spec.enforcement,
    schema: spec.schema,
  };
}

// Shorthand for the entries below.

/**
 * An opaque identifier. A client that creates such a document sends an identifier that Firestore
 * generated (`AUTO_ID_PATTERN`), and the rules refuse any other, so that no client can take an
 * identifier that an importer derives.
 */
const auto: IdentifierRule = { kind: "auto", note: null };
const key = (of: string, field: string | null = null): IdentifierRule => ({ kind: "key", of, field });
const fixed = (name: string): IdentifierRule => ({ kind: "fixed", name });
const built = (builder: IdBuilderName, fields: readonly string[] = [], note: string | null = null): IdentifierRule => ({
  kind: "builder",
  builder,
  fields,
  note,
});

const read = (
  tiers: readonly AccessTier[],
  scopeFields: readonly string[] = [],
  condition: string | null = null,
  capability: GrantableCapability | null = null,
): ReadRule => ({ tiers, scopeFields, condition, capability });

/** A read of the tier `ADMIN` alone: whoever holds the capability for the programme as a whole. */
const adminRead = (capability: GrantableCapability): ReadRule => read(["ADMIN"], [], null, capability);

const FUNCTION_ONLY: WriteRule = { mode: "function" };

const grant = (
  writers: readonly Writer[],
  operations: readonly WriteOperation[],
  extra: {
    readonly capability?: GrantableCapability;
    readonly onlyFields?: readonly string[];
    readonly condition?: string;
  } = {},
): ClientWriteGrant => ({
  writers,
  operations,
  capability: extra.capability ?? null,
  onlyFields: extra.onlyFields ?? null,
  condition: extra.condition ?? null,
});

const client = (
  grants: readonly ClientWriteGrant[],
  scopeFields: readonly string[] = [],
  functionOnlyFields: readonly string[] = [],
): WriteRule => ({ mode: "client", grants, scopeFields, functionOnlyFields });

/** Programme administrators and the core team. */
const STAFF = ["programme_admin", "core_team"] as const;
const LEADS = ["replication_lead", ...STAFF] as const;
const COORDINATORS = ["lab_coordinator", ...STAFF] as const;
/** The leads of the replication, the coordinators of the laboratory, programme administrators and the core team. */
const MANAGERS = ["replication_lead", "lab_coordinator", ...STAFF] as const;

const WRITE = ["create", "update"] as const;
const UNIT = ["replicationId", "laboratoryId"] as const;

const ENFORCED = "enforced";
const DENIED = "deniedUntilBuilt";

/** The path under which the data model lists the restricted custom values of every core collection. */
const CUSTOM_VALUES_PATH = "{coreCollection}/{id}/private/custom";

/** The restricted custom values of a core document: read within its scope, and written by those who manage it. */
function customValues<const Template extends string>(
  path: Template,
  writers: readonly Writer[],
  readScope: readonly string[],
  writeScope: readonly string[] = readScope,
) {
  return define({
    path,
    documentedAs: CUSTOM_VALUES_PATH,
    schema: workspace.privateCustomDocSchema,
    id: fixed("custom"),
    read: read(["SCOPED"], readScope),
    write: client([grant(writers, WRITE)], writeScope),
    dataClass: "restricted",
    enforcement: DENIED,
  });
}

const DEFINITIONS = {
  // Identity and access (section 3).
  users: define({
    path: "users/{uid}",
    schema: identity.userDocSchema,
    id: key("Authentication uid"),
    read: read(["SELF"], ["{uid}"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  userFavourites: define({
    path: "users/{uid}/favourites/{entityType__entityId}",
    schema: identity.userFavouriteDocSchema,
    id: built("entityRefId", ["entityType", "entityId"]),
    read: read(["SELF"], ["{uid}"]),
    write: client([grant(["self"], ["create", "update", "delete"])], ["{uid}"]),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  userRecents: define({
    path: "users/{uid}/recents/{entityType__entityId}",
    schema: identity.userRecentDocSchema,
    id: built("entityRefId", ["entityType", "entityId"]),
    read: read(["SELF"], ["{uid}"]),
    write: client([grant(["self"], ["create", "update", "delete"])], ["{uid}"]),
    dataClass: "member",
    flags: { audited: false },
    enforcement: ENFORCED,
  }),
  userNotifications: define({
    path: "users/{uid}/notifications/{id}",
    schema: identity.userNotificationDocSchema,
    id: built("notificationId", ["type", "eventId"]),
    read: read(["SELF"], ["{uid}"]),
    write: client([grant(["self"], ["update"], { onlyFields: ["readAt"] })], ["{uid}"]),
    dataClass: "member",
    flags: { audited: false },
    enforcement: ENFORCED,
  }),
  userSubscriptions: define({
    path: "users/{uid}/subscriptions/{entityType__entityId}",
    schema: identity.userSubscriptionDocSchema,
    id: built("entityRefId", ["entityType", "entityId"]),
    read: read(["SELF"], ["{uid}"]),
    write: client([grant(["self"], ["create", "update", "delete"])], ["{uid}"]),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  userPreferences: define({
    path: "users/{uid}/settings/preferences",
    schema: identity.userPreferencesDocSchema,
    id: fixed("preferences"),
    read: read(["SELF"], ["{uid}"]),
    write: client([grant(["self"], WRITE)], ["{uid}"]),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  access: define({
    path: "access/{uid}",
    schema: identity.accessDocSchema,
    id: key("Authentication uid"),
    read: read(["SELF"], ["{uid}"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: ENFORCED,
  }),
  roleAssignments: define({
    path: "roleAssignments/{uid__role__scopeType__scopeId}",
    schema: identity.roleAssignmentDocSchema,
    id: built("roleAssignmentId", ["uid", "role", "scopeType", "scopeId"]),
    read: adminRead("roles.manage"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  roleCapabilities: define({
    path: "roleCapabilities/{role}",
    schema: identity.roleCapabilitiesDocSchema,
    id: key("role key", "role"),
    read: adminRead("roles.manage"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  capabilityGrants: define({
    path: "capabilityGrants/{uid__capability}",
    schema: identity.capabilityGrantDocSchema,
    id: built("capabilityGrantId", ["uid", "capability"]),
    read: adminRead("roles.manage"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  recordGrants: define({
    path: "recordGrants/{uid__entityType__entityId}",
    schema: identity.recordGrantDocSchema,
    id: built("recordGrantId", ["uid", "entityType", "entityId"]),
    read: adminRead("roles.manage"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  groups: define({
    path: "groups/{groupKey}",
    schema: identity.groupDocSchema,
    id: key("group key", "groupKey"),
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { searchable: true },
    enforcement: ENFORCED,
  }),
  externalAccounts: define({
    path: "externalAccounts/{id}",
    schema: identity.externalAccountDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE)], ["scopeKeys"]),
    dataClass: "restricted",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  invitations: define({
    path: "invitations/{id}",
    schema: identity.invitationDocSchema,
    id: auto,
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  accountClaims: define({
    path: "accountClaims/{uid}",
    schema: identity.accountClaimDocSchema,
    id: key("Authentication uid", "uid"),
    read: read(["SELF"], ["{uid}"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  accountClaimReview: define({
    path: "accountClaims/{uid}/private/review",
    schema: identity.accountClaimReviewDocSchema,
    id: fixed("review"),
    read: adminRead("claims.review"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  labClaims: define({
    path: "labClaims/{uid__laboratoryId}",
    schema: identity.labClaimDocSchema,
    id: built("labClaimId", ["uid", "laboratoryId"]),
    read: read(
      ["SELF", "ADMIN", "SCOPED"],
      ["uid", "laboratoryId"],
      "The requesting user, administrators and the coordinators of that laboratory.",
      "labs.claims.review",
    ),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  labClaimReview: define({
    path: "labClaims/{claimId}/private/review",
    schema: identity.labClaimReviewDocSchema,
    id: fixed("review"),
    read: read(
      ["ADMIN", "SCOPED"],
      ["parent.laboratoryId"],
      "Administrators and the authorised representatives of that laboratory.",
      "labs.claims.review",
    ),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  correctionRequests: define({
    path: "correctionRequests/{id}",
    schema: identity.correctionRequestDocSchema,
    id: auto,
    read: read(["SELF", "ADMIN"], ["uid"], "A member sees only the requests they created.", "reconciliation.resolve"),
    write: client(
      [
        grant(["member"], ["create"], {
          condition:
            "The request names its creator in uid, is open, and names a field by letters and digits alone, never one whose name holds gender, ethnic or demograph in any case.",
        }),
        grant(["self"], ["update"], {
          onlyFields: ["status"],
          condition: "The creator may withdraw a request that is still open.",
        }),
      ],
      ["uid"],
      ["resolvedBy", "resolvedAt"],
    ),
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  persons: define({
    path: "persons/{personId}",
    schema: identity.personDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client(
      [
        grant(["self"], ["update"], { onlyFields: identity.PERSON_SELF_EDITABLE_FIELDS }),
        grant(STAFF, ["update"], { capability: "people.manage" }),
      ],
      ["userId"],
      // The link to a login, the derived copies, and the fields by which imports find a person
      // again: a callable function changes those and reserves the identity key with the change.
      [
        "slug",
        "userId",
        "claimedAt",
        "laboratoryIds",
        "replicationIds",
        "institutionId",
        "affiliationSummary",
        "orcid",
        "websitePersonId",
      ],
    ),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: ENFORCED,
  }),
  personContact: define({
    path: "persons/{personId}/private/contact",
    schema: identity.personContactDocSchema,
    id: fixed("contact"),
    read: read(
      ["SELF", "ADMIN", "SCOPED"],
      ["parent.userId", "parent.replicationIds", "parent.laboratoryIds"],
      "The person, administrators, and the leads and coordinators of the replications and laboratories that the directory document of the person names.",
      "people.contact.read",
    ),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  personAddress: define({
    path: "persons/{personId}/private/address",
    schema: identity.personAddressDocSchema,
    id: fixed("address"),
    read: read(["SELF", "ADMIN"], ["parent.userId"], null, "people.manage"),
    write: client(
      [grant(["self"], WRITE), grant(STAFF, WRITE, { capability: "people.manage", condition: "The person exists." })],
      ["parent.userId"],
    ),
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  personNotes: define({
    path: "persons/{personId}/private/notes",
    schema: identity.personNotesDocSchema,
    id: fixed("notes"),
    read: adminRead("people.manage"),
    write: client([grant(STAFF, WRITE, { capability: "people.manage" })]),
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  personDemographics: define({
    path: "persons/{personId}/special/demographics",
    schema: identity.personDemographicsDocSchema,
    id: fixed("demographics"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "special",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  personAffiliations: define({
    path: "persons/{personId}/affiliations/{id}",
    schema: identity.personAffiliationDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client(
      [
        grant(["self"], WRITE, {
          condition:
            "The institution exists. A person names a laboratory only where that laboratory holds a confirmed member entry for the person.",
        }),
        grant(STAFF, WRITE, {
          capability: "people.manage",
          condition: "The person, the institution and the laboratory exist.",
        }),
      ],
      ["parent.userId"],
    ),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  personCustom: define({
    path: "persons/{personId}/private/custom",
    documentedAs: CUSTOM_VALUES_PATH,
    schema: workspace.privateCustomDocSchema,
    id: fixed("custom"),
    read: read(
      ["SELF", "ADMIN", "SCOPED"],
      ["parent.userId", "parent.replicationIds", "parent.laboratoryIds"],
      "As the contact document of the person.",
    ),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  personEmailIndex: define({
    path: "personEmailIndex/{emailHash}",
    schema: identity.personEmailIndexDocSchema,
    id: built("personEmailIndexId"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  identityKeys: define({
    path: "identityKeys/{keyHash}",
    schema: identity.identityKeyDocSchema,
    id: built("identityKeyId"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  institutions: define({
    path: "institutions/{id}",
    schema: identity.institutionDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client(
      [grant(STAFF, ["update"], { capability: "lookups.manage" })],
      [],
      // Imports find an institution again by its ROR identifier, which a callable function
      // changes together with the identity key.
      ["rorId"],
    ),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: ENFORCED,
  }),
  institutionCandidates: define({
    path: "institutionCandidates/{id}",
    schema: identity.institutionCandidateDocSchema,
    id: built("institutionCandidateId", ["affiliationFolded"]),
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { importable: true },
    enforcement: DENIED,
  }),

  // Programme, laboratories and equipment (section 4).
  programmes: define({
    path: "programmes/{key}",
    schema: programme.programmeDocSchema,
    id: key("programme key", "key"),
    read: read(["MEMBER"]),
    write: client([grant(STAFF, WRITE, { capability: "lookups.manage" })]),
    dataClass: "public",
    enforcement: ENFORCED,
  }),
  laboratories: define({
    path: "laboratories/{laboratoryId}",
    schema: programme.laboratoryDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client([grant(COORDINATORS, ["update"], { capability: "labs.manage" })], ["{laboratoryId}"], ["slug"]),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: ENFORCED,
  }),
  laboratoryDetail: define({
    path: "laboratories/{laboratoryId}/private/detail",
    schema: programme.laboratoryDetailDocSchema,
    id: fixed("detail"),
    read: read(["SCOPED"], ["{laboratoryId}"]),
    write: client([grant(COORDINATORS, WRITE, { capability: "labs.manage" })], ["{laboratoryId}"]),
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  laboratoryMembers: define({
    path: "laboratories/{laboratoryId}/members/{personId}",
    schema: programme.laboratoryMemberDocSchema,
    id: key("person identifier", "personId"),
    read: read(["MEMBER"]),
    write: client(
      [
        grant(COORDINATORS, WRITE, {
          capability: "labs.manage",
          condition:
            "An entry starts as proposed. Only the person concerned or an administrator sets status to confirmed, through a callable function. A confirmed entry keeps its role and its mark of an authorised representative, unless it returns to proposed with the change. An archived entry is restored as proposed.",
        }),
      ],
      ["{laboratoryId}"],
      // Trusted code moves a period that has ended into the earlier periods.
      ["earlierPeriods"],
    ),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  laboratoryEquipment: define({
    path: "laboratories/{laboratoryId}/equipment/{configurationId}",
    schema: programme.laboratoryEquipmentDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  laboratoryCustom: customValues("laboratories/{laboratoryId}/private/custom", COORDINATORS, ["{laboratoryId}"]),

  // Replications and scientific definition (section 5).
  replications: define({
    path: "replications/{studyKey}",
    schema: replications.replicationDocSchema,
    id: key("study identifier", "studyKey"),
    read: read(["MEMBER"]),
    write: client(
      [
        grant(["replication_lead"], ["update"], { capability: "replications.manage" }),
        grant(STAFF, WRITE, {
          capability: "replications.manage",
          condition:
            "A new replication holds its programme, its study identifier and a short title. Its scientific definition is written by later changes.",
        }),
      ],
      ["{studyKey}"],
      // The status and the leads, which trusted code derives or records with a history entry;
      // the decisions of the programme (the programme a replication belongs to, its selection
      // and the stage that the public sees); the result of the citation check, which a machine
      // makes; and the links to vocabulary terms, whose elements no rule can check.
      [
        "statusKey",
        "statusHistoryId",
        "leadPersonIds",
        "programmeId",
        "selectionStatus",
        "publicStageNumber",
        "publicStageName",
        "publicStageText",
        "citationStatus",
        "citationCheckedAt",
        "citationSource",
        "citationMetadata",
        "vocabulary",
      ],
    ),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: ENFORCED,
  }),
  replicationDetail: define({
    path: "replications/{studyKey}/private/detail",
    schema: replications.replicationDetailDocSchema,
    id: fixed("detail"),
    read: read(["SCOPED"], ["{studyKey}"]),
    write: client(
      [grant(LEADS, WRITE, { capability: "replications.manage", onlyFields: ["internalNotes"] })],
      ["{studyKey}"],
      ["notesSource", "replicatedSource"],
    ),
    dataClass: "restricted",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  replicationAliases: define({
    path: "replications/{studyKey}/aliases/{scheme__hashOfAlias}",
    schema: replications.replicationAliasDocSchema,
    id: built("studyAliasId", ["scheme", "alias"]),
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  replicationMemberships: define({
    path: "replications/{studyKey}/memberships/{personId__role}",
    schema: replications.replicationMembershipDocSchema,
    id: built("replicationMembershipId", ["personId", "role"]),
    read: read(
      ["MEMBER", "SCOPED"],
      ["{studyKey}", "reviewStatus"],
      "Every member reads a membership whose reviewStatus is confirmed. The others are read within the scope of the replication.",
    ),
    write: client(
      [
        grant(STAFF, WRITE, { capability: "replications.manage" }),
        grant(["replication_lead"], WRITE, {
          capability: "replications.manage",
          condition:
            "The role is neither lead nor coLead, and reviewStatus is needsReview on creation and unchanged on update. A lead neither makes a confirmed membership current again nor restores one from the archive.",
        }),
      ],
      ["{studyKey}"],
      // Trusted code moves a period that has ended into the earlier periods.
      ["earlierPeriods"],
    ),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  replicationHypotheses: define({
    path: "replications/{studyKey}/hypotheses/{hNN}",
    schema: replications.replicationHypothesisDocSchema,
    id: built("hypothesisId", ["hypothesisNumber"]),
    read: read(["MEMBER"]),
    write: client(
      [
        grant(STAFF, WRITE, {
          capability: "replications.manage",
          condition:
            "A review names the reviewer and the request time. Whoever changes the reviewed content clears the review or signs it anew.",
        }),
        grant(["replication_lead"], ["create"], {
          capability: "replications.manage",
          condition: "A new hypothesis is unverified and carries no review.",
        }),
        grant(["replication_lead"], ["update"], {
          capability: "replications.manage",
          // Never the review status or the review itself: a lead does not review its own result.
          // A lead archives a hypothesis that nobody has reviewed yet.
          onlyFields: [
            "text",
            "expectedEffect",
            "outcomeMeasure",
            "analysisSpecification",
            "preregistrationUrl",
            "originalStatistics",
            "nullSigSource",
            "analysisStatus",
            "resultSummary",
            "studyDescriptionUrl",
            "infosheetUrl",
            "archivedAt",
          ],
          condition:
            "Once a result is reviewed or the hypothesis is verified, a lead changes the three addresses alone.",
        }),
      ],
      ["{studyKey}"],
    ),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: ENFORCED,
  }),
  replicationProtocols: define({
    path: "replications/{studyKey}/protocols/{id}",
    schema: replications.replicationProtocolDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client(
      [
        grant(LEADS, WRITE, {
          capability: "replications.manage",
          condition: "A new protocol names no current version. The current version is a version of the protocol.",
        }),
      ],
      ["{studyKey}"],
    ),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  replicationProtocolVersions: define({
    path: "replications/{studyKey}/protocolVersions/{id}",
    schema: replications.replicationProtocolVersionDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client(
      [
        grant(LEADS, WRITE, {
          capability: "replications.manage",
          condition:
            "A draft names no approver and an approved version names one, who approves in its own name at the request time. An approved version changes only by becoming superseded, and a superseded one never. The document link is a link of the replication.",
        }),
      ],
      ["{studyKey}"],
    ),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  replicationEquipmentRequirements: define({
    path: "replications/{studyKey}/equipmentRequirements/{key}",
    schema: replications.replicationEquipmentRequirementDocSchema,
    id: key("requirement key", "requirementKey"),
    read: read(["MEMBER"]),
    write: client([grant(LEADS, WRITE, { capability: "replications.manage" })], ["{studyKey}"]),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  replicationSummaries: define({
    path: "replications/{studyKey}/summaries/{kind}",
    schema: replications.replicationSummaryDocSchema,
    id: key("summary kind", "kind"),
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  replicationCustom: customValues("replications/{studyKey}/private/custom", LEADS, ["{studyKey}"]),
  statusHistory: define({
    path: "statusHistory/{id}",
    schema: replications.statusHistoryDocSchema,
    id: auto,
    read: read(["MEMBER", "SCOPED"], ["scopeKeys"], "As the record whose status the entry records."),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { appendOnly: true, importable: true },
    enforcement: ENFORCED,
  }),
  historicalAggregates: define({
    path: "historicalAggregates/{metricKey__sourceRecordId}",
    schema: replications.historicalAggregateDocSchema,
    id: built("historicalAggregateId", ["metricKey", "sourceRecordId"]),
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  candidateStudies: define({
    path: "candidateStudies/{id}",
    schema: replications.candidateStudyDocSchema,
    id: built(
      "candidateStudyId",
      ["originalDoi"],
      "From the DOI, or from the first author, the year and the title where the paper has none.",
    ),
    read: read(["MEMBER"]),
    write: client([grant(STAFF, WRITE, { capability: "replications.manage", condition: "The programme exists." })]),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  studyAliasIndex: define({
    path: "studyAliasIndex/{foldedAlias}",
    schema: replications.studyAliasIndexDocSchema,
    id: built("studyAliasIndexId"),
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  statusDefinitions: define({
    path: "statusDefinitions/{entityType__key}",
    schema: replications.statusDefinitionDocSchema,
    id: built("statusDefinitionId", ["entityType", "key"]),
    read: read(["MEMBER"]),
    write: client([grant(STAFF, WRITE, { capability: "lookups.manage" })]),
    dataClass: "public",
    enforcement: ENFORCED,
  }),
  vocabularyTerms: define({
    path: "vocabularyTerms/{termId}",
    schema: replications.vocabularyTermDocSchema,
    id: built(
      "vocabularyTermId",
      ["kind", "name"],
      "A term of the community vocabulary keeps its original identifier, which sourceId repeats.",
    ),
    read: read(["MEMBER"]),
    write: client(
      [grant(STAFF, WRITE, { capability: "lookups.manage" })],
      [],
      // The original identifier of a term belongs to the source it came from.
      ["sourceId"],
    ),
    dataClass: "public",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  predictionMarketItems: define({
    path: "predictionMarketItems/{id}",
    schema: replications.predictionMarketItemDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client([
      grant(STAFF, WRITE, {
        capability: "replications.manage",
        condition: "A hypothesis is named together with its replication, and both exist.",
      }),
    ]),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),

  // Participation (section 6).
  participations: define({
    path: "participations/{studyKey__laboratoryId}",
    schema: participation.participationDocSchema,
    id: built("participationId", ["replicationId", "laboratoryId"]),
    read: read(["MEMBER"]),
    write: client(
      [
        grant(LEADS, ["create"], {
          capability: "participations.manage",
          condition: "The replication invites the laboratory: status is invited, and readiness has not started.",
        }),
        grant(COORDINATORS, ["create"], {
          capability: "participations.manage",
          condition:
            "The laboratory registers its interest: status is interested, and readiness has not started. Programme administrators and the core team record either.",
        }),
        grant(MANAGERS, ["update"], {
          capability: "participations.manage",
          condition:
            "Readiness becomes approved, or stops being approved, through the leads of the replication, programme administrators and the core team alone. The protocol version is a version of the protocol.",
        }),
      ],
      UNIT,
      ["status", "statusHistoryId"],
    ),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: ENFORCED,
  }),
  participationDetail: define({
    path: "participations/{participationId}/private/detail",
    schema: participation.participationDetailDocSchema,
    id: fixed("detail"),
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: client(
      [
        grant(MANAGERS, WRITE, {
          capability: "participations.manage",
          condition:
            "Only the leads of the replication, programme administrators and the core team set or clear the approval of readiness, in their own name at the request time. Once readiness is approved, what was approved (ethics, training and the equipment override) changes only together with the approval.",
        }),
      ],
      ["parent.replicationId", "parent.laboratoryId"],
    ),
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  participationChecklist: define({
    path: "participations/{participationId}/checklist/{itemKey}",
    schema: participation.participationChecklistItemDocSchema,
    id: key("template item key", "templateItemKey"),
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client(
      [
        grant(MANAGERS, ["update"], {
          capability: "participations.manage",
          condition:
            "An item is done exactly while it names who completed it. A change to a completed item is signed anew by the caller, or reopens the item.",
        }),
        grant(["lab_member"], ["update"], {
          onlyFields: ["status", "completedBy", "completedAt", "evidenceUrl", "note"],
          condition:
            "A member of the laboratory of the participation, who reopens only an item that the member completed.",
        }),
      ],
      UNIT,
      ["templateKey", "templateItemKey", "label", "position"],
    ),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  participationTeamMembers: define({
    path: "participations/{participationId}/teamMembers/{personId}",
    schema: participation.participationTeamMemberDocSchema,
    id: key("person identifier", "personId"),
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE, { capability: "participations.manage" })], UNIT),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  participationAcknowledgements: define({
    path: "participations/{participationId}/acknowledgements/{personId__protocolVersionId}",
    schema: participation.participationAcknowledgementDocSchema,
    id: built("acknowledgementId", ["personId", "protocolVersionId"]),
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client(
      [
        grant(["self"], ["create"], {
          condition:
            "The person concerned, who is on the team of the participation, acknowledges an approved version in their own name at the request time. Nobody records an acknowledgement for someone else.",
        }),
      ],
      ["personId"],
    ),
    dataClass: "member",
    flags: { appendOnly: true },
    enforcement: ENFORCED,
  }),
  participationDeviations: define({
    path: "participations/{participationId}/deviations/{id}",
    schema: participation.participationDeviationDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client(
      [
        grant(MANAGERS, WRITE, {
          capability: "participations.manage",
          condition:
            "Whoever reports a deviation is named in reportedBy. Only the reporter, programme administrators and the core team change what was reported, resolve it or archive it. The other side adds a corrective action and moves an open deviation to underReview.",
        }),
      ],
      UNIT,
    ),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  participationCustom: customValues(
    "participations/{participationId}/private/custom",
    MANAGERS,
    ["parent.scopeKeys"],
    ["parent.replicationId", "parent.laboratoryId"],
  ),
  checklistTemplates: define({
    path: "checklistTemplates/{key}",
    schema: participation.checklistTemplateDocSchema,
    id: key("template key", "key"),
    read: read(["MEMBER"]),
    write: client([
      grant(STAFF, WRITE, {
        capability: "lookups.manage",
        condition:
          "A template that a client writes holds fifteen items at most, because a rule checks them one by one. Trusted code writes a longer one.",
      }),
    ]),
    dataClass: "public",
    enforcement: ENFORCED,
  }),
  outreachContacts: define({
    path: "outreachContacts/{id}",
    schema: participation.outreachContactDocSchema,
    id: auto,
    read: read(
      ["ADMIN", "SCOPED"],
      ["replicationId"],
      "Administrators and the leads of the replication.",
      "outreach.read",
    ),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),

  // Recruitment (section 7).
  countCategories: define({
    path: "countCategories/{key}",
    schema: recruitment.countCategoryDocSchema,
    id: key("category key", "key"),
    read: read(["MEMBER"]),
    write: client([grant(STAFF, WRITE, { capability: "lookups.manage" })]),
    dataClass: "public",
    enforcement: ENFORCED,
  }),
  recruitmentReports: define({
    path: "recruitmentReports/{id}",
    schema: recruitment.recruitmentReportDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { appendOnly: true, importable: true },
    enforcement: DENIED,
  }),
  plannedPauses: define({
    path: "plannedPauses/{id}",
    schema: recruitment.plannedPauseDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE, { capability: "participations.manage" })], UNIT),
    dataClass: "member",
    enforcement: DENIED,
  }),
  forecastRuns: define({
    path: "forecastRuns/{id}",
    schema: recruitment.forecastRunDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { appendOnly: true },
    enforcement: DENIED,
  }),

  // Tasks (section 8).
  taskLists: define({
    path: "taskLists/{id}",
    schema: tasks.taskListDocSchema,
    id: auto,
    read: read(["SCOPED", "SELF"], ["scopeKeys", "ownerUid"], "By scope, or by owner for a personal list."),
    write: client(
      [grant(["self"], WRITE), grant(MANAGERS, WRITE, { capability: "tasks.manage" })],
      ["scopeKeys", "ownerUid"],
    ),
    dataClass: "member",
    flags: { importable: true },
    enforcement: DENIED,
  }),
  tasks: define({
    path: "tasks/{id}",
    schema: tasks.taskDocSchema,
    id: auto,
    read: read(
      ["SCOPED", "SELF"],
      ["scopeKeys", "ownerUid", "assigneeUids", "collaboratorUids", "followerUids"],
      "By scope or owner, as its list. A user named in a participant array reads the task whatever its list.",
    ),
    write: client(
      [
        grant(["self"], WRITE),
        grant(MANAGERS, WRITE, { capability: "tasks.manage" }),
        grant(["participant"], ["update"], { condition: "A user named in assigneeUids or collaboratorUids." }),
      ],
      ["scopeKeys", "ownerUid", "assigneeUids", "collaboratorUids"],
      ["statusKey", "statusHistoryId"],
    ),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: DENIED,
  }),
  tags: define({
    path: "tags/{nameHash}",
    schema: tasks.tagDocSchema,
    id: built("tagId", ["name"]),
    read: read(["MEMBER"]),
    write: client([grant(["member"], ["create"]), grant(STAFF, ["update"], { capability: "lookups.manage" })]),
    dataClass: "member",
    enforcement: DENIED,
  }),
  reminders: define({
    path: "reminders/{id}",
    schema: tasks.reminderDocSchema,
    id: auto,
    read: read(["SELF"], ["uid"]),
    write: client([grant(["self"], ["create", "update", "delete"])], ["uid"], ["sentAt"]),
    dataClass: "member",
    enforcement: DENIED,
  }),
  taskCustom: customValues("tasks/{id}/private/custom", MANAGERS, ["parent.scopeKeys"]),

  // Workspace (section 9).
  pages: define({
    path: "pages/{pageId}",
    schema: workspace.pageDocSchema,
    id: { kind: "auto", note: "The body page of an entity takes the identifier that entityRefId builds." },
    read: read(["SCOPED"], ["scopeKeys"], "By page access, as resolved onto the page."),
    write: client(
      [grant(["editor", "fullAccess"], WRITE)],
      ["levelKeys"],
      ["scopeKeys", "levelKeys", "ancestorPageIds", "contentHead"],
    ),
    dataClass: "member",
    flags: { searchable: true },
    enforcement: DENIED,
  }),
  pageContent: define({
    path: "pages/{pageId}/content/{generation__n}",
    schema: workspace.pageContentChunkDocSchema,
    id: built("pageContentChunkId", ["generation", "index"]),
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { appendOnly: true, audited: false },
    enforcement: DENIED,
  }),
  pageUpdates: define({
    path: "pages/{pageId}/updates/{id}",
    schema: workspace.pageUpdateDocSchema,
    id: auto,
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: client([grant(["editor"], ["create"])], ["parent.levelKeys"]),
    dataClass: "member",
    flags: { appendOnly: true, audited: false },
    enforcement: DENIED,
  }),
  pageVersions: define({
    path: "pages/{pageId}/versions/{id}",
    schema: workspace.pageVersionDocSchema,
    id: auto,
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { appendOnly: true },
    enforcement: DENIED,
  }),
  pageVersionChunks: define({
    path: "pages/{pageId}/versions/{id}/chunks/{n}",
    schema: workspace.pageVersionChunkDocSchema,
    id: built("sequenceId", ["index"]),
    read: read(["SCOPED"], ["parent.pageId"], "As the version, which is as the page."),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { appendOnly: true, audited: false },
    enforcement: DENIED,
  }),
  pagePermissions: define({
    path: "pages/{pageId}/permissions/{principalType__principalId}",
    schema: workspace.pagePermissionDocSchema,
    id: built("pagePermissionId", ["principalType", "principalId"]),
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: client([grant(["fullAccess"], ["create", "update", "delete"])], ["parent.levelKeys"]),
    dataClass: "member",
    enforcement: DENIED,
  }),
  threads: define({
    path: "threads/{id}",
    schema: workspace.threadDocSchema,
    id: auto,
    read: read(["MEMBER", "SCOPED"], ["scopeKeys"], "As the target record."),
    write: client([grant(["commenter"], WRITE)], ["scopeKeys"]),
    dataClass: "member",
    flags: { importable: true },
    enforcement: DENIED,
  }),
  threadComments: define({
    path: "threads/{id}/comments/{id}",
    schema: workspace.threadCommentDocSchema,
    id: auto,
    read: read(["MEMBER", "SCOPED"], ["scopeKeys"], "As the thread."),
    write: client(
      [
        grant(["commenter"], ["create"]),
        grant(["author"], ["update"], {
          condition: "An author edits their own comment and removes it by setting deletedAt.",
        }),
      ],
      ["scopeKeys", "authorUid"],
    ),
    dataClass: "member",
    flags: { importable: true },
    enforcement: DENIED,
  }),
  attachments: define({
    path: "attachments/{id}",
    schema: workspace.attachmentDocSchema,
    id: auto,
    read: read(["MEMBER", "SCOPED"], ["scopeKeys"], "As the record the file is attached to."),
    write: client([grant(["editor"], WRITE)], ["scopeKeys"]),
    dataClass: "member",
    flags: { importable: true },
    enforcement: DENIED,
  }),
  databases: define({
    path: "databases/{databaseId}",
    schema: workspace.databaseDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"], "As the parent page."),
    write: client([grant(["editor"], WRITE)], ["levelKeys"], ["scopeKeys", "levelKeys"]),
    dataClass: "member",
    flags: { searchable: true },
    enforcement: DENIED,
  }),
  databaseRows: define({
    path: "databases/{databaseId}/rows/{rowId}",
    schema: workspace.databaseRowDocSchema,
    id: auto,
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: client([grant(["editor"], WRITE)], ["parent.levelKeys"]),
    dataClass: "member",
    flags: { searchable: true },
    enforcement: DENIED,
  }),
  collectionSchemas: define({
    path: "collectionSchemas/{collectionKey}",
    schema: workspace.collectionSchemaDocSchema,
    id: key("collection key", "collectionKey"),
    read: read(["MEMBER"]),
    write: client([grant(STAFF, WRITE, { capability: "lookups.manage" })]),
    dataClass: "member",
    enforcement: DENIED,
  }),
  views: define({
    path: "views/{viewId}",
    schema: workspace.viewDocSchema,
    id: auto,
    read: read(
      ["SELF", "MEMBER"],
      ["ownerUid", "isShared"],
      "The owner alone until isShared is set, and every member afterwards.",
    ),
    write: client(
      [grant(["self"], ["create", "update", "delete"]), grant(STAFF, ["update"], { condition: "A shared view." })],
      ["ownerUid"],
    ),
    dataClass: "member",
    enforcement: DENIED,
  }),
  dashboards: define({
    path: "dashboards/{id}",
    schema: workspace.dashboardDocSchema,
    id: auto,
    read: read(
      ["SELF", "MEMBER"],
      ["ownerUid"],
      "The owner for the dashboard of a user, and every member for any other.",
    ),
    write: client([grant(["self"], WRITE), grant(MANAGERS, WRITE)], ["ownerUid", "scopeKeys"]),
    dataClass: "member",
    enforcement: DENIED,
  }),

  // Datasets (section 10).
  storageEndpoints: define({
    path: "storageEndpoints/{key}",
    schema: datasets.storageEndpointDocSchema,
    id: key("endpoint key", "key"),
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(STAFF, WRITE, { capability: "datasets.manage" })], [], ["scopeKeys"]),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  storageEndpointConnection: define({
    path: "storageEndpoints/{key}/private/connection",
    schema: datasets.storageEndpointConnectionDocSchema,
    id: fixed("connection"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  datasets: define({
    path: "datasets/{datasetKey}",
    schema: datasets.datasetDocSchema,
    id: key("dataset key", "datasetKey"),
    read: read(["MEMBER"]),
    write: client([grant(MANAGERS, WRITE, { capability: "datasets.manage" })], UNIT, [
      "workflowStatusKey",
      "statusHistoryId",
      "qcStatus",
    ]),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: DENIED,
  }),
  datasetDetail: define({
    path: "datasets/{datasetKey}/private/detail",
    schema: datasets.datasetDetailDocSchema,
    id: fixed("detail"),
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: client(
      [grant(MANAGERS, WRITE, { capability: "datasets.manage" })],
      ["parent.replicationId", "parent.laboratoryId"],
    ),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  datasetStorageRefs: define({
    path: "datasets/{datasetKey}/storageRefs/{id}",
    schema: datasets.datasetStorageRefDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE, { capability: "datasets.manage" })], UNIT),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  datasetStorageRefLocation: define({
    path: "datasets/{datasetKey}/storageRefs/{id}/private/location",
    schema: datasets.datasetStorageRefLocationDocSchema,
    id: fixed("location"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  datasetManifests: define({
    path: "datasets/{datasetKey}/manifests/{id}",
    schema: datasets.datasetManifestDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, ["create"], { capability: "datasets.manage" })], UNIT),
    dataClass: "restricted",
    flags: { appendOnly: true },
    enforcement: DENIED,
  }),
  datasetManifestFileChunks: define({
    path: "datasets/{datasetKey}/manifests/{id}/fileChunks/{n}",
    schema: datasets.datasetManifestFileChunkDocSchema,
    id: built("sequenceId", ["index"]),
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client(
      [
        grant(MANAGERS, ["create"], {
          capability: "datasets.manage",
          condition: "Before the manifest itself exists. No chunk is accepted once it does.",
        }),
      ],
      UNIT,
    ),
    dataClass: "restricted",
    flags: { appendOnly: true, audited: false },
    enforcement: DENIED,
  }),
  datasetTransfers: define({
    path: "datasets/{datasetKey}/transfers/{id}",
    schema: datasets.datasetTransferDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE, { capability: "datasets.manage" })], UNIT),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  datasetQcAssessments: define({
    path: "datasets/{datasetKey}/qcAssessments/{id}",
    schema: datasets.datasetQcAssessmentDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, ["create"], { capability: "datasets.manage" })], UNIT),
    dataClass: "member",
    flags: { appendOnly: true },
    enforcement: DENIED,
  }),
  datasetAccessEvents: define({
    path: "datasets/{datasetKey}/accessEvents/{id}",
    schema: datasets.datasetAccessEventDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { appendOnly: true },
    enforcement: DENIED,
  }),
  datasetViewerLinks: define({
    path: "datasets/{datasetKey}/viewerLinks/{id}",
    schema: datasets.datasetViewerLinkDocSchema,
    id: auto,
    read: read(["FUNCTION"]),
    write: client(
      [grant(MANAGERS, WRITE, { capability: "datasets.manage" })],
      ["parent.replicationId", "parent.laboratoryId"],
    ),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  datasetCustom: customValues(
    "datasets/{datasetKey}/private/custom",
    MANAGERS,
    ["parent.scopeKeys"],
    ["parent.replicationId", "parent.laboratoryId"],
  ),
  processingRuns: define({
    path: "processingRuns/{id}",
    schema: datasets.processingRunDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE, { capability: "datasets.manage" })], UNIT),
    dataClass: "member",
    enforcement: DENIED,
  }),

  // Scientific outputs and governance (section 11).
  manuscripts: define({
    path: "manuscripts/{id}",
    schema: outputs.manuscriptDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client(
      [grant(LEADS, WRITE, { capability: "replications.manage" })],
      ["replicationId", "scopeKeys"],
      // The status, which a callable function records with its history; the identifier of the
      // public website, by which its importer finds the manuscript again; and the result of the
      // citation check, which a machine makes.
      ["status", "statusHistoryId", "websitePublicationId", "citationStatus", "citationMetadata"],
    ),
    dataClass: "member",
    flags: { importable: true, searchable: true },
    enforcement: ENFORCED,
  }),
  manuscriptEvents: define({
    path: "manuscripts/{id}/events/{id}",
    schema: outputs.manuscriptEventDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client([grant(LEADS, WRITE, { capability: "replications.manage" })], ["replicationId", "scopeKeys"]),
    dataClass: "member",
    enforcement: ENFORCED,
  }),
  manuscriptCustom: customValues("manuscripts/{id}/private/custom", LEADS, ["parent.scopeKeys"]),
  contributorTables: define({
    path: "contributorTables/{id}",
    schema: outputs.contributorTableDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(LEADS, WRITE, { capability: "replications.manage" })], ["replicationId", "scopeKeys"]),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  contributors: define({
    path: "contributors/{id}",
    schema: outputs.contributorDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client(
      [
        grant(LEADS, WRITE, {
          capability: "replications.manage",
          condition:
            "The contributor table and the manuscript belong to the replication of the row, and the person exists.",
        }),
      ],
      ["replicationId", "scopeKeys"],
    ),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  contributorContact: define({
    path: "contributors/{id}/private/contact",
    schema: outputs.contributorContactDocSchema,
    id: fixed("contact"),
    read: read(["SCOPED"], ["parent.scopeKeys"]),
    write: client(
      [grant(LEADS, WRITE, { capability: "replications.manage" })],
      ["parent.replicationId", "parent.scopeKeys"],
    ),
    dataClass: "restricted",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  decisions: define({
    path: "decisions/{id}",
    schema: outputs.decisionDocSchema,
    id: auto,
    read: read(["MEMBER"]),
    write: client([grant(MANAGERS, WRITE)], UNIT),
    dataClass: "member",
    flags: { searchable: true },
    enforcement: DENIED,
  }),
  risks: define({
    path: "risks/{id}",
    schema: outputs.riskDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE)], UNIT),
    dataClass: "member",
    enforcement: DENIED,
  }),
  incidents: define({
    path: "incidents/{id}",
    schema: outputs.incidentDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE)], UNIT),
    dataClass: "member",
    enforcement: DENIED,
  }),
  meetings: define({
    path: "meetings/{id}",
    schema: outputs.meetingDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE)], UNIT),
    dataClass: "member",
    flags: { searchable: true },
    enforcement: DENIED,
  }),
  progressReports: define({
    path: "progressReports/{id}",
    schema: outputs.progressReportDocSchema,
    id: auto,
    read: read(["SCOPED"], ["scopeKeys"]),
    write: client([grant(MANAGERS, WRITE)], UNIT),
    dataClass: "member",
    enforcement: DENIED,
  }),
  documentLinks: define({
    path: "documentLinks/{id}",
    schema: outputs.documentLinkDocSchema,
    id: auto,
    read: read(["MEMBER", "SCOPED"], ["scopeKeys"], "As the record the link is attached to."),
    write: client(
      [grant(MANAGERS, WRITE, { condition: "The scope fields equal the audience of the target record." })],
      [...UNIT, "scopeKeys"],
      // The result of the link check, which a machine makes.
      ["accessStatus", "httpStatus", "lastCheckedAt", "ownerName", "modifiedAt"],
    ),
    dataClass: "member",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),

  // Provenance, migration and integrations (section 12).
  sources: define({
    path: "sources/{key}",
    schema: provenance.sourceDocSchema,
    id: key("source key", "key"),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  sourceLocation: define({
    path: "sources/{key}/private/location",
    schema: provenance.sourceLocationDocSchema,
    id: fixed("location"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  sourceTabs: define({
    path: "sources/{key}/tabs/{tabKey}",
    schema: provenance.sourceTabDocSchema,
    id: built("sourceTabKey", ["name"], "A source with one tab uses a fixed key."),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  importBatches: define({
    path: "importBatches/{batchId}",
    schema: provenance.importBatchDocSchema,
    id: built("importBatchId", [], "From the instant the batch started and the hash of the file it read."),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  importBatchChanges: define({
    path: "importBatches/{batchId}/changes/{n}",
    schema: provenance.importBatchChangeDocSchema,
    id: built("sequenceId"),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { appendOnly: true, audited: false },
    enforcement: ENFORCED,
  }),
  importBatchChangeState: define({
    path: "importBatches/{batchId}/changes/{n}/special/state",
    schema: provenance.importBatchChangeStateDocSchema,
    id: fixed("state"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "special",
    flags: { appendOnly: true, audited: false },
    enforcement: ENFORCED,
  }),
  importBatchSeenRecords: define({
    path: "importBatches/{batchId}/seenRecords/{n}",
    schema: provenance.importBatchSeenRecordsDocSchema,
    id: built("sequenceId", ["index"]),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { appendOnly: true, audited: false },
    enforcement: ENFORCED,
  }),
  importBatchLog: define({
    path: "importBatches/{batchId}/log/{n}",
    schema: provenance.importBatchLogDocSchema,
    id: built("sequenceId"),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { appendOnly: true, audited: false },
    enforcement: ENFORCED,
  }),
  sourceRecords: define({
    path: "sourceRecords/{id}",
    schema: provenance.sourceRecordDocSchema,
    id: built("sourceRecordId", ["sourceKey", "tabKey", "rowKey", "rawHash"]),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: ENFORCED,
  }),
  sourceRecordSpecial: define({
    path: "sourceRecords/{id}/special/raw",
    schema: provenance.sourceRecordSpecialDocSchema,
    id: fixed("raw"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "special",
    flags: { audited: false },
    enforcement: ENFORCED,
  }),
  sourceRecordRawChunks: define({
    path: "sourceRecords/{id}/rawChunks/{n}",
    schema: provenance.sourceRecordRawChunkDocSchema,
    id: built("sequenceId", ["index"]),
    read: adminRead("imports.run"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { appendOnly: true, audited: false },
    enforcement: ENFORCED,
  }),
  reconciliationItems: define({
    path: "reconciliationItems/{fingerprint}",
    schema: provenance.reconciliationItemDocSchema,
    id: built("reconciliationFingerprint"),
    read: adminRead("reconciliation.resolve"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: ENFORCED,
  }),
  integrationMappings: define({
    path: "integrationMappings/{system__entityType__hashOfExternalId}",
    schema: provenance.integrationMappingDocSchema,
    id: built("integrationMappingId", ["system", "entityType", "externalId"]),
    read: adminRead("integrations.manage"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { importable: true },
    enforcement: ENFORCED,
  }),
  integrationConnections: define({
    path: "integrationConnections/{system}",
    schema: provenance.integrationConnectionDocSchema,
    id: key("system key", "system"),
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  syncMappings: define({
    path: "syncMappings/{id}",
    schema: provenance.syncMappingDocSchema,
    id: built("syncMappingId", ["sourceKey", "tabKey", "collectionKey"]),
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  syncMappingCellState: define({
    path: "syncMappings/{id}/cellState/{cellHash}",
    schema: provenance.syncCellStateDocSchema,
    id: built("syncCellStateId", ["recordId", "field"]),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: DENIED,
  }),
  syncRuns: define({
    path: "syncRuns/{id}",
    schema: provenance.syncRunDocSchema,
    id: built("syncRunId"),
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: DENIED,
  }),
  syncConflicts: define({
    path: "syncConflicts/{id}",
    schema: provenance.syncConflictDocSchema,
    id: auto,
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  documentTemplates: define({
    path: "documentTemplates/{key}",
    schema: provenance.documentTemplateDocSchema,
    id: key("template key", "key"),
    read: read(["ADMIN"]),
    write: client([grant(STAFF, WRITE, { capability: "integrations.manage" })]),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  generatedDocuments: define({
    path: "generatedDocuments/{templateKey__entityType__entityId}",
    schema: provenance.generatedDocumentDocSchema,
    id: built("generatedDocumentId", ["templateKey", "entityType", "entityId"]),
    read: read(["MEMBER", "SCOPED"], ["scopeKeys"], "As the record the document was generated for."),
    write: FUNCTION_ONLY,
    dataClass: "member",
    enforcement: DENIED,
  }),
  publicationBatches: define({
    path: "publicationBatches/{id}",
    schema: provenance.publicationBatchDocSchema,
    id: auto,
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    enforcement: DENIED,
  }),

  // Events, audit, automation, notifications and search (section 13).
  auditEvents: define({
    path: "auditEvents/{eventId}",
    schema: system.auditEventSchema,
    id: key("event identifier"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { appendOnly: true, audited: false },
    enforcement: ENFORCED,
  }),
  activity: define({
    path: "activity/{eventId}",
    schema: system.activityDocSchema,
    id: key("event identifier"),
    read: read(["MEMBER", "SCOPED"], ["scopeKeys"], "By the scope of the record the entry is about."),
    write: FUNCTION_ONLY,
    dataClass: "member",
    flags: { appendOnly: true, audited: false },
    enforcement: DENIED,
  }),
  automationRules: define({
    path: "automationRules/{id}",
    schema: system.automationRuleDocSchema,
    id: auto,
    read: read(["ADMIN"]),
    write: client([grant(STAFF, WRITE, { capability: "automations.manage" })]),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  automationRuns: define({
    path: "automationRuns/{idempotencyKey}",
    schema: system.automationRunDocSchema,
    id: key("idempotency key", "idempotencyKey"),
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: DENIED,
  }),
  mail: define({
    path: "mail/{id}",
    schema: system.mailDocSchema,
    id: built("mailId"),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: ENFORCED,
  }),
  eventFailures: define({
    path: "eventFailures/{consumer__eventId}",
    schema: system.eventFailureDocSchema,
    id: built("eventFailureId", ["consumer", "eventId"]),
    read: read(["ADMIN"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: DENIED,
  }),
  scheduledReports: define({
    path: "scheduledReports/{id}",
    schema: system.scheduledReportDocSchema,
    id: auto,
    read: read(["ADMIN"]),
    write: client([grant(STAFF, WRITE, { capability: "automations.manage" })]),
    dataClass: "restricted",
    enforcement: DENIED,
  }),
  searchIndex: define({
    path: "searchIndex/{entityType__entityId__part}",
    schema: system.searchIndexDocSchema,
    id: built("searchIndexId", ["entityType", "entityId", "part"]),
    read: read(["FUNCTION"]),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: DENIED,
  }),
  integrityReports: define({
    path: "integrityReports/{runId}",
    schema: system.integrityReportDocSchema,
    id: key("run identifier"),
    read: adminRead("audit.read"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { audited: false },
    enforcement: ENFORCED,
  }),
  integrityReportFindings: define({
    path: "integrityReports/{runId}/findings/{n}",
    schema: system.integrityFindingDocSchema,
    id: built("sequenceId"),
    read: adminRead("audit.read"),
    write: FUNCTION_ONLY,
    dataClass: "restricted",
    flags: { appendOnly: true, audited: false },
    enforcement: ENFORCED,
  }),
  systemSettings: define({
    path: "system/settings",
    schema: system.systemSettingsDocSchema,
    id: fixed("settings"),
    read: read(["MEMBER"]),
    write: FUNCTION_ONLY,
    dataClass: "member",
    enforcement: ENFORCED,
  }),
} as const;

export type CollectionKey = keyof typeof DEFINITIONS;

type Registry = {
  readonly [K in CollectionKey]: (typeof DEFINITIONS)[K] extends Definition<infer Template, infer Schema>
    ? CollectionEntry<K, Template, Schema>
    : never;
};

/** A path with its parameter names removed, so that two spellings of one path compare equal. */
function shapeOf(path: string): string {
  return path
    .split("/")
    .map((part) => (PARAMETER.test(part) ? "{}" : part))
    .join("/");
}

function versionOf(entryKey: string, schema: z.ZodObject): number {
  const version = (schema.shape as Record<string, { value?: unknown } | undefined>).schemaVersion?.value;
  if (typeof version !== "number") throw new Error(`The schema of ${entryKey} does not state its version.`);
  return version;
}

function buildRegistry(): Registry {
  const keyByShape = new Map(
    Object.entries(DEFINITIONS).map(([entryKey, definition]) => [shapeOf(definition.path), entryKey]),
  );
  const entries = Object.entries(DEFINITIONS).map(([entryKey, definition]) => {
    const segments = definition.path.split("/");
    const documentSegments = segments.length;
    const entry: CollectionEntry = {
      ...definition,
      key: entryKey,
      parent: keyByShape.get(shapeOf(segments.slice(0, -2).join("/"))) ?? null,
      collectionId: segments[documentSegments - 2] ?? "",
      schemaVersion: versionOf(entryKey, definition.schema),
      docPath: (...ids: string[]) => fillPath(definition.path, ids),
      collectionPath: (...ids: string[]) => fillPath(definition.path, ids, documentSegments - 1),
    };
    return [entryKey, entry] as const;
  });
  return Object.fromEntries(entries) as unknown as Registry;
}

/** The registry. `COLLECTIONS.participations.docPath(id)` is the path of a participation. */
export const COLLECTIONS: Registry = buildRegistry();

export const COLLECTION_KEYS = Object.keys(COLLECTIONS) as readonly CollectionKey[];

/** Every entry, in the order of the data model. */
export const COLLECTION_ENTRIES: readonly CollectionEntry[] = COLLECTION_KEYS.map((entryKey) => COLLECTIONS[entryKey]);

/** The stored shape of a document of an entry. */
export type DocOf<K extends CollectionKey> = z.output<Registry[K]["schema"]>;

/** The keys of the entries whose documents share a collection, as opposed to one fixed-name document. */
export type ListableCollectionKey = {
  [K in CollectionKey]: Registry[K]["path"] extends `${string}}` ? K : never;
}[CollectionKey];

/** The identifiers that the document path of an entry takes, in order. */
export type DocPathIds<K extends CollectionKey> = Parameters<Registry[K]["docPath"]>;
/** The identifiers that the collection path of an entry takes: those of its ancestors. */
export type CollectionPathIds<K extends CollectionKey> = Parameters<Registry[K]["collectionPath"]>;

/**
 * The fields that no direct client write may change (docs/DATA_MODEL.md, section 14): the
 * record of creation, the parts of the identifier, the scope fields, the origin and the
 * provenance of the document, and whatever the entry reserves for trusted code. A client that
 * creates a document sets none of the provenance fields, which belong to the importers.
 */
export function clientImmutableFields(entry: CollectionEntry): readonly string[] {
  const identifierFields =
    entry.identifier.kind === "builder"
      ? entry.identifier.fields
      : entry.identifier.kind === "key" && entry.identifier.field !== null
        ? [entry.identifier.field]
        : [];
  const reserved = entry.write.mode === "client" ? entry.write.functionOnlyFields : [];
  const candidates = [
    "schemaVersion",
    "createdAt",
    "createdBy",
    ...identifierFields,
    "replicationId",
    "laboratoryId",
    "scopeKeys",
    "dataOrigin",
    ...PROVENANCE_FIELDS,
    // The one source record that is part of an entity itself.
    "sourceRecordId",
    ...reserved,
  ];
  const declared = new Set(Object.keys(entry.schema.shape));
  return [...new Set(candidates)].filter((field) => declared.has(field));
}

/**
 * The fields of an entry that hold a value exactly as a source gave it (docs/DATA_MODEL.md,
 * section 1): those whose name ends in `Source`, apart from what `clientImmutableFields` keeps
 * from clients altogether. On a document that an import wrote, which carries `sourceRecordIds`,
 * no client changes one, because `fieldSources` still names the source row as the origin of the
 * value. A correction goes through `correctionRequests`.
 */
export function verbatimSourceFields(entry: CollectionEntry): readonly string[] {
  const immutable = clientImmutableFields(entry);
  return Object.keys(entry.schema.shape).filter((field) => field.endsWith("Source") && !immutable.includes(field));
}

/**
 * The collection that holds the records of each entity type. An entity in a subcollection is
 * addressed by the identifier of its parent joined to its own (see `nestedEntityId`).
 */
export const ENTITY_COLLECTIONS = {
  user: "users",
  person: "persons",
  institution: "institutions",
  group: "groups",
  programme: "programmes",
  laboratory: "laboratories",
  equipmentConfiguration: "laboratoryEquipment",
  replication: "replications",
  hypothesis: "replicationHypotheses",
  protocol: "replicationProtocols",
  protocolVersion: "replicationProtocolVersions",
  candidateStudy: "candidateStudies",
  participation: "participations",
  recruitmentReport: "recruitmentReports",
  taskList: "taskLists",
  task: "tasks",
  page: "pages",
  thread: "threads",
  comment: "threadComments",
  attachment: "attachments",
  database: "databases",
  databaseRow: "databaseRows",
  view: "views",
  dashboard: "dashboards",
  storageEndpoint: "storageEndpoints",
  dataset: "datasets",
  processingRun: "processingRuns",
  manuscript: "manuscripts",
  contributorTable: "contributorTables",
  contributor: "contributors",
  decision: "decisions",
  risk: "risks",
  incident: "incidents",
  meeting: "meetings",
  progressReport: "progressReports",
  documentLink: "documentLinks",
  source: "sources",
  importBatch: "importBatches",
} as const satisfies { readonly [T in EntityType]: ListableCollectionKey };

/** The path of the document that a polymorphic reference points at. */
export function entityPath(entityType: EntityType, entityId: string): string {
  const { path } = COLLECTIONS[ENTITY_COLLECTIONS[entityType]];
  const nested = path.split("/").length > 2;
  return fillPath(path, nested ? splitNestedEntityId(entityId) : [entityId]);
}
