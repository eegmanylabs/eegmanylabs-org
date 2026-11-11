// Adds a property to a collection, or changes one: its name, its options, the target of a
// relation, what a rollup reads, the expression of a formula, and, for a core collection, who
// may read its values. The function that stores it checks everything again.
import {
  CORE_SOURCE_KEYS,
  CORE_SOURCES,
  FORMULA_FUNCTIONS,
  NUMBER_FORMATS,
  PROPERTY_TYPE_LABELS,
  type PropertyConfig,
  type PropertyOption,
  type PropertyType,
  propertyTypeSchema,
  ROLLUP_FUNCTIONS,
  type RollupFunction,
  savePropertyContract,
  type ViewProperty,
} from "@eegml/shared";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CallableError, callFunction } from "@/data";
import type { ViewData } from "./use-view-data";

const ROLLUP_LABELS: Readonly<Record<RollupFunction, string>> = {
  count: "Count the records",
  countValues: "Count the values",
  sum: "Sum",
  average: "Average",
  min: "Smallest",
  max: "Largest",
  percentChecked: "Percentage ticked",
  earliest: "Earliest date",
  latest: "Latest date",
  showValues: "Show the values",
};

const NUMBER_LABELS: Readonly<Record<(typeof NUMBER_FORMATS)[number], string>> = {
  plain: "Number",
  integer: "Whole number",
  decimal: "Two decimal places",
  percent: "Percentage",
};

/** An identifier for a new option, from its name, unique among the others. */
function optionId(name: string, taken: readonly PropertyOption[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "option";
  let candidate = base;
  for (let index = 2; taken.some((option) => option.id === candidate); index += 1) candidate = `${base}-${index}`;
  return candidate;
}

export function PropertyDialog({
  data,
  property,
  onClose,
}: {
  readonly data: ViewData;
  /** The property to change, or null for a new one. */
  readonly property: ViewProperty | null;
  readonly onClose: () => void;
}) {
  const collectionKey = data.collection.key;
  const core = collectionKey.startsWith("core:");
  const [name, setName] = useState(property?.name ?? "");
  const [type, setType] = useState<PropertyType>(property?.type ?? "text");
  const [options, setOptions] = useState<PropertyOption[]>([...(property?.config.options ?? [])]);
  const [newOption, setNewOption] = useState("");
  const [target, setTarget] = useState(property?.config.relation?.target ?? "core:replications");
  const relations = data.collection.properties.filter((candidate) => candidate.type === "relation");
  const existingRollup = property?.config.rollup;
  const [rollupRelation, setRollupRelation] = useState(
    existingRollup !== undefined && "relation" in existingRollup.source
      ? existingRollup.source.relation
      : (relations[0]?.id ?? ""),
  );
  const [rollupProperty, setRollupProperty] = useState(existingRollup?.property ?? "");
  const [rollupFunction, setRollupFunction] = useState<RollupFunction>(existingRollup?.function ?? "count");
  const [expression, setExpression] = useState(property?.config.formula?.expression ?? "");
  const [numberFormat, setNumberFormat] = useState(property?.config.numberFormat ?? "plain");
  const [includeTime, setIncludeTime] = useState(property?.config.includeTime === true);
  const [audience, setAudience] = useState<"member" | "restricted">(
    property?.source === "restricted" ? "restricted" : "member",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const relationTarget = relations.find((candidate) => candidate.id === rollupRelation)?.config.relation?.target;
  const targetProperties =
    relationTarget === undefined ? [] : (data.context.collections.get(relationTarget)?.properties ?? []);
  const targets = [
    ...CORE_SOURCE_KEYS.filter((key) => CORE_SOURCES[key].selectable).map((key) => ({
      key,
      label: CORE_SOURCES[key].label,
    })),
    ...[...data.context.collections.values()]
      .filter((collection) => collection.key.startsWith("db:"))
      .map((collection) => ({ key: collection.key, label: collection.label })),
  ];

  const hasOptions = type === "select" || type === "multiSelect" || type === "status";
  /** The options with the one still typed in the field for a new option, which saving keeps. */
  const withTyped = (): PropertyOption[] =>
    newOption.trim() === "" ? options : [...options, { id: optionId(newOption, options), name: newOption.trim() }];
  const addTypedOption = () => {
    if (newOption.trim() === "") return;
    setOptions(withTyped());
    setNewOption("");
  };

  const config = (): PropertyConfig => {
    switch (type) {
      case "select":
      case "multiSelect":
      case "status":
        return { options: withTyped() };
      case "relation":
        return { relation: { target } };
      case "rollup":
        return { rollup: { source: { relation: rollupRelation }, property: rollupProperty, function: rollupFunction } };
      case "formula":
        return { formula: { expression }, numberFormat };
      case "number":
        return { numberFormat };
      case "date":
      case "dateRange":
        return { includeTime };
      default:
        return {};
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Give the property a name.");
      return;
    }
    if (hasOptions && withTyped().length === 0) {
      setError("Add at least one option, so that a value can be chosen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await callFunction(savePropertyContract, {
        collectionKey,
        ...(property === null ? {} : { propertyId: property.id }),
        name: name.trim(),
        type,
        config: config(),
        ...(core ? { audience } : {}),
      });
      onClose();
    } catch (failure) {
      setError(failure instanceof CallableError ? failure.message : "The property was not saved.");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (property === null) return;
    setBusy(true);
    try {
      await callFunction(savePropertyContract, {
        collectionKey,
        propertyId: property.id,
        name: property.name,
        type: property.type,
        config: property.config,
        ...(core ? { audience } : {}),
        archived: true,
      });
      onClose();
    } catch (failure) {
      setError(failure instanceof CallableError ? failure.message : "The property was not archived.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={property === null ? "Add a property" : `Change ${property.name}`}>
        <form className="mt-4 grid gap-4" onSubmit={(event) => void submit(event)}>
          <FormField label="Name">
            {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} />}
          </FormField>
          <FormField
            label="Type"
            hint={property === null ? undefined : "The type of a property does not change once it exists."}
          >
            {(control) => (
              <Select
                {...control}
                value={type}
                disabled={property !== null}
                onChange={(event) => setType(propertyTypeSchema.parse(event.target.value))}
              >
                {propertyTypeSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {PROPERTY_TYPE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {core ? (
            <FormField
              label="Who may read its values"
              hint="A restricted value is read only within the scope of its record."
            >
              {(control) => (
                <Select
                  {...control}
                  value={audience}
                  disabled={property !== null}
                  onChange={(event) => setAudience(event.target.value === "restricted" ? "restricted" : "member")}
                >
                  <option value="member">Every member</option>
                  <option value="restricted">The scope of the record</option>
                </Select>
              )}
            </FormField>
          ) : null}
          {hasOptions ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Options</legend>
              {options.map((option, index) => (
                <div key={option.id} className="flex items-center gap-2">
                  <Input
                    aria-label={`Option ${index + 1}`}
                    value={option.name}
                    onChange={(event) =>
                      setOptions(
                        options.map((existing) =>
                          existing.id === option.id ? { ...existing, name: event.target.value } : existing,
                        ),
                      )
                    }
                  />
                  {type === "status" ? (
                    <Select
                      aria-label={`Group of option ${index + 1}`}
                      className="w-40"
                      value={option.group ?? "toDo"}
                      onChange={(event) =>
                        setOptions(
                          options.map((existing) =>
                            existing.id === option.id
                              ? { ...existing, group: event.target.value as NonNullable<PropertyOption["group"]> }
                              : existing,
                          ),
                        )
                      }
                    >
                      <option value="toDo">To do</option>
                      <option value="inProgress">In progress</option>
                      <option value="complete">Complete</option>
                    </Select>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() => setOptions(options.filter((existing) => existing.id !== option.id))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  aria-label="New option"
                  value={newOption}
                  onChange={(event) => setNewOption(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds the option and stays in the field, rather than saving the property.
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    addTypedOption();
                  }}
                />
                <Button size="sm" disabled={newOption.trim() === ""} onClick={addTypedOption}>
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              </div>
            </fieldset>
          ) : null}
          {type === "relation" ? (
            <FormField label="Links to">
              {(control) => (
                <Select
                  {...control}
                  value={target}
                  disabled={property !== null}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  {targets.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {type === "rollup" ? (
            relations.length === 0 ? (
              <p className="text-fg-muted">A rollup reads related records. Add a relation first.</p>
            ) : (
              <>
                <FormField label="Through the relation">
                  {(control) => (
                    <Select
                      {...control}
                      value={rollupRelation}
                      onChange={(event) => setRollupRelation(event.target.value)}
                    >
                      {relations.map((relation) => (
                        <option key={relation.id} value={relation.id}>
                          {relation.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="Of the property">
                  {(control) => (
                    <Select
                      {...control}
                      value={rollupProperty}
                      onChange={(event) => setRollupProperty(event.target.value)}
                    >
                      <option value="">Choose</option>
                      {targetProperties.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="Calculate">
                  {(control) => (
                    <Select
                      {...control}
                      value={rollupFunction}
                      onChange={(event) => setRollupFunction(event.target.value as RollupFunction)}
                    >
                      {ROLLUP_FUNCTIONS.map((fn) => (
                        <option key={fn} value={fn}>
                          {ROLLUP_LABELS[fn]}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              </>
            )
          ) : null}
          {type === "formula" ? (
            <FormField
              label="Formula"
              hint={`Refer to a property as prop("Name"). Functions: ${FORMULA_FUNCTIONS.join(", ")}.`}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                />
              )}
            </FormField>
          ) : null}
          {type === "number" || type === "formula" ? (
            <FormField label="Shown as">
              {(control) => (
                <Select
                  {...control}
                  value={numberFormat}
                  onChange={(event) => setNumberFormat(event.target.value as (typeof NUMBER_FORMATS)[number])}
                >
                  {NUMBER_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {NUMBER_LABELS[format]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {type === "date" || type === "dateRange" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeTime} onChange={(event) => setIncludeTime(event.target.checked)} />
              Show the time
            </label>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="text-sm text-fg-accent">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            {property === null ? (
              <span />
            ) : (
              <Button disabled={busy} onClick={() => void archive()}>
                Archive the property
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving" : "Save the property"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
