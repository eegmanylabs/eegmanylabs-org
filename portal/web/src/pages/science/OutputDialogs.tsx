// The dialogs through which the leads of a replication record its outputs (requirements R12.4
// and R12.10): an output itself, an event of its life, a milestone planned as a task, and a
// document such as a draft or an OSF page linked to it. Each goes through a callable function or
// a write the security rules check; the interface decides nothing.
import {
  type CallableInput,
  type ManuscriptEventKind,
  type ManuscriptMilestone,
  manuscriptKindSchema,
  osfIdentifierOf,
  planManuscriptMilestoneContract,
  recordManuscriptEventContract,
  STATUSES_AFTER_EVENT,
  saveManuscriptContract,
  suggestedStatus,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, linkDocumentToManuscript, type RecordOf } from "@/data";
import { MANUSCRIPT_KIND_LABELS, MANUSCRIPT_STATUS_LABELS } from "@/registry/labels";
import { DECISION_OUTCOME_LABELS, EVENT_KIND_LABELS, MILESTONE_NAMES, todayIsoDate } from "./science-format";

type Manuscript = RecordOf<"manuscripts">;

function Footer({ busy, label, failure }: { busy: boolean; label: string; failure: string | null }) {
  return (
    <>
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
          {label}
        </Button>
      </div>
    </>
  );
}

/** Runs a call of a dialog, with its busy state and the words of a refusal. */
function useCall(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
      toast.show({ title: done });
      onDone();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : fallback);
    } finally {
      setBusy(false);
    }
  };
  return { busy, failure, setFailure, run };
}

const blankOrNull = (value: string) => (value.trim() === "" ? null : value.trim());

/** Creates or changes an output of a replication. */
export function ManuscriptDialog({
  studyKey,
  manuscript,
  kinds,
  manuscripts,
  hypotheses,
  datasets,
  onClose,
}: {
  studyKey: string;
  manuscript: Manuscript | null;
  /** The kinds offered: the Registered Reports alone on the reports tab. */
  kinds: readonly Manuscript["kind"][];
  manuscripts: readonly Manuscript[];
  hypotheses: readonly RecordOf<"replicationHypotheses">[];
  datasets: readonly RecordOf<"datasets">[];
  onClose: () => void;
}) {
  const { busy, failure, setFailure, run } = useCall(onClose);
  const [title, setTitle] = useState(manuscript?.title ?? "");
  const [kind, setKind] = useState<Manuscript["kind"]>(manuscript?.kind ?? kinds[0] ?? "article");
  const [journal, setJournal] = useState(manuscript?.journal ?? "");
  const [doi, setDoi] = useState(manuscript?.doi ?? "");
  const [preprintDoi, setPreprintDoi] = useState(manuscript?.preprintDoi ?? "");
  const [osfUrl, setOsfUrl] = useState(manuscript?.osfUrl ?? "");
  const [authorsShort, setAuthorsShort] = useState(manuscript?.authorsShort ?? "");
  const [stage1, setStage1] = useState(manuscript?.stage1ManuscriptId ?? "");
  const [reported, setReported] = useState<readonly string[]>(manuscript?.hypothesisIds ?? []);
  const [described, setDescribed] = useState<readonly string[]>(manuscript?.datasetIds ?? []);
  const [repositoryUrl, setRepositoryUrl] = useState(manuscript?.repositoryUrl ?? "");
  const [outputVersion, setOutputVersion] = useState(manuscript?.outputVersion ?? "");
  const stage1Reports = manuscripts.filter((item) => item.kind === "stage1Rr" && item.id !== manuscript?.id);
  const releases = kind === "software" || kind === "dataset";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "") return setFailure("Give the output a title.");
    await run(
      () =>
        callFunction(saveManuscriptContract, {
          manuscriptId: manuscript?.id ?? null,
          replicationId: studyKey,
          title: title.trim(),
          kind,
          journal: blankOrNull(journal),
          doi: blankOrNull(doi),
          preprintDoi: blankOrNull(preprintDoi),
          osfUrl: blankOrNull(osfUrl),
          authorsShort: blankOrNull(authorsShort),
          stage1ManuscriptId: kind === "stage2Rr" && stage1 !== "" ? stage1 : null,
          hypothesisIds: [...reported],
          datasetIds: [...described],
          repositoryUrl: releases ? blankOrNull(repositoryUrl) : null,
          outputVersion: releases ? blankOrNull(outputVersion) : null,
        }),
      manuscript === null ? "Output created." : "Output saved.",
      "The output could not be saved. Try again.",
    );
  };

  const field = (label: string, value: string, set: (value: string) => void, hint?: string) => (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => <Input {...control} value={value} onChange={(event) => set(event.target.value)} />}
    </FormField>
  );

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title={
          manuscript === null
            ? kinds.every((item) => item === "stage1Rr" || item === "stage2Rr")
              ? "New Registered Report"
              : "New output"
            : "Change the output"
        }
        description="A new output starts as planned. Its status moves with the events you record."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {field("Title", title, setTitle)}
          <FormField label="Kind">
            {(control) => (
              <Select {...control} value={kind} onChange={(event) => setKind(event.target.value as Manuscript["kind"])}>
                {manuscriptKindSchema.options
                  .filter((option) => kinds.includes(option))
                  .map((option) => (
                    <option key={option} value={option}>
                      {MANUSCRIPT_KIND_LABELS[option]}
                    </option>
                  ))}
              </Select>
            )}
          </FormField>
          {kind === "stage2Rr" ? (
            <FormField label="Stage 1 report">
              {(control) => (
                <Select {...control} value={stage1} onChange={(event) => setStage1(event.target.value)}>
                  <option value="">None yet</option>
                  {stage1Reports.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {field("Journal or server", journal, setJournal, "Optional.")}
          {field("DOI", doi, setDoi, "Optional, for example 10.1000/example.")}
          {field("Preprint DOI", preprintDoi, setPreprintDoi, "Optional.")}
          {field("OSF page", osfUrl, setOsfUrl, "Optional.")}
          {field("Authors in short", authorsShort, setAuthorsShort, "Optional, for example Sample et al.")}
          {releases
            ? field("Repository", repositoryUrl, setRepositoryUrl, "Where the code or the data is published.")
            : null}
          {releases ? field("Version released", outputVersion, setOutputVersion, "Optional.") : null}
          {hypotheses.length === 0 ? null : (
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium text-fg-strong">Hypotheses it reports</legend>
              {hypotheses.map((hypothesis) => (
                <label key={hypothesis.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reported.includes(hypothesis.id)}
                    onChange={(event) =>
                      setReported((list) =>
                        event.target.checked ? [...list, hypothesis.id] : list.filter((id) => id !== hypothesis.id),
                      )
                    }
                  />
                  Hypothesis {hypothesis.hypothesisNumber}
                </label>
              ))}
            </fieldset>
          )}
          {datasets.length === 0 ? null : (
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium text-fg-strong">Datasets it describes or publishes</legend>
              {datasets.map((dataset) => (
                <label key={dataset.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={described.includes(dataset.id)}
                    onChange={(event) =>
                      setDescribed((list) =>
                        event.target.checked ? [...list, dataset.id] : list.filter((id) => id !== dataset.id),
                      )
                    }
                  />
                  {dataset.datasetKey}
                </label>
              ))}
            </fieldset>
          )}
          <Footer busy={busy} failure={failure} label={manuscript === null ? "Create the output" : "Save the output"} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

type EventInput = CallableInput<typeof recordManuscriptEventContract>;

/** Records a submission, a review round, a decision or another step of an output. */
export function EventDialog({
  manuscript,
  links,
  onClose,
}: {
  manuscript: Manuscript;
  links: readonly RecordOf<"documentLinks">[];
  onClose: () => void;
}) {
  const { busy, failure, run } = useCall(onClose);
  const [kind, setKind] = useState<ManuscriptEventKind>("submission");
  const [outcome, setOutcome] = useState<NonNullable<EventInput["outcome"]>>("minorRevision");
  const [status, setStatus] = useState<string>(suggestedStatus("submission", null) ?? "");
  const [occurredAt, setOccurredAt] = useState(todayIsoDate());
  const [dueAt, setDueAt] = useState("");
  const [round, setRound] = useState("");
  const [summary, setSummary] = useState("");
  const [documents, setDocuments] = useState<readonly string[]>([]);
  const choose = (next: ManuscriptEventKind, nextOutcome = outcome) => {
    setKind(next);
    setStatus(suggestedStatus(next, next === "decision" ? nextOutcome : null) ?? "");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await run(
      () =>
        callFunction(recordManuscriptEventContract, {
          manuscriptId: manuscript.id,
          kind,
          round: round === "" ? null : Number(round),
          occurredAt,
          dueAt: dueAt === "" ? null : dueAt,
          outcome: kind === "decision" ? outcome : null,
          summary: blankOrNull(summary),
          documentLinkIds: [...documents],
          status: status === "" ? null : (status as EventInput["status"]),
        }),
      "Event recorded.",
      "The event could not be recorded. Try again.",
    );
  };

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent title="Record an event" description={`Of ${manuscript.title}`}>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Event">
            {(control) => (
              <Select {...control} value={kind} onChange={(event) => choose(event.target.value as ManuscriptEventKind)}>
                {Object.entries(EVENT_KIND_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {kind === "decision" ? (
            <FormField label="Outcome">
              {(control) => (
                <Select
                  {...control}
                  value={outcome}
                  onChange={(event) => {
                    const next = event.target.value as NonNullable<EventInput["outcome"]>;
                    setOutcome(next);
                    choose("decision", next);
                  }}
                >
                  {Object.entries(DECISION_OUTCOME_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField label="Status afterwards">
            {(control) => (
              <Select {...control} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">{`Stays ${MANUSCRIPT_STATUS_LABELS[manuscript.status].toLowerCase()}`}</option>
                {STATUSES_AFTER_EVENT[kind].map((option) => (
                  <option key={option} value={option}>
                    {MANUSCRIPT_STATUS_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Date">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            )}
          </FormField>
          {kind === "reviewRound" || kind === "decision" ? (
            <FormField label="Round" hint="Optional.">
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0}
                  max={100}
                  value={round}
                  onChange={(event) => setRound(event.target.value)}
                />
              )}
            </FormField>
          ) : null}
          <FormField label="Due by" hint="Optional, for example the date by which a revision is due.">
            {(control) => (
              <Input {...control} type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            )}
          </FormField>
          <FormField label="Summary" hint="Optional.">
            {(control) => (
              <Textarea {...control} value={summary} onChange={(event) => setSummary(event.target.value)} />
            )}
          </FormField>
          {links.length === 0 ? null : (
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium text-fg-strong">Documents</legend>
              {links.map((link) => (
                <label key={link.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={documents.includes(link.id)}
                    onChange={(event) =>
                      setDocuments((list) =>
                        event.target.checked ? [...list, link.id] : list.filter((id) => id !== link.id),
                      )
                    }
                  />
                  {link.title ?? link.url}
                </label>
              ))}
            </fieldset>
          )}
          <Footer busy={busy} failure={failure} label="Record the event" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Plans a milestone of an output as a task of a task list of its replication. */
export function MilestoneDialog({
  manuscript,
  lists,
  onClose,
}: {
  manuscript: Manuscript;
  lists: readonly RecordOf<"taskLists">[];
  onClose: () => void;
}) {
  const { busy, failure, setFailure, run } = useCall(onClose);
  const [milestone, setMilestone] = useState<ManuscriptMilestone>("submission");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (listId === "" || dueDate === "") return setFailure("Choose a task list and the planned date.");
    await run(
      () => callFunction(planManuscriptMilestoneContract, { manuscriptId: manuscript.id, milestone, listId, dueDate }),
      "Milestone planned.",
      "The milestone could not be planned. Try again.",
    );
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title="Plan a milestone"
        description="The milestone appears in the task list and on the timelines of the replication. Recording the step completes it."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Milestone">
            {(control) => (
              <Select
                {...control}
                value={milestone}
                onChange={(event) => setMilestone(event.target.value as ManuscriptMilestone)}
              >
                {Object.entries(MILESTONE_NAMES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Task list">
            {(control) => (
              <Select {...control} value={listId} onChange={(event) => setListId(event.target.value)}>
                {lists.length === 0 ? <option value="">The replication has no task list you manage</option> : null}
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Planned date">
            {(control) => (
              <Input {...control} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            )}
          </FormField>
          <Footer busy={busy} failure={failure} label="Plan the milestone" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Links a draft, an OSF page or another document to an output. */
export function LinkDialog({ manuscript, uid, onClose }: { manuscript: Manuscript; uid: string; onClose: () => void }) {
  const { busy, failure, setFailure, run } = useCall(onClose);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = url.trim();
    if (!/^https?:\/\/\S+$/.test(address) || title.trim() === "") return setFailure("Give an address and a title.");
    const kind =
      osfIdentifierOf(address) !== null ? "osf" : /docs\.google\.com\/document/.test(address) ? "googleDoc" : "url";
    await run(
      () =>
        linkDocumentToManuscript(uid, {
          manuscriptId: manuscript.id,
          replicationId: manuscript.replicationId ?? "",
          kind,
          url: address,
          title: title.trim(),
        }),
      "Document linked.",
      "The document could not be linked. Try again.",
    );
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title="Link a document"
        description="A draft in Google Docs, an OSF page or another address. An OSF page can be checked against OSF once linked."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Address">
            {(control) => (
              <Input {...control} type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
            )}
          </FormField>
          <FormField label="Title">
            {(control) => <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} />}
          </FormField>
          <Footer busy={busy} failure={failure} label="Link the document" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
