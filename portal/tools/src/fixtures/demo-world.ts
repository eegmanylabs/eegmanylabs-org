// SYNTHETIC DATA. Nobody and nothing listed here exists.
//
// The demonstration world that `seed:demo` writes to the Local Emulator Suite: institutions,
// laboratories, persons, replications and what ties them together, for local development and
// for end-to-end tests. Every name is invented, every study identifier begins with "Demo", and
// every address uses the example.org domain, which is reserved for documentation and can never
// receive mail. The values of the special categories are placeholders that describe nobody.
//
// One institution lists example.org among its email domains, so that a request to represent one
// of its laboratories finds an address in the domain of the institution. The other two list
// domains under the reserved name "example", which no address of the world lies in.
//
// The world exercises each path of the claim flow:
//
// | Address                                  | Signing in with it                                         |
// |------------------------------------------|------------------------------------------------------------|
// | `demo.admin@example.org`                 | Becomes the programme administrator, through the bootstrap record, and matches Ada Example |
// | `ben.sample@example.org`      | Matches one unclaimed person who leads a replication and is the principal investigator of a laboratory |
// | `gus.specimen.second@example.org`       | Matches one person through a secondary address              |
// | `shared.mock@example.org`                | Is held by two persons, so the claim goes to review         |
// | `kit.sampleton@example.org`     | Is held in a way that no claim may rest on, so the claim goes to review |
// | `demo.one@example.org`                   | Belongs to an account that has claimed Ivy Pretend already  |
// | `demo.two@example.org`                   | Matches nobody                                              |

export const DEMO_BOOTSTRAP_ADMIN_EMAIL = "demo.admin@example.org";

export interface DemoInstitution {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string;
  readonly city: string;
  readonly emailDomains: readonly string[];
}

export const DEMO_INSTITUTIONS: readonly DemoInstitution[] = [
  {
    id: "demo-inst-northfield",
    name: "Northfield Example University",
    countryCode: "GB",
    city: "Northfield",
    emailDomains: ["example.org"],
  },
  {
    id: "demo-inst-harbour",
    name: "Harbour Example Institute",
    countryCode: "DE",
    city: "Harbourtown",
    emailDomains: ["harbour.example"],
  },
  {
    id: "demo-inst-ridgeway",
    name: "Ridgeway Example College",
    countryCode: "NL",
    city: "Ridgeway",
    emailDomains: ["ridgeway.example"],
  },
];

export interface DemoLaboratory {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly institutionId: string;
  readonly piPersonId?: string;
}

export const DEMO_LABORATORIES: readonly DemoLaboratory[] = [
  {
    id: "demo-lab-attention",
    slug: "demo-attention-lab",
    name: "Demo Attention Laboratory",
    institutionId: "demo-inst-northfield",
    piPersonId: "demo-person-ben",
  },
  {
    id: "demo-lab-memory",
    slug: "demo-memory-lab",
    name: "Demo Memory Laboratory",
    institutionId: "demo-inst-northfield",
  },
  {
    id: "demo-lab-signal",
    slug: "demo-signal-lab",
    name: "Demo Signal Laboratory",
    institutionId: "demo-inst-harbour",
    piPersonId: "demo-person-dev",
  },
  {
    id: "demo-lab-cognition",
    slug: "demo-cognition-lab",
    name: "Demo Cognition Laboratory",
    institutionId: "demo-inst-ridgeway",
  },
];

export interface DemoEmail {
  readonly email: string;
  readonly kind: "primary" | "secondary" | "historical";
  readonly claimEligible: boolean;
}

export interface DemoPerson {
  readonly id: string;
  readonly slug: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly institutionId?: string;
  readonly isCoreTeam?: boolean;
  readonly emails: readonly DemoEmail[];
  /** Placeholders for the special categories. They describe nobody. */
  readonly demographics?: { readonly genderSource: string; readonly ethnicitySource: string };
}

const primary = (email: string, claimEligible = true): DemoEmail => ({ email, kind: "primary", claimEligible });

export const DEMO_PERSONS: readonly DemoPerson[] = [
  {
    id: "demo-person-ada",
    slug: "demo-ada-example",
    givenName: "Ada",
    familyName: "Example",
    emails: [primary(DEMO_BOOTSTRAP_ADMIN_EMAIL)],
  },
  {
    id: "demo-person-ben",
    slug: "demo-ben-sample",
    givenName: "Ben",
    familyName: "Sample",
    institutionId: "demo-inst-northfield",
    emails: [primary("ben.sample@example.org")],
    demographics: { genderSource: "synthetic gender term A", ethnicitySource: "synthetic ethnicity term A" },
  },
  {
    id: "demo-person-cleo",
    slug: "demo-cleo-placeholder",
    givenName: "Cleo",
    familyName: "Placeholder",
    institutionId: "demo-inst-northfield",
    emails: [primary("cleo.placeholder@example.org")],
  },
  {
    id: "demo-person-dev",
    slug: "demo-dev-fictional",
    givenName: "Dev",
    familyName: "Fictional",
    institutionId: "demo-inst-harbour",
    emails: [primary("dev.fictional@example.org")],
  },
  {
    id: "demo-person-eli",
    slug: "demo-eli-madeup",
    givenName: "Eli",
    familyName: "Madeup",
    institutionId: "demo-inst-northfield",
    emails: [primary("eli.madeup@example.org")],
  },
  {
    id: "demo-person-fay",
    slug: "demo-fay-invented",
    givenName: "Fay",
    familyName: "Invented",
    institutionId: "demo-inst-harbour",
    emails: [primary("fay.invented@example.org")],
  },
  {
    id: "demo-person-gus",
    slug: "demo-gus-specimen",
    givenName: "Gus",
    familyName: "Specimen",
    institutionId: "demo-inst-ridgeway",
    emails: [
      primary("gus.specimen@example.org"),
      { email: "gus.specimen.second@example.org", kind: "secondary", claimEligible: true },
    ],
  },
  // Two persons who hold one address: a data error that the claim flow sends to review.
  {
    id: "demo-person-hana",
    slug: "demo-hana-mock",
    givenName: "Hana",
    familyName: "Mock",
    emails: [primary("shared.mock@example.org")],
  },
  {
    id: "demo-person-hugo",
    slug: "demo-hugo-mock",
    givenName: "Hugo",
    familyName: "Mock",
    emails: [primary("shared.mock@example.org")],
  },
  {
    id: "demo-person-ivy",
    slug: "demo-ivy-pretend",
    givenName: "Ivy",
    familyName: "Pretend",
    institutionId: "demo-inst-ridgeway",
    emails: [primary("demo.one@example.org")],
    demographics: { genderSource: "synthetic gender term B", ethnicitySource: "synthetic ethnicity term B" },
  },
  {
    id: "demo-person-jo",
    slug: "demo-jo-dummy",
    givenName: "Jo",
    familyName: "Dummy",
    isCoreTeam: true,
    emails: [primary("jo.dummy@example.org")],
  },
  {
    id: "demo-person-kit",
    slug: "demo-kit-sampleton",
    givenName: "Kit",
    familyName: "Sampleton",
    institutionId: "demo-inst-ridgeway",
    // An address that no claim may rest on.
    emails: [primary("kit.sampleton@example.org", false)],
  },
];

export interface DemoLaboratoryMember {
  readonly laboratoryId: string;
  readonly personId: string;
  readonly role: "pi" | "coordinator" | "representative" | "member";
  readonly isAuthorisedRepresentative: boolean;
  readonly status: "proposed" | "confirmed";
}

export const DEMO_LABORATORY_MEMBERS: readonly DemoLaboratoryMember[] = [
  {
    laboratoryId: "demo-lab-attention",
    personId: "demo-person-ben",
    role: "pi",
    isAuthorisedRepresentative: true,
    status: "confirmed",
  },
  {
    laboratoryId: "demo-lab-attention",
    personId: "demo-person-eli",
    role: "member",
    isAuthorisedRepresentative: false,
    status: "confirmed",
  },
  {
    laboratoryId: "demo-lab-memory",
    personId: "demo-person-cleo",
    role: "coordinator",
    isAuthorisedRepresentative: true,
    status: "confirmed",
  },
  {
    laboratoryId: "demo-lab-signal",
    personId: "demo-person-dev",
    role: "pi",
    isAuthorisedRepresentative: true,
    status: "confirmed",
  },
  // Proposed by the laboratory and not confirmed by the person: it puts no laboratory on the person.
  {
    laboratoryId: "demo-lab-signal",
    personId: "demo-person-fay",
    role: "member",
    isAuthorisedRepresentative: false,
    status: "proposed",
  },
  {
    laboratoryId: "demo-lab-cognition",
    personId: "demo-person-gus",
    role: "coordinator",
    isAuthorisedRepresentative: true,
    status: "confirmed",
  },
  {
    laboratoryId: "demo-lab-cognition",
    personId: "demo-person-ivy",
    role: "member",
    isAuthorisedRepresentative: false,
    status: "confirmed",
  },
];

/** The descriptive fields of a demonstration replication, as an import or a lead would record them. */
export interface DemoReplicationDetails {
  readonly originalAuthors: string;
  readonly originalYear: number;
  readonly originalTitle: string;
  readonly originalReference: string;
  readonly originalDoi?: string;
  readonly citationStatus: "unverified" | "verified" | "mismatch" | "notFound";
  readonly abstract?: string;
  readonly effectOfInterest?: string;
  readonly plainLanguageDescription?: string;
  readonly theme?: string;
  readonly psychConstruct?: string;
  readonly publicStageNumber?: number;
  readonly publicStageName?: string;
  readonly signupUrl?: string;
  readonly signupActive?: boolean;
  /** Extraction fields, verbatim as a source states them. */
  readonly originalNSource?: string;
  readonly originalEffectSizeSource?: string;
  readonly minEegChannelsSource?: string;
}

export interface DemoReplication {
  readonly studyKey: string;
  readonly shortTitle: string;
  /** Null for a replication whose status nobody has recorded. */
  readonly statusKey: string | null;
  /** `withdrawn` for a replication that the public website no longer lists. */
  readonly selectionStatus: "selected" | "withdrawn";
  readonly details: DemoReplicationDetails;
  /** Other spellings of the study identifier, each with its scheme. */
  readonly aliases: readonly { readonly scheme: "website" | "bids" | "eegnet"; readonly alias: string }[];
}

export const DEMO_REPLICATIONS: readonly DemoReplication[] = [
  {
    studyKey: "DemoAlpha2001",
    shortTitle: "Demonstration study Alpha (synthetic)",
    statusKey: "collecting",
    selectionStatus: "selected",
    details: {
      originalAuthors: "Example, A. and Sample, B.",
      originalYear: 2001,
      originalTitle: "An invented effect of attention on an invented potential",
      originalReference: "Example, A. and Sample, B. (2001). An invented effect. Journal of Examples, 1, 1-10.",
      originalDoi: "10.5555/demo.alpha",
      citationStatus: "verified",
      abstract: "A synthetic abstract that describes a study that never took place.",
      effectOfInterest: "A larger synthetic potential in the attended condition.",
      plainLanguageDescription: "We test whether an invented brain response is larger when people pay attention.",
      theme: "Attention",
      psychConstruct: "Selective attention",
      publicStageNumber: 3,
      publicStageName: "Data collection",
      signupUrl: "https://example.org/signup/demo-alpha",
      signupActive: true,
      originalNSource: "24 (12 per group)",
      originalEffectSizeSource: "d = 0.8",
      minEegChannelsSource: "32",
    },
    aliases: [
      { scheme: "website", alias: "DemoAlpha2001" },
      { scheme: "bids", alias: "demoalpha" },
    ],
  },
  {
    studyKey: "DemoBeta2005",
    shortTitle: "Demonstration study Beta (synthetic)",
    statusKey: "recruitingLabs",
    selectionStatus: "selected",
    details: {
      originalAuthors: "Placeholder, C.",
      originalYear: 2005,
      originalTitle: "A made-up account of memory and an imagined rhythm",
      originalReference: "Placeholder, C. (2005). A made-up account. Example Letters, 5, 50-60.",
      originalDoi: "10.5555/demo.beta",
      citationStatus: "mismatch",
      theme: "Memory",
      psychConstruct: "Working memory",
      publicStageNumber: 2,
      publicStageName: "Recruiting laboratories",
      signupUrl: "https://example.org/signup/demo-beta",
      signupActive: false,
    },
    aliases: [
      { scheme: "website", alias: "DemoBeta2005" },
      { scheme: "eegnet", alias: "Demo_Beta" },
    ],
  },
  {
    studyKey: "DemoGamma2010",
    shortTitle: "Demonstration study Gamma (synthetic)",
    statusKey: "planning",
    selectionStatus: "selected",
    details: {
      originalAuthors: "Fictional, D. and Madeup, E.",
      originalYear: 2010,
      originalTitle: "An imaginary signal of error monitoring",
      originalReference: "Fictional, D. and Madeup, E. (2010). An imaginary signal. Invented Review, 10, 100-110.",
      citationStatus: "unverified",
      theme: "Cognitive control",
      psychConstruct: "Error monitoring",
      publicStageNumber: 1,
      publicStageName: "Planning",
    },
    aliases: [
      { scheme: "website", alias: "DemoGamma2010" },
      { scheme: "bids", alias: "demogamma" },
    ],
  },
  // Removed from the public website, and no status recorded.
  {
    studyKey: "DemoDelta2015",
    shortTitle: "Demonstration study Delta (synthetic)",
    statusKey: null,
    selectionStatus: "withdrawn",
    details: {
      originalAuthors: "Invented, F.",
      originalYear: 2015,
      originalTitle: "A withdrawn study of a pretend oscillation",
      originalReference: "Invented, F. (2015). A pretend oscillation. Journal of Examples, 15, 15-25.",
      citationStatus: "notFound",
      theme: "Perception",
    },
    aliases: [
      { scheme: "website", alias: "DemoDelta2015" },
      { scheme: "bids", alias: "demodelta" },
    ],
  },
];

export interface DemoHypothesis {
  readonly replicationId: string;
  readonly number: number;
  readonly text: string;
  /** The verbatim null-significance label of a source. */
  readonly nullSigSource?: string;
  /** The verbatim and unverified "replicated" label of a source, kept in the restricted detail. */
  readonly replicatedSource?: string;
}

export const DEMO_HYPOTHESES: readonly DemoHypothesis[] = [
  {
    replicationId: "DemoAlpha2001",
    number: 1,
    text: "The synthetic potential is larger for attended than for unattended stimuli.",
    nullSigSource: "sig",
    replicatedSource: "yes",
  },
  {
    replicationId: "DemoAlpha2001",
    number: 2,
    text: "The difference is larger at central than at lateral sites.",
    nullSigSource: "null",
    replicatedSource: "partially",
  },
  {
    replicationId: "DemoBeta2005",
    number: 1,
    text: "The imagined rhythm grows with the number of items held in mind.",
  },
];

export interface DemoManuscript {
  readonly id: string;
  readonly replicationId: string;
  readonly title: string;
  readonly kind: "stage1Rr" | "stage2Rr" | "preprint" | "article";
  readonly status: "planned" | "drafting" | "inPrincipleAcceptance" | "published";
  readonly journal?: string;
  readonly doi?: string;
  readonly acceptedYear?: number;
}

export const DEMO_MANUSCRIPTS: readonly DemoManuscript[] = [
  {
    id: "demo-manuscript-alpha-rr1",
    replicationId: "DemoAlpha2001",
    title: "Demonstration study Alpha: a synthetic stage 1 registered report",
    kind: "stage1Rr",
    status: "inPrincipleAcceptance",
    journal: "Journal of Examples",
    doi: "10.5555/demo.alpha.rr1",
    acceptedYear: 2024,
  },
  {
    id: "demo-manuscript-beta-plan",
    replicationId: "DemoBeta2005",
    title: "Demonstration study Beta: a planned synthetic report",
    kind: "stage1Rr",
    status: "planned",
  },
];

export interface DemoContributor {
  readonly id: string;
  readonly firstNameSource: string;
  readonly surnameSource: string;
  readonly orderInPublication: number;
  readonly affiliationSource: string;
  readonly personId: string;
  readonly creditRoles: Readonly<Record<string, string | boolean>>;
}

/** The contributor table of Alpha's registered report, as a contributor sheet would hold it. */
export const DEMO_CONTRIBUTOR_TABLE = {
  id: "demo-contributors-alpha",
  replicationId: "DemoAlpha2001",
  manuscriptId: "demo-manuscript-alpha-rr1",
  sourceKey: "demoContributorSheet",
} as const;

export const DEMO_CONTRIBUTORS: readonly DemoContributor[] = [
  {
    id: "demo-contributor-alpha-1",
    firstNameSource: "Ben",
    surnameSource: "Sample",
    orderInPublication: 1,
    affiliationSource: "Northfield Example University",
    personId: "demo-person-ben",
    creditRoles: { conceptualization: true, methodology: true, writingOriginalDraft: "x" },
  },
  {
    id: "demo-contributor-alpha-2",
    firstNameSource: "Eli",
    surnameSource: "Madeup",
    orderInPublication: 2,
    affiliationSource: "Northfield Example University",
    personId: "demo-person-eli",
    creditRoles: { formalAnalysis: true, software: "TRUE" },
  },
];

export interface DemoAggregate {
  readonly replicationIds: readonly string[];
  readonly metricKey: string;
  readonly valueSource: string;
  readonly valueNumeric?: number;
}

/** Replication-level figures of a historical workbook, which states no as-of date. */
export const DEMO_HISTORICAL_AGGREGATES: readonly DemoAggregate[] = [
  { replicationIds: ["DemoAlpha2001"], metricKey: "nLabsSigned", valueSource: "12", valueNumeric: 12 },
  { replicationIds: ["DemoAlpha2001"], metricKey: "totalNToBeRun", valueSource: "400", valueNumeric: 400 },
  { replicationIds: ["DemoAlpha2001"], metricKey: "totalNMainCollected", valueSource: "340", valueNumeric: 340 },
  { replicationIds: ["DemoAlpha2001"], metricKey: "totalNRest", valueSource: "120", valueNumeric: 120 },
  // One row of the workbook that describes two replications together, never apportioned.
  { replicationIds: ["DemoBeta2005", "DemoGamma2010"], metricKey: "nLabsFinished", valueSource: "3 (both)" },
];

export interface DemoDocumentLink {
  readonly id: string;
  readonly replicationId: string;
  readonly kind: "googleDoc" | "driveFolder" | "osf";
  readonly title: string;
  readonly url: string;
  readonly accessStatus: "unknown" | "public" | "restricted";
  /** Restricted links are read within the replication only. */
  readonly restricted: boolean;
}

export const DEMO_DOCUMENT_LINKS: readonly DemoDocumentLink[] = [
  {
    id: "demo-link-alpha-plan",
    replicationId: "DemoAlpha2001",
    kind: "googleDoc",
    title: "Analysis plan (synthetic)",
    url: "https://example.org/documents/demo-alpha-plan",
    accessStatus: "public",
    restricted: false,
  },
  {
    id: "demo-link-alpha-folder",
    replicationId: "DemoAlpha2001",
    kind: "driveFolder",
    title: "Team folder (synthetic)",
    url: "https://example.org/documents/demo-alpha-folder",
    accessStatus: "restricted",
    restricted: true,
  },
];

/** The one entry of status history in the world: Alpha moved from planning to collecting. */
export const DEMO_STATUS_HISTORY = {
  id: "demo-history-alpha-1",
  replicationId: "DemoAlpha2001",
  fromStatusKey: "planning",
  toStatusKey: "collecting",
  reason: "Synthetic: the first demonstration laboratory started collecting.",
} as const;

export interface DemoMembership {
  readonly replicationId: string;
  readonly personId: string;
  readonly role: "lead" | "coLead" | "analyst" | "member";
  readonly reviewStatus: "confirmed" | "needsReview";
}

export const DEMO_MEMBERSHIPS: readonly DemoMembership[] = [
  { replicationId: "DemoAlpha2001", personId: "demo-person-ben", role: "lead", reviewStatus: "confirmed" },
  { replicationId: "DemoAlpha2001", personId: "demo-person-eli", role: "analyst", reviewStatus: "confirmed" },
  { replicationId: "DemoBeta2005", personId: "demo-person-cleo", role: "lead", reviewStatus: "confirmed" },
  { replicationId: "DemoBeta2005", personId: "demo-person-gus", role: "member", reviewStatus: "confirmed" },
  // A lead that the sources do not agree on: it awaits review and is no confirmed lead.
  { replicationId: "DemoGamma2010", personId: "demo-person-dev", role: "lead", reviewStatus: "needsReview" },
  { replicationId: "DemoGamma2010", personId: "demo-person-ivy", role: "member", reviewStatus: "confirmed" },
];

export interface DemoParticipation {
  readonly replicationId: string;
  readonly laboratoryId: string;
  readonly status: "interested" | "confirmed" | "onboarding" | "ready" | "collecting";
  readonly readinessStatus: "notStarted" | "inProgress" | "approved";
}

export const DEMO_PARTICIPATIONS: readonly DemoParticipation[] = [
  {
    replicationId: "DemoAlpha2001",
    laboratoryId: "demo-lab-attention",
    status: "collecting",
    readinessStatus: "approved",
  },
  {
    replicationId: "DemoAlpha2001",
    laboratoryId: "demo-lab-signal",
    status: "onboarding",
    readinessStatus: "inProgress",
  },
  {
    replicationId: "DemoBeta2005",
    laboratoryId: "demo-lab-memory",
    status: "confirmed",
    readinessStatus: "notStarted",
  },
  {
    replicationId: "DemoBeta2005",
    laboratoryId: "demo-lab-cognition",
    status: "collecting",
    readinessStatus: "approved",
  },
  {
    replicationId: "DemoGamma2010",
    laboratoryId: "demo-lab-signal",
    status: "interested",
    readinessStatus: "notStarted",
  },
  { replicationId: "DemoGamma2010", laboratoryId: "demo-lab-cognition", status: "ready", readinessStatus: "approved" },
];
