// The members of a laboratory, and their management by those who manage the laboratory: its
// coordinators put a person forward and end an entry under the security rules, and the person,
// or a programme administrator, confirms the entry through `confirmLaboratoryMembership`.
import { confirmLaboratoryMembershipContract, matchesSearch, searchWords } from "@eegml/shared";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { PersonName } from "@/components/record-names";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, endLaboratoryMember, proposeLaboratoryMember, type RecordOf } from "@/data";
import { LABORATORY_ENTRY_STATUS_LABELS, LABORATORY_ROLE_LABELS } from "@/registry/labels";
import { memberPath } from "@/registry/paths";
import { ALL_PERSONS, useDirectoryItems } from "@/registry/queries";

type Entry = RecordOf<"laboratoryMembers">;
type Role = Entry["role"];

/** How many people the picker lists at once. The search narrows them down. */
const PICKER_LIMIT = 50;

interface PersonOption {
  readonly id: string;
  readonly name: string;
  readonly affiliation: string | null;
}

/** Why a direct write of a member entry was refused, in words the person can act on. */
function entryFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "permission-denied") {
    return "The change was refused. Only the coordinators of this laboratory and the programme manage its members.";
  }
  return "The change could not be saved. Check your connection and try again.";
}

function ProposeMemberDialog({
  uid,
  laboratoryId,
  laboratoryName,
  listed,
}: {
  uid: string;
  laboratoryId: string;
  laboratoryName: string;
  /** The people who have an entry in the laboratory already, whom the picker leaves out. */
  listed: ReadonlySet<string>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // The directory is read only while the dialog is open, so the page itself never waits for it.
  const directory = useDirectoryItems(open ? ALL_PERSONS : null);
  const people = useMemo<readonly PersonOption[]>(
    () =>
      directory.status === "ready"
        ? directory.data
            .filter((person) => person.archivedAt === null && !listed.has(person.id))
            .map((person) => ({
              id: person.id,
              name: person.displayName,
              affiliation: person.affiliationSummary ?? null,
            }))
        : [],
    [directory, listed],
  );
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [representative, setRepresentative] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const words = searchWords(query);
  const matches = useMemo(
    () =>
      (words === null ? [] : people.filter((person) => matchesSearch(words, [person.name, person.affiliation]))).slice(
        0,
        PICKER_LIMIT,
      ),
    [people, words],
  );
  const reset = () => {
    setQuery("");
    setPersonId("");
    setRole("member");
    setRepresentative(false);
    setError(null);
    setFailure(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (personId === "") {
      setError("Search for the person, then choose them.");
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    try {
      await proposeLaboratoryMember(uid, { laboratoryId, personId, role, isAuthorisedRepresentative: representative });
      setOpen(false);
      reset();
      toast.show({
        title: "The person has been put forward.",
        description: "Their entry counts once they, or a programme administrator, confirm it.",
      });
    } catch (saveError) {
      setFailure(entryFailure(saveError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">Propose a member</Button>
      </DialogTrigger>
      <DialogContent
        title={`Propose a member of ${laboratoryName}`}
        description="The person is listed as proposed until they confirm the entry themselves, or a programme administrator confirms it."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="Nobody was put forward." description={failure} />}
          <FormField label="Search the directory" hint="Name or affiliation">
            {(control) => (
              <Input {...control} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            )}
          </FormField>
          <FormField label="Person" error={error}>
            {(control) => (
              <Select {...control} value={personId} onChange={(event) => setPersonId(event.target.value)}>
                <option value="">
                  {directory.status === "loading"
                    ? "Loading the directory"
                    : directory.status === "error"
                      ? "The directory could not be loaded. Close this and try again."
                      : words === null
                        ? "Search first"
                        : matches.length === 0
                          ? "Nobody in the directory matches"
                          : "Choose a person"}
                </option>
                {matches.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.affiliation === null ? person.name : `${person.name}, ${person.affiliation}`}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Role">
            {(control) => (
              <Select {...control} value={role} onChange={(event) => setRole(event.target.value as Role)}>
                {(Object.keys(LABORATORY_ROLE_LABELS) as Role[]).map((key) => (
                  <option key={key} value={key}>
                    {LABORATORY_ROLE_LABELS[key]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={representative}
              onChange={(event) => setRepresentative(event.target.checked)}
            />
            Authorised to represent the laboratory
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Putting forward…" : "Put forward"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntryActions({
  uid,
  entry,
  name,
  canConfirm,
}: {
  uid: string;
  entry: Entry;
  name: string;
  /** Whether the account confirms entries for the programme. */
  canConfirm: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, done: string, failed: (error: unknown) => string) => {
    setBusy(true);
    try {
      await action();
      toast.show({ title: done });
    } catch (error) {
      toast.show({ title: "Nothing was changed.", description: failed(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  if (entry.status === "ended") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {entry.status === "proposed" ? (
        canConfirm ? (
          <Button
            size="sm"
            disabled={busy}
            aria-label={`Confirm the entry of ${name}`}
            onClick={() =>
              run(
                () =>
                  callFunction(confirmLaboratoryMembershipContract, {
                    laboratoryId: entry.laboratoryId,
                    personId: entry.personId,
                    role: entry.role,
                    isAuthorisedRepresentative: entry.isAuthorisedRepresentative,
                  }),
                `The entry of ${name} is confirmed.`,
                (error) => (error instanceof CallableError ? error.message : "Try again in a moment."),
              )
            }
          >
            Confirm
          </Button>
        ) : (
          <span className="text-fg-secondary">Waits for the person to confirm it</span>
        )
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-label={`End the entry of ${name}`}
        onClick={() =>
          run(
            () => endLaboratoryMember(uid, entry.laboratoryId, entry.personId),
            `The entry of ${name} has ended.`,
            entryFailure,
          )
        }
      >
        End
      </Button>
    </div>
  );
}

export interface LaboratoryMembersTabProps {
  readonly uid: string;
  readonly laboratoryId: string;
  readonly laboratoryName: string;
  readonly entries: readonly Entry[];
  readonly personNames: ReadonlyMap<string, string>;
  /** Whether the account manages the laboratory, which shows the controls. The rules decide in any case. */
  readonly canManage: boolean;
  /** Whether the account confirms entries for the programme. */
  readonly canConfirm: boolean;
}

export function LaboratoryMembersTab({
  uid,
  laboratoryId,
  laboratoryName,
  entries,
  personNames,
  canManage,
  canConfirm,
}: LaboratoryMembersTabProps) {
  const shown = entries
    .filter((entry) => entry.archivedAt === null)
    .sort((a, b) =>
      (personNames.get(a.personId) ?? a.personId).localeCompare(personNames.get(b.personId) ?? b.personId, "en"),
    );
  const listed = useMemo(() => new Set(entries.map((entry) => entry.personId)), [entries]);
  return (
    <div className="grid gap-3">
      {canManage ? (
        <div>
          <ProposeMemberDialog uid={uid} laboratoryId={laboratoryId} laboratoryName={laboratoryName} listed={listed} />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState
          title="No member is listed yet"
          description={
            canManage
              ? "Propose the members of the laboratory. Each entry counts once the person, or a programme administrator, confirms it."
              : "The coordinators of the laboratory propose its members, and each person confirms their own entry."
          }
        />
      ) : (
        <div className="relative overflow-x-auto">
          <Table caption="Members of the laboratory">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Member</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Authorised representative</TableHeaderCell>
                <TableHeaderCell>Entry</TableHeaderCell>
                {canManage ? <TableHeaderCell>Actions</TableHeaderCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((entry) => {
                const known = personNames.get(entry.personId);
                const name = known ?? "this member";
                return (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Link to={memberPath(entry.personId)} className="text-fg-accent underline">
                        {known ?? <PersonName id={entry.personId} />}
                      </Link>
                    </TableCell>
                    <TableCell>{LABORATORY_ROLE_LABELS[entry.role]}</TableCell>
                    <TableCell>{entry.isAuthorisedRepresentative ? "Yes" : "No"}</TableCell>
                    <TableCell>{LABORATORY_ENTRY_STATUS_LABELS[entry.status]}</TableCell>
                    {canManage ? (
                      <TableCell>
                        <EntryActions uid={uid} entry={entry} name={name} canConfirm={canConfirm} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
