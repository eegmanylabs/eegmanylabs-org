// Explicit consent for the special-category data of a person: gender and ethnicity. The
// programme lead decided on 13 November 2026 that these values are held only for a member who
// has given explicit consent, and are left blank for everyone else (docs/DECISIONS.md, "Answers
// given on 13 November 2026", and docs/MIGRATION_PLAN.md, section 11, question 20).
//
// | What                         | Where                                                                  |
// |------------------------------|------------------------------------------------------------------------|
// | The wording a member reads   | `DEMOGRAPHICS_CONSENT_WORDINGS`, one entry for each version, never edited once published |
// | The record of consent        | `persons/{personId}/private/demographicsConsent`, read by the person alone, written by `setDemographicsConsent` |
// | The values                   | `persons/{personId}/special/demographics`, which no client reads       |
//
// A wording that changes gets a new version and keeps the old one here, so that a record of
// consent always names the words that the person read.
import { migrationAnswer, type ProgrammeDecision } from "../programme-answers";
import { z } from "../zod";

/** The decision under which the values are held only with consent. Stored on every record of consent. */
export const DEMOGRAPHICS_CONSENT_DECISION: ProgrammeDecision = migrationAnswer(20);

export interface ConsentWording {
  /** An opaque name of the wording, never reused. */
  readonly version: string;
  /** The day the wording was published, which the page shows. Two wordings may share a day. */
  readonly publishedOn: string;
  readonly title: string;
  readonly sections: readonly { readonly heading: string; readonly text: string }[];
  /** The sentence a member agrees to by giving consent. */
  readonly statement: string;
}

/** Every published wording, oldest first. */
export const DEMOGRAPHICS_CONSENT_WORDINGS = [
  {
    version: "2026-11-13",
    publishedOn: "2026-11-13",
    title: "Your gender and ethnicity",
    sections: [
      {
        heading: "What is held",
        text:
          "With your consent, the portal holds your gender and your ethnicity: the terms that the programme's membership " +
          "workbook recorded for you, if it recorded any, and what you enter or confirm here in your own words. Without " +
          "your consent nothing is held, and a value that arrives in an import is discarded without being stored.",
      },
      {
        heading: "Why it is held",
        text:
          "The programme uses these values only to describe who takes part, as counts. A count of fewer than five " +
          "people is never shown.",
      },
      {
        heading: "Who can see it",
        text:
          "You can see your own values on this page. Nobody sees them because of a role in the portal. A programme " +
          "administrator can give a named person access for a limited time, which needs a second factor, and every " +
          "view is recorded in the audit trail. Counts that include your values are shown only to such a person.",
      },
      {
        heading: "How to withdraw",
        text:
          "You can withdraw your consent on this page at any time. Your values are then deleted at once, and they " +
          "leave every count the next time it is computed. Copies in the portal's backups expire within 14 weeks, " +
          "and are deleted again if a backup is ever restored.",
      },
    ],
    statement: "I consent to the #EEGManyLabs portal holding my gender and ethnicity as described above.",
  },
  {
    // The second wording names the condition and the notice, and says that a person given access can see the values
    // of one member, which the first did not say beside its purpose.
    version: "2026-11-13.2",
    publishedOn: "2026-11-13",
    title: "Your gender and ethnicity",
    sections: [
      {
        heading: "What is held",
        text:
          "With your consent, the portal holds your gender and your ethnicity: the terms that the programme's membership " +
          "workbook recorded for you, if it recorded any, and what you enter or confirm here in your own words. Without " +
          "your consent nothing is held, and a value that arrives in an import is discarded without being stored.",
      },
      {
        heading: "Why it is held, and on what basis",
        text:
          "The programme uses these values to describe who takes part, as counts. A count of fewer than five people is " +
          "never shown. Your explicit consent is the only condition on which the portal holds them (Article 9(2)(a) of " +
          "the UK GDPR). Who is responsible for your information, and your rights, are set out in the portal's privacy " +
          "notice.",
      },
      {
        heading: "Who can see it",
        text:
          "You can see your own values on this page. Nobody sees them because of a role in the portal. A programme " +
          "administrator can give a named person access for a limited time, which needs a second factor. That person " +
          "can see the counts, and the values of one member at a time, for example to check a record. Every view is " +
          "recorded in the audit trail, and is shown in a copy of your data if you ask for one.",
      },
      {
        heading: "How to withdraw",
        text:
          "You can withdraw your consent on this page at any time. Your values are then deleted at once, and they " +
          "leave every count the next time it is computed. Copies in the portal's backups expire within 14 weeks, " +
          "and are deleted again if a backup is ever restored.",
      },
    ],
    statement: "I consent to the #EEGManyLabs portal holding my gender and ethnicity as described above.",
  },
] as const satisfies readonly ConsentWording[];

export const DEMOGRAPHICS_CONSENT_VERSIONS = DEMOGRAPHICS_CONSENT_WORDINGS.map((wording) => wording.version) as [
  (typeof DEMOGRAPHICS_CONSENT_WORDINGS)[number]["version"],
  ...(typeof DEMOGRAPHICS_CONSENT_WORDINGS)[number]["version"][],
];
export const consentWordingVersionSchema = z.enum(DEMOGRAPHICS_CONSENT_VERSIONS);
export type ConsentWordingVersion = z.output<typeof consentWordingVersionSchema>;

type PublishedWording = (typeof DEMOGRAPHICS_CONSENT_WORDINGS)[number];

/** The wording that a member reads today. Consent is given only to this one. */
export const CURRENT_DEMOGRAPHICS_CONSENT: PublishedWording =
  DEMOGRAPHICS_CONSENT_WORDINGS.at(-1) ?? DEMOGRAPHICS_CONSENT_WORDINGS[0];

/** The wording of a version. */
export function consentWording(version: ConsentWordingVersion): PublishedWording {
  return DEMOGRAPHICS_CONSENT_WORDINGS.find((wording) => wording.version === version) ?? CURRENT_DEMOGRAPHICS_CONSENT;
}

export const DEMOGRAPHICS_CONSENT_STATUSES = ["given", "withdrawn"] as const;
export const demographicsConsentStatusSchema = z.enum(DEMOGRAPHICS_CONSENT_STATUSES);
export type DemographicsConsentStatus = z.output<typeof demographicsConsentStatusSchema>;

/** The most events a record of consent keeps. The audit trail keeps every one. */
export const CONSENT_HISTORY_MAX = 100;

/**
 * Whether a stored record of consent is in force: given, and not withdrawn since. Anything that
 * is not such a record, a missing one included, is no consent.
 */
export function consentInForce(record: unknown): boolean {
  return (
    typeof record === "object" &&
    record !== null &&
    (record as { status?: unknown }).status === "given" &&
    (record as { withdrawnAt?: unknown }).withdrawnAt === null
  );
}

/** The most characters of a value that a person writes in their own words. */
export const OWN_WORDS_MAX = 300;
