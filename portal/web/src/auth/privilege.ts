// What the interface shows for a destination that needs a capability, decided from the access
// document and the session. This decides what is shown and never what is allowed: the security
// rules and the callable functions refuse a caller whatever the interface shows (D-006).
import {
  CAPABILITY_DEFINITIONS,
  type Capability,
  can,
  capabilityField,
  effectiveRoleCapabilities,
  type GrantableCapability,
  PROGRAMME_SCOPE_KEY,
} from "@eegml/shared";
import type { AccessRecord } from "@/data";

/**
 * | Decision            | Shown                                                                    |
 * |---------------------|--------------------------------------------------------------------------|
 * | `allowed`           | The destination                                                          |
 * | `enrol-factor`      | A prompt to enrol a second factor, which the account's role requires     |
 * | `sign-in-again`     | A prompt to sign in again and present the second factor                  |
 * | `denied`            | A notice that the account may not open the destination                   |
 */
export type PrivilegeDecision = "allowed" | "enrol-factor" | "sign-in-again" | "denied";

export interface PrivilegeFacts {
  readonly access: Pick<
    AccessRecord,
    "suspended" | "capabilities" | "programmeRoles" | "mfaEnrolled" | "secondFactorRequired"
  >;
  /** Whether this session presented a second factor when it began. */
  readonly sessionSecondFactor: boolean;
  /** How many factors the account has enrolled, as Firebase Authentication reports them. */
  readonly enrolledFactors: number;
}

/**
 * Whether the powers of a programme role or of a named grant are withheld in this session: the
 * access document requires a second factor, and the factor is not enrolled or the session did
 * not present it. This is `programmePowersInEffect` of the shared package, seen from the browser.
 */
export function programmePowersWithheld(facts: PrivilegeFacts): boolean {
  const { access } = facts;
  return access.secondFactorRequired && (!access.mfaEnrolled || !facts.sessionSecondFactor);
}

/**
 * Whether the account holds the capability for the programme once its second factor is in place:
 * the access document lists it, or a programme role of the account confers it by default.
 */
function wouldHold(facts: PrivilegeFacts, capability: GrantableCapability, held: readonly string[]): boolean {
  return (
    held.includes(PROGRAMME_SCOPE_KEY) ||
    facts.access.programmeRoles.some((role) => effectiveRoleCapabilities(role).includes(capability))
  );
}

/** What to show for a destination that needs `capability`. */
export function decidePrivilege(facts: PrivilegeFacts, capability: Capability): PrivilegeDecision {
  const { access } = facts;
  if (access.suspended) return "denied";
  if (!programmePowersWithheld(facts)) return can(access, capability, "anywhere") ? "allowed" : "denied";
  if (capability === "portal.use") return "allowed";
  // A right that a scoped role confers, as a coordinator holds one for a laboratory, needs no factor.
  const held = access.capabilities[capabilityField(capability)] ?? [];
  if (held.some((scope) => scope !== PROGRAMME_SCOPE_KEY)) return "allowed";
  if (!wouldHold(facts, capability, held)) return "denied";
  return facts.enrolledFactors === 0 || !access.mfaEnrolled ? "enrol-factor" : "sign-in-again";
}

/** The capabilities whose destinations the navigation lists: those that are open, or that wait for the second factor. */
export function navigableCapabilities(facts: PrivilegeFacts | null, signedIn: boolean): ReadonlySet<Capability> {
  if (!signedIn) return new Set();
  if (facts === null) return new Set<Capability>(["portal.use"]);
  return new Set(
    (Object.keys(CAPABILITY_DEFINITIONS) as Capability[]).filter(
      (capability) => decidePrivilege(facts, capability) !== "denied",
    ),
  );
}
