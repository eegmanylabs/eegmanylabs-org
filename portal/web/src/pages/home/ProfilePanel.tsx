import { formatDate } from "@/app/labels";
import { useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { type RecordOf, retryFailedLiveData, useLiveDocument, useLiveQuery } from "@/data";
import { CORRECTABLE_FIELD_LABELS, CorrectionRequestDialog } from "./CorrectionRequestDialog";
import { ProfileSummary } from "./ProfileSummary";

const STATUS_LABELS = { open: "Open", accepted: "Accepted", rejected: "Not accepted", withdrawn: "Withdrawn" } as const;

/**
 * How a report reads to the member. An accepted report whose value the record now holds is
 * corrected. One whose record still says otherwise is accepted and waits for the record it
 * comes from to be corrected, which the member should not mistake for being ignored.
 */
export function reportStatusLabel(
  request: Pick<RecordOf<"correctionRequests">, "status" | "field" | "proposedValue">,
  person: Readonly<Record<string, unknown>> | null,
): string {
  if (request.status !== "accepted") return STATUS_LABELS[request.status];
  const current = person?.[request.field];
  return current !== undefined && String(current) === String(request.proposedValue).trim()
    ? "Corrected"
    : "Accepted, not yet corrected";
}

/** The member's own reports of wrong details, newest first. */
function OwnCorrectionRequests({ uid, personId }: { uid: string; personId: string }) {
  const person = useLiveDocument("persons", [personId]);
  const current = person.status === "ready" ? person.data : null;
  const requests = useLiveQuery({
    collection: "correctionRequests",
    within: [],
    where: [["uid", "==", uid]],
    orderBy: [["createdAt", "desc"]],
    limit: 20,
  });
  return (
    <LiveView
      live={requests}
      loadingLabel="Loading your reports"
      errorTitle="Your reports could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) =>
        list.length === 0 ? null : (
          <div className="grid gap-2 border-t border-border pt-3">
            <h3 className="text-md font-medium text-fg-strong">Your reports</h3>
            <ul className="grid gap-2">
              {list.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={request.status === "open" ? "accent" : "neutral"}>
                    {reportStatusLabel(request, current)}
                  </Badge>
                  <span>
                    {CORRECTABLE_FIELD_LABELS[request.field] ?? request.field}: {String(request.proposedValue)}
                  </span>
                  <span className="text-fg-muted">
                    Sent{" "}
                    <time dateTime={request.createdAt.toDate().toISOString()}>
                      {formatDate(request.createdAt.toDate())}
                    </time>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </LiveView>
  );
}

/** The member's profile, its laboratories and replications, and a way to report a wrong detail. */
export function ProfilePanel() {
  const user = useSignedInUser();
  const { access } = useAuth();
  const personId = access.status === "ready" ? (access.data?.personId ?? null) : null;
  const member = access.status === "ready" && access.data?.member === true;
  if (personId === null) return null;
  return (
    <section
      aria-labelledby="profile-panel-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="profile-panel-heading" className="text-lg font-medium tracking-title text-fg-strong">
          Your profile
        </h2>
        {member ? <CorrectionRequestDialog uid={user.uid} personId={personId} /> : null}
      </div>
      <ProfileSummary personId={personId} />
      {member ? <OwnCorrectionRequests uid={user.uid} personId={personId} /> : null}
    </section>
  );
}
