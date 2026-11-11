// How a value of a property is shown in a view, and the editor a person changes it with. The
// value is checked with the shared package before it is sent, and again by the function that
// stores it, which alone decides.
import {
  type CollectionData,
  checkPropertyValue,
  type DateRangeValue,
  displayText,
  type EngineContext,
  type FileLink,
  isDateRange,
  optionName,
  type PropertyValue,
  type RecordReference,
  type ViewProperty,
} from "@eegml/shared";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/cn";

/** A value as a cell shows it. A computed value that failed shows its error, in words. */
export function CellValue({
  property,
  value,
  error,
  context,
}: {
  readonly property: ViewProperty;
  readonly value: PropertyValue | undefined;
  readonly error?: string | undefined;
  readonly context: EngineContext;
}) {
  if (error !== undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-fg-accent" title={error}>
        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">Cannot calculate</span>
        <span className="sr-only">: {error}</span>
      </span>
    );
  }
  if (value === null || value === undefined) return <span className="text-fg-muted">Empty</span>;
  switch (property.type) {
    case "checkbox":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "inline-block size-3.5 rounded-sm border border-border-strong",
              value === true && "border-accent-strong bg-accent-strong",
            )}
          />
          {value === true ? "Yes" : "No"}
        </span>
      );
    case "select":
    case "status":
      return typeof value === "string" ? <Badge tone="neutral">{optionName(property, value)}</Badge> : null;
    case "multiSelect":
      return (
        <span className="flex flex-wrap gap-1">
          {(Array.isArray(value) ? value : []).map((id) => (
            <Badge key={String(id)} tone="neutral">
              {optionName(property, String(id))}
            </Badge>
          ))}
        </span>
      );
    case "url":
      return typeof value === "string" ? (
        <a href={value} target="_blank" rel="noopener noreferrer" className="truncate text-fg-accent underline">
          {value}
        </a>
      ) : null;
    case "email":
      return typeof value === "string" ? (
        <a href={`mailto:${value}`} className="truncate text-fg-accent underline">
          {value}
        </a>
      ) : null;
    case "file":
      return (
        <span className="flex flex-wrap gap-2">
          {(Array.isArray(value) ? (value as readonly FileLink[]) : []).map((file) => (
            <a
              key={file.url}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-accent underline"
            >
              {file.name}
            </a>
          ))}
        </span>
      );
    default:
      return <span className="truncate">{displayText(property, value, context)}</span>;
  }
}

export interface EditorProps {
  readonly property: ViewProperty;
  readonly value: PropertyValue | undefined;
  readonly context: EngineContext;
  readonly people: readonly { readonly uid: string; readonly name: string }[];
  /** Called with a value that the shared checks accept. */
  readonly onCommit: (value: PropertyValue) => void;
  readonly onCancel: () => void;
}

/** The records a relation may link to. */
function targetsOf(property: ViewProperty, context: EngineContext): CollectionData | undefined {
  const target = property.config.relation?.target;
  return target === undefined ? undefined : context.collections.get(target);
}

/** A list of choices that a person ticks, for options, people and related records. */
function ChoiceList({
  label,
  choices,
  chosen,
  onChange,
}: {
  readonly label: string;
  readonly choices: readonly { readonly id: string; readonly name: string }[];
  readonly chosen: readonly string[];
  readonly onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = choices
    .filter((choice) => choice.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .slice(0, 200);
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {choices.length > 8 ? (
        <Input
          aria-label={`Find in ${label.toLowerCase()}`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}
      <div className="max-h-56 overflow-auto">
        {shown.length === 0 ? <p className="text-fg-muted">Nothing to choose from.</p> : null}
        {shown.map((choice) => (
          <label key={choice.id} className="flex min-h-8 items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.includes(choice.id)}
              onChange={(event) =>
                onChange(event.target.checked ? [...chosen, choice.id] : chosen.filter((id) => id !== choice.id))
              }
            />
            {choice.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** What an editor of an option property shows while the property has no options to choose from. */
function NoOptions() {
  return (
    <p className="text-fg-secondary">
      This property has no options yet. Choose Properties, then Change a property, to add some.
    </p>
  );
}

/** The value as an editor first holds it. */
function draftOf(property: ViewProperty, value: PropertyValue | undefined): unknown {
  if (value === undefined) return null;
  if (property.type === "dateRange") return isDateRange(value) ? value : { start: null, end: null };
  return value;
}

/** An editor of one value. Enter in a single-line field saves it and Escape leaves it. */
export function ValueEditor({ property, value, context, people, onCommit, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<unknown>(() => draftOf(property, value));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const commit = (raw: unknown = draft) => {
    const checked = checkPropertyValue(property, raw);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    onCommit(checked.value);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      commit();
    }
  };
  const options = useMemo(() => property.config.options ?? [], [property]);
  const text = (raw: unknown) => (typeof raw === "string" || typeof raw === "number" ? String(raw) : "");

  let control: React.ReactNode;
  switch (property.type) {
    case "number":
      control = (
        <Input
          id={id}
          type="number"
          step="any"
          autoFocus
          value={text(draft)}
          onChange={(event) => setDraft(event.target.value === "" ? null : Number(event.target.value))}
        />
      );
      break;
    case "richText":
      control = (
        <Textarea id={id} autoFocus rows={5} value={text(draft)} onChange={(event) => setDraft(event.target.value)} />
      );
      break;
    case "date":
      control = (
        <Input
          id={id}
          type="date"
          autoFocus
          value={text(draft).slice(0, 10)}
          onChange={(event) => setDraft(event.target.value === "" ? null : event.target.value)}
        />
      );
      break;
    case "dateRange": {
      const range = (draft ?? { start: null, end: null }) as DateRangeValue;
      control = (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1 text-sm">
            Start
            <Input
              aria-label="Start"
              type="date"
              autoFocus
              value={(range.start ?? "").slice(0, 10)}
              onChange={(event) => setDraft({ ...range, start: event.target.value === "" ? null : event.target.value })}
            />
          </div>
          <div className="grid gap-1 text-sm">
            End
            <Input
              aria-label="End"
              type="date"
              value={(range.end ?? "").slice(0, 10)}
              onChange={(event) => setDraft({ ...range, end: event.target.value === "" ? null : event.target.value })}
            />
          </div>
        </div>
      );
      break;
    }
    case "checkbox":
      control = (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft === true} onChange={(event) => setDraft(event.target.checked)} />
          {property.name}
        </label>
      );
      break;
    case "select":
    case "status":
      control =
        options.length === 0 ? (
          <NoOptions />
        ) : (
          <Select
            id={id}
            autoFocus
            value={text(draft)}
            onChange={(event) => setDraft(event.target.value === "" ? null : event.target.value)}
          >
            <option value="">None</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        );
      break;
    case "multiSelect":
      control =
        options.length === 0 ? (
          <NoOptions />
        ) : (
          <ChoiceList
            label={property.name}
            choices={options}
            chosen={Array.isArray(draft) ? (draft as string[]) : []}
            onChange={setDraft}
          />
        );
      break;
    case "person":
      control = (
        <ChoiceList
          label={property.name}
          choices={people.map((person) => ({ id: person.uid, name: person.name }))}
          chosen={Array.isArray(draft) ? (draft as string[]) : []}
          onChange={setDraft}
        />
      );
      break;
    case "relation": {
      const targets = targetsOf(property, context);
      const chosen = Array.isArray(draft) ? (draft as RecordReference[]) : [];
      const choices = (targets?.records ?? []).map((record) => {
        const title = record.values[targets?.titleProperty ?? ""];
        return {
          id: `${record.reference.entityType}:${record.reference.entityId}`,
          name: typeof title === "string" && title !== "" ? title : record.id,
        };
      });
      control = (
        <ChoiceList
          label={property.name}
          choices={choices}
          chosen={chosen.map((reference) => `${reference.entityType}:${reference.entityId}`)}
          onChange={(next) =>
            setDraft(
              next.map((key) => {
                const cut = key.indexOf(":");
                return { entityType: key.slice(0, cut), entityId: key.slice(cut + 1) };
              }),
            )
          }
        />
      );
      break;
    }
    case "file": {
      const files = Array.isArray(draft) ? (draft as FileLink[]) : [];
      const change = (index: number, field: keyof FileLink, next: string) =>
        setDraft(files.map((file, position) => (position === index ? { ...file, [field]: next } : file)));
      control = (
        <div className="grid gap-2">
          {files.map((file, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the rows of the list are edited in place
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                aria-label={`Name of file ${index + 1}`}
                value={file.name}
                onChange={(event) => change(index, "name", event.target.value)}
              />
              <Input
                aria-label={`Web address of file ${index + 1}`}
                type="url"
                value={file.url}
                onChange={(event) => change(index, "url", event.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove file ${index + 1}`}
                onClick={() => setDraft(files.filter((_file, position) => position !== index))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setDraft([...files, { name: "", url: "https://" }])}>
            <Plus aria-hidden="true" />
            Add a file
          </Button>
        </div>
      );
      break;
    }
    default:
      control = (
        <Input
          id={id}
          type={property.type === "email" ? "email" : property.type === "url" ? "url" : "text"}
          autoFocus
          value={text(draft)}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
  }

  const labelled = ["number", "richText", "date", "select", "status", "text", "email", "url"].includes(property.type);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys are those of the fields inside, handled once here
    <div className="grid gap-3" onKeyDown={onKey}>
      {labelled ? (
        <label htmlFor={id} className="text-sm font-medium">
          {property.name}
        </label>
      ) : null}
      {control}
      {error === null ? null : (
        <p role="alert" className="text-xs text-fg-accent">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => commit()}>
          Save
        </Button>
      </div>
    </div>
  );
}
