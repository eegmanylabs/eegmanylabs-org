// The rules of the workspace (D-010), beside the registry-driven matrix: what each level of a
// page allows, how an update and the content of a page are written and removed, and how a thread
// and its comments copy the audience of their page. These are the rules that the editor spike
// verified, carried into the portal: a viewer reads only, a commenter writes comments only, an
// editor appends updates, an update is never changed, and an update is removed only by the
// compaction that merged it. Each refusal stands beside the honest request that is accepted.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  entityRefId,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  pageContentChunkId,
  pagePermissionId,
  replicationScopeKey,
  userScopeKey,
  userWriteContext,
} from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Bytes, doc, limit, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  autoId,
  CALLERS,
  type CallerKind,
  createdBy,
  firestoreOf,
  MEMBER_UID,
  OWN_LABORATORY,
  OWN_REPLICATION,
  OWNER_UID,
  STORED_AT,
  stored,
  uidOfCaller,
  updatedBy,
} from "./world";

let environment: RulesTestEnvironment;
const { get, list, create, createAt, update, remove } = requestsOf(() => environment);

/** The page of the world: the body of the owning replication (see fixtures.ts). */
const PAGE_ID = entityRefId("replication", OWN_REPLICATION);
const PAGE = `pages/${PAGE_ID}`;
const PAGE_SCOPE = [laboratoryScopeKey(OWN_LABORATORY), MEMBERS_SCOPE_KEY, replicationScopeKey(OWN_REPLICATION)];
const SCOPE_FIELDS = { replicationId: OWN_REPLICATION, laboratoryId: OWN_LABORATORY, scopeKeys: PAGE_SCOPE };
const STORED_UPDATE = `${PAGE}/updates/${autoId("stored update")}`;
const STORED_THREAD = autoId("stored thread");
const STORED_COMMENT = `threads/${STORED_THREAD}/comments/${autoId("stored comment")}`;
const chunkPath = (generation: number, index = 0, pageId = PAGE_ID) =>
  `pages/${pageId}/content/${pageContentChunkId(generation, index)}`;

/** A restricted page in the same replication, open to the account `member` alone, at the level `view`. */
const RESTRICTED_ID = "restricted-page-1";
const RESTRICTED = `pages/${RESTRICTED_ID}`;

const bytes = () => Bytes.fromUint8Array(new Uint8Array([1, 2, 3]));
const dbOf = (caller: CallerKind) => firestoreOf(environment, CALLERS[caller]);

/** A well-formed update of the page, as an editor's client writes it. */
const newUpdate = (uid: string, fields: Record<string, unknown> = {}) => ({
  pageId: PAGE_ID,
  updateId: "updatepart",
  index: 0,
  count: 1,
  update: bytes(),
  uid,
  clientId: 42,
  ...fields,
});

/** The head of the content that a compaction writes, at the request time unless told otherwise. */
const head = (generation: number, fields: Record<string, unknown> = {}) => ({
  generation,
  chunkCount: 1,
  byteLength: 3,
  stateVector: bytes(),
  compactedAt: serverTimestamp(),
  ...fields,
});

/** A compaction: the page moves to a generation and the stored update is removed, in one commit. */
const compaction =
  (
    caller: Exclude<CallerKind, "signedOut">,
    contentHead: Record<string, unknown>,
    pageFields: Record<string, unknown> = {},
  ) =>
  () => {
    const db = dbOf(caller);
    const batch = writeBatch(db);
    batch.delete(doc(db, STORED_UPDATE));
    batch.update(doc(db, PAGE), { contentHead, ...pageFields, ...updatedBy(uidOfCaller(caller)) });
    return batch.commit();
  };

/** A thread on the page with its first comment, in one commit, as the comment panel writes them. */
const threadWithComment =
  (caller: Exclude<CallerKind, "signedOut">, threadFields: Record<string, unknown> = {}, author?: string) =>
  () => {
    const db = dbOf(caller);
    const uid = uidOfCaller(caller);
    const threadId = autoId(`thread of ${caller}`);
    const batch = writeBatch(db);
    batch.set(doc(db, `threads/${threadId}`), {
      targetType: "page",
      targetId: PAGE_ID,
      anchor: { blockId: "block-9", from: '{"item":null}', to: '{"item":null}', quote: "the electrode montage" },
      restricted: false,
      ...SCOPE_FIELDS,
      resolvedAt: null,
      resolvedBy: null,
      ...threadFields,
      ...createdBy(uid),
    });
    batch.set(doc(db, `threads/${threadId}/comments/${autoId(`comment of ${caller}`)}`), {
      threadId,
      authorUid: author ?? uid,
      body: "Is this the montage of the original study?",
      mentionUids: [],
      editedAt: null,
      deletedAt: null,
      ...SCOPE_FIELDS,
      ...createdBy(uid),
    });
    return batch.commit();
  };

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-workspace");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await trusted(environment, async (db) => {
    const { setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, RESTRICTED), {
      ...stored(),
      parentPageId: null,
      ancestorPageIds: [],
      kind: "custom",
      title: "Restricted synthetic notes",
      order: "i",
      isTemplate: false,
      accessMode: "restricted",
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [userScopeKey(MEMBER_UID)],
      levelKeys: { comment: [], edit: [], full: [] },
      contentHead: null,
      mentionUids: [],
      tagIds: [],
      lastEditedBy: null,
    });
    await setDoc(doc(db, chunkPath(0, 0, RESTRICTED_ID)), {
      schemaVersion: 1,
      createdAt: STORED_AT,
      createdBy: "system:test",
      writeContext: userWriteContext(),
      pageId: RESTRICTED_ID,
      generation: 0,
      index: 0,
      snapshot: bytes(),
    });
  });
});

describe("the levels of a page", () => {
  it("let a viewer read the page and what lies beneath it, and write none of it", async () => {
    await expectOutcomes({
      "reads the page": ["allowed", get("member", PAGE)],
      "reads the chunk that the page names": ["allowed", get("member", chunkPath(1))],
      "lists the updates": ["allowed", list("member", `${PAGE}/updates`, limit(50))],
      "lists the versions": ["allowed", list("member", `${PAGE}/versions`, limit(50))],
      "reads a permission": ["allowed", get("member", `${PAGE}/permissions/${pagePermissionId("user", MEMBER_UID)}`)],
      "appends an update": [
        "denied",
        create("member", `${PAGE}/updates/${autoId("viewer update")}`, newUpdate(MEMBER_UID), true),
      ],
      "writes a chunk of the next generation": [
        "denied",
        create("member", chunkPath(2), { pageId: PAGE_ID, generation: 2, index: 0, snapshot: bytes() }, true),
      ],
      "renames the page": ["denied", update("member", PAGE, { title: "Renamed by a viewer" })],
      "moves the page to a later generation": ["denied", compaction("member", head(3))],
      "opens a thread": ["denied", threadWithComment("member")],
    });
  });

  it("let a commenter write threads and comments, and nothing of the content", async () => {
    await expectOutcomes({
      "opens a thread with a Firestore anchor and its first comment": ["allowed", threadWithComment("ownLabMember")],
      "appends an update": [
        "denied",
        create(
          "ownLabMember",
          `${PAGE}/updates/${autoId("commenter update")}`,
          newUpdate(uidOfCaller("ownLabMember")),
          true,
        ),
      ],
      "renames the page": ["denied", update("ownLabMember", PAGE, { title: "Renamed by a commenter" })],
      "runs a compaction": ["denied", compaction("ownLabMember", head(3))],
    });
  });

  it("let an editor append well-formed updates in their own name, and nothing else", async () => {
    const uid = uidOfCaller("ownTeam");
    const at = (label: string) => `${PAGE}/updates/${autoId(label)}`;
    await expectOutcomes({
      "an update in their own name": ["allowed", create("ownTeam", at("good update"), newUpdate(uid), true)],
      "the last part of an update in two parts": [
        "allowed",
        create("ownTeam", at("second part"), newUpdate(uid, { index: 1, count: 2 }), true),
      ],
      "an update in another account's name": [
        "denied",
        create("ownTeam", at("forged author"), newUpdate(MEMBER_UID), true),
      ],
      "an update of another page": [
        "denied",
        create("ownTeam", at("other page"), newUpdate(uid, { pageId: RESTRICTED_ID }), true),
      ],
      "a part beyond the number of parts": [
        "denied",
        create("ownTeam", at("beyond"), newUpdate(uid, { index: 2, count: 2 }), true),
      ],
      "an update of no parts": ["denied", create("ownTeam", at("no parts"), newUpdate(uid, { count: 0 }), true)],
      "an update that is no byte string": [
        "denied",
        create("ownTeam", at("text update"), newUpdate(uid, { update: "not bytes" }), true),
      ],
      "an update under a name of the client's choosing": [
        "denied",
        createAt("ownTeam", `${PAGE}/updates/update-of-my-choosing`, newUpdate(uid)),
      ],
      "an update of a page that does not exist": [
        "denied",
        create(
          "admin",
          `pages/no-such-page/updates/${autoId("nowhere")}`,
          newUpdate(uidOfCaller("admin"), { pageId: "no-such-page" }),
          true,
        ),
      ],
    });
  });

  it("keep a restricted page to its principals, whoever manages its replication", async () => {
    await expectOutcomes({
      "the listed viewer reads it": ["allowed", get("member", RESTRICTED)],
      "the listed viewer reads its content": ["allowed", get("member", chunkPath(0, 0, RESTRICTED_ID))],
      "an administrator reads it": ["allowed", get("admin", RESTRICTED)],
      "a lead of its replication is refused": ["denied", get("ownLead", RESTRICTED)],
      "a lead of its replication is refused its content": ["denied", get("ownLead", chunkPath(0, 0, RESTRICTED_ID))],
      "a team member of its replication is refused": ["denied", get("ownTeam", RESTRICTED)],
      "the listed viewer writes nothing": [
        "denied",
        create(
          "member",
          `${RESTRICTED}/updates/${autoId("restricted update")}`,
          newUpdate(MEMBER_UID, { pageId: RESTRICTED_ID }),
          true,
        ),
      ],
      "a lead of its replication renames it": ["denied", update("ownLead", RESTRICTED, { title: "Taken over" })],
    });
  });

  it("are granted by functions alone: nobody lists themselves or widens the audience", async () => {
    const permission = (caller: Exclude<CallerKind, "signedOut">) =>
      `${PAGE}/permissions/${pagePermissionId("user", uidOfCaller(caller))}`;
    await expectOutcomes({
      "a holder of full access lists themselves": [
        "denied",
        create("ownLead", permission("ownLead"), {
          pageId: PAGE_ID,
          principalType: "user",
          principalId: uidOfCaller("ownLead"),
          level: "full",
        }),
      ],
      "an administrator raises a stored permission": [
        "denied",
        update("admin", `${PAGE}/permissions/${pagePermissionId("user", MEMBER_UID)}`, { level: "full" }),
      ],
      "an editor adds their key to the editors": [
        "denied",
        update("ownTeam", PAGE, { "levelKeys.edit": [userScopeKey(uidOfCaller("ownTeam"))] }),
      ],
      "an administrator restricts the page directly": ["denied", update("admin", PAGE, { accessMode: "restricted" })],
      "a holder of full access widens the readers": [
        "denied",
        update("ownLead", PAGE, { scopeKeys: ["members", "programme"] }),
      ],
      "an editor moves the page beneath another": ["denied", update("ownTeam", PAGE, { parentPageId: RESTRICTED_ID })],
      "an administrator reads beneath a page that does not exist": [
        "denied",
        get("admin", chunkPath(0, 0, "no-such-page")),
      ],
    });
  });
});

describe("an update of a page", () => {
  it("is never changed, by its author or by anyone else", async () => {
    await expectOutcomes({
      "its author changes it": ["denied", update("ownTeam", STORED_UPDATE, { clientId: 9 })],
      "an administrator changes it": ["denied", update("admin", STORED_UPDATE, { clientId: 9 })],
    });
  });

  it("is removed only in the compaction that moves the page to a later generation", async () => {
    await expectOutcomes({
      "its author removes it alone": ["denied", remove("ownTeam", STORED_UPDATE)],
      "an administrator removes it alone": ["denied", remove("admin", STORED_UPDATE)],
      "an editor removes it beside a change of the title": [
        "denied",
        () => {
          const db = dbOf("ownTeam");
          const batch = writeBatch(db);
          batch.delete(doc(db, STORED_UPDATE));
          batch.update(doc(db, PAGE), { title: "Renamed in passing", ...updatedBy(uidOfCaller("ownTeam")) });
          return batch.commit();
        },
      ],
      "an editor compacts": ["allowed", compaction("ownTeam", head(3))],
    });
  });
});

describe("a compaction", () => {
  it("names a later generation whose last chunk exists, at the request time, and changes nothing else", async () => {
    await expectOutcomes({
      "the generation the page names already": ["denied", compaction("ownTeam", head(1))],
      "a generation without chunks": ["denied", compaction("ownTeam", head(2))],
      "a generation with one chunk missing": ["denied", compaction("ownTeam", head(3, { chunkCount: 2 }))],
      "an instant of the client's choosing": [
        "denied",
        compaction("ownTeam", head(3, { compactedAt: Timestamp.fromMillis(Date.now() - 60_000) })),
      ],
      "a head with a field of its own": ["denied", compaction("ownTeam", head(3, { compactedBy: "uid-someone" }))],
      "a new title beside it": ["denied", compaction("ownTeam", head(3), { title: "Renamed in a compaction" })],
      "a well-formed compaction": ["allowed", compaction("ownTeam", head(3))],
    });
  });

  it("commits once: a second compactor that still believes in the earlier generation is refused", async () => {
    const second = () => {
      const db = dbOf("ownLead");
      const batch = writeBatch(db);
      batch.update(doc(db, PAGE), { contentHead: head(3), ...updatedBy(uidOfCaller("ownLead")) });
      return batch.commit();
    };
    await expectOutcomes({
      "the first compactor": ["allowed", compaction("ownTeam", head(3))],
      "the second compactor": ["denied", second],
    });
  });

  it("writes chunks for a later generation only, never changes one, and removes only an earlier one", async () => {
    const chunk = (generation: number, index = 0) => ({ pageId: PAGE_ID, generation, index, snapshot: bytes() });
    await expectOutcomes({
      "a chunk of the generation the page names": ["denied", create("ownTeam", chunkPath(1, 1), chunk(1, 1), true)],
      "a chunk whose identifier names another generation": ["denied", create("ownTeam", chunkPath(4), chunk(5), true)],
      "a chunk of a later generation": ["allowed", create("ownTeam", chunkPath(2), chunk(2), true)],
      "a change to a chunk": ["denied", update("admin", chunkPath(1), { index: 1 })],
      "the removal of the current chunk": ["denied", remove("admin", chunkPath(1))],
      "the removal of a chunk of an earlier generation by a commenter": [
        "denied",
        remove("ownLabMember", chunkPath(0)),
      ],
      "the removal of a chunk of an earlier generation by an editor": ["allowed", remove("ownTeam", chunkPath(0))],
    });
  });
});

describe("a thread and its comments", () => {
  const editComment = (caller: CallerKind, fields: Record<string, unknown> = {}) =>
    update(caller, STORED_COMMENT, { body: "Edited.", editedAt: serverTimestamp(), ...fields });

  it("copy the audience of their page and are written in the commenter's own name", async () => {
    await expectOutcomes({
      "a thread that widens the audience of the page": [
        "denied",
        threadWithComment("ownLabMember", { scopeKeys: [...PAGE_SCOPE, "programme"] }),
      ],
      "a thread that names another replication": [
        "denied",
        threadWithComment("ownLabMember", { replicationId: "SyntheticStudy2002" }),
      ],
      "a thread that is resolved already": [
        "denied",
        threadWithComment("ownLabMember", { resolvedAt: serverTimestamp(), resolvedBy: uidOfCaller("ownLabMember") }),
      ],
      "a comment in another account's name": ["denied", threadWithComment("ownLabMember", {}, OWNER_UID)],
      "a comment on a thread that does not exist": [
        "denied",
        create("ownLabMember", `threads/${autoId("no thread")}/comments/${autoId("orphan comment")}`, {
          threadId: autoId("no thread"),
          authorUid: uidOfCaller("ownLabMember"),
          body: "Nobody will read this.",
          mentionUids: [],
          editedAt: null,
          deletedAt: null,
          ...SCOPE_FIELDS,
        }),
      ],
      "a well-formed thread with its comment": ["allowed", threadWithComment("ownLabMember")],
    });
  });

  it("let an author edit and remove their own comment only, at the request time", async () => {
    await expectOutcomes({
      "another member edits it": ["denied", editComment("member")],
      "an administrator edits it": ["denied", editComment("admin")],
      "its author edits it at another time": [
        "denied",
        editComment("owner", { editedAt: Timestamp.fromMillis(Date.now() - 60_000) }),
      ],
      "its author moves it to another thread": ["denied", editComment("owner", { threadId: autoId("other thread") })],
      "its author edits it": ["allowed", editComment("owner")],
      "its author removes it": ["allowed", editComment("owner", { deletedAt: serverTimestamp() })],
      "its author edits it once removed": ["denied", editComment("owner")],
      "anyone deletes the document": ["denied", remove("owner", STORED_COMMENT)],
    });
  });

  it("are resolved in the caller's own name and reopened by those who may comment", async () => {
    const thread = `threads/${STORED_THREAD}`;
    await expectOutcomes({
      "a viewer resolves it": [
        "denied",
        update("member", thread, { resolvedAt: serverTimestamp(), resolvedBy: MEMBER_UID }),
      ],
      "a commenter resolves it in another's name": [
        "denied",
        update("ownLabMember", thread, { resolvedAt: serverTimestamp(), resolvedBy: OWNER_UID }),
      ],
      "a commenter moves its anchor": ["denied", update("ownLabMember", thread, { anchor: { blockId: "elsewhere" } })],
      "a commenter resolves it": [
        "allowed",
        update("ownLabMember", thread, { resolvedAt: serverTimestamp(), resolvedBy: uidOfCaller("ownLabMember") }),
      ],
      "an editor reopens it": ["allowed", update("ownTeam", thread, { resolvedAt: null, resolvedBy: null })],
    });
  });
});
