// Who may do what on a page (docs/DATA_MODEL.md, section 9).
//
// A page carries its resolved audience: `scopeKeys`, the keys of everyone who may read it, and
// `levelKeys`, for each of the levels `comment`, `edit` and `full` the keys that hold at least
// that level. The functions that create, move and share pages resolve the audience with the
// builders below, and the security rules read those two fields alone. `pageLevelFor` makes the
// decision the rules make, for the interface, for the functions and for the tests that compare
// the rules with the registry.
//
// | Page                                        | Readers                         | Comment         | Edit                | Full                  |
// |---------------------------------------------|---------------------------------|-----------------|---------------------|-----------------------|
// | The body of a replication                   | Every member                    | Every member    | Its team            | Its managers          |
// | The body of a laboratory                    | Every member                    | Every member    | Its members         | Its managers          |
// | The body of a member                        | Every member                    | Every member    | The member          | The member            |
// | A page of the programme's workspace         | Every member                    | Every member    | Every member        | Its creator           |
// | A page that inherits                        | As the page above it            |                 |                     |                       |
// | A restricted page                           | The principals it lists, at their levels                                           ||||
//
// Programme administrators and the core team read every page and hold full access to it. The
// holders of `pages.manage` for the replication or the laboratory of a page that inherits hold
// full access without being listed.
import { type AccessDocument, programmePowersInEffect, type SecondFactorFacts, sessionScopeKeys } from "./access";
import { capabilityField, roleSchema } from "./capabilities";
import {
  groupScopeKey,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  replicationScopeKey,
  roleScopeKey,
  userScopeKey,
} from "./ids";
import type { PageLevel } from "./schemas/workspace";

/** The levels of access to a page, weakest first. */
export const PAGE_LEVELS = ["view", "comment", "edit", "full"] as const satisfies readonly PageLevel[];

/** What an account may do on a page: one of the levels, or nothing at all. */
export type PageAccessLevel = "none" | PageLevel;

/** Whether a level is at least another. */
export function atLeast(level: PageAccessLevel, wanted: PageLevel): boolean {
  return level !== "none" && PAGE_LEVELS.indexOf(level) >= PAGE_LEVELS.indexOf(wanted);
}

export interface PageLevelKeys {
  readonly comment: readonly string[];
  readonly edit: readonly string[];
  readonly full: readonly string[];
}

/** The resolved audience of a page, as the page stores it. */
export interface PageAudience {
  readonly replicationId: string | null;
  readonly laboratoryId: string | null;
  readonly scopeKeys: string[];
  readonly levelKeys: { comment: string[]; edit: string[]; full: string[] };
}

export type PagePrincipalType = "user" | "group" | "role";

/** One principal of a restricted page, with its level. */
export interface PagePrincipal {
  readonly principalType: PagePrincipalType;
  readonly principalId: string;
  readonly level: PageLevel;
}

/** The scope key that a principal holds. */
export function principalScopeKey(principalType: PagePrincipalType, principalId: string): string {
  switch (principalType) {
    case "user":
      return userScopeKey(principalId);
    case "group":
      return groupScopeKey(principalId);
    case "role":
      return roleScopeKey(roleSchema.parse(principalId));
  }
}

const sortedUnique = (keys: Iterable<string>): string[] => [...new Set(keys)].sort();

/** Level keys in which each level holds the keys of the levels above it. */
function cumulative(
  comment: readonly string[],
  edit: readonly string[],
  full: readonly string[],
): PageAudience["levelKeys"] {
  return {
    comment: sortedUnique([...comment, ...edit, ...full]),
    edit: sortedUnique([...edit, ...full]),
    full: sortedUnique(full),
  };
}

function audience(
  unit: { readonly replicationId: string | null; readonly laboratoryId: string | null },
  readers: readonly string[],
  comment: readonly string[],
  edit: readonly string[],
  full: readonly string[],
): PageAudience {
  const levelKeys = cumulative(comment, edit, full);
  return {
    replicationId: unit.replicationId,
    laboratoryId: unit.laboratoryId,
    scopeKeys: sortedUnique([...readers, ...levelKeys.comment]),
    levelKeys,
  };
}

/** The body page of a replication: read and commented on by every member, edited by its team. */
export function replicationPageAudience(studyKey: string): PageAudience {
  const team = replicationScopeKey(studyKey);
  return audience(
    { replicationId: studyKey, laboratoryId: null },
    [MEMBERS_SCOPE_KEY],
    [MEMBERS_SCOPE_KEY],
    [team],
    [],
  );
}

/** The body page of a laboratory: read and commented on by every member, edited by its members. */
export function laboratoryPageAudience(laboratoryId: string): PageAudience {
  const members = laboratoryScopeKey(laboratoryId);
  return audience({ replicationId: null, laboratoryId }, [MEMBERS_SCOPE_KEY], [MEMBERS_SCOPE_KEY], [members], []);
}

/**
 * The body page of a member: read and commented on by every member, and the member's own, with
 * full access, once the person has claimed an account.
 */
export function personPageAudience(userId: string | null): PageAudience {
  const own = userId === null ? [] : [userScopeKey(userId)];
  return audience({ replicationId: null, laboratoryId: null }, [MEMBERS_SCOPE_KEY], [MEMBERS_SCOPE_KEY], own, own);
}

/** A page at the top of the programme's workspace: every member edits it, and its creator holds full access. */
export function workspacePageAudience(creatorUid: string): PageAudience {
  return audience(
    { replicationId: null, laboratoryId: null },
    [MEMBERS_SCOPE_KEY],
    [MEMBERS_SCOPE_KEY],
    [MEMBERS_SCOPE_KEY],
    [userScopeKey(creatorUid)],
  );
}

/** A restricted page: open to the principals it lists, each at its level, within the unit of the page. */
export function restrictedPageAudience(
  unit: { readonly replicationId: string | null; readonly laboratoryId: string | null },
  principals: readonly PagePrincipal[],
): PageAudience {
  const keysAt = (level: PageLevel) =>
    principals
      .filter((principal) => principal.level === level)
      .map((principal) => principalScopeKey(principal.principalType, principal.principalId));
  return audience(unit, keysAt("view"), keysAt("comment"), keysAt("edit"), keysAt("full"));
}

/** What the decision about a page reads of the page. */
export interface PageAccessFacts {
  readonly accessMode: "inherit" | "restricted";
  readonly replicationId: string | null;
  readonly laboratoryId: string | null;
  readonly scopeKeys: readonly string[];
  readonly levelKeys: PageLevelKeys;
}

type AccessFacts = Pick<
  AccessDocument,
  "member" | "suspended" | "scopeKeys" | "programmeRoles" | "capabilities" | "mfaEnrolled" | "secondFactorRequired"
>;

/**
 * Whether an account manages a page: it holds `pages.manage` for the programme, with the
 * programme powers in effect, or, for a page that inherits, for the replication or the
 * laboratory of the page. The rules make the same decision in `managesPage`.
 */
export function managesPage(access: AccessFacts, session: SecondFactorFacts, page: PageAccessFacts): boolean {
  const held: readonly string[] = access.capabilities[capabilityField("pages.manage")] ?? [];
  const powers = programmePowersInEffect(access, session);
  if ((access.programmeRoles.includes("programme_admin") || held.includes("programme")) && powers) return true;
  if (page.accessMode !== "inherit") return false;
  return (
    (page.replicationId !== null && held.includes(replicationScopeKey(page.replicationId))) ||
    (page.laboratoryId !== null && held.includes(laboratoryScopeKey(page.laboratoryId)))
  );
}

/**
 * The level of an account on a page, which is the decision of the security rules. An account
 * that is suspended, or is no member, holds nothing. Programme administrators and the core team
 * read every page in a session that holds their powers. Every level needs the right to read.
 */
export function pageLevelFor(
  access: AccessFacts | null,
  session: SecondFactorFacts,
  page: PageAccessFacts,
): PageAccessLevel {
  if (access === null || access.suspended || !access.member) return "none";
  const keys = new Set(sessionScopeKeys(access, session));
  const holdsAny = (listed: readonly string[]) => listed.some((key) => keys.has(key));
  const staff = access.programmeRoles.length > 0 && programmePowersInEffect(access, session);
  if (!staff && !holdsAny(page.scopeKeys)) return "none";
  if (managesPage(access, session, page) || holdsAny(page.levelKeys.full)) return "full";
  if (holdsAny(page.levelKeys.edit)) return "edit";
  if (holdsAny(page.levelKeys.comment)) return "comment";
  return "view";
}
