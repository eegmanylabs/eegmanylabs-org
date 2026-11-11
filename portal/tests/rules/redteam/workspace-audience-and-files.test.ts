// Red-team attacks on the rules of the workspace (D-010), made through the client SDK as callers
// who hold some right on a page and try to stretch it:
//
// - a commenter of a page that has just been restricted writes a comment that copies the audience
//   its thread still carries, so the comment stays readable by everyone the page has shut out;
// - the author of a comment on a page they may no longer read edits it and adds mentions;
// - a reader of a restricted database shares a view of it, and every member then reads the view:
//   which database it shows, its name, and the values its filters compare against;
// - an editor of a page uploads a file of a type that a browser runs as a document (HTML, SVG),
//   which the editor then opens as a `blob:` address of the portal's own origin.
//
// The window that the first two use is the time between a change of sharing and the trigger that
// rewrites the copies of the audience (functions/src/triggers/pages.ts). The rules suite runs
// without the functions emulator, so that window stays open here for as long as the test needs.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { MEMBERS_SCOPE_KEY, pageFilePath, userScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, type Firestore, setDoc } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_ID, STORAGE_URL } from "../../support/emulators";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld, trusted } from "../seed";
import { createRulesEnvironment } from "../support";
import { autoId, CALLERS, createdBy, MEMBER_UID, OWN_REPLICATION, storageOf, stored, uidOfCaller } from "../world";

let environment: RulesTestEnvironment;
const { get, create, update } = requestsOf(() => environment);

/** A page that its creator has just restricted to the account `ownTeam`, at the level comment. */
const PAGE_ID = "redteam-restricted-page";
const COMMENTER = uidOfCaller("ownTeam");
const OUTSIDER = "otherLabMember";
const OUTSIDER_UID = uidOfCaller(OUTSIDER);
const RESTRICTED_AUDIENCE = { replicationId: null, laboratoryId: null, scopeKeys: [userScopeKey(COMMENTER)] };
/** The audience the page had before it was restricted, which its thread and comments still copy. */
const STALE_AUDIENCE = { replicationId: null, laboratoryId: null, scopeKeys: [MEMBERS_SCOPE_KEY] };

const THREAD_ID = autoId("redteam stale thread");
const OUTSIDER_COMMENT = `threads/${THREAD_ID}/comments/${autoId("redteam outsider comment")}`;

async function resetStorage(): Promise<void> {
  const response = await fetch(`${STORAGE_URL}/internal/reset`, { method: "POST" });
  if (!response.ok) throw new Error(`Could not reset the Storage emulator: ${response.status}`);
}

beforeAll(async () => {
  await resetStorage();
  environment = await createRulesEnvironment(PROJECT_ID);
});

afterAll(async () => {
  await resetStorage();
  await environment.clearFirestore();
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await trusted(environment, async (db: Firestore) => {
    await setDoc(doc(db, `pages/${PAGE_ID}`), {
      ...stored(),
      parentPageId: null,
      ancestorPageIds: [],
      kind: "custom",
      title: "Synthetic restricted notes",
      order: "i",
      isTemplate: false,
      accessMode: "restricted",
      ...RESTRICTED_AUDIENCE,
      levelKeys: { comment: [userScopeKey(COMMENTER)], edit: [], full: [] },
      contentHead: null,
      mentionUids: [],
      tagIds: [],
      lastEditedBy: null,
    });
    // The thread was opened while every member could read the page, and the trigger has not yet
    // rewritten its copy of the audience.
    await setDoc(doc(db, `threads/${THREAD_ID}`), {
      ...stored(),
      targetType: "page",
      targetId: PAGE_ID,
      restricted: false,
      ...STALE_AUDIENCE,
      resolvedAt: null,
      resolvedBy: null,
    });
    // A comment that the outsider wrote back then, which the trigger has already rewritten.
    await setDoc(doc(db, OUTSIDER_COMMENT), {
      ...stored(),
      threadId: THREAD_ID,
      authorUid: OUTSIDER_UID,
      body: "A synthetic remark from before the page was restricted.",
      mentionUids: [],
      editedAt: null,
      deletedAt: null,
      ...RESTRICTED_AUDIENCE,
    });
  });
});

describe("a comment on a page whose audience has just narrowed", () => {
  it("takes the audience of the page, not the stale copy on its thread", async () => {
    const path = `threads/${THREAD_ID}/comments/${autoId("redteam leaked comment")}`;
    await expectOutcomes({
      "the commenter writes a comment that copies the stale audience of the thread": [
        "denied",
        create("ownTeam", path, {
          threadId: THREAD_ID,
          authorUid: COMMENTER,
          body: "Synthetic text meant only for the principals of the page.",
          mentionUids: [],
          editedAt: null,
          deletedAt: null,
          ...STALE_AUDIENCE,
        }),
      ],
      "the commenter writes a comment with the audience of the page": [
        "allowed",
        create("ownTeam", `threads/${THREAD_ID}/comments/${autoId("redteam honest comment")}`, {
          threadId: THREAD_ID,
          authorUid: COMMENTER,
          body: "Synthetic text for the principals of the page.",
          mentionUids: [],
          editedAt: null,
          deletedAt: null,
          ...RESTRICTED_AUDIENCE,
        }),
      ],
    });
  });

  it("is not readable by a member the page has shut out", async () => {
    const path = `threads/${THREAD_ID}/comments/${autoId("redteam planted comment")}`;
    await trusted(environment, async (db) => {
      // What the create above leaves behind when the rules accept it.
      await setDoc(doc(db, path), {
        ...stored(),
        threadId: THREAD_ID,
        authorUid: COMMENTER,
        body: "Synthetic text meant only for the principals of the page.",
        mentionUids: [],
        editedAt: null,
        deletedAt: null,
        ...STALE_AUDIENCE,
      });
    });
    await expectOutcomes({
      "a member outside the page reads the comment": ["denied", get(OUTSIDER, path)],
      "a member outside the page reads the thread with its quote": ["denied", get(OUTSIDER, `threads/${THREAD_ID}`)],
    });
  });
});

describe("the author of a comment on a page they may no longer read", () => {
  it("cannot rewrite the comment or mention anyone in it", async () => {
    await expectOutcomes({
      "the former reader rewrites the body and mentions a principal": [
        "denied",
        update(OUTSIDER, OUTSIDER_COMMENT, {
          body: "Synthetic text written after access ended.",
          mentionUids: [COMMENTER],
          editedAt: createdBy(OUTSIDER_UID).createdAt,
        }),
      ],
    });
  });
});

describe("a shared view of a restricted database", () => {
  it("is read only by those who read the database", async () => {
    const databaseId = autoId("redteam restricted database");
    const viewPath = `views/${autoId("redteam shared view")}`;
    await trusted(environment, async (db) => {
      await setDoc(doc(db, `databases/${databaseId}`), {
        ...stored(),
        name: "Synthetic adverse events",
        parentPageId: PAGE_ID,
        isTemplate: false,
        properties: {},
        ...RESTRICTED_AUDIENCE,
        levelKeys: { comment: [userScopeKey(COMMENTER)], edit: [], full: [] },
      });
      // What saveView writes for a principal of the page who ticks "shared": saveView checks
      // that the caller reads the database and nothing about who will read the view.
      await setDoc(doc(db, viewPath), {
        ...stored(),
        collectionKey: `db:${databaseId}`,
        name: "Synthetic withdrawals at site 3",
        type: "table",
        config: {
          filter: { property: "reason", operator: "is", value: "Synthetic withdrawal reason" },
        },
        ownerUid: COMMENTER,
        isShared: true,
        pageId: PAGE_ID,
        order: "i",
      });
    });
    await expectOutcomes({
      "a principal of the page reads the database": ["allowed", get("ownTeam", `databases/${databaseId}`)],
      "a member outside the page reads the database": ["denied", get(OUTSIDER, `databases/${databaseId}`)],
      "a member outside the page reads the shared view of it": ["denied", get(OUTSIDER, viewPath)],
    });
  });
});

describe("the files of a page", () => {
  it("are refused in a type that a browser runs as a document", async () => {
    const storage = storageOf(environment, CALLERS.ownTeam);
    const page = `pages/${PAGE_ID}`;
    // The commenter is no editor of the restricted page, so the editors' page of the world serves.
    await trusted(environment, async (db) => {
      await setDoc(doc(db, page), {
        ...stored(),
        parentPageId: null,
        ancestorPageIds: [],
        kind: "custom",
        title: "Synthetic notes",
        order: "i",
        isTemplate: false,
        accessMode: "restricted",
        replicationId: OWN_REPLICATION,
        laboratoryId: null,
        scopeKeys: [userScopeKey(COMMENTER), userScopeKey(MEMBER_UID)],
        levelKeys: { comment: [userScopeKey(COMMENTER)], edit: [userScopeKey(COMMENTER)], full: [] },
        contentHead: null,
        mentionUids: [],
        tagIds: [],
        lastEditedBy: null,
      });
    });
    const script = new TextEncoder().encode("<!doctype html><script src=/portal/assets/x.js></script>");
    const outcomes: Record<string, string> = {};
    for (const [label, contentType, name] of [
      ["an HTML document", "text/html", "synthetic-report.html"],
      ["an SVG image with a script", "image/svg+xml", "synthetic-figure.svg"],
      ["an XHTML document", "application/xhtml+xml", "synthetic-report.xhtml"],
    ] as const) {
      try {
        await uploadBytes(ref(storage, pageFilePath(PAGE_ID, autoId(`redteam ${label}`), name)), script, {
          contentType,
          customMetadata: { uploadedBy: COMMENTER },
        });
        outcomes[label] = "stored";
      } catch {
        outcomes[label] = "refused";
      }
    }
    expect(outcomes).toEqual({
      "an HTML document": "refused",
      "an SVG image with a script": "refused",
      "an XHTML document": "refused",
    });
  });
});
