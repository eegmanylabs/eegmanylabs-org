// Participation (docs/DATA_MODEL.md, section 6): everything specific to one laboratory in one
// replication (D-008), its onboarding checklist and the historical outreach correspondence.
import { dataOriginSchema } from "../data-origin";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  customValuesSchema,
  documentBaseSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  provenanceShape,
  scopeKeysSchema,
  shortTextSchema,
  unitScopeFieldsShape,
  urlSchema,
  verbatimSchema,
} from "./base";

export const participationStatusSchema = z.enum([
  "invited",
  "interested",
  "confirmed",
  "onboarding",
  "ready",
  "collecting",
  "collectionComplete",
  "withdrawn",
  "declined",
]);
export type ParticipationStatus = z.output<typeof participationStatusSchema>;
export const readinessStatusSchema = z.enum(["notStarted", "inProgress", "readyForReview", "approved"]);

const targetSchema = z.number().int().min(0).max(1_000_000);

/**
 * `participations/{studyKey__laboratoryId}`: the registry fields of one laboratory in one
 * replication, readable by every member. `status` and `statusHistoryId` change through a
 * callable function, which writes the history entry in the same transaction.
 */
export const participationDocSchema = documentBaseSchema.extend({
  ...unitScopeFieldsShape,
  localLeadPersonId: idSchema.exactOptional(),
  status: participationStatusSchema,
  statusHistoryId: idSchema.nullable(),
  targetNMain: targetSchema.exactOptional(),
  targetNRest: targetSchema.exactOptional(),
  protocolId: idSchema.exactOptional(),
  protocolVersionId: idSchema.exactOptional(),
  equipmentConfigurationId: idSchema.exactOptional(),
  signedUpAt: timestampSchema.exactOptional(),
  readinessStatus: readinessStatusSchema,
  custom: customValuesSchema,
  dataOrigin: dataOriginSchema,
  ...provenanceShape,
});
export type ParticipationDoc = z.output<typeof participationDocSchema>;

export const ethicsStatusSchema = z.enum(["unknown", "notStarted", "submitted", "approved", "notRequired"]);
export const trainingStatusSchema = z.enum(["unknown", "notStarted", "inProgress", "completed", "notRequired"]);

/** `participations/{participationId}/private/detail`: ethics, training, readiness approval and notes. */
export const participationDetailDocSchema = documentBaseSchema.extend({
  ethicsStatus: ethicsStatusSchema,
  ethicsReference: shortTextSchema.exactOptional(),
  ethicsApprovedAt: timestampSchema.exactOptional(),
  trainingStatus: trainingStatusSchema,
  readinessApprovedBy: actorSchema.nullable(),
  readinessApprovedAt: timestampSchema.nullable(),
  equipmentOverrideJustification: longTextSchema.exactOptional(),
  notes: z.string().max(LIMITS.longText).exactOptional(),
});
export type ParticipationDetailDoc = z.output<typeof participationDetailDocSchema>;

export const checklistItemStatusSchema = z.enum(["notStarted", "inProgress", "done", "notApplicable", "blocked"]);

/**
 * `participations/{participationId}/checklist/{itemKey}`: one item of the onboarding
 * checklist. `label` and `position` are copies taken from the template when the participation
 * was created and are never synchronised afterwards.
 */
export const participationChecklistItemDocSchema = documentBaseSchema.extend({
  participationId: idSchema,
  templateKey: keySchema,
  templateItemKey: keySchema,
  label: shortTextSchema,
  status: checklistItemStatusSchema,
  completedBy: actorSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  evidenceUrl: urlSchema.exactOptional(),
  note: longTextSchema.exactOptional(),
  position: z.number().int().min(0),
  ...unitScopeFieldsShape,
});
export type ParticipationChecklistItemDoc = z.output<typeof participationChecklistItemDocSchema>;

export const participationTeamRoleSchema = z.enum(["localLead", "experimenter", "analyst", "dataManager", "member"]);

/** `participations/{participationId}/teamMembers/{personId}`: a person at the laboratory who works on this replication. */
export const participationTeamMemberDocSchema = documentBaseSchema.extend({
  participationId: idSchema,
  personId: idSchema,
  role: participationTeamRoleSchema,
  ...unitScopeFieldsShape,
});
export type ParticipationTeamMemberDoc = z.output<typeof participationTeamMemberDocSchema>;

/**
 * `participations/{participationId}/acknowledgements/{personId__protocolVersionId}`: created
 * once for a person and a protocol version, and never changed.
 */
export const participationAcknowledgementDocSchema = appendOnlyBaseSchema.extend({
  participationId: idSchema,
  protocolId: idSchema,
  protocolVersionId: idSchema,
  personId: idSchema,
  acknowledgedAt: timestampSchema,
  ...unitScopeFieldsShape,
});
export type ParticipationAcknowledgementDoc = z.output<typeof participationAcknowledgementDocSchema>;

export const deviationSeveritySchema = z.enum(["minor", "major", "critical"]);
export const deviationStatusSchema = z.enum(["open", "underReview", "resolved"]);

/** `participations/{participationId}/deviations/{id}`: a deviation from the protocol. */
export const participationDeviationDocSchema = documentBaseSchema.extend({
  participationId: idSchema,
  description: longTextSchema,
  severity: deviationSeveritySchema,
  occurredAt: timestampSchema,
  reportedBy: actorSchema,
  correctiveAction: longTextSchema.exactOptional(),
  status: deviationStatusSchema,
  ...unitScopeFieldsShape,
});
export type ParticipationDeviationDoc = z.output<typeof participationDeviationDocSchema>;

export const checklistTemplateItemSchema = z.strictObject({ key: keySchema, label: shortTextSchema });

/** `checklistTemplates/{key}`: an ordered list of items from which a checklist is created. */
export const checklistTemplateDocSchema = documentBaseSchema.extend({
  key: keySchema,
  items: z
    .array(checklistTemplateItemSchema)
    .min(1)
    .max(100)
    .refine((items) => new Set(items.map((item) => item.key)).size === items.length, {
      error: "The items of a template have different keys",
    }),
});
export type ChecklistTemplateDoc = z.output<typeof checklistTemplateDocSchema>;

export const outreachResultCategorySchema = z.enum(["accepted", "declined", "noReply", "other"]);

/**
 * `outreachContacts/{id}`: one row of the historical recruitment correspondence, restricted to
 * the leads of the replication. The three verbatim cells record the first contact, the
 * follow-up and the result. A date that can be read in two ways stays absent, and a reviewer
 * sets the category.
 */
export const outreachContactDocSchema = documentBaseSchema.extend({
  /** Null while the tab the row comes from has not been resolved to a replication. */
  replicationId: idSchema.nullable(),
  laboratoryId: idSchema.exactOptional(),
  personId: idSchema.exactOptional(),
  labNameSource: verbatimSchema.exactOptional(),
  contactNameSource: verbatimSchema.exactOptional(),
  /** Kept as the source wrote it. It is trimmed and lower-cased for matching only. */
  contactEmail: verbatimSchema.exactOptional(),
  firstContactSource: verbatimSchema.exactOptional(),
  firstContactDate: isoDateSchema.exactOptional(),
  followUpSource: verbatimSchema.exactOptional(),
  followUpDate: isoDateSchema.exactOptional(),
  resultSource: verbatimSchema.exactOptional(),
  resultCategory: outreachResultCategorySchema.exactOptional(),
  notes: z.string().max(LIMITS.longText).exactOptional(),
  /** The cell formatting that carries meaning in the source. */
  formatting: z
    .strictObject({
      struckThrough: z.boolean(),
      fillColour: z.string().max(32).exactOptional(),
    })
    .exactOptional(),
  sourceRecordId: idSchema,
  scopeKeys: scopeKeysSchema,
  ...provenanceShape,
});
export type OutreachContactDoc = z.output<typeof outreachContactDocSchema>;
