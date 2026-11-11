// A synthetic dump of a Quire pull, written to the documented record shapes of the Quire REST
// interface (https://quire.io/dev/api/, read on 9 November 2026). Every name, address, title and
// identifier in it is invented, every address is on example.org, and nothing is copied from a
// real Quire workspace, which nobody has had access to. It is labelled as such in `pulledBy`.
//
// It carries the variations of docs/MIGRATION_PLAN.md, section 9: date-only and timed dates,
// statuses on both sides of the completion threshold, every priority, list fields as a list and
// as encoded text, missing optional keys, a parent chain deeper than ten with its cut-off marker,
// a cropped subtree, a follower that is an application, custom fields, an attachment of each
// storage kind, a comment that holds only attachments, an undocumented key, a recurrence of each
// kind, a milestone and a section.
import { DUMP_FORMAT, DUMP_FORMAT_VERSION } from "../quire-dump";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const user = (oid: string, name: string) => ({ oid, id: oid.toLowerCase(), name });

/** The users of the organisation: two that persons of the portal hold the address of, one unknown, one without an address. */
export const QUIRE_USERS: readonly {
  readonly oid: string;
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly locale?: string;
}[] = [
  { ...user("UsrAlexAlpha000000000001", "Alex Alpha"), email: "alex.alpha@example.org", locale: "en" },
  { ...user("UsrBlairBeta00000000002", "Blair Beta"), email: "blair.beta@example.org" },
  { ...user("UsrCaseyGamma0000000003", "Casey Gamma"), email: "casey.unknown@example.org" },
  { ...user("UsrDrewDelta00000000004", "Drew Delta") },
];

const taskUser = (index: 0 | 1 | 2 | 3) => {
  const found = QUIRE_USERS[index] as { oid: string; id: string; name: string };
  return { oid: found.oid, id: found.id, name: found.name };
};

/** An application that the interface lists among the followers of a task. */
const APPLICATION = { oid: "AppSyncBot0000000000001", id: "app:sync-bot", name: "Synthetic sync bot" };

const status = (value: number, name: string) => ({ value, name, color: "50" });

interface TaskOptions {
  readonly parent?: Json;
  readonly [key: string]: Json | undefined;
}

let taskNumber = 0;
function task(oid: string, name: string, options: TaskOptions = {}): Record<string, Json> {
  taskNumber += 1;
  const { parent = null, ...rest } = options;
  const fields: Record<string, Json> = {
    oid,
    id: taskNumber,
    name,
    nameText: name,
    url: `https://quire.io/w/synthetic_project/${taskNumber}`,
    createdAt: "2026-01-05T09:00:00.000Z",
    createdBy: taskUser(0),
    parent,
  };
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) fields[key] = value;
  return fields;
}

const parentInfo = (oid: string, id: number): Json => ({ oid, id });

/**
 * The parent of a task as `TaskWithParentInfo` gives it: the nearest ancestor, which names its own
 * parent, up to ten ancestors. Past ten, the tenth names the eleventh by its oid alone.
 */
function chainInfo(ancestors: readonly string[], ids: ReadonlyMap<string, number>, depth = 0): Json {
  const [first, ...rest] = ancestors;
  if (first === undefined) return null;
  if (depth === 10) return { parent: first };
  const info: Record<string, Json> = { oid: first, id: ids.get(first) ?? 0 };
  if (rest.length > 0) info.parent = chainInfo(rest, ids, depth + 1);
  return info;
}

/** A chain of twelve tasks, each beneath the one before, whose deepest ones meet the cut of the interface. */
function deepChain(): Record<string, Json>[] {
  const oids = Array.from({ length: 12 }, (_, index) => `TskChain${String(index + 1).padStart(16, "0")}`);
  const ids = new Map(oids.map((oid, index) => [oid, taskNumber + index + 1]));
  return oids.map((oid, index) =>
    task(oid, `Synthetic step ${index + 1} of the chain`, {
      parent: chainInfo(oids.slice(0, index).reverse(), ids),
      status: status(0, "To-Do"),
    }),
  );
}

export const ROOT_TASK = "TskPlanThePilot000000001";
export const CHILD_TASK = "TskBookTheRoom0000000002";
export const DEPENDENT_TASK = "TskRunThePilot0000000003";
export const MILESTONE_TASK = "TskPilotDone00000000004";
export const RECURRING_TASK = "TskWeeklyCheck00000000005";
export const COMMENTED_TASK = ROOT_TASK;

/** The tasks of the first project, in the order the interface returned them. */
function pilotTasks(): Record<string, Json>[] {
  return [
    task(ROOT_TASK, "Plan the synthetic pilot", {
      description: "Agree the *schedule* with the laboratory.",
      descriptionText: "Agree the schedule with the laboratory.",
      descriptionHtml: "Agree the <i>schedule</i> with the laboratory.",
      status: status(50, "Doing"),
      priority: { value: 1, name: "High" },
      start: "2027-01-04",
      due: "2027-01-29",
      etc: 7200,
      assignees: [taskUser(0), taskUser(2)],
      followers: [taskUser(1), APPLICATION],
      tags: [{ oid: "TagPilot000000000000001", name: "Pilot", color: "35" }],
      attachments: [
        { type: 1, url: "https://drive.example.org/synthetic-plan", length: 2048, name: "plan.pdf" },
        { type: 2, url: "https://quire.io/att/Ta/synthetic/schedule.xlsx", length: 4096, name: "schedule.xlsx" },
        { type: 3, url: "https://onedrive.example.org/synthetic", length: 10, name: "notes.docx" },
        { type: 4, url: "https://dropbox.example.org/synthetic", length: 20, name: "photo.png" },
        { type: 5, url: "https://box.example.org/synthetic", length: 30, name: "consent.pdf" },
      ],
      timelogs: [{ start: "2027-01-04T09:00:00.000Z", end: "2027-01-04T10:00:00.000Z", user: taskUser(0) }],
      yourField: { "Synthetic budget": 120, "Synthetic site": "Room 4" },
      synthUndocumentedKey: "an undocumented key",
      childCount: 1,
    }),
    task(CHILD_TASK, "Book the synthetic room", {
      parent: parentInfo(ROOT_TASK, 1),
      status: status(100, "Done"),
      toggledAt: "2027-01-06T15:30:00.000Z",
      priority: { value: -1, name: "Low" },
      due: "2027-01-06T16:00:00.000Z",
      assignees: [taskUser(1)],
      predecessors: '["#9"]',
    }),
    task(DEPENDENT_TASK, "Run the synthetic pilot session", {
      status: status(0, "To-Do"),
      priority: { value: 2, name: "Urgent" },
      due: "2027-02-01",
      assignees: [taskUser(3)],
      predecessorRefs: [
        { id: 2, oid: CHILD_TASK },
        { id: 99, oid: "TskOutsideTheImport00099" },
      ],
    }),
    task(MILESTONE_TASK, "Synthetic pilot complete", {
      status: status(120, "Signed off"),
      toggledAt: "2027-02-05T10:00:00.000Z",
      priority: { value: 0, name: "Medium" },
      milestone: true,
      due: "2027-02-05",
      predecessorRefs: '[{"id":3,"oid":"TskRunThePilot0000000003"}]',
    }),
    task(RECURRING_TASK, "Check the synthetic recordings", {
      status: status(0, "To-Do"),
      due: "2027-01-11",
      recurrence: { seriesId: "synthseries", freq: "weekly", interval: 1, byweekday: "[0,3]", until: "2027-06-30" },
      assignees: [taskUser(0)],
    }),
    task("TskMonthlyReport00000006", "Write the synthetic monthly report", {
      recurrence: { freq: "monthly", bydayno: 31 },
    }),
    task("TskYearlyReview000000007", "Review the synthetic year", {
      recurrence: { freq: "yearly", bymonth: 10, bydayno: 1 },
    }),
    task("TskSection00000000000008", "Synthetic section", { section: true, cropped: true }),
    ...deepChain(),
  ];
}

/** The synthetic dump: one organisation, two projects, their tasks, statuses, tags and comments. */
export function quireDump(): Record<string, Json> {
  taskNumber = 0;
  return {
    format: DUMP_FORMAT,
    formatVersion: DUMP_FORMAT_VERSION,
    pulledAt: "2026-11-09T12:00:00.000Z",
    pulledBy: "Synthetic fixture of the portal's tests. No real Quire data.",
    organizations: [{ oid: "OrgSynthetic000000000001", id: "synthetic_org", plan: { name: "Professional" } }],
    users: QUIRE_USERS as unknown as Json[],
    projects: [
      {
        project: {
          oid: "PrjSyntheticPilot000001",
          id: "synthetic_project",
          name: "Synthetic replication pilot",
          nameText: "Synthetic replication pilot",
          url: "https://quire.io/w/synthetic_project",
          taskCount: 20,
          activeCount: 18,
        },
        statuses: [status(0, "To-Do"), status(50, "Doing"), status(100, "Done"), status(120, "Signed off")],
        tags: [{ oid: "TagPilot000000000000001", name: "Pilot", color: "35", global: false }],
        tasks: pilotTasks(),
        comments: {
          [COMMENTED_TASK]: [
            {
              oid: "CmtFirst000000000000001",
              description: "The room is booked for the **first** week.",
              descriptionText: "The room is booked for the first week.",
              createdAt: "2027-01-05T10:00:00.000Z",
              createdBy: taskUser(1),
            },
            {
              oid: "CmtAttachments00000002",
              description: "",
              attachments: [
                { type: 2, url: "https://quire.io/att/Ta/synthetic/room.jpg", length: 999, name: "room.jpg" },
              ],
              createdAt: "2027-01-05T11:00:00.000Z",
              editedAt: "2027-01-05T11:05:00.000Z",
              createdBy: taskUser(2),
            },
          ],
        },
      },
      {
        project: { oid: "PrjSyntheticEmpty000002", id: "synthetic_empty", name: "Synthetic empty project" },
        statuses: [status(0, "To-Do"), status(100, "Done")],
        tags: [],
        tasks: [],
        comments: {},
      },
    ],
  };
}

export const OWN_PARENT_TASK = "TskPoisonSelfParent00001";
export const PARENT_LOOP_TASKS = ["TskPoisonParentLoopA0002", "TskPoisonParentLoopB0003"] as const;
export const DEPENDENCY_LOOP_TASKS = ["TskPoisonDependsA0000004", "TskPoisonDependsB0000005"] as const;

/**
 * The synthetic dump with five crafted tasks added to its first project: one that names itself
 * as its parent, two that name each other as their parents, and two that name each other among
 * their predecessors. Nothing in Quire's own interface makes such a tree; a dump that was edited
 * can hold one, and the importer must keep the tree and the dependencies free of cycles.
 */
export function quirePoisonedDump(): Record<string, Json> {
  const dump = quireDump();
  const projects = dump.projects as { tasks: Json[]; project: Record<string, Json> }[];
  const first = projects[0];
  if (first === undefined) throw new Error("The synthetic dump has no project.");
  const [loopA, loopB] = PARENT_LOOP_TASKS;
  const [dependsA, dependsB] = DEPENDENCY_LOOP_TASKS;
  first.tasks.push(
    task(OWN_PARENT_TASK, "Synthetic task that is its own parent", { parent: parentInfo(OWN_PARENT_TASK, 901) }),
    task(loopA, "Synthetic task in a loop of parents", { parent: parentInfo(loopB, 903) }),
    task(loopB, "Synthetic task in the same loop", { parent: parentInfo(loopA, 902) }),
    task(dependsA, "Synthetic task that waits for the next", { predecessorRefs: [{ id: 905, oid: dependsB }] }),
    task(dependsB, "Synthetic task that waits for the one before", { predecessorRefs: [{ id: 904, oid: dependsA }] }),
  );
  first.project.taskCount = first.tasks.length;
  return dump;
}
