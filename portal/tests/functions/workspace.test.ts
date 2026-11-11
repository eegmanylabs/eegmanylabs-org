// Integration tests of the workspace functions and triggers (D-010), run against the emulators:
// creating, opening, moving and sharing pages, saving versions, searching, and what the
// triggers do with an editor's update and with a comment: mentions notified once, the search
// index kept in step with the page and its audience, and spells of editing recorded without
// the content. Yjs documents are built here in the layout the editor stores, which
// tests/editor/page-text.test.ts checks against the editor itself.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  COLLECTIONS,
  commentMention,
  createPageContract,
  entityRefId,
  getPageSharingContract,
  movePageContract,
  openEntityPageContract,
  PAGE_FRAGMENT_NAME,
  type PageDoc,
  pageDocSchema,
  pageLevelFor,
  savePageVersionContract,
  searchIndexId,
  searchWorkspaceContract,
  setPageSharingContract,
  userWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { adminDb } from "../support/admin";
import {
  accessOf,
  account,
  auditOf,
  type Caller,
  call,
  codeOf,
  eventually,
  leaveNoTrace,
  membership,
  notificationsOf,
  person,
  replication,
  resetWorld,
  settle,
  standard,
} from "./support";

beforeEach(resetWorld);
afterAll(leaveNoTrace);

const STUDY = "SyntheticWorkspace2001";

async function pageOf(pageId: string): Promise<PageDoc> {
  return pageDocSchema.parse((await adminDb.doc(COLLECTIONS.pages.docPath(pageId)).get()).data());
}

/** A member linked to a person of the directory, with the name the notifications carry, and on the team of a replication. */
async function member(uid: string, name: string, options: { readonly team?: string } = {}): Promise<Caller> {
  const personId = `person-${uid}`;
  await person(personId, [], { displayName: name, userId: uid });
  if (options.team !== undefined) await membership(options.team, personId, "member", { reviewStatus: "confirmed" });
  const caller = await account(uid, { personId });
  if (options.team !== undefined) {
    const team = options.team;
    await eventually(async () => (await accessOf(uid)).teamReplicationIds.includes(team), "the team of the member");
  }
  return caller;
}

interface Block {
  readonly id: string;
  readonly text: string;
  readonly mention?: { readonly uid: string; readonly label: string };
}

/** A Yjs update that adds blocks to a page, in the layout of the editor. */
function blocksUpdate(blocks: readonly Block[], base?: Y.Doc): Uint8Array {
  const doc = base ?? new Y.Doc();
  const before = Y.encodeStateVector(doc);
  doc.transact(() => {
    const fragment = doc.getXmlFragment(PAGE_FRAGMENT_NAME);
    let group = fragment.get(0) as Y.XmlElement | undefined;
    if (group === undefined) {
      group = new Y.XmlElement("blockGroup");
      fragment.insert(0, [group]);
    }
    for (const block of blocks) {
      const container = new Y.XmlElement("blockContainer");
      container.setAttribute("id", block.id);
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      text.insert(0, block.text);
      const children: (Y.XmlText | Y.XmlElement)[] = [text];
      if (block.mention !== undefined) {
        const mention = new Y.XmlElement("mention");
        mention.setAttribute("userId", block.mention.uid);
        mention.setAttribute("label", block.mention.label);
        children.push(mention);
      }
      paragraph.insert(0, children);
      container.insert(0, [paragraph]);
      group.push([container]);
    }
  });
  return Y.encodeStateAsUpdate(doc, before);
}

let updates = 0;

/** Appends an update to a page as an editor's client would, which starts the trigger. */
async function appendUpdate(pageId: string, uid: string, update: Uint8Array): Promise<void> {
  updates += 1;
  const id = `upd${String(updates).padStart(5, "0")}${"x".repeat(12)}`;
  await adminDb.doc(COLLECTIONS.pageUpdates.docPath(pageId, id)).set({
    schemaVersion: 1,
    createdAt: Timestamp.now(),
    createdBy: uid,
    writeContext: userWriteContext(),
    pageId,
    updateId: id,
    index: 0,
    count: 1,
    update: Buffer.from(update),
    uid,
    clientId: 1,
  });
}

describe("creating pages", () => {
  it("puts a page of a member at the top of the workspace, with full access for its creator and an audit entry", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const { pageId } = await call(ada, createPageContract, { parentPageId: null, title: "Meeting notes", icon: "🗒" });
    const page = await pageOf(pageId);
    expect(page).toMatchObject({ kind: "custom", parentPageId: null, ancestorPageIds: [], accessMode: "inherit" });
    expect(page.levelKeys.full).toEqual(["user:uid-ada"]);
    expect(page.levelKeys.edit).toContain("members");
    expect(await auditOf("page.created", pageId)).toHaveLength(1);

    const outsider = await account("uid-no-member");
    expect(await codeOf(call(outsider, createPageContract, { parentPageId: null, title: "Nope" }))).toBe(
      "permission-denied",
    );
  });

  it("nests a page beneath one the caller edits, which it inherits, and places it after its siblings", async () => {
    await replication(STUDY);
    const team = await member("uid-team", "Tess Team", { team: STUDY });
    const bystander = await member("uid-bystander", "Bea Bystander");
    const { pageId: notes } = await call(team, openEntityPageContract, { entityType: "replication", entityId: STUDY });
    const first = await call(team, createPageContract, { parentPageId: notes, title: "Analysis plan" });
    const second = await call(team, createPageContract, { parentPageId: notes, title: "Pilot data" });
    const [one, two] = [await pageOf(first.pageId), await pageOf(second.pageId)];
    expect(one.ancestorPageIds).toEqual([notes]);
    expect(one.levelKeys).toEqual((await pageOf(notes)).levelKeys);
    expect(one.order < two.order).toBe(true);
    // Every member may comment on the notes of a replication, and only its team may edit them.
    expect(await codeOf(call(bystander, createPageContract, { parentPageId: notes, title: "Hijack" }))).toBe(
      "permission-denied",
    );
  });

  it("copies the content of a template, and records its mentions so nobody is told of them again", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const ben = await member("uid-ben", "Ben Sample");
    const { pageId: template } = await call(ada, createPageContract, { parentPageId: null, title: "Minutes template" });
    await adminDb.doc(COLLECTIONS.pages.docPath(template)).update({ isTemplate: true });
    await appendUpdate(
      template,
      ada.uid,
      blocksUpdate([{ id: "b1", text: "Chair: ", mention: { uid: ben.uid, label: "Ben Sample" } }]),
    );
    await eventually(async () => (await pageOf(template)).mentionUids.includes(ben.uid), "the mention of the template");
    const { pageId } = await call(ben, createPageContract, {
      parentPageId: null,
      title: "Minutes, 3 March",
      templatePageId: template,
    });
    const page = await pageOf(pageId);
    expect(page.templateSourceId).toBe(template);
    expect(page.mentionUids).toEqual([ben.uid]);
    expect(page.contentHead?.generation).toBe(0);
    const chunks = await adminDb.collection(COLLECTIONS.pageContent.collectionPath(pageId)).get();
    expect(chunks.size).toBe(page.contentHead?.chunkCount);
    expect(
      await codeOf(call(ben, createPageContract, { parentPageId: null, title: "x", templatePageId: pageId })),
    ).toBe("not-found");
  });
});

describe("the notes of a record", () => {
  it("are created once, with the audience of the record, and follow the account that claims a person", async () => {
    await replication(STUDY);
    const ada = await member("uid-ada", "Ada Example");
    const first = await call(ada, openEntityPageContract, { entityType: "replication", entityId: STUDY });
    const again = await call(ada, openEntityPageContract, { entityType: "replication", entityId: STUDY });
    expect(first).toEqual({ pageId: entityRefId("replication", STUDY), created: true });
    expect(again).toEqual({ pageId: first.pageId, created: false });
    expect(await codeOf(call(ada, openEntityPageContract, { entityType: "replication", entityId: "Nope2000" }))).toBe(
      "not-found",
    );

    await person("person-unclaimed", [], { displayName: "Una Claimed" });
    const { pageId } = await call(ada, openEntityPageContract, { entityType: "person", entityId: "person-unclaimed" });
    expect((await pageOf(pageId)).levelKeys.edit).toEqual([]);
    await adminDb.doc(COLLECTIONS.persons.docPath("person-unclaimed")).update({ userId: "uid-una" });
    await call(ada, openEntityPageContract, { entityType: "person", entityId: "person-unclaimed" });
    expect((await pageOf(pageId)).levelKeys.full).toEqual(["user:uid-una"]);
  });
});

describe("moving and sharing pages", () => {
  it("moves a page with everything beneath it, which takes the audience of its new place", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const a = await call(ada, createPageContract, { parentPageId: null, title: "A" });
    const b = await call(ada, createPageContract, { parentPageId: a.pageId, title: "B" });
    const c = await call(ada, createPageContract, { parentPageId: b.pageId, title: "C" });
    const d = await call(ada, createPageContract, { parentPageId: null, title: "D" });
    await call(ada, setPageSharingContract, { pageId: d.pageId, accessMode: "restricted", permissions: [] });
    await call(ada, movePageContract, { pageId: b.pageId, parentPageId: d.pageId, order: "m" });
    const [moved, beneath] = [await pageOf(b.pageId), await pageOf(c.pageId)];
    expect(moved.ancestorPageIds).toEqual([d.pageId]);
    expect(beneath.ancestorPageIds).toEqual([d.pageId, b.pageId]);
    expect(beneath.scopeKeys).toEqual(["user:uid-ada"]);
    expect(await codeOf(call(ada, movePageContract, { pageId: d.pageId, parentPageId: c.pageId, order: "m" }))).toBe(
      "invalid-argument",
    );
    expect(await auditOf("page.moved", b.pageId)).toHaveLength(1);
  });

  it("restricts a page to its principals, keeps its sharer at full access, and lets it inherit again", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const ben = await member("uid-ben", "Ben Sample");
    const cid = await member("uid-cid", "Cid Other");
    await adminDb.doc(COLLECTIONS.groups.docPath("analysts")).set({
      ...standard(),
      groupKey: "analysts",
      kind: "custom",
      name: "Analysts",
      replicationId: null,
      laboratoryId: null,
      pageId: null,
      memberUids: [],
      roles: {},
      unclaimedPersonIds: [],
    });
    const { pageId } = await call(ada, createPageContract, { parentPageId: null, title: "Confidential" });
    const child = await call(ada, createPageContract, { parentPageId: pageId, title: "Beneath" });
    expect(await codeOf(call(ben, setPageSharingContract, { pageId, accessMode: "restricted", permissions: [] }))).toBe(
      "permission-denied",
    );
    await call(ada, setPageSharingContract, {
      pageId,
      accessMode: "restricted",
      permissions: [
        { principalType: "user", principalId: ben.uid, level: "comment" },
        { principalType: "group", principalId: "analysts", level: "edit" },
      ],
    });
    const page = await pageOf(pageId);
    expect(page.accessMode).toBe("restricted");
    expect(page.scopeKeys).toEqual(["group:analysts", "user:uid-ada", "user:uid-ben"]);
    expect((await pageOf(child.pageId)).scopeKeys).toEqual(page.scopeKeys);
    expect(pageLevelFor(await accessOf(ben.uid), { secondFactorVerified: false }, page)).toBe("comment");
    expect(pageLevelFor(await accessOf(cid.uid), { secondFactorVerified: false }, page)).toBe("none");
    const sharing = await call(ada, getPageSharingContract, { pageId });
    expect(sharing.permissions.map((entry) => [entry.principalId, entry.level, entry.name]).sort()).toEqual([
      ["analysts", "edit", "Analysts"],
      ["uid-ada", "full", "Ada Example"],
      ["uid-ben", "comment", "Ben Sample"],
    ]);
    expect(sharing.groups).toEqual([{ groupKey: "analysts", name: "Analysts" }]);
    expect(
      await codeOf(
        call(ada, setPageSharingContract, {
          pageId,
          accessMode: "restricted",
          permissions: [{ principalType: "group", principalId: "no-such-group", level: "view" }],
        }),
      ),
    ).toBe("invalid-argument");

    await call(ada, setPageSharingContract, { pageId, accessMode: "inherit", permissions: [] });
    expect((await pageOf(pageId)).scopeKeys).toContain("members");
    expect((await adminDb.collection(COLLECTIONS.pagePermissions.collectionPath(pageId)).get()).size).toBe(0);
    expect(await auditOf("page.sharingChanged", pageId)).toHaveLength(2);
  });
});

describe("versions", () => {
  it("saves the stored content by name, skips an automatic version when nothing changed, and names a restored one", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const reader = await member("uid-reader", "Rea Der");
    const { pageId } = await call(ada, createPageContract, { parentPageId: null, title: "Protocol" });
    await call(ada, setPageSharingContract, {
      pageId,
      accessMode: "restricted",
      permissions: [{ principalType: "user", principalId: reader.uid, level: "view" }],
    });
    expect(await call(ada, savePageVersionContract, { pageId, kind: "auto" })).toEqual({ versionId: null });
    await appendUpdate(pageId, ada.uid, blocksUpdate([{ id: "b1", text: "Version one" }]));
    const named = await call(ada, savePageVersionContract, { pageId, kind: "manual", label: "Before review" });
    expect(named.versionId).not.toBeNull();
    expect(await call(ada, savePageVersionContract, { pageId, kind: "auto" })).toEqual({ versionId: null });
    const versionId = named.versionId ?? "";
    const stored = (await adminDb.doc(COLLECTIONS.pageVersions.docPath(pageId, versionId)).get()).data();
    expect(stored).toMatchObject({ label: "Before review", kind: "manual", chunkCount: 1, createdBy: ada.uid });
    const chunk = (await adminDb.doc(COLLECTIONS.pageVersionChunks.docPath(pageId, versionId, "000000")).get()).get(
      "snapshot",
    ) as Uint8Array;
    const restored = new Y.Doc();
    Y.applyUpdate(restored, chunk);
    expect(restored.getXmlFragment(PAGE_FRAGMENT_NAME).toString()).toContain("Version one");
    expect(await codeOf(call(reader, savePageVersionContract, { pageId, kind: "manual" }))).toBe("permission-denied");
    expect(
      await codeOf(call(ada, savePageVersionContract, { pageId, kind: "restore", restoredFromVersionId: "nope" })),
    ).toBe("invalid-argument");
    const restore = await call(ada, savePageVersionContract, {
      pageId,
      kind: "restore",
      restoredFromVersionId: versionId,
    });
    expect(restore.versionId).not.toBeNull();
    expect(await auditOf("page.versionSaved", pageId)).toHaveLength(2);
  });
});

describe("the trigger of an editor's update", () => {
  it("notifies a newly mentioned reader once, with the author and the time, and never the author or a stranger", async () => {
    await replication(STUDY);
    const team = await member("uid-team", "Tess Team", { team: STUDY });
    const ben = await member("uid-ben", "Ben Sample");
    const { pageId } = await call(team, createPageContract, { parentPageId: null, title: "Restricted plan" });
    await call(team, setPageSharingContract, {
      pageId,
      accessMode: "restricted",
      permissions: [{ principalType: "user", principalId: ben.uid, level: "view" }],
    });
    const stranger = await member("uid-stranger", "Stan Stranger");
    const doc = new Y.Doc();
    await appendUpdate(
      pageId,
      team.uid,
      blocksUpdate(
        [
          { id: "b1", text: "Ask ", mention: { uid: ben.uid, label: "Ben Sample" } },
          { id: "b2", text: "and ", mention: { uid: stranger.uid, label: "Stan Stranger" } },
          { id: "b3", text: "me ", mention: { uid: team.uid, label: "Tess Team" } },
        ],
        doc,
      ),
    );
    const [notification] = await eventually(async () => {
      const found = await notificationsOf(ben.uid);
      return found.length > 0 ? found : null;
    }, "the notification of the mention");
    expect(notification).toMatchObject({
      type: "mention",
      entityType: "page",
      entityId: pageId,
      payload: { kind: "pageMention", pageId, title: "Restricted plan", authorUid: team.uid, authorName: "Tess Team" },
    });
    expect(notification?.createdAt).toBeInstanceOf(Timestamp);
    // A later edit that keeps the mention tells nobody again.
    await appendUpdate(pageId, team.uid, blocksUpdate([{ id: "b4", text: "More text" }], doc));
    await eventually(async () => (await pageOf(pageId)).mentionUids.length === 3, "the mentions of the page");
    await settle();
    expect(await notificationsOf(ben.uid)).toHaveLength(1);
    expect(await notificationsOf(stranger.uid)).toHaveLength(0);
    expect(await notificationsOf(team.uid)).toHaveLength(0);
  });

  it("indexes the text of the page for its readers alone, and records one spell of editing without the content", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const ben = await member("uid-ben", "Ben Sample");
    const { pageId } = await call(ada, createPageContract, { parentPageId: null, title: "Impedance checks" });
    await appendUpdate(pageId, ada.uid, blocksUpdate([{ id: "b1", text: "Electrode montage agreed" }]));
    await appendUpdate(pageId, ada.uid, blocksUpdate([{ id: "b2", text: "Second paragraph" }]));
    await eventually(
      async () =>
        (
          (await adminDb.doc(COLLECTIONS.searchIndex.docPath(searchIndexId("page", pageId, 0))).get()).get("tokens") as
            | string[]
            | undefined
        )?.includes("montage"),
      "the index entry of the page",
    );
    expect((await call(ben, searchWorkspaceContract, { query: "electrode mont" })).results).toEqual([
      { entityType: "page", entityId: pageId, title: "Impedance checks", kind: "custom" },
    ]);
    expect((await call(ben, searchWorkspaceContract, { query: "electrode banana" })).results).toEqual([]);

    await call(ada, setPageSharingContract, { pageId, accessMode: "restricted", permissions: [] });
    await eventually(
      async () =>
        (
          (await adminDb.doc(COLLECTIONS.searchIndex.docPath(searchIndexId("page", pageId, 0))).get()).get(
            "scopeKeys",
          ) as string[] | undefined
        )?.join() === "user:uid-ada",
      "the index entry to follow the audience",
    );
    expect((await call(ben, searchWorkspaceContract, { query: "electrode" })).results).toEqual([]);
    expect((await call(ada, searchWorkspaceContract, { query: "electrode" })).results).toHaveLength(1);

    await settle();
    const activity = await adminDb
      .collection(COLLECTIONS.activity.collectionPath())
      .where("entityId", "==", pageId)
      .get();
    expect(activity.docs.map((entry) => entry.data())).toEqual([
      expect.objectContaining({ actorUid: ada.uid, action: "page.edited", changedFields: ["content"] }),
    ]);
    expect(activity.docs[0]?.data()).not.toHaveProperty("title");

    await adminDb.doc(COLLECTIONS.pages.docPath(pageId)).update({ archivedAt: Timestamp.now() });
    await eventually(
      async () => !(await adminDb.doc(COLLECTIONS.searchIndex.docPath(searchIndexId("page", pageId, 0))).get()).exists,
      "the index entry of the archived page to go",
    );
  });
});

describe("the trigger of a comment", () => {
  it("notifies the members it mentions and those who took part in the thread, who may read the page", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const ben = await member("uid-ben", "Ben Sample");
    const cid = await member("uid-cid", "Cid Other");
    const { pageId } = await call(ada, createPageContract, { parentPageId: null, title: "Discussion" });
    const page = await pageOf(pageId);
    const scope = { replicationId: page.replicationId, laboratoryId: page.laboratoryId, scopeKeys: page.scopeKeys };
    const thread = adminDb.collection(COLLECTIONS.threads.collectionPath()).doc();
    await thread.set({
      ...standard(),
      targetType: "page",
      targetId: pageId,
      restricted: false,
      ...scope,
      resolvedAt: null,
      resolvedBy: null,
    });
    const comment = (authorUid: string, body: string) =>
      thread
        .collection("comments")
        .doc()
        .set({
          ...standard(),
          threadId: thread.id,
          authorUid,
          body,
          mentionUids: [],
          editedAt: null,
          deletedAt: null,
          ...scope,
        });
    await comment(ben.uid, "A first remark.");
    await comment(ada.uid, `Agreed, ${commentMention(cid.uid, "Cid Other")} please check.`);
    await eventually(async () => (await notificationsOf(cid.uid)).length > 0, "the mention in the comment");
    await eventually(async () => (await notificationsOf(ben.uid)).length > 0, "the reply to the thread");
    expect((await notificationsOf(cid.uid))[0]).toMatchObject({
      type: "mention",
      payload: { kind: "commentMention", pageId, threadId: thread.id, authorName: "Ada Example" },
    });
    expect((await notificationsOf(ben.uid))[0]).toMatchObject({ type: "comment", payload: { kind: "commentReply" } });
    await settle();
    expect(await notificationsOf(ada.uid)).toHaveLength(0);
  });
});
