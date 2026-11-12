// What a generated document of a replication may list: the meeting pages and the task lists
// whose audience is the replication's own. The pages, lists and replication are synthetic.
import type { PageDoc, TaskListDoc } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { meetingsInAudience, replicationListIds } from "./documents";

const at = Timestamp.fromDate(new Date("2026-11-02T10:00:00Z"));

function page(fields: Partial<PageDoc>): PageDoc {
  return {
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: "system:test",
    updatedBy: "system:test",
    archivedAt: null,
    writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
    parentPageId: null,
    ancestorPageIds: [],
    kind: "meeting",
    title: "Synthetic meeting",
    order: "m",
    isTemplate: false,
    accessMode: "inherit",
    replicationId: "DemoBeta2005",
    laboratoryId: null,
    scopeKeys: ["rep:DemoBeta2005", "members"],
    levelKeys: { comment: [], edit: [], full: [] },
    contentHead: null,
    mentionUids: [],
    tagIds: [],
    lastEditedBy: null,
    ...fields,
  };
}

function list(fields: Partial<TaskListDoc>): TaskListDoc {
  return {
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: "system:test",
    updatedBy: "system:test",
    archivedAt: null,
    writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
    name: "Synthetic list",
    kind: "project",
    ownerUid: null,
    scopeType: "replication",
    scopeId: "DemoBeta2005",
    replicationId: "DemoBeta2005",
    laboratoryId: null,
    scopeKeys: ["rep:DemoBeta2005"],
    ...fields,
  };
}

describe("a generated document of a replication", () => {
  it("lists only the meetings that keep the replication's own audience", () => {
    const meetings = meetingsInAudience("DemoBeta2005", [
      { id: "open", page: page({ title: "Synthetic open meeting" }) },
      { id: "team", page: page({ title: "Synthetic team meeting", scopeKeys: ["rep:DemoBeta2005"] }) },
      {
        id: "closed",
        page: page({ title: "Synthetic closed meeting", accessMode: "restricted", scopeKeys: ["user:uid-someone"] }),
      },
      { id: "elsewhere", page: page({ title: "Synthetic other meeting", scopeKeys: ["rep:DemoAlpha2001"] }) },
      { id: "notes", page: page({ title: "Synthetic notes", kind: "report" }) },
      { id: "old", page: page({ title: "Synthetic archived meeting", archivedAt: at }) },
    ]);
    expect(meetings.map((meeting) => meeting.title)).toEqual(["Synthetic open meeting", "Synthetic team meeting"]);
    expect(meetings[0]).toEqual({ title: "Synthetic open meeting", date: "2026-11-02", url: "#/pages/open" });
  });

  it("lists the milestones of the replication's own task lists alone", () => {
    const ids = replicationListIds("DemoBeta2005", [
      { id: "own", list: list({}) },
      { id: "personal", list: list({ ownerUid: "uid-someone", scopeType: "user", scopeId: "uid-someone" }) },
      { id: "laboratory", list: list({ scopeType: "laboratory", scopeId: "DemoBeta2005" }) },
      { id: "archived", list: list({ archivedAt: at }) },
    ]);
    expect([...ids]).toEqual(["own"]);
  });
});
