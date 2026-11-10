// What the signed-in account may see and do in the registry, decided from its access document
// the way the security rules decide it. This decides what the interface shows and never what
// is allowed: the rules and the callable functions refuse a caller whatever is shown (D-006).
import {
  type Capability,
  can,
  MEMBERS_SCOPE_KEY,
  PROGRAMME_POWER_SCOPE_KEYS,
  type RecordScope,
} from "@eegml/shared";
import { useAuth } from "@/auth/AuthProvider";
import { programmePowersWithheld } from "@/auth/privilege";
import { usePrivilegeFacts } from "@/auth/use-privilege";
import type { AccessRecord } from "@/data";

export interface Viewer {
  readonly uid: string;
  readonly personId: string | null;
  readonly access: AccessRecord;
  /** Whether the powers of a programme role are in effect in this session. */
  readonly staff: boolean;
  /** Whether the account is a programme administrator whose powers are in effect. */
  readonly administrator: boolean;
  /** Whether the account holds a capability for a record, with its second factor where required. */
  can(capability: Capability, scope: RecordScope | "programme" | "anywhere"): boolean;
  /** Whether the account may read every membership of a replication, those awaiting review included. */
  readsTeamOf(studyKey: string): boolean;
  /** The scope keys a list query may name for this session, at most as many as Firestore accepts. */
  readonly queryScopeKeys: readonly string[];
}

/** The most values Firestore accepts in one array-membership clause. */
const MAX_CLAUSE_VALUES = 30;

/** The facts of a viewer, pure, so that the decisions are tested by themselves. */
export function viewerOf(uid: string, access: AccessRecord, sessionSecondFactor: boolean): Viewer {
  const withheld = programmePowersWithheld({ access, sessionSecondFactor, enrolledFactors: 0 });
  const staff = !access.suspended && access.programmeRoles.length > 0 && !withheld;
  const sessionKeys = withheld
    ? access.scopeKeys.filter((key) => !PROGRAMME_POWER_SCOPE_KEYS.includes(key))
    : access.scopeKeys;
  // `members` first, so that what every member reads is always asked for.
  const ordered = [MEMBERS_SCOPE_KEY, ...sessionKeys.filter((key) => key !== MEMBERS_SCOPE_KEY)];
  return {
    uid,
    personId: access.personId,
    access,
    staff,
    administrator: staff && access.programmeRoles.includes("programme_admin"),
    can(capability, scope) {
      if (capability === "portal.use") return !access.suspended;
      if (scope === "anywhere") return can(access, capability, "anywhere");
      // The powers of a programme role or of a named grant wait for the second factor; a right
      // held for a replication or a laboratory does not.
      const view = withheld
        ? {
            ...access,
            capabilities: Object.fromEntries(
              Object.entries(access.capabilities).map(([field, keys]) => [
                field,
                (keys ?? []).filter((key) => !PROGRAMME_POWER_SCOPE_KEYS.includes(key)),
              ]),
            ),
          }
        : access;
      return can(view, capability, scope);
    },
    readsTeamOf(studyKey) {
      return staff || access.leadReplicationIds.includes(studyKey) || access.teamReplicationIds.includes(studyKey);
    },
    queryScopeKeys: ordered.slice(0, MAX_CLAUSE_VALUES),
  };
}

/** The signed-in account as the registry sees it, or null while its access document is not known. */
export function useViewer(): Viewer | null {
  const { session, access } = useAuth();
  const facts = usePrivilegeFacts();
  if (session.status !== "signed-in" || access.status !== "ready" || access.data === null || facts === null) {
    return null;
  }
  return viewerOf(session.user.uid, access.data, facts.sessionSecondFactor);
}
