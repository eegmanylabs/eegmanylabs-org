// Contracts of the callable functions of the scientific workflows (phase 8): findings of
// hypotheses with their provenance, analysis runs, the decision log, the incident registry,
// authorship lists, manuscripts with their events and milestones, and the check of OSF links.
// The conventions of callables.ts hold: a time crosses the wire as ISO 8601 text with an offset,
// and a calendar date as ISO 8601 date text.
import type { CallableContract } from "../callables";
import {
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  mapKeySchema,
  orcidSchema,
  shortTextSchema,
  urlSchema,
} from "../schemas/base";
import {
  analysisRunOutputSchema,
  processingRunKindSchema,
  processingRunStatusSchema,
  RUN_INPUTS_MAX,
  RUN_OUTPUTS_MAX,
  reproducibilityStatusSchema,
  runQcStatusSchema,
} from "../schemas/datasets";
import {
  AUTHORSHIP_ENTRIES_MAX,
  authorshipEntryKindSchema,
  authorshipListStatusSchema,
  authorshipOrderingRuleSchema,
  contributionRoleSchema,
  correctedReportSchema,
  creditRoleKeySchema,
  DEVIATION_REFS_MAX,
  decisionEntryKindSchema,
  decisionStatusSchema,
  deviationRefSchema,
  governanceScopeTypeSchema,
  incidentActionKindSchema,
  incidentStatusSchema,
  linkAccessStatusSchema,
  manuscriptDecisionOutcomeSchema,
  manuscriptEventKindSchema,
  manuscriptKindSchema,
  manuscriptMilestoneSchema,
  manuscriptStatusSchema,
  OUTPUT_LINKS_MAX,
  riskLevelSchema,
} from "../schemas/outputs";
import { analysisStatusSchema, findingSourceSchema } from "../schemas/replications";
import { z } from "../zod";

const instantSchema = z.iso.datetime({ offset: true });
const textSchema = z.string().trim().min(1).max(LIMITS.longText);
const optionalText = textSchema.nullable();
const titleSchema = z.string().trim().min(1).max(LIMITS.shortText);

/**
 * | Function                   | Capability                                                                 |
 * |----------------------------|----------------------------------------------------------------------------|
 * | `recordHypothesisFinding`  | `replications.manage` for the replication; a lead only while the hypothesis is neither reviewed nor verified |
 *
 * Records an original statistic or a result of a hypothesis with where it comes from. A value is
 * never written without its provenance, and nothing is prefilled: the function writes exactly
 * the text it is given. A new result clears an earlier review of the result, which no longer
 * covers what it signed.
 */
export const recordHypothesisFindingContract = {
  name: "recordHypothesisFinding",
  input: z.strictObject({
    replicationId: idSchema,
    hypothesisId: idSchema,
    finding: z.enum(["originalStatistics", "result"]),
    text: textSchema,
    provenance: z.strictObject({
      source: findingSourceSchema,
      locator: titleSchema,
      url: urlSchema.nullable(),
      analysisRunId: idSchema.nullable(),
      manuscriptId: idSchema.nullable(),
    }),
    /** For a result: the state of the analysis it reports. */
    analysisStatus: analysisStatusSchema.nullable(),
  }),
  output: z.strictObject({ hypothesisId: idSchema }),
} as const satisfies CallableContract;

/** The value of a parameter or of a part of the environment of a run. */
const runValueSchema = z.union([z.string().max(LIMITS.shortText), z.number(), z.boolean()]);
const runMapSchema = z
  .record(mapKeySchema, runValueSchema)
  .refine((map) => Object.keys(map).length <= 100, { error: "A run states at most 100 parameters" });

/**
 * | Function         | Capability                                                                    |
 * |------------------|-------------------------------------------------------------------------------|
 * | `saveAnalysisRun`| `datasets.manage` or `replications.manage` for the replication, or `datasets.manage` for the laboratory |
 *
 * Records an analysis run or changes one. Every dataset it read belongs to its replication, a
 * copy it names is a copy of that dataset, and the listing of each copy is taken as it stands
 * when the run is saved. The hypotheses it tests are hypotheses of the replication, and a run it
 * reproduces is a run of the same replication.
 */
export const saveAnalysisRunContract = {
  name: "saveAnalysisRun",
  input: z.strictObject({
    runId: idSchema.nullable(),
    replicationId: idSchema,
    laboratoryId: idSchema.nullable(),
    kind: processingRunKindSchema,
    title: titleSchema.nullable(),
    pipelineName: titleSchema,
    version: z.string().trim().min(1).max(64).nullable(),
    codeUrl: urlSchema.nullable(),
    codeCommit: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{7,64}$/i, { error: "Expected a commit hash of 7 to 64 hexadecimal characters" })
      .nullable(),
    parameters: runMapSchema,
    environment: runMapSchema,
    status: processingRunStatusSchema,
    startedAt: instantSchema.nullable(),
    finishedAt: instantSchema.nullable(),
    inputs: z.array(z.strictObject({ datasetId: keySchema, storageRefId: idSchema.nullable() })).max(RUN_INPUTS_MAX),
    outputs: z.array(analysisRunOutputSchema).max(RUN_OUTPUTS_MAX),
    hypothesisIds: z.array(idSchema).max(99),
    qcStatus: runQcStatusSchema,
    qcNotes: optionalText,
    reproducibilityStatus: reproducibilityStatusSchema,
    reproducesRunId: idSchema.nullable(),
    reproducibilityNotes: optionalText,
  }),
  output: z.strictObject({ runId: idSchema }),
} as const satisfies CallableContract;

/**
 * | Function         | Capability                                                                     |
 * |------------------|--------------------------------------------------------------------------------|
 * | `recordDecision` | `replications.manage` for a replication, `labs.manage` for a laboratory, `replications.manage` for the programme |
 *
 * Appends an entry to the methodological decision log. Nothing in the log changes: a correction
 * is a new entry that names the first entry of the decision it corrects, in the same scope, and a
 * replacement names the decision it supersedes. A deviation it names belongs to a participation
 * of the scope.
 */
export const recordDecisionContract = {
  name: "recordDecision",
  input: z.strictObject({
    scopeType: governanceScopeTypeSchema,
    scopeId: idSchema,
    kind: decisionEntryKindSchema,
    correctsDecisionId: idSchema.nullable(),
    supersedesDecisionId: idSchema.nullable(),
    title: titleSchema,
    summary: textSchema,
    rationale: optionalText,
    outcome: optionalText,
    status: decisionStatusSchema.exclude(["superseded"]),
    ownerPersonId: idSchema.nullable(),
    decidedAt: isoDateSchema.nullable(),
    deviations: z.array(deviationRefSchema).max(DEVIATION_REFS_MAX),
  }),
  output: z.strictObject({ decisionId: idSchema }),
} as const satisfies CallableContract;

const incidentScopeTypeSchema = z.enum(["replication", "laboratory"]);

/**
 * | Function         | Capability                                                                      |
 * |------------------|---------------------------------------------------------------------------------|
 * | `reportIncident` | `participations.manage` for the replication or the laboratory                   |
 *
 * Reports an incident of a replication or a laboratory. A participation it names belongs to the
 * scope, a dataset to the participation or the scope, and a deviation to the participation.
 */
export const reportIncidentContract = {
  name: "reportIncident",
  input: z.strictObject({
    scopeType: incidentScopeTypeSchema,
    scopeId: idSchema,
    title: titleSchema,
    description: textSchema,
    severity: riskLevelSchema,
    occurredAt: isoDateSchema,
    participationId: idSchema.nullable(),
    datasetId: keySchema.nullable(),
    deviations: z.array(deviationRefSchema).max(DEVIATION_REFS_MAX),
  }),
  output: z.strictObject({ incidentId: idSchema }),
} as const satisfies CallableContract;

/**
 * | Function               | Capability                                                                |
 * |------------------------|---------------------------------------------------------------------------|
 * | `recordIncidentAction` | `participations.manage` for the scope of the incident                     |
 *
 * Appends an action to an incident: a corrective action with its owner and due date, a change of
 * status, a note, or a correction of the report or of an earlier action. Nothing earlier changes.
 */
export const recordIncidentActionContract = {
  name: "recordIncidentAction",
  input: z.strictObject({
    incidentId: idSchema,
    kind: incidentActionKindSchema,
    text: optionalText,
    status: incidentStatusSchema.nullable(),
    ownerPersonId: idSchema.nullable(),
    dueDate: isoDateSchema.nullable(),
    correctsActionId: idSchema.nullable(),
    correctedReport: correctedReportSchema.nullable(),
  }),
  output: z.strictObject({ actionId: idSchema }),
} as const satisfies CallableContract;

const authorshipEntryInputSchema = z.strictObject({
  personId: idSchema,
  contributorId: idSchema.nullable(),
  kind: authorshipEntryKindSchema,
  displayName: titleSchema,
  affiliations: z.array(titleSchema).max(9),
  orcid: orcidSchema.nullable(),
  creditRoles: z.array(creditRoleKeySchema).max(14),
  contributionRoles: z.array(contributionRoleSchema).max(4),
  isCorresponding: z.boolean(),
});
export type AuthorshipEntryInput = z.output<typeof authorshipEntryInputSchema>;

/**
 * | Function            | Capability                                                                   |
 * |---------------------|------------------------------------------------------------------------------|
 * | `saveAuthorshipList`| `replications.manage` for the replication of the manuscript                  |
 *
 * Saves the authorship list of a manuscript: its ordering rule, its status and every entry, in
 * order within each kind. A person appears once, exists, and is named from the replication's
 * contributor table where `contributorId` says so. An entry whose content changes asks its
 * person for a new answer; one that stays as it was keeps its answer. A list is final only while
 * every person has confirmed their entry.
 */
export const saveAuthorshipListContract = {
  name: "saveAuthorshipList",
  input: z.strictObject({
    manuscriptId: idSchema,
    orderingRule: authorshipOrderingRuleSchema,
    orderingNote: optionalText,
    status: authorshipListStatusSchema,
    /** The revision the leads edited, so a save never overwrites a list that changed meanwhile. */
    expectedRevision: z.number().int().min(0),
    entries: z.array(authorshipEntryInputSchema).max(AUTHORSHIP_ENTRIES_MAX),
  }),
  output: z.strictObject({ revision: z.number().int().min(1) }),
} as const satisfies CallableContract;

/**
 * | Function                    | Capability                                                          |
 * |-----------------------------|---------------------------------------------------------------------|
 * | `respondToAuthorshipEntry`  | The person of the entry, through the account linked to them         |
 *
 * Confirms the caller's own entry on an authorship list, or asks the leads for a change with a
 * note. The answer names the revision of the entry it answers, and an answer to an earlier
 * revision is refused.
 */
export const respondToAuthorshipEntryContract = {
  name: "respondToAuthorshipEntry",
  input: z.strictObject({
    manuscriptId: idSchema,
    response: z.enum(["confirmed", "changesRequested"]),
    entryRevision: z.number().int().min(1),
    note: optionalText,
  }),
  output: z.strictObject({ manuscriptId: idSchema }),
} as const satisfies CallableContract;

/** One entry of the caller on an authorship list, as `listMyAuthorshipEntries` returns it. */
const myEntrySchema = z.strictObject({
  manuscriptId: idSchema,
  manuscriptTitle: z.string().min(1).max(1_000),
  replicationId: idSchema.nullable(),
  listStatus: authorshipListStatusSchema,
  kind: authorshipEntryKindSchema,
  position: z.number().int().min(1),
  displayName: shortTextSchema,
  affiliations: z.array(shortTextSchema),
  orcid: orcidSchema.nullable(),
  creditRoles: z.array(creditRoleKeySchema),
  contributionRoles: z.array(contributionRoleSchema),
  isCorresponding: z.boolean(),
  entryRevision: z.number().int().min(1),
  confirmation: z.strictObject({
    status: z.enum(["pending", "confirmed", "changesRequested"]),
    revision: z.number().int().min(0),
    respondedAt: instantSchema.nullable(),
    note: z.string().nullable(),
  }),
});
export type MyAuthorshipEntry = z.output<typeof myEntrySchema>;

/**
 * | Function                   | Capability                                                            |
 * |----------------------------|-----------------------------------------------------------------------|
 * | `listMyAuthorshipEntries`  | Any member whose account is linked to a person                        |
 *
 * The caller's own entries on the authorship lists of manuscripts, whether or not the caller
 * reads the rest of the list. Nothing about the other people on a list is returned.
 */
export const listMyAuthorshipEntriesContract = {
  name: "listMyAuthorshipEntries",
  input: z.strictObject({}),
  output: z.strictObject({ entries: z.array(myEntrySchema).max(500) }),
} as const satisfies CallableContract;

/**
 * | Function         | Capability                                                                     |
 * |------------------|--------------------------------------------------------------------------------|
 * | `saveManuscript` | `replications.manage` for the replication; for a programme-level output, for the programme |
 *
 * Creates a manuscript, a preprint, a dataset or software output, or changes one. A new output
 * starts as `planned`, and its status changes through `recordManuscriptEvent`. A Stage 1 report
 * named by a Stage 2 report, the hypotheses and the datasets are of the same replication.
 */
export const saveManuscriptContract = {
  name: "saveManuscript",
  input: z.strictObject({
    manuscriptId: idSchema.nullable(),
    replicationId: idSchema.nullable(),
    title: z.string().trim().min(1).max(1_000),
    kind: manuscriptKindSchema,
    journal: titleSchema.nullable(),
    doi: z
      .string()
      .trim()
      .regex(/^10\.\d{4,9}\/\S+$/, { error: "Expected a DOI such as 10.1000/example" })
      .max(LIMITS.shortText)
      .nullable(),
    preprintDoi: z
      .string()
      .trim()
      .regex(/^10\.\d{4,9}\/\S+$/, { error: "Expected a DOI such as 10.1000/example" })
      .max(LIMITS.shortText)
      .nullable(),
    osfUrl: urlSchema.nullable(),
    authorsShort: titleSchema.nullable(),
    stage1ManuscriptId: idSchema.nullable(),
    hypothesisIds: z.array(idSchema).max(OUTPUT_LINKS_MAX),
    datasetIds: z.array(keySchema).max(OUTPUT_LINKS_MAX),
    repositoryUrl: urlSchema.nullable(),
    outputVersion: z.string().trim().min(1).max(64).nullable(),
  }),
  output: z.strictObject({ manuscriptId: idSchema }),
} as const satisfies CallableContract;

/**
 * | Function                | Capability                                                              |
 * |-------------------------|-------------------------------------------------------------------------|
 * | `recordManuscriptEvent` | As `saveManuscript`                                                     |
 *
 * Records a submission, a review round, a decision, a revision, an acceptance or a publication
 * of a manuscript, with its documents. Where it moves the manuscript to another status, the
 * status and its history entry change in the same transaction, the date of submission,
 * acceptance or publication is set, and the milestone task that stands for that step is
 * completed.
 */
export const recordManuscriptEventContract = {
  name: "recordManuscriptEvent",
  input: z.strictObject({
    manuscriptId: idSchema,
    kind: manuscriptEventKindSchema,
    round: z.number().int().min(0).max(100).nullable(),
    occurredAt: isoDateSchema,
    dueAt: isoDateSchema.nullable(),
    outcome: manuscriptDecisionOutcomeSchema.nullable(),
    summary: optionalText,
    documentLinkIds: z.array(idSchema).max(20),
    status: manuscriptStatusSchema.nullable(),
  }),
  output: z.strictObject({ eventId: idSchema, status: manuscriptStatusSchema }),
} as const satisfies CallableContract;

/**
 * | Function                  | Capability                                                            |
 * |---------------------------|-----------------------------------------------------------------------|
 * | `planManuscriptMilestone` | As `saveManuscript`, and `tasks.manage` for the list                  |
 *
 * Plans the submission, the acceptance or the publication of a manuscript as a milestone in a
 * task list of its replication, linked to the manuscript, so that it appears on the timelines
 * and in the summary of milestones. The event that reaches the step completes it.
 */
export const planManuscriptMilestoneContract = {
  name: "planManuscriptMilestone",
  input: z.strictObject({
    manuscriptId: idSchema,
    milestone: manuscriptMilestoneSchema,
    listId: idSchema,
    dueDate: isoDateSchema,
  }),
  output: z.strictObject({ taskId: idSchema }),
} as const satisfies CallableContract;

/**
 * | Function       | Capability                                                                       |
 * |----------------|----------------------------------------------------------------------------------|
 * | `checkOsfLink` | Whoever reads the link and manages its record                                    |
 *
 * Reads the metadata of the public OSF resource a link points at, through the OSF adapter, and
 * records on the link what OSF answered: its access, its title and when it last changed. A
 * resource that is not public, gone or unreachable is recorded as such and nothing is made up.
 */
export const checkOsfLinkContract = {
  name: "checkOsfLink",
  input: z.strictObject({ linkId: idSchema }),
  output: z.strictObject({
    accessStatus: linkAccessStatusSchema,
    title: z.string().nullable(),
    kind: z.enum(["node", "registration", "preprint"]).nullable(),
    registeredAt: instantSchema.nullable(),
    withdrawn: z.boolean(),
    message: z.string(),
  }),
} as const satisfies CallableContract;
