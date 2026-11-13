// Home: the member's own entries on the authorship lists that the leads of a manuscript have
// sent for confirmation (requirement R12.9). Each contributor confirms their own entry, or asks
// the leads for a change with a note; the function refuses an answer to an entry that has
// changed since it was read. Nothing about the other people on a list is shown here.
import {
  CONTRIBUTION_ROLE_LABELS,
  CREDIT_ROLE_NAMES,
  listMyAuthorshipEntriesContract,
  type MyAuthorshipEntry,
  respondToAuthorshipEntryContract,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { Detail, Details } from "@/components/registry/details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, useCallResult } from "@/data";
import { replicationPath } from "@/registry/paths";

const ANSWER_LABELS: Readonly<Record<MyAuthorshipEntry["confirmation"]["status"], string>> = {
  pending: "Waiting for your answer",
  confirmed: "Confirmed",
  changesRequested: "Change requested",
};

/** Whether the entry waits for an answer: never answered, or changed since the last answer. */
const waits = (entry: MyAuthorshipEntry) =>
  entry.listStatus === "inReview" &&
  (entry.confirmation.status === "pending" || entry.confirmation.revision !== entry.entryRevision);

export function AuthorshipPanel() {
  const { access } = useAuth();
  const record = access.status === "ready" ? access.data : null;
  const linked = record?.member === true && record.personId !== null;
  const { live, reload } = useCallResult(listMyAuthorshipEntriesContract, linked ? {} : null, "mine");
  if (!linked || (live.status === "ready" && live.data.entries.length === 0)) return null;
  return (
    <section
      aria-labelledby="authorship-panel-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
      data-testid="authorship-panel"
    >
      <h2 id="authorship-panel-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Your authorship entries
      </h2>
      <LiveView
        live={live}
        loadingLabel="Loading your authorship entries"
        errorTitle="Your authorship entries could not be loaded."
        onRetry={reload}
      >
        {({ entries }) => {
          const open = entries.filter(waits);
          return (
            <>
              <p className="text-fg-secondary">
                {open.length === 0
                  ? "You have answered every entry the leads have sent you."
                  : `The leads ask you to check ${open.length === 1 ? "one entry" : `${open.length} entries`}: your name, affiliations and roles as they will be published.`}
              </p>
              <ul className="grid gap-3">
                {entries.map((entry) => (
                  <EntryItem key={entry.manuscriptId} entry={entry} onAnswered={reload} />
                ))}
              </ul>
            </>
          );
        }}
      </LiveView>
    </section>
  );
}

function EntryItem({ entry, onAnswered }: { entry: MyAuthorshipEntry; onAnswered: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const answerable = entry.listStatus === "inReview";
  const current = entry.confirmation.revision === entry.entryRevision;
  const status = current ? entry.confirmation.status : "pending";

  const confirm = async () => {
    setBusy(true);
    try {
      await callFunction(respondToAuthorshipEntryContract, {
        manuscriptId: entry.manuscriptId,
        response: "confirmed",
        entryRevision: entry.entryRevision,
        note: null,
      });
      toast.show({ title: "Your entry is confirmed." });
      onAnswered();
    } catch (error) {
      toast.show({
        title: "Your entry could not be confirmed.",
        description: error instanceof CallableError ? error.message : "Try again in a minute.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-2 rounded-tile border border-border px-4 py-3" data-testid="authorship-entry">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="grid min-w-0 gap-1 break-words">
          <span className="font-medium text-fg-strong">{entry.manuscriptTitle}</span>
          {entry.replicationId === null ? null : (
            <Link
              to={`${replicationPath(entry.replicationId)}?tab=outputs`}
              className="text-sm text-fg-accent underline"
            >
              {entry.replicationId}
            </Link>
          )}
        </span>
        <Badge tone={status === "pending" ? "solid" : "outline"}>{ANSWER_LABELS[status]}</Badge>
      </div>
      <Details>
        <Detail term="Listed as">
          {entry.kind === "author" ? `Author ${entry.position}` : "Acknowledged"}
          {entry.isCorresponding ? ", corresponding author" : ""}
        </Detail>
        <Detail term="Name">{entry.displayName}</Detail>
        <Detail term="Affiliations">
          {entry.affiliations.length === 0 ? "None given" : entry.affiliations.join("; ")}
        </Detail>
        <Detail term="ORCID">{entry.orcid ?? "None given"}</Detail>
        <Detail term="Contributions">
          {entry.contributionRoles.length === 0
            ? "None given"
            : entry.contributionRoles.map((role) => CONTRIBUTION_ROLE_LABELS[role]).join(", ")}
        </Detail>
        <Detail term="CRediT roles">
          {entry.creditRoles.length === 0
            ? "None given"
            : entry.creditRoles.map((role) => CREDIT_ROLE_NAMES[role]).join(", ")}
        </Detail>
        {current && entry.confirmation.note !== null ? (
          <Detail term="Your note">{entry.confirmation.note}</Detail>
        ) : null}
      </Details>
      {answerable ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={busy || status === "confirmed"} onClick={() => void confirm()}>
            Confirm my entry<span className="sr-only"> on {entry.manuscriptTitle}</span>
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setAsking(true)}>
            Request a change<span className="sr-only"> to my entry on {entry.manuscriptTitle}</span>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">The list is final.</p>
      )}
      {asking ? (
        <ChangeDialog
          entry={entry}
          onClose={() => setAsking(false)}
          onSent={() => {
            setAsking(false);
            onAnswered();
          }}
        />
      ) : null}
    </li>
  );
}

function ChangeDialog({
  entry,
  onClose,
  onSent,
}: {
  entry: MyAuthorshipEntry;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (note.trim() === "") return setFailure("Say what should change.");
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(respondToAuthorshipEntryContract, {
        manuscriptId: entry.manuscriptId,
        response: "changesRequested",
        entryRevision: entry.entryRevision,
        note: note.trim(),
      });
      toast.show({ title: "Your request has been sent to the leads." });
      onSent();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The request could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title="Request a change to your entry"
        description={`The leads of ${entry.manuscriptTitle} read your note and change the list.`}
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="What should change">
            {(control) => (
              <Textarea {...control} rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </FormField>
          {failure === null ? null : (
            <p role="alert" className="text-sm text-fg-accent">
              {failure}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={busy}>
              Send the request
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
