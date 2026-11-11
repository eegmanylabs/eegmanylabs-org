// A new meeting: a page of the kind `meeting` at the top of the workspace, which opens with the
// sections of a meeting written in: its date, its attendees as mentions, who are told of it, and
// headings for the agenda, the notes, the decisions and the action items.
import { createPageContract } from "@eegml/shared";
import { CalendarPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { CallableError, callFunction } from "@/data";
import { pagePath } from "@/registry/paths";
import type { MentionCandidate } from "./members";

export function NewMeetingDialog({ members }: { readonly members: readonly MentionCandidate[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [attendees, setAttendees] = useState<readonly string[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = members
    .filter((member) => member.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .slice(0, 50);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "" || date === "") {
      setError("Give the meeting a title and a date.");
      return;
    }
    setError(null);
    setBusy(true);
    setFailure(null);
    try {
      const { pageId } = await callFunction(createPageContract, {
        parentPageId: null,
        title: title.trim(),
        kind: "meeting",
      });
      setOpen(false);
      const params = new URLSearchParams({ start: "meeting", date, attendees: attendees.join(",") });
      navigate(`${pagePath(pageId)}?${params.toString()}`);
    } catch (callError) {
      setFailure(
        callError instanceof CallableError ? callError.message : "The meeting could not be created. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarPlus aria-hidden="true" strokeWidth={1.8} />
          New meeting
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New meeting"
        description="The page of the meeting opens with its agenda, attendees, notes, decisions and action items."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="The meeting was not created." description={failure} />}
          <FormField label="Title" error={error}>
            {(control) => (
              <Input {...control} value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
            )}
          </FormField>
          <FormField label="Date">
            {(control) => (
              <Input {...control} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            )}
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Attendees, who are told of the meeting</legend>
            <Input
              aria-label="Find a member"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Find a member"
            />
            <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-control border border-border p-2">
              {shown.map((member) => (
                <li key={member.uid}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent-strong"
                      checked={attendees.includes(member.uid)}
                      onChange={(event) =>
                        setAttendees(
                          event.target.checked
                            ? [...attendees, member.uid]
                            : attendees.filter((uid) => uid !== member.uid),
                        )
                      }
                    />
                    {member.name}
                  </label>
                </li>
              ))}
              {shown.length === 0 ? <li className="text-sm text-fg-muted">No member has that name.</li> : null}
            </ul>
          </fieldset>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating the meeting…" : "Create the meeting"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
