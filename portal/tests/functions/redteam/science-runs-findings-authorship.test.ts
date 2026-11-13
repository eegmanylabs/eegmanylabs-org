// Red-team attacks on the scientific workflows of phase 8 (docs/DATA_MODEL.md, sections 5, 10
// and 11), made through the functions emulator by people who hold a capability in one unit and
// try to act on the records of another, or on what someone else has signed:
//
// - a coordinator of one laboratory rewrites an analysis run that belongs to the replication as
//   a whole, or to another laboratory, by naming its own laboratory in the save;
// - a member of the programme staff replaces the original statistics of a hypothesis that
//   another person reviewed, and the review stays attached to text it never covered;
// - a lead reorders a final authorship list by changing its ordering rule, so that people who
//   confirmed one position stand in another without being asked again.
//
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people, studies and laboratories on example.org.
import {
  authorshipEntryDocSchema,
  authorshipListDocSchema,
  COLLECTIONS,
  orderEntries,
  participationId,
  processingRunDocSchema,
  recordHypothesisFindingContract,
  replicationHypothesisDocSchema,
  respondToAuthorshipEntryContract,
  saveAnalysisRunContract,
  saveAuthorshipListContract,
  saveManuscriptContract,
  unitScopeKeys,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../../support/admin";
import {
  account,
  administrator,
  type Caller,
  call,
  codeOf,
  dataOf,
  dataset,
  grantRole,
  laboratory,
  person,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "../support";

const STUDY = "RedTeamScience2001";
const LAB_A = "lab-redteam-science-a";
const LAB_B = "lab-redteam-science-b";
const DATASET_A = "RedTeamScience2001-lab-a-main";
const DATASET_B = "RedTeamScience2001-lab-b-main";

withoutTriggers();

beforeEach(async () => {
  await resetWorld();
  await replication(STUDY);
  await laboratory(LAB_A);
  await laboratory(LAB_B);
  for (const laboratoryId of [LAB_A, LAB_B]) {
    await adminDb.doc(COLLECTIONS.participations.docPath(participationId(STUDY, laboratoryId))).set({
      ...standard(),
      replicationId: STUDY,
      laboratoryId,
      scopeKeys: unitScopeKeys(STUDY, laboratoryId),
      status: "collecting",
      statusHistoryId: null,
      readinessStatus: "approved",
      custom: {},
      dataOrigin: "demo",
    });
  }
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
  await dataset(DATASET_A, STUDY, LAB_A);
  await dataset(DATASET_B, STUDY, LAB_B);
});

async function leadOfStudy(uid = "uid-redteam-science-lead"): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "replication_lead", "replication", STUDY);
  return caller;
}

async function coordinatorOf(laboratoryId: string, uid: string): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "lab_coordinator", "laboratory", laboratoryId);
  return caller;
}

const runInput = {
  runId: null,
  replicationId: STUDY,
  laboratoryId: null,
  kind: "analysis" as const,
  title: "Confirmatory analysis of the replication",
  pipelineName: "synthetic-erp-pipeline",
  version: "1.4.0",
  codeUrl: "https://example.org/code/synthetic-erp-pipeline",
  codeCommit: "0123abcd",
  parameters: { highPassHz: 0.1 },
  environment: { python: "3.12" },
  status: "succeeded" as const,
  startedAt: "2026-04-01T10:00:00Z",
  finishedAt: "2026-04-01T11:00:00Z",
  inputs: [
    { datasetId: DATASET_A, storageRefId: null },
    { datasetId: DATASET_B, storageRefId: null },
  ],
  outputs: [{ label: "Main effect", kind: "statistics" as const }],
  hypothesisIds: ["h01"],
  qcStatus: "passed" as const,
  qcNotes: null,
  reproducibilityStatus: "notAttempted" as const,
  reproducesRunId: null,
  reproducibilityNotes: null,
};

/** What a coordinator of laboratory A sends to take over a run: its own laboratory and its own data. */
const takeover = (runId: string) => ({
  ...runInput,
  runId,
  laboratoryId: LAB_A,
  title: "Rewritten by another laboratory",
  inputs: [{ datasetId: DATASET_A, storageRefId: null }],
  outputs: [{ label: "A different effect", kind: "statistics" as const }],
  qcStatus: "failed" as const,
  qcNotes: "Marked as failed by a coordinator of one participating laboratory.",
});

describe("an analysis run of the replication as a whole", () => {
  it("is changed only by those who may manage the replication, never by a coordinator who names its own laboratory", async () => {
    const lead = await leadOfStudy();
    const coordinatorA = await coordinatorOf(LAB_A, "uid-redteam-science-coordinator-a");
    const { runId } = await call(lead, saveAnalysisRunContract, runInput);
    // The run is not the coordinator's: saving it without a laboratory is refused, as it should be.
    expect(await codeOf(call(coordinatorA, saveAnalysisRunContract, { ...runInput, runId }))).toBe("permission-denied");
    // Naming its own laboratory must not turn the lead's run into a run the coordinator may rewrite.
    const code = await codeOf(call(coordinatorA, saveAnalysisRunContract, takeover(runId)));
    expect(["permission-denied", "not-found", "failed-precondition", "invalid-argument"]).toContain(code);
    const stored = processingRunDocSchema.parse(await dataOf(COLLECTIONS.processingRuns.docPath(runId)));
    expect(stored.laboratoryId).toBeNull();
    expect(stored.qcStatus).toBe("passed");
    expect(stored.inputDatasetIds).toEqual([DATASET_A, DATASET_B]);
  });

  it("of another laboratory is not rewritten by a coordinator of a laboratory of the same replication", async () => {
    const coordinatorA = await coordinatorOf(LAB_A, "uid-redteam-science-coordinator-a");
    const coordinatorB = await coordinatorOf(LAB_B, "uid-redteam-science-coordinator-b");
    const { runId } = await call(coordinatorB, saveAnalysisRunContract, {
      ...runInput,
      laboratoryId: LAB_B,
      title: "Preprocessing of laboratory B",
      kind: "preprocessing",
      inputs: [{ datasetId: DATASET_B, storageRefId: null }],
    });
    const code = await codeOf(call(coordinatorA, saveAnalysisRunContract, takeover(runId)));
    expect(["permission-denied", "not-found", "failed-precondition", "invalid-argument"]).toContain(code);
    const stored = processingRunDocSchema.parse(await dataOf(COLLECTIONS.processingRuns.docPath(runId)));
    expect(stored.laboratoryId).toBe(LAB_B);
    expect(stored.scopeKeys).toEqual(unitScopeKeys(STUDY, LAB_B));
  });
});

describe("the original statistics of a reviewed hypothesis", () => {
  it("cannot change under a review that someone else signed: the review is cleared or signed anew by the caller", async () => {
    const reviewedAt = Timestamp.fromDate(new Date("2026-03-01T09:00:00Z"));
    await adminDb.doc(COLLECTIONS.replicationHypotheses.docPath(STUDY, "h01")).update({
      originalStatistics: "t(23) = 2.5, p = .02",
      originalStatisticsProvenance: {
        source: "originalArticle",
        locator: "Table 2",
        recordedBy: "uid-redteam-first-recorder",
        recordedAt: reviewedAt,
      },
      scientificReviewStatus: "verified",
      resultReviewedBy: "uid-redteam-first-reviewer",
      resultReviewedAt: reviewedAt,
    });
    const staff = await administrator("uid-redteam-science-admin");
    await call(staff, recordHypothesisFindingContract, {
      replicationId: STUDY,
      hypothesisId: "h01",
      finding: "originalStatistics",
      text: "t(23) = 4.9, p < .001",
      provenance: {
        source: "authorCorrespondence",
        locator: "Synthetic letter",
        url: null,
        analysisRunId: null,
        manuscriptId: null,
      },
      analysisStatus: null,
    });
    const stored = replicationHypothesisDocSchema.parse(
      await dataOf(COLLECTIONS.replicationHypotheses.docPath(STUDY, "h01")),
    );
    expect(stored.originalStatistics).toBe("t(23) = 4.9, p < .001");
    // The security rules ask the same of a client write (`reviewKept`): whoever changes reviewed
    // content clears the review or signs it in their own name at the request time.
    expect([null, staff.uid]).toContain(stored.resultReviewedBy);
    // The verification covered the statistics it replaced, so the hypothesis goes back to review.
    expect(stored.scientificReviewStatus).toBe("underReview");
  });
});

describe("a final authorship list", () => {
  it("does not reorder its confirmed authors by a change of its ordering rule without asking them again", async () => {
    const lead = await leadOfStudy();
    const { manuscriptId } = await call(lead, saveManuscriptContract, {
      manuscriptId: null,
      replicationId: STUDY,
      title: "A synthetic Registered Report",
      kind: "stage1Rr",
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
    });
    // Zed confirms that they are the first author, under an order by contribution.
    await person("person-redteam-zed", [], { displayName: "Zed Zimmer" });
    await person("person-redteam-amy", [], { displayName: "Amy Abbot" });
    const zed = await account("uid-redteam-zed", { personId: "person-redteam-zed" });
    await grantRole(zed.uid, "lab_member", "laboratory", LAB_A);
    const amy = await account("uid-redteam-amy", { personId: "person-redteam-amy" });
    await grantRole(amy.uid, "lab_member", "laboratory", LAB_B);
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
      entries: [entry("person-redteam-zed", "Zed Zimmer"), entry("person-redteam-amy", "Amy Abbot")],
    };
    await call(lead, saveAuthorshipListContract, list);
    for (const caller of [zed, amy]) {
      await call(caller, respondToAuthorshipEntryContract, {
        manuscriptId,
        response: "confirmed",
        entryRevision: 1,
        note: null,
      });
    }
    await call(lead, saveAuthorshipListContract, { ...list, expectedRevision: 1, status: "final" });

    // The lead reopens nothing and edits no entry, but makes the order alphabetical.
    const outcome = await codeOf(
      call(lead, saveAuthorshipListContract, {
        ...list,
        orderingRule: "alphabetical",
        expectedRevision: 2,
        status: "final",
      }),
    );
    const stored = authorshipListDocSchema.parse(await dataOf(COLLECTIONS.authorshipLists.docPath(manuscriptId)));
    const entries = (
      await adminDb.collection(COLLECTIONS.authorshipEntries.collectionPath(manuscriptId)).get()
    ).docs.map((snapshot) => authorshipEntryDocSchema.parse(snapshot.data()));
    const firstAuthor = orderEntries(
      entries.filter((item) => item.kind === "author"),
      stored.orderingRule,
    )[0];
    // Secure: either the save is refused, or the list is no longer final and Zed is asked again.
    const reorderedWithoutConsent = stored.status === "final" && firstAuthor?.personId !== "person-redteam-zed";
    expect({ outcome, reorderedWithoutConsent }).toMatchObject({ reorderedWithoutConsent: false });
  });
});
