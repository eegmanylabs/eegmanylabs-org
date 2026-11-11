// Recruitment (docs/DATA_MODEL.md, section 7): an append-only series of reports (D-009) that a
// callable function files (D-019), with the configured count categories, planned pauses and
// forecasts.
import { dataOriginSchema } from "../data-origin";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  appendOnlyProvenanceShape,
  documentBaseSchema,
  freeMapSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  shortTextSchema,
  unitScopeFieldsShape,
  verbatimSchema,
} from "./base";
import { recruitmentBasisSchema, recruitmentCountsSchema, recruitmentModalitySchema } from "./replications";

/**
 * `countCategories/{key}`: a category of participant counts. Category keys form one key space:
 * a category of one replication names that replication, so a key in a report has one meaning.
 */
export const countCategoryDocSchema = documentBaseSchema.extend({
  key: keySchema,
  label: shortTextSchema,
  /** One sentence that says exactly who is counted. */
  definition: longTextSchema,
  position: z.number().int().min(0),
  isCore: z.boolean(),
  /** Absent for a global category. */
  replicationId: idSchema.exactOptional(),
});
export type CountCategoryDoc = z.output<typeof countCategoryDocSchema>;

export const reportKindSchema = z.enum(["cumulative", "period"]);
export const reportEntryKindSchema = z.enum(["new", "correction", "void"]);
export const reportSourceSchema = z.enum(["manual", "import", "sheetSync"]);
export type ReportKind = z.output<typeof reportKindSchema>;
export type ReportEntryKind = z.output<typeof reportEntryKindSchema>;

export const recruitmentExclusionSchema = z.strictObject({
  modality: recruitmentModalitySchema,
  reasonTermId: idSchema.exactOptional(),
  reasonSource: verbatimSchema.exactOptional(),
  count: z.number().int().min(0),
});

/**
 * `recruitmentReports/{id}`: one report, created once by a callable function and never edited
 * or deleted. A correction is a new report that names the one it corrects, a report of entry
 * kind `void` withdraws the one it names and carries no counts, and central verification is a
 * new report with the basis `centrallyVerified`.
 *
 * `counts` is the only place a count is held. There is no field for a total, and the number of
 * participants is never derived by adding `main` and `rest`.
 */
export const recruitmentReportDocSchema = appendOnlyBaseSchema
  .extend({
    participationId: idSchema,
    ...unitScopeFieldsShape,
    /** The date for which the counts hold. */
    asOfDate: isoDateSchema,
    periodStart: isoDateSchema.exactOptional(),
    periodEnd: isoDateSchema.exactOptional(),
    reportKind: reportKindSchema,
    basis: recruitmentBasisSchema,
    entryKind: reportEntryKindSchema,
    correctsReportId: idSchema.exactOptional(),
    verifiesReportId: idSchema.exactOptional(),
    counts: recruitmentCountsSchema,
    exclusions: z.array(recruitmentExclusionSchema).max(100),
    note: longTextSchema.exactOptional(),
    reportedBy: actorSchema,
    source: reportSourceSchema,
    dataOrigin: dataOriginSchema,
    ...appendOnlyProvenanceShape,
  })
  .refine((report) => (report.entryKind === "new") === (report.correctsReportId === undefined), {
    error: "A correction and a void name the report they replace, and a new report names none",
    path: ["correctsReportId"],
  })
  .refine((report) => report.entryKind !== "void" || Object.keys(report.counts).length === 0, {
    error: "A report that withdraws another carries no counts",
    path: ["counts"],
  })
  .refine((report) => report.entryKind !== "void" || report.exclusions.length === 0, {
    error: "A report that withdraws another carries no exclusions",
    path: ["exclusions"],
  })
  .refine((report) => report.verifiesReportId === undefined || report.basis === "centrallyVerified", {
    error: "Only a centrally verified report names a report it verifies",
    path: ["verifiesReportId"],
  })
  .refine(
    (report) => report.reportKind !== "period" || (report.periodStart !== undefined && report.periodEnd !== undefined),
    { error: "A period report states the start and the end of its period", path: ["periodStart"] },
  )
  .refine(
    (report) =>
      report.periodStart === undefined || report.periodEnd === undefined || report.periodStart <= report.periodEnd,
    { error: "A period ends on or after the day it starts", path: ["periodEnd"] },
  );
export type RecruitmentReportDoc = z.output<typeof recruitmentReportDocSchema>;

/** `plannedPauses/{id}`: a period in which a laboratory will not collect data. */
export const plannedPauseDocSchema = documentBaseSchema
  .extend({
    participationId: idSchema,
    ...unitScopeFieldsShape,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    reason: longTextSchema.exactOptional(),
  })
  .refine((pause) => pause.startsOn <= pause.endsOn, {
    error: "A pause ends on or after the day it starts",
    path: ["endsOn"],
  });
export type PlannedPauseDoc = z.output<typeof plannedPauseDocSchema>;

/**
 * `forecastRuns/{id}`: one run of the recruitment forecast, written by a function and never
 * changed. Its values are projections and never observations.
 */
export const forecastRunDocSchema = appendOnlyBaseSchema.extend({
  replicationId: idSchema,
  generatedAt: timestampSchema,
  generatedBy: actorSchema,
  methodVersion: z.string().min(1).max(LIMITS.shortText),
  assumptions: freeMapSchema,
  /** Results and intervals of the three scenarios. */
  scenarios: z.strictObject({
    optimistic: freeMapSchema,
    central: freeMapSchema,
    conservative: freeMapSchema,
  }),
  /** The date up to which reports were taken into account. */
  inputsAsOf: isoDateSchema,
  dataOrigin: z.literal("projected"),
});
export type ForecastRunDoc = z.output<typeof forecastRunDocSchema>;
