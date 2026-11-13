// Roles, capabilities and the default capability matrix (docs/SECURITY.md, section 5).
//
// This file is the one place where a capability is named and where the defaults are decided.
// It grants nothing by itself: `resolveAccess` in access.ts turns a user's role assignments
// into the `capabilities` map of `access/{uid}`, and security rules and callable functions
// read that document. Add a capability here, in CAPABILITY_DEFINITIONS and in the matrix.
import { z } from "./zod";

/**
 * | Role                    | Scope           | Summary                                                    |
 * |-------------------------|-----------------|------------------------------------------------------------|
 * | `programme_admin`       | The programme   | Everything, including roles, imports, publishing and audit |
 * | `core_team`             | The programme   | Broad operational read and write, sensitive operations off |
 * | `replication_lead`      | One replication | Manages that replication and what belongs to it            |
 * | `lab_coordinator`       | One laboratory  | Maintains that laboratory, its members and participations  |
 * | `lab_member`            | One laboratory  | Reads the laboratory and files its recruitment updates     |
 * | `external_collaborator` | Explicit grants | Only the pages and records shared with the account         |
 *
 * Role keys keep the spelling of the security design, which is the one exception to
 * lowerCamelCase values (docs/DATA_MODEL.md, section 1).
 */
export const ROLES = [
  "programme_admin",
  "core_team",
  "replication_lead",
  "lab_coordinator",
  "lab_member",
  "external_collaborator",
] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.output<typeof roleSchema>;

/** The roles that are held for the programme as a whole. Their holders must enrol a second factor. */
export const PROGRAMME_ROLES = ["programme_admin", "core_team"] as const;
export const programmeRoleSchema = z.enum(PROGRAMME_ROLES);
export type ProgrammeRole = z.output<typeof programmeRoleSchema>;

export function isProgrammeRole(role: Role): role is ProgrammeRole {
  return (PROGRAMME_ROLES as readonly Role[]).includes(role);
}

/** What a role assignment can be scoped to. */
export const ROLE_SCOPE_TYPES = ["programme", "replication", "laboratory", "group"] as const;
export const roleScopeTypeSchema = z.enum(ROLE_SCOPE_TYPES);
export type RoleScopeType = z.output<typeof roleScopeTypeSchema>;

/**
 * The scope types each role may be assigned for. An assignment of any other combination
 * confers nothing. A `group` scope limits an external collaborator to the workspace of one group.
 */
export const SCOPE_TYPES_OF_ROLE: { readonly [R in Role]: readonly RoleScopeType[] } = {
  programme_admin: ["programme"],
  core_team: ["programme"],
  replication_lead: ["replication"],
  lab_coordinator: ["laboratory"],
  lab_member: ["laboratory"],
  external_collaborator: ["programme", "group"],
};

/**
 * How far a capability can reach.
 *
 * | Level       | Held by                                                                       |
 * |-------------|-------------------------------------------------------------------------------|
 * | `account`   | Every signed-in account in good standing. Never stored and never overridden   |
 * | `member`    | Every member role, for the programme as a whole                               |
 * | `unit`      | A programme role everywhere, and a scoped role within its replication or laboratory |
 * | `programme` | A programme role, or a named grant. A scoped role never holds it, whatever the overrides say |
 * | `administrator` | A programme administrator alone. No override gives it to another role and no named grant confers it |
 */
export type CapabilityLevel = "account" | "member" | "unit" | "programme" | "administrator";

export interface CapabilityDefinition {
  readonly level: CapabilityLevel;
  /** What the capability allows, in one line. */
  readonly allows: string;
}

/**
 * The registry of capabilities. The names are part of the contract between the interface, the
 * callable functions and the security rules, and they never change once in use.
 *
 * `demographics.read` is special in one respect: the function that serves demographic data
 * also requires an unexpired named grant in `capabilityGrants` and a verified second factor,
 * from programme administrators too (docs/SECURITY.md, section 2).
 */
export const CAPABILITY_DEFINITIONS = {
  "portal.use": { level: "account", allows: "Opening the portal and the account's own records" },
  "directory.read": { level: "member", allows: "Reading the directory of persons, laboratories and replications" },
  "people.manage": { level: "programme", allows: "Creating persons and editing every directory field" },
  "people.contact.read": { level: "unit", allows: "Reading the contact details of the people of a unit" },
  "demographics.read": { level: "programme", allows: "Asking for special-category data of another person" },
  "claims.review": { level: "programme", allows: "Deciding account claims that went to review" },
  "labs.manage": { level: "unit", allows: "Editing a laboratory, its members, equipment and private detail" },
  "labs.claims.review": { level: "unit", allows: "Deciding requests to represent a laboratory" },
  "replications.manage": { level: "unit", allows: "Editing a replication and its scientific definition" },
  "participations.manage": { level: "unit", allows: "Editing participations and their onboarding records" },
  "recruitment.report": { level: "unit", allows: "Filing lab-reported recruitment reports" },
  "recruitment.verify": { level: "programme", allows: "Filing centrally verified recruitment reports" },
  "tasks.manage": { level: "unit", allows: "Managing the task lists of a scope" },
  "datasets.manage": { level: "unit", allows: "Editing dataset records, transfers and quality assessments" },
  "datasets.paths.read": { level: "unit", allows: "Asking for storage locations and connection details" },
  "pages.manage": { level: "unit", allows: "Holding full access to the pages of a scope" },
  "lookups.manage": { level: "programme", allows: "Editing statuses, categories, templates and vocabulary" },
  "roles.manage": { level: "programme", allows: "Granting and revoking roles, grants and overrides" },
  "users.suspend": { level: "programme", allows: "Suspending an account and ending its sessions" },
  "imports.run": { level: "programme", allows: "Previewing and applying import batches" },
  "imports.rollback": { level: "programme", allows: "Rolling an import batch back" },
  "reconciliation.resolve": { level: "programme", allows: "Deciding items of the reconciliation queue" },
  "integrations.manage": { level: "programme", allows: "Configuring integrations and synchronisation" },
  "integrations.credentials": { level: "programme", allows: "Naming the secrets an integration uses" },
  "publishing.prepare": { level: "programme", allows: "Preparing and previewing a public export" },
  "publishing.approve": { level: "programme", allows: "Approving a public export for publication" },
  "audit.read": { level: "programme", allows: "Consulting the audit trail" },
  "automations.manage": { level: "programme", allows: "Editing automation rules and scheduled reports" },
  "outreach.read": { level: "unit", allows: "Reading the outreach correspondence of a replication" },
  "sealed.read": {
    level: "administrator",
    allows:
      "Reading what a decision of the programme seals: the outcome labels and the summary figures of the migration",
  },
} as const satisfies Record<string, CapabilityDefinition>;

export type Capability = keyof typeof CAPABILITY_DEFINITIONS;
export const CAPABILITIES = Object.keys(CAPABILITY_DEFINITIONS) as readonly Capability[];

/** The capabilities that a role, a grant or an override can confer: every one except `portal.use`. */
export type GrantableCapability = Exclude<Capability, "portal.use">;
export const GRANTABLE_CAPABILITIES = CAPABILITIES.filter(
  (capability): capability is GrantableCapability => CAPABILITY_DEFINITIONS[capability].level !== "account",
);
export const grantableCapabilitySchema = z.enum(
  GRANTABLE_CAPABILITIES as [GrantableCapability, ...GrantableCapability[]],
);

type CamelCase<Name extends string> = Name extends `${infer Head}.${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : Name;

/**
 * The name of a capability as a map key, for example `demographicsRead` for
 * `demographics.read`. A full stop separates the segments of a Firestore field path, so the
 * dotted name cannot be a key.
 */
export type CapabilityField = CamelCase<GrantableCapability>;

export function capabilityField<C extends GrantableCapability>(capability: C): CamelCase<C> {
  return capability.replace(/\.([a-z])/g, (_match, letter: string) => letter.toUpperCase()) as CamelCase<C>;
}

export const CAPABILITY_FIELDS = GRANTABLE_CAPABILITIES.map((capability) => capabilityField(capability));
export const capabilityFieldSchema = z.enum(CAPABILITY_FIELDS as [CapabilityField, ...CapabilityField[]]);

/**
 * The sensitive capabilities. The core team does not hold them by default, and a programme
 * administrator switches each on or off for a role through `roleCapabilities`.
 */
export const SENSITIVE_CAPABILITIES = [
  "roles.manage",
  "users.suspend",
  "demographics.read",
  "imports.rollback",
  "integrations.credentials",
  "publishing.approve",
] as const satisfies readonly GrantableCapability[];

const UNIT_MANAGEMENT = [
  "directory.read",
  "people.contact.read",
  "participations.manage",
  "recruitment.report",
  "tasks.manage",
  "datasets.manage",
  "datasets.paths.read",
  "pages.manage",
] as const satisfies readonly GrantableCapability[];

/**
 * The default capability matrix: what each role holds before any override.
 *
 * | Role                    | Holds by default                                                    |
 * |-------------------------|---------------------------------------------------------------------|
 * | `programme_admin`       | Every capability                                                    |
 * | `core_team`             | Every capability except the sensitive ones and `sealed.read`, which programme administrators alone hold |
 * | `replication_lead`      | The unit management set, `replications.manage` and `outreach.read`, within its replication |
 * | `lab_coordinator`       | The unit management set, `labs.manage` and `labs.claims.review`, within its laboratory |
 * | `lab_member`            | `directory.read`, and `recruitment.report` within its laboratory    |
 * | `external_collaborator` | Nothing: such an account reads and edits only what is shared with it |
 *
 * The unit management set is `directory.read`, `people.contact.read`,
 * `participations.manage`, `recruitment.report`, `tasks.manage`, `datasets.manage`,
 * `datasets.paths.read` and `pages.manage`.
 */
export const DEFAULT_ROLE_CAPABILITIES: { readonly [R in Role]: readonly GrantableCapability[] } = {
  programme_admin: GRANTABLE_CAPABILITIES,
  core_team: GRANTABLE_CAPABILITIES.filter(
    (capability) =>
      !(SENSITIVE_CAPABILITIES as readonly GrantableCapability[]).includes(capability) &&
      CAPABILITY_DEFINITIONS[capability].level !== "administrator",
  ),
  replication_lead: [...UNIT_MANAGEMENT, "replications.manage", "outreach.read"],
  lab_coordinator: [...UNIT_MANAGEMENT, "labs.manage", "labs.claims.review"],
  lab_member: ["directory.read", "recruitment.report"],
  external_collaborator: [],
};

/** Whether a named grant in `capabilityGrants` can confer a capability. One of the level `administrator` never is. */
export function grantCanConfer(capability: GrantableCapability): boolean {
  return CAPABILITY_DEFINITIONS[capability].level !== "administrator";
}

/** The overrides of one role, as `roleCapabilities/{role}` stores them. */
export type CapabilityOverrides = { readonly [F in CapabilityField]?: boolean };

/**
 * Whether a role can hold a capability at all. A programme administrator always holds every
 * capability and an external collaborator never holds any, so neither takes overrides. A
 * scoped role never holds a capability of the level `programme`.
 */
export function roleCanHold(role: Role, capability: GrantableCapability): boolean {
  if (role === "external_collaborator") return false;
  if (CAPABILITY_DEFINITIONS[capability].level === "administrator") return role === "programme_admin";
  if (isProgrammeRole(role)) return true;
  return CAPABILITY_DEFINITIONS[capability].level !== "programme";
}

/**
 * The capabilities a role confers once the overrides of `roleCapabilities/{role}` are applied
 * to the default matrix. An override is ignored where it would lock programme administrators
 * out or give a role something `roleCanHold` excludes.
 */
export function effectiveRoleCapabilities(
  role: Role,
  overrides: CapabilityOverrides = {},
): readonly GrantableCapability[] {
  if (role === "programme_admin" || role === "external_collaborator") return DEFAULT_ROLE_CAPABILITIES[role];
  const defaults = DEFAULT_ROLE_CAPABILITIES[role];
  return GRANTABLE_CAPABILITIES.filter((capability) => {
    if (!roleCanHold(role, capability)) return false;
    return overrides[capabilityField(capability)] ?? defaults.includes(capability);
  });
}
