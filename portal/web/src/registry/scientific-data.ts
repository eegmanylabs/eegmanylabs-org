// The records of the scientific workflows as views read them (D-011): the hypotheses, the
// outputs and the decision log, which every member reads, and the analysis runs and incidents,
// which each reader reads within their scope. The decision log and the incident registry are
// append-only, so a view reads each decision and each incident as it stands after its
// corrections and actions (`decisionStates`, `incidentState`).
import { type CoreDocument, type CoreSourceKey, decisionStates, incidentState } from "@eegml/shared";
import { useMemo } from "react";
import { type Live, type LiveQuery, useLiveCollection } from "@/data";
import { combineLive } from "./combine";
import { ALL_MANUSCRIPTS } from "./queries";
import type { Viewer } from "./viewer";

/** The sources of views that the scientific workflows add. */
export const SCIENTIFIC_SOURCES: ReadonlySet<CoreSourceKey> = new Set([
  "core:hypotheses",
  "core:manuscripts",
  "core:analysisRuns",
  "core:decisions",
  "core:incidents",
]);

const VIEW_LIMIT = 1_000;

/** A collection read whole, or within the reader's scopes where it is read within scope. */
function scoped<K extends "processingRuns" | "incidents" | "incidentActions">(
  collection: K,
  within: LiveQuery<K>["within"],
  viewer: Viewer,
): LiveQuery<K> | null {
  if (!viewer.staff && viewer.queryScopeKeys.length === 0) return null;
  return viewer.staff
    ? { collection, within, limit: VIEW_LIMIT }
    : ({
        collection,
        within,
        where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]],
        limit: VIEW_LIMIT,
      } as unknown as LiveQuery<K>);
}

const asDocuments = (records: readonly { readonly id: string }[]): CoreDocument[] =>
  records.map((record) => ({ id: record.id, data: record as unknown as Readonly<Record<string, unknown>> }));

export interface ScientificDocuments {
  readonly documents: readonly CoreDocument[];
  readonly truncated: boolean;
}

const EMPTY = {
  status: "ready",
  data: { items: [], truncated: false },
  fromCache: false,
  hasPendingWrites: false,
} as const;

/** The documents of a scientific source, or null for any other source. */
export function useScientificDocuments(key: CoreSourceKey | null, viewer: Viewer): Live<ScientificDocuments | null> {
  const hypotheses = useLiveCollection(
    key === "core:hypotheses" ? { collection: "replicationHypotheses", within: "group", limit: VIEW_LIMIT } : null,
  );
  const manuscripts = useLiveCollection(key === "core:manuscripts" ? ALL_MANUSCRIPTS : null);
  const decisions = useLiveCollection(
    key === "core:decisions" ? { collection: "decisions", within: [], limit: VIEW_LIMIT } : null,
  );
  const runQuery = key === "core:analysisRuns" ? scoped("processingRuns", [], viewer) : null;
  const incidentQuery = key === "core:incidents" ? scoped("incidents", [], viewer) : null;
  const actionQuery = key === "core:incidents" ? scoped("incidentActions", "group", viewer) : null;
  const liveRuns = useLiveCollection(runQuery);
  const liveIncidents = useLiveCollection(incidentQuery);
  const liveActions = useLiveCollection(actionQuery);
  // A reader who holds no scope reads none of these records.
  const runs = runQuery === null ? EMPTY : liveRuns;
  const incidents = incidentQuery === null ? EMPTY : liveIncidents;
  const actions = actionQuery === null ? EMPTY : liveActions;
  const incidentData = combineLive([incidents, actions] as const, (reports, followUps) => ({ reports, followUps }));

  return useMemo(() => {
    const ready = <T>(data: T): Live<T> => ({
      status: "ready" as const,
      data,
      fromCache: false,
      hasPendingWrites: false,
    });
    switch (key) {
      case "core:hypotheses":
        return hypotheses.status === "ready"
          ? ready({ documents: asDocuments(hypotheses.data.items), truncated: hypotheses.data.truncated })
          : hypotheses;
      case "core:manuscripts":
        return manuscripts.status === "ready"
          ? ready({ documents: asDocuments(manuscripts.data.items), truncated: manuscripts.data.truncated })
          : manuscripts;
      case "core:analysisRuns":
        return runs.status === "ready"
          ? ready({ documents: asDocuments(runs.data.items), truncated: runs.data.truncated })
          : runs;
      case "core:decisions":
        return decisions.status === "ready"
          ? ready({
              documents: decisionStates(decisions.data.items).map((state) => ({
                id: state.id,
                data: { ...state.current, status: state.status, corrections: state.history.length - 1 },
              })),
              truncated: decisions.data.truncated,
            })
          : decisions;
      case "core:incidents":
        if (incidentData.status !== "ready") return incidentData;
        return ready({
          documents: incidentData.data.reports.items.map((incident) => {
            const state = incidentState(
              incident,
              incidentData.data.followUps.items.filter((action) => action.incidentId === incident.id),
            );
            return {
              id: incident.id,
              data: {
                ...incident,
                title: state.title,
                severity: state.severity,
                status: state.status,
                correctiveActions: state.correctiveActions.length,
              },
            };
          }),
          truncated: incidentData.data.reports.truncated || incidentData.data.followUps.truncated,
        });
      default:
        return ready(null);
    }
  }, [key, hypotheses, manuscripts, runs, decisions, incidentData]);
}
