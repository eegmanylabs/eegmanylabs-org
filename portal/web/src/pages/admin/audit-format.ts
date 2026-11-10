// How a change of the audit trail is written out for a reader. Pure, so that it is tested by itself.
import { type ListedAuditEvent, ROLES, type Role } from "@eegml/shared";
import { ROLE_LABELS } from "@/app/labels";

type Change = ListedAuditEvent["changes"][number];

/**
 * | Kind       | The value                                                                 |
 * |------------|---------------------------------------------------------------------------|
 * | `withheld` | Is not in the trail: the record is restricted or the field is special    |
 * | `absent`   | Did not exist on this side of the change                                 |
 * | `value`    | Is shown as `text`                                                       |
 */
export type ShownValue =
  | { readonly kind: "withheld" }
  | { readonly kind: "absent" }
  | { readonly kind: "value"; readonly text: string; readonly multiline: boolean };

/** Words for identifiers whose plain spelling out would mislead or read badly. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  userId: "Linked account",
  personId: "Linked person",
  uid: "Account",
  scopeType: "Kind of scope",
  scopeId: "Scope",
  sessionsValidAfter: "Sessions valid from",
  emailLower: "Email address",
  mfaEnrolled: "Second factor enrolled",
  orcid: "ORCID iD",
  countryCode: "Country",
  affiliationSummary: "Affiliation",
  displayName: "Name as shown",
  candidatePersonIds: "Candidates",
  claimedAt: "Claimed",
  expiresAt: "Ends",
};

/** Words for the coded values of the registry: statuses, outcomes and kinds. Roles take their own labels. */
const VALUE_LABELS: Readonly<Record<string, string>> = {
  active: "Active",
  suspended: "Suspended",
  revoked: "Revoked",
  expired: "Expired",
  pendingApproval: "Waiting for approval",
  pendingReview: "Waiting for review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  open: "Open",
  accepted: "Accepted",
  confirmed: "Confirmed",
  proposed: "Proposed",
  needsReview: "Needs review",
  programme: "Programme",
  laboratory: "Laboratory",
  replication: "Replication",
  group: "Group",
  primaryEmail: "Primary address",
  secondaryEmail: "Secondary address",
  manual: "Request for access",
};

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

/** An identifier in camel case as words in sentence case: `equipmentConfiguration` becomes "Equipment configuration". */
export function spelledOut(identifier: string): string {
  const words = identifier
    .replace(/[._]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The name of a kind of record, for example "Equipment configuration". */
export function recordTypeLabel(entityType: string): string {
  return spelledOut(entityType);
}

/** The name of a field, for example "Kind of scope" for `scopeType`. */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? spelledOut(field);
}

/** A coded value in words, or the text as it is when it is no code the portal knows. */
export function valueLabel(value: string): string {
  if (isRole(value)) return ROLE_LABELS[value];
  return VALUE_LABELS[value] ?? value;
}

/** A value of a change as text: a code in words, other text as it is, anything else as indented JSON. */
export function shownValue(change: Change, side: "before" | "after"): ShownValue {
  if (change.withheld === true) return { kind: "withheld" };
  if (!(side in change)) return { kind: "absent" };
  const value = change[side];
  if (typeof value === "string")
    return { kind: "value", text: value === "" ? '""' : valueLabel(value), multiline: value.includes("\n") };
  const text = JSON.stringify(value, null, 2) ?? "null";
  return { kind: "value", text, multiline: text.includes("\n") };
}

/** The last segments of a document path, which say what was written without the long prefix. */
export function shortPath(path: string): string {
  const segments = path.split("/");
  return segments.length <= 2 ? path : segments.slice(-2).join("/");
}

/** An action of the registry in words: `role.granted` becomes "Role granted". */
export function actionLabel(action: string): string {
  return spelledOut(action);
}
