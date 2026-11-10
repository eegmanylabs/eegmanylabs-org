import type { Capability } from "@eegml/shared";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { navigationEntry } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { decidePrivilege } from "@/auth/privilege";
import { usePrivilegeFacts } from "@/auth/use-privilege";
import { Spinner } from "@/components/ui/spinner";
import { type Live, useLiveQuery } from "@/data";
import {
  OPEN_CORRECTION_REQUESTS,
  PENDING_ROLE_ASSIGNMENTS,
  QUEUE_LIMIT,
  usePendingAccountClaims,
  usePendingLabClaims,
} from "@/pages/admin/queues";

/** The size of a queue, or what stands in for it while it is loading or could not be read. */
function Count({ live }: { live: Live<number> }) {
  if (live.status === "ready") {
    return (
      <span className="min-w-8 text-right text-lg font-medium text-fg-strong tabular-nums">
        {live.data >= QUEUE_LIMIT ? `${QUEUE_LIMIT}+` : live.data}
      </span>
    );
  }
  if (live.status === "error") return <span className="text-fg-accent">Could not be counted</span>;
  return <Spinner label="Counting" />;
}

function QueueRow({ entryId, live, children }: { entryId: string; live: Live<number>; children: ReactNode }) {
  const entry = navigationEntry(entryId);
  return (
    <li>
      <Link
        to={entry.to}
        className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-border bg-background px-3 py-2 hover:border-border-emphasis"
      >
        <span className="grid">
          <span className="font-medium text-fg-strong">{entry.label}</span>
          <span className="text-fg-secondary">{children}</span>
        </span>
        <span className="flex items-center gap-2">
          <Count live={live} />
          <ChevronRight aria-hidden="true" className="size-4 text-fg-secondary" strokeWidth={1.8} />
        </span>
      </Link>
    </li>
  );
}

const sizeOf = <T,>(live: Live<readonly T[]>): Live<number> =>
  live.status === "ready" ? { ...live, data: live.data.length } : live;

/** For administrators: how many items wait in each review queue the account decides, with links to the queues. */
export function AdminQueuesPanel() {
  const { access } = useAuth();
  const facts = usePrivilegeFacts();
  const open = (capability: Capability) => facts !== null && decidePrivilege(facts, capability) === "allowed";
  const record = access.status === "ready" ? access.data : null;

  const claims = usePendingAccountClaims(open("claims.review"));
  const labClaims = usePendingLabClaims(open("labs.claims.review") ? record : null);
  const corrections = useLiveQuery(open("reconciliation.resolve") ? OPEN_CORRECTION_REQUESTS : null);
  const roles = useLiveQuery(open("roles.manage") ? PENDING_ROLE_ASSIGNMENTS : null);

  const rows = [
    open("claims.review") ? (
      <QueueRow
        key="claims"
        entryId="admin-claims"
        live={claims.live.status === "ready" ? { ...claims.live, data: claims.live.data.claims.length } : claims.live}
      >
        Accounts waiting to be linked or let in
      </QueueRow>
    ) : null,
    labClaims.status === "idle" ? null : (
      <QueueRow key="lab-claims" entryId="admin-lab-claims" live={sizeOf(labClaims)}>
        Requests to represent a laboratory
      </QueueRow>
    ),
    corrections.status === "idle" ? null : (
      <QueueRow key="corrections" entryId="admin-corrections" live={sizeOf(corrections)}>
        Reports of wrong details
      </QueueRow>
    ),
    roles.status === "idle" ? null : (
      <QueueRow key="roles" entryId="admin-roles" live={sizeOf(roles)}>
        Roles waiting for confirmation
      </QueueRow>
    ),
  ].filter((row) => row !== null);
  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="queues-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
    >
      <h2 id="queues-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Waiting for review
      </h2>
      <ul className="grid gap-2" data-testid="review-queues">
        {rows}
      </ul>
    </section>
  );
}
