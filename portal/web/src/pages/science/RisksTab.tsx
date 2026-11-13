// The risk register of a replication (requirement R7.8): each risk with its likelihood, its
// impact, its owner, its mitigation and when it is next reviewed. Those who manage the
// replication enter risks and change them through `saveRisk`; every reader of the replication's
// scope reads them. Blockers of tasks are on the Risks and blockers view of the tasks page.
import { type CallableInput, type RiskDoc, saveRiskContract } from "@eegml/shared";
import { type FormEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import { usePersonNames } from "@/registry/queries";
import type { Viewer } from "@/registry/viewer";
import { readableDate, readableInstant, SEVERITY_LABELS } from "./science-format";

type Risk = RecordOf<"risks">;
type RiskInput = CallableInput<typeof saveRiskContract>;
type Level = RiskDoc["likelihood"];

const RISK_STATUS_LABELS: Readonly<Record<RiskDoc["status"], string>> = {
  open: "Open",
  mitigating: "Being mitigated",
  accepted: "Accepted",
  closed: "Closed",
};

const LEVEL_RANK: Readonly<Record<Level, number>> = { low: 1, medium: 2, high: 3 };

/** The rating of a risk, likelihood times impact, from 1 to 9: the register lists the highest first. */
function riskRating(risk: Pick<RiskDoc, "likelihood" | "impact">): number {
  return LEVEL_RANK[risk.likelihood] * LEVEL_RANK[risk.impact];
}

/** The date of review of a risk, which is stored as the start of that day in UTC. */
function reviewDate(risk: Risk): string | null {
  return risk.reviewAt === undefined ? null : risk.reviewAt.toDate().toISOString().slice(0, 10);
}

export function RisksTab({
  studyKey,
  viewer,
  risks,
  persons,
}: {
  studyKey: string;
  viewer: Viewer;
  risks: readonly Risk[];
  persons: readonly RecordOf<"persons">[];
}) {
  const [editing, setEditing] = useState<Risk | "new" | null>(null);
  const manages = viewer.access.member && viewer.can("participations.manage", { replicationId: studyKey });
  // Every reader sees the owner's name, read from the directory one person at a time.
  const ownerIds = useMemo(
    () => [...new Set(risks.flatMap((risk) => (risk.ownerPersonId === undefined ? [] : [risk.ownerPersonId])))],
    [risks],
  );
  const owners = usePersonNames(ownerIds);
  const names = owners.status === "ready" ? owners.data : new Map<string, string>();
  const shown = risks
    .filter((risk) => risk.archivedAt === null)
    .sort(
      (a, b) =>
        Number(a.status === "closed") - Number(b.status === "closed") ||
        riskRating(b) - riskRating(a) ||
        a.title.localeCompare(b.title, "en-GB"),
    );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-secondary">
          Risks are listed by their rating, likelihood times impact, with closed risks last.
        </p>
        {manages ? (
          <Button variant="primary" onClick={() => setEditing("new")}>
            Add a risk
          </Button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title="No risks in the register"
          description="Risks to the replication that its leads enter appear here."
        />
      ) : (
        <ol className="grid gap-3" data-testid="risks">
          {shown.map((risk) => {
            const review = reviewDate(risk);
            const owner = risk.ownerPersonId === undefined ? undefined : names.get(risk.ownerPersonId);
            return (
              <li key={risk.id} className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-md font-medium text-fg-strong">{risk.title}</h2>
                  <span className="flex flex-wrap gap-2">
                    <Badge tone={risk.status === "closed" ? "outline" : "accent"}>
                      {RISK_STATUS_LABELS[risk.status]}
                    </Badge>
                    <Badge>{`Likelihood: ${SEVERITY_LABELS[risk.likelihood].toLowerCase()}`}</Badge>
                    <Badge>{`Impact: ${SEVERITY_LABELS[risk.impact].toLowerCase()}`}</Badge>
                  </span>
                </div>
                {risk.description === undefined ? null : <p className="whitespace-pre-wrap">{risk.description}</p>}
                {risk.mitigation === undefined ? null : (
                  <p className="whitespace-pre-wrap text-sm">
                    <span className="font-medium text-fg-strong">Mitigation: </span>
                    {risk.mitigation}
                  </p>
                )}
                <p className="text-xs text-fg-muted">
                  Identified on {readableInstant(risk.identifiedAt)}
                  {owner === undefined ? "" : `. Owner: ${owner}`}
                  {review === null ? "" : `. Next review on ${readableDate(review)}`}
                  {risk.closedAt === null ? "" : `. Closed on ${readableInstant(risk.closedAt)}`}.
                </p>
                {manages ? (
                  <div>
                    <Button size="sm" onClick={() => setEditing(risk)} aria-label={`Change the risk ${risk.title}`}>
                      Change
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {editing === null ? null : (
        <RiskDialog
          studyKey={studyKey}
          risk={editing === "new" ? null : editing}
          persons={persons}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RiskDialog({
  studyKey,
  risk,
  persons,
  onClose,
}: {
  studyKey: string;
  risk: Risk | null;
  persons: readonly RecordOf<"persons">[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(risk?.title ?? "");
  const [description, setDescription] = useState(risk?.description ?? "");
  const [likelihood, setLikelihood] = useState<Level>(risk?.likelihood ?? "medium");
  const [impact, setImpact] = useState<Level>(risk?.impact ?? "medium");
  const [mitigation, setMitigation] = useState(risk?.mitigation ?? "");
  const [ownerPersonId, setOwnerPersonId] = useState(risk?.ownerPersonId ?? "");
  const [status, setStatus] = useState<RiskInput["status"]>(risk?.status ?? "open");
  const [reviewAt, setReviewAt] = useState(risk === null ? "" : (reviewDate(risk) ?? ""));
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = persons
    .filter((person) => person.archivedAt === null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en-GB"));
  const levels = (Object.keys(SEVERITY_LABELS) as Level[]).map((key) => (
    <option key={key} value={key}>
      {SEVERITY_LABELS[key]}
    </option>
  ));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "") return setFailure("Give the risk a title.");
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(saveRiskContract, {
        riskId: risk?.id ?? null,
        scopeType: "replication",
        scopeId: studyKey,
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        likelihood,
        impact,
        mitigation: mitigation.trim() === "" ? null : mitigation.trim(),
        ownerPersonId: ownerPersonId === "" ? null : ownerPersonId,
        status,
        reviewAt: reviewAt === "" ? null : reviewAt,
      });
      toast.show({ title: risk === null ? "Risk added." : "Risk changed." });
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The risk could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title={risk === null ? "Add a risk" : "Change a risk"}
        description="The register keeps who changed each risk and when, in the audit trail."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Title">
            {(control) => <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} />}
          </FormField>
          <FormField label="Description">
            {(control) => (
              <Textarea {...control} value={description} onChange={(event) => setDescription(event.target.value)} />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Likelihood">
              {(control) => (
                <Select
                  {...control}
                  value={likelihood}
                  onChange={(event) => setLikelihood(event.target.value as Level)}
                >
                  {levels}
                </Select>
              )}
            </FormField>
            <FormField label="Impact">
              {(control) => (
                <Select {...control} value={impact} onChange={(event) => setImpact(event.target.value as Level)}>
                  {levels}
                </Select>
              )}
            </FormField>
          </div>
          <FormField label="Mitigation">
            {(control) => (
              <Textarea {...control} value={mitigation} onChange={(event) => setMitigation(event.target.value)} />
            )}
          </FormField>
          <FormField label="Owner">
            {(control) => (
              <Select {...control} value={ownerPersonId} onChange={(event) => setOwnerPersonId(event.target.value)}>
                <option value="">No owner</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Status">
              {(control) => (
                <Select
                  {...control}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as RiskInput["status"])}
                >
                  {(Object.keys(RISK_STATUS_LABELS) as RiskInput["status"][]).map((key) => (
                    <option key={key} value={key}>
                      {RISK_STATUS_LABELS[key]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Next review">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={reviewAt}
                  onChange={(event) => setReviewAt(event.target.value)}
                />
              )}
            </FormField>
          </div>
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
              {busy ? "Saving" : risk === null ? "Add the risk" : "Save the risk"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
