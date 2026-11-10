// The lookup data the application depends on: the programme, the statuses, the participant
// count categories, the onboarding checklist and the contributor roles. Administrators may
// reconfigure most of it afterwards (docs/DATA_MODEL.md, section 1), so these are the values a
// new database starts with and not a copy that code may rely on staying equal.
//
// `seed:lookups` in portal/tools writes `lookupSeedDocuments()` and never overwrites a document
// that already exists.
import type { CollectionKey, DocOf } from "../collections";
import { statusDefinitionId, vocabularyTermId } from "../ids";
import type { documentBaseSchema } from "../schemas/base";
import type { CreditRoleKey } from "../schemas/outputs";
import type { StatusCategory, StatusEntityType } from "../schemas/replications";
import type { z } from "../zod";

/** The key of the programme document. */
export const PROGRAMME_KEY = "eegmanylabs";

export const PROGRAMME_SEED = {
  key: PROGRAMME_KEY,
  name: "#EEGManyLabs",
  kind: "programme",
  parentId: null,
} as const;

export interface StatusSeed {
  readonly key: string;
  readonly label: string;
  readonly category: StatusCategory;
}

/**
 * The statuses of a replication, in order. A replication starts as `proposed`. `archived` is
 * in the category `cancelled`: it closes a replication that is no longer pursued, whereas a
 * replication that has run its course ends as `published`.
 */
export const REPLICATION_STATUSES = [
  { key: "proposed", label: "Proposed", category: "notStarted" },
  { key: "planning", label: "Planning", category: "active" },
  { key: "recruitingLabs", label: "Recruiting labs", category: "active" },
  { key: "sitePreparation", label: "Site preparation", category: "active" },
  { key: "collecting", label: "Collecting", category: "active" },
  { key: "collectionComplete", label: "Collection complete", category: "active" },
  { key: "processing", label: "Processing", category: "active" },
  { key: "analysing", label: "Analysing", category: "active" },
  { key: "writing", label: "Writing", category: "active" },
  { key: "submitted", label: "Submitted", category: "active" },
  { key: "published", label: "Published", category: "done" },
  { key: "paused", label: "Paused", category: "paused" },
  { key: "archived", label: "Archived", category: "cancelled" },
] as const satisfies readonly StatusSeed[];

/**
 * The workflow statuses of a dataset, in order. A dataset starts as `received`, and `flagged`
 * holds it until someone has looked at what was found.
 */
export const DATASET_WORKFLOW_STATUSES = [
  { key: "received", label: "Received", category: "notStarted" },
  { key: "integrityChecked", label: "Integrity checked", category: "active" },
  { key: "bidsValidated", label: "BIDS validated", category: "active" },
  { key: "qcPending", label: "QC pending", category: "active" },
  { key: "qcCompleted", label: "QC completed", category: "active" },
  { key: "accepted", label: "Accepted", category: "active" },
  { key: "flagged", label: "Flagged", category: "paused" },
  { key: "preprocessing", label: "Preprocessing", category: "active" },
  { key: "analysisReady", label: "Analysis ready", category: "done" },
] as const satisfies readonly StatusSeed[];

/** The statuses of a task, in order. A task starts as `toDo`. */
export const TASK_STATUSES = [
  { key: "toDo", label: "To do", category: "notStarted" },
  { key: "inProgress", label: "In progress", category: "active" },
  { key: "blocked", label: "Blocked", category: "paused" },
  { key: "done", label: "Done", category: "done" },
  { key: "cancelled", label: "Cancelled", category: "cancelled" },
] as const satisfies readonly StatusSeed[];

/** The seeded statuses of each kind of record whose statuses are configured as lookup data. */
export const SEEDED_STATUSES = {
  replication: REPLICATION_STATUSES,
  dataset: DATASET_WORKFLOW_STATUSES,
  task: TASK_STATUSES,
} as const satisfies { readonly [T in StatusEntityType]?: readonly StatusSeed[] };

export interface CountCategorySeed {
  readonly key: string;
  readonly label: string;
  /** One sentence that says exactly who is counted. */
  readonly definition: string;
}

/**
 * The eleven core categories of participant counts, in the order a participant passes through
 * them. Each definition names the event that puts a participant into the category, so that
 * neighbouring categories cannot be confused: a laboratory commits to a target, plans, books a
 * session, enrols, tests, holds a recording, sends it, has it confirmed as arrived, has it
 * checked, and has it accepted for analysis or removed from it.
 */
export const COUNT_CATEGORIES = [
  {
    key: "target",
    label: "Target",
    definition:
      "Participants the laboratory has committed to contribute to the replication, as agreed with the replication lead.",
  },
  {
    key: "planned",
    label: "Planned",
    definition:
      "Participants the laboratory expects to test according to its own latest plan, whether or not any session has been arranged.",
  },
  {
    key: "scheduled",
    label: "Scheduled",
    definition: "Participants who have a testing session booked for a named date that has not yet taken place.",
  },
  {
    key: "recruited",
    label: "Recruited",
    definition:
      "Participants who have agreed to take part and have been enrolled by the laboratory, whether or not a session has been booked or held.",
  },
  {
    key: "tested",
    label: "Tested",
    definition:
      "Participants who attended a session and began the experimental procedure, whether or not a complete recording resulted.",
  },
  {
    key: "recorded",
    label: "Recorded",
    definition:
      "Participants for whom the laboratory holds a complete EEG recording of the session on its own storage.",
  },
  {
    key: "submitted",
    label: "Submitted",
    definition:
      "Participants whose recordings the laboratory has sent to the storage location agreed for the replication, whether or not their arrival has been confirmed.",
  },
  {
    key: "received",
    label: "Received",
    definition:
      "Participants whose recordings the replication team has confirmed as arrived at the agreed storage location.",
  },
  {
    key: "validated",
    label: "Validated",
    definition:
      "Participants whose received recordings have passed the integrity and format checks, before any judgement of data quality.",
  },
  {
    key: "usable",
    label: "Usable",
    definition:
      "Participants whose validated recordings passed quality control and the preregistered inclusion criteria, and therefore enter the analysis.",
  },
  {
    key: "excluded",
    label: "Excluded",
    definition:
      "Participants who were tested and whose data were then removed from the analysis under a preregistered exclusion criterion or a quality-control decision.",
  },
] as const satisfies readonly CountCategorySeed[];

/** The key of the onboarding checklist template. */
export const ONBOARDING_TEMPLATE_KEY = "onboarding";

/** The onboarding checklist of a laboratory in a replication, in order. */
export const ONBOARDING_CHECKLIST_TEMPLATE = {
  key: ONBOARDING_TEMPLATE_KEY,
  items: [
    { key: "participationConfirmation", label: "Participation confirmation" },
    { key: "verifiedContacts", label: "Verified contacts" },
    { key: "equipmentConfirmation", label: "Equipment confirmation" },
    { key: "ethics", label: "Ethics" },
    { key: "protocolReview", label: "Protocol review" },
    { key: "training", label: "Training" },
    { key: "technicalChecks", label: "Technical checks" },
    { key: "pilot", label: "Pilot" },
    { key: "readinessApproval", label: "Readiness approval" },
  ],
} as const;

/** The kind of the vocabulary terms that hold the contributor roles. */
export const CREDIT_ROLE_TERM_KIND = "creditRole";

/**
 * The fourteen roles of the Contributor Role Taxonomy (CRediT) with their official names, in
 * the order of the taxonomy. The names are those of the standard and keep its spelling.
 */
export const CREDIT_ROLES = [
  { key: "conceptualization", name: "Conceptualization" },
  { key: "dataCuration", name: "Data curation" },
  { key: "formalAnalysis", name: "Formal analysis" },
  { key: "fundingAcquisition", name: "Funding acquisition" },
  { key: "investigation", name: "Investigation" },
  { key: "methodology", name: "Methodology" },
  { key: "projectAdministration", name: "Project administration" },
  { key: "resources", name: "Resources" },
  { key: "software", name: "Software" },
  { key: "supervision", name: "Supervision" },
  { key: "validation", name: "Validation" },
  { key: "visualization", name: "Visualization" },
  { key: "writingOriginalDraft", name: "Writing – original draft" },
  { key: "writingReviewEditing", name: "Writing – review & editing" },
] as const satisfies readonly { readonly key: CreditRoleKey; readonly name: string }[];

type StandardField = keyof z.output<typeof documentBaseSchema>;

/** The fields of a document that a seed states. The command that writes it adds the standard fields. */
export type SeedData<K extends CollectionKey> = Omit<DocOf<K>, StandardField>;

type SeededCollection =
  | "programmes"
  | "statusDefinitions"
  | "countCategories"
  | "checklistTemplates"
  | "vocabularyTerms";

/** One document of the lookup data: its collection, its identifier and its fields. */
export type LookupSeedDocument = {
  readonly [K in SeededCollection]: { readonly collection: K; readonly id: string; readonly data: SeedData<K> };
}[SeededCollection];

/** Every document of the lookup data, in the order it is written. */
export function lookupSeedDocuments(): readonly LookupSeedDocument[] {
  const statuses = (Object.keys(SEEDED_STATUSES) as (keyof typeof SEEDED_STATUSES)[]).flatMap((entityType) =>
    SEEDED_STATUSES[entityType].map(
      (status, position): LookupSeedDocument => ({
        collection: "statusDefinitions",
        id: statusDefinitionId(entityType, status.key),
        data: { entityType, ...status, position, isDefault: position === 0 },
      }),
    ),
  );
  const categories = COUNT_CATEGORIES.map(
    (category, position): LookupSeedDocument => ({
      collection: "countCategories",
      id: category.key,
      data: { ...category, position, isCore: true },
    }),
  );
  const creditRoles = CREDIT_ROLES.map(
    (role): LookupSeedDocument => ({
      collection: "vocabularyTerms",
      id: vocabularyTermId(CREDIT_ROLE_TERM_KIND, role.name),
      data: {
        sourceId: role.key,
        name: role.name,
        kind: CREDIT_ROLE_TERM_KIND,
        sameAsSource: [],
        labelsSource: [role.name],
        isDeprecated: false,
      },
    }),
  );
  return [
    { collection: "programmes", id: PROGRAMME_SEED.key, data: PROGRAMME_SEED },
    ...statuses,
    ...categories,
    {
      collection: "checklistTemplates",
      id: ONBOARDING_CHECKLIST_TEMPLATE.key,
      data: { key: ONBOARDING_CHECKLIST_TEMPLATE.key, items: [...ONBOARDING_CHECKLIST_TEMPLATE.items] },
    },
    ...creditRoles,
  ];
}
