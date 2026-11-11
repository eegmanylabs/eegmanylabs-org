// The rules of tasks (docs/DATA_MODEL.md, section 8), beside the registry-driven matrix: who
// reads a task list and a task, that a participant reads a task whatever its list, that lists
// and tasks take every write from trusted code, how a tag keeps its identifier tied to its
// folded name, how a reminder stays its owner's and stops changing once sent, and who reads the
// feed of progress updates. Each refusal stands beside the honest request that is accepted.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { MEMBERS_SCOPE_KEY, PROGRAMME_SCOPE_KEY, replicationScopeKey, tagId, userScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, limit, serverTimestamp, setDoc, Timestamp, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { EVERYONE, forEach } from "./redteam/exfiltration-and-escalation-support";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import { autoId, MEMBER_UID, OWN_REPLICATION, OWNER_UID, stored, uidOfCaller } from "./world";

let environment: RulesTestEnvironment;
const { get, list, create, createAt, update, remove } = requestsOf(() => environment);

/** The list and the task of the world (fixtures.ts): a plan of the replication, assigned to `member`. */
const LIST_ID = autoId("stored task list");
const TASK = `tasks/${autoId("stored task")}`;
const PERSONAL_LIST = `taskLists/${autoId("personal list")}`;
const PERSONAL_TASK = `tasks/${autoId("personal task")}`;
const PROGRAMME_LIST = `taskLists/${autoId("programme list")}`;
const REMINDER = `reminders/${autoId("stored reminder")}`;
const SENT_REMINDER = `reminders/${autoId("sent reminder")}`;
const TAG = `tags/${tagId("Pilot")}`;

const task = (fields: Record<string, unknown>) => ({
  ...stored(),
  listId: LIST_ID,
  ownerUid: null,
  parentId: null,
  ancestorIds: [],
  order: "i",
  kind: "task",
  title: "A synthetic task",
  mentionUids: [],
  statusKey: "toDo",
  statusHistoryId: null,
  priority: "none",
  completedAt: null,
  assigneeUids: [],
  collaboratorUids: [],
  followerUids: [],
  unclaimedParticipants: [],
  dependsOn: {},
  links: [],
  checklist: {},
  tagIds: [],
  custom: {},
  replicationId: OWN_REPLICATION,
  laboratoryId: null,
  scopeKeys: [replicationScopeKey(OWN_REPLICATION)],
  ...fields,
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-tasks");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await trusted(environment, async (db) => {
    await setDoc(doc(db, PERSONAL_LIST), {
      ...stored(),
      name: "My own plan",
      kind: "personal",
      ownerUid: OWNER_UID,
      scopeType: "user",
      scopeId: OWNER_UID,
      replicationId: null,
      laboratoryId: null,
      scopeKeys: [userScopeKey(OWNER_UID)],
    });
    await setDoc(
      doc(db, PERSONAL_TASK),
      task({
        listId: PERSONAL_LIST.split("/")[1],
        ownerUid: OWNER_UID,
        replicationId: null,
        scopeKeys: [userScopeKey(OWNER_UID)],
        followerUids: [uidOfCaller("ownLabMember")],
      }),
    );
    await setDoc(doc(db, PROGRAMME_LIST), {
      ...stored(),
      name: "Programme roadmap",
      kind: "project",
      ownerUid: null,
      scopeType: "programme",
      scopeId: "eegmanylabs",
      replicationId: null,
      laboratoryId: null,
      scopeKeys: [MEMBERS_SCOPE_KEY, PROGRAMME_SCOPE_KEY],
    });
    await setDoc(doc(db, SENT_REMINDER), {
      ...stored(),
      uid: OWNER_UID,
      entityType: "task",
      entityId: TASK.split("/")[1],
      remindAt: Timestamp.fromDate(new Date("2026-01-01T09:00:00Z")),
      sentAt: Timestamp.fromDate(new Date("2026-01-01T09:01:00Z")),
      channel: "inApp",
    });
  });
});

describe("a task list", () => {
  it("is read by its scope, a personal list by its owner alone, and a list of the programme by every member", async () => {
    await expectOutcomes({
      "the replication's team reads its list": ["allowed", get("ownTeam", `taskLists/${LIST_ID}`)],
      "a member outside the replication reads it": ["denied", get("member", `taskLists/${LIST_ID}`)],
      "the owner reads the personal list": ["allowed", get("owner", PERSONAL_LIST)],
      "the owner lists their own lists": [
        "allowed",
        list("owner", "taskLists", where("ownerUid", "==", OWNER_UID), limit(100)),
      ],
      "another member lists the owner's lists": [
        "denied",
        list("member", "taskLists", where("ownerUid", "==", OWNER_UID), limit(100)),
      ],
      "a lead of the replication reads the personal list": ["denied", get("ownLead", PERSONAL_LIST)],
      "an administrator reads the personal list": ["allowed", get("admin", PERSONAL_LIST)],
      "every member reads the list of the programme": ["allowed", get("member", PROGRAMME_LIST)],
      "every member lists the lists of the programme": [
        "allowed",
        list("member", "taskLists", where("scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]), limit(100)),
      ],
      "an account without membership reads the list of the programme": ["denied", get("noMembership", PROGRAMME_LIST)],
      "a list without a scope": ["denied", list("ownTeam", "taskLists", limit(100))],
    });
  });

  it("takes every write from trusted code", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "creates a list directly", (caller) =>
        create(caller, `taskLists/${autoId(`new list of ${caller}`)}`, {
          name: "A list written directly",
          kind: "personal",
          ownerUid: uidOfCaller(caller),
          scopeType: "user",
          scopeId: uidOfCaller(caller),
          replicationId: null,
          laboratoryId: null,
          scopeKeys: [userScopeKey(uidOfCaller(caller))],
        }),
      ),
      "the owner renames the personal list directly": ["denied", update("owner", PERSONAL_LIST, { name: "Renamed" })],
      "a lead renames the replication's list directly": [
        "denied",
        update("ownLead", `taskLists/${LIST_ID}`, { name: "Renamed" }),
      ],
      "an administrator deletes a list": ["denied", remove("admin", `taskLists/${LIST_ID}`)],
    });
  });
});

describe("a task", () => {
  it("is read by the scope of its list, by its owner and by every participant, whatever its list", async () => {
    await expectOutcomes({
      "the replication's team reads the task": ["allowed", get("ownTeam", TASK)],
      "its assignee, outside the replication, reads it": ["allowed", get("member", TASK)],
      "a member who is no participant reads it": ["denied", get("ownLabMember", TASK)],
      "the owner reads a task of the personal list": ["allowed", get("owner", PERSONAL_TASK)],
      "a follower of that task reads it": ["allowed", get("ownLabMember", PERSONAL_TASK)],
      "a lead of the replication reads the personal task": ["denied", get("ownLead", PERSONAL_TASK)],
      "the assignee lists the tasks assigned to them": [
        "allowed",
        list("member", "tasks", where("assigneeUids", "array-contains", MEMBER_UID), limit(100)),
      ],
      "another account lists the tasks assigned to the member": [
        "denied",
        list("ownLabMember", "tasks", where("assigneeUids", "array-contains", MEMBER_UID), limit(100)),
      ],
      "a follower lists the tasks they follow": [
        "allowed",
        list("ownLabMember", "tasks", where("followerUids", "array-contains", uidOfCaller("ownLabMember")), limit(100)),
      ],
      "the owner lists the tasks of their personal lists": [
        "allowed",
        list("owner", "tasks", where("ownerUid", "==", OWNER_UID), limit(100)),
      ],
      "the team lists the tasks of its scope": [
        "allowed",
        list(
          "ownTeam",
          "tasks",
          where("scopeKeys", "array-contains-any", [replicationScopeKey(OWN_REPLICATION)]),
          limit(100),
        ),
      ],
      "a member lists the tasks of a scope it does not hold": [
        "denied",
        list(
          "member",
          "tasks",
          where("scopeKeys", "array-contains-any", [replicationScopeKey(OWN_REPLICATION)]),
          limit(100),
        ),
      ],
      "a suspended account reads its task": ["denied", get("suspended", TASK)],
      "an administrator without the factor reads the task": ["denied", get("adminWithoutFactor", TASK)],
    });
  });

  it("takes every write from trusted code, its status and its tree included", async () => {
    await expectOutcomes({
      "a lead creates a task directly": [
        "denied",
        create("ownLead", `tasks/${autoId("new task")}`, task({ title: "Written directly" })),
      ],
      "a lead renames a task directly": ["denied", update("ownLead", TASK, { title: "Renamed directly" })],
      "the assignee completes the task directly": [
        "denied",
        update("member", TASK, { statusKey: "done", completedAt: serverTimestamp() }),
      ],
      "the owner moves a personal task beneath itself": [
        "denied",
        update("owner", PERSONAL_TASK, { parentId: PERSONAL_TASK.split("/")[1] }),
      ],
      "an administrator widens the audience of a task": [
        "denied",
        update("admin", TASK, { scopeKeys: [MEMBERS_SCOPE_KEY] }),
      ],
      "an administrator deletes a task": ["denied", remove("admin", TASK)],
    });
  });
});

describe("a tag", () => {
  it("is created by a member under the hash of its folded name, and under no other identifier", async () => {
    await expectOutcomes({
      "a member creates a tag under the hash of its folded name": [
        "allowed",
        create("member", `tags/${tagId("Data quality")}`, { name: "Data quality", nameFolded: "dataquality" }),
      ],
      "a member creates a tag under the hash of another name": [
        "denied",
        create("member", `tags/${tagId("Something else")}`, { name: "Analysis", nameFolded: "analysis" }),
      ],
      "a member creates a tag whose folded name is not folded": [
        "denied",
        create("member", `tags/${tagId("Analysis")}`, { name: "Analysis", nameFolded: "Analysis" }),
      ],
      "a member creates a tag under a readable identifier": [
        "denied",
        createAt("member", "tags/analysis", { name: "Analysis", nameFolded: "analysis" }),
      ],
      "a member creates a tag with a long colour": [
        "denied",
        create("member", `tags/${tagId("Ethics")}`, { name: "Ethics", nameFolded: "ethics", colour: "x".repeat(33) }),
      ],
      "an account without membership creates a tag": [
        "denied",
        create("noMembership", `tags/${tagId("Training")}`, { name: "Training", nameFolded: "training" }),
      ],
    });
  });

  it("is recoloured by those who manage lookups, and its name and folded name never change", async () => {
    await expectOutcomes({
      "the core team recolours a tag": ["allowed", update("coreTeam", TAG, { colour: "graphite" })],
      "the core team renames a tag, which is its identity": ["denied", update("coreTeam", TAG, { name: "Piloting" })],
      "the core team changes its folded name": ["denied", update("coreTeam", TAG, { nameFolded: "other" })],
      "a member recolours a tag": ["denied", update("member", TAG, { colour: "graphite" })],
      "a lead deletes a tag": ["denied", remove("ownLead", TAG)],
    });
  });
});

describe("a reminder", () => {
  it("is its owner's alone, to read, change before it is sent and remove, and is set by a function alone", async () => {
    const data = {
      uid: OWNER_UID,
      entityType: "task",
      entityId: TASK.split("/")[1],
      remindAt: Timestamp.fromMillis(Date.now() + 86_400_000),
      sentAt: null,
      channel: "inApp",
    };
    const inDays = (days: number) => Timestamp.fromMillis(Date.now() + days * 86_400_000);
    await expectOutcomes({
      "the owner reads the reminder": ["allowed", get("owner", REMINDER)],
      "the owner lists their reminders": [
        "allowed",
        list("owner", "reminders", where("uid", "==", OWNER_UID), limit(50)),
      ],
      "another member reads it": ["denied", get("member", REMINDER)],
      "another member lists the owner's reminders": [
        "denied",
        list("member", "reminders", where("uid", "==", OWNER_UID), limit(50)),
      ],
      "the owner sets a reminder directly, past the function that counts and checks it": [
        "denied",
        create("owner", `reminders/${autoId("owner's reminder")}`, data),
      ],
      "a member sets a reminder for the owner": [
        "denied",
        create("member", `reminders/${autoId("member's reminder")}`, data),
      ],
      "the owner moves the reminder to a time to come": [
        "allowed",
        update("owner", REMINDER, { remindAt: inDays(30) }),
      ],
      "the owner changes the channel of a reminder that is due": [
        "allowed",
        update("owner", REMINDER, { channel: "email" }),
      ],
      "the owner moves the reminder to long ago, before everyone else's": [
        "denied",
        update("owner", REMINDER, { remindAt: Timestamp.fromMillis(0) }),
      ],
      "the owner moves the reminder more than two years ahead": [
        "denied",
        update("owner", REMINDER, { remindAt: inDays(800) }),
      ],
      "the owner sets an unknown channel": ["denied", update("owner", REMINDER, { channel: "pigeon" })],
      "the owner marks the reminder as sent": ["denied", update("owner", REMINDER, { sentAt: serverTimestamp() })],
      "the owner points the reminder at another record": ["denied", update("owner", REMINDER, { entityId: "other" })],
      "the owner moves a reminder that was sent": ["denied", update("owner", SENT_REMINDER, { remindAt: inDays(30) })],
      "another member removes the reminder": ["denied", remove("member", REMINDER)],
      "the owner removes the reminder": ["allowed", remove("owner", REMINDER)],
    });
  });
});

describe("the feed of progress updates", () => {
  it("is read by every member and written by trusted code alone", async () => {
    const progress = `progressUpdates/${autoId("stored progress update")}`;
    await expectOutcomes({
      "a member reads an update": ["allowed", get("member", progress)],
      "a member lists the updates of a record": [
        "allowed",
        list(
          "member",
          "progressUpdates",
          where("entityType", "==", "replication"),
          where("entityId", "==", OWN_REPLICATION),
          limit(50),
        ),
      ],
      "an account without membership reads it": ["denied", get("noMembership", progress)],
      "the team posts an update directly": [
        "denied",
        create(
          "ownTeam",
          `progressUpdates/${autoId("direct update")}`,
          {
            entityType: "replication",
            entityId: OWN_REPLICATION,
            authorUid: uidOfCaller("ownTeam"),
            body: "Written directly.",
            mentionUids: [],
            pinned: false,
            replicationId: OWN_REPLICATION,
            laboratoryId: null,
            scopeKeys: [replicationScopeKey(OWN_REPLICATION), MEMBERS_SCOPE_KEY],
          },
          true,
        ),
      ],
      "an administrator unpins an update": ["denied", update("admin", progress, { pinned: false })],
    });
  });
});
