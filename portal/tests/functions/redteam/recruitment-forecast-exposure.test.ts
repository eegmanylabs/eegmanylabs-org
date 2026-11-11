// Red-team attacks on recruitment (docs/DATA_MODEL.md, sections 7 and 15; D-009, D-019), made
// through the functions emulator as members of one laboratory who try to learn the figures of
// another. A recruitment report is read within the scope of its participation, so a member of
// one laboratory never reads the reports of another, but a forecast run is read by every member:
// whatever the run stores about one laboratory, every member reads.
//
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, laboratories and studies on the example.org domain.
import {
  COLLECTIONS,
  fileRecruitmentReportsContract,
  forecastRunDocSchema,
  generateForecastContract,
  unitScopeKeys,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../../support/admin";
import { account, call, grantRole, laboratory, leaveNoTrace, replication, resetWorld, standard } from "../support";

const STUDY = "RedTeamRecruit2001";
const LAB_A = "lab-redteam-recruit-a";
const LAB_B = "lab-redteam-recruit-b";
const PA = `${STUDY}__${LAB_A}`;
const PB = `${STUDY}__${LAB_B}`;
const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

beforeEach(resetWorld);
afterAll(leaveNoTrace);

async function participation(id: string, laboratoryId: string) {
  await adminDb.doc(COLLECTIONS.participations.docPath(id)).set({
    ...standard(),
    replicationId: STUDY,
    laboratoryId,
    scopeKeys: unitScopeKeys(STUDY, laboratoryId),
    status: "collecting",
    statusHistoryId: null,
    readinessStatus: "approved",
    targetNMain: 40,
    custom: {},
    dataOrigin: "demo",
  });
}

describe("a forecast run, which every member reads", () => {
  it("holds the figures of the replication and none of one laboratory", async () => {
    await Promise.all([replication(STUDY), laboratory(LAB_A), laboratory(LAB_B)]);
    await Promise.all([participation(PA, LAB_A), participation(PB, LAB_B)]);
    await adminDb.doc(COLLECTIONS.countCategories.docPath("tested")).set({
      ...standard(),
      key: "tested",
      label: "Tested",
      definition: "Participants tested in a synthetic test.",
      position: 0,
      isCore: true,
    });
    const coordinatorB = await account("uid-redteam-coordinator-b");
    await grantRole(coordinatorB.uid, "lab_coordinator", "laboratory", LAB_B);
    const lead = await account("uid-redteam-recruit-lead");
    await grantRole(lead.uid, "replication_lead", "replication", STUDY);
    // Laboratory B reports figures that only its scope may read: 17 and then 29 tested.
    for (const [asOfDate, tested] of [
      [daysAgo(40), 17],
      [daysAgo(5), 29],
    ] as const) {
      await call(coordinatorB, fileRecruitmentReportsContract, {
        reports: [
          {
            participationId: PB,
            asOfDate,
            reportKind: "cumulative",
            basis: "labReported",
            entryKind: "new",
            counts: { main: { tested } },
            exclusions: [],
          },
        ],
      });
    }

    const { forecastRunId } = await call(lead, generateForecastContract, {
      replicationId: STUDY,
      assumptions: {
        modality: "main",
        category: "tested",
        target: null,
        exclusionRate: 0.1,
        windowDays: 90,
        scenarioSpread: 0.25,
        activeParticipationIds: [PA, PB],
        includePlannedPauses: true,
        inputsAsOf: TODAY,
      },
    });
    const run = forecastRunDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.forecastRuns.docPath(forecastRunId)).get()).data(),
    );
    const derived = run.assumptions.derived as { readonly laboratories?: readonly Record<string, unknown>[] };
    const perLaboratory = (derived.laboratories ?? []).filter(
      (entry) => entry.current !== null || entry.rate !== null || entry.pausedDays !== 0,
    );
    expect(perLaboratory).toEqual([]);
  });
});
