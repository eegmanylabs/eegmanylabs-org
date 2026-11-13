// Replications and scientific definition (docs/DATA_MODEL.md, section 5).
import { dataOriginSchema } from "../data-origin";
import { entityTypeSchema } from "../entities";
import { programmeDecisionSchema } from "../programme-answers";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  appendOnlyProvenanceShape,
  boundedRecord,
  customValuesSchema,
  datePeriodSchema,
  documentBaseSchema,
  doiSchema,
  freeMapSchema,
  idListSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  mapKeySchema,
  provenanceShape,
  richTextSchema,
  scopeFieldsShape,
  shortTextSchema,
  urlSchema,
  verbatimSchema,
} from "./base";

/**
 * The identifier of a replication: the programme's existing study identifier, unchanged
 * (D-013), for example `AmodioJost2007`. It holds letters and digits only, so it is safe as the
 * first part of a composite identifier.
 */
export const studyKeySchema = z
  .string()
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, { error: "Expected a study identifier" });

export const citationStatusSchema = z.enum(["unverified", "verified", "mismatch", "notFound"]);
export const replicationSelectionStatusSchema = z.enum(["selected", "withdrawn"]);

/** A count of participants, channels or laboratories as a source or a person states it. */
const countSchema = z.number().int().min(0).max(10_000_000);

/** One term of the vocabulary attached to a replication. */
export const vocabularyLinkSchema = z.strictObject({
  termId: idSchema,
  relation: keySchema,
  note: longTextSchema.exactOptional(),
});

/** The original study that a replication or a candidate study is about. */
const originalStudyShape = {
  originalAuthors: longTextSchema.exactOptional(),
  originalYear: z.number().int().min(1800).max(2200).exactOptional(),
  originalTitle: longTextSchema.exactOptional(),
  originalReference: longTextSchema.exactOptional(),
  originalDoi: doiSchema.exactOptional(),
};

/**
 * `replications/{studyKey}`: one replication. `statusKey`, `statusHistoryId` and `leadPersonIds`
 * are written by trusted code only: a status changes through a callable function that writes
 * the history entry in the same transaction (D-019), and the leads are derived from confirmed
 * memberships.
 */
export const replicationDocSchema = documentBaseSchema.extend({
  programmeId: idSchema,
  /** Immutable, and equal to the document identifier. */
  studyKey: studyKeySchema,
  shortTitle: shortTextSchema.exactOptional(),
  ...originalStudyShape,
  citationStatus: citationStatusSchema,
  citationCheckedAt: timestampSchema.exactOptional(),
  /** Where the citation was checked, as that source names itself. */
  citationSource: verbatimSchema.exactOptional(),
  citationMetadata: freeMapSchema.exactOptional(),
  abstract: richTextSchema.exactOptional(),
  rationale: richTextSchema.exactOptional(),
  effectOfInterest: longTextSchema.exactOptional(),
  plainLanguageDescription: richTextSchema.exactOptional(),
  originalN: countSchema.exactOptional(),
  originalNSource: verbatimSchema.exactOptional(),
  originalStatistics: longTextSchema.exactOptional(),
  originalEffectSizeSource: verbatimSchema.exactOptional(),
  originalEffectSizeValue: z.number().exactOptional(),
  originalEffectSizeMetric: shortTextSchema.exactOptional(),
  originalBayesFactorSource: verbatimSchema.exactOptional(),
  powerAssumptions: longTextSchema.exactOptional(),
  powerBasedN: countSchema.exactOptional(),
  powerBasedNSource: verbatimSchema.exactOptional(),
  targetN: countSchema.exactOptional(),
  durationSource: verbatimSchema.exactOptional(),
  sampleType: shortTextSchema.exactOptional(),
  minEegChannels: countSchema.exactOptional(),
  minEegChannelsSource: verbatimSchema.exactOptional(),
  extraEquipment: longTextSchema.exactOptional(),
  studyType: shortTextSchema.exactOptional(),
  outcome: longTextSchema.exactOptional(),
  psychConstruct: shortTextSchema.exactOptional(),
  theme: shortTextSchema.exactOptional(),
  /** The key of a document in `statusDefinitions`, or null while no status has been set. */
  statusKey: keySchema.nullable(),
  /** The latest entry of the status history, or null while there is none. */
  statusHistoryId: idSchema.nullable(),
  publicStageNumber: z.number().int().min(0).max(100).exactOptional(),
  publicStageName: shortTextSchema.exactOptional(),
  publicStageText: longTextSchema.exactOptional(),
  signupUrl: urlSchema.exactOptional(),
  signupActive: z.boolean().exactOptional(),
  selectionStatus: replicationSelectionStatusSchema,
  /** The current confirmed leads, derived from memberships. */
  leadPersonIds: idListSchema,
  vocabulary: z.array(vocabularyLinkSchema).max(LIMITS.list),
  custom: customValuesSchema,
  dataOrigin: dataOriginSchema,
  ...provenanceShape,
});
export type ReplicationDoc = z.output<typeof replicationDocSchema>;

/** `replications/{studyKey}/private/detail`: restricted notes and unverified outcome labels. */
export const replicationDetailDocSchema = documentBaseSchema.extend({
  /** The verbatim notes of a source, which may name individuals. */
  notesSource: verbatimSchema.exactOptional(),
  internalNotes: z.string().max(LIMITS.longText).exactOptional(),
  ...provenanceShape,
});
export type ReplicationDetailDoc = z.output<typeof replicationDetailDocSchema>;

/**
 * `predictionMarketOutcomes/{studyKey}`: the sealed data of the prediction market for one
 * replication (docs/MIGRATION_PLAN.md, section 11): its outcome labels (question 7), and its
 * null-significance labels and the links to its study description and information sheet
 * (question 22). Programme administrators alone read them, and nothing derived from them
 * reaches any other reader. A label is an unverified source value: it sets no result and no
 * status.
 */
export const predictionMarketOutcomeDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  /** Hypothesis identifier to the verbatim label of the column `replicated`. A blank cell has no entry. */
  labelsSource: boundedRecord(mapKeySchema, verbatimSchema, 99),
  /** The decision that seals the labels. */
  sealedBy: programmeDecisionSchema,
  /**
   * Hypothesis identifier to the verbatim label of the column `null-sig`. The text `null` is a
   * real value here and is never read as missing. A blank cell has no entry.
   */
  nullSigSource: boundedRecord(mapKeySchema, verbatimSchema, 99).exactOptional(),
  /** The address of the market's description of the study: the target of the link in `studyDescr_pdf`. */
  studyDescriptionUrl: urlSchema.exactOptional(),
  /** The address of the market's information sheet of the study: the target of the link in `infosheet_link`. */
  infosheetUrl: urlSchema.exactOptional(),
  /** The decision that seals the null-significance labels and the links, present while the document holds any. */
  materialSealedBy: programmeDecisionSchema.exactOptional(),
  ...provenanceShape,
});
export type PredictionMarketOutcomeDoc = z.output<typeof predictionMarketOutcomeDocSchema>;

/**
 * | Scheme           | What it holds                                                                |
 * |------------------|------------------------------------------------------------------------------|
 * | `programme`      | The programme identifier, and any other spelling written in an identifier column |
 * | `website`        | The `StudyId` of the public website data                                     |
 * | `cloudAccount`   | The cloud-account name of the naming conventions                             |
 * | `bids`           | The BIDS name of the naming conventions                                      |
 * | `eegnet`         | The EEGNet name of the naming conventions                                    |
 * | `sourceTab`      | A tab title that names a study                                               |
 * | `sourceLabel`    | The display text of a link that names a study                                |
 * | `dataRepository` | A repository name on a data host that embeds the study identifier            |
 * | `other`          | Any other spelling                                                           |
 */
export const aliasSchemeSchema = z.enum([
  "programme",
  "website",
  "cloudAccount",
  "bids",
  "eegnet",
  "sourceTab",
  "sourceLabel",
  "dataRepository",
  "other",
]);
export type AliasScheme = z.output<typeof aliasSchemeSchema>;

/**
 * `replications/{studyKey}/aliases/{scheme__hashOfAlias}`: another spelling of a study
 * identifier. An alias is unique only together with its replication.
 */
export const replicationAliasDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  /** The spelling exactly as the source wrote it. */
  alias: z.string().min(1).max(LIMITS.shortText),
  /** The lookup fold of the alias. Empty when nothing is left, in which case the alias has no index entry. */
  aliasFolded: z
    .string()
    .max(LIMITS.shortText)
    .regex(/^[a-z0-9]*$/, { error: "Expected a folded alias" }),
  scheme: aliasSchemeSchema,
  explanation: longTextSchema.exactOptional(),
  part1: shortTextSchema.exactOptional(),
  part2: shortTextSchema.exactOptional(),
  isCanonical: z.boolean(),
  ...provenanceShape,
});
export type ReplicationAliasDoc = z.output<typeof replicationAliasDocSchema>;

export const replicationMembershipRoleSchema = z.enum([
  "lead",
  "coLead",
  "formerLead",
  "coordinator",
  "analyst",
  "member",
  "advisor",
]);
export type ReplicationMembershipRole = z.output<typeof replicationMembershipRoleSchema>;
export const reviewStatusSchema = z.enum(["confirmed", "needsReview"]);

/**
 * `replications/{studyKey}/memberships/{personId__role}`: a record about a person, which grants
 * nothing by itself. Only administrators write a membership in the role `lead` or `coLead`,
 * and only administrators or the person concerned confirm any other.
 */
export const replicationMembershipDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  personId: idSchema,
  role: replicationMembershipRoleSchema,
  isCurrent: z.boolean(),
  startDate: isoDateSchema.exactOptional(),
  endDate: isoDateSchema.exactOptional(),
  earlierPeriods: z.array(datePeriodSchema).max(50),
  reviewStatus: reviewStatusSchema,
  /**
   * Why an import confirmed the membership without review: every source that names a lead of
   * the study names this person, which a decision of the programme allows (question 5). Absent
   * on a membership that no import confirmed. It stays as the record of that confirmation.
   */
  confirmationBasis: z
    .strictObject({
      basis: z.literal("allSourcesAgree"),
      /** The sources and tabs whose claims agree, such as `h/replications`. */
      sources: z.array(z.string().min(1).max(100)).min(1).max(20),
      decision: programmeDecisionSchema,
    })
    .exactOptional(),
  ...provenanceShape,
});
export type ReplicationMembershipDoc = z.output<typeof replicationMembershipDocSchema>;

export const scientificReviewStatusSchema = z.enum(["unverified", "underReview", "verified"]);
export const analysisStatusSchema = z.enum(["notStarted", "inProgress", "completed"]);

/**
 * | Source                  | Where a value was taken from                                      |
 * |-------------------------|-------------------------------------------------------------------|
 * | `originalArticle`       | The published article of the original study                       |
 * | `supplementaryMaterial` | The supplementary material of that article                        |
 * | `authorCorrespondence`  | A written answer of the original authors                          |
 * | `reanalysis`            | A reanalysis of the original data                                 |
 * | `analysisRun`           | An analysis run of the replication recorded in the portal         |
 * | `manuscript`            | An output of the replication                                      |
 */
export const findingSourceSchema = z.enum([
  "originalArticle",
  "supplementaryMaterial",
  "authorCorrespondence",
  "reanalysis",
  "analysisRun",
  "manuscript",
]);
export type FindingSource = z.output<typeof findingSourceSchema>;

/**
 * Where an original statistic or a result of a hypothesis comes from, and who recorded it when.
 * A value is never entered without it, so a figure that nobody can trace back is never shown as
 * a finding.
 */
export const findingProvenanceSchema = z.strictObject({
  source: findingSourceSchema,
  /** Where in the source: a table, a page, a figure or a section, as the recorder wrote it. */
  locator: shortTextSchema,
  url: urlSchema.exactOptional(),
  analysisRunId: idSchema.exactOptional(),
  manuscriptId: idSchema.exactOptional(),
  recordedBy: actorSchema,
  recordedAt: timestampSchema,
});
export type FindingProvenance = z.output<typeof findingProvenanceSchema>;

/** `replications/{studyKey}/hypotheses/{hNN}`: one hypothesis of a replication. */
export const replicationHypothesisDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  /** The number as the source wrote it. The identifier is built from it with `hypothesisId`. */
  hypothesisNumber: verbatimSchema,
  text: richTextSchema,
  expectedEffect: longTextSchema.exactOptional(),
  outcomeMeasure: longTextSchema.exactOptional(),
  analysisSpecification: richTextSchema.exactOptional(),
  preregistrationUrl: urlSchema.exactOptional(),
  /** Written through a callable function together with its provenance, or by an import. */
  originalStatistics: longTextSchema.exactOptional(),
  originalStatisticsProvenance: findingProvenanceSchema.exactOptional(),
  scientificReviewStatus: scientificReviewStatusSchema,
  analysisStatus: analysisStatusSchema,
  /** Written through a callable function together with its provenance. */
  resultSummary: richTextSchema.exactOptional(),
  resultProvenance: findingProvenanceSchema.exactOptional(),
  resultReviewedBy: actorSchema.nullable(),
  resultReviewedAt: timestampSchema.nullable(),
  // The null-significance label and the links to the market's study description and information
  // sheet are prediction-market data, sealed in `predictionMarketOutcomes` (question 22), and are
  // no fields of a hypothesis, which every member reads.
  ...provenanceShape,
});
export type ReplicationHypothesisDoc = z.output<typeof replicationHypothesisDocSchema>;

/** `replications/{studyKey}/protocols/{id}`: a protocol of the replication. Its content is held in its versions. */
export const replicationProtocolDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  title: shortTextSchema,
  description: longTextSchema.exactOptional(),
  currentVersionId: idSchema.nullable(),
});
export type ReplicationProtocolDoc = z.output<typeof replicationProtocolDocSchema>;

export const protocolVersionStatusSchema = z.enum(["draft", "approved", "superseded"]);

/** `replications/{studyKey}/protocolVersions/{id}`: one version of a protocol. */
export const replicationProtocolVersionDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  protocolId: idSchema,
  versionLabel: shortTextSchema,
  effectiveDate: isoDateSchema.exactOptional(),
  status: protocolVersionStatusSchema,
  changeSummary: longTextSchema.exactOptional(),
  documentLinkId: idSchema.exactOptional(),
  approvedBy: actorSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
});
export type ReplicationProtocolVersionDoc = z.output<typeof replicationProtocolVersionDocSchema>;

export const requirementOperatorSchema = z.enum(["equals", "atLeast", "atMost", "includes", "present"]);

/**
 * `replications/{studyKey}/equipmentRequirements/{key}`: one requirement, compared with the
 * current equipment configuration of a laboratory.
 */
export const replicationEquipmentRequirementDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  requirementKey: keySchema,
  operator: requirementOperatorSchema,
  /** Absent for the operator `present`, which asks only that the laboratory states the property. */
  value: z.union([z.string().max(LIMITS.shortText), z.number(), z.boolean()]).exactOptional(),
  isMandatory: z.boolean(),
  note: longTextSchema.exactOptional(),
});
export type ReplicationEquipmentRequirementDoc = z.output<typeof replicationEquipmentRequirementDocSchema>;

/** The three ways of counting in recruitment. `participants` counts unique people. */
export const recruitmentModalitySchema = z.enum(["main", "rest", "participants"]);
export type RecruitmentModality = z.output<typeof recruitmentModalitySchema>;

/** Whether a laboratory reported a figure or the programme verified it. The two are never mixed. */
export const recruitmentBasisSchema = z.enum(["labReported", "centrallyVerified"]);
export type RecruitmentBasis = z.output<typeof recruitmentBasisSchema>;

/**
 * Counts by modality and category. An absent modality or category means that the value is
 * unknown, and nothing here is a total across modalities: the number of participants is never
 * the sum of `main` and `rest`.
 */
export const recruitmentCountsSchema = z.partialRecord(
  recruitmentModalitySchema,
  boundedRecord(keySchema, z.number().int().min(0)),
);
export type RecruitmentCounts = z.output<typeof recruitmentCountsSchema>;

/**
 * `replications/{studyKey}/summaries/{kind}`: a rollup that every member may read, such as
 * recruitment totals, written by the function that files a report.
 */
export const replicationSummaryDocSchema = documentBaseSchema.extend({
  replicationId: idSchema,
  kind: keySchema,
  /** Basis to modality to category key to count, with unknown values absent. */
  totals: z.partialRecord(recruitmentBasisSchema, recruitmentCountsSchema),
  /** Basis to modality to category key to the number of participations that state the value. */
  reporting: z.partialRecord(recruitmentBasisSchema, recruitmentCountsSchema).exactOptional(),
  participationCount: z.number().int().min(0),
  reportCount: z.number().int().min(0),
  latestAsOfDate: isoDateSchema.nullable(),
  computedAt: timestampSchema,
});
export type ReplicationSummaryDoc = z.output<typeof replicationSummaryDocSchema>;

/** The kinds of record that have a status and therefore a status history. */
export const statusEntityTypeSchema = entityTypeSchema.extract([
  "replication",
  "participation",
  "dataset",
  "task",
  "manuscript",
]);
export type StatusEntityType = z.output<typeof statusEntityTypeSchema>;

/** `programmeDecision`: a status that a decision of the programme gave, which the entry names in `decision`. */
export const statusChangeSourceSchema = z.enum(["manual", "import", "automation", "sheetSync", "programmeDecision"]);

/**
 * `statusHistory/{id}`: one change of status of any record that has one. Written by the
 * callable function that changes the status, in the same transaction, and never changed
 * afterwards. Of two entries with the same effective time the one recorded later holds.
 */
export const statusHistoryDocSchema = appendOnlyBaseSchema.extend({
  entityType: statusEntityTypeSchema,
  entityId: idSchema,
  fromStatusKey: keySchema.nullable(),
  toStatusKey: keySchema,
  effectiveAt: timestampSchema,
  recordedAt: timestampSchema,
  changedBy: actorSchema,
  reason: longTextSchema.exactOptional(),
  source: statusChangeSourceSchema,
  /** The decision of the programme behind a change whose source is `programmeDecision`. */
  decision: programmeDecisionSchema.exactOptional(),
  ...scopeFieldsShape,
  ...appendOnlyProvenanceShape,
});
export type StatusHistoryDoc = z.output<typeof statusHistoryDocSchema>;

/**
 * `historicalAggregates/{metricKey__sourceRecordId}`: a replication-level figure from a
 * historical workbook, kept apart from live reports (D-009). One source row can describe two
 * replications together, and such a figure is never apportioned between them.
 */
export const historicalAggregateDocSchema = documentBaseSchema.extend({
  replicationIds: idListSchema.min(1),
  metricKey: keySchema,
  valueSource: verbatimSchema,
  /** The standardised reading of the value. Absent when the value cannot be read as a number. */
  valueNumeric: z.number().exactOptional(),
  /** Absent when the source gives no as-of date. */
  snapshotDate: isoDateSchema.exactOptional(),
  sourceRecordId: idSchema,
  isCurrent: z.boolean(),
  /** Imported historical figures, or the invented figures of the demonstration world. */
  dataOrigin: z.enum(["importedHistorical", "demo"]),
  /**
   * The decision that seals the figure: the summary figures of source F (question 14). Absent on
   * the figures of the coordination workbook A, which the project sealed alike as a safeguard and
   * which the answer to question 24 keeps sealed.
   */
  sealedBy: programmeDecisionSchema.exactOptional(),
  ...provenanceShape,
});
export type HistoricalAggregateDoc = z.output<typeof historicalAggregateDocSchema>;

export const candidateSelectionStatusSchema = z.enum(["shortlisted", "rankedCandidate", "selected", "withdrawn"]);

/** `candidateStudies/{id}`: a nominated paper that has no study identifier. */
export const candidateStudyDocSchema = documentBaseSchema.extend({
  programmeId: idSchema,
  ...originalStudyShape,
  selectionStatus: candidateSelectionStatusSchema,
  /** Set once the paper has become a replication. */
  replicationId: idSchema.nullable(),
  dataOrigin: dataOriginSchema,
  ...provenanceShape,
});
export type CandidateStudyDoc = z.output<typeof candidateStudyDocSchema>;

/** `studyAliasIndex/{foldedAlias}`: resolves a folded spelling to the replications that carry it. */
export const studyAliasIndexDocSchema = documentBaseSchema.extend({
  /** An array, since one alias can belong to two studies. */
  replicationIds: idListSchema.min(1),
});
export type StudyAliasIndexDoc = z.output<typeof studyAliasIndexDocSchema>;

export const statusCategorySchema = z.enum(["notStarted", "active", "done", "paused", "cancelled"]);
export type StatusCategory = z.output<typeof statusCategorySchema>;

/** `statusDefinitions/{entityType__key}`: a status that administrators may reconfigure. */
export const statusDefinitionDocSchema = documentBaseSchema.extend({
  entityType: statusEntityTypeSchema,
  key: keySchema,
  label: shortTextSchema,
  category: statusCategorySchema,
  position: z.number().int().min(0),
  isDefault: z.boolean(),
});
export type StatusDefinitionDoc = z.output<typeof statusDefinitionDocSchema>;

/**
 * `vocabularyTerms/{termId}`: a term of the community vocabulary, which keeps its original
 * identifier, or a label from any other source, keyed by its kind and folded value.
 */
export const vocabularyTermDocSchema = documentBaseSchema.extend({
  /** The original identifier, where the term has one. */
  sourceId: shortTextSchema.exactOptional(),
  name: shortTextSchema,
  abbreviation: shortTextSchema.exactOptional(),
  description: longTextSchema.exactOptional(),
  invalidReason: longTextSchema.exactOptional(),
  /** External codes, verbatim. They never refer to another local term. */
  sameAsSource: z.array(verbatimSchema).max(LIMITS.list),
  /** Every raw spelling of the label. */
  labelsSource: z.array(verbatimSchema).max(LIMITS.list),
  kind: keySchema,
  isDeprecated: z.boolean(),
  ...provenanceShape,
});
export type VocabularyTermDoc = z.output<typeof vocabularyTermDocSchema>;

/** `predictionMarketItems/{id}`: a survey or market question, about a hypothesis or about the programme. */
export const predictionMarketItemDocSchema = documentBaseSchema.extend({
  /** Absent, like `hypothesisId`, for a question about the programme. */
  replicationId: idSchema.exactOptional(),
  hypothesisId: idSchema.exactOptional(),
  questionText: longTextSchema,
  choices: z.array(shortTextSchema).max(50),
  ...provenanceShape,
});
export type PredictionMarketItemDoc = z.output<typeof predictionMarketItemDocSchema>;
