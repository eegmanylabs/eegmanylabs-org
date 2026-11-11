// The dashboards a member may open: the programme's, those of the replications and laboratories
// that have been opened, and the member's own, which the member creates here.
import { PROGRAMME_KEY, saveDashboardContract, scopeDashboardId } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CallableError, callFunction, type RecordOf, retryFailedLiveData, useLiveDocument, useLiveQuery } from "@/data";
import { useViewHost } from "@/views/host";
import { ScopeDashboard, StoredDashboard } from "./ScopeDashboard";

const PROGRAMME_DASHBOARD = scopeDashboardId("programme", PROGRAMME_KEY);

function DashboardList({
  title,
  dashboards,
  empty,
}: {
  readonly title: string;
  readonly dashboards: readonly RecordOf<"dashboards">[];
  readonly empty: string;
}) {
  const shown = dashboards.filter((dashboard) => dashboard.archivedAt === null);
  return (
    <section className="grid gap-2" aria-label={title}>
      <h2 className="text-lg">{title}</h2>
      {shown.length === 0 ? (
        <p className="text-fg-muted">{empty}</p>
      ) : (
        <ul className="grid gap-1">
          {[...shown]
            .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
            .map((dashboard) => (
              <li key={dashboard.id}>
                <Link className="text-fg-accent underline" to={`/dashboards/${dashboard.id}`}>
                  {dashboard.name}
                </Link>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardsPage() {
  const host = useViewHost();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const own = useLiveQuery(
    host === null
      ? null
      : { collection: "dashboards", within: [], where: [["ownerUid", "==", host.viewer.uid]], limit: 200 },
  );
  const scopes = useLiveQuery({ collection: "dashboards", within: [], where: [["ownerUid", "==", null]], limit: 200 });
  const create = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    callFunction(saveDashboardContract, { name: name.trim(), widgets: {} })
      .then(({ dashboardId }) => navigate(`/dashboards/${dashboardId}`))
      .catch((failure: unknown) =>
        setError(failure instanceof CallableError ? failure.message : "The dashboard was not created."),
      );
  };
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Dashboards"
        description="Figures, charts and views of the programme's records, computed from the same documents everywhere they appear."
        actions={
          <Button asChild variant="primary">
            <Link to={`/dashboards/${PROGRAMME_DASHBOARD}`}>Open the programme dashboard</Link>
          </Button>
        }
      />
      <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
        <div className="grid gap-1">
          <span className="text-sm font-medium">New personal dashboard</span>
          <Input
            aria-label="Name of the new dashboard"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={name.trim() === ""}>
          Create
        </Button>
        {error === null ? null : (
          <p role="alert" className="text-sm text-fg-accent">
            {error}
          </p>
        )}
      </form>
      <LiveView
        live={own}
        loadingLabel="Loading your dashboards"
        errorTitle="Your dashboards could not be loaded"
        onRetry={retryFailedLiveData}
      >
        {(dashboards) => (
          <DashboardList
            title="Your dashboards"
            dashboards={dashboards}
            empty="You have no dashboard of your own yet."
          />
        )}
      </LiveView>
      <LiveView
        live={scopes}
        loadingLabel="Loading the dashboards"
        errorTitle="The dashboards could not be loaded"
        onRetry={retryFailedLiveData}
      >
        {(dashboards) => (
          <DashboardList
            title="Programme, replications and laboratories"
            dashboards={dashboards}
            empty="The dashboard of a replication or a laboratory appears here once someone opens it from its page."
          />
        )}
      </LiveView>
    </div>
  );
}

/** The dashboard of the programme, a replication or a laboratory that an identifier names, if any. */
function scopeOfIdentifier(
  dashboardId: string,
): { scopeType: "programme" | "replication" | "laboratory"; scopeId: string } | null {
  const match = /^(programme|replication|laboratory)__(.+)$/.exec(dashboardId);
  if (match === null) return null;
  return { scopeType: match[1] as "programme" | "replication" | "laboratory", scopeId: match[2] ?? "" };
}

export function DashboardPage() {
  const { dashboardId = "" } = useParams();
  const dashboard = useLiveDocument("dashboards", [dashboardId]);
  const scope = scopeOfIdentifier(dashboardId);
  const title = dashboard.status === "ready" && dashboard.data !== null ? dashboard.data.name : "Dashboard";
  return (
    <div className="grid gap-4">
      <PageHeader title={title} />
      {scope === null ? <StoredDashboard dashboardId={dashboardId} /> : <ScopeDashboard {...scope} />}
    </div>
  );
}
