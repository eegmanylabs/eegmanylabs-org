// The rules of databases, custom properties, views and dashboards (D-011), beside the
// registry-driven matrix: who reads a database and its rows, who renames one, who reads the
// restricted custom values of a core record, whose views and dashboards each account sees, and
// that every structured value is written by trusted code alone. Each refusal stands beside the
// honest request that is accepted. The attacks on views and dashboards that once proved them
// closed now prove that nobody stores one directly, takes over another's or reads another's.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { entityRefId, laboratoryScopeKey, MEMBERS_SCOPE_KEY, replicationScopeKey, userScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, limit, serverTimestamp, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { EVERYONE, forEach } from "./redteam/exfiltration-and-escalation-support";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  autoId,
  MEMBER_UID,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  stored,
  uidOfCaller,
} from "./world";

let environment: RulesTestEnvironment;
const { get, list, create, createAt, update, remove } = requestsOf(() => environment);

/** The page of the world, which every member reads and the replication's team edits (fixtures.ts). */
const PAGE_ID = entityRefId("replication", OWN_REPLICATION);
const PAGE_SCOPE = [laboratoryScopeKey(OWN_LABORATORY), MEMBERS_SCOPE_KEY, replicationScopeKey(OWN_REPLICATION)];
const DATABASE = `databases/${autoId("stored database")}`;
const ROW = `${DATABASE}/rows/${autoId("stored row")}`;

/** A database beneath a restricted page that the account `member` alone reads. */
const RESTRICTED_PAGE_ID = "restricted-page-2";
const RESTRICTED_DATABASE = `databases/${autoId("restricted database")}`;
const RESTRICTED_ROW = `${RESTRICTED_DATABASE}/rows/${autoId("restricted row")}`;

const PERSONAL_VIEW = `views/${autoId("stored view")}`;
const SHARED_VIEW = `views/${autoId("shared view")}`;
const PERSONAL_DASHBOARD = `dashboards/${autoId("stored dashboard")}`;
const PROGRAMME_DASHBOARD = "dashboards/programme__eegmanylabs";

const view = (ownerUid: string, isShared: boolean) => ({
  ...stored(),
  collectionKey: "core:participations",
  name: isShared ? "Participations by status" : "My participations",
  type: "board",
  config: { boardProperty: "status" },
  ownerUid,
  isShared,
  pageId: null,
  order: "i",
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-views");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await trusted(environment, async (db) => {
    const restrictedKeys = [userScopeKey(MEMBER_UID)];
    await setDoc(doc(db, `pages/${RESTRICTED_PAGE_ID}`), {
      ...stored(),
      parentPageId: null,
      ancestorPageIds: [],
      kind: "custom",
      title: "Restricted synthetic notes",
      order: "i",
      isTemplate: false,
      accessMode: "restricted",
      replicationId: null,
      laboratoryId: null,
      scopeKeys: restrictedKeys,
      levelKeys: { comment: [], edit: [], full: [] },
      contentHead: null,
      mentionUids: [],
      tagIds: [],
      lastEditedBy: null,
    });
    await setDoc(doc(db, RESTRICTED_DATABASE), {
      ...stored(),
      name: "Restricted synthetic database",
      parentPageId: RESTRICTED_PAGE_ID,
      isTemplate: false,
      properties: {},
      scopeKeys: restrictedKeys,
      levelKeys: { comment: [], edit: [], full: [] },
    });
    await setDoc(doc(db, RESTRICTED_ROW), {
      ...stored(),
      databaseId: RESTRICTED_DATABASE.split("/")[1],
      title: "A restricted row",
      values: {},
      order: "i",
      pageId: null,
      tagIds: [],
    });
    await setDoc(doc(db, SHARED_VIEW), view(OWNER_UID, true));
    await setDoc(doc(db, PROGRAMME_DASHBOARD), {
      ...stored(),
      scopeType: "programme",
      scopeId: "eegmanylabs",
      ownerUid: null,
      name: "Programme dashboard",
      widgets: {},
      replicationId: null,
      laboratoryId: null,
      scopeKeys: [MEMBERS_SCOPE_KEY],
    });
  });
});

describe("a database and its rows", () => {
  it("are read by the readers of the parent page, and a restricted page keeps its database to itself", async () => {
    await expectOutcomes({
      "a member reads the database": ["allowed", get("member", DATABASE)],
      "a member reads a row": ["allowed", get("member", ROW)],
      "a member lists the rows": ["allowed", list("member", `${DATABASE}/rows`, limit(100))],
      "a member lists the databases beneath the page": [
        "allowed",
        list(
          "member",
          "databases",
          where("parentPageId", "==", PAGE_ID),
          where("scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY]),
          limit(10),
        ),
      ],
      "an account without membership reads the database": ["denied", get("noMembership", DATABASE)],
      "a suspended account reads a row": ["denied", get("suspended", ROW)],
      "the member listed on the restricted page reads its database": ["allowed", get("member", RESTRICTED_DATABASE)],
      "and its rows": ["allowed", list("member", `${RESTRICTED_DATABASE}/rows`, limit(10))],
      "another member reads the restricted database": ["denied", get("owner", RESTRICTED_DATABASE)],
      "another member reads its row": ["denied", get("ownLead", RESTRICTED_ROW)],
      "another member lists its rows": ["denied", list("ownTeam", `${RESTRICTED_DATABASE}/rows`, limit(10))],
      "an administrator reads the restricted database": ["allowed", get("admin", RESTRICTED_DATABASE)],
      "an administrator without the factor reads it": ["denied", get("adminWithoutFactor", RESTRICTED_ROW)],
      "a list of the databases without a scope": ["denied", list("member", "databases", limit(10))],
    });
  });

  it("is renamed, made a template and archived by an editor of the parent page, and by nobody below that level", async () => {
    await expectOutcomes({
      "an editor renames it": ["allowed", update("ownTeam", DATABASE, { name: "Synthetic sites, renamed" })],
      "an editor makes it a template": ["allowed", update("ownTeam", DATABASE, { isTemplate: true })],
      "an editor archives it": ["allowed", update("ownLead", DATABASE, { archivedAt: serverTimestamp() })],
    });
    await seedWorld(environment);
    await expectOutcomes({
      "a commenter renames it": ["denied", update("ownLabMember", DATABASE, { name: "Renamed by a commenter" })],
      "a reader renames it": ["denied", update("member", DATABASE, { name: "Renamed by a reader" })],
      "a reader makes it a template": ["denied", update("member", DATABASE, { isTemplate: true })],
      "a commenter makes it a template": ["denied", update("ownLabMember", DATABASE, { isTemplate: true })],
      "an editor marks it a template with a text": ["denied", update("ownTeam", DATABASE, { isTemplate: "yes" })],
      "an editor names a template it came from": [
        "denied",
        update("ownTeam", DATABASE, { templateSourceId: "another-database" }),
      ],
      "an editor changes its properties": [
        "denied",
        update("ownTeam", DATABASE, { "properties.status.name": "Phase" }),
      ],
      "an editor widens its audience": [
        "denied",
        update("ownTeam", DATABASE, { scopeKeys: [MEMBERS_SCOPE_KEY, userScopeKey(uidOfCaller("ownTeam"))] }),
      ],
      "an editor moves it beneath another page": ["denied", update("ownTeam", DATABASE, { parentPageId: "elsewhere" })],
      "an editor gives it an empty name": ["denied", update("ownTeam", DATABASE, { name: "" })],
      "an editor gives it a long icon": ["denied", update("ownTeam", DATABASE, { icon: "x".repeat(17) })],
      "an editor creates a database": [
        "denied",
        create("ownTeam", `databases/${autoId("new database")}`, {
          name: "A database of my own",
          parentPageId: PAGE_ID,
          isTemplate: false,
          properties: {},
          scopeKeys: PAGE_SCOPE,
          levelKeys: { comment: [], edit: [], full: [] },
        }),
      ],
      "an editor deletes the database": ["denied", remove("ownTeam", DATABASE)],
    });
  });

  it("take their rows from trusted code alone", async () => {
    await expectOutcomes({
      "an editor adds a row": [
        "denied",
        create("ownTeam", `${DATABASE}/rows/${autoId("new row")}`, {
          databaseId: DATABASE.split("/")[1],
          title: "A row written directly",
          values: { status: { nested: "a value no rule can check" } },
          order: "j",
          pageId: null,
          tagIds: [],
        }),
      ],
      "an editor changes a row": ["denied", update("ownTeam", ROW, { title: "Changed directly" })],
      "an administrator changes a row": ["denied", update("admin", ROW, { values: {} })],
      "an editor removes a row": ["denied", remove("ownTeam", ROW)],
    });
  });
});

describe("custom properties", () => {
  it("are defined by trusted code and read by every member", async () => {
    await expectOutcomes({
      "a member reads the definitions": ["allowed", get("member", "collectionSchemas/core:participations")],
      "a member lists them": ["allowed", list("member", "collectionSchemas", limit(10))],
      "a signed-out caller reads them": ["denied", get("signedOut", "collectionSchemas/core:participations")],
      "an administrator defines one directly": [
        "denied",
        createAt("admin", "collectionSchemas/core:replications", {
          collectionKey: "core:replications",
          properties: {},
        }),
      ],
      "an administrator overwrites a core field through one": [
        "denied",
        update("admin", "collectionSchemas/core:participations", {
          "properties.status": {
            key: "status",
            name: "Status",
            type: "text",
            config: {},
            order: "a",
            archivedAt: null,
            audience: "member",
          },
        }),
      ],
    });
  });

  it("keep restricted values within the scope of their record", async () => {
    const participation = `participations/${OWN_PARTICIPATION}/private/custom`;
    const replication = `replications/${OWN_REPLICATION}/private/custom`;
    const laboratory = `laboratories/${OWN_LABORATORY}/private/custom`;
    const person = `persons/${OWNER_PERSON}/private/custom`;
    await expectOutcomes({
      "a member of the laboratory reads the participation's": ["allowed", get("ownLabMember", participation)],
      "the team of the replication reads them": ["allowed", get("ownTeam", participation)],
      "a member of another laboratory reads them": ["denied", get("otherLabMember", participation)],
      "an ordinary member reads them": ["denied", get("member", participation)],
      "the team reads the replication's": ["allowed", get("ownTeam", replication)],
      "a lead of another replication reads them": ["denied", get("otherLead", replication)],
      "a coordinator reads the laboratory's": ["allowed", get("ownCoordinator", laboratory)],
      "another coordinator reads them": ["denied", get("otherCoordinator", laboratory)],
      "the person reads their own": ["allowed", get("owner", person)],
      "a coordinator of the person's laboratory reads them": ["allowed", get("ownCoordinator", person)],
      "an ordinary member reads a person's": ["denied", get("member", person)],
      "an administrator without the factor reads them": ["denied", get("adminWithoutFactor", participation)],
      "a lead writes a value directly": [
        "denied",
        update("ownLead", participation, { custom: { ethicsContact: "Written directly" } }),
      ],
      "a coordinator creates the laboratory's directly": [
        "denied",
        createAt("ownCoordinator", `laboratories/${OWN_LABORATORY}/private/other`, { custom: {} }),
      ],
    });
  });
});

describe("views", () => {
  it("are read by their owner alone until shared, and by those who read what they show afterwards", async () => {
    await expectOutcomes({
      "the owner reads the personal view": ["allowed", get("owner", PERSONAL_VIEW)],
      "another member reads it": ["denied", get("member", PERSONAL_VIEW)],
      "an administrator reads it": ["denied", get("admin", PERSONAL_VIEW)],
      "a member reads the shared view": ["allowed", get("member", SHARED_VIEW)],
      "an account without membership reads the shared view": ["denied", get("noMembership", SHARED_VIEW)],
      "the owner lists their views": ["allowed", list("owner", "views", where("ownerUid", "==", OWNER_UID), limit(10))],
      "a member lists the shared views of a collection": [
        "allowed",
        list(
          "member",
          "views",
          where("collectionKey", "==", "core:participations"),
          where("isShared", "==", true),
          limit(10),
        ),
      ],
      // The rules read the database of a shared view by its collection, which the list must name.
      "a member lists the shared views of every collection": [
        "denied",
        list("member", "views", where("isShared", "==", true), limit(10)),
      ],
      "a member lists another's views": [
        "denied",
        list("member", "views", where("ownerUid", "==", OWNER_UID), limit(10)),
      ],
      "a member lists every view": ["denied", list("member", "views", limit(10))],
    });
  });

  it("are deleted by their owner and stored by trusted code alone", async () => {
    await expectOutcomes({
      "another member deletes the personal view": ["denied", remove("member", PERSONAL_VIEW)],
      "an administrator deletes the shared view": ["denied", remove("admin", SHARED_VIEW)],
      "the owner shares the view directly": ["denied", update("owner", PERSONAL_VIEW, { isShared: true })],
      "the owner deletes the personal view": ["allowed", remove("owner", PERSONAL_VIEW)],
    });
  });

  it("are never stored directly, taken over or read across accounts", async () => {
    const synthetic = (caller: (typeof EVERYONE)[number]) => ({
      collectionKey: "core:persons",
      name: "A synthetic view",
      type: "table",
      config: { filter: { kind: "condition", property: "laboratories", operator: "contains", value: OWN_LABORATORY } },
      scope: { property: "replication", value: OWN_REPLICATION },
      ownerUid: uidOfCaller(caller),
      isShared: false,
      pageId: null,
      order: "a",
    });
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "stores a personal view", (caller) =>
        create(caller, `views/${autoId(`view of ${caller}`)}`, synthetic(caller)),
      ),
      ...forEach(EVERYONE, "denied", "shares a view with every member", (caller) =>
        create(caller, `views/${autoId(`shared view of ${caller}`)}`, { ...synthetic(caller), isShared: true }),
      ),
      ...forEach(EVERYONE, "denied", "takes over the stored view", (caller) =>
        update(caller, PERSONAL_VIEW, { ownerUid: uidOfCaller(caller), isShared: false }),
      ),
      ...forEach(
        EVERYONE.filter((caller) => caller !== "owner"),
        "denied",
        "reads the personal view of the owner",
        (caller) => get(caller, PERSONAL_VIEW),
      ),
    });
  });
});

describe("dashboards", () => {
  it("of a user are read by that user alone, and every other by every member", async () => {
    await expectOutcomes({
      "the owner reads their dashboard": ["allowed", get("owner", PERSONAL_DASHBOARD)],
      "another member reads it": ["denied", get("member", PERSONAL_DASHBOARD)],
      "a member reads the programme's": ["allowed", get("member", PROGRAMME_DASHBOARD)],
      "a member lists the dashboards of scopes": [
        "allowed",
        list("member", "dashboards", where("ownerUid", "==", null), limit(10)),
      ],
      "the owner lists their own": [
        "allowed",
        list("owner", "dashboards", where("ownerUid", "==", OWNER_UID), limit(10)),
      ],
      "a member lists another's": [
        "denied",
        list("member", "dashboards", where("ownerUid", "==", OWNER_UID), limit(10)),
      ],
      "an account without membership reads the programme's": ["denied", get("noMembership", PROGRAMME_DASHBOARD)],
    });
  });

  it("are stored by trusted code alone, whoever asks", async () => {
    const synthetic = (caller: (typeof EVERYONE)[number]) => ({
      scopeType: "user",
      scopeId: uidOfCaller(caller),
      ownerUid: uidOfCaller(caller),
      name: "A synthetic dashboard",
      widgets: {
        note: { type: "note", config: { title: "Notes", text: "Copied from another scope." }, x: 0, y: 0, w: 4, h: 2 },
      },
      replicationId: null,
      laboratoryId: null,
      scopeKeys: [userScopeKey(uidOfCaller(caller))],
    });
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "stores a personal dashboard", (caller) =>
        create(caller, `dashboards/${autoId(`dashboard of ${caller}`)}`, synthetic(caller)),
      ),
      ...forEach(EVERYONE, "denied", "stores a dashboard in the scope of the owning replication", (caller) =>
        createAt(caller, `dashboards/replication__${OWN_REPLICATION}`, {
          ...synthetic(caller),
          scopeType: "replication",
          scopeId: OWN_REPLICATION,
          ownerUid: null,
          replicationId: OWN_REPLICATION,
          scopeKeys: [replicationScopeKey(OWN_REPLICATION), MEMBERS_SCOPE_KEY],
        }),
      ),
      ...forEach(EVERYONE, "denied", "changes the programme's dashboard", (caller) =>
        update(caller, PROGRAMME_DASHBOARD, { name: "Taken over" }),
      ),
      "the owner changes their own directly": ["denied", update("owner", PERSONAL_DASHBOARD, { name: "Renamed" })],
      "an administrator changes the programme's directly": [
        "denied",
        update("admin", PROGRAMME_DASHBOARD, { "widgets.note": null }),
      ],
      "the owner deletes their own": ["denied", remove("owner", PERSONAL_DASHBOARD)],
    });
  });
});
