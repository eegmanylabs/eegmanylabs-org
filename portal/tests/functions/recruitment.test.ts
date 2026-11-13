// Integration tests of recruitment, run against the emulators (docs/DATA_MODEL.md, section 7;
// D-009, D-019): who files which report, what the function checks, that corrections, voids and
// central verification are new reports, that the summary keeps the bases and the modalities
// apart and leaves unknown values absent, that leads manage the categories of their replication,
// that a forecast is computed on the server and stored as projected, and that the inactivity
// sweep opens one follow-up task per participation and spell however often it runs.
// Fixtures are synthetic: fictitious accounts, laboratories and studies on the example.org domain.
import {
  type CallableInput,
  COLLECTIONS,
  countCategoryDocSchema,
  EXCLUSION_REASON_TERM_KIND,
  type ForecastAssumptions,
  fileRecruitmentReportsContract,
  forecastRecruitment,
  forecastRunDocSchema,
  generateForecastContract,
  inactivityFollowUpTaskId,
  readForecastRun,
  recruitmentFollowUpListId,
  recruitmentReportDocSchema,
  replicationSummaryDocSchema,
  saveCountCategoryContract,
  statusDefinitionId,
  TASK_STATUSES,
  taskDocSchema,
  unitScopeKeys,
  vocabularyTermId,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../functions/src/framework/errors";
import { flagInactiveParticipations } from "../../functions/src/recruitment/inactivity";
import {
  PARTICIPATION_REPORTS_MAX,
  participationsOfReplication,
  REPLICATION_REPORTS_MAX,
  reportsOfReplication,
  requireReportRoom,
} from "../../functions/src/recruitment/reports";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  dataOf,
  grantRole,
  laboratory,
  notificationsOf,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

const STUDY = "RecruitStudy2001";
const OTHER_STUDY = "RecruitStudy2002";
const LAB_A = "lab-recruit-a";
const LAB_B = "lab-recruit-b";
const LAB_C = "lab-recruit-c";
const PA = `${STUDY}__${LAB_A}`;
const PB = `${STUDY}__${LAB_B}`;
const PC = `${STUDY}__${LAB_C}`;
const REASON = vocabularyTermId(EXCLUSION_REASON_TERM_KIND, "Excessive artefacts in the EEG recording");
const TODAY = new Date().toISOString().slice(0, 10);

async function participation(id: string, laboratoryId: string, status: string, fields: Record<string, unknown> = {}) {
  await adminDb.doc(COLLECTIONS.participations.docPath(id)).set({
    ...standard(),
    replicationId: STUDY,
    laboratoryId,
    scopeKeys: unitScopeKeys(STUDY, laboratoryId),
    status,
    statusHistoryId: null,
    readinessStatus: "approved",
    custom: {},
    dataOrigin: "demo",
    ...fields,
  });
}

async function category(key: string, fields: Record<string, unknown> = {}) {
  await adminDb.doc(COLLECTIONS.countCategories.docPath(key)).set({
    ...standard(),
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    definition: `Participants counted as ${key} in a synthetic test.`,
    position: 0,
    isCore: true,
    ...fields,
  });
}

interface World {
  readonly memberA: Caller;
  readonly coordinatorA: Caller;
  readonly coordinatorB: Caller;
  readonly lead: Caller;
  readonly otherLead: Caller;
  readonly admin: Caller;
}

async function world(): Promise<World> {
  await Promise.all([
    replication(STUDY),
    replication(OTHER_STUDY),
    laboratory(LAB_A),
    laboratory(LAB_B),
    laboratory(LAB_C),
  ]);
  await participation(PA, LAB_A, "collecting", { targetNMain: 40, targetNRest: 30 });
  await participation(PB, LAB_B, "collecting", { targetNMain: 20 });
  await participation(PC, LAB_C, "invited");
  await Promise.all([category("tested"), category("recorded"), category("usable"), category("excluded")]);
  await category("eyesClosed", { isCore: false, replicationId: OTHER_STUDY });
  await adminDb.doc(COLLECTIONS.vocabularyTerms.docPath(REASON)).set({
    ...standard(),
    sourceId: "artefacts",
    name: "Excessive artefacts in the EEG recording",
    kind: EXCLUSION_REASON_TERM_KIND,
    sameAsSource: [],
    labelsSource: ["Excessive artefacts in the EEG recording"],
    isDeprecated: false,
  });
  const memberA = await account("uid-recruit-member-a");
  await grantRole("uid-recruit-member-a", "lab_member", "laboratory", LAB_A);
  const coordinatorA = await account("uid-recruit-coordinator-a");
  await grantRole("uid-recruit-coordinator-a", "lab_coordinator", "laboratory", LAB_A);
  const coordinatorB = await account("uid-recruit-coordinator-b");
  await grantRole("uid-recruit-coordinator-b", "lab_coordinator", "laboratory", LAB_B);
  const lead = await account("uid-recruit-lead");
  await grantRole("uid-recruit-lead", "replication_lead", "replication", STUDY);
  const otherLead = await account("uid-recruit-other-lead");
  await grantRole("uid-recruit-other-lead", "replication_lead", "replication", OTHER_STUDY);
  const admin = await administrator("uid-recruit-admin");
  return { memberA, coordinatorA, coordinatorB, lead, otherLead, admin };
}

type ReportInput = CallableInput<typeof fileRecruitmentReportsContract>["reports"][number];

const cumulative = (
  participationId: string,
  counts: ReportInput["counts"],
  fields: Partial<ReportInput> = {},
): ReportInput => ({
  participationId,
  asOfDate: TODAY,
  reportKind: "cumulative",
  basis: "labReported",
  entryKind: "new",
  counts,
  exclusions: [],
  ...fields,
});

async function file(caller: Caller, ...reports: ReportInput[]): Promise<string[]> {
  return (await call(caller, fileRecruitmentReportsContract, { reports })).reportIds;
}

async function summary() {
  return replicationSummaryDocSchema.parse(
    await dataOf(COLLECTIONS.replicationSummaries.docPath(STUDY, "recruitment")),
  );
}

withoutTriggers();
beforeEach(resetWorld);

describe("fileRecruitmentReports", () => {
  it("files the main experiment, the resting state and unique participants apart, and never adds them", async () => {
    const { memberA } = await world();
    const [reportId] = await file(
      memberA,
      cumulative(
        PA,
        { main: { tested: 12 }, rest: { tested: 10 }, participants: { tested: 14 } },
        {
          exclusions: [{ modality: "main", reasonTermId: REASON, count: 1 }],
          note: "Two sessions were split across days.",
        },
      ),
    );
    const stored = recruitmentReportDocSchema.parse(
      await dataOf(COLLECTIONS.recruitmentReports.docPath(reportId as string)),
    );
    expect(stored).toMatchObject({
      participationId: PA,
      replicationId: STUDY,
      laboratoryId: LAB_A,
      scopeKeys: unitScopeKeys(STUDY, LAB_A),
      basis: "labReported",
      entryKind: "new",
      reportedBy: memberA.uid,
      source: "manual",
      dataOrigin: "live",
      counts: { main: { tested: 12 }, rest: { tested: 10 }, participants: { tested: 14 } },
    });
    expect(stored.writeContext.auditEventId).not.toBeNull();
    const [audit] = await auditOf("recruitmentReport.filed", reportId);
    expect(audit?.actorUid).toBe(memberA.uid);
    const totals = await summary();
    expect(totals.totals).toEqual({
      labReported: { main: { tested: 12 }, rest: { tested: 10 }, participants: { tested: 14 } },
    });
    expect(totals.reporting?.labReported?.main?.tested).toBe(1);
    expect(totals).toMatchObject({ participationCount: 3, reportCount: 1, latestAsOfDate: TODAY });
  });

  it("files one report for each changed row of a lead's table, in one call, and keeps unknown values absent", async () => {
    const { lead } = await world();
    const ids = await file(lead, cumulative(PA, { main: { tested: 5 } }), cumulative(PB, { rest: { usable: 3 } }));
    expect(ids).toHaveLength(2);
    expect(await auditOf("recruitmentReport.filed")).toHaveLength(2);
    const totals = await summary();
    expect(totals.totals.labReported).toEqual({ main: { tested: 5 }, rest: { usable: 3 } });
    expect(totals.totals.labReported?.main?.usable).toBeUndefined();
  });

  it("refuses those outside the laboratory and the replication, and verification by the laboratory", async () => {
    const { coordinatorB, otherLead, memberA } = await world();
    expect(await codeOf(file(coordinatorB, cumulative(PA, { main: { tested: 1 } })))).toBe("permission-denied");
    expect(await codeOf(file(otherLead, cumulative(PA, { main: { tested: 1 } })))).toBe("permission-denied");
    const [first] = await file(memberA, cumulative(PA, { main: { tested: 1 } }));
    expect(
      await codeOf(
        file(
          memberA,
          cumulative(PA, { main: { tested: 1 } }, { basis: "centrallyVerified", verifiesReportId: first as string }),
        ),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(call(null, fileRecruitmentReportsContract, { reports: [cumulative(PA, { main: { tested: 1 } })] })),
    ).toBe("unauthenticated");
  });

  it("checks every category, reason, date and participation", async () => {
    const { lead } = await world();
    expect(await codeOf(file(lead, cumulative(PA, { main: { unheardOf: 3 } })))).toBe("invalid-argument");
    expect(await codeOf(file(lead, cumulative(PA, { main: { eyesClosed: 3 } })))).toBe("invalid-argument");
    expect(await codeOf(file(lead, cumulative(PA, { main: { tested: 3 } }, { asOfDate: "2999-01-01" })))).toBe(
      "invalid-argument",
    );
    expect(await codeOf(file(lead, cumulative(PC, { main: { tested: 3 } })))).toBe("failed-precondition");
    expect(
      await codeOf(
        file(
          lead,
          cumulative(
            PA,
            { main: { tested: 3 } },
            { exclusions: [{ modality: "main", reasonTermId: "nonsense", count: 1 }] },
          ),
        ),
      ),
    ).toBe("invalid-argument");
    expect(await codeOf(file(lead, cumulative(PA, {})))).toBe("invalid-argument");
    expect(
      await codeOf(
        file(
          lead,
          cumulative(
            PA,
            { main: { tested: 1 } },
            { reportKind: "period", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
          ),
        ),
      ),
    ).toBe("invalid-argument");
    expect(await auditOf("recruitmentReport.filed")).toHaveLength(0);
  });

  it("files a correction and a void as new reports that name the one they replace, once", async () => {
    const { coordinatorA, admin } = await world();
    const [first] = (await file(coordinatorA, cumulative(PA, { main: { tested: 12 } }))) as [string];
    const [fix] = (await file(
      coordinatorA,
      cumulative(
        PA,
        { main: { tested: 11 } },
        { entryKind: "correction", correctsReportId: first, note: "One session was double counted." },
      ),
    )) as [string];
    expect((await summary()).totals.labReported?.main?.tested).toBe(11);
    expect((await dataOf(COLLECTIONS.recruitmentReports.docPath(first)))?.counts).toEqual({ main: { tested: 12 } });
    expect(
      await codeOf(
        file(
          coordinatorA,
          cumulative(
            PA,
            { main: { tested: 10 } },
            { entryKind: "correction", correctsReportId: first, note: "Again." },
          ),
        ),
      ),
    ).toBe("failed-precondition");
    expect(
      await codeOf(
        file(
          admin,
          cumulative(
            PA,
            { main: { tested: 10 } },
            { basis: "centrallyVerified", entryKind: "correction", correctsReportId: fix, note: "Wrong basis." },
          ),
        ),
      ),
    ).toBe("invalid-argument");
    await file(
      coordinatorA,
      cumulative(PA, {}, { entryKind: "void", correctsReportId: fix, note: "Filed for the wrong laboratory." }),
    );
    const totals = await summary();
    expect(totals.totals.labReported).toBeUndefined();
    expect(totals.reportCount).toBe(3);
  });

  it("files central verification as a new report beside the lab's, for administrators alone", async () => {
    const { coordinatorA, admin } = await world();
    const [labReport] = (await file(coordinatorA, cumulative(PA, { main: { tested: 12 } }))) as [string];
    await file(
      admin,
      cumulative(PA, { main: { tested: 11 } }, { basis: "centrallyVerified", verifiesReportId: labReport }),
    );
    const totals = await summary();
    expect(totals.totals).toEqual({
      labReported: { main: { tested: 12 } },
      centrallyVerified: { main: { tested: 11 } },
    });
    expect((await dataOf(COLLECTIONS.recruitmentReports.docPath(labReport)))?.counts).toEqual({ main: { tested: 12 } });
    expect(
      await codeOf(
        file(
          admin,
          cumulative(PA, { main: { tested: 1 } }, { basis: "centrallyVerified", verifiesReportId: "missing-report" }),
        ),
      ),
    ).toBe("not-found");
  });
});

/** Stored reports of a participation, written past the function as an import or a flood would leave them. */
async function storedReports(participationId: string, laboratoryId: string, count: number) {
  for (let first = 0; first < count; first += 500) {
    const batch = adminDb.batch();
    for (let index = first; index < Math.min(count, first + 500); index += 1) {
      batch.set(
        adminDb.collection(COLLECTIONS.recruitmentReports.collectionPath()).doc(),
        recruitmentReportDocSchema.parse({
          schemaVersion: 1,
          createdAt: Timestamp.now(),
          createdBy: "uid-recruit-member-a",
          writeContext: { origin: "user", depth: 0, correlationId: null, causationId: null, auditEventId: null },
          participationId,
          replicationId: STUDY,
          laboratoryId,
          scopeKeys: unitScopeKeys(STUDY, laboratoryId),
          asOfDate: "2026-01-01",
          reportKind: "cumulative",
          basis: "labReported",
          entryKind: "new",
          counts: { main: { tested: index } },
          exclusions: [],
          reportedBy: "uid-recruit-member-a",
          source: "manual",
          dataOrigin: "live",
        }),
      );
    }
    await batch.commit();
  }
}

describe("the bounds on the reports of a replication", () => {
  it("refuse more reports for a participation that holds its share, so that one laboratory cannot fill its replication", async () => {
    await world();
    await storedReports(PA, LAB_A, 3);
    // The callable checks PARTICIPATION_REPORTS_MAX with this function; a bound of three stands for it.
    const room = (participationId: string, adding: number) =>
      adminDb
        .runTransaction((transaction) => requireReportRoom(adminDb, transaction, participationId, adding, 3))
        .then(
          () => "(no error)",
          (error: unknown) => (error instanceof AppError ? error.code : String(error)),
        );
    expect(await room(PA, 1)).toBe("resource-exhausted");
    expect(await room(PA, 0)).toBe("(no error)");
    // Another laboratory of the same replication keeps its own room.
    expect(await room(PB, 3)).toBe("(no error)");
    expect(PARTICIPATION_REPORTS_MAX).toBeGreaterThan(100);
  });

  it("refuse a summary or a forecast from part of the reports, never leaving some out unseen", async () => {
    await world();
    await storedReports(PA, LAB_A, 4);
    // The summary and the forecast read the reports through this function, with a bound of
    // REPLICATION_REPORTS_MAX; a bound of three stands for it, so that the test writes four.
    const refusal = await reportsOfReplication(adminDb, null, STUDY, 3).then(
      () => "(no error)",
      (error: unknown) => (error instanceof AppError ? error.code : String(error)),
    );
    expect(refusal).toBe("resource-exhausted");
    expect(await reportsOfReplication(adminDb, null, STUDY, 4)).toHaveLength(4);
    expect(REPLICATION_REPORTS_MAX).toBeGreaterThan(PARTICIPATION_REPORTS_MAX);
  });
});

describe("saveCountCategory", () => {
  it("lets a lead add an extension of their replication, and refuses global categories and other replications", async () => {
    const { lead, otherLead, coordinatorA } = await world();
    const extension = {
      key: "eyesOpen",
      create: true,
      label: "Eyes open",
      definition: "Participants with a complete eyes-open resting recording.",
      replicationId: STUDY,
      archived: false,
    };
    expect(await codeOf(call(otherLead, saveCountCategoryContract, extension))).toBe("permission-denied");
    expect(await codeOf(call(coordinatorA, saveCountCategoryContract, extension))).toBe("permission-denied");
    expect(await codeOf(call(lead, saveCountCategoryContract, { ...extension, replicationId: null }))).toBe(
      "permission-denied",
    );
    await call(lead, saveCountCategoryContract, extension);
    const stored = countCategoryDocSchema.parse(await dataOf(COLLECTIONS.countCategories.docPath("eyesOpen")));
    expect(stored).toMatchObject({ replicationId: STUDY, isCore: false, label: "Eyes open" });
    expect(await auditOf("countCategory.saved", STUDY)).toHaveLength(1);
    expect(await codeOf(call(lead, saveCountCategoryContract, extension))).toBe("already-exists");
    expect(
      await codeOf(call(lead, saveCountCategoryContract, { ...extension, key: "eyesClosed", create: false })),
    ).toBe("permission-denied");
    await file(lead, cumulative(PA, { rest: { eyesOpen: 4 } }));
    expect((await summary()).totals.labReported?.rest?.eyesOpen).toBe(4);
    await call(lead, saveCountCategoryContract, { ...extension, create: false, archived: true });
    expect(await codeOf(file(lead, cumulative(PA, { rest: { eyesOpen: 5 } })))).toBe("invalid-argument");
  });

  it("lets an administrator edit a global category and refuses to archive a core one", async () => {
    const { admin } = await world();
    const edit = {
      key: "tested",
      create: false,
      label: "Tested",
      definition: "Participants who attended a session and began the procedure.",
      replicationId: null,
      archived: false,
    };
    await call(admin, saveCountCategoryContract, edit);
    expect((await dataOf(COLLECTIONS.countCategories.docPath("tested")))?.definition).toBe(edit.definition);
    expect(await codeOf(call(admin, saveCountCategoryContract, { ...edit, archived: true }))).toBe(
      "failed-precondition",
    );
  });
});

describe("generateForecast", () => {
  const assumptions = (): ForecastAssumptions => ({
    modality: "main",
    category: "tested",
    target: null,
    exclusionRate: 0.1,
    windowDays: 90,
    scenarioSpread: 0.25,
    activeParticipationIds: [PA, PB],
    includePlannedPauses: true,
    inputsAsOf: TODAY,
  });

  it("computes the forecast from the stored reports and stores it as projected, for the leads", async () => {
    const { lead, memberA, otherLead } = await world();
    await file(lead, cumulative(PA, { main: { tested: 4 } }, { asOfDate: "2026-01-01" }));
    await file(lead, cumulative(PA, { main: { tested: 10 } }, { asOfDate: "2026-03-01" }));
    expect(
      await codeOf(call(memberA, generateForecastContract, { replicationId: STUDY, assumptions: assumptions() })),
    ).toBe("permission-denied");
    expect(
      await codeOf(call(otherLead, generateForecastContract, { replicationId: STUDY, assumptions: assumptions() })),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(lead, generateForecastContract, {
          replicationId: STUDY,
          assumptions: { ...assumptions(), activeParticipationIds: ["Elsewhere__lab"] },
        }),
      ),
    ).toBe("invalid-argument");
    const { forecastRunId } = await call(lead, generateForecastContract, {
      replicationId: STUDY,
      assumptions: assumptions(),
    });
    const run = forecastRunDocSchema.parse(await dataOf(COLLECTIONS.forecastRuns.docPath(forecastRunId)));
    expect(run).toMatchObject({
      replicationId: STUDY,
      dataOrigin: "projected",
      generatedBy: lead.uid,
      inputsAsOf: TODAY,
    });
    const read = readForecastRun(run);
    const expected = forecastRecruitment(
      await participationsOfReplication(adminDb, null, STUDY),
      await reportsOfReplication(adminDb, null, STUDY),
      [],
      assumptions(),
    );
    // The stored run holds the figures of the replication as a whole, and none of one laboratory.
    const { laboratories: _perLaboratory, ...replicationLevel } = expected;
    expect(read?.result).toEqual(replicationLevel);
    expect(read?.result.target).toBe(60);
    expect(await auditOf("forecast.generated", STUDY)).toHaveLength(1);
  });
});

describe("the inactivity sweep", () => {
  beforeEach(async () => {
    for (const [position, status] of TASK_STATUSES.entries()) {
      await adminDb.doc(COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("task", status.key))).set({
        ...standard(),
        entityType: "task",
        key: status.key,
        label: status.label,
        category: status.category,
        position,
        isDefault: position === 0,
      });
    }
  });

  /** A report filed `days` days ago, written as the function would have written it. */
  async function filedDaysAgo(participationId: string, laboratoryId: string, days: number) {
    const at = Timestamp.fromDate(new Date(Date.now() - days * 86_400_000));
    await adminDb.collection(COLLECTIONS.recruitmentReports.collectionPath()).add(
      recruitmentReportDocSchema.parse({
        schemaVersion: 1,
        createdAt: at,
        createdBy: "uid-recruit-lead",
        writeContext: { origin: "user", depth: 0, correlationId: null, causationId: null, auditEventId: null },
        participationId,
        replicationId: STUDY,
        laboratoryId,
        scopeKeys: unitScopeKeys(STUDY, laboratoryId),
        asOfDate: at.toDate().toISOString().slice(0, 10),
        reportKind: "cumulative",
        basis: "labReported",
        entryKind: "new",
        counts: { main: { tested: 3 } },
        exclusions: [],
        reportedBy: "uid-recruit-lead",
        source: "manual",
        dataOrigin: "live",
      }),
    );
    return at.toDate().toISOString().slice(0, 10);
  }

  it("opens one follow-up task per participation and spell, tells the coordinators and leads, and opens nothing twice", async () => {
    const { coordinatorA, lead } = await world();
    const silentSince = await filedDaysAgo(PA, LAB_A, 40);
    await filedDaysAgo(PB, LAB_B, 3);
    const now = new Date();
    expect(await flagInactiveParticipations(adminDb, now, 30)).toEqual({ checked: 2, flagged: 1, alreadyFlagged: 0 });

    const taskId = inactivityFollowUpTaskId(PA, silentSince);
    const task = taskDocSchema.parse(await dataOf(COLLECTIONS.tasks.docPath(taskId)));
    expect(task).toMatchObject({
      listId: recruitmentFollowUpListId(LAB_A),
      assigneeUids: [coordinatorA.uid],
      collaboratorUids: [lead.uid],
      links: [{ entityType: "participation", entityId: PA }],
      laboratoryId: LAB_A,
    });
    expect((await dataOf(COLLECTIONS.taskLists.docPath(recruitmentFollowUpListId(LAB_A))))?.name).toBe(
      "Recruitment follow-up",
    );
    const told = (await notificationsOf(coordinatorA.uid)).filter((item) => item.type === "recruitmentInactive");
    expect(told).toHaveLength(1);
    expect(told[0]?.payload).toMatchObject({ participationId: PA, silentSince, taskId });
    expect((await notificationsOf(lead.uid)).filter((item) => item.type === "recruitmentInactive")).toHaveLength(1);

    expect(await flagInactiveParticipations(adminDb, now, 30)).toEqual({ checked: 2, flagged: 0, alreadyFlagged: 1 });
    expect(
      (await notificationsOf(coordinatorA.uid)).filter((item) => item.type === "recruitmentInactive"),
    ).toHaveLength(1);
    expect(await auditOf("recruitment.inactivityFlagged", PA)).toHaveLength(1);

    // A later report ends the spell; a new silence of its own opens a task of its own.
    const later = await filedDaysAgo(PA, LAB_A, 35);
    expect(later).not.toBe(silentSince);
    expect(await flagInactiveParticipations(adminDb, now, 30)).toEqual({ checked: 2, flagged: 1, alreadyFlagged: 0 });
    expect((await dataOf(COLLECTIONS.tasks.docPath(inactivityFollowUpTaskId(PA, later))))?.listId).toBe(
      recruitmentFollowUpListId(LAB_A),
    );
  });

  it("leaves a participation alone while it reports within the threshold", async () => {
    await world();
    await filedDaysAgo(PA, LAB_A, 10);
    await filedDaysAgo(PB, LAB_B, 29);
    expect(await flagInactiveParticipations(adminDb, new Date(), 30)).toEqual({
      checked: 2,
      flagged: 0,
      alreadyFlagged: 0,
    });
  });
});
