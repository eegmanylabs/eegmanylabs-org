import { useMemo } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { FigureChart } from "@/components/registry/figure-chart";
import { retryFailedLiveData } from "@/data";
import { useReplicationRows } from "@/pages/replications/use-replication-rows";
import { combineLive } from "@/registry/combine";
import { countOf, countryName, DATA_ORIGIN_LABELS, formatCount, MANUSCRIPT_STATUS_LABELS } from "@/registry/labels";
import { useManuscripts, usePersons } from "@/registry/queries";
import { useViewer } from "@/registry/viewer";
import {
  membersByCountry,
  originBreakdown,
  publicationsByStatus,
  replicationsByStage,
  replicationsByStatus,
} from "./snapshot";

/** The programme at a glance, counted from the live records. Every figure links to the list behind it. */
export function ProgrammeSnapshotPanel() {
  const { access } = useAuth();
  const viewer = useViewer();
  const member = access.status === "ready" && access.data?.member === true;
  const rows = useReplicationRows(member ? viewer : null);
  const persons = usePersons();
  const manuscripts = useManuscripts();
  const snapshot = useMemo(
    () =>
      combineLive([rows, persons, manuscripts] as const, (rowList, personList, manuscriptList) => {
        const people = personList.filter((person) => person.archivedAt === null);
        const outputs = manuscriptList.filter((manuscript) => manuscript.archivedAt === null);
        return {
          replicationCount: rowList.length,
          withdrawnCount: rowList.filter((row) => row.withdrawn).length,
          replicationOrigins: originBreakdown(
            rowList.map((row) => row.dataOrigin),
            DATA_ORIGIN_LABELS,
            formatCount,
          ),
          memberCount: people.length,
          memberOrigins: originBreakdown(
            people.map((person) => person.dataOrigin),
            DATA_ORIGIN_LABELS,
            formatCount,
          ),
          publicationCount: outputs.length,
          byStatus: replicationsByStatus(rowList),
          byStage: replicationsByStage(rowList),
          byCountry: membersByCountry(
            people.map((person) => ({ countryCode: person.countryCode ?? null })),
            countryName,
          ),
          byPublicationStatus: publicationsByStatus(
            outputs.map((manuscript) => manuscript.status),
            MANUSCRIPT_STATUS_LABELS,
          ),
        };
      }),
    [rows, persons, manuscripts],
  );
  if (!member) return null;
  return (
    <section
      aria-labelledby="snapshot-heading"
      className="grid gap-4 rounded-card border border-border bg-surface px-5 py-4"
      data-testid="programme-snapshot"
    >
      <div className="grid gap-1">
        <h2 id="snapshot-heading" className="text-lg font-medium tracking-title text-fg-strong">
          The programme now
        </h2>
        <p className="text-fg-secondary">
          Counted from the records in the portal as they are now. Select a figure to see the list behind it.
        </p>
      </div>
      <LiveView
        live={snapshot}
        loadingLabel="Counting the programme"
        errorTitle="The programme could not be counted."
        onRetry={retryFailedLiveData}
      >
        {(figures) => (
          <>
            <p className="text-fg-secondary" data-testid="snapshot-totals">
              {countOf(figures.replicationCount, "replication")}
              {figures.replicationOrigins === null ? "" : ` (${figures.replicationOrigins})`}, of which{" "}
              {formatCount(figures.withdrawnCount)} {figures.withdrawnCount === 1 ? "is" : "are"} not on the public
              website; {countOf(figures.memberCount, "member")}
              {figures.memberOrigins === null ? "" : ` (${figures.memberOrigins})`};{" "}
              {countOf(figures.publicationCount, "publication")}.
            </p>
            {[figures.replicationOrigins, figures.memberOrigins].some(
              (origins) => origins !== null && !origins.startsWith("all "),
            ) ? (
              <p className="text-xs text-fg-muted" data-testid="snapshot-mixed-origins">
                The charts count records of different origins together, as the totals above break them down.
              </p>
            ) : null}
            <div className="grid gap-5 md:grid-cols-2">
              <FigureChart
                title="Replications by status"
                unit="replication"
                figures={figures.byStatus}
                empty="No replication is recorded yet."
              />
              <FigureChart
                title="Replications by public stage"
                unit="replication"
                figures={figures.byStage}
                empty="No replication is recorded yet."
              />
              <FigureChart
                title="Members by country"
                unit="member"
                figures={figures.byCountry}
                empty="No member is recorded yet."
              />
              <FigureChart
                title="Publications by status"
                unit="publication"
                figures={figures.byPublicationStatus}
                empty="No publication is recorded yet."
              />
            </div>
          </>
        )}
      </LiveView>
    </section>
  );
}
