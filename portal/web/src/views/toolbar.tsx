// The controls of a view: its filter tree, its sorts, its grouping and the properties it shows.
// Each edits the configuration of the view, which the engine of the shared package applies.
import {
  COMPUTED_TYPES,
  DATE_GRANULARITIES,
  type FilterCondition,
  type FilterNode,
  type FilterOperand,
  type FilterOperator,
  OPERATOR_LABELS,
  operandKind,
  operatorsFor,
  orderedProperties,
  RELATIVE_WINDOWS,
  type ViewConfig,
  type ViewProperty,
} from "@eegml/shared";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const WINDOW_LABELS: Readonly<Record<(typeof RELATIVE_WINDOWS)[number], string>> = {
  pastWeek: "the past week",
  pastMonth: "the past month",
  pastYear: "the past year",
  nextWeek: "the next week",
  nextMonth: "the next month",
  nextYear: "the next year",
};

/** The first operator a new condition on a property takes. */
const firstOperator = (property: ViewProperty): FilterOperator => operatorsFor(property.type)[0] ?? "isNotEmpty";

/** The operand an operator starts with. */
function startingOperand(operator: FilterOperator): FilterOperand | undefined {
  switch (operandKind(operator)) {
    case "none":
      return undefined;
    case "date":
      return { relative: "today" };
    case "window":
      return { window: "nextMonth" };
    case "list":
      return [];
    case "number":
      return 0;
    case "text":
      return "";
  }
}

function ConditionEditor({
  condition,
  properties,
  index,
  onChange,
  onRemove,
}: {
  readonly condition: FilterCondition;
  readonly properties: readonly ViewProperty[];
  readonly index: number;
  readonly onChange: (next: FilterCondition) => void;
  readonly onRemove: () => void;
}) {
  const property = properties.find((candidate) => candidate.id === condition.property);
  const operators = property === undefined ? [condition.operator] : operatorsFor(property.type);
  const kind = operandKind(condition.operator);
  const value = condition.value;
  const options = property?.config.options ?? [];
  const label = `Condition ${index + 1}`;
  let operand: React.ReactNode = null;
  if (kind === "text" || kind === "number") {
    if ((property?.type === "select" || property?.type === "status") && options.length > 0) {
      operand = (
        <Select
          aria-label={`${label}: value`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
        >
          <option value="">Choose</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      );
    } else {
      operand = (
        <Input
          aria-label={`${label}: value`}
          type={kind === "number" ? "number" : "text"}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(event) =>
            onChange({
              ...condition,
              value: kind === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value,
            })
          }
        />
      );
    }
  } else if (kind === "date") {
    const current =
      typeof value === "object" && value !== null && !Array.isArray(value) ? value : { relative: "today" as const };
    const mode =
      "date" in current
        ? "date"
        : "daysFromToday" in current
          ? "days"
          : "relative" in current
            ? current.relative
            : "today";
    operand = (
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label={`${label}: date`}
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            onChange({
              ...condition,
              value:
                next === "date"
                  ? { date: new Date().toISOString().slice(0, 10) }
                  : next === "days"
                    ? { daysFromToday: 7 }
                    : { relative: next as "today" | "tomorrow" | "yesterday" },
            });
          }}
        >
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="yesterday">Yesterday</option>
          <option value="days">Days from today</option>
          <option value="date">A date</option>
        </Select>
        {"date" in current ? (
          <Input
            aria-label={`${label}: the date`}
            type="date"
            value={current.date}
            onChange={(event) => onChange({ ...condition, value: { date: event.target.value } })}
          />
        ) : null}
        {"daysFromToday" in current ? (
          <Input
            aria-label={`${label}: days from today`}
            type="number"
            value={String(current.daysFromToday)}
            onChange={(event) => onChange({ ...condition, value: { daysFromToday: Number(event.target.value) || 0 } })}
          />
        ) : null}
      </div>
    );
  } else if (kind === "window") {
    const current = typeof value === "object" && value !== null && "window" in value ? value.window : "nextMonth";
    operand = (
      <Select
        aria-label={`${label}: period`}
        value={current}
        onChange={(event) =>
          onChange({ ...condition, value: { window: event.target.value as (typeof RELATIVE_WINDOWS)[number] } })
        }
      >
        {RELATIVE_WINDOWS.map((window) => (
          <option key={window} value={window}>
            {WINDOW_LABELS[window]}
          </option>
        ))}
      </Select>
    );
  } else if (kind === "list") {
    const chosen = Array.isArray(value) ? value : [];
    operand =
      options.length > 0 ? (
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="sr-only">{`${label}: values`}</legend>
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={chosen.includes(option.id)}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    value: event.target.checked ? [...chosen, option.id] : chosen.filter((id) => id !== option.id),
                  })
                }
              />
              {option.name}
            </label>
          ))}
        </fieldset>
      ) : (
        <Input
          aria-label={`${label}: values, separated by commas`}
          value={chosen.join(", ")}
          onChange={(event) =>
            onChange({
              ...condition,
              value: event.target.value
                .split(",")
                .map((part) => part.trim())
                .filter((part) => part !== ""),
            })
          }
        />
      );
  }
  return (
    <div className="grid gap-2 rounded-control border border-border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
      <Select
        aria-label={`${label}: property`}
        value={condition.property}
        onChange={(event) => {
          const next = properties.find((candidate) => candidate.id === event.target.value);
          if (next === undefined) return;
          const operator = firstOperator(next);
          const operandValue = startingOperand(operator);
          onChange({
            kind: "condition",
            property: next.id,
            operator,
            ...(operandValue === undefined ? {} : { value: operandValue }),
          });
        }}
      >
        {properties.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label={`${label}: comparison`}
        value={condition.operator}
        onChange={(event) => {
          const operator = event.target.value as FilterOperator;
          const operandValue =
            operandKind(operator) === operandKind(condition.operator) ? condition.value : startingOperand(operator);
          onChange({
            kind: "condition",
            property: condition.property,
            operator,
            ...(operandValue === undefined ? {} : { value: operandValue }),
          });
        }}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {OPERATOR_LABELS[operator]}
          </option>
        ))}
      </Select>
      <div>{operand}</div>
      <Button variant="ghost" size="sm" aria-label={`Remove condition ${index + 1}`} onClick={onRemove}>
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

type Group = { readonly kind: "and" | "or"; readonly children: readonly FilterNode[] };

/** The filter as the editor shows it: a group of conditions and of groups, each of which may be negated. */
function asGroup(node: FilterNode | null | undefined): Group {
  if (node === null || node === undefined) return { kind: "and", children: [] };
  if (node.kind === "and" || node.kind === "or") return node;
  return { kind: "and", children: [node] };
}

function GroupEditor({
  group,
  negated,
  properties,
  depth,
  onChange,
  onNegate,
  onRemove,
}: {
  readonly group: Group;
  readonly negated: boolean;
  readonly properties: readonly ViewProperty[];
  readonly depth: number;
  readonly onChange: (next: Group) => void;
  readonly onNegate?: (negated: boolean) => void;
  readonly onRemove?: () => void;
}) {
  const first = properties[0];
  const replace = (index: number, child: FilterNode | null) =>
    onChange({
      ...group,
      children:
        child === null
          ? group.children.filter((_child, position) => position !== index)
          : group.children.map((existing, position) => (position === index ? child : existing)),
    });
  return (
    <fieldset className="grid gap-2 rounded-control border border-border-strong p-2">
      <legend className="px-1 text-xs text-fg-muted">{depth === 0 ? "Filter" : "Group of conditions"}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={depth === 0 ? "Records must match" : "This group must match"}
          className="w-auto"
          value={group.kind}
          onChange={(event) => onChange({ ...group, kind: event.target.value as "and" | "or" })}
        >
          <option value="and">All of the conditions</option>
          <option value="or">Any of the conditions</option>
        </Select>
        {onNegate === undefined ? null : (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={negated} onChange={(event) => onNegate(event.target.checked)} />
            Exclude what matches
          </label>
        )}
        {onRemove === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove group
          </Button>
        )}
      </div>
      {group.children.map((child, index) => {
        const inner = child.kind === "not" ? child.child : child;
        if (inner.kind === "condition") {
          return (
            <ConditionEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no identity beyond their place
              key={index}
              index={index}
              condition={inner}
              properties={properties}
              onChange={(next) => replace(index, next)}
              onRemove={() => replace(index, null)}
            />
          );
        }
        return (
          <GroupEditor
            // biome-ignore lint/suspicious/noArrayIndexKey: groups have no identity beyond their place
            key={index}
            group={asGroup(inner)}
            negated={child.kind === "not"}
            properties={properties}
            depth={depth + 1}
            onChange={(next) => replace(index, child.kind === "not" ? { kind: "not", child: next } : next)}
            onNegate={(not) => replace(index, not ? { kind: "not", child: asGroup(inner) } : asGroup(inner))}
            onRemove={() => replace(index, null)}
          />
        );
      })}
      {first === undefined ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              const operator = firstOperator(first);
              const operand = startingOperand(operator);
              onChange({
                ...group,
                children: [
                  ...group.children,
                  {
                    kind: "condition",
                    property: first.id,
                    operator,
                    ...(operand === undefined ? {} : { value: operand }),
                  },
                ],
              });
            }}
          >
            <Plus aria-hidden="true" />
            Add a condition
          </Button>
          {depth < 2 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...group, children: [...group.children, { kind: "or", children: [] }] })}
            >
              <Plus aria-hidden="true" />
              Add a group
            </Button>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}

/** The filter of a view as a tree of conditions, with and, or and not. */
export function FilterEditor({
  config,
  properties,
  onChange,
}: {
  readonly config: ViewConfig;
  readonly properties: readonly ViewProperty[];
  readonly onChange: (filter: FilterNode | null) => void;
}) {
  const group = asGroup(config.filter);
  return (
    <div className="grid gap-2">
      <GroupEditor
        group={group}
        negated={false}
        properties={properties}
        depth={0}
        onChange={(next) => onChange(next.children.length === 0 ? null : next)}
      />
      {group.children.length > 0 ? (
        <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => onChange(null)}>
          Clear the filter
        </Button>
      ) : null}
    </div>
  );
}

/** The sorts of a view, applied in their order. */
export function SortEditor({
  config,
  properties,
  onChange,
}: {
  readonly config: ViewConfig;
  readonly properties: readonly ViewProperty[];
  readonly onChange: (sorts: NonNullable<ViewConfig["sorts"]>) => void;
}) {
  const sorts = config.sorts ?? [];
  const unused = properties.filter((property) => !sorts.some((sort) => sort.property === property.id));
  return (
    <div className="grid gap-2">
      {sorts.length === 0 ? <p className="text-fg-muted">Records keep their own order.</p> : null}
      {sorts.map((sort, index) => (
        <div key={sort.property} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">{index === 0 ? "Sort by" : "then by"}</span>
          <Select
            aria-label={`Sort ${index + 1}: property`}
            className="w-auto"
            value={sort.property}
            onChange={(event) =>
              onChange(
                sorts.map((existing, position) =>
                  position === index ? { ...existing, property: event.target.value } : existing,
                ),
              )
            }
          >
            {properties
              .filter((property) => property.id === sort.property || unused.includes(property))
              .map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
          </Select>
          <Select
            aria-label={`Sort ${index + 1}: direction`}
            className="w-auto"
            value={sort.direction}
            onChange={(event) =>
              onChange(
                sorts.map((existing, position) =>
                  position === index
                    ? { ...existing, direction: event.target.value as "ascending" | "descending" }
                    : existing,
                ),
              )
            }
          >
            <option value="ascending">Ascending</option>
            <option value="descending">Descending</option>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove sort ${index + 1}`}
            onClick={() => onChange(sorts.filter((_sort, position) => position !== index))}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      {unused[0] !== undefined && sorts.length < 5 ? (
        <Button
          size="sm"
          className="justify-self-start"
          onClick={() => onChange([...sorts, { property: unused[0]?.id ?? "", direction: "ascending" }])}
        >
          <Plus aria-hidden="true" />
          Add a sort
        </Button>
      ) : null}
    </div>
  );
}

/** The property a view groups its records by, and how dates are grouped. */
export function GroupingEditor({
  config,
  properties,
  onChange,
}: {
  readonly config: ViewConfig;
  readonly properties: readonly ViewProperty[];
  readonly onChange: (group: ViewConfig["group"]) => void;
}) {
  const group = config.group ?? null;
  const groupable = properties.filter((property) => property.type !== "richText" && property.type !== "file");
  const property = properties.find((candidate) => candidate.id === group?.property);
  const isDate = property !== undefined && ["date", "dateRange", "createdTime", "editedTime"].includes(property.type);
  return (
    <div className="grid gap-2">
      <div className="grid gap-1">
        <span className="text-sm font-medium">Group by</span>
        <Select
          aria-label="Group by"
          value={group?.property ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : { property: event.target.value, collapsed: [] })
          }
        >
          <option value="">No grouping</option>
          {groupable.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </div>
      {group !== null && isDate ? (
        <div className="grid gap-1">
          <span className="text-sm font-medium">Dates by</span>
          <Select
            aria-label="Dates by"
            value={group.granularity ?? "month"}
            onChange={(event) =>
              onChange({ ...group, granularity: event.target.value as (typeof DATE_GRANULARITIES)[number] })
            }
          >
            {DATE_GRANULARITIES.map((granularity) => (
              <option key={granularity} value={granularity}>
                {granularity.charAt(0).toUpperCase() + granularity.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {group !== null ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={group.hideEmpty === true}
            onChange={(event) => onChange({ ...group, hideEmpty: event.target.checked })}
          />
          Hide groups without records
        </label>
      ) : null}
    </div>
  );
}

/** Which properties a view shows, and in which order. The title is always shown. */
export function PropertiesEditor({
  config,
  properties,
  titleProperty,
  onChange,
}: {
  readonly config: ViewConfig;
  readonly properties: readonly ViewProperty[];
  readonly titleProperty: string;
  readonly onChange: (next: Pick<ViewConfig, "order" | "hidden">) => void;
}) {
  const ordered = orderedProperties(properties, config);
  const hidden = new Set(config.hidden ?? []);
  const move = (index: number, by: number) => {
    const ids = ordered.map((property) => property.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(Math.max(0, Math.min(ids.length, index + by)), 0, moved);
    onChange({ order: ids, hidden: [...hidden] });
  };
  return (
    <ol className="grid max-h-80 gap-1 overflow-auto">
      {ordered.map((property, index) => {
        const shown = property.id === titleProperty || !hidden.has(property.id);
        return (
          <li key={property.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate">
              {property.name}
              {COMPUTED_TYPES.includes(property.type) ? <span className="text-fg-muted"> (computed)</span> : null}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${property.name} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${property.name} down`}
              disabled={index === ordered.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={shown}
              aria-label={`${shown ? "Hide" : "Show"} ${property.name}`}
              disabled={property.id === titleProperty}
              onClick={() => {
                const next = new Set(hidden);
                if (shown) next.add(property.id);
                else next.delete(property.id);
                onChange({ order: ordered.map((candidate) => candidate.id), hidden: [...next] });
              }}
            >
              {shown ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
