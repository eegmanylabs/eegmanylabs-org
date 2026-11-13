// Drill-down from a figure or a chart of a dashboard to the records behind it (requirement
// R15.5). The records are the ones the widget computed from, which the reader's own permissions
// loaded, so the list never shows more than the figure counted. Each record opens its page where
// the portal has one, and the list can be exported like any view.
import {
  type CollectionData,
  type DerivedRecord,
  displayText,
  type EngineContext,
  groupRecords,
  type ViewProperty,
  visibleProperties,
} from "@eegml/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import {
  datasetPath,
  laboratoryPath,
  memberPath,
  participationRecruitmentPath,
  replicationPath,
} from "@/registry/paths";
import { ExportMenu, viewTable } from "./ExportMenu";

/** The page of a record of a core collection, or null where the portal has none. */
export function recordLink(collectionKey: string, id: string): string | null {
  switch (collectionKey) {
    case "core:replications":
      return replicationPath(id);
    case "core:laboratories":
      return laboratoryPath(id);
    case "core:persons":
      return memberPath(id);
    case "core:participations":
      return participationRecruitmentPath(id);
    case "core:datasets":
      return datasetPath(id);
    case "core:tasks":
      return `/tasks?task=${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

/** The most records the list shows; the export holds every one. */
const SHOWN = 200;

function RecordList({
  title,
  records,
  collection,
  context,
}: {
  readonly title: string;
  readonly records: readonly DerivedRecord[];
  readonly collection: CollectionData;
  readonly context: EngineContext;
}) {
  const titleProperty = collection.properties.find((property) => property.id === collection.titleProperty);
  const properties: readonly ViewProperty[] = visibleProperties(collection, {});
  const nameOf = (record: DerivedRecord) =>
    titleProperty === undefined
      ? record.id
      : displayText(titleProperty, record.values[titleProperty.id], context) || record.id;
  return (
    <div className="mt-4 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary">
          {records.length} {records.length === 1 ? "record" : "records"}
          {records.length > SHOWN ? `, of which the first ${SHOWN} are listed; the export holds all of them` : ""}.
        </p>
        <ExportMenu table={() => viewTable(title, records, properties, context)} />
      </div>
      {records.length === 0 ? (
        <p className="text-sm text-fg-muted">No record is behind this figure.</p>
      ) : (
        <ul className="grid max-h-96 gap-1 overflow-y-auto" data-testid="drill-down-records">
          {records.slice(0, SHOWN).map((record) => {
            const to = recordLink(collection.key, record.id);
            return (
              <li key={record.id} className="text-sm">
                {to === null ? (
                  nameOf(record)
                ) : (
                  <a className="text-fg-accent underline" href={`#${to}`}>
                    {nameOf(record)}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A control that opens the records behind a figure. */
export function DrillDown({
  title,
  records,
  collection,
  context,
}: {
  readonly title: string;
  readonly records: readonly DerivedRecord[];
  readonly collection: CollectionData;
  readonly context: EngineContext;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="justify-self-start print:hidden" onClick={() => setOpen(true)}>
        Show the {records.length === 1 ? "record" : `${records.length} records`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Records behind ${title}`}>
          <RecordList title={title} records={records} collection={collection} context={context} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The records of one group of a chart, chosen from its groups. */
export function GroupDrillDown({
  title,
  records,
  groupBy,
  collection,
  context,
}: {
  readonly title: string;
  readonly records: readonly DerivedRecord[];
  readonly groupBy: ViewProperty;
  readonly collection: CollectionData;
  readonly context: EngineContext;
}) {
  const groups = groupRecords(records, { property: groupBy.id, collapsed: [] }, groupBy, context, false);
  const [chosen, setChosen] = useState("");
  const [open, setOpen] = useState(false);
  const group = groups.find((candidate) => candidate.key === chosen) ?? groups[0];
  if (group === undefined) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <FormField label="Records of the group" className="min-w-40">
        {(control) => (
          <Select {...control} value={group.key} onChange={(event) => setChosen(event.target.value)}>
            {groups.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label} ({candidate.records.length})
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <Button size="sm" onClick={() => setOpen(true)}>
        Show them
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`${title}: ${group.label}`}>
          <RecordList
            title={`${title}, ${group.label}`}
            records={group.records}
            collection={collection}
            context={context}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
