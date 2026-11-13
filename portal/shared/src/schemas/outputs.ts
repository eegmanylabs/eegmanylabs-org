// Scientific outputs and governance (docs/DATA_MODEL.md, section 11): manuscripts,
// contributors, the decision log, the risk register, the incident registry, meetings, progress
// reports and links to external documents.
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  boundedRecord,
  customValuesSchema,
  documentBaseSchema,
  doiSchema,
  entityRefShape,
  freeMapSchema,
  idListSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  orcidSchema,
  provenanceShape,
  richTextSchema,
  scopeFieldsShape,
  scopeKeysSchema,
  shortTextSchema,
  urlSchema,
  verbatimSchema,
} from "./base";
import { citationStatusSchema, reviewStatusSchema } from "./replications";

export const manuscriptKindSchema = z.enum([
  "stage1Rr",
  "stage2Rr",
  "preprint",
  "article",
  "dataPaper",
  "software",
  "dataset",
  "other",
]);
export type ManuscriptKind = z.output<typeof manuscriptKindSchema>;
export const manuscriptStatusSchema = z.enum([
  "planned",
  "drafting",
  "submitted",
  "underReview",
  "revising",
  "inPrincipleAcceptance",
  "accepted",
  "published",
  "rejected",
  "withdrawn",
]);
export type ManuscriptStatus = z.output<typeof manuscriptStatusSchema>;

/** The milestones of a manuscript that a task of the kind `milestone` can stand for. */
export const manuscriptMilestoneSchema = z.enum(["submission", "acceptance", "publication"]);
export type ManuscriptMilestone = z.output<typeof manuscriptMilestoneSchema>;

/** The most hypotheses or datasets an output names. */
export const OUTPUT_LINKS_MAX = 100;

/**
 * `manuscripts/{id}`: a scientific output. `status` and `statusHistoryId` change through a
 * callable function, which writes the history entry in the same transaction.
 */
export const manuscriptDocSchema = documentBaseSchema.extend({
  /** Absent for a programme-level output. */
  replicationId: idSchema.exactOptional(),
  websitePublicationId: shortTextSchema.exactOptional(),
  title: z.string().min(1).max(1_000),
  kind: manuscriptKindSchema,
  status: manuscriptStatusSchema,
  statusHistoryId: idSchema.nullable(),
  journal: shortTextSchema.exactOptional(),
  doi: doiSchema.exactOptional(),
  preprintDoi: doiSchema.exactOptional(),
  osfUrl: urlSchema.exactOptional(),
  authorsShort: shortTextSchema.exactOptional(),
  submittedAt: timestampSchema.exactOptional(),
  acceptedAt: timestampSchema.exactOptional(),
  publishedAt: timestampSchema.exactOptional(),
  citationStatus: citationStatusSchema.exactOptional(),
  citationMetadata: freeMapSchema.exactOptional(),
  /** For a Stage 2 Registered Report: its Stage 1, a manuscript of the same replication. */
  stage1ManuscriptId: idSchema.exactOptional(),
  /** The hypotheses of the replication that the output reports. */
  hypothesisIds: z.array(idSchema).max(OUTPUT_LINKS_MAX).exactOptional(),
  /** The datasets of the replication that the output describes or publishes. */
  datasetIds: z.array(idSchema).max(OUTPUT_LINKS_MAX).exactOptional(),
  /** For software or data: where the code or the data is published. */
  repositoryUrl: urlSchema.exactOptional(),
  /** For software or data: the version that was released. */
  outputVersion: z.string().min(1).max(64).exactOptional(),
  /** The milestone task that stands for each milestone of the manuscript in the task lists of its replication. */
  milestoneTaskIds: z.partialRecord(manuscriptMilestoneSchema, idSchema).exactOptional(),
  custom: customValuesSchema,
  scopeKeys: scopeKeysSchema,
  ...provenanceShape,
});
export type ManuscriptDoc = z.output<typeof manuscriptDocSchema>;

export const manuscriptEventKindSchema = z.enum([
  "submission",
  "reviewRound",
  "decision",
  "revision",
  "acceptance",
  "publication",
  "other",
]);
export type ManuscriptEventKind = z.output<typeof manuscriptEventKindSchema>;
export const manuscriptDecisionOutcomeSchema = z.enum([
  "accept",
  "inPrincipleAcceptance",
  "minorRevision",
  "majorRevision",
  "reject",
]);
export type ManuscriptDecisionOutcome = z.output<typeof manuscriptDecisionOutcomeSchema>;

/** `manuscripts/{id}/events/{id}`: a review round, a decision, a revision or a submission. */
export const manuscriptEventDocSchema = documentBaseSchema.extend({
  manuscriptId: idSchema,
  kind: manuscriptEventKindSchema,
  round: z.number().int().min(0).max(100).exactOptional(),
  occurredAt: timestampSchema,
  dueAt: timestampSchema.exactOptional(),
  /** For a decision. */
  outcome: manuscriptDecisionOutcomeSchema.exactOptional(),
  summary: longTextSchema.exactOptional(),
  documentLinkIds: idListSchema,
  ...scopeFieldsShape,
});
export type ManuscriptEventDoc = z.output<typeof manuscriptEventDocSchema>;

/**
 * `contributorTables/{id}`: a table of contributors. Its address is the address of a source
 * document, so the table names its entry in the source registry and holds no address.
 */
export const contributorTableDocSchema = documentBaseSchema.extend({
  replicationId: idSchema.nullable(),
  sourceKey: keySchema,
  isOnlySignupTable: z.boolean().exactOptional(),
  isPublished: z.boolean().exactOptional(),
  publicationUrl: urlSchema.exactOptional(),
  pdfUrl: urlSchema.exactOptional(),
  sourceRecordId: idSchema.exactOptional(),
  scopeKeys: scopeKeysSchema,
  ...provenanceShape,
});
export type ContributorTableDoc = z.output<typeof contributorTableDocSchema>;

/** The fourteen roles of the Contributor Role Taxonomy (CRediT), by key. Their official names are seeded as lookup data. */
export const creditRoleKeySchema = z.enum([
  "conceptualization",
  "dataCuration",
  "formalAnalysis",
  "fundingAcquisition",
  "investigation",
  "methodology",
  "projectAdministration",
  "resources",
  "software",
  "supervision",
  "validation",
  "visualization",
  "writingOriginalDraft",
  "writingReviewEditing",
]);
export type CreditRoleKey = z.output<typeof creditRoleKeySchema>;

/** The value of a cell exactly as the source holds it: a text, a number or a stored boolean. */
export const verbatimCellSchema = z.union([verbatimSchema, z.number(), z.boolean()]);

/** The slot of an affiliation column of a contributor sheet: `1` to `9`, as text because it is a map key. */
export const affiliationSlotSchema = z
  .string()
  .max(1)
  .regex(/^[1-9]$/, { error: "Expected an affiliation slot from 1 to 9" });

/**
 * `contributors/{id}`: one row of a contributor table. A person who appears in two tables has
 * two documents, because roles, order and affiliation differ per manuscript. A contributor row
 * grants no role and no access.
 */
export const contributorDocSchema = documentBaseSchema.extend({
  firstNameSource: verbatimSchema.exactOptional(),
  middleNameSource: verbatimSchema.exactOptional(),
  surnameSource: verbatimSchema.exactOptional(),
  orderInPublication: z.number().int().min(0).max(100_000).exactOptional(),
  /** The first affiliation cell of the row. A reader that shows one affiliation shows this one. */
  affiliationSource: verbatimSchema.exactOptional(),
  /**
   * Every affiliation cell of the row by its slot, where `1` is the primary or first affiliation
   * column of the sheet. Each cell is one verbatim string that is never split.
   */
  affiliationSlotsSource: boundedRecord(affiliationSlotSchema, verbatimSchema, 9).exactOptional(),
  /** As the source wrote it. An iD that fails its check goes to review and is never corrected here. */
  orcid: verbatimSchema.exactOptional(),
  /** Each CRediT role key to the verbatim value of its cell. A role whose cell is empty is absent. */
  creditRoles: z.partialRecord(creditRoleKeySchema, verbatimCellSchema),
  agreementSource: verbatimSchema.exactOptional(),
  reviewStatus: reviewStatusSchema,
  replicationId: idSchema.nullable(),
  manuscriptId: idSchema.nullable(),
  contributorTableId: idSchema,
  personId: idSchema.nullable(),
  sourceRecordId: idSchema.exactOptional(),
  scopeKeys: scopeKeysSchema,
  ...provenanceShape,
});
export type ContributorDoc = z.output<typeof contributorDocSchema>;

/** `contributors/{id}/private/contact`: the email address and the funding statement of a contributor. */
export const contributorContactDocSchema = documentBaseSchema.extend({
  /** As the source wrote it. */
  email: verbatimSchema.exactOptional(),
  fundingStatement: z.string().max(LIMITS.longText).exactOptional(),
  ...provenanceShape,
});
export type ContributorContactDoc = z.output<typeof contributorContactDocSchema>;

/** What a decision, a risk, an incident or a progress report is scoped to. */
export const governanceScopeTypeSchema = z.enum(["programme", "replication", "laboratory"]);

const governanceScopeShape = {
  scopeType: governanceScopeTypeSchema,
  scopeId: idSchema,
};

export const decisionStatusSchema = z.enum(["proposed", "accepted", "rejected", "superseded"]);

/** A reference to a deviation of a participation, which a decision or an incident answers. */
export const deviationRefSchema = z.strictObject({ participationId: idSchema, deviationId: idSchema });
export type DeviationRef = z.output<typeof deviationRefSchema>;

/** The most deviations one entry of the decision log or of the incident registry names. */
export const DEVIATION_REFS_MAX = 20;

export const decisionEntryKindSchema = z.enum(["decision", "correction"]);

/**
 * `decisions/{id}`: an entry of the methodological decision log. The log is append-only: an
 * entry never changes. A correction is a new entry that names in `correctsDecisionId` the first
 * entry of the decision it corrects and states its content in full, and a decision that replaces
 * another names it in `supersedesDecisionId`.
 */
export const decisionDocSchema = appendOnlyBaseSchema.extend({
  ...governanceScopeShape,
  kind: decisionEntryKindSchema,
  title: shortTextSchema,
  summary: longTextSchema,
  rationale: longTextSchema.exactOptional(),
  outcome: longTextSchema.exactOptional(),
  status: decisionStatusSchema,
  ownerPersonId: idSchema.exactOptional(),
  decidedAt: isoDateSchema.exactOptional(),
  supersedesDecisionId: idSchema.exactOptional(),
  correctsDecisionId: idSchema.exactOptional(),
  deviations: z.array(deviationRefSchema).max(DEVIATION_REFS_MAX),
  recordedBy: actorSchema,
  ...scopeFieldsShape,
});
export type DecisionDoc = z.output<typeof decisionDocSchema>;

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export const riskStatusSchema = z.enum(["open", "mitigating", "accepted", "closed"]);

/** `risks/{id}`: an entry of the risk register. */
export const riskDocSchema = documentBaseSchema.extend({
  ...governanceScopeShape,
  title: shortTextSchema,
  description: richTextSchema.exactOptional(),
  likelihood: riskLevelSchema,
  impact: riskLevelSchema,
  mitigation: longTextSchema.exactOptional(),
  ownerPersonId: idSchema.exactOptional(),
  status: riskStatusSchema,
  identifiedAt: timestampSchema,
  reviewAt: timestampSchema.exactOptional(),
  closedAt: timestampSchema.nullable(),
  pageId: idSchema.nullable(),
  ...scopeFieldsShape,
});
export type RiskDoc = z.output<typeof riskDocSchema>;

export const incidentStatusSchema = z.enum(["open", "investigating", "resolved"]);
export type IncidentStatus = z.output<typeof incidentStatusSchema>;

/**
 * `incidents/{id}`: the report of an incident. The registry is append-only: the report never
 * changes, and what follows it, corrective actions, changes of status and corrections, are the
 * actions beneath it. Its state is read from them (`incidentState`).
 */
export const incidentDocSchema = appendOnlyBaseSchema.extend({
  ...governanceScopeShape,
  title: shortTextSchema,
  description: longTextSchema,
  severity: riskLevelSchema,
  occurredAt: isoDateSchema,
  reportedBy: actorSchema,
  participationId: idSchema.exactOptional(),
  datasetId: idSchema.exactOptional(),
  deviations: z.array(deviationRefSchema).max(DEVIATION_REFS_MAX),
  ...scopeFieldsShape,
});
export type IncidentDoc = z.output<typeof incidentDocSchema>;

export const incidentActionKindSchema = z.enum(["correctiveAction", "statusChange", "correction", "note"]);
export type IncidentActionKind = z.output<typeof incidentActionKindSchema>;

/** What a correction of the report of an incident replaces. */
export const correctedReportSchema = z.strictObject({
  title: shortTextSchema.exactOptional(),
  description: longTextSchema.exactOptional(),
  severity: riskLevelSchema.exactOptional(),
});

/**
 * `incidents/{id}/actions/{id}`: what follows the report of an incident, never changed. A
 * corrective action states what is done and may name an owner and a date by which it is due. A
 * change of status states the new status. A correction replaces the fields of the report it
 * states, or names in `correctsActionId` an earlier action that it replaces with its own text.
 */
export const incidentActionDocSchema = appendOnlyBaseSchema.extend({
  incidentId: idSchema,
  kind: incidentActionKindSchema,
  text: longTextSchema.exactOptional(),
  status: incidentStatusSchema.exactOptional(),
  ownerPersonId: idSchema.exactOptional(),
  dueDate: isoDateSchema.exactOptional(),
  correctsActionId: idSchema.exactOptional(),
  correctedReport: correctedReportSchema.exactOptional(),
  recordedBy: actorSchema,
  ...scopeFieldsShape,
});
export type IncidentActionDoc = z.output<typeof incidentActionDocSchema>;

export const meetingScopeTypeSchema = z.enum(["programme", "replication", "laboratory", "group"]);

/** `meetings/{id}`: a meeting. Its agenda and notes are the body of its page, and its action items are tasks that link to it. */
export const meetingDocSchema = documentBaseSchema.extend({
  title: shortTextSchema,
  scopeType: meetingScopeTypeSchema,
  scopeId: idSchema,
  startsAt: timestampSchema,
  endsAt: timestampSchema.exactOptional(),
  location: shortTextSchema.exactOptional(),
  attendeePersonIds: idListSchema,
  pageId: idSchema.nullable(),
  ...scopeFieldsShape,
});
export type MeetingDoc = z.output<typeof meetingDocSchema>;

export const progressReportStatusSchema = z.enum(["draft", "inReview", "final"]);

/** `progressReports/{id}`: a report on a period, whose text is the body of its page. */
export const progressReportDocSchema = documentBaseSchema.extend({
  title: shortTextSchema,
  ...governanceScopeShape,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  status: progressReportStatusSchema,
  pageId: idSchema.nullable(),
  generatedDocumentId: idSchema.nullable(),
  ...scopeFieldsShape,
});
export type ProgressReportDoc = z.output<typeof progressReportDocSchema>;

export const documentLinkKindSchema = z.enum([
  "googleDoc",
  "googleSheet",
  "driveFolder",
  "osf",
  "github",
  "pdf",
  "form",
  "url",
]);
/**
 * | Status        | Meaning                                                                 |
 * |---------------|-------------------------------------------------------------------------|
 * | `unknown`     | Not checked yet: how every link found in the sources starts             |
 * | `public`      | Answers anyone with the link                                            |
 * | `shared`      | Shared with the portal's Google account, which reads its metadata       |
 * | `restricted`  | Exists behind sign-in, and is not shared with the portal's account      |
 * | `unreachable` | Gone, deleted, or no longer reachable by the portal's account           |
 */
export const linkAccessStatusSchema = z.enum(["unknown", "public", "shared", "restricted", "unreachable"]);
export type LinkAccessStatus = z.output<typeof linkAccessStatusSchema>;

/**
 * `documentLinks/{id}`: any external document attached to any record. It carries the audience
 * of its target as scope fields, and one marked `restricted` takes the audience of the target's
 * restricted document.
 */
export const documentLinkDocSchema = documentBaseSchema.extend({
  ...entityRefShape,
  kind: documentLinkKindSchema,
  url: urlSchema,
  externalId: z.string().min(1).max(LIMITS.shortText).exactOptional(),
  title: shortTextSchema.exactOptional(),
  accessStatus: linkAccessStatusSchema,
  httpStatus: z.number().int().min(100).max(599).exactOptional(),
  lastCheckedAt: timestampSchema.nullable(),
  ownerName: shortTextSchema.exactOptional(),
  modifiedAt: timestampSchema.exactOptional(),
  /**
   * When a check found the OSF registration the link points at withdrawn. Trusted code writes
   * it, and the link is shown as withdrawn wherever it appears, since the page stays public.
   */
  withdrawnAt: timestampSchema.exactOptional(),
  sourceRecordId: idSchema.exactOptional(),
  restricted: z.boolean(),
  ...scopeFieldsShape,
  ...provenanceShape,
});
export type DocumentLinkDoc = z.output<typeof documentLinkDocSchema>;

// ----- Authorship and acknowledgement -----

/** The roles in the programme that an authorship list records beside CRediT. */
export const contributionRoleSchema = z.enum(["dataCollection", "recruitment", "analysis", "writing"]);
export type ContributionRole = z.output<typeof contributionRoleSchema>;

export const authorshipOrderingRuleSchema = z.enum([
  "contribution",
  "alphabetical",
  "leadsFirstThenAlphabetical",
  "laboratoryGroups",
  "custom",
]);
export type AuthorshipOrderingRule = z.output<typeof authorshipOrderingRuleSchema>;

export const authorshipListStatusSchema = z.enum(["draft", "inReview", "final"]);

/** The most entries an authorship list holds. */
export const AUTHORSHIP_ENTRIES_MAX = 400;

/**
 * `authorshipLists/{manuscriptId}`: the authorship and acknowledgements of a manuscript, which
 * the leads of its replication prepare and each person on it reviews. The list records its
 * ordering rule. It is written through callable functions.
 */
export const authorshipListDocSchema = documentBaseSchema.extend({
  manuscriptId: idSchema,
  orderingRule: authorshipOrderingRuleSchema,
  orderingNote: longTextSchema.exactOptional(),
  status: authorshipListStatusSchema,
  /** Increases with every save of the list by its leads. */
  revision: z.number().int().min(1),
  preparedBy: actorSchema,
  ...scopeFieldsShape,
});
export type AuthorshipListDoc = z.output<typeof authorshipListDocSchema>;

export const authorshipEntryKindSchema = z.enum(["author", "acknowledgement"]);
export const confirmationStatusSchema = z.enum(["pending", "confirmed", "changesRequested"]);

/** The answer of a person to their own entry, which names the revision of the entry it answers. */
export const authorshipConfirmationSchema = z.strictObject({
  status: confirmationStatusSchema,
  revision: z.number().int().min(0),
  respondedAt: timestampSchema.nullable(),
  note: longTextSchema.exactOptional(),
});

/**
 * `authorshipLists/{manuscriptId}/entries/{personId}`: one person on an authorship list. The
 * leads write the entry, the person answers it, and an answer holds only for the revision of the
 * entry it names: a change by the leads asks for a new answer.
 */
export const authorshipEntryDocSchema = documentBaseSchema.extend({
  manuscriptId: idSchema,
  personId: idSchema,
  /** The row of an imported contributor table that the entry was prepared from, where one was. */
  contributorId: idSchema.nullable(),
  kind: authorshipEntryKindSchema,
  /** The place of the entry among the entries of its kind, from 1. */
  position: z.number().int().min(1).max(AUTHORSHIP_ENTRIES_MAX),
  displayName: shortTextSchema,
  affiliations: z.array(shortTextSchema).max(9),
  orcid: orcidSchema.exactOptional(),
  creditRoles: z.array(creditRoleKeySchema).max(14),
  contributionRoles: z.array(contributionRoleSchema).max(4),
  isCorresponding: z.boolean(),
  /** Increases whenever the leads change what the person confirms. */
  entryRevision: z.number().int().min(1),
  confirmation: authorshipConfirmationSchema,
  ...scopeFieldsShape,
});
export type AuthorshipEntryDoc = z.output<typeof authorshipEntryDocSchema>;
