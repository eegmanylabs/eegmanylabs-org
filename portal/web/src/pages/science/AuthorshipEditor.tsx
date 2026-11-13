// The authorship list of a manuscript (requirement R12.9), which the leads prepare, starting
// from the replication's imported contributor tables, and each person on it confirms. The list
// records its ordering rule, shows the answer of every person, and exports the text a journal
// asks for. A change to an entry asks its person to confirm again.
import {
  type AuthorshipEntryInput,
  type AuthorshipOrderingRule,
  authorshipText,
  CONTRIBUTION_ROLE_LABELS,
  type ContributionRole,
  CREDIT_ROLE_NAMES,
  type CreditRoleKey,
  confirmationSummary,
  contributionRoleSchema,
  contributorRowName,
  creditRoleKeySchema,
  creditRolesFromRow,
  entryConfirmation,
  ORDERING_RULE_LABELS,
  saveAuthorshipListContract,
} from "@eegml/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import { downloadText } from "@/utils/download";
import { CONFIRMATION_LABELS } from "./science-format";

type Entry = RecordOf<"authorshipEntries">;

interface Draft extends AuthorshipEntryInput {
  /** The source values of CRediT cells that a lead has to read, from the contributor row. */
  readonly toReview: readonly string[];
}

const toDraft = (entry: Entry): Draft => ({
  personId: entry.personId,
  contributorId: entry.contributorId,
  kind: entry.kind,
  displayName: entry.displayName,
  affiliations: entry.affiliations,
  orcid: entry.orcid ?? null,
  creditRoles: entry.creditRoles,
  contributionRoles: entry.contributionRoles,
  isCorresponding: entry.isCorresponding,
  toReview: [],
});

const byPosition = (a: Entry, b: Entry) => (a.kind === b.kind ? a.position - b.position : a.kind === "author" ? -1 : 1);

export function AuthorshipEditor({
  manuscript,
  list,
  entries,
  contributors,
  persons,
  canPrepare,
}: {
  manuscript: RecordOf<"manuscripts">;
  list: RecordOf<"authorshipLists"> | null;
  entries: readonly Entry[];
  /** The rows of the replication's imported contributor tables. */
  contributors: readonly RecordOf<"contributors">[];
  /** The people of the directory, for adding someone who is in no contributor table. */
  persons: readonly RecordOf<"persons">[];
  canPrepare: boolean;
}) {
  const toast = useToast();
  const stored = [...entries].sort(byPosition);
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null);
  const [rule, setRule] = useState<AuthorshipOrderingRule>(list?.orderingRule ?? "contribution");
  const [note, setNote] = useState(list?.orderingNote ?? "");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const summary = confirmationSummary(stored);
  const editing = drafts !== null;

  const startFromTable = () => {
    const rows = contributors
      .filter(
        (row) =>
          row.archivedAt === null &&
          row.personId !== null &&
          (row.manuscriptId === null || row.manuscriptId === manuscript.id),
      )
      .sort((a, b) => (a.orderInPublication ?? 0) - (b.orderInPublication ?? 0));
    const seen = new Set<string>();
    const fromTable: Draft[] = [];
    for (const row of rows) {
      if (row.personId === null || seen.has(row.personId)) continue;
      seen.add(row.personId);
      const { roles, toReview } = creditRolesFromRow(row);
      fromTable.push({
        personId: row.personId,
        contributorId: row.id,
        kind: "author",
        displayName:
          contributorRowName(row) ?? persons.find((person) => person.id === row.personId)?.displayName ?? row.personId,
        affiliations:
          row.affiliationSource === undefined || row.affiliationSource.trim() === ""
            ? []
            : [row.affiliationSource.trim()],
        orcid: null,
        creditRoles: [...roles],
        contributionRoles: [],
        isCorresponding: false,
        toReview: toReview.map((item) => `${CREDIT_ROLE_NAMES[item.role]}: "${item.valueSource}"`),
      });
    }
    setDrafts(fromTable);
  };

  const update = (index: number, change: Partial<Draft>) =>
    setDrafts((list) =>
      list === null ? list : list.map((draft, at) => (at === index ? { ...draft, ...change } : draft)),
    );
  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      if (list === null) return list;
      const next = [...list];
      const target = index + by;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target] as Draft, next[index] as Draft];
      return next;
    });

  const save = async (status: "draft" | "inReview" | "final") => {
    const current = drafts ?? stored.map(toDraft);
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(saveAuthorshipListContract, {
        manuscriptId: manuscript.id,
        orderingRule: rule,
        orderingNote: note.trim() === "" ? null : note.trim(),
        status,
        expectedRevision: list?.revision ?? 0,
        entries: current.map(({ toReview: _toReview, ...entry }) => entry),
      });
      toast.show({
        title:
          status === "inReview"
            ? "The list is sent for review."
            : status === "final"
              ? "The list is final."
              : "The list is saved.",
      });
      setDrafts(null);
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The list could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const exportText = () =>
    downloadText(
      `${manuscript.id}-authorship.txt`,
      authorshipText(list ?? { orderingRule: rule }, stored, { title: manuscript.title }),
      "text/plain",
    );

  return (
    <section
      aria-labelledby={`authorship-${manuscript.id}`}
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="authorship"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`authorship-${manuscript.id}`} className="text-md font-medium text-fg-strong">
          Authorship of {manuscript.title}
        </h2>
        {list === null ? (
          <Badge tone="outline">Not prepared</Badge>
        ) : (
          <Badge tone="outline">
            {list.status === "draft" ? "Draft" : list.status === "inReview" ? "In review" : "Final"},{" "}
            {summary.confirmed} of {summary.total} confirmed
          </Badge>
        )}
      </div>

      {!editing ? (
        stored.length === 0 ? (
          <p className="text-sm text-fg-muted">Nobody is on the list yet.</p>
        ) : (
          <ol className="grid gap-1 text-sm" data-testid="authorship-entries">
            {stored.map((entry) => {
              const state = entryConfirmation(entry);
              return (
                <li key={entry.personId} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {entry.kind === "author" ? `${entry.position}. ` : "Acknowledged: "}
                    {entry.displayName}
                  </span>
                  <Badge tone={state === "confirmed" ? "neutral" : "accent"}>{CONFIRMATION_LABELS[state]}</Badge>
                  {state === "changesRequested" && entry.confirmation.note !== undefined ? (
                    <span className="text-fg-secondary">"{entry.confirmation.note}"</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )
      ) : (
        <ol className="grid gap-3">
          {(drafts ?? []).map((draft, index) => (
            <li key={draft.personId} className="grid gap-2 rounded-tile border border-border px-3 py-2">
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Name as published" className="min-w-56 flex-1">
                  {(control) => (
                    <Input
                      {...control}
                      value={draft.displayName}
                      onChange={(event) => update(index, { displayName: event.target.value })}
                    />
                  )}
                </FormField>
                <FormField label={`Place of ${draft.displayName}`}>
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.kind}
                      onChange={(event) => update(index, { kind: event.target.value as Draft["kind"] })}
                    >
                      <option value="author">Author</option>
                      <option value="acknowledgement">Acknowledgement</option>
                    </Select>
                  )}
                </FormField>
                <Button type="button" size="sm" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0}>
                  Move {draft.displayName} up
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => move(index, 1)}
                  disabled={index === (drafts ?? []).length - 1}
                >
                  Move {draft.displayName} down
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDrafts((list) => (list === null ? list : list.filter((_, at) => at !== index)))}
                >
                  Remove {draft.displayName}
                </Button>
              </div>
              <FormField label={`Affiliations of ${draft.displayName}`} hint="One on each line.">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={2}
                    value={draft.affiliations.join("\n")}
                    onChange={(event) =>
                      update(index, {
                        affiliations: event.target.value
                          .split("\n")
                          .map((line) => line.trim())
                          .filter((line) => line !== ""),
                      })
                    }
                  />
                )}
              </FormField>
              <fieldset className="grid gap-1">
                <legend className="text-sm font-medium text-fg-strong">
                  Roles of {draft.displayName} in the replication
                </legend>
                <div className="flex flex-wrap gap-3">
                  {contributionRoleSchema.options.map((role: ContributionRole) => (
                    <label key={role} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.contributionRoles.includes(role)}
                        onChange={(event) =>
                          update(index, {
                            contributionRoles: event.target.checked
                              ? [...draft.contributionRoles, role]
                              : draft.contributionRoles.filter((item) => item !== role),
                          })
                        }
                      />
                      {CONTRIBUTION_ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="grid gap-1">
                <legend className="text-sm font-medium text-fg-strong">CRediT roles of {draft.displayName}</legend>
                <div className="flex flex-wrap gap-3">
                  {creditRoleKeySchema.options.map((role: CreditRoleKey) => (
                    <label key={role} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.creditRoles.includes(role)}
                        onChange={(event) =>
                          update(index, {
                            creditRoles: event.target.checked
                              ? [...draft.creditRoles, role]
                              : draft.creditRoles.filter((item) => item !== role),
                          })
                        }
                      />
                      {CREDIT_ROLE_NAMES[role]}
                    </label>
                  ))}
                </div>
                {draft.toReview.length === 0 ? null : (
                  <p className="text-xs text-fg-muted">
                    The contributor table says more than a tick for: {draft.toReview.join("; ")}. Decide whether the
                    role applies.
                  </p>
                )}
              </fieldset>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isCorresponding}
                  onChange={(event) => update(index, { isCorresponding: event.target.checked })}
                />
                {draft.displayName} is a corresponding author
              </label>
            </li>
          ))}
        </ol>
      )}

      {canPrepare ? (
        <div className="grid gap-3">
          {editing ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Add a person from the directory" className="min-w-56">
                  {(control) => (
                    <Select {...control} value={adding} onChange={(event) => setAdding(event.target.value)}>
                      <option value="">Choose a person</option>
                      {persons
                        .filter(
                          (person) =>
                            person.archivedAt === null && !(drafts ?? []).some((draft) => draft.personId === person.id),
                        )
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.displayName}
                          </option>
                        ))}
                    </Select>
                  )}
                </FormField>
                <Button
                  type="button"
                  size="sm"
                  disabled={adding === ""}
                  onClick={() => {
                    const person = persons.find((candidate) => candidate.id === adding);
                    if (person === undefined) return;
                    setDrafts((list) => [
                      ...(list ?? []),
                      {
                        personId: person.id,
                        contributorId: null,
                        kind: "author",
                        displayName: person.displayName,
                        affiliations: [],
                        orcid: null,
                        creditRoles: [],
                        contributionRoles: [],
                        isCorresponding: false,
                        toReview: [],
                      },
                    ]);
                    setAdding("");
                  }}
                >
                  Add the person
                </Button>
              </div>
              <FormField label="Ordering rule">
                {(control) => (
                  <Select
                    {...control}
                    value={rule}
                    onChange={(event) => setRule(event.target.value as AuthorshipOrderingRule)}
                  >
                    {Object.entries(ORDERING_RULE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField label="Note on the order" hint="Required for another rule.">
                {(control) => (
                  <Textarea {...control} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
                )}
              </FormField>
            </>
          ) : null}
          {failure === null ? null : (
            <p role="alert" className="text-sm text-fg-accent">
              {failure}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button variant="primary" disabled={busy} onClick={() => void save("inReview")}>
                  Save and ask for confirmation
                </Button>
                <Button disabled={busy} onClick={() => void save("draft")}>
                  Save as a draft
                </Button>
                <Button variant="ghost" onClick={() => setDrafts(null)}>
                  Discard the changes
                </Button>
              </>
            ) : (
              <>
                {stored.length === 0 ? (
                  <Button variant="primary" onClick={startFromTable}>
                    Prepare from the contributor table
                  </Button>
                ) : (
                  <Button onClick={() => setDrafts(stored.map(toDraft))}>Edit the list</Button>
                )}
                {stored.length === 0 ? <Button onClick={() => setDrafts([])}>Prepare from scratch</Button> : null}
                {list !== null &&
                list.status !== "final" &&
                summary.total > 0 &&
                summary.confirmed === summary.total ? (
                  <Button disabled={busy} onClick={() => void save("final")}>
                    Mark the list final
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
      {stored.length > 0 && !editing ? (
        <div>
          <Button size="sm" onClick={exportText}>
            Export for the journal
          </Button>
          {summary.confirmed < summary.total ? (
            <p className="mt-1 text-xs text-fg-muted">
              Not everyone has confirmed their entry yet: the export says what the list holds now.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
