import { confirmLaboratoryMembershipContract } from "@eegml/shared";
import { useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { LABORATORY_ROLE_LABELS } from "@/registry/labels";
import { laboratoryEntriesOfPerson, useLaboratories } from "@/registry/queries";

type Entry = RecordOf<"laboratoryMembers">;

function ConfirmEntry({ entry, laboratoryName }: { entry: Entry; laboratoryName: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      aria-label={`Confirm that you are ${LABORATORY_ROLE_LABELS[entry.role].toLowerCase()} of ${laboratoryName}`}
      onClick={async () => {
        setBusy(true);
        try {
          await callFunction(confirmLaboratoryMembershipContract, {
            laboratoryId: entry.laboratoryId,
            personId: entry.personId,
            role: entry.role,
            isAuthorisedRepresentative: entry.isAuthorisedRepresentative,
          });
          toast.show({ title: "Your membership of the laboratory is confirmed." });
        } catch (error) {
          toast.show({
            title: "Your membership was not confirmed.",
            description: error instanceof CallableError ? error.message : "Try again in a moment.",
            tone: "error",
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      Confirm
    </Button>
  );
}

/** What waits for the member: entries of laboratories that name the member and ask to be confirmed. */
export function PendingItemsPanel() {
  const { access } = useAuth();
  const personId = access.status === "ready" && access.data?.member === true ? access.data.personId : null;
  const entries = useLiveQuery(personId === null ? null : laboratoryEntriesOfPerson(personId));
  const laboratories = useLaboratories();
  const names = useMemo(
    () =>
      new Map(
        (laboratories.status === "ready" ? laboratories.data : []).map((laboratory) => [
          laboratory.id,
          laboratory.name,
        ]),
      ),
    [laboratories],
  );
  if (personId === null) return null;
  return (
    <LiveView
      live={entries}
      loadingLabel="Loading what waits for you"
      errorTitle="What waits for you could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => {
        const proposed = list.filter((entry) => entry.status === "proposed" && entry.archivedAt === null);
        if (proposed.length === 0) return null;
        return (
          <section
            aria-labelledby="pending-items-heading"
            className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
            data-testid="pending-items"
          >
            <h2 id="pending-items-heading" className="text-lg font-medium tracking-title text-fg-strong">
              Waiting for you
            </h2>
            <p className="text-fg-secondary">
              These laboratories list you as a member. Confirm each one that is right.
            </p>
            <ul className="grid gap-2">
              {proposed.map((entry) => {
                const name = names.get(entry.laboratoryId) ?? entry.laboratoryId;
                return (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {name}: {LABORATORY_ROLE_LABELS[entry.role]}
                    </span>
                    <ConfirmEntry entry={entry} laboratoryName={name} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      }}
    </LiveView>
  );
}
