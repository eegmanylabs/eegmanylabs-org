// Programme, laboratories and equipment (docs/DATA_MODEL.md, section 4).
import { dataOriginSchema } from "../data-origin";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  countryCodeSchema,
  customValuesSchema,
  datePeriodSchema,
  documentBaseSchema,
  freeMapSchema,
  idSchema,
  isoDateSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  provenanceShape,
  shortTextSchema,
  urlSchema,
  verbatimSchema,
} from "./base";

export const programmeKindSchema = z.enum(["programme", "subproject"]);

/** `programmes/{key}`: the programme and its spin-off projects, which are children of the main programme. */
export const programmeDocSchema = documentBaseSchema.extend({
  key: keySchema,
  name: shortTextSchema,
  description: longTextSchema.exactOptional(),
  parentId: idSchema.nullable(),
  kind: programmeKindSchema,
});
export type ProgrammeDoc = z.output<typeof programmeDocSchema>;

export const laboratoryStatusSchema = z.enum(["unverified", "active", "inactive"]);

/** `laboratories/{laboratoryId}`: the one authoritative profile of a laboratory. */
export const laboratoryDocSchema = documentBaseSchema.extend({
  /** Reserved as an identity key. Immutable for clients. */
  slug: keySchema,
  name: shortTextSchema,
  institutionId: idSchema.exactOptional(),
  department: shortTextSchema.exactOptional(),
  countryCode: countryCodeSchema.exactOptional(),
  city: shortTextSchema.exactOptional(),
  website: urlSchema.exactOptional(),
  piPersonId: idSchema.exactOptional(),
  status: laboratoryStatusSchema,
  description: longTextSchema.exactOptional(),
  custom: customValuesSchema,
  dataOrigin: dataOriginSchema,
  ...provenanceShape,
});
export type LaboratoryDoc = z.output<typeof laboratoryDocSchema>;

/** `laboratories/{laboratoryId}/private/detail`: the postal address and internal notes of a laboratory. */
export const laboratoryDetailDocSchema = documentBaseSchema.extend({
  address: z.string().max(2_000).exactOptional(),
  internalNotes: z.string().max(LIMITS.longText).exactOptional(),
});
export type LaboratoryDetailDoc = z.output<typeof laboratoryDetailDocSchema>;

export const laboratoryMemberRoleSchema = z.enum(["pi", "coordinator", "representative", "member"]);
export const laboratoryMemberStatusSchema = z.enum(["proposed", "confirmed", "ended"]);

/**
 * `laboratories/{laboratoryId}/members/{personId}`: a directory fact about a person. Its `role`
 * grants nothing. Only the person concerned or an administrator sets `status` to `confirmed`.
 */
export const laboratoryMemberDocSchema = documentBaseSchema.extend({
  laboratoryId: idSchema,
  personId: idSchema,
  role: laboratoryMemberRoleSchema,
  isAuthorisedRepresentative: z.boolean(),
  startDate: isoDateSchema.exactOptional(),
  endDate: isoDateSchema.exactOptional(),
  earlierPeriods: z.array(datePeriodSchema).max(50),
  status: laboratoryMemberStatusSchema,
  ...provenanceShape,
});
export type LaboratoryMemberDoc = z.output<typeof laboratoryMemberDocSchema>;

/**
 * `laboratories/{laboratoryId}/equipment/{configurationId}`: one equipment configuration. A
 * callable function replaces the current one: it closes it and opens a new configuration that
 * names it in `supersedesId`. A closed configuration never changes.
 */
export const laboratoryEquipmentDocSchema = documentBaseSchema.extend({
  laboratoryId: idSchema,
  name: shortTextSchema,
  isCurrent: z.boolean(),
  validFrom: timestampSchema,
  validTo: timestampSchema.nullable(),
  supersedesId: idSchema.nullable(),
  eegSystemSource: verbatimSchema.exactOptional(),
  amplifierManufacturer: shortTextSchema.exactOptional(),
  amplifierModel: shortTextSchema.exactOptional(),
  capType: shortTextSchema.exactOptional(),
  electrodeType: shortTextSchema.exactOptional(),
  channelCount: z.number().int().min(1).max(4_096).exactOptional(),
  samplingRatesHz: z.array(z.number().int().min(1)).max(50).exactOptional(),
  referenceScheme: shortTextSchema.exactOptional(),
  triggerMethod: shortTextSchema.exactOptional(),
  presentationSoftware: shortTextSchema.exactOptional(),
  stimulusComputer: shortTextSchema.exactOptional(),
  displayRefreshHz: z.number().positive().max(10_000).exactOptional(),
  eyeTracker: shortTextSchema.exactOptional(),
  responseDevices: z.array(shortTextSchema).max(50).exactOptional(),
  other: freeMapSchema.exactOptional(),
  notes: longTextSchema.exactOptional(),
});
export type LaboratoryEquipmentDoc = z.output<typeof laboratoryEquipmentDocSchema>;
