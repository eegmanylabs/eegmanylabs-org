// Integration tests of reporting, publishing and automation (phase 9): the publishing pipeline
// against the fake of the website repository, the mail outbox against the fake sender, the rule
// engine with the job queue, the demographic aggregates and the search of comments and documents.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain, and the committed public data files of this repository, which are read and
// never changed.
import {
  approvePublicationContract,
  automationRunDocSchema,
  automationRunId,
  COLLECTIONS,
  entityRefId,
  eventFailureDocSchema,
  eventFailureId,
  generatedDocumentId,
  getDemographicAggregatesContract,
  MEMBERS_SCOPE_KEY,
  mailDocSchema,
  notificationId,
  onboardingListId,
  PROGRAMME_KEY,
  preparePublicationContract,
  proposePublicationRollbackContract,
  publicationBatchDocSchema,
  publicationFileDocSchema,
  refreshPublicationContract,
  replicationScopeKey,
  runAutomationRuleContract,
  saveAutomationRuleContract,
  searchWorkspaceContract,
  statusDefinitionId,
  TASK_STATUSES,
  taskDocSchema,
  unitScopeKeys,
  withdrawPublicationContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchEvent } from "../../functions/src/automation/dispatch";
import { onLaboratoryWritten } from "../../functions/src/automation/events";
import { emulatorGitHubFake, gitHubFakeStatePath } from "../../functions/src/integrations/github/fake";
import { resetFakeState } from "../../functions/src/integrations/google/fake/store";
import { executeRun } from "../../functions/src/integrations/jobs/runner";
import { memoryMailFake } from "../../functions/src/integrations/mail/fake";
import { notifyFollowers, notifyMilestone, notifyProtocolUpdate } from "../../functions/src/notifications/followers";
import { queueDueDigests, queueNotificationMail, sendQueuedMail } from "../../functions/src/notifications/mail";
import { reportPeriod, runDueReports } from "../../functions/src/reports/scheduled";
import { indexComment, indexDocumentLink } from "../../functions/src/search/entries";
import { adminDb } from "../support/admin";
import { jobDependencies } from "./integrations-world";
import {
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  grantCapability,
  grantRole,
  laboratory,
  notificationsOf,
  person,
  refusal,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

const STUDY = "ReportStudy2001";
const LAB = "lab-report";
const SECRET = "synthetic-test-key-of-thirty-two-bytes!!";

/** Values planted in documents that must never reach the public website. */
const MARKERS = {
  email: "planted.marker@example.org",
  notes: "PRIVATE-NOTES-MARKER-4471",
  address: "PRIVATE-ADDRESS-MARKER-9930",
  gender: "privateGenderMarker",
  custom: "PRIVATE-CUSTOM-MARKER-2210",
  added: "PRIVATE-ADDED-LATER-MARKER-5512",
};

withoutTriggers();

beforeEach(async () => {
  await resetWorld();
  resetFakeState(gitHubFakeStatePath());
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
  await laboratory(LAB);
});

afterAll(() => {
  resetFakeState(gitHubFakeStatePath());
});

/** A member listed on the website, with private values planted wherever the portal keeps them. */
async function listedMemberWithPrivateValues(): Promise<void> {
  await person("report-listed", [{ email: MARKERS.email }], {
    displayName: "Synthetic Listed Member",
    affiliationSummary: "Synthetic Institute of Reporting",
    countrySource: "Nowhere",
    publicListing: "member",
    dataOrigin: "live",
    custom: { phone: MARKERS.custom },
    // A field that a later version of the schema might add, which the allow-list does not name.
    privateNoteAddedLater: MARKERS.added,
  });
  await adminDb
    .doc(COLLECTIONS.personNotes.docPath("report-listed"))
    .set({ ...standard(), privateNotes: MARKERS.notes });
  await adminDb
    .doc(COLLECTIONS.personAddress.docPath("report-listed"))
    .set({ ...standard(), postalAddress: MARKERS.address });
  await adminDb.doc(COLLECTIONS.personDemographics.docPath("report-listed")).set({
    ...standard(),
    genderCategory: MARKERS.gender,
    recordedAt: Timestamp.now(),
  });
}

async function batchOf(batchId: string) {
  return publicationBatchDocSchema.parse(await dataOf(COLLECTIONS.publicationBatches.docPath(batchId)));
}

/** Records the report of a staging build, as `publish:verify` does from a trusted environment. */
async function recordVerification(batchId: string, passed = true): Promise<void> {
  const batch = await batchOf(batchId);
  await adminDb.doc(COLLECTIONS.publicationBatches.docPath(batchId)).update({
    status: passed ? "verified" : "failed",
    verification: {
      checkedAt: Timestamp.now(),
      passed,
      payloadSha256: batch.payloadSha256,
      buildCommand: "syrinx -c -e staging .",
      checks: [{ key: "build", passed, detail: "Synthetic report of a build." }],
    },
  });
}

describe("publishing to the public website", () => {
  it("prepares an export from the allow-list alone, so no private value can reach a file", async () => {
    const admin = await administrator("uid-report-admin");
    await listedMemberWithPrivateValues();
    const { batchId, filesChanged } = await call(admin, preparePublicationContract, { outputs: ["members"] });
    expect(filesChanged).toBe(1);
    const batch = await batchOf(batchId);
    expect(batch).toMatchObject({ status: "previewed", syntheticData: true, outputs: ["members"] });
    expect(batch.diffSummary.members).toEqual({ added: 1, removed: 0, changed: 0 });
    const files = await adminDb.collection(COLLECTIONS.publicationFiles.collectionPath(batchId)).get();
    const text = files.docs.map((document) => publicationFileDocSchema.parse(document.data()).content).join("\n");
    expect(text).toContain("Synthetic Listed Member\tSynthetic Institute of Reporting\tNowhere");
    for (const marker of Object.values(MARKERS)) expect(text).not.toContain(marker);
    expect(text).not.toMatch(/@example\.org/);
    // The rows the website already had are unchanged: the preview shows the one added row.
    const members = publicationFileDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.publicationFiles.docPath(batchId, "members")).get()).data(),
    );
    expect(members.diff.rows).toEqual([expect.objectContaining({ key: "report-listed", kind: "added" })]);
    expect(members.content.startsWith(members.baseContent ?? "")).toBe(true);
    const [entry] = await auditOf("publication.prepared", batchId);
    expect(entry?.actorUid).toBe("uid-report-admin");
  });

  it("refuses an export in which text shaped like an email address appears, and logs it", async () => {
    const admin = await administrator("uid-report-admin");
    await person("report-leak", [], {
      displayName: "Synthetic Leak",
      affiliationSummary: "Write to someone@example.org",
      publicListing: "member",
      dataOrigin: "live",
    });
    const failure = await refusal(call(admin, preparePublicationContract, { outputs: ["members"] }));
    expect(failure.code).toBe("failed-precondition");
    const batches = await adminDb.collection(COLLECTIONS.publicationBatches.collectionPath()).get();
    expect(batches.docs.map((document) => document.get("status"))).toEqual(["failed"]);
  });

  it("lets only those who may prepare an export do so", async () => {
    const lead = await account("uid-report-lead");
    await grantRole("uid-report-lead", "replication_lead", "replication", STUDY);
    expect(await codeOf(call(lead, preparePublicationContract, { outputs: ["members"] }))).toBe("permission-denied");
  });

  it("goes from preview through the staging build and an approval with a second factor to a pull request, and never merges", async () => {
    const admin = await administrator("uid-report-admin");
    const core = await coreTeamMember("uid-report-core");
    await listedMemberWithPrivateValues();
    const { batchId } = await call(admin, preparePublicationContract, { outputs: ["members", "laboratories"] });
    const batch = await batchOf(batchId);

    // No approval before the staging build has passed.
    expect(await codeOf(call(admin, approvePublicationContract, { batchId, payloadSha256: batch.payloadSha256 }))).toBe(
      "failed-precondition",
    );
    await recordVerification(batchId);
    // The core team does not hold the sensitive capability of approval, and the approval names the files that were built.
    expect(await codeOf(call(core, approvePublicationContract, { batchId, payloadSha256: batch.payloadSha256 }))).toBe(
      "permission-denied",
    );
    expect(await codeOf(call(admin, approvePublicationContract, { batchId, payloadSha256: "0".repeat(64) }))).toBe(
      "failed-precondition",
    );
    const withoutFactor: Caller = { ...admin, secondFactor: false };
    expect(
      await codeOf(call(withoutFactor, approvePublicationContract, { batchId, payloadSha256: batch.payloadSha256 })),
    ).toBe("failed-precondition");

    const { pullRequestNumber, pullRequestUrl } = await call(admin, approvePublicationContract, {
      batchId,
      payloadSha256: batch.payloadSha256,
    });
    const fake = emulatorGitHubFake();
    const pull = fake.pulls().find((candidate) => candidate.number === pullRequestNumber);
    expect(pull).toMatchObject({ state: "open", baseBranch: "main", url: pullRequestUrl });
    const branchFiles = fake.filesOf(pull?.headBranch ?? "");
    expect(branchFiles["data/members.tsv"]).toContain("report-listed\tSynthetic Listed Member");
    expect(branchFiles["assets/data/laboratories.tsv"]).toContain("LaboratoryId\tName");
    for (const marker of Object.values(MARKERS)) expect(JSON.stringify(branchFiles)).not.toContain(marker);
    expect(fake.pullBody(pullRequestNumber)).toContain("synthetic demonstration data");
    expect(fake.operations().some((operation) => operation.startsWith("merge"))).toBe(false);
    expect(await batchOf(batchId)).toMatchObject({
      status: "staged",
      approvedBy: "uid-report-admin",
      pullRequestNumber,
    });
    const [approval] = await auditOf("publication.approved", batchId);
    expect(approval?.actorUid).toBe("uid-report-admin");

    // A maintainer merges; the portal learns of it by reading the pull request.
    fake.merge(pullRequestNumber);
    expect(await call(admin, refreshPublicationContract, { batchId })).toEqual({ status: "published" });
    expect(fake.filesOf("main")["data/members.tsv"]).toContain("report-listed");

    // The rollback is a proposal: a pull request that restores what the export replaced.
    const rollback = await call(admin, proposePublicationRollbackContract, {
      batchId,
      reason: "A synthetic rollback.",
    });
    const restored = fake.filesOf(
      fake.pulls().find((candidate) => candidate.number === rollback.pullRequestNumber)?.headBranch ?? "",
    );
    expect(restored["data/members.tsv"]).not.toContain("report-listed");
    expect(restored["assets/data/laboratories.tsv"]).toBeUndefined();
    fake.merge(rollback.pullRequestNumber);
    expect(await call(admin, refreshPublicationContract, { batchId })).toEqual({ status: "rolledBack" });
  });

  it("keeps one publishing pull request open at a time and refuses a preview the website has moved past", async () => {
    const admin = await administrator("uid-report-admin");
    await listedMemberWithPrivateValues();
    const first = await call(admin, preparePublicationContract, { outputs: ["members"] });
    const second = await call(admin, preparePublicationContract, { outputs: ["members"] });
    await recordVerification(first.batchId);
    await recordVerification(second.batchId);
    await call(admin, approvePublicationContract, {
      batchId: first.batchId,
      payloadSha256: (await batchOf(first.batchId)).payloadSha256,
    });
    const blocked = await refusal(
      call(admin, approvePublicationContract, {
        batchId: second.batchId,
        payloadSha256: (await batchOf(second.batchId)).payloadSha256,
      }),
    );
    expect(blocked.message).toContain("Only one publishing pull request is open at a time");

    // The first is withdrawn, which closes its pull request; a maintainer then changes the website.
    await call(admin, withdrawPublicationContract, { batchId: first.batchId, reason: "A synthetic withdrawal." });
    const fake = emulatorGitHubFake();
    expect(fake.pulls().every((pull) => pull.state !== "open")).toBe(true);
    fake.pushToMain({ "data/people.tsv": "PersonId\tFullName\n" });
    const stale = await refusal(
      call(admin, approvePublicationContract, {
        batchId: second.batchId,
        payloadSha256: (await batchOf(second.batchId)).payloadSha256,
      }),
    );
    expect(stale.message).toContain("The website changed after this export was prepared");
  });

  it("states a lost credential plainly, publishes nothing and alerts whoever manages the integrations", async () => {
    const admin = await administrator("uid-report-admin");
    emulatorGitHubFake().setAccessLost(true);
    const failure = await refusal(call(admin, preparePublicationContract, { outputs: ["members"] }));
    expect(failure.message).toContain("GitHub refused the portal's credential");
    const alerts = (await notificationsOf("uid-report-admin")).filter((entry) => entry.type === "integrationFailure");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.payload).toMatchObject({ kind: "integrationFailed", system: "github" });
  });
});

describe("the mail outbox and digests", () => {
  async function notifiedMember(preferences: Record<string, unknown>) {
    await account("uid-mail", { email: "mail.member@example.org" });
    await adminDb.doc(COLLECTIONS.userPreferences.docPath("uid-mail")).set({ ...standard(), ...preferences });
    const id = notificationId("assignment", "event-mail-1");
    await adminDb.doc(COLLECTIONS.userNotifications.docPath("uid-mail", id)).set({
      ...standard(),
      uid: "uid-mail",
      type: "assignment",
      entityType: "task",
      entityId: "task-mail",
      eventId: "event-mail-1",
      payload: { kind: "taskAssigned", title: "A synthetic task" },
      readAt: null,
      emailedAt: null,
    });
    return id;
  }

  const emailOn = {
    channels: { inApp: true, email: true },
    digestFrequency: "off",
    quietHours: null,
    typeSwitches: {},
  };

  it("queues one message for a notification, sends it through the sender and marks the notification as emailed", async () => {
    const id = await notifiedMember(emailOn);
    const input = { uid: "uid-mail", notificationId: id, portalUrl: "https://portal.example.org/", secret: SECRET };
    const mailId = await queueNotificationMail(adminDb, input, new Date());
    expect(await queueNotificationMail(adminDb, input, new Date())).toBe(mailId);
    expect((await adminDb.collection(COLLECTIONS.mail.collectionPath()).get()).size).toBe(1);
    const fake = memoryMailFake();
    expect(await sendQueuedMail(adminDb, fake.sender(), mailId ?? "", new Date())).toBe("sent");
    expect(fake.sent()).toEqual([expect.objectContaining({ to: "mail.member@example.org" })]);
    expect(fake.sent()[0]?.textBody).toContain("Work was assigned to you: A synthetic task");
    expect(await dataOf(COLLECTIONS.userNotifications.docPath("uid-mail", id))).toMatchObject({
      emailedAt: expect.any(Timestamp),
    });
  });

  it("sends nothing to a member who chose no email or switched the type off", async () => {
    const id = await notifiedMember({ ...emailOn, typeSwitches: { assignment: false } });
    const input = { uid: "uid-mail", notificationId: id, portalUrl: "https://portal.example.org/", secret: SECRET };
    expect(await queueNotificationMail(adminDb, input, new Date())).toBeNull();
  });

  it("holds a message to the end of the quiet hours, retries an outage and fails a rejected address once", async () => {
    const id = await notifiedMember({
      ...emailOn,
      quietHours: { start: "22:00", end: "07:00", timeZone: "Europe/London" },
    });
    const night = new Date("2026-11-12T23:30:00Z");
    const mailId =
      (await queueNotificationMail(
        adminDb,
        { uid: "uid-mail", notificationId: id, portalUrl: "https://portal.example.org/", secret: SECRET },
        night,
      )) ?? "";
    const fake = memoryMailFake();
    expect(await sendQueuedMail(adminDb, fake.sender(), mailId, night)).toBe("notDue");
    fake.setMode("down");
    const morning = new Date("2026-11-13T07:05:00Z");
    expect(await sendQueuedMail(adminDb, fake.sender(), mailId, morning, () => 0)).toBe("queued");
    fake.setMode("up");
    fake.reject("mail.member@example.org");
    expect(await sendQueuedMail(adminDb, fake.sender(), mailId, new Date("2026-11-13T09:00:00Z"))).toBe("failed");
    expect(mailDocSchema.parse(await dataOf(COLLECTIONS.mail.docPath(mailId)))).toMatchObject({
      status: "failed",
      attempts: 2,
    });
  });

  it("queues one weekly digest of the unread notifications on Monday morning", async () => {
    await notifiedMember({ ...emailOn, digestFrequency: "weekly" });
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
    monday.setUTCHours(9, 0, 0, 0);
    // The notification was written now, and the digest of the next Monday looks back seven days.
    const notification = await adminDb.collection(COLLECTIONS.userNotifications.collectionPath("uid-mail")).get();
    await notification.docs[0]?.ref.update({ createdAt: Timestamp.fromMillis(monday.getTime() - 86_400_000) });
    expect(await queueDueDigests(adminDb, monday, "https://portal.example.org/", SECRET)).toBe(1);
    expect(await queueDueDigests(adminDb, monday, "https://portal.example.org/", SECRET)).toBe(0);
    const [message] = (await adminDb.collection(COLLECTIONS.mail.collectionPath()).get()).docs.map((document) =>
      mailDocSchema.parse(document.data()),
    );
    expect(message?.templateKey).toBe("digestWeekly");
    expect(message?.textBody).toContain("A synthetic task");
  });
});

describe("automations", () => {
  it("create the onboarding checklist once when a laboratory becomes active, logged and retried through the queue", async () => {
    await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", LAB);
    const at = new Date();
    const after = { status: "active", writeContext: { origin: "user", depth: 0 } };
    expect(await onLaboratoryWritten(adminDb, LAB, { status: "unverified" }, after, at)).toBe(1);
    // A second delivery of the same event starts nothing.
    expect(await onLaboratoryWritten(adminDb, LAB, { status: "unverified" }, after, at)).toBe(0);
    const runId = automationRunId("onboardingOnActivation", `laboratory.activated:${LAB}`);
    const queued = automationRunDocSchema.parse(await dataOf(COLLECTIONS.automationRuns.docPath(runId)));
    expect(queued).toMatchObject({ status: "queued", chain: ["onboardingOnActivation"], depth: 0 });
    expect(await executeRun(queued.syncRunId ?? "", jobDependencies(null))).toBe("succeeded");
    const run = automationRunDocSchema.parse(await dataOf(COLLECTIONS.automationRuns.docPath(runId)));
    expect(run.status).toBe("succeeded");
    expect(run.log.join("\n")).toContain("createOnboardingChecklist: Created the onboarding checklist");
    const tasks = await adminDb
      .collection(COLLECTIONS.tasks.collectionPath())
      .where("listId", "==", onboardingListId(LAB))
      .get();
    expect(tasks.size).toBe(9);
    const task = taskDocSchema.parse(tasks.docs[0]?.data());
    expect(task.assigneeUids).toEqual(["uid-coordinator"]);
    expect(task.writeContext).toMatchObject({ origin: "automation", depth: 1, causationId: runId });
    const [entry] = await auditOf("automation.acted", LAB);
    expect(entry).toMatchObject({ actorKind: "automation", actorUid: null });
  });

  it("act on nothing at the depth limit and never twice in one chain", async () => {
    const deep = { status: "active", writeContext: { origin: "system", depth: 3 } };
    expect(await onLaboratoryWritten(adminDb, LAB, { status: "unverified" }, deep, new Date())).toBe(0);
    const skipped = automationRunDocSchema.parse(
      await dataOf(
        COLLECTIONS.automationRuns.docPath(automationRunId("onboardingOnActivation", `laboratory.activated:${LAB}`)),
      ),
    );
    expect(skipped.status).toBe("skipped");
    expect(skipped.log.join(" ")).toContain("3 steps deep");

    const looped = await dispatchEvent(
      adminDb,
      {
        id: "event-looped",
        event: "laboratory.activated",
        facts: { laboratoryId: "lab-other" },
        depth: 1,
        chain: ["onboardingOnActivation"],
      },
      { entityType: "laboratory", entityId: "lab-other" },
      new Date(),
    );
    expect(looped.queued).toEqual([]);
    const loop = automationRunDocSchema.parse(
      await dataOf(COLLECTIONS.automationRuns.docPath(automationRunId("onboardingOnActivation", "event-looped"))),
    );
    expect(loop.log.join(" ")).toContain("already acted earlier in this chain");
  });

  it("are configured by administrators alone, and a built-in rule keeps its actions", async () => {
    const admin = await administrator("uid-report-admin");
    const lead = await account("uid-report-lead");
    await grantRole("uid-report-lead", "replication_lead", "replication", STUDY);
    const rule = {
      name: "Report on Monday",
      enabled: true,
      event: "manual" as const,
      conditions: [],
      actions: [{ kind: "generateProgressReport" as const, templateKey: "missing-template" }],
      scopeType: "programme" as const,
      scopeId: PROGRAMME_KEY,
    };
    expect(await codeOf(call(lead, saveAutomationRuleContract, rule))).toBe("permission-denied");
    expect(
      await codeOf(call(admin, saveAutomationRuleContract, { ...rule, actions: [{ kind: "createQcTask" as const }] })),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(admin, saveAutomationRuleContract, {
          ...rule,
          ruleId: "qcTaskOnArrival",
          event: "dataset.dataArrived" as const,
          actions: [{ kind: "notifyLeads" as const }],
        }),
      ),
    ).toBe("invalid-argument");
    const { ruleId } = await call(admin, saveAutomationRuleContract, rule);
    const [saved] = await auditOf("automationRule.saved", ruleId);
    expect(saved?.actorUid).toBe("uid-report-admin");

    // A run whose action can never succeed fails at once, records the failed event and alerts.
    const { runId, status } = await call(admin, runAutomationRuleContract, { ruleId });
    expect(status).toBe("queued");
    const queued = automationRunDocSchema.parse(await dataOf(COLLECTIONS.automationRuns.docPath(runId)));
    expect(await executeRun(queued.syncRunId ?? "", jobDependencies(null))).toBe("failed");
    const failed = automationRunDocSchema.parse(await dataOf(COLLECTIONS.automationRuns.docPath(runId)));
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("not registered");
    const failure = eventFailureDocSchema.parse(
      await dataOf(COLLECTIONS.eventFailures.docPath(eventFailureId("automation", queued.eventId))),
    );
    expect(failure.consumer).toBe("automation");
  });
});

describe("demographic aggregates", () => {
  async function peopleOfStudy(categories: readonly string[]): Promise<void> {
    for (const [index, category] of categories.entries()) {
      const id = `report-person-${index}`;
      await person(id, [], { replicationIds: [STUDY] });
      await adminDb.doc(COLLECTIONS.personDemographics.docPath(id)).set({
        ...standard(),
        genderCategory: category,
        recordedAt: Timestamp.now(),
      });
    }
  }

  it("serve counts only with a named grant, suppress small cells and audit the read without a value", async () => {
    const admin = await administrator("uid-report-admin");
    await peopleOfStudy([
      ...Array(6).fill("woman"),
      ...Array(7).fill("man"),
      ...Array(6).fill("nonBinary"),
      "selfDescribed",
      "selfDescribed",
    ]);
    const input = { field: "genderCategory" as const, scopeType: "replication" as const, scopeId: STUDY };
    expect(await codeOf(call(admin, getDemographicAggregatesContract, input))).toBe("permission-denied");
    await grantCapability("uid-report-admin", "demographics.read");
    const served = await call(admin, getDemographicAggregatesContract, input);
    expect(served).toEqual({
      threshold: 5,
      // A group of two is suppressed, and the next smallest with it; both are folded into one
      // unnamed cell, and neither the people nor the total are stated.
      people: null,
      cells: [
        { category: "man", count: 7 },
        { category: "woman", count: 6 },
        { category: "Other or suppressed", count: null },
      ],
      total: null,
    });
    const [entry] = await auditOf("demographics.aggregateRead", STUDY);
    expect(entry?.changes).toEqual([{ field: "genderCategory", withheld: true }]);
    expect(JSON.stringify(entry)).not.toContain("woman");
  });
});

describe("search of comments and documents", () => {
  it("finds a comment and a linked document by their audience and narrows by kind", async () => {
    const member = await account("uid-search-member");
    await grantRole("uid-search-member", "lab_member", "laboratory", LAB);
    const outsider = await account("uid-search-outsider");
    await grantRole("uid-search-outsider", "lab_member", "laboratory", "lab-elsewhere");
    const scope = { replicationId: STUDY, laboratoryId: LAB, scopeKeys: unitScopeKeys(STUDY, LAB) };
    const threadId = "threadSearchSynthetic01";
    await adminDb.doc(COLLECTIONS.threads.docPath(threadId)).set({
      ...standard(),
      targetType: "replication",
      targetId: STUDY,
      restricted: false,
      ...scope,
      resolvedAt: null,
      resolvedBy: null,
    });
    await adminDb.doc(COLLECTIONS.threadComments.docPath(threadId, "commentSynthetic0001")).set({
      ...standard(),
      threadId,
      authorUid: "uid-search-member",
      body: "The amplifier calibration drifted overnight",
      mentionUids: [],
      editedAt: null,
      deletedAt: null,
      ...scope,
    });
    await adminDb.doc(COLLECTIONS.documentLinks.docPath("linkSearchSynthetic01")).set({
      ...standard(),
      entityType: "replication",
      entityId: STUDY,
      kind: "googleDoc",
      url: "https://docs.example.org/calibration",
      title: "Calibration protocol",
      accessStatus: "unknown",
      lastCheckedAt: null,
      restricted: false,
      replicationId: STUDY,
      laboratoryId: null,
      scopeKeys: [replicationScopeKey(STUDY), MEMBERS_SCOPE_KEY],
    });
    const stamp = { at: new Date(), actor: "system:test", writeContext: standard().writeContext };
    expect(await indexComment(adminDb, threadId, "commentSynthetic0001", stamp)).toBe(1);
    expect(await indexDocumentLink(adminDb, "linkSearchSynthetic01", stamp)).toBe(1);

    const found = await call(member, searchWorkspaceContract, { query: "calibration" });
    expect(found.results.map((result) => result.kind).sort()).toEqual(["comment", "document"]);
    expect(found.results.find((result) => result.kind === "comment")).toMatchObject({
      targetEntityType: "replication",
      targetEntityId: STUDY,
    });
    const comments = await call(member, searchWorkspaceContract, { query: "calibration", kinds: ["comment"] });
    expect(comments.results.map((result) => result.kind)).toEqual(["comment"]);
    // A member of another laboratory reads the document, which members read, and not the comment.
    const outside = await call(outsider, searchWorkspaceContract, { query: "calibration" });
    expect(outside.results.map((result) => result.kind)).toEqual(["document"]);

    // A deleted comment leaves the index.
    await adminDb
      .doc(COLLECTIONS.threadComments.docPath(threadId, "commentSynthetic0001"))
      .update({ deletedAt: Timestamp.now() });
    expect(await indexComment(adminDb, threadId, "commentSynthetic0001", stamp)).toBe(0);
  });
});

describe("notifications that follow records", () => {
  it("tell those who follow a record of a change they did not make, while they still read it", async () => {
    await account("uid-follower");
    await grantRole("uid-follower", "lab_member", "laboratory", LAB);
    await account("uid-former");
    await grantRole("uid-former", "lab_member", "laboratory", "lab-elsewhere");
    await account("uid-changer");
    await grantRole("uid-changer", "lab_member", "laboratory", LAB);
    for (const uid of ["uid-follower", "uid-former", "uid-changer"]) {
      await adminDb.doc(COLLECTIONS.userSubscriptions.docPath(uid, entityRefId("laboratory", LAB))).set({
        ...standard(),
        uid,
        entityType: "laboratory",
        entityId: LAB,
        level: "all",
      });
    }
    const { updatedAt: _updatedAt, updatedBy: _updatedBy, archivedAt: _archivedAt, ...base } = standard();
    await adminDb.doc(COLLECTIONS.activity.docPath("activitySynthetic0001")).set({
      ...base,
      actorUid: "uid-changer",
      action: "laboratory.updated",
      entityType: "laboratory",
      entityId: LAB,
      title: "Synthetic laboratory",
      changedFields: ["name"],
      replicationId: null,
      laboratoryId: LAB,
      scopeKeys: unitScopeKeys(null, LAB),
    });
    expect(await notifyFollowers(adminDb, "activitySynthetic0001", new Date())).toBe(1);
    // A second delivery of the same entry writes nothing new.
    expect(await notifyFollowers(adminDb, "activitySynthetic0001", new Date())).toBe(1);
    expect((await notificationsOf("uid-follower")).map((notification) => notification.payload)).toEqual([
      expect.objectContaining({ kind: "followedRecordChanged", entityId: LAB }),
    ]);
    expect(await notificationsOf("uid-former")).toEqual([]);
    expect(await notificationsOf("uid-changer")).toEqual([]);
  });

  it("tell the team and the coordinators of a replication of a protocol update, and its team of a milestone", async () => {
    await account("uid-lead");
    await grantRole("uid-lead", "replication_lead", "replication", STUDY);
    await account("uid-lab-coordinator");
    await grantRole("uid-lab-coordinator", "lab_coordinator", "laboratory", LAB);
    await account("uid-bystander");
    await adminDb.doc(COLLECTIONS.participations.docPath(`${STUDY}__${LAB}`)).set({
      ...standard(),
      replicationId: STUDY,
      laboratoryId: LAB,
    });
    // A second lead approves the version, and is not told of their own approval.
    await account("uid-approving-lead");
    await grantRole("uid-approving-lead", "replication_lead", "replication", STUDY);
    const update = {
      replicationId: STUDY,
      versionId: "versionSynthetic01",
      versionLabel: "1.1",
      protocolTitle: "Synthetic core protocol",
      approvedBy: "uid-approving-lead",
    };
    expect(await notifyProtocolUpdate(adminDb, update, new Date())).toBe(2);
    expect(await notifyProtocolUpdate(adminDb, update, new Date())).toBe(2);
    for (const uid of ["uid-lead", "uid-lab-coordinator"]) {
      expect((await notificationsOf(uid)).map((notification) => notification.type)).toEqual(["protocolUpdate"]);
      expect((await notificationsOf(uid))[0]?.payload).toMatchObject({ title: "Synthetic core protocol 1.1" });
    }
    expect(await notificationsOf("uid-approving-lead")).toEqual([]);
    const milestone = {
      manuscriptId: "manuscriptSynthetic01",
      replicationId: STUDY,
      status: "accepted" as const,
      title: "A synthetic manuscript",
    };
    // The team of the replication: both of its leads.
    expect(await notifyMilestone(adminDb, milestone, new Date())).toBe(2);
    expect((await notificationsOf("uid-lead")).map((notification) => notification.type).sort()).toEqual([
      "milestone",
      "protocolUpdate",
    ]);
    expect(await notificationsOf("uid-bystander")).toEqual([]);
  });
});

describe("scheduled reports", () => {
  it("run once in their period through the queue of generated documents and tell their recipients", async () => {
    await account("uid-report-reader");
    await grantRole("uid-report-reader", "lab_member", "laboratory", LAB);
    // Suspended after the report was saved: the sweep no longer tells this account.
    await account("uid-report-suspended-later");
    await grantRole("uid-report-suspended-later", "lab_member", "laboratory", LAB);
    await account("uid-report-suspended-later", { status: "suspended" });
    const now = Timestamp.now();
    await adminDb.doc(COLLECTIONS.documentTemplates.docPath("report-progress")).set({
      ...standard(now),
      key: "report-progress",
      name: "Synthetic progress report",
      kind: "replicationProgress",
      entityType: "replication",
      managedSections: [],
      enabled: true,
      mode: "dryRun",
      approvedBy: null,
      approvedAt: null,
    });
    await adminDb.doc(COLLECTIONS.scheduledReports.docPath("reportSynthetic01")).set({
      ...standard(now),
      name: "Weekly synthetic report",
      definition: { templateKey: "report-progress", entityType: "replication", entityId: STUDY },
      schedule: "weekly",
      recipients: ["uid-report-reader", "uid-report-suspended-later"],
      lastRunAt: null,
      lastPeriod: null,
      enabled: true,
    });
    const tuesday = new Date("2026-11-17T09:00:00Z");
    const monday = new Date("2026-11-16T09:00:00Z");
    expect(reportPeriod("weekly", tuesday)).toBeNull();
    expect(reportPeriod("weekly", monday)).toBe("2026-W47");
    expect(reportPeriod("monthly", new Date("2026-12-01T09:00:00Z"))).toBe("2026-12");
    expect(await runDueReports(adminDb, tuesday)).toBe(0);
    expect(await runDueReports(adminDb, monday)).toBe(1);
    expect(await runDueReports(adminDb, monday)).toBe(0);
    expect(
      (
        await adminDb
          .doc(COLLECTIONS.generatedDocuments.docPath(generatedDocumentId("report-progress", "replication", STUDY)))
          .get()
      ).exists,
    ).toBe(true);
    expect(await dataOf(COLLECTIONS.scheduledReports.docPath("reportSynthetic01"))).toMatchObject({
      lastPeriod: "2026-W47",
    });
    expect((await notificationsOf("uid-report-reader")).map((notification) => notification.payload)).toEqual([
      expect.objectContaining({ kind: "scheduledReportQueued", title: "Weekly synthetic report" }),
    ]);
    expect(await notificationsOf("uid-report-suspended-later")).toEqual([]);
    // The sweep acts as the system, and the document and its job say so.
    expect(
      await dataOf(
        COLLECTIONS.generatedDocuments.docPath(generatedDocumentId("report-progress", "replication", STUDY)),
      ),
    ).toMatchObject({ writeContext: { origin: "system" } });
  });
});
