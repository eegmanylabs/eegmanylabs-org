import {
  type CallableInput,
  COMBINED_AMODIO_DECISION,
  type EntityRef,
  REPLICATION_STATUSES,
  resolveReconciliationItemContract,
  studyStatusDecision,
} from "@eegml/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { decisionDay, decisionReference } from "@/app/labels";
import { useProgrammeAdministrator } from "@/auth/use-privilege";
import { LiveView } from "@/components/feedback/live-view";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  callFunction,
  type LiveQuery,
  type RecordOf,
  retryFailedLiveData,
  useLiveDocument,
  useLiveQuery,
} from "@/data";
import { AdminPage } from "@/pages/admin/AdminPage";
import { ReasonDialog } from "@/pages/admin/ReasonDialog";
import { MEMBERSHIP_ROLE_LABELS, RECONCILIATION_KIND_LABELS } from "@/registry/labels";
import { recordPath } from "@/registry/paths";
import { membershipsOfReplication, usePersons } from "@/registry/queries";
import { useViewer } from "@/registry/viewer";
import { batchPath } from "./ImportsPage";

type Item = RecordOf<"reconciliationItems">;
type Decision = CallableInput<typeof resolveReconciliationItemContract>;

/**
 * The open items. An item about a sealed value is read by holders of `sealed.read` alone, so
 * everybody else asks for the unsealed ones, which is what the rules let them list.
 */
export function openItemsQuery(readsSealed: boolean): LiveQuery<"reconciliationItems"> {
  return {
    collection: "reconciliationItems",
    within: [],
    where: readsSealed
      ? [["status", "==", "open"]]
      : [
          ["status", "==", "open"],
          ["sealed", "==", false],
        ],
    limit: 1_000,
  };
}
const PAGE = 10;

/** Sends a decision and says what happened. A refusal is shown in the dialog that sent it. */
function useDecide(): (decision: Decision) => Promise<void> {
  const toast = useToast();
  return async (decision) => {
    const answer = await callFunction(resolveReconciliationItemContract, decision);
    toast.show({
      title: answer.status === "dismissed" ? "The item has been dismissed." : "The decision has been recorded.",
      ...(answer.changedDocuments === 0
        ? {}
        : {
            description: `${answer.changedDocuments} ${answer.changedDocuments === 1 ? "record was" : "records were"} changed.`,
          }),
    });
  };
}

function RecordLink({ entity, names }: { entity: EntityRef; names: ReadonlyMap<string, string> }) {
  const path = recordPath(entity.entityType, entity.entityId);
  const label = names.get(entity.entityId) ?? entity.entityId;
  return path === null ? (
    <span className="break-all">
      {entity.entityType} {label}
    </span>
  ) : (
    <Link to={path} className="text-fg-accent underline">
      {label}
    </Link>
  );
}

function LeadDecision({
  item,
  replicationId,
  names,
}: {
  item: Item;
  replicationId: string;
  names: ReadonlyMap<string, string>;
}) {
  const decide = useDecide();
  const memberships = useLiveQuery(membershipsOfReplication(replicationId));
  const [outcomes, setOutcomes] = useState<Record<string, "current" | "former" | "wrong" | "">>({});
  const [confirming, setConfirming] = useState(false);
  return (
    <LiveView
      live={memberships}
      loadingLabel="Loading the leads"
      errorTitle="The leads could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => {
        const leads = list.filter(
          (membership) =>
            (membership.role === "lead" || membership.role === "coLead") && membership.archivedAt === null,
        );
        const chosen = leads.flatMap((membership) => {
          const outcome = outcomes[membership.id] ?? "";
          return outcome === "" ? [] : [{ personId: membership.personId, role: membership.role, outcome }];
        });
        if (leads.length === 0)
          return <p className="text-fg-secondary">The replication holds no lead membership to decide.</p>;
        return (
          <div className="grid gap-2">
            <ul className="grid gap-2">
              {leads.map((membership) => (
                <li key={membership.id} className="flex flex-wrap items-end justify-between gap-2">
                  <span>
                    {names.get(membership.personId) ?? membership.personId},{" "}
                    {MEMBERSHIP_ROLE_LABELS[membership.role].toLowerCase()}
                    <span className="block text-xs text-fg-muted">
                      {membership.reviewStatus === "confirmed" ? "Confirmed" : "Awaits review"}
                      {membership.isCurrent ? ", current" : ", not current"}
                    </span>
                  </span>
                  <FormField
                    label={`Decision about ${names.get(membership.personId) ?? membership.personId}`}
                    className="w-56"
                  >
                    {(control) => (
                      <Select
                        {...control}
                        value={outcomes[membership.id] ?? ""}
                        onChange={(event) =>
                          setOutcomes({
                            ...outcomes,
                            [membership.id]: event.target.value as "current" | "former" | "wrong" | "",
                          })
                        }
                      >
                        <option value="">Leave as it is</option>
                        <option value="current">Current lead</option>
                        <option value="former">Former lead</option>
                        <option value="wrong">Wrong, never a lead</option>
                      </Select>
                    )}
                  </FormField>
                </li>
              ))}
            </ul>
            <div>
              <Button variant="primary" size="sm" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
                Record the decision
              </Button>
            </div>
            <ReasonDialog
              open={confirming}
              onOpenChange={setConfirming}
              title="Record this decision about the leads?"
              description="Each lead you decided is confirmed as current, former or wrong, a wrong one is archived, and the leads of the replication are worked out again. A decided item is never reopened."
              label="Note"
              optional
              confirmLabel="Record the decision"
              onConfirm={(note) =>
                decide({
                  fingerprint: item.id,
                  action: "decideLeads",
                  memberships: chosen,
                  ...(note === "" ? {} : { note }),
                })
              }
            />
          </div>
        );
      }}
    </LiveView>
  );
}

function CurrentValue({ entity, field }: { entity: EntityRef; field: string }) {
  const key =
    entity.entityType === "replication"
      ? "replications"
      : entity.entityType === "person"
        ? "persons"
        : entity.entityType === "laboratory"
          ? "laboratories"
          : null;
  const record = useLiveDocument(key ?? "replications", key === null ? null : [entity.entityId]);
  if (key === null || record.status !== "ready" || record.data === null) return null;
  const value: unknown = (record.data as unknown as Record<string, unknown>)[field];
  return (
    <p className="text-fg-secondary">
      The record holds now: {value === undefined ? <Unknown /> : <span className="text-fg">{String(value)}</span>}
    </p>
  );
}

function ValueDecision({ item }: { item: Item }) {
  const decide = useDecide();
  const [choice, setChoice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const target = item.entityRefs[0];
  return (
    <div className="grid gap-2">
      {target === undefined || item.field === undefined ? null : <CurrentValue entity={target} field={item.field} />}
      <FormField label="Value to keep">
        {(control) => (
          <Select {...control} value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">Choose a value</option>
            <option value="__keep">Keep the value the record holds</option>
            {item.candidates.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.valueSource ?? candidate.key}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <div>
        <Button variant="primary" size="sm" disabled={choice === ""} onClick={() => setConfirming(true)}>
          Record the decision
        </Button>
      </div>
      <ReasonDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Record this decision about the value?"
        description={
          choice === "__keep"
            ? "The record keeps its value. Later imports apply the decision again."
            : "The record takes the chosen value as the source wrote it, and the source record behind it is named for the field."
        }
        label="Note"
        optional
        confirmLabel="Record the decision"
        onConfirm={(note) =>
          decide(
            choice === "__keep"
              ? { fingerprint: item.id, action: "keepCurrent", ...(note === "" ? {} : { note }) }
              : { fingerprint: item.id, action: "chooseValue", candidateKey: choice, ...(note === "" ? {} : { note }) },
          )
        }
      />
    </div>
  );
}

function PersonSummary({ person }: { person: RecordOf<"persons"> | undefined }) {
  if (person === undefined) return <p className="text-fg-secondary">This record does not exist any more.</p>;
  return (
    <dl className="grid gap-0.5 rounded-control border border-border p-2">
      <dt className="sr-only">Name</dt>
      <dd className="font-medium text-fg-strong">{person.displayName}</dd>
      <dt className="sr-only">Affiliation</dt>
      <dd className="text-fg-secondary">{person.affiliationSummary ?? "No affiliation recorded"}</dd>
      <dt className="sr-only">Units</dt>
      <dd className="text-fg-secondary">
        {person.laboratoryIds.length} laboratories, {person.replicationIds.length} replications,{" "}
        {(person.sourceRecordIds ?? []).length} source records
      </dd>
      <dt className="sr-only">Account</dt>
      <dd className="text-fg-secondary">{person.userId === null ? "No account linked" : "Linked to an account"}</dd>
    </dl>
  );
}

function DuplicateDecision({ item, persons }: { item: Item; persons: readonly RecordOf<"persons">[] }) {
  const decide = useDecide();
  const ids = item.entityRefs.filter((ref) => ref.entityType === "person").map((ref) => ref.entityId);
  const [dialog, setDialog] = useState<"distinct" | "merge" | null>(null);
  const [keep, setKeep] = useState(ids[0] ?? "");
  const byId = new Map(persons.map((person) => [person.id, person]));
  const name = (id: string) => byId.get(id)?.displayName ?? id;
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-2" data-testid="duplicate-comparison">
        {ids.map((id) => (
          <PersonSummary key={id} person={byId.get(id)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDialog("distinct")}>
          They are different people
        </Button>
        {ids.length === 2 ? (
          <Button size="sm" onClick={() => setDialog("merge")}>
            Merge the two records
          </Button>
        ) : null}
      </div>
      <ReasonDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        title={dialog === "merge" ? "Merge the two records?" : "Record that these are different people?"}
        description={
          dialog === "merge"
            ? "Everything that refers to the merged record moves to the record you keep: laboratories, memberships, affiliations and identity keys. Its source links are kept on the record you keep, and the merged record is archived. A record linked to an account cannot be merged away."
            : "Both records stay as they are, and later imports apply the decision again."
        }
        label="Note"
        optional
        confirmLabel={dialog === "merge" ? "Merge the records" : "Record the decision"}
        onConfirm={(note) => {
          const merged = ids.find((id) => id !== keep) ?? "";
          return decide(
            dialog === "merge"
              ? {
                  fingerprint: item.id,
                  action: "mergePersons",
                  keepPersonId: keep,
                  mergePersonId: merged,
                  ...(note === "" ? {} : { note }),
                }
              : { fingerprint: item.id, action: "distinctPersons", ...(note === "" ? {} : { note }) },
          );
        }}
      >
        {dialog === "merge" ? (
          <FormField label="Record to keep">
            {(control) => (
              <Select {...control} value={keep} onChange={(event) => setKeep(event.target.value)}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {name(id)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ) : null}
      </ReasonDialog>
    </div>
  );
}

/**
 * Applies the status that the programme decided for a study (docs/MIGRATION_PLAN.md, section 11,
 * question 1). The statuses that the sources stated stay listed on the item.
 */
function StatusDecision({ item, replicationId }: { item: Item; replicationId: string }) {
  const decide = useDecide();
  const administrator = useProgrammeAdministrator();
  const [confirming, setConfirming] = useState(false);
  const decided = studyStatusDecision(replicationId);
  if (decided === null) {
    return (
      <p className="text-fg-secondary">
        Correct the records concerned where they are, then dismiss the item with a note.
      </p>
    );
  }
  const label = REPLICATION_STATUSES.find((status) => status.key === decided.statusKey)?.label ?? decided.statusKey;
  return (
    <div className="grid gap-2" data-testid="programme-decision">
      <p className="text-fg">
        The programme lead decided on {decisionDay(decided.decision)} that this study is {decided.decided}. In the
        portal that is the status {decided.decided === "cancelled" ? `${label} (cancelled)` : label}.
      </p>
      <p className="text-xs text-fg-muted" title={decided.decision.reference}>
        Recorded in {decisionReference(decided.decision)}.
      </p>
      {administrator ? (
        <div>
          <Button variant="primary" size="sm" onClick={() => setConfirming(true)}>
            Apply the decision
          </Button>
        </div>
      ) : (
        <p className="text-fg-secondary">A programme administrator applies this decision.</p>
      )}
      <ReasonDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Apply the decision of the programme?"
        description={`The replication takes the status ${label}, with an entry of its history that names the decision. The statuses that the sources stated stay on this item.`}
        label="Note"
        optional
        confirmLabel="Apply the decision"
        onConfirm={(note) =>
          decide({ fingerprint: item.id, action: "applyProgrammeDecision", ...(note === "" ? {} : { note }) })
        }
      />
    </div>
  );
}

function ItemCard({
  item,
  persons,
  names,
}: {
  item: Item;
  persons: readonly RecordOf<"persons">[];
  names: ReadonlyMap<string, string>;
}) {
  const decide = useDecide();
  const [dismissing, setDismissing] = useState(false);
  const replicationId = item.entityRefs.find((ref) => ref.entityType === "replication")?.entityId ?? null;
  return (
    <article
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="review-item"
      aria-label={RECONCILIATION_KIND_LABELS[item.kind] ?? item.kind}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-md font-medium text-fg-strong">
          <Badge tone="accent">{RECONCILIATION_KIND_LABELS[item.kind] ?? item.kind}</Badge>
          {item.field === undefined ? null : <span className="text-fg-secondary">Field {item.field}</span>}
        </h3>
        <Button size="sm" variant="ghost" onClick={() => setDismissing(true)}>
          Dismiss
        </Button>
      </header>
      {item.entityRefs.length === 0 ? null : (
        <p className="flex flex-wrap gap-x-2">
          <span className="text-fg-muted">Records:</span>
          {item.entityRefs.map((entity) => (
            <span key={`${entity.entityType}:${entity.entityId}`}>
              <RecordLink entity={entity} names={names} />
            </span>
          ))}
        </p>
      )}
      {item.candidates.length === 0 ? null : (
        <div className="grid gap-1">
          <h4 className="text-sm text-fg-muted">What the sources say</h4>
          <ul className="grid gap-1">
            {item.candidates.map((candidate) => (
              <li key={candidate.key} className="flex flex-wrap gap-2">
                <span className="text-fg">{candidate.valueSource ?? <Unknown>No value given</Unknown>}</span>
                <span className="text-xs text-fg-muted">
                  {candidate.sourceRecordId === undefined
                    ? "Edited in the portal"
                    : `Source record ${candidate.sourceRecordId}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.decision === undefined ? null : (
        <p className="text-fg" data-testid="item-decision">
          {item.decision.reference === COMBINED_AMODIO_DECISION.reference
            ? `The programme lead decided on ${decisionDay(item.decision)} that these values cover both studies and stay attached to neither.`
            : `The programme lead decided on ${decisionDay(item.decision)} how these values are treated.`}{" "}
          <span className="text-xs text-fg-muted" title={item.decision.reference}>
            Recorded in {decisionReference(item.decision)}.
          </span>
        </p>
      )}
      <p className="text-xs text-fg-muted">
        Raised by{" "}
        <Link to={batchPath(item.batchId)} className="underline">
          an import of source {item.sourceKey ?? "unknown"}
        </Link>
      </p>
      {item.kind === "conflictingLead" && replicationId !== null ? (
        <LeadDecision item={item} replicationId={replicationId} names={names} />
      ) : item.kind === "valueConflict" ? (
        <ValueDecision item={item} />
      ) : item.kind === "duplicatePerson" ? (
        <DuplicateDecision item={item} persons={persons} />
      ) : item.kind === "statusQuestion" && item.field === "status" && replicationId !== null ? (
        <StatusDecision item={item} replicationId={replicationId} />
      ) : (
        <p className="text-fg-secondary">
          Correct the records concerned where they are, then dismiss the item with a note.
        </p>
      )}
      <ReasonDialog
        open={dismissing}
        onOpenChange={setDismissing}
        title="Dismiss this item?"
        description="The item is closed without changing any record, and it is never reopened."
        label="Note"
        confirmLabel="Dismiss the item"
        onConfirm={(note) => decide({ fingerprint: item.id, action: "dismiss", note })}
      />
    </article>
  );
}

function Queue() {
  const viewer = useViewer();
  const items = useLiveQuery(openItemsQuery(viewer?.can("sealed.read", "programme") === true));
  const persons = usePersons();
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const names = useMemo(
    () => new Map((persons.status === "ready" ? persons.data : []).map((person) => [person.id, person.displayName])),
    [persons],
  );
  return (
    <LiveView
      live={items}
      loadingLabel="Loading the review queue"
      errorTitle="The review queue could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => {
        const kinds = [...new Set(list.map((item) => item.kind))].sort();
        const shown = list
          .filter((item) => kind === "" || item.kind === kind)
          .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
        if (list.length === 0) {
          return (
            <EmptyState
              title="Nothing waits for review"
              description="Conflicts between sources, possible duplicates and other questions of the imports appear here."
            />
          );
        }
        return (
          <div className="grid gap-3">
            <FormField label="Kind of item" className="max-w-sm">
              {(control) => (
                <Select
                  {...control}
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">Every kind ({list.length})</option>
                  {kinds.map((value) => (
                    <option key={value} value={value}>
                      {RECONCILIATION_KIND_LABELS[value] ?? value} ({list.filter((item) => item.kind === value).length})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {shown.slice(offset, offset + PAGE).map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                persons={persons.status === "ready" ? persons.data : []}
                names={names}
              />
            ))}
            <Pagination offset={offset} pageSize={PAGE} total={shown.length} label="items" onChange={setOffset} />
          </div>
        );
      }}
    </LiveView>
  );
}

/** The reconciliation queue, for holders of `reconciliation.resolve`. */
export function ReviewQueuePage() {
  return (
    <AdminPage
      entryId="admin-review-queue"
      description="Questions that the imports could not settle, oldest first. Each decision is applied at once with an audit entry, and a decided item never reopens."
    >
      <Queue />
    </AdminPage>
  );
}
