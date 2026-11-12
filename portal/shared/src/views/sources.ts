// The collections that views read, in one registry (D-011): the core collections, whose strict
// scientific fields each source exposes as built-in properties, and every user-created database.
// A core source also carries the custom properties of `collectionSchemas`, whose values sit in
// the `custom` map of a document or in its restricted `private/custom`. A custom property never
// takes the place of a core field: a core field with the same identifier wins, and the functions
// refuse such an identifier in the first place.
import { DATA_ORIGINS } from "../data-origin";
import { DEFAULT_DATASET_WORKFLOW } from "../datasets/workflow";
import type { EntityType } from "../entities";
import { nestedEntityId } from "../ids";
import { RECRUITMENT_MODALITIES, RECRUITMENT_MODALITY_LABELS } from "../recruitment-effective";
import {
  bidsConversionStatusSchema,
  bidsStatusSchema,
  datasetAvailabilitySchema,
  datasetModalitySchema,
  qcStatusSchema,
} from "../schemas/datasets";
import { participationStatusSchema, readinessStatusSchema } from "../schemas/participation";
import { laboratoryStatusSchema } from "../schemas/programme";
import { reportEntryKindSchema, reportKindSchema } from "../schemas/recruitment";
import { recruitmentBasisSchema, replicationSelectionStatusSchema } from "../schemas/replications";
import { taskKindSchema, taskPrioritySchema } from "../schemas/tasks";
import type { PropertyType } from "../schemas/workspace";
import { isFirestoreTimestamp } from "../timestamp";
import {
  type CollectionData,
  type PropertyConfig,
  type PropertyOption,
  type PropertySource,
  type PropertyValue,
  propertyConfigSchema,
  type RecordReference,
  type ViewConfig,
  type ViewProperty,
  type ViewRecord,
} from "./model";

/** A key as a sentence: `collectionComplete` reads "Collection complete". */
export function sentenceLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const optionsOf = (keys: readonly string[], group?: (key: string) => PropertyOption["group"]): PropertyOption[] =>
  keys.map((key) => {
    const chosen = group?.(key);
    return chosen === undefined
      ? { id: key, name: sentenceLabel(key) }
      : { id: key, name: sentenceLabel(key), group: chosen };
  });

/** What a core source needs beyond the document itself: names and configured statuses. */
export interface SourceLookups {
  readonly laboratoryName: (laboratoryId: string) => string | null;
  /** The statuses of replications as the programme configures them, in order. */
  readonly replicationStatuses: readonly { readonly key: string; readonly label: string }[];
  /** The statuses of tasks as the programme configures them, in order, with their category. */
  readonly taskStatuses?: readonly { readonly key: string; readonly label: string; readonly category: string }[];
  /** The task lists the reader may read, for the list a task belongs to. */
  readonly taskLists?: readonly { readonly id: string; readonly name: string }[];
  /** The shared tags, for the tags of a task. */
  readonly tags?: readonly { readonly id: string; readonly name: string }[];
  /** The categories of participant counts that are in use, in order, for the counts of recruitment. */
  readonly countCategories?: readonly { readonly key: string; readonly label: string }[];
  /** The states of the workflows of datasets in use, in order, with their category. */
  readonly datasetStatuses?: readonly { readonly key: string; readonly label: string; readonly category: string }[];
}

/** A built-in property of a core source, and how its value is read from a document. */
export interface CoreField extends ViewProperty {
  readonly read: (document: Readonly<Record<string, unknown>>, id: string, lookups: SourceLookups) => PropertyValue;
}

export const CORE_SOURCE_KEYS = [
  "core:replications",
  "core:persons",
  "core:laboratories",
  "core:participations",
  "core:checklistItems",
  "core:tasks",
  "core:recruitmentReports",
  "core:recruitment",
  "core:datasets",
] as const;
export type CoreSourceKey = (typeof CORE_SOURCE_KEYS)[number];

export interface CoreSource {
  readonly key: CoreSourceKey;
  readonly label: string;
  /** Whether a person may choose the source for a view, or whether it only feeds rollups. */
  readonly selectable: boolean;
  /** The kind of record, which relations name. */
  readonly entityType: EntityType;
  readonly titleProperty: string;
  /** The `collectionSchemas` document of the custom properties, or null where the source takes none. */
  readonly customKey: string | null;
  readonly fields: (lookups: SourceLookups) => readonly CoreField[];
  /** How a relation names a record of the source. */
  readonly reference: (id: string, document: Readonly<Record<string, unknown>>) => RecordReference;
  /** The view that a source opens with. */
  readonly defaultConfig: ViewConfig;
}

const text = (value: unknown): PropertyValue => (typeof value === "string" && value !== "" ? value : null);
const numeric = (value: unknown): PropertyValue => (typeof value === "number" && Number.isFinite(value) ? value : null);
const flag = (value: unknown): PropertyValue => (typeof value === "boolean" ? value : null);
const references = (entityType: EntityType, value: unknown): PropertyValue => {
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : typeof value === "string"
      ? [value]
      : [];
  return ids.length === 0 ? null : ids.map((entityId) => ({ entityType, entityId }));
};

/** An instant of a stored document as ISO text. */
export function instantText(value: unknown): string | null {
  return isFirestoreTimestamp(value) ? new Date(value.toMillis()).toISOString() : null;
}

function field(
  id: string,
  name: string,
  type: PropertyType,
  read: CoreField["read"],
  options: { readonly config?: PropertyConfig; readonly source?: PropertySource } = {},
): CoreField {
  return { id, name, type, config: options.config ?? {}, source: options.source ?? "core", read };
}

/** The group of a status option of a task, from the category of its status definition. */
const TASK_STATUS_GROUPS: Readonly<Record<string, PropertyOption["group"]>> = {
  notStarted: "toDo",
  active: "inProgress",
  paused: "inProgress",
  done: "complete",
  cancelled: "complete",
};

const uids = (value: unknown): PropertyValue => {
  const list = Array.isArray(value) ? value.filter((uid): uid is string => typeof uid === "string") : [];
  return list.length === 0 ? null : list;
};

const dataOrigin = () =>
  field("dataOrigin", "Origin of the data", "select", (document) => text(document.dataOrigin), {
    config: { options: optionsOf(DATA_ORIGINS) },
  });

const PARTICIPATION_STATUS_GROUPS: Readonly<Record<string, PropertyOption["group"]>> = {
  invited: "toDo",
  interested: "toDo",
  confirmed: "inProgress",
  onboarding: "inProgress",
  ready: "inProgress",
  collecting: "inProgress",
  collectionComplete: "complete",
  withdrawn: "complete",
  declined: "complete",
};

/** The identifier of the property of one count: the modality, an underscore and the category key. */
export function countPropertyId(modality: string, category: string): string {
  return `${modality}_${category}`;
}

/**
 * One number property for each modality and category, labelled apart, so that a view shows
 * main experiment, resting state and unique participants side by side and never adds them.
 */
function countFields(
  lookups: SourceLookups,
  read: (document: Readonly<Record<string, unknown>>, modality: string, category: string) => PropertyValue,
): CoreField[] {
  return (lookups.countCategories ?? []).flatMap((category) =>
    RECRUITMENT_MODALITIES.map((modality) =>
      field(
        countPropertyId(modality, category.key),
        `${category.label}, ${RECRUITMENT_MODALITY_LABELS[modality].toLowerCase()}`,
        "number",
        (document) => read(document, modality, category.key),
        { config: { numberFormat: "integer" } },
      ),
    ),
  );
}

/** A count of a report, or null where the report does not state it. */
function reportCount(document: Readonly<Record<string, unknown>>, modality: string, category: string): PropertyValue {
  const counts = document.counts as Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> | undefined;
  return numeric(counts?.[modality]?.[category]);
}

/** An effective value of the state of a participation, or null where it is unknown. */
function effectiveCount(
  document: Readonly<Record<string, unknown>>,
  modality: string,
  category: string,
): PropertyValue {
  const effective = document.effective as
    | Readonly<Record<string, Readonly<Record<string, { readonly value?: unknown } | undefined>> | undefined>>
    | undefined;
  return numeric(effective?.[modality]?.[category]?.value);
}

/** The counts that a view of recruitment shows before a person chooses: tested and usable. */
const DEFAULT_COUNT_CATEGORIES: ReadonlySet<string> = new Set(["tested", "usable"]);

/** The counts that a new view of recruitment hides, so that it opens with tested and usable alone. */
export function hiddenRecruitmentCounts(lookups: SourceLookups): string[] {
  return (lookups.countCategories ?? [])
    .filter((category) => !DEFAULT_COUNT_CATEGORIES.has(category.key))
    .flatMap((category) => RECRUITMENT_MODALITIES.map((modality) => countPropertyId(modality, category.key)));
}

/** The value of the list of a task whose list its reader may not open. */
export const UNREADABLE_LIST = "unreadableList";

/** The basis of the effective values of a participation: reported, verified, both or none. */
export const EFFECTIVE_BASIS_OPTIONS = ["reported", "verified", "mixed"] as const;

/** The core sources. Their order is the order a person chooses from. */
export const CORE_SOURCES: Readonly<Record<CoreSourceKey, CoreSource>> = {
  "core:replications": {
    key: "core:replications",
    label: "Replications",
    selectable: true,
    entityType: "replication",
    titleProperty: "studyKey",
    customKey: "core:replications",
    reference: (id) => ({ entityType: "replication", entityId: id }),
    fields: (lookups) => [
      field("studyKey", "Study", "text", (document) => text(document.studyKey)),
      field("shortTitle", "Short title", "text", (document) => text(document.shortTitle)),
      field("status", "Status", "status", (document) => text(document.statusKey), {
        config: { options: lookups.replicationStatuses.map((status) => ({ id: status.key, name: status.label })) },
      }),
      field("theme", "Theme", "text", (document) => text(document.theme)),
      field("selectionStatus", "Selection", "select", (document) => text(document.selectionStatus), {
        config: { options: optionsOf(replicationSelectionStatusSchema.options) },
      }),
      field("publicStageName", "Public stage", "text", (document) => text(document.publicStageName)),
      field("signupActive", "Sign-up open", "checkbox", (document) => flag(document.signupActive)),
      field("targetN", "Target participants", "number", (document) => numeric(document.targetN)),
      field("leads", "Leads", "relation", (document) => references("person", document.leadPersonIds), {
        config: { relation: { target: "core:persons" } },
      }),
      dataOrigin(),
    ],
    defaultConfig: { sorts: [{ property: "studyKey", direction: "ascending" }] },
  },
  "core:persons": {
    key: "core:persons",
    label: "Members",
    selectable: true,
    entityType: "person",
    titleProperty: "displayName",
    customKey: "core:persons",
    reference: (id) => ({ entityType: "person", entityId: id }),
    fields: () => [
      field("displayName", "Name", "text", (document) => text(document.displayName)),
      field("affiliationSummary", "Affiliation", "text", (document) => text(document.affiliationSummary)),
      field("countryCode", "Country", "text", (document) => text(document.countryCode)),
      field("isCoreTeam", "Core team", "checkbox", (document) => flag(document.isCoreTeam)),
      field(
        "laboratories",
        "Laboratories",
        "relation",
        (document) => references("laboratory", document.laboratoryIds),
        {
          config: { relation: { target: "core:laboratories" } },
        },
      ),
      field(
        "replications",
        "Replications",
        "relation",
        (document) => references("replication", document.replicationIds),
        {
          config: { relation: { target: "core:replications" } },
        },
      ),
    ],
    defaultConfig: { sorts: [{ property: "displayName", direction: "ascending" }] },
  },
  "core:laboratories": {
    key: "core:laboratories",
    label: "Laboratories",
    selectable: true,
    entityType: "laboratory",
    titleProperty: "name",
    customKey: "core:laboratories",
    reference: (id) => ({ entityType: "laboratory", entityId: id }),
    fields: () => [
      field("name", "Name", "text", (document) => text(document.name)),
      field("status", "Status", "select", (document) => text(document.status), {
        config: { options: optionsOf(laboratoryStatusSchema.options) },
      }),
      field("countryCode", "Country", "text", (document) => text(document.countryCode)),
      field("city", "City", "text", (document) => text(document.city)),
      field("website", "Website", "url", (document) => text(document.website)),
      field(
        "principalInvestigator",
        "Principal investigator",
        "relation",
        (document) => references("person", document.piPersonId),
        { config: { relation: { target: "core:persons" } } },
      ),
      field("participations", "Participations", "rollup", () => null, {
        config: {
          rollup: {
            source: { backlink: { collection: "core:participations", property: "laboratory" } },
            property: "participation",
            function: "count",
          },
        },
        source: "computed",
      }),
      dataOrigin(),
    ],
    defaultConfig: { sorts: [{ property: "name", direction: "ascending" }] },
  },
  "core:participations": {
    key: "core:participations",
    label: "Participations",
    selectable: true,
    entityType: "participation",
    titleProperty: "participation",
    customKey: "core:participations",
    reference: (id) => ({ entityType: "participation", entityId: id }),
    fields: (lookups) => [
      field("participation", "Participation", "text", (document) => {
        const replication = text(document.replicationId);
        const laboratoryId = typeof document.laboratoryId === "string" ? document.laboratoryId : "";
        return `${replication ?? ""} at ${lookups.laboratoryName(laboratoryId) ?? laboratoryId}`;
      }),
      field("replication", "Replication", "relation", (document) => references("replication", document.replicationId), {
        config: { relation: { target: "core:replications" } },
      }),
      field("laboratory", "Laboratory", "relation", (document) => references("laboratory", document.laboratoryId), {
        config: { relation: { target: "core:laboratories" } },
      }),
      field("status", "Status", "status", (document) => text(document.status), {
        config: { options: optionsOf(participationStatusSchema.options, (key) => PARTICIPATION_STATUS_GROUPS[key]) },
      }),
      field("readinessStatus", "Readiness", "select", (document) => text(document.readinessStatus), {
        config: { options: optionsOf(readinessStatusSchema.options) },
      }),
      field("targetNMain", "Target, main experiment", "number", (document) => numeric(document.targetNMain), {
        source: "coreEditable",
        config: { numberFormat: "integer" },
      }),
      field("targetNRest", "Target, resting state", "number", (document) => numeric(document.targetNRest), {
        source: "coreEditable",
        config: { numberFormat: "integer" },
      }),
      field("signedUpAt", "Signed up", "date", (document) => instantText(document.signedUpAt)),
      field("localLead", "Local lead", "relation", (document) => references("person", document.localLeadPersonId), {
        config: { relation: { target: "core:persons" } },
      }),
      field("checklistCompletion", "Checklist completion", "rollup", () => null, {
        config: {
          rollup: {
            source: { backlink: { collection: "core:checklistItems", property: "participation" } },
            property: "done",
            function: "percentChecked",
          },
          numberFormat: "percent",
        },
        source: "computed",
      }),
      dataOrigin(),
    ],
    defaultConfig: { sorts: [{ property: "participation", direction: "ascending" }] },
  },
  "core:checklistItems": {
    key: "core:checklistItems",
    label: "Onboarding checklist items",
    selectable: false,
    entityType: "participation",
    titleProperty: "label",
    customKey: null,
    // Nothing links to an item of a checklist: it is named beneath its participation.
    reference: (id, document) => ({
      entityType: "participation",
      entityId: nestedEntityId(typeof document.participationId === "string" ? document.participationId : "", id),
    }),
    fields: () => [
      field("label", "Item", "text", (document) => text(document.label)),
      field(
        "participation",
        "Participation",
        "relation",
        (document) => references("participation", document.participationId),
        { config: { relation: { target: "core:participations" } } },
      ),
      field("itemStatus", "Status", "select", (document) => text(document.status)),
      // Done or not, and unknown for an item that does not apply, which completion leaves out.
      field("done", "Done", "checkbox", (document) =>
        document.status === "notApplicable" ? null : document.status === "done",
      ),
      field("completedAt", "Completed", "date", (document) => instantText(document.completedAt)),
    ],
    defaultConfig: {},
  },
  "core:tasks": {
    key: "core:tasks",
    label: "Tasks",
    selectable: true,
    entityType: "task",
    titleProperty: "title",
    // Custom properties of tasks wait for the restricted values of tasks, whose rules are not written.
    customKey: null,
    reference: (id) => ({ entityType: "task", entityId: id }),
    fields: (lookups) => [
      field("title", "Task", "text", (document) => text(document.title), { source: "coreEditable" }),
      field("status", "Status", "status", (document) => text(document.statusKey), {
        source: "coreEditable",
        config: {
          options: (lookups.taskStatuses ?? []).map((status) => {
            const group = TASK_STATUS_GROUPS[status.category];
            return group === undefined
              ? { id: status.key, name: status.label }
              : { id: status.key, name: status.label, group };
          }),
        },
      }),
      // A task that its reader reads as a participant may sit in a list they may not open: its
      // identifier is never shown, only that the list is closed to them.
      field(
        "list",
        "List",
        "select",
        (document) => {
          const listId = text(document.listId);
          return listId !== null && (lookups.taskLists ?? []).some((list) => list.id === listId)
            ? listId
            : UNREADABLE_LIST;
        },
        {
          config: {
            options: [
              ...(lookups.taskLists ?? []).map((list) => ({ id: list.id, name: list.name })),
              { id: UNREADABLE_LIST, name: "A list you may not open" },
            ],
          },
        },
      ),
      field("kind", "Kind", "select", (document) => text(document.kind), {
        config: { options: optionsOf(taskKindSchema.options) },
      }),
      field("milestone", "Milestone", "checkbox", (document) => document.kind === "milestone"),
      field("priority", "Priority", "select", (document) => text(document.priority), {
        source: "coreEditable",
        config: { options: optionsOf(taskPrioritySchema.options) },
      }),
      field("assignees", "Assignees", "person", (document) => uids(document.assigneeUids), {
        source: "coreEditable",
      }),
      field("collaborators", "Collaborators", "person", (document) => uids(document.collaboratorUids)),
      field("startAt", "Start", "date", (document) => instantText(document.startAt), { source: "coreEditable" }),
      field("dueAt", "Due", "date", (document) => instantText(document.dueAt), { source: "coreEditable" }),
      field("completedAt", "Completed", "date", (document) => instantText(document.completedAt)),
      // Kept under its stored name, so that saved views still find it, and shown in hours as the task panel shows it.
      field(
        "estimateMinutes",
        "Estimate in hours",
        "number",
        (document) => {
          const minutes = document.estimateMinutes;
          return typeof minutes === "number" && Number.isFinite(minutes)
            ? Math.round((minutes / 60) * 100) / 100
            : null;
        },
        { source: "coreEditable", config: { numberFormat: "decimal" } },
      ),
      field("progressPercent", "Progress in per cent", "number", (document) => numeric(document.progressPercent), {
        source: "coreEditable",
        config: { numberFormat: "integer" },
      }),
      field("parent", "Parent task", "relation", (document) => references("task", document.parentId), {
        config: { relation: { target: "core:tasks" } },
      }),
      field(
        "dependsOn",
        "Depends on",
        "relation",
        (document) =>
          references(
            "task",
            typeof document.dependsOn === "object" && document.dependsOn !== null
              ? Object.keys(document.dependsOn)
              : [],
          ),
        { config: { relation: { target: "core:tasks" } } },
      ),
      field("replication", "Replication", "relation", (document) => references("replication", document.replicationId), {
        config: { relation: { target: "core:replications" } },
      }),
      field("laboratory", "Laboratory", "relation", (document) => references("laboratory", document.laboratoryId), {
        config: { relation: { target: "core:laboratories" } },
      }),
      field("tags", "Tags", "multiSelect", (document) => uids(document.tagIds), {
        source: "coreEditable",
        config: { options: (lookups.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name })) },
      }),
      field("recurrence", "Repeats", "text", (document) => text(document.recurrenceRule)),
    ],
    defaultConfig: {
      sorts: [{ property: "dueAt", direction: "ascending" }],
      boardProperty: "status",
      dateProperty: "dueAt",
      parentProperty: "parent",
      dependencyProperty: "dependsOn",
      milestoneProperty: "milestone",
    },
  },
  "core:recruitmentReports": {
    key: "core:recruitmentReports",
    label: "Recruitment reports",
    selectable: true,
    entityType: "recruitmentReport",
    titleProperty: "report",
    customKey: null,
    reference: (id) => ({ entityType: "recruitmentReport", entityId: id }),
    fields: (lookups) => [
      field("report", "Report", "text", (document) => {
        const laboratoryId = typeof document.laboratoryId === "string" ? document.laboratoryId : "";
        return `${text(document.replicationId) ?? ""} at ${lookups.laboratoryName(laboratoryId) ?? laboratoryId}, ${text(document.asOfDate) ?? ""}`;
      }),
      field(
        "participation",
        "Participation",
        "relation",
        (document) => references("participation", document.participationId),
        { config: { relation: { target: "core:participations" } } },
      ),
      field("replication", "Replication", "relation", (document) => references("replication", document.replicationId), {
        config: { relation: { target: "core:replications" } },
      }),
      field("laboratory", "Laboratory", "relation", (document) => references("laboratory", document.laboratoryId), {
        config: { relation: { target: "core:laboratories" } },
      }),
      field("asOfDate", "As of", "date", (document) => text(document.asOfDate)),
      field("reportKind", "Kind", "select", (document) => text(document.reportKind), {
        config: { options: optionsOf(reportKindSchema.options) },
      }),
      field("basis", "Basis", "select", (document) => text(document.basis), {
        config: {
          options: recruitmentBasisSchema.options.map((key) => ({
            id: key,
            name: key === "labReported" ? "Reported" : "Verified",
          })),
        },
      }),
      field("entryKind", "Entry", "select", (document) => text(document.entryKind), {
        config: { options: optionsOf(reportEntryKindSchema.options) },
      }),
      field(
        "corrects",
        "Replaces",
        "relation",
        (document) => references("recruitmentReport", document.correctsReportId),
        { config: { relation: { target: "core:recruitmentReports" } } },
      ),
      ...countFields(lookups, reportCount),
      field("note", "Note", "text", (document) => text(document.note)),
      field("filedAt", "Filed", "date", (document) => instantText(document.createdAt)),
      dataOrigin(),
    ],
    defaultConfig: {
      sorts: [{ property: "asOfDate", direction: "descending" }],
      dateProperty: "asOfDate",
      boardProperty: "basis",
    },
  },
  "core:recruitment": {
    key: "core:recruitment",
    label: "Recruitment by participation",
    selectable: true,
    entityType: "participation",
    titleProperty: "participation",
    customKey: null,
    // One record for each participation, holding the values that hold today: the effective
    // values of its reports, verified where available, which the browser resolves.
    reference: (id) => ({ entityType: "participation", entityId: id }),
    fields: (lookups) => [
      field("participation", "Participation", "text", (document) => {
        const laboratoryId = typeof document.laboratoryId === "string" ? document.laboratoryId : "";
        return `${text(document.replicationId) ?? ""} at ${lookups.laboratoryName(laboratoryId) ?? laboratoryId}`;
      }),
      field("replication", "Replication", "relation", (document) => references("replication", document.replicationId), {
        config: { relation: { target: "core:replications" } },
      }),
      field("laboratory", "Laboratory", "relation", (document) => references("laboratory", document.laboratoryId), {
        config: { relation: { target: "core:laboratories" } },
      }),
      field("status", "Status", "status", (document) => text(document.status), {
        config: { options: optionsOf(participationStatusSchema.options, (key) => PARTICIPATION_STATUS_GROUPS[key]) },
      }),
      field("latestAsOfDate", "Latest report", "date", (document) => text(document.latestAsOfDate)),
      field("basis", "Basis", "select", (document) => text(document.basis), {
        config: { options: optionsOf(EFFECTIVE_BASIS_OPTIONS) },
      }),
      ...countFields(lookups, effectiveCount),
    ],
    defaultConfig: {
      sorts: [{ property: "participation", direction: "ascending" }],
      boardProperty: "status",
    },
  },
  "core:datasets": {
    key: "core:datasets",
    label: "Datasets",
    selectable: true,
    entityType: "dataset",
    titleProperty: "datasetKey",
    // The custom values of a dataset are not built, so the source takes no custom properties.
    customKey: null,
    reference: (id) => ({ entityType: "dataset", entityId: id }),
    fields: (lookups) => [
      field("datasetKey", "Dataset", "text", (document) => text(document.datasetKey)),
      field("title", "Title", "text", (document) => text(document.title)),
      field("replication", "Replication", "relation", (document) => references("replication", document.replicationId), {
        config: { relation: { target: "core:replications" } },
      }),
      field("laboratory", "Laboratory", "relation", (document) => references("laboratory", document.laboratoryId), {
        config: { relation: { target: "core:laboratories" } },
      }),
      field("modality", "Modality", "select", (document) => text(document.modality), {
        config: { options: optionsOf(datasetModalitySchema.options) },
      }),
      field("groupingLabel", "Session or grouping", "text", (document) => text(document.groupingLabel)),
      field("status", "Workflow state", "status", (document) => text(document.workflowStatusKey), {
        config: {
          options: (lookups.datasetStatuses ?? DEFAULT_DATASET_WORKFLOW.states).map((status) => ({
            id: status.key,
            name: status.label,
            group: TASK_STATUS_GROUPS[status.category] ?? "inProgress",
          })),
        },
      }),
      field("bidsConversionStatus", "BIDS conversion", "select", (document) => text(document.bidsConversionStatus), {
        config: { options: optionsOf(bidsConversionStatusSchema.options) },
      }),
      field("bidsStatus", "BIDS validation", "select", (document) => text(document.bidsStatus), {
        config: { options: optionsOf(bidsStatusSchema.options) },
      }),
      field("qcStatus", "QC", "select", (document) => text(document.qcStatus), {
        config: { options: optionsOf(qcStatusSchema.options) },
      }),
      field("analysisReady", "Analysis ready", "checkbox", (document) => flag(document.analysisReady)),
      field("availability", "Availability", "select", (document) => text(document.availability), {
        config: { options: optionsOf(datasetAvailabilitySchema.options) },
      }),
      field("lastSeenAt", "Last seen", "date", (document) => instantText(document.lastSeenAt)),
      field("receivedAt", "Received", "date", (document) => instantText(document.receivedAt)),
      field("expectedFileCount", "Expected files", "number", (document) => numeric(document.expectedFileCount)),
      field("receivedFileCount", "Received files", "number", (document) => numeric(document.receivedFileCount)),
      dataOrigin(),
    ],
    defaultConfig: {
      sorts: [{ property: "datasetKey", direction: "ascending" }],
      boardProperty: "status",
    },
  },
};

export function isCoreSourceKey(key: string): key is CoreSourceKey {
  return (CORE_SOURCE_KEYS as readonly string[]).includes(key);
}

/** The identifier of the database a collection key names, or null for a core source. */
export function databaseIdOf(collectionKey: string): string | null {
  return collectionKey.startsWith("db:") ? collectionKey.slice(3) : null;
}

/** A stored custom property definition, as `collectionSchemas` or a database holds it. */
export interface StoredPropertyDefinition {
  readonly key: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly config: Readonly<Record<string, unknown>>;
  readonly order: string;
  readonly archivedAt: unknown;
  readonly audience?: "member" | "restricted";
}

/** The current properties of a map of definitions, in their order, with configurations that parse. */
export function definedProperties(
  definitions: Readonly<Record<string, StoredPropertyDefinition>>,
  source: (definition: StoredPropertyDefinition) => PropertySource,
  reserved: ReadonlySet<string> = new Set(),
): ViewProperty[] {
  return Object.entries(definitions)
    .filter(([id, definition]) => definition.archivedAt === null && !reserved.has(id))
    .sort(([, a], [, b]) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map(([id, definition]) => {
      const config = propertyConfigSchema.safeParse(definition.config);
      return {
        id,
        name: definition.name,
        type: definition.type,
        config: config.success ? config.data : {},
        source: source(definition),
      };
    });
}

const COMPUTED_SOURCE = new Set<PropertyType>([
  "rollup",
  "formula",
  "createdTime",
  "editedTime",
  "createdBy",
  "editedBy",
]);

/** The record of creation and change of a stored document. */
function changeRecord(document: Readonly<Record<string, unknown>>) {
  return {
    createdAt: instantText(document.createdAt),
    updatedAt: instantText(document.updatedAt),
    createdBy: typeof document.createdBy === "string" ? document.createdBy : null,
    updatedBy: typeof document.updatedBy === "string" ? document.updatedBy : null,
  };
}

/** A core document, with its custom values, as a record of a view. */
export interface CoreDocument {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
  /** The values of `private/custom`, where the reader may read them. */
  readonly restricted?: Readonly<Record<string, unknown>>;
}

/**
 * The properties and records of a core source. The custom properties follow the built-in ones,
 * and a value that the custom map holds under the identifier of a built-in property is ignored.
 */
export function coreCollection(
  source: CoreSource,
  documents: readonly CoreDocument[],
  customDefinitions: Readonly<Record<string, StoredPropertyDefinition>>,
  lookups: SourceLookups,
): CollectionData {
  const fields = source.fields(lookups);
  const reserved = new Set(fields.map((candidate) => candidate.id));
  const custom = definedProperties(
    customDefinitions,
    (definition) =>
      COMPUTED_SOURCE.has(definition.type)
        ? "computed"
        : definition.audience === "restricted"
          ? "restricted"
          : "custom",
    reserved,
  );
  const records: ViewRecord[] = documents.map((document) => {
    const values: Record<string, PropertyValue> = {};
    const customMap = (document.data.custom ?? {}) as Readonly<Record<string, unknown>>;
    for (const property of custom) {
      const from = property.source === "restricted" ? document.restricted : customMap;
      const value = from?.[property.id];
      if (value !== undefined) values[property.id] = value as PropertyValue;
    }
    for (const builtIn of fields) values[builtIn.id] = builtIn.read(document.data, document.id, lookups);
    return {
      id: document.id,
      reference: source.reference(document.id, document.data),
      values,
      ...changeRecord(document.data),
    };
  });
  return {
    key: source.key,
    label: source.label,
    titleProperty: source.titleProperty,
    properties: [...fields.map(({ read: _read, ...property }) => property), ...custom],
    records,
  };
}

/** The identifier of the title of every database. */
export const DATABASE_TITLE_PROPERTY = "title";

/** A database and its rows, as a collection of views. */
export function databaseCollection(
  databaseId: string,
  database: { readonly name: string; readonly properties: Readonly<Record<string, StoredPropertyDefinition>> },
  rows: readonly { readonly id: string; readonly data: Readonly<Record<string, unknown>> }[],
): CollectionData {
  const properties: ViewProperty[] = [
    { id: DATABASE_TITLE_PROPERTY, name: "Name", type: "text", config: {}, source: "title" },
    ...definedProperties(
      database.properties,
      (definition) => (COMPUTED_SOURCE.has(definition.type) ? "computed" : "row"),
      new Set([DATABASE_TITLE_PROPERTY]),
    ),
  ];
  return {
    key: `db:${databaseId}`,
    label: database.name,
    titleProperty: DATABASE_TITLE_PROPERTY,
    properties,
    records: rows
      .filter((row) => row.data.archivedAt === null || row.data.archivedAt === undefined)
      .map((row) => {
        const stored = (row.data.values ?? {}) as Readonly<Record<string, PropertyValue>>;
        return {
          id: row.id,
          reference: { entityType: "databaseRow", entityId: nestedEntityId(databaseId, row.id) },
          values: { ...stored, [DATABASE_TITLE_PROPERTY]: text(row.data.title) },
          ...changeRecord(row.data),
        };
      }),
  };
}
