// Who may read and change a page, for those who hold full access to it (docs/DATA_MODEL.md,
// section 9). A page follows the page above it or its record, or is restricted to the people and
// groups it lists, each at a level. The callable function setPageSharing decides and writes.
import { getPageSharingContract, type PageLevel, setPageSharingContract } from "@eegml/shared";
import { Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, useCallResult } from "@/data";
import type { Members } from "./members";

const LEVEL_LABELS: Readonly<Record<PageLevel, string>> = {
  view: "Can read",
  comment: "Can comment",
  edit: "Can edit",
  full: "Full access",
};

interface Entry {
  readonly principalType: "user" | "group";
  readonly principalId: string;
  readonly level: PageLevel;
  readonly name: string;
}

export function ShareDialog({
  open,
  onOpenChange,
  pageId,
  uid,
  members,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pageId: string;
  readonly uid: string;
  readonly members: Members;
}) {
  const toast = useToast();
  const sharing = useCallResult(getPageSharingContract, open ? { pageId } : null, `${pageId}:${open}`);
  const [mode, setMode] = useState<"inherit" | "restricted">("inherit");
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [person, setPerson] = useState("");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const loaded = sharing.live.status === "ready" ? sharing.live.data : null;
  useEffect(() => {
    if (loaded === null) return;
    setMode(loaded.accessMode);
    setEntries(
      loaded.permissions.flatMap((permission) =>
        permission.principalType === "role"
          ? []
          : [
              {
                principalType: permission.principalType,
                principalId: permission.principalId,
                level: permission.level,
                name: permission.name ?? permission.principalId,
              },
            ],
      ),
    );
    setFailure(null);
  }, [loaded]);

  const add = (entry: Entry) =>
    setEntries((current) =>
      current.some(
        (existing) => existing.principalType === entry.principalType && existing.principalId === entry.principalId,
      )
        ? current
        : [...current, entry],
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(setPageSharingContract, {
        pageId,
        accessMode: mode,
        permissions:
          mode === "inherit"
            ? []
            : entries.map(({ principalType, principalId, level }) => ({ principalType, principalId, level })),
      });
      onOpenChange(false);
      toast.show({ title: "Who may use the page has been saved." });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The sharing could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const listedUsers = new Set(
    entries.filter((entry) => entry.principalType === "user").map((entry) => entry.principalId),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Share the page"
        description="Programme administrators and the core team can always open a page."
        className="max-w-reading"
      >
        <LiveView
          live={sharing.live}
          loadingLabel="Loading who may use the page"
          errorTitle="The sharing of the page could not be loaded."
          onRetry={sharing.reload}
        >
          {(data) => (
            <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
              {failure === null ? null : <ErrorState title="The sharing was not saved." description={failure} />}
              <fieldset className="grid gap-2">
                <legend className="mb-1 font-medium text-fg-strong">Who may use the page</legend>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="access-mode"
                    checked={mode === "inherit"}
                    onChange={() => setMode("inherit")}
                    className="mt-1"
                  />
                  <span>
                    Like the page above it or its record
                    <span className="block text-xs text-fg-muted">
                      The readers and editors follow where the page is.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="access-mode"
                    checked={mode === "restricted"}
                    onChange={() => setMode("restricted")}
                    className="mt-1"
                  />
                  <span>
                    Only the people and groups listed here
                    <span className="block text-xs text-fg-muted">
                      You keep full access. Pages inside follow this page.
                    </span>
                  </span>
                </label>
              </fieldset>
              {mode === "restricted" ? (
                <>
                  {entries.length === 0 ? (
                    <p className="text-fg-muted">Nobody else is listed yet.</p>
                  ) : (
                    <ul className="grid gap-2" aria-label="People and groups with access">
                      {entries.map((entry, index) => (
                        <li
                          key={`${entry.principalType}:${entry.principalId}`}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {entry.name}
                            {entry.principalType === "group" ? " (group)" : entry.principalId === uid ? " (you)" : ""}
                          </span>
                          <span className="w-40">
                            <Select
                              aria-label={`Level of ${entry.name}`}
                              value={entry.level}
                              disabled={entry.principalId === uid}
                              onChange={(event) => {
                                const level = event.target.value as PageLevel;
                                setEntries((current) =>
                                  current.map((item, at) => (at === index ? { ...item, level } : item)),
                                );
                              }}
                            >
                              {(Object.keys(LEVEL_LABELS) as PageLevel[]).map((level) => (
                                <option key={level} value={level}>
                                  {LEVEL_LABELS[level]}
                                </option>
                              ))}
                            </Select>
                          </span>
                          <IconButton
                            label={`Remove ${entry.name}`}
                            disabled={entry.principalId === uid}
                            onClick={() => setEntries((current) => current.filter((_, at) => at !== index))}
                          >
                            <Trash2 aria-hidden="true" strokeWidth={1.8} />
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Add a member">
                      {(control) => (
                        <Select
                          {...control}
                          value={person}
                          onChange={(event) => {
                            const chosen = members.candidates.find((candidate) => candidate.uid === event.target.value);
                            setPerson("");
                            if (chosen !== undefined) {
                              add({ principalType: "user", principalId: chosen.uid, level: "view", name: chosen.name });
                            }
                          }}
                        >
                          <option value="">Choose a member</option>
                          {members.candidates
                            .filter((candidate) => !listedUsers.has(candidate.uid))
                            .map((candidate) => (
                              <option key={candidate.uid} value={candidate.uid}>
                                {candidate.name}
                              </option>
                            ))}
                        </Select>
                      )}
                    </FormField>
                    <FormField label="Add a group">
                      {(control) => (
                        <Select
                          {...control}
                          value={group}
                          disabled={data.groups.length === 0}
                          onChange={(event) => {
                            const chosen = data.groups.find((candidate) => candidate.groupKey === event.target.value);
                            setGroup("");
                            if (chosen !== undefined) {
                              add({
                                principalType: "group",
                                principalId: chosen.groupKey,
                                level: "view",
                                name: chosen.name,
                              });
                            }
                          }}
                        >
                          <option value="">
                            {data.groups.length === 0 ? "No groups exist yet" : "Choose a group"}
                          </option>
                          {data.groups.map((candidate) => (
                            <option key={candidate.groupKey} value={candidate.groupKey}>
                              {candidate.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  </div>
                </>
              ) : null}
              <div>
                <Button type="submit" variant="primary" disabled={busy}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </LiveView>
      </DialogContent>
    </Dialog>
  );
}
