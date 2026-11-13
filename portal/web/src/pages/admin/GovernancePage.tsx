import {
  type AccessReview,
  attestAccessReviewContract,
  decideErasureContract,
  exportPersonDataContract,
  getAccessReviewContract,
  getRetentionContract,
  type ListedErasureRequest,
  listErasureRequestsContract,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  RETENTION_TARGET_LABELS,
  RETENTION_TARGETS,
  type RetentionOverview,
  type RetentionTarget,
  requestErasureContract,
  runRetentionSweepContract,
  setRetentionPeriodContract,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, useCallResult } from "@/data";
import { downloadText } from "@/utils/download";
import { AdminPage } from "./AdminPage";
import { useAccountNames } from "./accounts";
import { PersonSearch } from "./person-search";
import { ReasonDialog } from "./ReasonDialog";

const TABS = ["export", "erasure", "review", "retention"] as const;
type TabId = (typeof TABS)[number];
const TAB_LABELS: Readonly<Record<TabId, string>> = {
  export: "Subject access",
  erasure: "Erasure",
  review: "Access review",
  retention: "Retention",
};

const messageOf = (error: unknown) => (error instanceof CallableError ? error : new CallableError("internal")).message;

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-tile border border-border bg-surface px-4 py-4" aria-label={title}>
      <div className="grid gap-1">
        <h2 className="text-md font-medium text-fg-strong">{title}</h2>
        <p className="text-fg-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SubjectAccess() {
  const toast = useToast();
  const [personId, setPersonId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const download = async () => {
    if (personId === null) return;
    setBusy(true);
    setFailure(null);
    try {
      const exported = await callFunction(exportPersonDataContract, { personId });
      downloadText(
        `subject-access-${personId}-${exported.exportedAt.slice(0, 10)}.json`,
        `${JSON.stringify(exported, null, 2)}\n`,
        "application/json",
      );
      toast.show({
        title: "The export has been downloaded",
        description: `${exported.documents.length} documents and ${exported.accounts.length} accounts.${
          exported.specialCategoryIncluded ? " Special-category data is included under your grant." : ""
        }`,
      });
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Export everything held about a person"
      description="A JSON file of every document about the person and the accounts linked to them. Special-category data is included only while you hold a named grant to read it. Each export is recorded in the audit log."
    >
      <PersonSearch groupName="subject-access-person" chosen={personId} onChoose={setPersonId} />
      {failure === null ? null : <ErrorState title="The export could not be made." description={failure} />}
      <div>
        <Button variant="primary" size="sm" disabled={personId === null || busy} onClick={() => void download()}>
          {busy ? "Exporting" : "Download the export"}
        </Button>
      </div>
    </Section>
  );
}

const STATUS_LABELS: Readonly<Record<ListedErasureRequest["status"], string>> = {
  pendingApproval: "Waiting for a second administrator",
  approved: "Approved, not yet completed",
  applied: "Erased",
  rejected: "Rejected",
};

function ErasureRequests({
  requests,
  onChanged,
}: {
  requests: readonly ListedErasureRequest[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const name = useAccountNames(
    requests.flatMap((request) => [request.requestedBy, ...(request.decidedBy ? [request.decidedBy] : [])]),
  );
  const [deciding, setDeciding] = useState<{ request: ListedErasureRequest; decision: "approve" | "reject" } | null>(
    null,
  );
  if (requests.length === 0) {
    return (
      <EmptyState
        title="No erasure has been requested"
        description="Requests appear here until they are decided, and stay as a record afterwards."
      />
    );
  }
  return (
    <>
      <HorizontalScroll>
        <Table caption="Erasure requests, newest first">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Person</TableHeaderCell>
              <TableHeaderCell>Reason</TableHeaderCell>
              <TableHeaderCell>Requested</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Decision</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.requestId} className="align-top" data-testid="erasure-request">
                <TableCell>{request.personName ?? <Unknown>{request.personId}</Unknown>}</TableCell>
                <TableCell className="max-w-80 whitespace-pre-wrap">{request.reason}</TableCell>
                <TableCell>
                  {formatDateTime(request.requestedAt)} by {name(request.requestedBy)}
                </TableCell>
                <TableCell>
                  <Badge tone={request.status === "applied" ? "neutral" : "accent"}>
                    {STATUS_LABELS[request.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {request.status === "pendingApproval" ||
                  (request.status === "approved" && request.appliedAt === null) ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" onClick={() => setDeciding({ request, decision: "approve" })}>
                        {request.status === "approved" ? "Complete the erasure" : "Approve and erase"}
                      </Button>
                      {request.status === "pendingApproval" ? (
                        <Button size="sm" onClick={() => setDeciding({ request, decision: "reject" })}>
                          Reject
                        </Button>
                      ) : null}
                    </div>
                  ) : request.decidedBy === null ? (
                    <Unknown>Not decided</Unknown>
                  ) : (
                    <span>
                      {name(request.decidedBy)}
                      {request.decisionNote ? `: ${request.decisionNote}` : ""}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HorizontalScroll>
      <ReasonDialog
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
        title={deciding?.decision === "reject" ? "Reject the erasure" : "Approve the erasure"}
        description={
          deciding?.decision === "reject"
            ? "Nothing is erased, and the request stays as a record."
            : "The restricted and special-category documents of the person are removed, the directory entry is anonymised and archived, and the person's values in source records and the audit log are replaced by a marker. This cannot be undone."
        }
        label="Note"
        optional
        maxLength={2_000}
        confirmLabel={deciding?.decision === "reject" ? "Reject" : "Erase"}
        onConfirm={async (note) => {
          if (deciding === null) return;
          const result = await callFunction(decideErasureContract, {
            requestId: deciding.request.requestId,
            decision: deciding.decision,
            note: note.trim() === "" ? null : note.trim(),
          });
          setDeciding(null);
          toast.show({
            title: result.status === "applied" ? "The person has been erased" : "The request has been rejected",
          });
          onChanged();
        }}
      />
    </>
  );
}

function Erasure() {
  const toast = useToast();
  const { live, reload } = useCallResult(listErasureRequestsContract, {}, "erasure");
  const [personId, setPersonId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (personId === null || reason.trim() === "") return;
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(requestErasureContract, { personId, reason: reason.trim() });
      setReason("");
      setPersonId(null);
      toast.show({
        title: "The erasure has been requested",
        description: "A second programme administrator decides it.",
      });
      reload();
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-6">
      <Section
        title="Ask for an erasure"
        description="Nothing is erased until a second programme administrator approves. A person linked to an account is refused until the account is unlinked. The scientific record and the audit log keep every entry."
      >
        <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
          <PersonSearch groupName="erasure-person" chosen={personId} onChoose={setPersonId} />
          <FormField label="Reason" hint="Kept with the request and withheld from the audit log.">
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                maxLength={2_000}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </FormField>
          {failure === null ? null : <ErrorState title="The erasure could not be requested." description={failure} />}
          <div>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={busy || personId === null || reason.trim() === ""}
            >
              {busy ? "Requesting" : "Request the erasure"}
            </Button>
          </div>
        </form>
      </Section>
      <LiveView
        live={live}
        loadingLabel="Loading the erasure requests"
        errorTitle="The erasure requests could not be loaded."
        onRetry={reload}
      >
        {(data) => <ErasureRequests requests={data.requests} onChanged={reload} />}
      </LiveView>
    </div>
  );
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  programme_admin: "Programme administrator",
  core_team: "Core team",
  replication_lead: "Replication lead",
  lab_coordinator: "Laboratory coordinator",
  lab_member: "Laboratory member",
  external_collaborator: "External collaborator",
};

function ReviewListing({ review, onAttested }: { review: AccessReview; onAttested: () => void }) {
  const toast = useToast();
  const name = useAccountNames(review.attestations.map((attestation) => attestation.reviewerUid));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const expiring = review.accounts.reduce(
    (total, account) => total + [...account.roles, ...account.grants].filter((right) => right.expiringSoon).length,
    0,
  );
  const attest = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(attestAccessReviewContract, {
        period: review.period,
        listingSha256: review.listingSha256,
        note: note.trim() === "" ? null : note.trim(),
      });
      setNote("");
      toast.show({ title: `Your review of ${review.period} has been recorded` });
      onAttested();
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4">
      <p className="text-fg-secondary">
        {review.accounts.length} accounts hold a role or a grant. {expiring}{" "}
        {expiring === 1 ? "right ends" : "rights end"} within 30 days.
      </p>
      <HorizontalScroll>
        <Table caption={`Roles and grants, ${review.period}`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Account</TableHeaderCell>
              <TableHeaderCell>Roles</TableHeaderCell>
              <TableHeaderCell>Grants</TableHeaderCell>
              <TableHeaderCell>Last sign-in</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {review.accounts.map((account) => (
              <TableRow key={account.uid} className="align-top" data-testid="access-review-account">
                <TableCell>
                  {account.name ?? <Unknown>{account.uid}</Unknown>}
                  {account.suspended ? <Badge tone="accent">Suspended</Badge> : null}
                </TableCell>
                <TableCell>
                  <ul className="grid gap-1">
                    {account.roles.map((role) => (
                      <li key={`${role.role}-${role.scopeId}`}>
                        {ROLE_LABELS[role.role] ?? role.role}
                        {role.scopeType === "programme" ? "" : ` of ${role.scopeId}`}
                        {role.status === "pendingApproval" ? " (pending)" : ""}
                        {role.expiringSoon ? <Badge tone="accent">Ends soon</Badge> : null}
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  {account.grants.length === 0 ? (
                    <Unknown>None</Unknown>
                  ) : (
                    <ul className="grid gap-1">
                      {account.grants.map((grant) => (
                        <li key={`${grant.kind}-${grant.name}`}>
                          {grant.name}
                          {grant.expiresAt === null ? "" : `, until ${formatDateTime(grant.expiresAt)}`}
                          {grant.expiringSoon ? <Badge tone="accent">Ends soon</Badge> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell>
                  {account.lastSignInAt === null ? <Unknown>Never</Unknown> : formatDateTime(account.lastSignInAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HorizontalScroll>
      <Section
        title={`Attestations for ${review.period}`}
        description="Each reviewer records that they have checked the listing above. An attestation covers the listing as it stood, and is marked when roles or grants have changed since."
      >
        {review.attestations.length === 0 ? (
          <p className="text-fg-secondary">Nobody has attested this period yet.</p>
        ) : (
          <ul className="grid gap-1" aria-label="Attestations">
            {review.attestations.map((attestation) => (
              <li key={attestation.reviewerUid} data-testid="access-review-attestation">
                {name(attestation.reviewerUid)}, {formatDateTime(attestation.attestedAt)}
                {attestation.matchesCurrentListing ? "" : " (the listing has changed since)"}
                {attestation.note ? `: ${attestation.note}` : ""}
              </li>
            ))}
          </ul>
        )}
        <FormField label="Note" hint="Optional. What you checked or asked to be changed.">
          {(control) => (
            <Textarea {...control} value={note} maxLength={2_000} onChange={(event) => setNote(event.target.value)} />
          )}
        </FormField>
        {failure === null ? null : <ErrorState title="Your review could not be recorded." description={failure} />}
        <div>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void attest()}>
            {busy ? "Recording" : "I have reviewed this listing"}
          </Button>
        </div>
      </Section>
    </div>
  );
}

function AccessReviewTab() {
  const { live, reload } = useCallResult(getAccessReviewContract, {}, "review");
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the access review"
      errorTitle="The access review could not be loaded."
      onRetry={reload}
    >
      {(review) => <ReviewListing review={review} onAttested={reload} />}
    </LiveView>
  );
}

function PeriodRow({ target, days, onSaved }: { target: RetentionTarget; days: number | null; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(days === null ? "" : String(days));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const save = async (next: number | null) => {
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(setRetentionPeriodContract, { target, days: next });
      toast.show({ title: next === null ? "The period has been cleared" : "The period has been saved" });
      onSaved();
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= RETENTION_MIN_DAYS && parsed <= RETENTION_MAX_DAYS;
  return (
    <TableRow className="align-top" data-testid="retention-period">
      <TableCell>{RETENTION_TARGET_LABELS[target]}</TableCell>
      <TableCell>{days === null ? <Unknown>None: never deleted</Unknown> : `${days} days`}</TableCell>
      <TableCell>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void save(parsed);
          }}
        >
          <FormField label={`Days for ${RETENTION_TARGET_LABELS[target].toLowerCase()}`} className="w-32">
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={RETENTION_MIN_DAYS}
                max={RETENTION_MAX_DAYS}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" size="sm" disabled={busy || !valid}>
            Save
          </Button>
          {days === null ? null : (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Clear
            </Button>
          )}
        </form>
        {failure === null ? null : <p className="text-fg-secondary">{failure}</p>}
      </TableCell>
    </TableRow>
  );
}

function RetentionSettings({ overview, onChanged }: { overview: RetentionOverview; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const sweep = async (dryRun: boolean) => {
    setBusy(true);
    setFailure(null);
    try {
      const run = await callFunction(runRetentionSweepContract, { dryRun });
      const deleted = run.outcomes.reduce((total, outcome) => total + outcome.deleted, 0);
      const eligible = run.outcomes.reduce((total, outcome) => total + outcome.eligible, 0);
      toast.show({
        title: dryRun ? `A sweep would delete ${eligible} documents` : `The sweep deleted ${deleted} documents`,
      });
      onChanged();
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  const [latest] = overview.runs;
  return (
    <div className="grid gap-6">
      <Section
        title="Retention periods"
        description={`The periods are the programme's decision. The portal has no default: a kind of document without a period is never deleted. A period is between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS} days. The audit log and source records are never swept.`}
      >
        <HorizontalScroll>
          <Table caption="Retention periods">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Kind of document</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Change</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {RETENTION_TARGETS.map((target) => (
                <PeriodRow
                  key={`${target}-${overview.periods[target] ?? "none"}`}
                  target={target}
                  days={overview.periods[target] ?? null}
                  onSaved={onChanged}
                />
              ))}
            </TableBody>
          </Table>
        </HorizontalScroll>
      </Section>
      <Section
        title="Sweeps"
        description="A sweep runs every night. A dry run counts what a sweep would delete and deletes nothing. Each sweep is recorded with what it did."
      >
        {failure === null ? null : <ErrorState title="The sweep could not be run." description={failure} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void sweep(true)}>
            Run a dry run
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void sweep(false)}>
            Sweep now
          </Button>
        </div>
        {latest === undefined ? (
          <p className="text-fg-secondary">No sweep has run yet.</p>
        ) : (
          <HorizontalScroll>
            <Table caption={`Latest sweep, ${formatDateTime(latest.startedAt)}${latest.dryRun ? ", dry run" : ""}`}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Kind of document</TableHeaderCell>
                  <TableHeaderCell>Older than the period</TableHeaderCell>
                  <TableHeaderCell>Deleted</TableHeaderCell>
                  <TableHeaderCell>Note</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {latest.outcomes.map((outcome) => (
                  <TableRow key={outcome.target} data-testid="retention-outcome">
                    <TableCell>
                      {RETENTION_TARGET_LABELS[outcome.target as RetentionTarget] ?? outcome.target}
                    </TableCell>
                    <TableCell>{outcome.eligible}</TableCell>
                    <TableCell>{outcome.deleted}</TableCell>
                    <TableCell>{outcome.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </HorizontalScroll>
        )}
      </Section>
    </div>
  );
}

function Retention() {
  const { live, reload } = useCallResult(getRetentionContract, {}, "retention");
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the retention settings"
      errorTitle="The retention settings could not be loaded."
      onRetry={reload}
    >
      {(overview) => <RetentionSettings overview={overview} onChanged={reload} />}
    </LiveView>
  );
}

/**
 * Governance for programme administrators (docs/SECURITY.md, section 6): the subject access
 * export, erasure on the approval of a second administrator, the periodic access review and the
 * retention periods with their sweeps. The functions behind each decide who may use it.
 */
export function GovernancePage() {
  const [tab, setTab] = useState<TabId>("export");
  return (
    <AdminPage
      entryId="admin-governance"
      description="The mechanisms behind the programme's decisions on personal data: what is held about a person, erasure, who holds which rights, and how long records are kept. Each action needs a programme administrator with the second factor and is recorded in the audit log."
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <HorizontalScroll>
          <TabsList aria-label="Sections of governance" className="min-w-max">
            {TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {TAB_LABELS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </HorizontalScroll>
        <TabsContent value="export">
          <SubjectAccess />
        </TabsContent>
        <TabsContent value="erasure">
          <Erasure />
        </TabsContent>
        <TabsContent value="review">
          <AccessReviewTab />
        </TabsContent>
        <TabsContent value="retention">
          <Retention />
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
}
