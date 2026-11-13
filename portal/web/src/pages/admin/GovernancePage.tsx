import {
  type AccessReview,
  attestAccessReviewContract,
  decideErasureContract,
  exportPersonDataContract,
  getAccessReviewContract,
  getRetentionContract,
  type ListedErasureRequest,
  listErasureRequestsContract,
  markMigrationVerifiedContract,
  OUTREACH_RETENTION_TARGET,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  RETENTION_TARGET_LABELS,
  RETENTION_TARGETS,
  type RetentionOverview,
  type RetentionTarget,
  requestErasureContract,
  runRetentionSweepContract,
  setRetentionPeriodContract,
  unlinkAccountClaimContract,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { ReplicationName, ScopeName } from "@/components/record-names";
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
import { PersonOfAccount } from "./people";
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
  // The account the chosen person is linked to. Erasure is refused until it is unlinked.
  const [linkedUid, setLinkedUid] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
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
      setLinkedUid(null);
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
          <PersonSearch
            groupName="erasure-person"
            chosen={personId}
            onChoose={(id, uid) => {
              setPersonId(id);
              setLinkedUid(uid);
              setFailure(null);
            }}
          />
          {linkedUid === null ? null : (
            <div className="grid gap-2 rounded-control border border-border p-3" data-testid="erasure-linked">
              <p>
                This person is linked to an account. Unlink the account before asking for the erasure: the roles its
                claim gave it are revoked, and it asks for access again at its next sign-in. Once erased, the account
                itself is deleted with the person.
              </p>
              <div>
                <Button size="sm" onClick={() => setUnlinking(true)}>
                  Unlink the account
                </Button>
              </div>
            </div>
          )}
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
              disabled={busy || personId === null || linkedUid !== null || reason.trim() === ""}
            >
              {busy ? "Requesting" : "Request the erasure"}
            </Button>
          </div>
        </form>
      </Section>
      <ReasonDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title="Unlink the account"
        description="The account is no longer linked to this person. The roles its claim gave it are revoked at once."
        label="Reason"
        hint="Kept with the account's claim and in the audit log."
        maxLength={2_000}
        confirmLabel="Unlink"
        onConfirm={async (text) => {
          if (linkedUid === null) return;
          await callFunction(unlinkAccountClaimContract, { uid: linkedUid, reason: text.trim() });
          setUnlinking(false);
          setLinkedUid(null);
          toast.show({ title: "The account has been unlinked", description: "You can now ask for the erasure." });
        }}
      />
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
  const name = useAccountNames([
    ...review.attestations.map((attestation) => attestation.reviewerUid),
    ...review.accounts.flatMap((account) =>
      account.roles.flatMap((role) =>
        role.grantedBy === null || role.grantedBy.startsWith("system:") ? [] : [role.grantedBy],
      ),
    ),
  ]);
  const appointer = (grantedBy: string) => (grantedBy.startsWith("system:") ? "the portal" : name(grantedBy));
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
        {review.accounts.length === 1 ? "1 account holds" : `${review.accounts.length} accounts hold`} a role, a grant,
        the membership of a group or a place on a replication team.{" "}
        {expiring === 0
          ? "No right ends within 30 days."
          : `${expiring} ${expiring === 1 ? "right ends" : "rights end"} within 30 days.`}
      </p>
      <HorizontalScroll>
        <Table caption={`Roles and grants, ${review.period}`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Account</TableHeaderCell>
              <TableHeaderCell>Roles</TableHeaderCell>
              <TableHeaderCell>Grants</TableHeaderCell>
              <TableHeaderCell>Groups and teams</TableHeaderCell>
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
                        {role.scopeType === "programme" ? null : (
                          <>
                            {" of "}
                            <ScopeName scopeType={role.scopeType} scopeId={role.scopeId} />
                          </>
                        )}
                        {role.grantedBy === null ? null : (
                          <span className="text-fg-secondary">, appointed by {appointer(role.grantedBy)}</span>
                        )}
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
                  {account.groups.length === 0 && account.teamReplicationIds.length === 0 ? (
                    <Unknown>None</Unknown>
                  ) : (
                    <ul className="grid gap-1">
                      {account.groups.map((group) => (
                        <li key={`group-${group.groupId}`}>
                          {group.name}, {group.role === "manager" ? "manager" : "member"}
                        </li>
                      ))}
                      {account.teamReplicationIds.map((id) => (
                        <li key={`team-${id}`}>
                          Team of <ReplicationName id={id} />
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
      {review.truncated ? (
        <ErrorState
          title="More accounts hold rights than one review can list."
          description="This listing is incomplete, so it cannot be attested. Ask for the review to be split before the end of the period."
        />
      ) : null}
      <Section
        title="Changes to what every holder of a role may do"
        description="Overrides of the default capabilities of a role. They are part of what an attestation covers."
      >
        {review.overrides.length === 0 ? (
          <p className="text-fg-secondary">No role differs from the default capabilities.</p>
        ) : (
          <ul className="grid gap-1" aria-label="Overrides of the capabilities of roles">
            {review.overrides.map((override) => (
              <li key={`${override.role}-${override.capability}`} data-testid="access-review-override">
                {ROLE_LABELS[override.role] ?? override.role}: {override.capability}{" "}
                {override.allowed ? "allowed" : "withdrawn"}
              </li>
            ))}
          </ul>
        )}
      </Section>
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
          <Button variant="primary" size="sm" disabled={busy || review.truncated} onClick={() => void attest()}>
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

/** The name of a target in the record of a sweep. */
function targetLabel(target: string): string {
  if (target === OUTREACH_RETENTION_TARGET) return "Outreach records of people who never joined";
  return RETENTION_TARGET_LABELS[target as RetentionTarget] ?? target;
}

/**
 * The retention of the raw material of the migration, which the programme decided
 * (docs/MIGRATION_PLAN.md, section 11, question 20), and the mark that starts its year.
 */
function MigrationRetentionSection({
  migration,
  onChanged,
}: {
  migration: RetentionOverview["migration"];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const marked = migration.verifiedAt !== null;
  return (
    <Section
      title="Raw material of the migration"
      description="The programme lead decided on 13 November 2026 that raw source records and exported files are kept until the migration is marked verified, and for one year after. Then the outreach records of people who never joined are deleted. What happens to the other raw records after that year has not been decided, so the portal keeps them. The audit log is never swept."
    >
      <div className="grid gap-2" data-testid="migration-retention">
        {marked ? (
          <p className="text-fg">
            Marked verified on {formatDateTime(migration.verifiedAt ?? "")}
            {migration.verifiedBy === null ? null : (
              <>
                {" "}
                by <PersonOfAccount uid={migration.verifiedBy} />
              </>
            )}
            . The outreach records of people who never joined are deleted from{" "}
            {formatDateTime(migration.deletableFrom ?? migration.verifiedAt ?? "")}.
          </p>
        ) : (
          <p className="text-fg">The migration is not marked verified, so nothing of it is deleted.</p>
        )}
        <p className="text-fg-secondary">
          A contact counts as someone who never joined when it names no person, its address matches no person, and no
          item of the review queue names its row.
        </p>
        {marked ? (
          <p className="text-fg-secondary" data-testid="migration-link-sharing">
            Decision 8: restrict link sharing on source F and the contributor sheets now, and record the date.
          </p>
        ) : null}
        <div>
          <Button size="sm" variant={marked ? "outline" : "primary"} onClick={() => setConfirming(true)}>
            {marked ? "Move the mark later" : "Mark the migration verified"}
          </Button>
        </div>
      </div>
      <ReasonDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={marked ? "Move the mark later?" : "Mark the migration verified?"}
        description={
          marked
            ? "The year of the retention starts again now. A mark moves later and never earlier, so the records are kept longer and never shorter."
            : "The year of the retention starts now. One year later the sweep deletes the outreach records of people who never joined. A mark can later be moved to a later moment, never to an earlier one. Then restrict link sharing on source F and the contributor sheets, as decision 8 says."
        }
        label={marked ? "Why the mark moves" : "Note on what was verified"}
        lengthMessage={
          marked
            ? "Say why the mark moves, up to 2,000 characters."
            : "Describe what was verified, up to 2,000 characters."
        }
        confirmLabel={marked ? "Move the mark" : "Mark it verified"}
        onConfirm={async (note) => {
          await callFunction(markMigrationVerifiedContract, { note });
          toast.show({ title: marked ? "The mark has moved." : "The migration is marked verified." });
          onChanged();
        }}
      />
    </Section>
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
        description={`The periods are the programme's decision. The portal has no default: a kind of document without a period is never deleted. A period is between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS} days. The audit log is never swept, and source records only as the migration retention below says.`}
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
      <MigrationRetentionSection migration={overview.migration} onChanged={onChanged} />
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
                    <TableCell>{targetLabel(outcome.target)}</TableCell>
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
