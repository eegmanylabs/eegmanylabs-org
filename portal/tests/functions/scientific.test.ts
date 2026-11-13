// Integration tests of the callable functions of the scientific workflows (phase 8): findings of
// hypotheses with their provenance, analysis runs over datasets of the registry, the append-only
// decision log and incident registry, authorship lists that the leads prepare and each person
// confirms, outputs with their events and milestones, and OSF links checked against the fake.
// Everything here is synthetic: invented studies, laboratories, people and OSF resources.
import {
  authorshipEntryDocSchema,
  authorshipListDocSchema,
  COLLECTIONS,
  checkOsfLinkContract,
  createTaskListContract,
  decisionDocSchema,
  decisionStates,
  documentLinkDocSchema,
  incidentActionDocSchema,
  incidentDocSchema,
  incidentState,
  listMyAuthorshipEntriesContract,
  manuscriptDocSchema,
  participationId,
  planManuscriptMilestoneContract,
  processingRunDocSchema,
  recordDecisionContract,
  recordHypothesisFindingContract,
  recordIncidentActionContract,
  recordManuscriptEventContract,
  replicationHypothesisDocSchema,
  reportIncidentContract,
  respondToAuthorshipEntryContract,
  saveAnalysisRunContract,
  saveAuthorshipListContract,
  saveManuscriptContract,
  statusDefinitionId,
  TASK_STATUSES,
  taskDocSchema,
  unitScopeKeys,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emulatorOsfFake, FAKE_OSF, initialOsfState } from "../../functions/src/integrations/osf/fake";
import { adminDb } from "../support/admin";
import {
  account,
  auditOf,
  type Caller,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  dataset,
  grantRole,
  laboratory,
  person,
  refusal,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

const STUDY = "SciStudy2001";
const OTHER_STUDY = "SciStudy2002";
const LAB = "lab-sci";
const OTHER_LAB = "lab-elsewhere";
const PARTICIPATION = participationId(STUDY, LAB);
const DATASET = "SciStudy2001-lab-sci-main";

withoutTriggers();

beforeEach(async () => {
  await resetWorld();
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
  await replication(STUDY);
  await replication(OTHER_STUDY);
  await laboratory(LAB);
  await laboratory(OTHER_LAB);
  await adminDb.doc(COLLECTIONS.participations.docPath(PARTICIPATION)).set({
    ...standard(),
    replicationId: STUDY,
    laboratoryId: LAB,
    scopeKeys: unitScopeKeys(STUDY, LAB),
    status: "collecting",
    statusHistoryId: null,
    readinessStatus: "approved",
    custom: {},
    dataOrigin: "demo",
  });
  await adminDb.doc(COLLECTIONS.replicationHypotheses.docPath(STUDY, "h01")).set({
    ...standard(),
    replicationId: STUDY,
    hypothesisNumber: "1",
    text: "A synthetic effect is larger in the first condition.",
    scientificReviewStatus: "unverified",
    analysisStatus: "notStarted",
    resultReviewedBy: null,
    resultReviewedAt: null,
  });
  await dataset(DATASET, STUDY, LAB);
  emulatorOsfFake().transact((state) => Object.assign(state, initialOsfState()));
});

afterEach(() => {
  emulatorOsfFake().transact((state) => Object.assign(state, initialOsfState()));
});

async function lead(uid = "uid-sci-lead"): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "replication_lead", "replication", STUDY);
  return caller;
}

async function coordinator(uid = "uid-sci-coordinator", laboratoryId = LAB): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "lab_coordinator", "laboratory", laboratoryId);
  return caller;
}

async function member(uid = "uid-sci-member"): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "lab_member", "laboratory", OTHER_LAB);
  return caller;
}

const provenance = {
  source: "originalArticle" as const,
  locator: "Table 2, page 14",
  url: "https://example.org/original-article",
  analysisRunId: null,
  manuscriptId: null,
};

const runInput = {
  runId: null,
  replicationId: STUDY,
  laboratoryId: null,
  kind: "analysis" as const,
  title: "Confirmatory analysis",
  pipelineName: "synthetic-erp-pipeline",
  version: "1.4.0",
  codeUrl: "https://example.org/code/synthetic-erp-pipeline",
  codeCommit: "0123ABCD",
  parameters: { highPassHz: 0.1, reference: "average" },
  environment: { python: "3.12" },
  status: "succeeded" as const,
  startedAt: "2026-04-01T10:00:00Z",
  finishedAt: "2026-04-01T11:00:00Z",
  inputs: [{ datasetId: DATASET, storageRefId: null }],
  outputs: [{ label: "Main effect", kind: "statistics" as const }],
  hypothesisIds: ["h01"],
  qcStatus: "passed" as const,
  qcNotes: null,
  reproducibilityStatus: "notAttempted" as const,
  reproducesRunId: null,
  reproducibilityNotes: null,
};

describe("findings of a hypothesis", () => {
  it("are recorded with their provenance, never prefilled, and a lead records nothing once reviewed", async () => {
    const leader = await lead();
    const outsider = await member();
    expect(
      await codeOf(
        call(outsider, recordHypothesisFindingContract, {
          replicationId: STUDY,
          hypothesisId: "h01",
          finding: "originalStatistics",
          text: "t(23) = 2.5, p = .02",
          provenance,
          analysisStatus: null,
        }),
      ),
    ).toBe("permission-denied");
    await call(leader, recordHypothesisFindingContract, {
      replicationId: STUDY,
      hypothesisId: "h01",
      finding: "originalStatistics",
      text: "t(23) = 2.5, p = .02",
      provenance,
      analysisStatus: null,
    });
    const recorded = replicationHypothesisDocSchema.parse(await dataOf(`replications/${STUDY}/hypotheses/h01`));
    expect(recorded.originalStatistics).toBe("t(23) = 2.5, p = .02");
    expect(recorded.originalStatisticsProvenance).toMatchObject({
      source: "originalArticle",
      locator: "Table 2, page 14",
      recordedBy: leader.uid,
    });
    // Nothing else is filled in: the result stays empty.
    expect(recorded.resultSummary).toBeUndefined();
    expect(recorded.resultProvenance).toBeUndefined();
    expect(await auditOf("hypothesis.findingRecorded")).toHaveLength(1);

    // An original statistic comes from the original study, never from a run of the replication.
    expect(
      (
        await refusal(
          call(leader, recordHypothesisFindingContract, {
            replicationId: STUDY,
            hypothesisId: "h01",
            finding: "originalStatistics",
            text: "t(23) = 2.6",
            provenance: { ...provenance, source: "analysisRun", analysisRunId: "x" },
            analysisStatus: null,
          }),
        )
      ).code,
    ).toBe("invalid-argument");

    // A result names the run it comes from, which tests the hypothesis.
    const { runId } = await call(leader, saveAnalysisRunContract, runInput);
    await call(leader, recordHypothesisFindingContract, {
      replicationId: STUDY,
      hypothesisId: "h01",
      finding: "result",
      text: "The synthetic effect was found.",
      provenance: { ...provenance, source: "analysisRun", locator: "Main effect", url: null, analysisRunId: runId },
      analysisStatus: "completed",
    });
    const withResult = replicationHypothesisDocSchema.parse(await dataOf(`replications/${STUDY}/hypotheses/h01`));
    expect(withResult).toMatchObject({ analysisStatus: "completed", resultProvenance: { analysisRunId: runId } });

    // Once reviewed, the lead records nothing more, and the core team's new result clears the review.
    const core = await coreTeamMember("uid-sci-core");
    await adminDb
      .doc(`replications/${STUDY}/hypotheses/h01`)
      .update({ resultReviewedBy: core.uid, resultReviewedAt: Timestamp.now() });
    expect(
      await codeOf(
        call(leader, recordHypothesisFindingContract, {
          replicationId: STUDY,
          hypothesisId: "h01",
          finding: "result",
          text: "Changed after review.",
          provenance: { ...provenance, source: "analysisRun", analysisRunId: runId },
          analysisStatus: null,
        }),
      ),
    ).toBe("failed-precondition");
    await call(core, recordHypothesisFindingContract, {
      replicationId: STUDY,
      hypothesisId: "h01",
      finding: "result",
      text: "The synthetic effect was found, smaller than first reported.",
      provenance: { ...provenance, source: "analysisRun", analysisRunId: runId },
      analysisStatus: null,
    });
    const rewritten = replicationHypothesisDocSchema.parse(await dataOf(`replications/${STUDY}/hypotheses/h01`));
    expect(rewritten.resultReviewedBy).toBeNull();
  });
});

describe("analysis runs", () => {
  it("are recorded over datasets of their replication, with the listing of each copy, and changed in place", async () => {
    const leader = await lead();
    const { runId } = await call(leader, saveAnalysisRunContract, runInput);
    const run = processingRunDocSchema.parse(await dataOf(`processingRuns/${runId}`));
    expect(run).toMatchObject({
      replicationId: STUDY,
      scopeKeys: [`rep:${STUDY}`],
      inputDatasetIds: [DATASET],
      codeCommit: "0123abcd",
      runBy: leader.uid,
      qcStatus: "passed",
    });
    expect((await auditOf("analysisRun.saved", runId)).length).toBe(1);

    // A dataset of another replication, a hypothesis that does not exist and a reproduction of nothing are refused.
    await dataset("SciStudy2002-main", OTHER_STUDY, null);
    for (const wrong of [
      { inputs: [{ datasetId: "SciStudy2002-main", storageRefId: null }] },
      { hypothesisIds: ["h09"] },
      { reproducibilityStatus: "reproduced" as const },
      { finishedAt: "2026-04-01T09:00:00Z" },
      { laboratoryId: OTHER_LAB },
    ]) {
      expect(await codeOf(call(leader, saveAnalysisRunContract, { ...runInput, ...wrong }))).toBe("invalid-argument");
    }

    // A second run reproduces the first, and the first is changed in place.
    const { runId: second } = await call(leader, saveAnalysisRunContract, {
      ...runInput,
      title: "Reproduction",
      reproducibilityStatus: "reproduced",
      reproducesRunId: runId,
    });
    expect(processingRunDocSchema.parse(await dataOf(`processingRuns/${second}`)).reproducesRunId).toBe(runId);
    await call(leader, saveAnalysisRunContract, {
      ...runInput,
      runId,
      qcStatus: "flagged",
      qcNotes: "One channel noisy.",
    });
    expect(processingRunDocSchema.parse(await dataOf(`processingRuns/${runId}`))).toMatchObject({
      qcStatus: "flagged",
      qcNotes: "One channel noisy.",
    });
  });

  it("are recorded by the laboratory's coordinator for its own laboratory only, and by nobody outside", async () => {
    const coordinating = await coordinator();
    const { runId } = await call(coordinating, saveAnalysisRunContract, { ...runInput, laboratoryId: LAB });
    expect(processingRunDocSchema.parse(await dataOf(`processingRuns/${runId}`)).scopeKeys).toEqual(
      unitScopeKeys(STUDY, LAB),
    );
    expect(await codeOf(call(coordinating, saveAnalysisRunContract, runInput))).toBe("permission-denied");
    expect(await codeOf(call(await member(), saveAnalysisRunContract, runInput))).toBe("permission-denied");
  });
});

describe("the decision log", () => {
  it("appends decisions, corrections and replacements, and never changes an entry", async () => {
    const leader = await lead();
    const base = {
      scopeType: "replication" as const,
      scopeId: STUDY,
      kind: "decision" as const,
      correctsDecisionId: null,
      supersedesDecisionId: null,
      title: "Exclude trials with artefacts",
      summary: "Trials above 100 µV are excluded.",
      rationale: null,
      outcome: null,
      status: "accepted" as const,
      ownerPersonId: null,
      decidedAt: "2026-03-01",
      deviations: [],
    };
    const { decisionId } = await call(leader, recordDecisionContract, base);
    await call(leader, recordDecisionContract, {
      ...base,
      kind: "correction",
      correctsDecisionId: decisionId,
      summary: "Trials above 120 µV are excluded.",
    });
    const { decisionId: replacement } = await call(leader, recordDecisionContract, {
      ...base,
      title: "Use automatic artefact rejection",
      supersedesDecisionId: decisionId,
    });
    const entries = (await adminDb.collection("decisions").get()).docs.map((document) => ({
      id: document.id,
      ...decisionDocSchema.parse(document.data()),
    }));
    expect(entries).toHaveLength(3);
    // The first entry is as it was written.
    expect(entries.find((entry) => entry.id === decisionId)?.summary).toBe("Trials above 100 µV are excluded.");
    const states = decisionStates(entries);
    expect(states.find((state) => state.id === decisionId)).toMatchObject({
      status: "superseded",
      current: { summary: "Trials above 120 µV are excluded." },
      supersededBy: [replacement],
    });
    expect(await auditOf("decision.recorded")).toHaveLength(3);

    // A correction of another scope, a correction of a correction and a decision of another replication are refused.
    expect(await codeOf(call(leader, recordDecisionContract, { ...base, scopeId: OTHER_STUDY }))).toBe(
      "permission-denied",
    );
    const correction = entries.find((entry) => entry.kind === "correction")?.id ?? "";
    expect(
      await codeOf(
        call(leader, recordDecisionContract, { ...base, kind: "correction", correctsDecisionId: correction }),
      ),
    ).toBe("invalid-argument");
    expect(await codeOf(call(leader, recordDecisionContract, { ...base, kind: "correction" }))).toBe(
      "invalid-argument",
    );
  });

  it("links a decision to a deviation of its replication, and to no other", async () => {
    const leader = await lead();
    await adminDb.doc(COLLECTIONS.participationDeviations.docPath(PARTICIPATION, "dev-1")).set({
      ...standard(),
      participationId: PARTICIPATION,
      description: "A block ran in the wrong order.",
      severity: "minor",
      occurredAt: Timestamp.now(),
      reportedBy: "uid-sci-coordinator",
      status: "open",
      ...unitScopeKeysOf(),
    });
    const base = {
      scopeType: "replication" as const,
      scopeId: STUDY,
      kind: "decision" as const,
      correctsDecisionId: null,
      supersedesDecisionId: null,
      title: "Keep the sessions with the block order swapped",
      summary: "The order does not affect the effect of interest.",
      rationale: null,
      outcome: null,
      status: "accepted" as const,
      ownerPersonId: null,
      decidedAt: null,
    };
    const { decisionId } = await call(leader, recordDecisionContract, {
      ...base,
      deviations: [{ participationId: PARTICIPATION, deviationId: "dev-1" }],
    });
    expect(decisionDocSchema.parse(await dataOf(`decisions/${decisionId}`)).deviations).toHaveLength(1);
    expect(
      await codeOf(
        call(leader, recordDecisionContract, {
          ...base,
          deviations: [{ participationId: PARTICIPATION, deviationId: "missing" }],
        }),
      ),
    ).toBe("invalid-argument");
  });
});

function unitScopeKeysOf() {
  return { replicationId: STUDY, laboratoryId: LAB, scopeKeys: unitScopeKeys(STUDY, LAB) };
}

describe("the incident registry", () => {
  it("reports an incident and appends corrective actions, changes of status and corrections", async () => {
    const coordinating = await coordinator();
    await person("person-owner");
    const { incidentId } = await call(coordinating, reportIncidentContract, {
      scopeType: "laboratory",
      scopeId: LAB,
      title: "Amplifier failure",
      description: "The amplifier stopped during a session.",
      severity: "medium",
      occurredAt: "2026-03-02",
      participationId: PARTICIPATION,
      datasetId: DATASET,
      deviations: [],
    });
    const incident = incidentDocSchema.parse(await dataOf(`incidents/${incidentId}`));
    // An incident of a participation belongs to its replication and its laboratory.
    expect(incident).toMatchObject({ reportedBy: coordinating.uid, scopeKeys: unitScopeKeys(STUDY, LAB) });
    const action = (input: Omit<Parameters<typeof baseAction>[0], "incidentId">) =>
      call(coordinating, recordIncidentActionContract, baseAction({ ...input, incidentId }));
    const { actionId: first } = await action({
      kind: "correctiveAction",
      text: "Replace the cable.",
      ownerPersonId: "person-owner",
      dueDate: "2026-03-09",
    });
    await action({ kind: "statusChange", status: "investigating" });
    await action({ kind: "correction", correctsActionId: first, text: "Replace the amplifier." });
    await action({ kind: "correction", correctedReport: { severity: "high" } });
    await action({ kind: "statusChange", status: "resolved" });
    const actions = (await adminDb.collection(`incidents/${incidentId}/actions`).get()).docs.map((document) => ({
      id: document.id,
      ...incidentActionDocSchema.parse(document.data()),
    }));
    const state = incidentState(incident, actions);
    expect(state).toMatchObject({ status: "resolved", severity: "high" });
    expect(state.correctiveActions.map((item) => item.text)).toEqual(["Replace the amplifier."]);
    // The report itself is as it was written.
    expect(incidentDocSchema.parse(await dataOf(`incidents/${incidentId}`)).severity).toBe("medium");
    expect(await auditOf("incident.actionRecorded", incidentId)).toHaveLength(5);

    // An action that states nothing, an owner on a note and an outsider are refused.
    expect(await codeOf(action({ kind: "note" }))).toBe("invalid-argument");
    expect(await codeOf(action({ kind: "note", text: "x", ownerPersonId: "person-owner" }))).toBe("invalid-argument");
    expect(
      await codeOf(
        call(await member(), recordIncidentActionContract, baseAction({ incidentId, kind: "note", text: "x" })),
      ),
    ).toBe("permission-denied");
  });

  it("refuses a dataset or a participation outside the scope, and a date in the future", async () => {
    const coordinating = await coordinator();
    const report = {
      scopeType: "laboratory" as const,
      scopeId: LAB,
      title: "Synthetic incident",
      description: "A synthetic description.",
      severity: "low" as const,
      occurredAt: "2026-03-02",
      participationId: null,
      datasetId: null,
      deviations: [],
    };
    await dataset("SciStudy2002-main", OTHER_STUDY, null);
    expect(
      await codeOf(call(coordinating, reportIncidentContract, { ...report, datasetId: "SciStudy2002-main" })),
    ).toBe("invalid-argument");
    expect(await codeOf(call(coordinating, reportIncidentContract, { ...report, occurredAt: "2999-01-01" }))).toBe(
      "invalid-argument",
    );
    expect(await codeOf(call(coordinating, reportIncidentContract, { ...report, scopeId: OTHER_LAB }))).toBe(
      "permission-denied",
    );
  });
});

function baseAction(input: {
  incidentId: string;
  kind: "correctiveAction" | "statusChange" | "correction" | "note";
  text?: string;
  status?: "open" | "investigating" | "resolved";
  ownerPersonId?: string;
  dueDate?: string;
  correctsActionId?: string;
  correctedReport?: { severity?: "low" | "medium" | "high" };
}) {
  return {
    incidentId: input.incidentId,
    kind: input.kind,
    text: input.text ?? null,
    status: input.status ?? null,
    ownerPersonId: input.ownerPersonId ?? null,
    dueDate: input.dueDate ?? null,
    correctsActionId: input.correctsActionId ?? null,
    correctedReport: input.correctedReport ?? null,
  };
}

async function manuscriptOf(leader: Caller, kind: "stage1Rr" | "stage2Rr" | "article" = "stage1Rr") {
  const { manuscriptId } = await call(leader, saveManuscriptContract, {
    manuscriptId: null,
    replicationId: STUDY,
    title: "A synthetic Registered Report",
    kind,
    journal: null,
    doi: null,
    preprintDoi: null,
    osfUrl: null,
    authorsShort: null,
    stage1ManuscriptId: null,
    hypothesisIds: ["h01"],
    datasetIds: [],
    repositoryUrl: null,
    outputVersion: null,
  });
  return manuscriptId;
}

describe("authorship lists", () => {
  it("are prepared by a lead and confirmed by each person, entry by entry, before they are final", async () => {
    const leader = await lead();
    const manuscriptId = await manuscriptOf(leader);
    await person("person-ada", [], { displayName: "Ada Sample" });
    await person("person-ben", [], { displayName: "Ben Mock" });
    const ada = await account("uid-ada", { personId: "person-ada" });
    await grantRole("uid-ada", "lab_member", "laboratory", OTHER_LAB);
    const ben = await account("uid-ben", { personId: "person-ben" });
    await grantRole("uid-ben", "lab_member", "laboratory", OTHER_LAB);
    const entry = (personId: string, displayName: string) => ({
      personId,
      contributorId: null,
      kind: "author" as const,
      displayName,
      affiliations: ["Institute of Invented Studies"],
      orcid: null,
      creditRoles: ["investigation" as const],
      contributionRoles: ["dataCollection" as const],
      isCorresponding: false,
    });
    const list = {
      manuscriptId,
      orderingRule: "contribution" as const,
      orderingNote: null,
      status: "inReview" as const,
      expectedRevision: 0,
      entries: [entry("person-ada", "Ada Sample"), entry("person-ben", "Ben Mock")],
    };
    expect(await codeOf(call(ada, saveAuthorshipListContract, list))).toBe("permission-denied");
    expect((await call(leader, saveAuthorshipListContract, list)).revision).toBe(1);
    // A save that has not seen the latest revision is refused.
    expect(await codeOf(call(leader, saveAuthorshipListContract, list))).toBe("failed-precondition");

    // Each person sees their own entry and nothing about the others.
    const mine = await call(ada, listMyAuthorshipEntriesContract, {});
    expect(mine.entries).toHaveLength(1);
    expect(mine.entries[0]).toMatchObject({
      displayName: "Ada Sample",
      position: 1,
      confirmation: { status: "pending" },
    });
    expect(JSON.stringify(mine)).not.toContain("Ben Mock");

    // A list is final only once everyone has confirmed.
    expect(
      await codeOf(call(leader, saveAuthorshipListContract, { ...list, expectedRevision: 1, status: "final" })),
    ).toBe("failed-precondition");
    await call(ada, respondToAuthorshipEntryContract, {
      manuscriptId,
      response: "confirmed",
      entryRevision: 1,
      note: null,
    });
    await call(ben, respondToAuthorshipEntryContract, {
      manuscriptId,
      response: "changesRequested",
      entryRevision: 1,
      note: "My affiliation is the Example University.",
    });
    expect(await auditOf("authorship.answered", manuscriptId)).toHaveLength(2);

    // The lead changes Ben's entry: his answer no longer holds, Ada's still does.
    await call(leader, saveAuthorshipListContract, {
      ...list,
      expectedRevision: 1,
      entries: [
        entry("person-ada", "Ada Sample"),
        { ...entry("person-ben", "Ben Mock"), affiliations: ["Example University"] },
      ],
    });
    const stored = async (personId: string) =>
      authorshipEntryDocSchema.parse(await dataOf(`authorshipLists/${manuscriptId}/entries/${personId}`));
    expect((await stored("person-ada")).confirmation).toMatchObject({ status: "confirmed", revision: 1 });
    expect(await stored("person-ben")).toMatchObject({ entryRevision: 2, confirmation: { status: "pending" } });
    // An answer to the revision Ben saw before is refused.
    expect(
      await codeOf(
        call(ben, respondToAuthorshipEntryContract, {
          manuscriptId,
          response: "confirmed",
          entryRevision: 1,
          note: null,
        }),
      ),
    ).toBe("failed-precondition");
    await call(ben, respondToAuthorshipEntryContract, {
      manuscriptId,
      response: "confirmed",
      entryRevision: 2,
      note: null,
    });
    await call(leader, saveAuthorshipListContract, {
      ...list,
      expectedRevision: 2,
      status: "final",
      entries: [
        entry("person-ada", "Ada Sample"),
        { ...entry("person-ben", "Ben Mock"), affiliations: ["Example University"] },
      ],
    });
    expect(authorshipListDocSchema.parse(await dataOf(`authorshipLists/${manuscriptId}`))).toMatchObject({
      status: "final",
      revision: 3,
    });
    // Nobody answers for another person: Ada has no entry to answer as Ben.
    expect(
      await codeOf(
        call(await member("uid-nobody"), respondToAuthorshipEntryContract, {
          manuscriptId,
          response: "confirmed",
          entryRevision: 1,
          note: null,
        }),
      ),
    ).toBe("not-found");
  });
});

describe("the order of an authorship list", () => {
  it("is stored as the rule places people, the replication's leads first, and a new rule asks those it moves again", async () => {
    const leader = await lead();
    const manuscriptId = await manuscriptOf(leader);
    await adminDb.doc(COLLECTIONS.replications.docPath(STUDY)).update({ leadPersonIds: ["person-sam"] });
    for (const [personId, displayName] of [
      ["person-zoe", "Zoe Abbot"],
      ["person-sam", "Sam Young"],
      ["person-eli", "Eli Madeup"],
    ] as const) {
      await person(personId, [], { displayName });
    }
    const entry = (personId: string, displayName: string) => ({
      personId,
      contributorId: null,
      kind: "author" as const,
      displayName,
      affiliations: [],
      orcid: null,
      creditRoles: [],
      contributionRoles: [],
      isCorresponding: false,
    });
    const list = {
      manuscriptId,
      orderingRule: "leadsFirstThenAlphabetical" as const,
      orderingNote: null,
      status: "inReview" as const,
      expectedRevision: 0,
      entries: [entry("person-zoe", "Zoe Abbot"), entry("person-eli", "Eli Madeup"), entry("person-sam", "Sam Young")],
    };
    await call(leader, saveAuthorshipListContract, list);
    const positions = async () =>
      Object.fromEntries(
        (await adminDb.collection(COLLECTIONS.authorshipEntries.collectionPath(manuscriptId)).get()).docs.map(
          (snapshot) => {
            const stored = authorshipEntryDocSchema.parse(snapshot.data());
            return [stored.personId, [stored.position, stored.entryRevision]];
          },
        ),
      );
    // The lead first, then by surname: Abbot before Madeup.
    expect(await positions()).toEqual({ "person-sam": [1, 1], "person-zoe": [2, 1], "person-eli": [3, 1] });

    // By contribution the order is the one the leads gave: everyone moves and is asked again.
    await call(leader, saveAuthorshipListContract, { ...list, orderingRule: "contribution", expectedRevision: 1 });
    expect(await positions()).toEqual({ "person-zoe": [1, 2], "person-eli": [2, 2], "person-sam": [3, 2] });
    expect((await auditOf("authorship.saved", manuscriptId)).flatMap((event) => event.changes)).toContainEqual({
      field: "orderingRule",
      before: "leadsFirstThenAlphabetical",
      after: "contribution",
    });
  });
});

describe("outputs", () => {
  it("track a Stage 1 report to its acceptance, complete its milestone, and link its Stage 2 report", async () => {
    const leader = await lead();
    const stage1 = await manuscriptOf(leader);
    expect(manuscriptDocSchema.parse(await dataOf(`manuscripts/${stage1}`))).toMatchObject({
      status: "planned",
      hypothesisIds: ["h01"],
    });
    const { listId } = await call(leader, createTaskListContract, {
      name: "Synthetic plan",
      kind: "project",
      scopeType: "replication",
      scopeId: STUDY,
    });
    const { taskId } = await call(leader, planManuscriptMilestoneContract, {
      manuscriptId: stage1,
      milestone: "acceptance",
      listId,
      dueDate: "2026-09-01",
    });
    expect(taskDocSchema.parse(await dataOf(`tasks/${taskId}`))).toMatchObject({
      kind: "milestone",
      links: [{ entityType: "manuscript", entityId: stage1 }],
      completedAt: null,
    });
    const event = {
      manuscriptId: stage1,
      round: null,
      dueAt: null,
      outcome: null,
      summary: null,
      documentLinkIds: [],
      status: null,
    };
    await call(leader, recordManuscriptEventContract, {
      ...event,
      kind: "submission",
      occurredAt: "2026-05-01",
      status: "submitted",
    });
    await call(leader, recordManuscriptEventContract, {
      ...event,
      kind: "reviewRound",
      round: 1,
      occurredAt: "2026-06-01",
      dueAt: "2026-07-01",
      status: "underReview",
    });
    const accepted = await call(leader, recordManuscriptEventContract, {
      ...event,
      kind: "decision",
      outcome: "inPrincipleAcceptance",
      occurredAt: "2026-08-01",
      status: "inPrincipleAcceptance",
    });
    expect(accepted.status).toBe("inPrincipleAcceptance");
    const manuscript = manuscriptDocSchema.parse(await dataOf(`manuscripts/${stage1}`));
    expect(manuscript.submittedAt?.toDate().toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(manuscript.acceptedAt?.toDate().toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(taskDocSchema.parse(await dataOf(`tasks/${taskId}`))).toMatchObject({ statusKey: "done" });
    const history = await adminDb.collection("statusHistory").where("entityId", "==", stage1).get();
    expect(history.size).toBe(3);

    // A decision without an outcome, and a status the event cannot reach, are refused.
    expect(
      await codeOf(
        call(leader, recordManuscriptEventContract, { ...event, kind: "decision", occurredAt: "2026-08-02" }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(leader, recordManuscriptEventContract, {
          ...event,
          kind: "submission",
          occurredAt: "2026-08-02",
          status: "published",
        }),
      ),
    ).toBe("invalid-argument");

    // The Stage 2 report names its Stage 1 report of the same replication.
    const { manuscriptId: stage2 } = await call(leader, saveManuscriptContract, {
      manuscriptId: null,
      replicationId: STUDY,
      title: "The synthetic Stage 2 report",
      kind: "stage2Rr",
      journal: null,
      doi: null,
      preprintDoi: null,
      osfUrl: null,
      authorsShort: null,
      stage1ManuscriptId: stage1,
      hypothesisIds: [],
      datasetIds: [DATASET],
      repositoryUrl: null,
      outputVersion: null,
    });
    expect(manuscriptDocSchema.parse(await dataOf(`manuscripts/${stage2}`))).toMatchObject({
      stage1ManuscriptId: stage1,
      datasetIds: [DATASET],
    });
    expect(await auditOf("manuscript.eventRecorded", stage1)).toHaveLength(3);
  });

  it("refuse outsiders and references to another replication", async () => {
    const leader = await lead();
    const outsider = await member();
    const draft = {
      manuscriptId: null,
      replicationId: STUDY,
      title: "A synthetic article",
      kind: "article" as const,
      journal: null,
      doi: null,
      preprintDoi: null,
      osfUrl: null,
      authorsShort: null,
      stage1ManuscriptId: null,
      hypothesisIds: [],
      datasetIds: [],
      repositoryUrl: null,
      outputVersion: null,
    };
    expect(await codeOf(call(outsider, saveManuscriptContract, draft))).toBe("permission-denied");
    await dataset("SciStudy2002-main", OTHER_STUDY, null);
    expect(await codeOf(call(leader, saveManuscriptContract, { ...draft, datasetIds: ["SciStudy2002-main"] }))).toBe(
      "invalid-argument",
    );
    expect(await codeOf(call(leader, saveManuscriptContract, { ...draft, stage1ManuscriptId: "x" }))).toBe(
      "invalid-argument",
    );
  });
});

describe("OSF links", () => {
  async function osfLink(leader: Caller, url: string): Promise<string> {
    const reference = adminDb.collection("documentLinks").doc();
    await reference.set({
      ...standard(),
      entityType: "replication",
      entityId: STUDY,
      kind: "osf",
      url,
      accessStatus: "unknown",
      lastCheckedAt: null,
      restricted: false,
      replicationId: STUDY,
      laboratoryId: null,
      scopeKeys: [`rep:${STUDY}`, "members"],
    });
    expect(leader.uid).toBeTruthy();
    return reference.id;
  }

  it("are checked against OSF: public, not public, gone, slowed down and down", async () => {
    const leader = await lead();
    const fake = emulatorOsfFake();
    const registration = await osfLink(leader, `https://osf.io/${FAKE_OSF.stage1Registration}/`);
    const checked = await call(leader, checkOsfLinkContract, { linkId: registration });
    expect(checked).toMatchObject({ accessStatus: "public", kind: "registration", withdrawn: false });
    expect(await dataOf(`documentLinks/${registration}`)).toMatchObject({
      accessStatus: "public",
      externalId: FAKE_OSF.stage1Registration,
      title: "Synthetic Stage 1 registration of a replication",
    });
    expect(await auditOf("documentLink.osfChecked", registration)).toHaveLength(1);

    const restricted = await osfLink(leader, `https://osf.io/${FAKE_OSF.privateProject}/`);
    expect((await call(leader, checkOsfLinkContract, { linkId: restricted })).accessStatus).toBe("restricted");
    const gone = await osfLink(leader, "https://osf.io/zzzzz/");
    expect((await call(leader, checkOsfLinkContract, { linkId: gone })).accessStatus).toBe("unreachable");

    // A rate limit that lifts after one refusal is waited out once.
    fake.limitRate(1, 1);
    expect((await call(leader, checkOsfLinkContract, { linkId: registration })).accessStatus).toBe("public");
    // A rate limit that stays, and an outage, leave the link as it was known.
    fake.limitRate(5, 1);
    expect(await codeOf(call(leader, checkOsfLinkContract, { linkId: registration }))).toBe("resource-exhausted");
    fake.limitRate(0);
    fake.setMode("down");
    expect(await codeOf(call(leader, checkOsfLinkContract, { linkId: registration }))).toBe("resource-exhausted");
    expect((await dataOf(`documentLinks/${registration}`))?.accessStatus).toBe("public");
    // Lost access is recorded once OSF answers again.
    fake.setMode("up");
    fake.setPublic(FAKE_OSF.stage1Registration, false);
    expect((await call(leader, checkOsfLinkContract, { linkId: registration })).accessStatus).toBe("restricted");

    expect(await codeOf(call(await member(), checkOsfLinkContract, { linkId: registration }))).toBe(
      "permission-denied",
    );
    const notOsf = await osfLink(leader, "https://example.org/not-osf");
    expect(await codeOf(call(leader, checkOsfLinkContract, { linkId: notOsf }))).toBe("invalid-argument");
  });

  it("keep the withdrawal of a registration, which stays public on OSF, until a check finds it standing", async () => {
    const leader = await lead();
    const withdrawn = await osfLink(leader, `https://osf.io/${FAKE_OSF.withdrawnRegistration}/`);
    const checked = await call(leader, checkOsfLinkContract, { linkId: withdrawn });
    expect(checked).toMatchObject({ accessStatus: "public", withdrawn: true });
    const stored = documentLinkDocSchema.parse(await dataOf(`documentLinks/${withdrawn}`));
    expect(stored.withdrawnAt).toBeDefined();
    expect((await auditOf("documentLink.osfChecked", withdrawn))[0]?.changes.map((change) => change.field)).toContain(
      "withdrawnAt",
    );
    // A second check keeps the first date of the withdrawal.
    await call(leader, checkOsfLinkContract, { linkId: withdrawn });
    const again = documentLinkDocSchema.parse(await dataOf(`documentLinks/${withdrawn}`));
    expect(again.withdrawnAt?.toMillis()).toBe(stored.withdrawnAt?.toMillis());
  });
});
