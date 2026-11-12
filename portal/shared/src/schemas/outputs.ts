// Scientific outputs and governance (docs/DATA_MODEL.md, section 11): manuscripts,
// contributors, the decision log, the risk register, the incident registry, meetings, progress
// reports and links to external documents.
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
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
  "other",
]);
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
export const manuscriptDecisionOutcomeSchema = z.enum([
  "accept",
  "inPrincipleAcceptance",
  "minorRevision",
  "majorRevision",
  "reject",
]);

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

/** `decisions/{id}`: an entry of the methodological decision log. */
export const decisionDocSchema = documentBaseSchema.extend({
  ...governanceScopeShape,
  title: shortTextSchema,
  summary: richTextSchema.exactOptional(),
  outcome: longTextSchema.exactOptional(),
  status: decisionStatusSchema,
  ownerPersonId: idSchema.exactOptional(),
  decidedAt: timestampSchema.exactOptional(),
  supersedesDecisionId: idSchema.exactOptional(),
  pageId: idSchema.nullable(),
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

/** `incidents/{id}`: an entry of the incident registry. */
export const incidentDocSchema = documentBaseSchema.extend({
  ...governanceScopeShape,
  title: shortTextSchema,
  description: richTextSchema.exactOptional(),
  severity: riskLevelSchema,
  occurredAt: timestampSchema,
  reportedBy: actorSchema,
  participationId: idSchema.exactOptional(),
  datasetId: idSchema.exactOptional(),
  correctiveAction: longTextSchema.exactOptional(),
  ownerPersonId: idSchema.exactOptional(),
  status: incidentStatusSchema,
  resolvedAt: timestampSchema.nullable(),
  pageId: idSchema.nullable(),
  ...scopeFieldsShape,
});
export type IncidentDoc = z.output<typeof incidentDocSchema>;

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
  sourceRecordId: idSchema.exactOptional(),
  restricted: z.boolean(),
  ...scopeFieldsShape,
  ...provenanceShape,
});
export type DocumentLinkDoc = z.output<typeof documentLinkDocSchema>;
