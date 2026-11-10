// SYNTHETIC DATA. Nobody and nothing listed here exists.
//
// The demonstration world that `seed:demo` writes to the Local Emulator Suite: institutions,
// laboratories, persons, replications and what ties them together, for local development and
// for end-to-end tests. Every name is invented, every study identifier begins with "Demo", and
// every address uses the example.org domain, which is reserved for documentation and can never
// receive mail. The values of the special categories are placeholders that describe nobody.
//
// The world exercises each path of the claim flow:
//
// | Address                                  | Signing in with it                                         |
// |------------------------------------------|------------------------------------------------------------|
// | `demo.admin@example.org`                 | Becomes the programme administrator, through the bootstrap record, and matches Ada Example |
// | `ben.sample@northfield.example.org`      | Matches one unclaimed person who leads a replication and is the principal investigator of a laboratory |
// | `gus.specimen@harbour.example.org`       | Matches one person through a secondary address              |
// | `shared.mock@example.org`                | Is held by two persons, so the claim goes to review         |
// | `kit.sampleton@ridgeway.example.org`     | Is held in a way that no claim may rest on, so the claim goes to review |
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
    emailDomains: ["northfield.example.org"],
  },
  {
    id: "demo-inst-harbour",
    name: "Harbour Example Institute",
    countryCode: "DE",
    city: "Harbourtown",
    emailDomains: ["harbour.example.org"],
  },
  {
    id: "demo-inst-ridgeway",
    name: "Ridgeway Example College",
    countryCode: "NL",
    city: "Ridgeway",
    emailDomains: ["ridgeway.example.org"],
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
    emails: [primary("ben.sample@northfield.example.org")],
    demographics: { genderSource: "synthetic gender term A", ethnicitySource: "synthetic ethnicity term A" },
  },
  {
    id: "demo-person-cleo",
    slug: "demo-cleo-placeholder",
    givenName: "Cleo",
    familyName: "Placeholder",
    institutionId: "demo-inst-northfield",
    emails: [primary("cleo.placeholder@northfield.example.org")],
  },
  {
    id: "demo-person-dev",
    slug: "demo-dev-fictional",
    givenName: "Dev",
    familyName: "Fictional",
    institutionId: "demo-inst-harbour",
    emails: [primary("dev.fictional@harbour.example.org")],
  },
  {
    id: "demo-person-eli",
    slug: "demo-eli-madeup",
    givenName: "Eli",
    familyName: "Madeup",
    institutionId: "demo-inst-northfield",
    emails: [primary("eli.madeup@northfield.example.org")],
  },
  {
    id: "demo-person-fay",
    slug: "demo-fay-invented",
    givenName: "Fay",
    familyName: "Invented",
    institutionId: "demo-inst-harbour",
    emails: [primary("fay.invented@harbour.example.org")],
  },
  {
    id: "demo-person-gus",
    slug: "demo-gus-specimen",
    givenName: "Gus",
    familyName: "Specimen",
    institutionId: "demo-inst-ridgeway",
    emails: [
      primary("gus.specimen@ridgeway.example.org"),
      { email: "gus.specimen@harbour.example.org", kind: "secondary", claimEligible: true },
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
    emails: [primary("kit.sampleton@ridgeway.example.org", false)],
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

export interface DemoReplication {
  readonly studyKey: string;
  readonly shortTitle: string;
  readonly statusKey: string;
}

export const DEMO_REPLICATIONS: readonly DemoReplication[] = [
  { studyKey: "DemoAlpha2001", shortTitle: "Demonstration study Alpha (synthetic)", statusKey: "collecting" },
  { studyKey: "DemoBeta2005", shortTitle: "Demonstration study Beta (synthetic)", statusKey: "recruitingLabs" },
  { studyKey: "DemoGamma2010", shortTitle: "Demonstration study Gamma (synthetic)", statusKey: "planning" },
];

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
