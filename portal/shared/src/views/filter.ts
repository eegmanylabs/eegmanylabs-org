// Filters of a view: a tree of conditions joined by `and`, `or` and `not`, applied in the
// browser to the records the reader has loaded (D-011). An unknown value matches only the
// operators that ask for an empty value, and never counts as zero.
import type { PropertyType } from "../schemas/workspace";
import {
  type FileLink,
  type FilterCondition,
  type FilterDate,
  type FilterNode,
  type FilterOperand,
  type FilterOperator,
  isDateRange,
  isEmptyValue,
  type PropertyValue,
  type RecordReference,
  type ViewProperty,
  type ViewRecord,
} from "./model";
import { addDays, addMonths, dayOfValue, displayText, type EngineContext, foldText } from "./values";

const TEXT_OPERATORS: readonly FilterOperator[] = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
];
const NUMBER_OPERATORS: readonly FilterOperator[] = [
  "equals",
  "notEquals",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
];
const DATE_OPERATORS: readonly FilterOperator[] = ["on", "before", "after", "onOrBefore", "onOrAfter", "within"];
const OPTION_OPERATORS: readonly FilterOperator[] = ["equals", "notEquals", "isAnyOf", "isNoneOf"];
const LIST_OPERATORS: readonly FilterOperator[] = ["contains", "notContains", "isAnyOf", "isNoneOf"];
const EMPTY_OPERATORS: readonly FilterOperator[] = ["isEmpty", "isNotEmpty"];

/** The operators that a filter on a property of a type offers, in the order a menu lists them. */
export function operatorsFor(type: PropertyType): readonly FilterOperator[] {
  switch (type) {
    case "number":
      return [...NUMBER_OPERATORS, ...EMPTY_OPERATORS];
    case "checkbox":
      return ["isChecked", "isNotChecked"];
    case "date":
    case "dateRange":
    case "createdTime":
    case "editedTime":
      return [...DATE_OPERATORS, ...EMPTY_OPERATORS];
    case "select":
    case "status":
      return [...OPTION_OPERATORS, ...EMPTY_OPERATORS];
    case "multiSelect":
    case "person":
    case "relation":
    case "createdBy":
    case "editedBy":
      return [...LIST_OPERATORS, ...EMPTY_OPERATORS];
    case "file":
      return ["contains", "notContains", ...EMPTY_OPERATORS];
    case "formula":
    case "rollup":
      return [
        ...TEXT_OPERATORS,
        ...NUMBER_OPERATORS.slice(2),
        ...DATE_OPERATORS,
        "isChecked",
        "isNotChecked",
        ...EMPTY_OPERATORS,
      ];
    default:
      return [...TEXT_OPERATORS, ...EMPTY_OPERATORS];
  }
}

/** What an operator compares with, so that the editor of a condition offers the right control. */
export function operandKind(operator: FilterOperator): "none" | "text" | "number" | "date" | "window" | "list" {
  switch (operator) {
    case "isEmpty":
    case "isNotEmpty":
    case "isChecked":
    case "isNotChecked":
      return "none";
    case "lessThan":
    case "lessThanOrEqual":
    case "greaterThan":
    case "greaterThanOrEqual":
      return "number";
    case "on":
    case "before":
    case "after":
    case "onOrBefore":
    case "onOrAfter":
      return "date";
    case "within":
      return "window";
    case "isAnyOf":
    case "isNoneOf":
      return "list";
    default:
      return "text";
  }
}

export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  equals: "is",
  notEquals: "is not",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  lessThan: "is less than",
  lessThanOrEqual: "is at most",
  greaterThan: "is greater than",
  greaterThanOrEqual: "is at least",
  isChecked: "is ticked",
  isNotChecked: "is not ticked",
  on: "is on",
  before: "is before",
  after: "is after",
  onOrBefore: "is on or before",
  onOrAfter: "is on or after",
  within: "is within",
  isAnyOf: "is any of",
  isNoneOf: "is none of",
};

/** The ISO date that a filter date stands for, today being `today`. */
export function resolveFilterDate(operand: FilterDate, today: string): string {
  if ("date" in operand) return operand.date;
  if ("daysFromToday" in operand) return addDays(today, operand.daysFromToday);
  return operand.relative === "today" ? today : addDays(today, operand.relative === "tomorrow" ? 1 : -1);
}

/** The first and last day of a window relative to today, both included. */
export function windowDays(
  window: "pastWeek" | "pastMonth" | "pastYear" | "nextWeek" | "nextMonth" | "nextYear",
  today: string,
): readonly [string, string] {
  switch (window) {
    case "pastWeek":
      return [addDays(today, -7), today];
    case "pastMonth":
      return [addMonths(today, -1), today];
    case "pastYear":
      return [addMonths(today, -12), today];
    case "nextWeek":
      return [today, addDays(today, 7)];
    case "nextMonth":
      return [today, addMonths(today, 1)];
    case "nextYear":
      return [today, addMonths(today, 12)];
  }
}

function isFilterDate(operand: FilterOperand | undefined): operand is FilterDate {
  return (
    typeof operand === "object" &&
    operand !== null &&
    !Array.isArray(operand) &&
    ("date" in operand || "relative" in operand || "daysFromToday" in operand)
  );
}

/** The calendar days a value covers: one for a date, the first and last for a range. */
function daysOf(value: PropertyValue, context: EngineContext): readonly [string, string] | null {
  if (typeof value === "string") {
    const day = dayOfValue(value, context);
    return day === null ? null : [day, day];
  }
  if (isDateRange(value)) {
    const start = value.start === null ? null : dayOfValue(value.start, context);
    const end = value.end === null ? null : dayOfValue(value.end, context);
    const first = start ?? end;
    const last = end ?? start;
    return first === null || last === null ? null : [first, last];
  }
  return null;
}

function matchDate(
  value: PropertyValue,
  operator: FilterOperator,
  operand: FilterOperand | undefined,
  context: EngineContext,
): boolean {
  const days = daysOf(value, context);
  if (days === null) return false;
  const [first, last] = days;
  if (operator === "within") {
    if (typeof operand !== "object" || operand === null || Array.isArray(operand) || !("window" in operand))
      return false;
    const [from, to] = windowDays(operand.window, context.today);
    return last >= from && first <= to;
  }
  if (!isFilterDate(operand)) return false;
  const day = resolveFilterDate(operand, context.today);
  switch (operator) {
    case "on":
      return first <= day && day <= last;
    case "before":
      return first < day;
    case "after":
      return last > day;
    case "onOrBefore":
      return first <= day;
    case "onOrAfter":
      return last >= day;
    default:
      return false;
  }
}

function asNumber(operand: FilterOperand | undefined): number | null {
  if (typeof operand === "number") return operand;
  if (typeof operand === "string" && operand.trim() !== "" && Number.isFinite(Number(operand))) return Number(operand);
  return null;
}

/** The identifiers that a list value holds: options, uids, the identifiers of records, or file names. */
function elementKeys(property: ViewProperty, value: PropertyValue): readonly string[] {
  if (!Array.isArray(value)) return typeof value === "string" ? [value] : [];
  if (property.type === "relation") return (value as readonly RecordReference[]).map((reference) => reference.entityId);
  if (property.type === "file") return (value as readonly FileLink[]).map((file) => file.name);
  return value.map((element) => String(element));
}

function matchCondition(
  condition: FilterCondition,
  property: ViewProperty,
  record: ViewRecord,
  context: EngineContext,
): boolean {
  const value = record.values[property.id] ?? null;
  const { operator, value: operand } = condition;
  if (operator === "isEmpty") return isEmptyValue(value);
  if (operator === "isNotEmpty") return !isEmptyValue(value);
  if (operator === "isChecked") return value === true;
  if (operator === "isNotChecked") return value !== true;
  if (DATE_OPERATORS.includes(operator)) return matchDate(value, operator, operand, context);
  // A negated condition holds for an empty value: an unknown site is not "Leipzig".
  const negated = operator === "notEquals" || operator === "notContains" || operator === "isNoneOf";
  if (isEmptyValue(value)) return negated;

  const listed = Array.isArray(value) || property.type === "select" || property.type === "status";
  if (
    listed &&
    property.type !== "file" &&
    (operator === "isAnyOf" ||
      operator === "isNoneOf" ||
      (Array.isArray(value) && (operator === "contains" || operator === "notContains")))
  ) {
    const keys = elementKeys(property, value);
    const wanted = Array.isArray(operand) ? operand : typeof operand === "string" ? [operand] : [];
    const hit = keys.some((key) => wanted.includes(key));
    return operator === "isAnyOf" || operator === "contains" ? hit : !hit;
  }
  if ((property.type === "select" || property.type === "status") && typeof value === "string") {
    if (operator === "equals") return value === operand;
    if (operator === "notEquals") return value !== operand;
  }
  if (typeof value === "number") {
    const target = asNumber(operand);
    if (target === null) return false;
    switch (operator) {
      case "equals":
        return value === target;
      case "notEquals":
        return value !== target;
      case "lessThan":
        return value < target;
      case "lessThanOrEqual":
        return value <= target;
      case "greaterThan":
        return value > target;
      case "greaterThanOrEqual":
        return value >= target;
      default:
        break;
    }
  }
  if (typeof value === "boolean" && (operator === "equals" || operator === "notEquals")) {
    const target = operand === "true" ? true : operand === "false" ? false : null;
    return target !== null && (operator === "equals" ? value === target : value !== target);
  }
  if (typeof operand !== "string") return false;
  const text = foldText(displayText(property, value, context));
  const wanted = foldText(operand);
  switch (operator) {
    case "equals":
      return text === wanted;
    case "notEquals":
      return text !== wanted;
    case "contains":
      return text.includes(wanted);
    case "notContains":
      return !text.includes(wanted);
    case "startsWith":
      return text.startsWith(wanted);
    case "endsWith":
      return text.endsWith(wanted);
    default:
      return false;
  }
}

/**
 * Whether a record satisfies a filter tree. A condition on a property that no longer exists is
 * left out, so a view whose property was removed shows its records instead of none.
 */
export function matchesFilter(
  node: FilterNode,
  record: ViewRecord,
  properties: ReadonlyMap<string, ViewProperty>,
  context: EngineContext,
): boolean {
  switch (node.kind) {
    case "and":
      return node.children.every((child) => matchesFilter(child, record, properties, context));
    case "or":
      return (
        node.children.length === 0 || node.children.some((child) => matchesFilter(child, record, properties, context))
      );
    case "not":
      return !matchesFilter(node.child, record, properties, context);
    case "condition": {
      const property = properties.get(node.property);
      return property === undefined ? true : matchCondition(node, property, record, context);
    }
  }
}
