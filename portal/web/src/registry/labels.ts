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
/**
 * The officially assigned codes of ISO 3166-1, without the deprecated, transitionally reserved
 * and exceptionally reserved ones (such as `DY` for Benin or `HV` for Burkina Faso), which the
 * browser would otherwise name twice.
 */
export const ISO_COUNTRY_CODES: readonly string[] = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
];

/** Every country of ISO 3166-1, by its two-letter code, sorted by its English name. */
export function countryOptions(): { code: string; name: string }[] {
  return ISO_COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );
}

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

/** A count with its noun, in the singular for one: "1 replication", "4 replications". */
export function countOf(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

export const LABORATORY_STATUS_LABELS = {
  unverified: "Not yet verified",
  active: "Active",
  inactive: "Inactive",
} as const;

export const READINESS_LABELS = {
  notStarted: "Onboarding not started",
  inProgress: "Onboarding in progress",
  readyForReview: "Ready for review",
  approved: "Readiness approved",
} as const;

export const CHECKLIST_STATUS_LABELS = {
  notStarted: "Not started",
  inProgress: "In progress",
  done: "Done",
  notApplicable: "Not applicable",
  blocked: "Blocked",
} as const;

export const ETHICS_STATUS_LABELS = {
  unknown: "Not known",
  notStarted: "Not started",
  submitted: "Submitted",
  approved: "Approved",
  notRequired: "Not required",
} as const;

export const TRAINING_STATUS_LABELS = {
  unknown: "Not known",
  notStarted: "Not started",
  inProgress: "In progress",
  completed: "Completed",
  notRequired: "Not required",
} as const;

export const COMPATIBILITY_LABELS = {
  compatible: "Meets the requirements",
  incompatible: "Misses a requirement",
  unknown: "Compatibility unknown",
  noRequirements: "No equipment requirements recorded",
  noConfiguration: "No current equipment configuration",
} as const;

export const REQUIREMENT_OUTCOME_LABELS = {
  met: "Met",
  missing: "Missing",
  unknown: "Unknown",
} as const;

export const SOURCE_AUTHORITY_LABELS = {
  historical: "Historical",
  live: "Live",
  reference: "Reference",
} as const;

export const SOURCE_SYNC_LABELS = {
  oneOff: "Imported once",
  repeatable: "Imported again on request",
  scheduledPull: "Pulled on a schedule",
  twoWay: "Synchronised both ways",
} as const;

export const BATCH_STATUS_LABELS = {
  running: "Running",
  previewed: "Previewed",
  applied: "Applied",
  failed: "Failed",
  rolledBack: "Rolled back",
} as const;

export const RECONCILIATION_KIND_LABELS: Readonly<Record<string, string>> = {
  duplicatePerson: "Possible duplicate person",
  conflictingLead: "Leads in conflict",
  ambiguousLaboratory: "Ambiguous laboratory",
  valueConflict: "Values in conflict",
  unmatchedIdentifier: "Unmatched identifier",
  ambiguousEmail: "Ambiguous address",
  aliasConfirmation: "Spelling to confirm",
  statusQuestion: "Status question",
  unverifiedLabel: "Unverified label",
  identifierDefect: "Defective identifier",
  institutionMatch: "Institution to match",
  candidateLink: "Suggested link",
  structureChange: "Change of structure",
  unparsedValue: "Unreadable value",
  formattingSignal: "Meaning in formatting",
  annotationReview: "Note to review",
  vocabularyReview: "Vocabulary to review",
  linkDefect: "Defective link",
  privacyReview: "Privacy review",
  missingFromSource: "Missing from the source",
};
