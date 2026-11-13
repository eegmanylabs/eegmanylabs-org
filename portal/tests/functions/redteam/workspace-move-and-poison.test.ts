// Red-team attacks on the workspace functions (D-010), made through the functions emulator as
// members who hold the level edit on a page and try to stretch it:
//
// - an editor of a restricted page, who may not share it, moves a page beneath it to a page that
//   every member reads, which publishes it;
// - a member moves a page of the programme's workspace, which every member may edit, beneath a
//   page restricted to themselves, which takes it from everyone else, its creator included;
// - an editor appends an update that is no Yjs update at all, which the rules accept, and from
//   then on the page's mentions, search entries and versions stop working.
//
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain.
import {
  COLLECTIONS,
  createPageContract,
  movePageContract,
  PAGE_FRAGMENT_NAME,
  pageDocSchema,
  savePageVersionContract,
  setPageSharingContract,
  userWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { adminDb } from "../../support/admin";
import {
  account,
  type Caller,
  call,
  codeOf,
  eventually,
  notificationsOf,
  person,
  resetWorld,
  settle,
  withTriggers,
} from "../support";

withTriggers();
beforeEach(resetWorld);

async function member(uid: string, name: string): Promise<Caller> {
  const personId = `person-${uid}`;
  await person(personId, [], { displayName: name, userId: uid });
  return account(uid, { personId });
}

async function scopeKeysOf(pageId: string): Promise<string[]> {
  return pageDocSchema.parse((await adminDb.doc(COLLECTIONS.pages.docPath(pageId)).get()).data()).scopeKeys;
}

let updates = 0;

/** An update as the rules accept it from an editor's client: any bytes, in the editor's name. */
async function appendUpdate(pageId: string, uid: string, update: Uint8Array): Promise<void> {
  updates += 1;
  const id = `redteam${String(updates).padStart(5, "0")}${"y".repeat(8)}`;
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
    clientId: updates,
  });
}

/** A Yjs update with one paragraph that mentions a member, in the layout of the editor. */
function mentionUpdate(uid: string, label: string): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const group = new Y.XmlElement("blockGroup");
    doc.getXmlFragment(PAGE_FRAGMENT_NAME).insert(0, [group]);
    const container = new Y.XmlElement("blockContainer");
    container.setAttribute("id", "redteam-block");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "Synthetic agenda for ");
    const mention = new Y.XmlElement("mention");
    mention.setAttribute("userId", uid);
    mention.setAttribute("label", label);
    paragraph.insert(0, [text, mention]);
    container.insert(0, [paragraph]);
    group.push([container]);
  });
  return Y.encodeStateAsUpdate(doc);
}

describe("moving a page", () => {
  it("does not let an editor who may not share a page publish what lies beneath it", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const ben = await member("uid-ben", "Ben Example");
    const { pageId: board } = await call(ada, createPageContract, { parentPageId: null, title: "Synthetic board" });
    await call(ada, setPageSharingContract, {
      pageId: board,
      accessMode: "restricted",
      permissions: [{ principalType: "user", principalId: ben.uid, level: "edit" }],
    });
    const { pageId: minutes } = await call(ada, createPageContract, {
      parentPageId: board,
      title: "Synthetic confidential minutes",
    });
    const { pageId: open } = await call(ben, createPageContract, { parentPageId: null, title: "Synthetic open page" });

    // Ben may not share the minutes himself.
    expect(
      await codeOf(call(ben, setPageSharingContract, { pageId: minutes, accessMode: "inherit", permissions: [] })),
    ).toBe("permission-denied");
    // Moving them beneath a page every member reads must be refused as well.
    const move = await codeOf(call(ben, movePageContract, { pageId: minutes, parentPageId: open, order: "m" }));
    expect({ move, readers: await scopeKeysOf(minutes) }).toEqual({
      move: "permission-denied",
      readers: ["user:uid-ada", "user:uid-ben"],
    });
  });

  it("does not let a member take a page of the workspace from everyone else", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const mallory = await member("uid-mallory", "Mallory Example");
    const { pageId: shared } = await call(ada, createPageContract, { parentPageId: null, title: "Synthetic handbook" });
    const { pageId: hideout } = await call(mallory, createPageContract, {
      parentPageId: null,
      title: "Synthetic private page",
    });
    await call(mallory, setPageSharingContract, { pageId: hideout, accessMode: "restricted", permissions: [] });

    const move = await codeOf(call(mallory, movePageContract, { pageId: shared, parentPageId: hideout, order: "m" }));
    expect({ move, readers: await scopeKeysOf(shared) }).toEqual({
      move: "permission-denied",
      readers: ["members", "user:uid-ada"],
    });
  });
});

describe("an update that is no Yjs update", () => {
  it("does not stop the mentions, the search entries and the versions of the page", async () => {
    const ada = await member("uid-ada", "Ada Example");
    const ben = await member("uid-ben", "Ben Example");
    const mallory = await member("uid-mallory", "Mallory Example");
    const { pageId } = await call(ada, createPageContract, { parentPageId: null, title: "Synthetic agenda" });

    // Every member edits a page of the workspace, and the rules accept any bytes as an update.
    await appendUpdate(pageId, mallory.uid, new Uint8Array([1, 2, 3]));
    await settle();
    await appendUpdate(pageId, ada.uid, mentionUpdate(ben.uid, "Ben Example"));

    const mentioned = await eventually(
      async () => (await notificationsOf(ben.uid)).some((notification) => notification.type === "mention"),
      "the mention of Ben",
      15_000,
    ).then(
      () => true,
      () => false,
    );
    const version = await codeOf(call(ada, savePageVersionContract, { pageId, kind: "manual", label: "Synthetic" }));
    expect({ mentioned, version }).toEqual({ mentioned: true, version: "(no error)" });
  }, 120_000);
});
