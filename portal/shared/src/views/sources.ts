// The collections that views read, in one registry (D-011): the core collections, whose strict
// scientific fields each source exposes as built-in properties, and every user-created database.
// A core source also carries the custom properties of `collectionSchemas`, whose values sit in
// the `custom` map of a document or in its restricted `private/custom`. A custom property never
// takes the place of a core field: a core field with the same identifier wins, and the functions
// refuse such an identifier in the first place.
import { DATA_ORIGINS } from "../data-origin";
import type { EntityType } from "../entities";
import { nestedEntityId } from "../ids";
import { participationStatusSchema, readinessStatusSchema } from "../schemas/participation";
import { laboratoryStatusSchema } from "../schemas/programme";
import { replicationSelectionStatusSchema } from "../schemas/replications";
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
