// Integration tests of the importer of Quire (source I) against the Firestore emulator. The dump
// is synthetic and written to the documented record shapes of the Quire interface: every name,
// address, title and identifier in it is invented, and every address is on example.org.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { dependencyCycles, identityKeyId, personEvidenceKey, TASK_STATUSES, taskDocSchema } from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CHILD_TASK,
  COMMENTED_TASK,
  DEPENDENCY_LOOP_TASKS,
  DEPENDENT_TASK,
  MILESTONE_TASK,
  OWN_PARENT_TASK,
  PARENT_LOOP_TASKS,
  QUIRE_USERS,
  quireDump,
  quirePoisonedDump,
  RECURRING_TASK,
  ROOT_TASK,
} from "../../tools/src/import/fixtures/quire";
import { rollbackBatch } from "../../tools/src/import/rollback";
import { importer as quire, quireId, quireReport } from "../../tools/src/import/sources/quire";
import { adminDb } from "../support/admin";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  itemCounts,
  OBSERVED_ON,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
} from "./import-support";

const ALEX = "person-synthetic-alex";
const BLAIR = "person-synthetic-blair";

function dumpFile(dump: unknown = quireDump()): string {
  const file = path.join(temporaryDirectory(), "quire-dump.json");
  writeFileSync(file, JSON.stringify(dump));
  return file;
}

/** Two persons of the portal whom the dump's users name by address: one with an account, one without. */
async function people(): Promise<void> {
  const standard = {
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "system:test",
    updatedBy: "system:test",
    archivedAt: null,
    writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
  };
  for (const [personId, userId, address] of [
    [ALEX, "uid-alex", QUIRE_USERS[0]?.email],
    [BLAIR, null, QUIRE_USERS[1]?.email],
  ] as const) {
    await adminDb.doc(`persons/${personId}`).set({
      ...standard,
      slug: personId,
      displayName: `Synthetic ${personId}`,
      laboratoryIds: [],
      replicationIds: [],
      isCoreTeam: false,
      publicListing: "none",
      coreRoles: [],
      userId,
      claimedAt: null,
      custom: {},
      dataOrigin: "demo",
    });
    const key = identityKeyId("person", "email", personEvidenceKey.email(address ?? ""), TEST_HASH_KEY);
    await adminDb.doc(`identityKeys/${key}`).set({
      ...standard,
      entityType: "person",
      keyKind: "email",
      entityIds: [personId],
      status: "active",
      mergedIntoId: null,
    });
  }
}

const task = async (oid: string) =>
  taskDocSchema.parse((await adminDb.doc(`tasks/${quireId("task", oid)}`).get()).data());

beforeEach(async () => {
  await freshDatabase();
  await people();
});
afterAll(removeTemporaryDirectories);

describe("the Quire importer", () => {
  it("previews the dump as raw records only, one for each user, project, task and comment", async () => {
    const report = await run(quire, dumpFile(), "preview");
    expect(report.blocking).toEqual([]);
    expect(Object.fromEntries(report.tabs.map((tab) => [tab.tabKey, tab.rows.data]))).toEqual({
      users: 4,
      projects: 2,
      tasks: 20,
      comments: 2,
    });
    expect((await documentsOf("tasks")).size).toBe(0);
  });

  it("migrates projects, nested tasks, assignees, dates, statuses, tags and comments, each with its source", async () => {
    const report = await run(quire, dumpFile(), "apply");
    expect(report.status).toBe("applied");
    expect(report.collections.taskLists).toMatchObject({ created: 2 });
    expect(report.collections.tasks).toMatchObject({ created: 20 });
    expect(await schemaProblems()).toEqual([]);

    const list = (await adminDb.doc(`taskLists/${quireId("project", "PrjSyntheticPilot000001")}`).get()).data();
    expect(list).toMatchObject({
      name: "Synthetic replication pilot",
      kind: "project",
      scopeType: "programme",
      scopeKeys: ["members", "programme"],
      source: { system: "quire", id: "PrjSyntheticPilot000001", url: "https://quire.io/w/synthetic_project" },
    });

    const root = await task(ROOT_TASK);
    expect(root).toMatchObject({
      title: "Plan the synthetic pilot",
      description: "Agree the *schedule* with the laboratory.",
      statusKey: "inProgress",
      priority: "high",
      estimateMinutes: 120,
      // Alex has an account; Blair has none and is held for the claim; Casey matches nobody.
      assigneeUids: ["uid-alex"],
      followerUids: [],
      unclaimedParticipants: [{ personId: BLAIR, role: "follower" }],
      source: { system: "quire", id: ROOT_TASK },
    });
    expect(root.source?.url).toMatch(/^https:\/\/quire\.io\/w\/synthetic_project\/\d+$/);
    expect(root.startAt?.toDate().toISOString()).toBe("2027-01-04T12:00:00.000Z");
    expect(root.dueAt?.toDate().toISOString()).toBe("2027-01-29T12:00:00.000Z");
    expect(root.tagIds).toHaveLength(1);
    expect((await adminDb.doc(`tags/${root.tagIds[0]}`).get()).data()).toMatchObject({
      name: "Pilot",
      nameFolded: "pilot",
    });

    const child = await task(CHILD_TASK);
    expect(child).toMatchObject({
      parentId: quireId("task", ROOT_TASK),
      ancestorIds: [quireId("task", ROOT_TASK)],
      statusKey: "done",
      priority: "low",
      unclaimedParticipants: [{ personId: BLAIR, role: "assignee" }],
    });
    expect(child.completedAt?.toDate().toISOString()).toBe("2027-01-06T15:30:00.000Z");
    expect(child.dueAt?.toDate().toISOString()).toBe("2027-01-06T16:00:00.000Z");

    const dependent = await task(DEPENDENT_TASK);
    expect(dependent).toMatchObject({
      priority: "urgent",
      dependsOn: { [quireId("task", CHILD_TASK)]: "finishToStart" },
    });
    const milestone = await task(MILESTONE_TASK);
    expect(milestone).toMatchObject({ kind: "milestone", statusKey: "done" });
    expect(milestone.dependsOn).toEqual({ [quireId("task", DEPENDENT_TASK)]: "finishToStart" });
    expect((await task(RECURRING_TASK)).recurrenceRule).toBe("FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20270630");
    expect((await task("TskMonthlyReport00000006")).recurrenceRule).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    expect((await task("TskYearlyReview000000007")).recurrenceRule).toBeUndefined();

    // A chain twelve deep, of which the interface showed ten ancestors at most, nests in full.
    const deepest = await task("TskChain0000000000000012");
    expect(deepest.ancestorIds).toHaveLength(11);
    expect(deepest.ancestorIds[0]).toBe(quireId("task", "TskChain0000000000000001"));

    const thread = (await adminDb.doc(`threads/${quireId("thread", COMMENTED_TASK)}`).get()).data();
    expect(thread).toMatchObject({ targetType: "task", targetId: quireId("task", COMMENTED_TASK) });
    const comments = await documentsOf("comments", true);
    expect([...comments.values()].map((comment) => comment.body).sort()).toEqual([
      "The room is booked for the **first** week.",
      "This comment held attachments only. They are listed in the missing-fields report.",
    ]);
    // The author without an account is named by the person and the name as the source wrote it.
    const first = [...comments.values()].find((comment) => comment.body.startsWith("The room"));
    expect(first?.sourceAuthor).toEqual({ personId: BLAIR, nameSource: "Blair Beta" });

    // The user whom no person matches, and the one without an address, wait in the review queue.
    expect(await itemCounts()).toMatchObject({ unmatchedIdentifier: 2 });
    // The statuses are those of the portal: nothing new is invented for Quire's names.
    expect(TASK_STATUSES.map((status) => status.key)).toEqual(expect.arrayContaining(["toDo", "inProgress", "done"]));
  });

  it("writes nothing on a second run of the same dump, and rolls back to nothing", async () => {
    const first = await run(quire, dumpFile(), "apply");
    const before = await allDocuments();
    const second = await run(quire, dumpFile(), "apply");
    expect(second.status).toBe("applied");
    expect(second.changesCommitted).toBe(0);
    expect(
      Object.values(second.collections).every((counts) => (counts?.created ?? 0) === 0 && (counts?.changed ?? 0) === 0),
    ).toBe(true);
    const changed = differences(before, await allDocuments());
    // The only writes are the records of the batch itself.
    expect(
      [...changed.created, ...changed.rewritten].filter((documentPath) => !documentPath.startsWith("importBatches/")),
    ).toEqual([]);

    await rollbackBatch(adminDb, first.batchId);
    expect((await documentsOf("tasks")).size).toBe(0);
    const again = await run(quire, dumpFile(), "apply");
    expect(again.collections.tasks).toMatchObject({ created: 20 });
  });

  it("follows a changed field of the source, and keeps an edit made in the portal", async () => {
    await run(quire, dumpFile(), "apply");
    await adminDb.doc(`tasks/${quireId("task", ROOT_TASK)}`).update({ title: "Renamed in the portal" });
    const dump = quireDump();
    const projects = dump.projects as { tasks: Record<string, unknown>[] }[];
    const changed = projects[0]?.tasks.find((entry) => entry.oid === ROOT_TASK);
    if (changed === undefined) throw new Error("The fixture lost its root task.");
    changed.name = "Plan the synthetic pilot again";
    changed.nameText = "Plan the synthetic pilot again";
    changed.priority = { value: 2, name: "Urgent" };
    const report = await run(quire, dumpFile(dump), "apply");
    expect(report.collections.tasks).toMatchObject({ created: 0, changed: 1 });
    expect(await task(ROOT_TASK)).toMatchObject({ title: "Renamed in the portal", priority: "urgent" });
  });

  it("stops with a precise report where the file is not a dump in the documented layout", async () => {
    const exported = await run(quire, dumpFile({ project: { name: "A JSON export" }, tasks: [] }), "preview");
    expect(exported.blocking.length).toBeGreaterThan(0);
    expect(JSON.stringify(exported.blocking)).toContain("(top)");
    const dump = quireDump();
    const projects = dump.projects as { tasks: Record<string, unknown>[] }[];
    delete projects[0]?.tasks[2]?.oid;
    delete projects[0]?.tasks[3]?.parent;
    const broken = await run(quire, dumpFile(dump), "preview");
    expect(broken.blocking.map((check) => check.message).join("\n")).toContain("projects[0].tasks[2].oid");
    expect(broken.blocking.map((check) => check.message).join("\n")).toContain("projects[0].tasks[3].parent");
    expect((await documentsOf("tasks")).size).toBe(0);
  });
});

describe("a dump whose tree or dependencies hold a cycle", () => {
  it("imports each task of a cycle of parents at the top, leaves out a dependency that closes a cycle, and raises each for review", async () => {
    const report = await run(quire, dumpFile(quirePoisonedDump()), "apply");
    expect(report.status).toBe("applied");
    for (const oid of [OWN_PARENT_TASK, ...PARENT_LOOP_TASKS]) {
      expect(await task(oid)).toMatchObject({ parentId: null, ancestorIds: [] });
    }
    const [dependsA, dependsB] = DEPENDENCY_LOOP_TASKS;
    const first = await task(dependsA);
    const second = await task(dependsB);
    expect(
      dependencyCycles([
        { id: quireId("task", dependsA), dependsOn: first.dependsOn },
        { id: quireId("task", dependsB), dependsOn: second.dependsOn },
      ]),
    ).toEqual([]);
    // One of the two dependencies stays.
    expect(Object.keys(first.dependsOn).length + Object.keys(second.dependsOn).length).toBe(1);
    const raised = [...(await documentsOf("reconciliationItems")).values()].filter(
      (item) => item.kind === "unparsedValue",
    );
    expect(raised.filter((item) => item.field === "parent")).toHaveLength(3);
    expect(raised.filter((item) => item.field === "predecessorRefs")).toHaveLength(1);

    const missing = quireReport({ path: dumpFile(quirePoisonedDump()), observedOn: OBSERVED_ON });
    if (missing === null) throw new Error("The report was not written.");
    const lossy = (missing.data as { lossyConversions: { kind: string; count: number }[] }).lossyConversions;
    expect(lossy).toEqual(
      expect.arrayContaining([
        {
          kind: "a task named as its own parent, imported at the top and raised for review",
          count: 1,
          example: OWN_PARENT_TASK,
        },
        expect.objectContaining({
          kind: "a task in a cycle of parents, imported at the top and raised for review",
          count: 2,
        }),
        expect.objectContaining({
          kind: "a dependency that would close a cycle, left out and raised for review",
          count: 1,
        }),
      ]),
    );
  });
});

describe("the missing-fields report", () => {
  it("names what cannot be recovered and what the dump holds that has no place, by keys and identifiers alone", () => {
    const file = dumpFile();
    const report = quireReport({ path: file, observedOn: OBSERVED_ON });
    if (report === null) throw new Error("The report was not written.");
    const data = report.data as {
      unrecoverable: string[];
      unmappedKeys: { record: string; key: string; count: number }[];
      unresolvedReferences: { kind: string; count: number }[];
      truncation: { kind: string; at: string }[];
      attachments: { storage: string }[];
      lossyConversions: { kind: string; count: number }[];
      counts: { tasks: number; taskCountOnProject: number | null; tasksDiffer: boolean }[];
      absentEverywhere: string[];
    };
    expect(data.unrecoverable[0]).toMatch(/^The activity history/);
    expect(data.unmappedKeys.map((entry) => `${entry.record} ${entry.key}`)).toEqual(
      expect.arrayContaining(["task synthUndocumentedKey", "task yourField (custom fields)"]),
    );
    expect(data.unresolvedReferences.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        "a dependency target outside the import",
        "an application among the followers",
        "a user with no address",
      ]),
    );
    expect(data.truncation.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["a parent chain cut at its tenth ancestor", "a subtree marked as cropped"]),
    );
    expect(new Set(data.attachments.map((entry) => entry.storage))).toEqual(
      new Set(["Google Drive", "Quire storage", "OneDrive", "Dropbox", "Box"]),
    );
    expect(data.lossyConversions.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        "a recurrence with no equivalent: a yearly rule",
        "a comment that holds attachments only, imported with a note in place of text",
        "a section, imported as a task",
      ]),
    );
    expect(data.counts[0]).toMatchObject({ tasks: 20, taskCountOnProject: 20, tasksDiffer: false });
    expect(data.absentEverywhere).toEqual(expect.arrayContaining(["approval", "reshowAt"]));
    // No name, address or title reaches the report.
    for (const forbidden of ["Alex Alpha", "example.org", "Plan the synthetic pilot", "Room 4"]) {
      expect(JSON.stringify(report)).not.toContain(forbidden);
    }
    expect(report.summary).toContain("Known unrecoverable items");
  });

  it("is not written for a file of another layout", () => {
    expect(quireReport({ path: dumpFile({ tasks: [] }), observedOn: OBSERVED_ON })).toBeNull();
  });
});
