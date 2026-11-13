// Red-team attacks on what reaches the public website and the scheduled reports (requirements
// R14.1 to R14.4 and R15.7, docs/INTEGRATIONS.md, section 6), made through the functions emulator
// against the fake of the website repository.
//
// - The lead of a replication writes the date of acceptance of an output that is still planned,
//   which the security rules let a lead write directly, and the next export announces a Stage 1
//   acceptance on the public website that no editor ever made.
// - A holder of `automations.manage` schedules a report about a record that does not exist and
//   names as recipients accounts that are suspended or are no members at all.
//
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, studies and outputs on the example.org domain.
import {
  COLLECTIONS,
  preparePublicationContract,
  publicationFileDocSchema,
  saveScheduledReportContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { gitHubFakeStatePath } from "../../../functions/src/integrations/github/fake";
import { resetFakeState } from "../../../functions/src/integrations/google/fake/store";
import { adminDb } from "../../support/admin";
import {
  account,
  administrator,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "../support";

const STUDY = "RedTeamPublish2001";

withoutTriggers();

beforeEach(async () => {
  await resetWorld();
  resetFakeState(gitHubFakeStatePath());
  await replication(STUDY);
});

afterAll(() => {
  resetFakeState(gitHubFakeStatePath());
});

describe("the public milestones file", () => {
  it("announces no Stage 1 acceptance for an output whose status is still planned", async () => {
    // What the rules let a lead write: `acceptedAt` is among the fields a lead edits directly,
    // while the status moves only through `recordManuscriptEvent`.
    await adminDb.doc(COLLECTIONS.manuscripts.docPath("redteamPlannedStage1aa")).set({
      ...standard(),
      replicationId: STUDY,
      title: "A synthetic Stage 1 report that no journal has accepted",
      kind: "stage1Rr",
      status: "planned",
      statusHistoryId: null,
      acceptedAt: Timestamp.fromDate(new Date("2026-01-15T00:00:00Z")),
      custom: {},
      scopeKeys: [`rep:${STUDY}`],
      dataOrigin: "demo",
    });
    const admin = await administrator("uid-redteam-publish-admin");
    const { batchId } = await call(admin, preparePublicationContract, { outputs: ["milestones"] });
    const file = publicationFileDocSchema.parse(
      await dataOf(COLLECTIONS.publicationFiles.docPath(batchId, "milestones")),
    );
    expect(file.content).not.toContain(`${STUDY}\tstage1Accepted`);
  });
});

describe("a scheduled report", () => {
  it("names a record that exists and recipients who are members in good standing", async () => {
    await adminDb.doc(COLLECTIONS.documentTemplates.docPath("redteam-progress")).set({
      ...standard(),
      key: "redteam-progress",
      name: "Synthetic replication progress",
      kind: "replicationProgress",
      entityType: "replication",
      managedSections: [],
      enabled: true,
      mode: "dryRun",
      approvedBy: null,
      approvedAt: null,
    });
    const configurer = await coreTeamMember("uid-redteam-publish-core");
    const suspended = await account("uid-redteam-publish-suspended", { status: "suspended" });
    const report = {
      name: "Weekly synthetic report",
      templateKey: "redteam-progress",
      entityType: "replication" as const,
      schedule: "weekly" as const,
      enabled: true,
    };
    expect(
      await codeOf(
        call(configurer, saveScheduledReportContract, {
          ...report,
          entityId: "NoSuchStudy2099",
          recipients: [configurer.uid],
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(configurer, saveScheduledReportContract, {
          ...report,
          entityId: STUDY,
          recipients: [suspended.uid, "uid-redteam-publish-nobody"],
        }),
      ),
    ).toBe("invalid-argument");
  });
});
