// Integration tests of the functions of databases, custom properties, views and dashboards
// (D-011), run against the emulators: who may create a database and define its properties,
// every value checked against its property, the values of a core record kept apart from its
// strict fields, views that stay their owner's until shared, the dashboards of the scopes, and
// the trigger that keeps the audience of a database in line with its page.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  COLLECTIONS,
  createDatabaseContract,
  createPageContract,
  databaseDocSchema,
  databaseRowDocSchema,
  openDashboardContract,
  participationDocSchema,
  saveDashboardContract,
  savePropertyContract,
  saveRecordsContract,
  saveViewContract,
  userScopeKey,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  dataOf,
  eventually,
  grantRole,
  laboratory,
  leaveNoTrace,
  person,
  refusal,
  replication,
  resetWorld,
  standard,
} from "./support";

beforeEach(resetWorld);
afterAll(leaveNoTrace);

const STUDY = "SyntheticViews2001";
const LAB = "lab-synthetic-views";
const PARTICIPATION = `${STUDY}__${LAB}`;

/** A member linked to a person of the directory. */
async function member(uid: string): Promise<Caller> {
  await person(`person-${uid}`, [], { displayName: `Synthetic ${uid}`, userId: uid });
  return account(uid, { personId: `person-${uid}` });
}

/**
 * A page of the workspace made by its owner, which every member reads and its owner alone edits,
 * and a database beneath it.
 */
async function databaseOf(owner: Caller): Promise<{ readonly pageId: string; readonly databaseId: string }> {
  const { pageId } = await call(owner, createPageContract, { parentPageId: null, title: "Synthetic sites" });
  const ownerKey = userScopeKey(owner.uid);
  await adminDb.doc(COLLECTIONS.pages.docPath(pageId)).update({
    levelKeys: { comment: ["members"], edit: [ownerKey], full: [ownerKey] },
  });
  const { databaseId } = await call(owner, createDatabaseContract, { parentPageId: pageId, name: "Sites" });
  return { pageId, databaseId };
}

async function rowsOf(databaseId: string) {
  const snapshot = await adminDb.collection(COLLECTIONS.databaseRows.collectionPath(databaseId)).get();
  return snapshot.docs.map((row) => ({ id: row.id, ...databaseRowDocSchema.parse(row.data()) }));
}

async function participationWorld() {
  await replication(STUDY);
  await laboratory(LAB);
  await adminDb.doc(COLLECTIONS.participations.docPath(PARTICIPATION)).set({
    ...standard(),
    replicationId: STUDY,
    laboratoryId: LAB,
    scopeKeys: [`rep:${STUDY}`, `lab:${LAB}`],
    status: "confirmed",
    statusHistoryId: null,
    targetNMain: 40,
    readinessStatus: "notStarted",
    custom: {},
    dataOrigin: "demo",
  });
  const lead = await member("uid-lead");
  await grantRole("uid-lead", "replication_lead", "replication", STUDY);
  const otherLead = await member("uid-other-lead");
  await grantRole("uid-other-lead", "replication_lead", "replication", "SyntheticViews2002");
  const admin = await administrator("uid-admin");
  return { lead, otherLead, admin };
}

describe("databases", () => {
  it("are created beneath a page by its editors, with its audience and an audit entry", async () => {
    const owner = await member("uid-owner");
    const reader = await member("uid-reader");
    const { pageId, databaseId } = await databaseOf(owner);
    const database = databaseDocSchema.parse(await dataOf(COLLECTIONS.databases.docPath(databaseId)));
    const page = await dataOf(COLLECTIONS.pages.docPath(pageId));
    expect(database.scopeKeys).toEqual(page?.scopeKeys);
    expect(database.levelKeys).toEqual(page?.levelKeys);
    expect(Object.keys(database.properties)).toEqual(["status"]);
    expect(await auditOf("database.created", databaseId)).toHaveLength(1);
    expect(await codeOf(call(reader, createDatabaseContract, { parentPageId: pageId, name: "Mine" }))).toBe(
      "permission-denied",
    );
    expect(await codeOf(call(owner, createDatabaseContract, { parentPageId: "missing", name: "Mine" }))).toBe(
      "not-found",
    );
    expect(await codeOf(call(null, createDatabaseContract, { parentPageId: pageId, name: "Mine" }))).toBe(
      "unauthenticated",
    );
  });

  it("follow the audience of their page when it changes", async () => {
    const owner = await member("uid-owner");
    const { pageId, databaseId } = await databaseOf(owner);
    const widened = [userScopeKey("uid-owner"), "members", "rep:SyntheticViews2003"];
    await adminDb.doc(COLLECTIONS.pages.docPath(pageId)).update({ scopeKeys: widened });
    await eventually(
      async () =>
        JSON.stringify((await dataOf(COLLECTIONS.databases.docPath(databaseId)))?.scopeKeys) ===
        JSON.stringify(widened),
      "the database copies the audience of its page",
    );
  });
});

describe("properties", () => {
  it("are defined by the editors of a database and checked before they are stored", async () => {
    const owner = await member("uid-owner");
    const reader = await member("uid-reader");
    const { databaseId } = await databaseOf(owner);
    const collectionKey = `db:${databaseId}`;
    const { propertyId } = await call(owner, savePropertyContract, {
      collectionKey,
      name: "Target",
      type: "number",
      config: { numberFormat: "integer", options: [{ id: "ignored", name: "Ignored" }] },
    });
    const { propertyId: formulaId } = await call(owner, savePropertyContract, {
      collectionKey,
      name: "Half",
      type: "formula",
      config: { formula: { expression: 'prop("Target") / 2' } },
    });
    const database = databaseDocSchema.parse(await dataOf(COLLECTIONS.databases.docPath(databaseId)));
    expect(database.properties[propertyId]).toMatchObject({
      name: "Target",
      type: "number",
      config: { numberFormat: "integer" },
    });
    expect(database.properties[propertyId]?.config).not.toHaveProperty("options");
    expect((database.properties[formulaId]?.order ?? "") > (database.properties[propertyId]?.order ?? "")).toBe(true);
    expect(await auditOf("property.saved", databaseId)).toHaveLength(2);

    const broken = await refusal(
      call(owner, savePropertyContract, {
        collectionKey,
        name: "Broken",
        type: "formula",
        config: { formula: { expression: "1 +" } },
      }),
    );
    expect(broken.message).toBe("The formula cannot be used: The formula ends too early.");
    expect(
      await codeOf(
        call(owner, savePropertyContract, { collectionKey, propertyId, name: "Target", type: "text", config: {} }),
      ),
    ).toBe("failed-precondition");
    expect(
      await codeOf(
        call(owner, savePropertyContract, {
          collectionKey,
          name: "Owner",
          type: "rollup",
          config: { rollup: { source: { relation: "missing" }, property: "x", function: "count" } },
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(call(reader, savePropertyContract, { collectionKey, name: "Mine", type: "text", config: {} })),
    ).toBe("permission-denied");
  });

  it("of a core collection are defined by administrators, never in the place of a core field", async () => {
    const { lead, admin } = await participationWorld();
    const input = {
      collectionKey: "core:participations",
      name: "Site note",
      type: "text",
      config: {},
      audience: "member",
    } as const;
    expect(await codeOf(call(lead, savePropertyContract, input))).toBe("permission-denied");
    const { propertyId } = await call(admin, savePropertyContract, input);
    expect(
      (await dataOf(COLLECTIONS.collectionSchemas.docPath("core:participations")))?.properties[propertyId],
    ).toMatchObject({
      name: "Site note",
      audience: "member",
    });
    for (const reserved of ["status", "targetNMain", "custom", "participation"]) {
      expect(await codeOf(call(admin, savePropertyContract, { ...input, propertyId: reserved }))).toBe("not-found");
    }
    expect(await codeOf(call(admin, savePropertyContract, { ...input, propertyId, audience: "restricted" }))).toBe(
      "failed-precondition",
    );
    expect(await codeOf(call(admin, savePropertyContract, { ...input, audience: undefined }))).toBe("invalid-argument");
    expect(await codeOf(call(admin, savePropertyContract, { ...input, collectionKey: "core:checklistItems" }))).toBe(
      "invalid-argument",
    );
  });
});

describe("saveRecords", () => {
  it("creates, changes in bulk and archives the rows of a database, with an audit entry for each", async () => {
    const owner = await member("uid-owner");
    const { databaseId } = await databaseOf(owner);
    const collectionKey = `db:${databaseId}`;
    const { propertyId: target } = await call(owner, savePropertyContract, {
      collectionKey,
      name: "Target",
      type: "number",
      config: {},
    });
    const { recordIds } = await call(owner, saveRecordsContract, {
      collectionKey,
      changes: [
        { title: "Site one", values: { [target]: 10, status: "notStarted" } },
        { title: "Site two", values: { [target]: 20 } },
      ],
    });
    expect(recordIds).toHaveLength(2);
    await call(owner, saveRecordsContract, {
      collectionKey,
      changes: recordIds.map((recordId) => ({ recordId, values: { status: "done", [target]: null } })),
    });
    const rows = await rowsOf(databaseId);
    expect(rows.map((row) => [row.title, row.values])).toEqual(
      expect.arrayContaining([
        ["Site one", { status: "done" }],
        ["Site two", { status: "done" }],
      ]),
    );
    expect((rows[0]?.order ?? "") !== (rows[1]?.order ?? "")).toBe(true);
    expect(await auditOf("record.saved")).toHaveLength(4);
    await call(owner, saveRecordsContract, { collectionKey, changes: [], archive: [recordIds[0] ?? ""] });
    expect((await rowsOf(databaseId)).filter((row) => row.archivedAt !== null)).toHaveLength(1);
  });

  it("refuses a value that does not fit its property, a computed property, and a caller who may not edit", async () => {
    const owner = await member("uid-owner");
    const reader = await member("uid-reader");
    const { databaseId } = await databaseOf(owner);
    const collectionKey = `db:${databaseId}`;
    const { propertyId: formula } = await call(owner, savePropertyContract, {
      collectionKey,
      name: "Formula",
      type: "formula",
      config: { formula: { expression: "1" } },
    });
    const wrong = await refusal(
      call(owner, saveRecordsContract, { collectionKey, changes: [{ values: { status: "unknown" } }] }),
    );
    expect(wrong.message).toBe("Status has no such option.");
    expect(
      await codeOf(call(owner, saveRecordsContract, { collectionKey, changes: [{ values: { [formula]: 2 } }] })),
    ).toBe("invalid-argument");
    expect(
      await codeOf(call(owner, saveRecordsContract, { collectionKey, changes: [{ values: { missing: 1 } }] })),
    ).toBe("invalid-argument");
    expect(await codeOf(call(reader, saveRecordsContract, { collectionKey, changes: [{ values: {} }] }))).toBe(
      "permission-denied",
    );
    expect(
      await codeOf(call(owner, saveRecordsContract, { collectionKey, changes: [{ recordId: "missing", values: {} }] })),
    ).toBe("not-found");
    expect(await rowsOf(databaseId)).toEqual([]);
  });

  it("keeps the values of a core record apart: member values in custom, restricted ones in private/custom", async () => {
    const { lead, otherLead, admin } = await participationWorld();
    const { propertyId: note } = await call(admin, savePropertyContract, {
      collectionKey: "core:participations",
      name: "Site note",
      type: "text",
      config: {},
      audience: "member",
    });
    const { propertyId: phone } = await call(admin, savePropertyContract, {
      collectionKey: "core:participations",
      name: "Ethics office telephone",
      type: "text",
      config: {},
      audience: "restricted",
    });
    const collectionKey = "core:participations";
    await call(lead, saveRecordsContract, {
      collectionKey,
      changes: [{ recordId: PARTICIPATION, values: { [note]: "Pilot first", [phone]: "+44 0000", targetNMain: 45 } }],
    });
    const participation = participationDocSchema.parse(await dataOf(COLLECTIONS.participations.docPath(PARTICIPATION)));
    expect(participation.custom).toEqual({ [note]: "Pilot first" });
    expect(participation.targetNMain).toBe(45);
    expect((await dataOf(COLLECTIONS.participationCustom.docPath(PARTICIPATION)))?.custom).toEqual({
      [phone]: "+44 0000",
    });
    const [entry] = await auditOf("record.saved", PARTICIPATION);
    expect(JSON.stringify(entry?.changes)).not.toContain("+44");

    expect(
      await codeOf(
        call(otherLead, saveRecordsContract, {
          collectionKey,
          changes: [{ recordId: PARTICIPATION, values: { [note]: "x" } }],
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(lead, saveRecordsContract, {
          collectionKey,
          changes: [{ recordId: PARTICIPATION, values: { targetNMain: -1 } }],
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(lead, saveRecordsContract, {
          collectionKey,
          changes: [{ recordId: PARTICIPATION, values: { status: "ready" } }],
        }),
      ),
    ).toBe("invalid-argument");
    await call(lead, saveRecordsContract, {
      collectionKey,
      changes: [{ recordId: PARTICIPATION, values: { [phone]: null, targetNMain: null } }],
    });
    expect((await dataOf(COLLECTIONS.participationCustom.docPath(PARTICIPATION)))?.custom).toEqual({});
    expect(
      participationDocSchema.parse(await dataOf(COLLECTIONS.participations.docPath(PARTICIPATION))).targetNMain,
    ).toBeUndefined();
  });
});

describe("saveView", () => {
  it("keeps a view its owner's until it is shared, and lets the programme change a shared one", async () => {
    const owner = await member("uid-owner");
    const other = await member("uid-other");
    const admin = await administrator("uid-admin");
    const input = {
      collectionKey: "core:participations",
      name: "By status",
      type: "board",
      config: { boardProperty: "status" },
      scope: null,
      isShared: false,
      pageId: null,
    } as const;
    const { viewId } = await call(owner, saveViewContract, input);
    expect(await dataOf(COLLECTIONS.views.docPath(viewId))).toMatchObject({ ownerUid: "uid-owner", isShared: false });
    expect(await codeOf(call(other, saveViewContract, { ...input, viewId }))).toBe("not-found");
    expect(await codeOf(call(admin, saveViewContract, { ...input, viewId }))).toBe("not-found");
    await call(owner, saveViewContract, { ...input, viewId, isShared: true });
    expect(await codeOf(call(other, saveViewContract, { ...input, viewId, name: "Taken" }))).toBe("permission-denied");
    await call(admin, saveViewContract, { ...input, viewId, isShared: true, name: "Participations by status" });
    expect(await dataOf(COLLECTIONS.views.docPath(viewId))).toMatchObject({
      ownerUid: "uid-owner",
      name: "Participations by status",
    });
    expect(await codeOf(call(owner, saveViewContract, { ...input, viewId, collectionKey: "core:persons" }))).toBe(
      "invalid-argument",
    );
    expect(await codeOf(call(owner, saveViewContract, { ...input, collectionKey: "core:checklistItems" }))).toBe(
      "not-found",
    );
    expect(await codeOf(call(owner, saveViewContract, { ...input, collectionKey: "db:missing" }))).toBe("not-found");
    expect(await auditOf("view.saved", viewId)).toHaveLength(3);
  });
});

describe("dashboards", () => {
  it("of a scope are created once, on first use, with their widgets", async () => {
    const { lead } = await participationWorld();
    const first = await call(lead, openDashboardContract, { scopeType: "replication", scopeId: STUDY });
    const second = await call(lead, openDashboardContract, { scopeType: "replication", scopeId: STUDY });
    expect(first).toEqual({ dashboardId: `replication__${STUDY}`, created: true });
    expect(second).toEqual({ dashboardId: `replication__${STUDY}`, created: false });
    const dashboard = await dataOf(COLLECTIONS.dashboards.docPath(first.dashboardId));
    expect(dashboard).toMatchObject({ ownerUid: null, scopeType: "replication", replicationId: STUDY });
    expect(dashboard?.widgets.participations.config.scope).toEqual({ property: "replication", value: STUDY });
    expect((await call(lead, openDashboardContract, { scopeType: "programme", scopeId: "eegmanylabs" })).created).toBe(
      true,
    );
    expect(await codeOf(call(lead, openDashboardContract, { scopeType: "replication", scopeId: "Missing2000" }))).toBe(
      "not-found",
    );
    expect(await codeOf(call(lead, openDashboardContract, { scopeType: "laboratory", scopeId: "lab-missing" }))).toBe(
      "not-found",
    );
  });

  it("are changed widget by widget by their owner, or by those who manage the pages of the scope", async () => {
    const { lead, otherLead } = await participationWorld();
    const note = (text: string) =>
      ({ type: "note", config: { title: "Notes", text }, x: 0, y: 0, w: 4, h: 2 }) as const;
    const { dashboardId } = await call(lead, saveDashboardContract, {
      name: "Mine",
      widgets: { a: note("one"), b: note("two") },
    });
    expect(await dataOf(COLLECTIONS.dashboards.docPath(dashboardId))).toMatchObject({
      ownerUid: "uid-lead",
      scopeType: "user",
      scopeKeys: [userScopeKey("uid-lead")],
    });
    await call(lead, saveDashboardContract, { dashboardId, widgets: { a: null, c: note("three") } });
    expect(Object.keys((await dataOf(COLLECTIONS.dashboards.docPath(dashboardId)))?.widgets ?? {}).sort()).toEqual([
      "b",
      "c",
    ]);
    expect(await codeOf(call(otherLead, saveDashboardContract, { dashboardId, widgets: {} }))).toBe("not-found");

    const { dashboardId: replicationDashboard } = await call(lead, openDashboardContract, {
      scopeType: "replication",
      scopeId: STUDY,
    });
    await call(lead, saveDashboardContract, { dashboardId: replicationDashboard, widgets: { extra: note("lead") } });
    expect(
      await codeOf(call(otherLead, saveDashboardContract, { dashboardId: replicationDashboard, widgets: {} })),
    ).toBe("permission-denied");
    const reader = await account("uid-plain", { personId: null });
    expect(await codeOf(call(reader, saveDashboardContract, { widgets: {} }))).toBe("permission-denied");
    const tooWide = { ...note("wide"), x: 10, w: 4 };
    expect(await codeOf(call(lead, saveDashboardContract, { dashboardId, widgets: { wide: tooWide } }))).toBe(
      "invalid-argument",
    );
    expect(await auditOf("dashboard.saved")).toHaveLength(4);
  });
});
