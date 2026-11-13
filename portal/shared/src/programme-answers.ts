// The answers that the programme lead gave on 13 November 2026 to the questions of
// docs/DECISIONS.md ("Answers given on 13 November 2026") and of docs/MIGRATION_PLAN.md,
// section 11. They are decisions of the programme, not source values: code that applies one
// stores the decision beside what it writes, as `ProgrammeDecision`, so that nobody mistakes a
// decided value for something a source said.
//
// | Question (section 11) | What this file records                                                        |
// |-----------------------|-------------------------------------------------------------------------------|
// | 1                     | The status of the four studies that the website no longer lists              |
// | 2 and 3               | The two Amodio replications share one dataset; the combined values of the recruitment workbook stay attached to neither |
// | 4 and 5               | A disputed lead stays for review; a lead on whom every lead-naming source agrees is confirmed |
// | 7 and 14              | The outcome labels of source E and the summary figures of source F are sealed |
// | 10                    | Contributor lists are read by the team of their replication                   |
// | 15                    | The alpha-asymmetry subproject is active and is the related project `asymmetry` |
// | 20                    | Gender and ethnicity are held only with explicit consent                      |
// | 20 and 21             | Raw source material is kept until the migration is verified; three years after, the outreach records of people who never joined are deleted and nothing else is |
// | 22                    | The links and null-significance labels of the prediction market are sealed like its outcome labels |
// | 23                    | Programme staff read contributor lists, as they read every scoped record     |
// | 24                    | The seal of every source's raw rows and of the summary figures of source A is kept |
//
// Of the decisions needed of docs/DECISIONS.md, decision 7 is recorded here as well: no
// notification email is sent for now, and notifications and digests stay in the portal.
//
// Questions 11, 12 and 13 were answered with "I'll check" or "don't know". They change nothing,
// and the interim rules of the migration plan stay in force for them.
import { isoDateSchema } from "./schemas/base";
import { z } from "./zod";

/** The day of the answers. */
export const PROGRAMME_ANSWERS_DATE = "2026-11-13";

/** Who took the decisions: the programme lead, acting for the programme. */
export const PROGRAMME_DECIDER = "programmeLead";

/**
 * The provenance of a value that a decision of the programme supplies: who decided, on which
 * day, and where the decision is written down.
 */
export const programmeDecisionSchema = z.strictObject({
  decidedBy: z.literal(PROGRAMME_DECIDER),
  decidedOn: isoDateSchema,
  /** The place of the decision in the documentation, for example `docs/MIGRATION_PLAN.md, section 11, question 1`. */
  reference: z.string().min(1).max(200),
});
export type ProgrammeDecision = z.output<typeof programmeDecisionSchema>;

/** The decision that answered a question of docs/MIGRATION_PLAN.md, section 11. */
export function migrationAnswer(question: number): ProgrammeDecision {
  return {
    decidedBy: PROGRAMME_DECIDER,
    decidedOn: PROGRAMME_ANSWERS_DATE,
    reference: `docs/MIGRATION_PLAN.md, section 11, question ${question}`,
  };
}

/** The decision that answered one of the decisions needed of docs/DECISIONS.md. */
export function programmeAnswer(decision: number): ProgrammeDecision {
  return {
    decidedBy: PROGRAMME_DECIDER,
    decidedOn: PROGRAMME_ANSWERS_DATE,
    reference: `docs/DECISIONS.md, answers of 13 November 2026, decision ${decision}`,
  };
}

/** The words of the decision about the status of a study. */
export const DECIDED_STUDY_STATUSES = ["cancelled", "paused", "ongoing"] as const;
export type DecidedStudyStatus = (typeof DECIDED_STUDY_STATUSES)[number];

/**
 * The status of a replication that each word of the decision stands for. A cancelled study is
 * closed as `archived`, the status of the category `cancelled`; an ongoing study takes `ongoing`,
 * the active status that names no stage, because the decision names none.
 */
export const STATUS_KEY_OF_DECIDED: Readonly<Record<DecidedStudyStatus, string>> = {
  cancelled: "archived",
  paused: "paused",
  ongoing: "ongoing",
};

/** Question 1: the four studies that the website no longer lists. */
export const STUDY_STATUS_DECISIONS: Readonly<Record<string, DecidedStudyStatus>> = {
  Carretie2004: "cancelled",
  Frank2005: "cancelled",
  DonkersvanBoxtel2004: "paused",
  Hajcak2006: "ongoing",
};

export interface StudyStatusDecision {
  readonly replicationId: string;
  readonly decided: DecidedStudyStatus;
  readonly statusKey: string;
  readonly decision: ProgrammeDecision;
}

/** The decided status of a replication, or null where the programme decided none. */
export function studyStatusDecision(replicationId: string): StudyStatusDecision | null {
  const decided = Object.hasOwn(STUDY_STATUS_DECISIONS, replicationId)
    ? STUDY_STATUS_DECISIONS[replicationId]
    : undefined;
  if (decided === undefined) return null;
  return { replicationId, decided, statusKey: STATUS_KEY_OF_DECIDED[decided], decision: migrationAnswer(1) };
}

/**
 * Question 5: a lead on whom every source agrees is written as a confirmed membership. Every
 * source that names leads must have been imported before agreement can be judged, so the
 * confirmation is a step of its own (`leads:confirm-agreed`) and no importer writes it.
 */
export const LEAD_AGREEMENT_DECISION = migrationAnswer(5);

/**
 * The sources whose importers state who leads a study: the coordination workbook (a), the list
 * of studies (d), the recruitment and contact workbook (f) and the public website (h).
 */
export const LEAD_SOURCE_KEYS = ["a", "d", "f", "h"] as const;

/** Question 3: the replications that share one dataset record. */
export const SHARED_DATASET_GROUPS: readonly (readonly string[])[] = [["AmodioJost2007", "AmodioMaster2008"]];

/** The other replications whose data one dataset record holds together with a replication, by question 3. */
export function datasetSharedWith(replicationId: string): readonly string[] {
  const group = SHARED_DATASET_GROUPS.find((members) => members.includes(replicationId));
  return group === undefined ? [] : group.filter((member) => member !== replicationId);
}

/**
 * Question 2: the tab `AmodioMaster20072008` and the combined values of the recruitment workbook
 * cover both studies and stay attached to neither. The review items about the combined cells
 * carry the decision.
 */
export const COMBINED_AMODIO_DECISION = migrationAnswer(2);
/** The two studies that the combined cells of question 2 cover. */
export const COMBINED_AMODIO_STUDIES: readonly string[] = ["AmodioJost2007", "AmodioMaster2008"];

/**
 * Question 15: the subproject that a tab of the list of studies holds candidates for, and the
 * related project of the website that it is.
 */
export const RELATED_PROJECT_DECISIONS: Readonly<
  Record<string, { readonly programmeKey: string; readonly websiteSlug: string; readonly active: boolean }>
> = {
  AlphaAsymmetry_RSSubproject: { programmeKey: "asymmetry", websiteSlug: "asymmetry", active: true },
};

/**
 * The study identifiers that the decisions above name. They are the programme's own public
 * identifiers (D-013), which the synthetic import fixtures reuse, so a check that looks for
 * fixtures in a production build leaves these out.
 */
export const DECIDED_STUDY_IDENTIFIERS: readonly string[] = [
  ...new Set([...Object.keys(STUDY_STATUS_DECISIONS), ...SHARED_DATASET_GROUPS.flat(), ...COMBINED_AMODIO_STUDIES]),
];

/**
 * Question 10: contributor lists of manuscripts are read by the team of their replication.
 * Question 23 adds programme staff (the core team), who read them as they read every record
 * within a scope.
 */
export const CONTRIBUTOR_LISTS_DECISION = migrationAnswer(10);

/**
 * Questions 7, 14, 22 and 24: what is sealed. A sealed value is read by programme administrators
 * alone, through the capability `sealed.read`, and reaches no member, coordinator, lead, derived
 * view, search entry, digest, export, publication, automation, generated document, review-queue
 * item or value of the change log.
 *
 * | Source | What is sealed                                                                  | Question |
 * |--------|---------------------------------------------------------------------------------|----------|
 * | `e`    | The outcome labels of the column `replicated`                                   | 7        |
 * | `e`    | The survey and market questions of the tab `questions4MarketsNSurvey`           | 7        |
 * | `e`    | The links to the market's study descriptions and information sheets, and the null-significance labels of the column `null-sig` | 22 |
 * | `f`    | The summary figures of the tab `numberOfLabsPerReplication`                     | 14       |
 * | `a`    | The summary figures of the coordination workbook                                | 24       |
 * | All    | The raw rows of every source                                                    | 24       |
 *
 * The raw rows of sources E and F hold the values that questions 7, 14 and 22 seal. The project
 * extended the seal, as a safeguard, to the raw rows of every other source and to the summary
 * figures of the coordination workbook A, and the answer to question 24 keeps that wider seal.
 */
export const SEALED_SOURCE_KEYS = ["e", "f"] as const;
export const SEALED_OUTCOMES_DECISION = migrationAnswer(7);
export const SEALED_SUMMARY_DECISION = migrationAnswer(14);
/** Question 22: the links to the market's documents and the null-significance labels are sealed like the outcome labels. */
export const SEALED_MARKET_MATERIAL_DECISION = migrationAnswer(22);
/** The source whose summary figures question 14 seals. */
export const SEALED_SUMMARY_SOURCE_KEY = "f";

/**
 * Questions 20 and 21: raw source records and export files are kept until an administrator marks
 * the migration verified. Question 20 kept them for one year after; the later answer to question
 * 21 extends that to three years. Then the outreach records of source F for people who never
 * joined the programme are deleted, and nothing else: every other raw source record and export
 * file is kept.
 *
 * "Never joined" is the reading that question 21 put to the programme lead and that the answer
 * kept: an outreach contact that names no person, whose address resolves to no person through the
 * email index, and whose row no open review item names. A contact that may belong to a member is
 * kept.
 */
export const MIGRATION_RETENTION_DECISION = migrationAnswer(21);
/** The source whose outreach records the retention of questions 20 and 21 deletes. */
export const OUTREACH_SOURCE_KEY = "f";
/** The calendar years after the verification for which the outreach records are kept (question 21). */
export const OUTREACH_RETENTION_YEARS = 3;

/**
 * The instant before which nothing of questions 20 and 21 is deleted: three calendar years after
 * the verification, in UTC, or null while unverified. A verification on 29 February counts to 1
 * March. Three calendar years span 1,095 or 1,096 days, by the leap days they cross.
 */
export function outreachRetentionCutoff(verifiedAt: Date | null): Date | null {
  if (verifiedAt === null) return null;
  const cutoff = new Date(verifiedAt.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() + OUTREACH_RETENTION_YEARS);
  return cutoff;
}

/** Decision 7: no notification email is sent for now. Notifications and digests stay in the portal. */
export const MAIL_DISABLED_DECISION = programmeAnswer(7);
