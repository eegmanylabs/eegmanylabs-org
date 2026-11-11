// One record with every property of its collection, each changed in place where the viewer may.
// The list, the board, the gallery, the calendar and the timeline open a record here.
import type { DerivedRecord, PropertyValue, ViewProperty } from "@eegml/shared";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CellValue, ValueEditor } from "./cells";
import type { ViewData } from "./use-view-data";

export interface RecordEditing {
  /** Saves one value of one record. Rejects with a message that can be shown. */
  readonly save: (record: DerivedRecord, property: ViewProperty, value: PropertyValue) => Promise<void>;
}

export function titleOf(data: ViewData, record: DerivedRecord): string {
  const title = record.values[data.collection.titleProperty];
  return typeof title === "string" && title !== "" ? title : "Untitled";
}

/** One property of a record: its value, and an editor where the viewer may change it. */
export function PropertyRow({
  data,
  record,
  property,
  editing,
}: {
  readonly data: ViewData;
  readonly record: DerivedRecord;
  readonly property: ViewProperty;
  readonly editing: RecordEditing;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = data.canEdit(record, property);
  return (
    <div className="grid gap-1 border-b border-border py-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-fg-muted">{property.name}</dt>
      <dd className="min-w-0">
        {open ? (
          <ValueEditor
            property={property}
            value={record.values[property.id]}
            context={data.context}
            people={data.people}
            onCancel={() => setOpen(false)}
            onCommit={(value) => {
              setError(null);
              editing
                .save(record, property, value)
                .then(() => setOpen(false))
                .catch((failure: unknown) =>
                  setError(failure instanceof Error ? failure.message : "The change was not saved."),
                );
            }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <CellValue
                property={property}
                value={record.values[property.id]}
                error={record.errors[property.id]}
                context={data.context}
              />
            </div>
            {editable ? (
              <Button variant="ghost" size="sm" aria-label={`Change ${property.name}`} onClick={() => setOpen(true)}>
                <Pencil aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="mt-1 text-xs text-fg-accent">
            {error}
          </p>
        )}
      </dd>
    </div>
  );
}

export function RecordDialog({
  data,
  record,
  properties,
  editing,
  onClose,
}: {
  readonly data: ViewData;
  readonly record: DerivedRecord | null;
  readonly properties: readonly ViewProperty[];
  readonly editing: RecordEditing;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={record !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {record === null ? null : (
        <DialogContent title={titleOf(data, record)} className="max-w-3xl">
          <dl className="mt-4">
            {properties.map((property) => (
              <PropertyRow key={property.id} data={data} record={record} property={property} editing={editing} />
            ))}
          </dl>
        </DialogContent>
      )}
    </Dialog>
  );
}
