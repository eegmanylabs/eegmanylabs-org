// The planned pauses of a participation: periods in which the laboratory will not collect, which
// the forecast leaves out. Those who manage the participation enter, change and archive them
// directly, under the security rules (docs/DATA_MODEL.md, section 7).
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { createPlannedPause, type RecordOf, updatePlannedPause } from "@/data";
import type { PauseRecord } from "@/registry/recruitment-data";
import type { Viewer } from "@/registry/viewer";
import { formatDay } from "./dates";

export function PausesSection({
  viewer,
  participation,
  pauses,
  canManage,
}: {
  readonly viewer: Viewer;
  readonly participation: RecordOf<"participations">;
  readonly pauses: readonly PauseRecord[];
  readonly canManage: boolean;
}) {
  const toast = useToast();
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const own = pauses
    .filter((pause) => pause.participationId === participation.id && pause.archivedAt === null)
    .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (startsOn === "" || endsOn === "") {
      setError("Enter the first and the last day of the pause.");
      return;
    }
    if (endsOn < startsOn) {
      setError("The pause ends on or after the day it starts.");
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    try {
      await createPlannedPause(viewer.uid, {
        participationId: participation.id,
        replicationId: participation.replicationId,
        laboratoryId: participation.laboratoryId,
        startsOn,
        endsOn,
        reason: reason.trim() === "" ? null : reason.trim(),
      });
      setStartsOn("");
      setEndsOn("");
      setReason("");
      toast.show({ title: "The pause has been planned.", description: "Forecasts leave these days out." });
    } catch {
      setFailure("The pause was not saved. Check that you manage this participation, and try again.");
    } finally {
      setBusy(false);
    }
  };

  const archive = async (pause: PauseRecord) => {
    setFailure(null);
    try {
      await updatePlannedPause(viewer.uid, pause.id, { archive: true });
      toast.show({ title: "The pause has been removed from the plan." });
    } catch {
      setFailure("The pause was not removed. Try again in a moment.");
    }
  };

  return (
    <section aria-labelledby="pauses" className="grid gap-3" data-testid="planned-pauses">
      <h2 id="pauses" className="text-lg text-fg">
        Planned pauses
      </h2>
      <p className="max-w-reading text-sm text-fg-secondary">
        Days on which the laboratory will not collect for this replication. Forecasts count no recruitment on them.
      </p>
      {failure === null ? null : <ErrorState title="Nothing was changed." description={failure} />}
      {own.length === 0 ? (
        <p className="text-sm text-fg-muted">No pauses are planned.</p>
      ) : (
        <Table caption="Planned pauses">
          <TableHead>
            <TableRow>
              <TableHeaderCell>From</TableHeaderCell>
              <TableHeaderCell>To</TableHeaderCell>
              <TableHeaderCell>Reason</TableHeaderCell>
              {canManage ? (
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              ) : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {own.map((pause) => (
              <TableRow key={pause.id}>
                <TableCell>{formatDay(pause.startsOn)}</TableCell>
                <TableCell>{formatDay(pause.endsOn)}</TableCell>
                <TableCell>{pause.reason ?? <span className="text-fg-muted">No reason given</span>}</TableCell>
                {canManage ? (
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => archive(pause)}>
                      Remove
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canManage ? (
        <form
          noValidate
          onSubmit={add}
          className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-end"
          aria-label="Plan a pause"
        >
          <FormField label="First day" error={error}>
            {(control) => (
              <Input {...control} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
            )}
          </FormField>
          <FormField label="Last day">
            {(control) => (
              <Input {...control} type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
            )}
          </FormField>
          <FormField label="Reason (optional)">
            {(control) => (
              <Input
                {...control}
                maxLength={2_000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" disabled={busy}>
            {busy ? "Planning…" : "Plan pause"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
