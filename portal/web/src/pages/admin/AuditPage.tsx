import {
  AUDIT_ACTIONS,
  type AuditAction,
  ENTITY_TYPES,
  type EntityType,
  type ListAuditEventsOutput,
  type ListedAuditEvent,
  type ListedUser,
  listAuditEventsContract,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LaboratoryName, PersonName, ReplicationName } from "@/components/record-names";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CallableError, callFunction, useCallResult } from "@/data";
import { AdminPage } from "./AdminPage";
import { AccountPicker, useAccountNames } from "./accounts";
import { actionLabel, fieldLabel, recordTypeLabel, type ShownValue, shortPath, shownValue } from "./audit-format";

const PAGE_SIZE = 25;

interface Filters {
  readonly actorUid?: string;
  readonly entityType?: EntityType;
  readonly action?: AuditAction;
  readonly from?: string;
  readonly to?: string;
}

function Value({ shown }: { shown: Exclude<ShownValue, { kind: "withheld" }> }) {
  if (shown.kind === "absent") return <span className="text-fg-muted">Not set</span>;
  return shown.multiline ? (
    <pre className="max-w-md font-sans text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{shown.text}</pre>
  ) : (
    <span className="[overflow-wrap:anywhere]">{shown.text}</span>
  );
}

/** The record an entry is about: its kind, its name where the directory has one, and its identifier. */
function RecordOfEntry({ event, nameOfAccount }: { event: ListedAuditEvent; nameOfAccount: (uid: string) => string }) {
  if (event.entityType === null || event.entityId === null) return <>No record</>;
  const id = event.entityId;
  const name =
    event.entityType === "person" ? (
      <PersonName id={id} />
    ) : event.entityType === "laboratory" ? (
      <LaboratoryName id={id} />
    ) : event.entityType === "replication" ? (
      <ReplicationName id={id} />
    ) : event.entityType === "user" ? (
      nameOfAccount(id)
    ) : null;
  return (
    <>
      {recordTypeLabel(event.entityType)}
      {name === null ? null : <span className="font-medium text-fg">: {name}</span>}
      <span className="block text-fg-muted [overflow-wrap:anywhere]">
        {id} · {shortPath(event.documentPath)}
      </span>
    </>
  );
}

function Entry({ event, nameOfAccount }: { event: ListedAuditEvent; nameOfAccount: (uid: string) => string }) {
  const actor =
    event.actorKind === "user"
      ? (event.actorName ?? event.actorUid ?? "An account")
      : `${event.actorKind.charAt(0).toUpperCase()}${event.actorKind.slice(1)}`;
  return (
    <li className="grid gap-2 border-b border-border py-4 last:border-b-0" data-testid="audit-entry">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-fg-strong">
          {actionLabel(event.action)}
          <span className="font-normal text-fg-secondary"> by {actor}</span>
        </p>
        <time dateTime={event.at} className="text-fg-muted">
          {formatDateTime(event.at)}
        </time>
      </div>
      <p className="text-fg-secondary">
        <RecordOfEntry event={event} nameOfAccount={nameOfAccount} />
      </p>
      {event.changes.length === 0 ? null : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Changes of this entry</caption>
          <thead className="text-micro text-fg-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                Field
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Before
              </th>
              <th scope="col" className="py-1 font-medium">
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {event.changes.map((change) => {
              const before = shownValue(change, "before");
              const after = shownValue(change, "after");
              return (
                <tr key={change.field} className="border-t border-border align-top">
                  <th scope="row" className="py-1.5 pr-3 font-medium [overflow-wrap:anywhere]">
                    {fieldLabel(change.field)}
                  </th>
                  {before.kind === "withheld" || after.kind === "withheld" ? (
                    <td colSpan={2} className="py-1.5">
                      <Badge tone="outline">Withheld</Badge>
                      <span className="ml-2 text-fg-muted">The record is restricted, so the log keeps no value.</span>
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5 pr-3">
                        <Value shown={before} />
                      </td>
                      <td className="py-1.5">
                        <Value shown={after} />
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </li>
  );
}

const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

function FilterForm({ onApply }: { onApply: (filters: Filters) => void }) {
  const [actor, setActor] = useState<ListedUser | null>(null);
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (from !== "" && to !== "" && from > to) {
      setError("The start date is after the end date.");
      return;
    }
    setError(null);
    onApply({
      ...(actor === null ? {} : { actorUid: actor.uid }),
      ...optional(
        "entityType",
        ENTITY_TYPES.find((type) => type === entityType),
      ),
      ...optional(
        "action",
        AUDIT_ACTIONS.find((candidate) => candidate === action),
      ),
      ...(from === "" ? {} : { from: `${from}T00:00:00Z` }),
      ...(to === "" ? {} : { to: `${to}T23:59:59Z` }),
    });
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Filter the audit log"
      className="grid gap-4 rounded-card border border-border bg-surface px-5 py-4"
    >
      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <AccountPicker label="Actor" value={actor} onChange={setActor} />
        <div className="grid content-start gap-4">
          <FormField label="Record type">
            {(control) => (
              <Select {...control} value={entityType} onChange={(event) => setEntityType(event.target.value)}>
                <option value="">Any type</option>
                {ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {recordTypeLabel(type)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Action">
            {(control) => (
              <Select {...control} value={action} onChange={(event) => setAction(event.target.value)}>
                <option value="">Any action</option>
                {AUDIT_ACTIONS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {actionLabel(candidate)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
        <FormField label="From" error={error}>
          {(control) => (
            <Input {...control} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          )}
        </FormField>
        <FormField label="To">
          {(control) => <Input {...control} type="date" value={to} onChange={(event) => setTo(event.target.value)} />}
        </FormField>
      </div>
      <div>
        <Button type="submit" variant="primary">
          Show entries
        </Button>
      </div>
    </form>
  );
}

/** The newest entries that match, with the older pages appended one at a time. */
function Entries({ filters }: { filters: Filters }) {
  const input = { ...filters, limit: PAGE_SIZE };
  const { live, reload } = useCallResult(listAuditEventsContract, input, JSON.stringify(input));
  // The pages loaded after the first, for the filters they were loaded with.
  const [older, setOlder] = useState<{
    key: string;
    events: ListedAuditEvent[];
    cursor: ListAuditEventsOutput["next"];
  }>({ key: "", events: [], cursor: null });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const key = JSON.stringify(input);
  // Accounts are named through listUsers, for whoever may call it. Others see the identifier.
  const shown = [...(live.status === "ready" ? live.data.events : []), ...(older.key === key ? older.events : [])];
  const nameOfAccount = useAccountNames(
    shown.flatMap((event) => (event.entityType === "user" && event.entityId !== null ? [event.entityId] : [])),
  );

  return (
    <LiveView
      live={live}
      loadingLabel="Loading the audit log"
      errorTitle="The audit log could not be loaded."
      onRetry={reload}
    >
      {(first) => {
        const appended = older.key === key ? older.events : [];
        const cursor = older.key === key ? older.cursor : first.next;
        const events = [...first.events, ...appended];
        if (events.length === 0) {
          return <EmptyState title="No entries match" description="Widen the dates, or remove a filter." />;
        }
        const loadOlder = async () => {
          if (cursor === null) return;
          setLoading(true);
          setFailure(null);
          try {
            const page = await callFunction(listAuditEventsContract, { ...input, after: cursor });
            setOlder({ key, events: [...appended, ...page.events], cursor: page.next });
          } catch (error) {
            setFailure(error instanceof CallableError ? error.message : "Older entries could not be loaded.");
          } finally {
            setLoading(false);
          }
        };
        return (
          <section
            aria-label="Audit entries"
            className="grid gap-3 rounded-card border border-border bg-surface px-5 py-2"
          >
            <ol className="grid">
              {events.map((event) => (
                <Entry key={event.eventId} event={event} nameOfAccount={nameOfAccount} />
              ))}
            </ol>
            {failure ? <ErrorState title="Older entries could not be loaded." description={failure} /> : null}
            <p className="text-fg-secondary" aria-live="polite">
              Showing the {events.length} newest {events.length === 1 ? "entry" : "entries"}
              {cursor === null ? ". There are no older entries." : "."}
            </p>
            {cursor === null ? null : (
              <div className="pb-3">
                <Button disabled={loading} onClick={() => void loadOlder()}>
                  Load older entries
                </Button>
              </div>
            )}
          </section>
        );
      }}
    </LiveView>
  );
}

/** The audit trail, newest first, filtered by who acted, on what, how and when. */
export function AuditPage() {
  const [filters, setFilters] = useState<Filters>({});
  return (
    <AdminPage
      entryId="admin-audit"
      description="Every change to the portal's records, newest first. Values of restricted records and special categories are withheld from the log itself."
    >
      <FilterForm onApply={setFilters} />
      <Entries filters={filters} />
    </AdminPage>
  );
}
