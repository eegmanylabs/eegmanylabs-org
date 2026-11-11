// The dashboard of the programme, a replication or a laboratory, which the function openDashboard
// creates with its default widgets the first time anyone opens it.
import { openDashboardContract } from "@eegml/shared";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { retryFailedLiveData, useCallResult, useLiveDocument } from "@/data";
import { DashboardView } from "@/views/DashboardView";
import { useViewHost } from "@/views/host";

export function StoredDashboard({ dashboardId }: { readonly dashboardId: string }) {
  const host = useViewHost();
  const dashboard = useLiveDocument("dashboards", [dashboardId]);
  if (host === null) return <LoadingState label="Loading the dashboard" />;
  return (
    <LiveView
      live={dashboard}
      loadingLabel="Loading the dashboard"
      errorTitle="The dashboard could not be loaded"
      onRetry={retryFailedLiveData}
    >
      {(data) =>
        data === null ? (
          <ErrorState
            title="This dashboard does not exist."
            description="It may have been removed, or your account may not open it."
          />
        ) : (
          <DashboardView dashboard={data} viewer={host.viewer} secondFactor={host.secondFactor} />
        )
      }
    </LiveView>
  );
}

export function ScopeDashboard({
  scopeType,
  scopeId,
}: {
  readonly scopeType: "programme" | "replication" | "laboratory";
  readonly scopeId: string;
}) {
  const opened = useCallResult(openDashboardContract, { scopeType, scopeId }, `${scopeType}/${scopeId}`);
  switch (opened.live.status) {
    case "idle":
    case "loading":
      return <LoadingState label="Opening the dashboard" />;
    case "error":
      return (
        <ErrorState
          title="The dashboard could not be opened."
          description={opened.live.error.message}
          action={<Button onClick={opened.reload}>Try again</Button>}
        />
      );
    case "ready":
      return <StoredDashboard dashboardId={opened.live.data.dashboardId} />;
  }
}
