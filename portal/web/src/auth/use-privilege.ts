import type { Capability } from "@eegml/shared";
import { secondFactor } from "@/data";
import { useAuth } from "./AuthProvider";
import { navigableCapabilities, type PrivilegeFacts } from "./privilege";

/** What the privilege decisions are made from, for the signed-in account. Null while its access document is not known. */
export function usePrivilegeFacts(): PrivilegeFacts | null {
  const { session, access } = useAuth();
  if (session.status !== "signed-in" || access.status !== "ready" || access.data === null) return null;
  return {
    access: access.data,
    sessionSecondFactor: session.user.secondFactor,
    enrolledFactors: secondFactor.listFactors().length,
  };
}

/** The capabilities whose destinations the navigation lists for the signed-in account. */
export function useNavigableCapabilities(): ReadonlySet<Capability> {
  const { session } = useAuth();
  return navigableCapabilities(usePrivilegeFacts(), session.status === "signed-in");
}

/**
 * Whether the signed-in account is a programme administrator. Some operations stay with
 * administrators whatever the capability matrix says (programme roles, sensitive capabilities,
 * the accounts of programme staff), and the console offers them to administrators only. The
 * functions decide; this only spares a reader a control that would be refused.
 */
export function useProgrammeAdministrator(): boolean {
  const { access } = useAuth();
  return access.status === "ready" && access.data?.programmeRoles.includes("programme_admin") === true;
}
