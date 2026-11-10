// How the registry names the values it shows. One place, so that the list, the record page, the
// preview and the dashboard use the same words.
import {
  type AliasScheme,
  CREDIT_ROLES,
  type CreditRoleKey,
  type DataOrigin,
  type ReplicationMembershipRole,
} from "@eegml/shared";

export const DATA_ORIGIN_LABELS: Readonly<Record<DataOrigin, string>> = {
  live: "Live",
  importedHistorical: "Imported historical",
  demo: "Demonstration data",
  projected: "Projected",
};

export const CITATION_STATUS_LABELS = {
  verified: "Citation verified",
  mismatch: "Citation mismatch",
  notFound: "Citation not found",
  unverified: "Citation unverified",
} as const;

export const ALIAS_SCHEME_LABELS: Readonly<Record<AliasScheme, string>> = {
  programme: "Programme identifier",
  website: "Public website",
  cloudAccount: "Cloud account",
  bids: "BIDS name",
  eegnet: "EEGNet name",
  sourceTab: "Source tab",
  sourceLabel: "Link text in a source",
  dataRepository: "Data repository",
  other: "Other spelling",
};

export const MEMBERSHIP_ROLE_LABELS: Readonly<Record<ReplicationMembershipRole, string>> = {
  lead: "Lead",
  coLead: "Co-lead",
  formerLead: "Former lead",
  coordinator: "Coordinator",
  analyst: "Analyst",
  member: "Member",
  advisor: "Advisor",
};

export const LABORATORY_ROLE_LABELS = {
  pi: "Principal investigator",
  coordinator: "Coordinator",
  representative: "Representative",
  member: "Member",
} as const;

export const LABORATORY_ENTRY_STATUS_LABELS = {
  proposed: "Proposed, not confirmed",
  confirmed: "Confirmed",
  ended: "Ended",
} as const;

export const PARTICIPATION_STATUS_LABELS = {
  invited: "Invited",
  interested: "Interested",
  confirmed: "Confirmed",
  onboarding: "Onboarding",
  ready: "Ready",
  collecting: "Collecting",
  collectionComplete: "Collection complete",
  withdrawn: "Withdrawn",
  declined: "Declined",
} as const;

export const MANUSCRIPT_STATUS_LABELS = {
  planned: "Planned",
  drafting: "Drafting",
  submitted: "Submitted",
  underReview: "Under review",
  revising: "Revising",
  inPrincipleAcceptance: "In-principle acceptance",
  accepted: "Accepted",
  published: "Published",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
} as const;

export const MANUSCRIPT_KIND_LABELS = {
  stage1Rr: "Stage 1 registered report",
  stage2Rr: "Stage 2 registered report",
  preprint: "Preprint",
  article: "Article",
  dataPaper: "Data paper",
  software: "Software",
  other: "Other output",
} as const;

export const DOCUMENT_KIND_LABELS = {
  googleDoc: "Google document",
  googleSheet: "Google sheet",
  driveFolder: "Drive folder",
  osf: "OSF project",
  github: "GitHub repository",
  pdf: "PDF",
  form: "Form",
  url: "Web page",
} as const;

export const DOCUMENT_ACCESS_LABELS = {
  unknown: "Access not checked",
  public: "Open to anyone with the link",
  restricted: "Restricted",
  unreachable: "Could not be reached",
} as const;

export const SCIENTIFIC_REVIEW_LABELS = {
  unverified: "Not scientifically reviewed",
  underReview: "Under scientific review",
  verified: "Scientifically verified",
} as const;

/** The official names of the CRediT roles, by key. */
export const CREDIT_ROLE_NAMES: Readonly<Record<CreditRoleKey, string>> = Object.fromEntries(
  CREDIT_ROLES.map((role) => [role.key, role.name]),
) as Record<CreditRoleKey, string>;

/** The metrics of the historical workbooks, in words. A metric the portal does not know keeps its key. */
export const HISTORICAL_METRIC_LABELS: Readonly<Record<string, string>> = {
  nLabsSigned: "Laboratories signed",
  nLabsFinished: "Laboratories finished",
  totalNToBeRun: "Participants to be run",
  totalNMainCollected: "Participants collected, main experiment",
  totalNRest: "Participants collected, resting state",
};

const regions = new Intl.DisplayNames(["en-GB"], { type: "region" });

/** The name of a country from its two-letter code, or the code where the code names no region. */
export function countryName(code: string): string {
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

const integers = new Intl.NumberFormat("en-GB");

export function formatCount(value: number): string {
  return integers.format(value);
}
