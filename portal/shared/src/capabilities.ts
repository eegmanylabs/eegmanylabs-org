// The capability matrix: which account state allows which capability.
//
// This file is the description of the policy that the interface uses to decide what to show.
// It never grants anything. Security rules and callable functions enforce the same decisions on
// every request, and a capability shown here that they refuse is simply refused.
import type { AccessDoc } from "./schemas/access";

/**
 * | Capability   | Held by                 | Allows                                  |
 * |--------------|-------------------------|-----------------------------------------|
 * | `portal.use` | Every signed-in account | Opening the portal and its own account  |
 */
export const CAPABILITIES = ["portal.use"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** What the capability matrix needs to know about the current account. */
export interface AccountState {
  readonly signedIn: boolean;
  /** The account's access document, or null when it is not known or does not exist. */
  readonly access: Pick<AccessDoc, "member" | "personId"> | null;
}

const MATRIX: { readonly [C in Capability]: (state: AccountState) => boolean } = {
  "portal.use": (state) => state.signedIn,
};

export function hasCapability(state: AccountState, capability: Capability): boolean {
  return MATRIX[capability](state);
}

export function capabilitiesOf(state: AccountState): ReadonlySet<Capability> {
  return new Set(CAPABILITIES.filter((capability) => hasCapability(state, capability)));
}
