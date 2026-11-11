import { type ClaimReviewReason, type ListAccountClaimsOutput, reviewAccountClaimContract } from "@eegml/shared";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { useProgrammeAdministrator } from "@/auth/use-privilege";
import { LiveView } from "@/components/feedback/live-view";
import { LaboratoryName, ReplicationName } from "@/components/record-names";
import { byText, type TableSpec, useTableControls } from "@/components/table-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { callFunction, useLiveQuery } from "@/data";
import { useViewer } from "@/registry/viewer";
import { AdminPage } from "./AdminPage";
import { usePendingAccountClaims } from "./queues";
import { ReasonDialog } from "./ReasonDialog";

type Claim = ListAccountClaimsOutput["claims"][number];
type SortKey = "submitted" | "name";

const MATCH_LABELS: Readonly<Record<Claim["matchBasis"], string>> = {
  primaryEmail: "Matched a primary address",
  secondaryEmail: "Matched a secondary address",
  invitation: "Came with an invitation",
  manual: "Asked for access",
};

/** Why a claim waits for review, in the words a reviewer needs. */
export const REVIEW_REASON_LABELS: Readonly<Record<ClaimReviewReason, string>> = {
  severalCandidates: "Address held by more than one person",
  notClaimEligible: "Address on the record is not usable for a claim. Check with the person before linking",
  addressNotOnRecord: "Address found in the index but not on the person's record",
  personUnavailable: "Person missing or archived",
  alreadyClaimed: "Person already claimed by another account",
  requestedAccess: "Address matched nobody. The account asked for access",
};

const ADDRESS_KIND_LABELS = {
  primary: "Holds this address as primary",
  secondary: "Holds this address as secondary",
  historical: "Holds this address as a former address",
} as const;

type Candidate = Claim["candidates"][number];

/** What tells one candidate from another: affiliation, how the record holds the address, laboratories and replications. */
function CandidateDetails({ candidate }: { candidate: Candidate }) {
  return (
    <span className="grid gap-1 text-fg-secondary">
      <span>{candidate.affiliationSummary ?? "No affiliation recorded"}</span>
      <span>{candidate.addressKind ? ADDRESS_KIND_LABELS[candidate.addressKind] : "Does not hold this address"}</span>
      <span>
        {candidate.laboratoryIds.length === 0 ? (
          "No laboratories"
        ) : (
          <>
            Laboratories:{" "}
            {candidate.laboratoryIds.map((id, index) => (
              <span key={id}>
                {index > 0 ? ", " : null}
                <LaboratoryName id={id} />
              </span>
            ))}
          </>
        )}
      </span>
      <span>
        {candidate.replicationIds.length === 0 ? (
          "No replications"
        ) : (
          <>
            Replications:{" "}
            {candidate.replicationIds.map((id, index) => (
              <span key={id}>
                {index > 0 ? ", " : null}
                <ReplicationName id={id} />
              </span>
            ))}
          </>
        )}
      </span>
    </span>
  );
}

const SPEC: TableSpec<Claim, SortKey> = {
  searchText: (claim) => [
    claim.displayName,
    claim.emailLower,
    claim.request?.statedName,
    claim.request?.affiliation,
    ...claim.candidates.map((candidate) => candidate.displayName),
  ],
  sorters: {
    submitted: (a, b) => a.submittedAt.localeCompare(b.submittedAt),
    name: (a, b) =>
      byText(
        a.request?.statedName ?? a.displayName ?? a.emailLower,
        b.request?.statedName ?? b.displayName ?? b.emailLower,
      ),
  },
  initialSort: { key: "submitted", direction: "asc" },
  pageSize: 10,
};

/** Finds a person of the directory by name, for a claim whose address matched nobody. */
function PersonSearch({
  claimUid,
  chosen,
  onChoose,
}: {
  claimUid: string;
  chosen: string | null;
  onChoose: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const persons = useLiveQuery(search.trim().length < 2 ? null : { collection: "persons", within: [], limit: 1_000 });
  const query = search.trim().toLowerCase();
  return (
    <div className="grid gap-2">
      <FormField label="Find the person in the directory" hint="Type at least two letters of the name.">
        {(control) => (
          <Input {...control} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        )}
      </FormField>
      <LiveView live={persons} loadingLabel="Searching the directory" errorTitle="The directory could not be searched.">
        {(list) => {
          const matches = list.filter((person) => person.displayName.toLowerCase().includes(query)).slice(0, 8);
          if (matches.length === 0) return <p className="text-fg-secondary">Nobody in the directory matches.</p>;
          return (
            <fieldset className="grid gap-1">
              <legend className="sr-only">People who match</legend>
              {matches.map((person) => (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-2 rounded-control border border-border bg-background px-3 py-2 pointer-coarse:min-h-11"
                >
                  <input
                    type="radio"
                    name={`person-${claimUid}`}
                    value={person.id}
                    checked={chosen === person.id}
                    onChange={() => onChoose(person.id)}
                  />
                  <span className="font-medium">{person.displayName}</span>
                  {person.affiliationSummary ? (
                    <span className="text-fg-secondary">{person.affiliationSummary}</span>
                  ) : null}
                  {person.userId === null ? null : <Badge tone="neutral">Already claimed</Badge>}
                </label>
              ))}
            </fieldset>
          );
        }}
      </LiveView>
    </div>
  );
}

function ClaimCard({ claim, onDecided }: { claim: Claim; onDecided: () => void }) {
  const toast = useToast();
  const administrator = useProgrammeAdministrator();
  // Nothing is chosen in advance: every claim here needs a reviewer's judgement.
  const [chosen, setChosen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [newName, setNewName] = useState(claim.request?.statedName ?? "");
  const [newAffiliation, setNewAffiliation] = useState(claim.request?.affiliation ?? "");
  const [busy, setBusy] = useState(false);
  const viewer = useViewer();
  // Admitting someone whom no record names creates a person, which needs `people.manage` too.
  const canAdmit = claim.request !== null && viewer?.can("people.manage", "programme") === true;
  const name = claim.request?.statedName ?? claim.displayName ?? claim.emailLower;
  const nameIsStated = claim.request !== null || claim.displayName !== null;
  const headingId = `claim-${claim.uid}`;

  return (
    <article aria-labelledby={headingId} className="grid gap-4 rounded-card border border-border bg-surface px-5 py-4">
      <header className="grid gap-1">
        <h2 id={headingId} className="text-lg font-medium tracking-title text-fg-strong">
          {name}
          {nameIsStated ? <span className="sr-only"> (unverified name)</span> : null}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-fg-secondary">
          <span className="break-all">{claim.emailLower}</span>
          <Badge tone="outline">{MATCH_LABELS[claim.matchBasis]}</Badge>
          {claim.reviewReason ? <Badge tone="accent">{REVIEW_REASON_LABELS[claim.reviewReason]}</Badge> : null}
          <span>
            Sent <time dateTime={claim.submittedAt}>{formatDateTime(claim.submittedAt)}</time>
          </span>
        </p>
        {nameIsStated ? (
          <p className="text-fg-muted">
            {claim.request
              ? "The name above is the one they stated."
              : "The name above is the one the account gives itself."}{" "}
            {claim.displayName && claim.request ? `The account calls itself ${claim.displayName}. ` : null}
            {claim.request
              ? "This name and affiliation are as they gave them and have not been checked."
              : "It has not been checked."}
          </p>
        ) : null}
      </header>
      {claim.request ? (
        <dl className="grid gap-2 rounded-tile border border-border bg-background p-3">
          <div>
            <dt className="text-fg-muted">Name they gave</dt>
            <dd>{claim.request.statedName}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Affiliation they gave</dt>
            <dd>{claim.request.affiliation}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Their message</dt>
            <dd className="whitespace-pre-line">{claim.request.message}</dd>
          </div>
        </dl>
      ) : null}
      {claim.candidates.length > 0 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium text-fg-strong">Candidates whose records carry this address</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="claim-candidates">
            {claim.candidates.map((candidate) => (
              <label
                key={candidate.personId}
                className="grid cursor-pointer gap-1 rounded-tile border border-border-strong bg-background p-3 has-checked:border-accent-strong has-disabled:cursor-not-allowed"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`candidate-${claim.uid}`}
                    value={candidate.personId}
                    checked={chosen === candidate.personId}
                    disabled={candidate.claimed}
                    onChange={() => setChosen(candidate.personId)}
                  />
                  <span className="font-medium text-fg-strong">{candidate.displayName}</span>
                </span>
                <CandidateDetails candidate={candidate} />
                {candidate.claimed ? <Badge tone="neutral">Already claimed by another account</Badge> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : administrator ? (
        <PersonSearch claimUid={claim.uid} chosen={chosen} onChoose={setChosen} />
      ) : (
        <p className="text-fg-secondary">
          This address is on nobody's record, so only a programme administrator can link the account. You can reject the
          request, or leave it for an administrator.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={chosen === null || busy} onClick={() => setApproving(true)}>
          Approve and link
        </Button>
        {canAdmit && claim.candidates.length === 0 ? (
          <Button disabled={busy} onClick={() => setAdmitting(true)}>
            Approve as a new member
          </Button>
        ) : null}
        <Button disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </div>
      <ReasonDialog
        open={admitting}
        onOpenChange={setAdmitting}
        title="Admit as a new member?"
        description="A new member profile is created with the name and affiliation below, as live data, and this account is linked to it. Check the name and affiliation first: they are shown to every member."
        label="Note for the record"
        optional
        confirmLabel="Create the profile and link"
        canConfirm={newName.trim() !== ""}
        onConfirm={async (note) => {
          setBusy(true);
          try {
            const affiliation = newAffiliation.trim();
            await callFunction(reviewAccountClaimContract, {
              uid: claim.uid,
              decision: "approveAsNewMember",
              displayName: newName.trim(),
              ...(affiliation === "" ? {} : { affiliation }),
              ...(note === "" ? {} : { note }),
            });
            toast.show({ title: `${newName.trim()} is now a member, and the account is linked.` });
            onDecided();
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField label="Name" error={newName.trim() === "" ? "Enter the name of the new member." : null}>
          {(control) => <Input {...control} value={newName} onChange={(event) => setNewName(event.target.value)} />}
        </FormField>
        <FormField label="Affiliation" hint="Optional.">
          {(control) => (
            <Input {...control} value={newAffiliation} onChange={(event) => setNewAffiliation(event.target.value)} />
          )}
        </FormField>
      </ReasonDialog>
      <ReasonDialog
        open={approving}
        onOpenChange={setApproving}
        title="Link this account?"
        description="The account is linked to the chosen person, and roles that the records imply wait for confirmation."
        label="Note for the record"
        optional
        confirmLabel="Approve and link"
        onConfirm={async (note) => {
          if (chosen === null) return;
          setBusy(true);
          try {
            await callFunction(reviewAccountClaimContract, {
              uid: claim.uid,
              decision: "approve",
              personId: chosen,
              ...(note === "" ? {} : { note }),
            });
            toast.show({ title: `${name} is now linked.` });
            onDecided();
          } finally {
            setBusy(false);
          }
        }}
      />
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject this claim?"
        description="The account stays unlinked and is told that its claim was not approved. Your note is kept for the record and is not shown to them."
        label="Note"
        confirmLabel="Reject"
        onConfirm={async (note) => {
          setBusy(true);
          try {
            await callFunction(reviewAccountClaimContract, { uid: claim.uid, decision: "reject", note });
            toast.show({ title: "The claim has been rejected." });
            onDecided();
          } finally {
            setBusy(false);
          }
        }}
      />
    </article>
  );
}

function ClaimQueue({ claims, onDecided }: { claims: readonly Claim[]; onDecided: () => void }) {
  const table = useTableControls(claims, SPEC);
  if (claims.length === 0) {
    return <EmptyState title="No claims wait for review" description="New claims appear here as members sign in." />;
  }
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Search claims" className="w-full max-w-sm">
          {(control) => (
            <Input
              {...control}
              type="search"
              value={table.query}
              onChange={(event) => table.setQuery(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Sort by" className="w-56">
          {(control) => (
            <Select
              {...control}
              value={`${table.directionOf("submitted") ? "submitted" : "name"}`}
              onChange={(event) => table.sortBy(event.target.value as SortKey)}
            >
              <option value="submitted">Waiting longest first</option>
              <option value="name">Name</option>
            </Select>
          )}
        </FormField>
      </div>
      {table.total === 0 ? (
        <EmptyState title="No claim matches your search" />
      ) : (
        <div className="grid gap-4">
          {table.page.map((claim) => (
            <ClaimCard key={claim.uid} claim={claim} onDecided={onDecided} />
          ))}
        </div>
      )}
      <Pagination
        offset={table.offset}
        pageSize={table.pageSize}
        total={table.total}
        label="claims"
        onChange={table.setOffset}
      />
    </>
  );
}

/** The queue of account claims that wait for an administrator: ambiguous matches and requests for access. */
export function ClaimsPage() {
  return (
    <AdminPage
      entryId="admin-claims"
      description="Accounts whose address matched more than one person, a claimed person or nobody. Link each to the right person, or reject it."
    >
      <ClaimsQueue />
    </AdminPage>
  );
}

function ClaimsQueue() {
  const { live, reload } = usePendingAccountClaims(true);
  const claims = useMemo(() => (live.status === "ready" ? live.data.claims : []), [live]);
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the claims"
      errorTitle="The claims could not be loaded."
      onRetry={reload}
    >
      {() => <ClaimQueue claims={claims} onDecided={reload} />}
    </LiveView>
  );
}
