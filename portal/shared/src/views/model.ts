// The model of the view engine (D-011, docs/DATA_MODEL.md, sections 9 and 15): what a property
// is, what a value of each type looks like, and the stored shapes of a property's configuration
// and of a view's configuration. The browser applies a view to the documents it may load, and
// the functions validate with the same schemas whatever they store.
import { entityTypeSchema } from "../entities";
import { idSchema, LIMITS, mapKeySchema, urlSchema } from "../schemas/base";
import type { PropertyType } from "../schemas/workspace";
import { z } from "../zod";

/** A span of dates, either end of which may be open. Each end is an ISO date or an ISO instant. */
export interface DateRangeValue {
  readonly start: string | null;
  readonly end: string | null;
}

/** A link to a file: its name and its web address. */
export interface FileLink {
  readonly name: string;
  readonly url: string;
}

/** A reference from a relation to a record of any collection. */
export interface RecordReference {
  readonly entityType: z.output<typeof entityTypeSchema>;
  readonly entityId: string;
}

/**
 * A value of a property, by type.
 *
 * | Type                                              | Value                                      |
 * |---------------------------------------------------|--------------------------------------------|
 * | `text`, `richText`, `email`, `url`                | A text                                     |
 * | `number`                                          | A finite number                            |
 * | `date`, `createdTime`, `editedTime`               | An ISO date, or an ISO instant             |
 * | `dateRange`                                       | `DateRangeValue`                           |
 * | `checkbox`                                        | A boolean                                  |
 * | `select`, `status`                                | The identifier of an option                |
 * | `multiSelect`                                     | The identifiers of options                 |
 * | `person`, `createdBy`, `editedBy`                 | Uids (one for `createdBy` and `editedBy`)  |
 * | `relation`                                        | `RecordReference`s                         |
 * | `file`                                            | `FileLink`s                                |
 * | `rollup`, `formula`                               | Computed: a number, text, boolean, date or list |
 *
 * An unknown value is null and is never treated as zero.
 */
export type PropertyValue =
  | null
  | string
  | number
  | boolean
  | DateRangeValue
  | readonly string[]
  | readonly RecordReference[]
  | readonly FileLink[]
  | readonly (string | number | boolean)[];

/** One option of a select, a multi-select or a status. */
export const propertyOptionSchema = z.strictObject({
  id: mapKeySchema,
  name: z.string().trim().min(1).max(100),
  /** The group of a status option, which orders a board and counts as complete or not. */
  group: z.enum(["toDo", "inProgress", "complete"]).optional(),
});
export type PropertyOption = z.output<typeof propertyOptionSchema>;

export const ROLLUP_FUNCTIONS = [
  "count",
  "countValues",
  "sum",
  "average",
  "min",
  "max",
  "percentChecked",
  "earliest",
  "latest",
  "showValues",
] as const;
export const rollupFunctionSchema = z.enum(ROLLUP_FUNCTIONS);
export type RollupFunction = z.output<typeof rollupFunctionSchema>;

/** The key of a collection as views address it: `core:<name>` or `db:<databaseId>`. */
export const viewCollectionKeySchema = z
  .string()
  .max(LIMITS.identifier + 5)
  .regex(/^(?:core:[A-Za-z]+|db:[^/]+)$/, { error: "Expected a collection key such as core:replications" });

/**
 * Where a rollup finds its records: through a relation property of its own record, or through
 * the records of another collection whose relation property points back at it (a backlink).
 */
export const rollupSourceSchema = z.union([
  z.strictObject({ relation: mapKeySchema }),
  z.strictObject({ backlink: z.strictObject({ collection: viewCollectionKeySchema, property: mapKeySchema }) }),
]);
export type RollupSource = z.output<typeof rollupSourceSchema>;

export const NUMBER_FORMATS = ["plain", "integer", "decimal", "percent"] as const;

/** The longest formula expression, in characters. */
export const FORMULA_MAX_LENGTH = 2_000;

/**
 * The configuration of a property (`config` of a property definition): the options of a select,
 * a multi-select or a status, the target of a relation, the specification of a rollup, the
 * expression of a formula and the format of a number. Every key is optional, and a key that a
 * type does not use is ignored.
 */
export const propertyConfigSchema = z.strictObject({
  options: z.array(propertyOptionSchema).max(100).optional(),
  relation: z.strictObject({ target: viewCollectionKeySchema }).optional(),
  rollup: z
    .strictObject({ source: rollupSourceSchema, property: mapKeySchema, function: rollupFunctionSchema })
    .optional(),
  formula: z.strictObject({ expression: z.string().max(FORMULA_MAX_LENGTH) }).optional(),
  numberFormat: z.enum(NUMBER_FORMATS).optional(),
  includeTime: z.boolean().optional(),
});
export type PropertyConfig = z.output<typeof propertyConfigSchema>;

/** Where the value of a property is stored, which decides who may change it and how. */
export type PropertySource =
  /** A strict field of a core document, which the view shows and does not change. */
  | "core"
  /** A field of a core document that a client changes under the security rules. */
  | "coreEditable"
  /** The `custom` map of a core document: a custom property whose audience is every member. */
  | "custom"
  /** `private/custom` beneath a core document: a custom property with a restricted audience. */
  | "restricted"
  /** The `title` of a row of a user-created database. */
  | "title"
  /** The `values` map of a row of a user-created database. */
  | "row"
  /** Computed in the browser: a rollup, a formula, or the record of creation and change. */
  | "computed";

/** A property as the engine sees it, whatever its collection. */
export interface ViewProperty {
  /** The key under which its value is held, unique within the collection. */
  readonly id: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly config: PropertyConfig;
  readonly source: PropertySource;
}

/** A record as the engine sees it: its values by property identifier, and the record of its changes. */
export interface ViewRecord {
  readonly id: string;
  /** How a relation names this record. */
  readonly reference: RecordReference;
  readonly values: Readonly<Record<string, PropertyValue>>;
  /** ISO instants. */
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
}

/** The properties and records of one collection, as the browser has loaded them. */
export interface CollectionData {
  readonly key: string;
  readonly label: string;
  readonly titleProperty: string;
  readonly properties: readonly ViewProperty[];
  readonly records: readonly ViewRecord[];
}

// ===== Filters =====

/** A date that a filter compares with: a fixed one, or one relative to today. */
export const filterDateSchema = z.union([
  z.strictObject({ date: z.iso.date() }),
  z.strictObject({ relative: z.enum(["today", "tomorrow", "yesterday"]) }),
  z.strictObject({ daysFromToday: z.number().int().min(-36_500).max(36_500) }),
]);
export type FilterDate = z.output<typeof filterDateSchema>;

/** A window of time relative to today, for the operator `within`. */
export const RELATIVE_WINDOWS = ["pastWeek", "pastMonth", "pastYear", "nextWeek", "nextMonth", "nextYear"] as const;

export const FILTER_OPERATORS = [
  "isEmpty",
  "isNotEmpty",
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "isChecked",
  "isNotChecked",
  "on",
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "within",
  "isAnyOf",
  "isNoneOf",
] as const;
export const filterOperatorSchema = z.enum(FILTER_OPERATORS);
export type FilterOperator = z.output<typeof filterOperatorSchema>;

/** What a condition compares with. Its kind follows the operator. */
export const filterOperandSchema = z.union([
  z.string().max(LIMITS.shortText),
  z.number(),
  z.array(z.string().max(LIMITS.shortText)).max(100),
  filterDateSchema,
  z.strictObject({ window: z.enum(RELATIVE_WINDOWS) }),
]);
export type FilterOperand = z.output<typeof filterOperandSchema>;

export interface FilterCondition {
  readonly kind: "condition";
  readonly property: string;
  readonly operator: FilterOperator;
  readonly value?: FilterOperand | undefined;
}

/** A tree of conditions joined by `and`, `or` and `not`. */
export type FilterNode =
  | { readonly kind: "and"; readonly children: readonly FilterNode[] }
  | { readonly kind: "or"; readonly children: readonly FilterNode[] }
  | { readonly kind: "not"; readonly child: FilterNode }
  | FilterCondition;

/** The deepest a filter tree may nest, and the most nodes it may hold. */
export const FILTER_MAX_DEPTH = 6;
export const FILTER_MAX_NODES = 60;

export function filterDepth(node: FilterNode): number {
  switch (node.kind) {
    case "condition":
      return 1;
    case "not":
      return 1 + filterDepth(node.child);
    default:
      return 1 + Math.max(0, ...node.children.map(filterDepth));
  }
}

export function filterSize(node: FilterNode): number {
  switch (node.kind) {
    case "condition":
      return 1;
    case "not":
      return 1 + filterSize(node.child);
    default:
      return node.children.reduce((total, child) => total + filterSize(child), 1);
  }
}

const filterNodeShape: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    z.strictObject({ kind: z.literal("and"), children: z.array(filterNodeShape).max(FILTER_MAX_NODES) }),
    z.strictObject({ kind: z.literal("or"), children: z.array(filterNodeShape).max(FILTER_MAX_NODES) }),
    z.strictObject({ kind: z.literal("not"), child: filterNodeShape }),
    z.strictObject({
      kind: z.literal("condition"),
      property: mapKeySchema,
      operator: filterOperatorSchema,
      value: filterOperandSchema.optional(),
    }),
  ]),
);

export const filterNodeSchema: z.ZodType<FilterNode> = filterNodeShape.refine(
  (node) => filterDepth(node) <= FILTER_MAX_DEPTH && filterSize(node) <= FILTER_MAX_NODES,
  { error: `A filter nests at most ${FILTER_MAX_DEPTH} deep and holds at most ${FILTER_MAX_NODES} parts` },
);

// ===== Views =====

export const sortSchema = z.strictObject({ property: mapKeySchema, direction: z.enum(["ascending", "descending"]) });
export type ViewSort = z.output<typeof sortSchema>;

export const DATE_GRANULARITIES = ["day", "week", "month", "year"] as const;

export const groupingSchema = z.strictObject({
  property: mapKeySchema,
  /** The keys of the groups that are folded. */
  collapsed: z.array(z.string().max(LIMITS.shortText)).max(200),
  /** How dates are grouped. */
  granularity: z.enum(DATE_GRANULARITIES).optional(),
  hideEmpty: z.boolean().optional(),
});
export type ViewGrouping = z.output<typeof groupingSchema>;

/** The narrowest and the widest a column may be, in pixels. */
export const COLUMN_MIN_WIDTH = 60;
export const COLUMN_MAX_WIDTH = 800;

/**
 * The configuration of a view (`config` of `views/{viewId}`): the filter tree, the sorts, the
 * grouping, the properties shown and their order and widths, the search text, and what the
 * board, the calendar and the timeline are drawn by. Every key is optional.
 */
export const viewConfigSchema = z.strictObject({
  filter: filterNodeSchema.nullable().optional(),
  sorts: z.array(sortSchema).max(5).optional(),
  group: groupingSchema.nullable().optional(),
  /** Properties in the order they are shown. A property not listed follows, in its own order. */
  order: z.array(mapKeySchema).max(250).optional(),
  hidden: z.array(mapKeySchema).max(250).optional(),
  widths: z.record(mapKeySchema, z.number().int().min(COLUMN_MIN_WIDTH).max(COLUMN_MAX_WIDTH)).optional(),
  search: z.string().max(200).optional(),
  /** The select or status property whose options are the columns of a board. */
  boardProperty: mapKeySchema.optional(),
  /** The date or date range property that places a record on the calendar or the timeline. */
  dateProperty: mapKeySchema.optional(),
  /** The date property that ends a bar of the timeline, where `dateProperty` is a single date. */
  endDateProperty: mapKeySchema.optional(),
  /** The relation to a record of the same collection that a list nests a record beneath. */
  parentProperty: mapKeySchema.optional(),
  /** The relation to records of the same collection that a record depends on, drawn as lines on the timeline. */
  dependencyProperty: mapKeySchema.optional(),
  /** The checkbox property that draws a record on the timeline as a milestone: a dated point without duration. */
  milestoneProperty: mapKeySchema.optional(),
});
export type ViewConfig = z.output<typeof viewConfigSchema>;

/** A fixed condition of a view, such as one replication: records whose property holds the value. */
export const viewScopeSchema = z.strictObject({ property: mapKeySchema, value: idSchema });
export type ViewScope = z.output<typeof viewScopeSchema>;

/** A file link as a property stores it. */
export const fileLinkSchema = z.strictObject({ name: z.string().trim().min(1).max(LIMITS.shortText), url: urlSchema });
export const recordReferenceSchema = z.strictObject({ entityType: entityTypeSchema, entityId: idSchema });

/** Whether a value holds nothing: null, an empty text, an empty list or a range without ends. */
export function isEmptyValue(value: PropertyValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const range = value as DateRangeValue;
    return range.start === null && range.end === null;
  }
  return false;
}

export function isDateRange(value: PropertyValue | undefined): value is DateRangeValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "start" in value;
}

/** The types whose values the view computes and nobody types. */
export const COMPUTED_TYPES: readonly PropertyType[] = [
  "rollup",
  "formula",
  "createdTime",
  "editedTime",
  "createdBy",
  "editedBy",
];

/** The types of a property whose value is a date or a range of dates. */
export const DATE_TYPES: readonly PropertyType[] = ["date", "dateRange", "createdTime", "editedTime"];
