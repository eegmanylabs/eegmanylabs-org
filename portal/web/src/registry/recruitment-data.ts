// The live reads of recruitment (docs/DATA_MODEL.md, sections 7 and 15). Programme staff read
// every report and pause; anyone else reads those of the scopes they hold, which is what the
// security rules allow, so a member of one laboratory never loads another's reports. The browser
// resolves the effective values from these documents with the shared resolver, so every figure
// of every page and view of recruitment comes from the same reports.
import {
  CORE_SOURCES,
  type CollectionData,
  coreCollection,
  EXCLUSION_REASON_TERM_KIND,
  isFirestoreTimestamp,
  type ParticipationFacts,
  type ParticipationRecruitment,
  type PauseFact,
  type ReportFact,
  resolveAll,
  type SourceLookups,
} from "@eegml/shared";
import { useMemo } from "react";
import { type Live, type LiveQuery, type RecordOf, useLiveCollection, useLiveQuery } from "@/data";
import { combineLive } from "@/registry/combine";
import type { Viewer } from "@/registry/viewer";

/** The most documents one query asks for, the most the security rules allow. */
export const RECRUITMENT_QUERY_LIMIT = 1_000;

export type ReportRecord = RecordOf<"recruitmentReports">;
export type PauseRecord = RecordOf<"plannedPauses">;
export type CategoryRecord = RecordOf<"countCategories">;
export type ReasonRecord = RecordOf<"vocabularyTerms">;

export interface RecruitmentData {
  readonly reports: readonly ReportRecord[];
  /** The reports as the resolver reads them. */
  readonly facts: readonly ReportFact[];
  readonly pauses: readonly PauseRecord[];
  /** Every category, current and archived, in their order. */
  readonly categories: readonly CategoryRecord[];
  /** The reasons for exclusion that are in use, by name. */
  readonly reasons: readonly ReasonRecord[];
  /** Whether a read stopped at its limit, so that what is shown may be incomplete. */
  readonly truncated: boolean;
}

export const ALL_CATEGORIES: LiveQuery<"countCategories"> = {
  collection: "countCategories",
  within: [],
  limit: RECRUITMENT_QUERY_LIMIT,
};

export const EXCLUSION_REASONS_QUERY: LiveQuery<"vocabularyTerms"> = {
  collection: "vocabularyTerms",
  within: [],
  where: [["kind", "==", EXCLUSION_REASON_TERM_KIND]],
  limit: 200,
};

/** The reports of the scopes a member holds. Programme staff read the collection whole instead. */
export function reportsInScope(viewer: Viewer): LiveQuery<"recruitmentReports"> {
  return {
    collection: "recruitmentReports",
    within: [],
    where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]],
    limit: RECRUITMENT_QUERY_LIMIT,
  };
}

export function pausesInScope(viewer: Viewer): LiveQuery<"plannedPauses"> {
  return {
    collection: "plannedPauses",
    within: [],
    where: [["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]],
    limit: RECRUITMENT_QUERY_LIMIT,
  };
}

/** The forecast runs of a replication, newest first, which every member reads. */
export function forecastRunsOf(replicationId: string): LiveQuery<"forecastRuns"> {
  return {
    collection: "forecastRuns",
    within: [],
    where: [["replicationId", "==", replicationId]],
    orderBy: [["generatedAt", "desc"]],
    limit: 50,
  };
}

export const ALL_HISTORICAL_AGGREGATES: LiveQuery<"historicalAggregates"> = {
  collection: "historicalAggregates",
  within: [],
  limit: RECRUITMENT_QUERY_LIMIT,
};

/** A stored report as the resolver reads it. */
export function reportFact(report: ReportRecord): ReportFact {
  return {
    id: report.id,
    participationId: report.participationId,
    asOfDate: report.asOfDate,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    reportKind: report.reportKind,
    basis: report.basis,
    entryKind: report.entryKind,
    correctsReportId: report.correctsReportId,
    verifiesReportId: report.verifiesReportId,
    counts: report.counts,
    exclusions: report.exclusions,
    // A report this browser has just filed waits for the server's time, and counts as the latest.
    createdAtMillis: isFirestoreTimestamp(report.createdAt) ? report.createdAt.toMillis() : Number.MAX_SAFE_INTEGER,
    dataOrigin: report.dataOrigin,
  };
}

/** The pauses that are not archived, as the forecast reads them. */
export function pauseFacts(pauses: readonly PauseRecord[]): PauseFact[] {
  return pauses
    .filter((pause) => pause.archivedAt === null)
    .map((pause) => ({ participationId: pause.participationId, startsOn: pause.startsOn, endsOn: pause.endsOn }));
}

/** The participations as rollups read them, with the country and institution of their laboratories. */
export function participationFacts(
  participations: readonly RecordOf<"participations">[],
  laboratories: readonly RecordOf<"laboratories">[],
): ParticipationFacts[] {
  const byId = new Map(laboratories.map((laboratory) => [laboratory.id, laboratory]));
  return participations
    .filter((participation) => participation.archivedAt === null)
    .map((participation) => {
      const laboratory = byId.get(participation.laboratoryId);
      return {
        id: participation.id,
        replicationId: participation.replicationId,
        laboratoryId: participation.laboratoryId,
        status: participation.status,
        countryCode: laboratory?.countryCode ?? null,
        institutionId: laboratory?.institutionId ?? null,
        targetNMain: participation.targetNMain ?? null,
        targetNRest: participation.targetNRest ?? null,
      };
    });
}

/** The categories that are current, in their order: the global ones, and those of the replications named. */
export function currentCategories(
  categories: readonly CategoryRecord[],
  replicationIds: ReadonlySet<string> | "all",
): CategoryRecord[] {
  return categories
    .filter(
      (category) =>
        category.archivedAt === null &&
        (category.replicationId === undefined ||
          replicationIds === "all" ||
          replicationIds.has(category.replicationId)),
    )
    .sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : 1));
}

/** Every report and pause the viewer may read, with the categories and the reasons, live. */
export function useRecruitmentData(viewer: Viewer | null): Live<RecruitmentData> {
  const staff = viewer?.staff === true;
  const allReports = useLiveCollection(
    viewer !== null && staff ? { collection: "recruitmentReports", within: [], limit: RECRUITMENT_QUERY_LIMIT } : null,
  );
  const allPauses = useLiveCollection(
    viewer !== null && staff ? { collection: "plannedPauses", within: [], limit: RECRUITMENT_QUERY_LIMIT } : null,
  );
  const scopedReports = useLiveQuery(viewer !== null && !staff ? reportsInScope(viewer) : null);
  const scopedPauses = useLiveQuery(viewer !== null && !staff ? pausesInScope(viewer) : null);
  const categories = useLiveQuery(viewer === null ? null : ALL_CATEGORIES);
  const reasons = useLiveQuery(viewer === null ? null : EXCLUSION_REASONS_QUERY);
  return useMemo(() => {
    if (viewer === null) return { status: "idle" };
    const reports: Live<{ items: readonly ReportRecord[]; truncated: boolean }> = staff
      ? allReports
      : combineLive([scopedReports] as const, (items) => ({
          items,
          truncated: items.length >= RECRUITMENT_QUERY_LIMIT,
        }));
    const pauses: Live<{ items: readonly PauseRecord[]; truncated: boolean }> = staff
      ? allPauses
      : combineLive([scopedPauses] as const, (items) => ({
          items,
          truncated: items.length >= RECRUITMENT_QUERY_LIMIT,
        }));
    return combineLive(
      [reports, pauses, categories, reasons] as const,
      (reportData, pauseData, categoryData, reasonData) => ({
        reports: reportData.items,
        facts: reportData.items.map(reportFact),
        pauses: pauseData.items,
        categories: [...categoryData].sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : 1)),
        reasons: reasonData
          .filter((reason) => reason.archivedAt === null && !reason.isDeprecated)
          .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
        truncated: reportData.truncated || pauseData.truncated,
      }),
    );
  }, [viewer, staff, allReports, allPauses, scopedReports, scopedPauses, categories, reasons]);
}

/** The basis of the effective values of one participation: reported, verified, both, or null with none. */
function basisOf(state: ParticipationRecruitment): "reported" | "verified" | "mixed" | null {
  const bases = new Set(
    Object.values(state.effective).flatMap((categories) => Object.values(categories ?? {}).map((value) => value.basis)),
  );
  if (bases.size === 0) return null;
  if (bases.size === 2) return "mixed";
  return bases.has("centrallyVerified") ? "verified" : "reported";
}

/**
 * The two collections of recruitment that views read: every report the viewer may read, and one
 * record for each participation with the effective values that hold today.
 */
export function recruitmentCollections(
  data: Pick<RecruitmentData, "reports" | "facts">,
  participations: readonly RecordOf<"participations">[],
  lookups: SourceLookups,
  today: string,
): { readonly reports: CollectionData; readonly states: CollectionData } {
  const reports = coreCollection(
    CORE_SOURCES["core:recruitmentReports"],
    data.reports.map((report) => ({ id: report.id, data: report as unknown as Readonly<Record<string, unknown>> })),
    {},
    lookups,
  );
  const current = participations.filter((participation) => participation.archivedAt === null);
  const states = resolveAll(
    current.map((participation) => participation.id),
    data.facts,
    { date: today },
  );
  const records = current.map((participation) => {
    const state = states.get(participation.id);
    return {
      id: participation.id,
      data: {
        replicationId: participation.replicationId,
        laboratoryId: participation.laboratoryId,
        status: participation.status,
        latestAsOfDate: state?.latestAsOfDate ?? null,
        basis: state === undefined ? null : basisOf(state),
        effective: state?.effective ?? {},
      },
    };
  });
  return { reports, states: coreCollection(CORE_SOURCES["core:recruitment"], records, {}, lookups) };
}
