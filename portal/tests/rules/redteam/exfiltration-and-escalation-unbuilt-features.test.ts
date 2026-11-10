// Red-team attacks on the collections whose rules are not written yet, and on paths that the
// registry does not know at all. Pages, tasks, views, dashboards, datasets and the rest stay
// closed to every client until the phase that builds each feature writes and tests its rules,
// so nothing here may be read or written by anyone, a programme administrator included: not by
// path, not through a query that names a scope the caller holds, not across parents, and not by
// creating a document that names the caller as its owner.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  COLLECTION_ENTRIES,
  type CollectionEntry,
  MEMBERS_SCOPE_KEY,
  pagePermissionId,
  userScopeKey,
} from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, getCountFromServer, limit, query, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Expectations, expectOutcomes, requestsOf } from "../requests";
import { parametersOf, pathOf, placeholderDocument, placeholderIds, seedWorld } from "../seed";
import { createRulesEnvironment, readRulesFile } from "../support";
import {
  CALLERS,
  type CallerKind,
  firestoreOf,
  OWN_LABORATORY,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  uidOfCaller,
} from "../world";
import { EVERYONE, forEach } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, create, update, remove } = requestsOf(() => environment);
const dbOf = (caller: CallerKind) => firestoreOf(environment, CALLERS[caller]);
type SignedIn = (typeof EVERYONE)[number];

const unbuilt = COLLECTION_ENTRIES.filter((entry) => entry.enforcement === "deniedUntilBuilt");

const storedPathOf = (entry: CollectionEntry) => pathOf(entry, placeholderIds(entry));
const collectionPathOf = (entry: CollectionEntry) => storedPathOf(entry).split("/").slice(0, -1).join("/");
const isFixedName = (entry: CollectionEntry) => entry.identifier.kind === "fixed";

/**
 * A document that names the caller in every field by which a rule could recognise an owner, an
 * author, a participant or a holder of full access, and carries every scope key a caller holds.
 */
function selfServing(caller: SignedIn): Record<string, unknown> {
  const uid = uidOfCaller(caller);
  const keys = [...(CALLERS[caller].access?.scopeKeys ?? []), userScopeKey(uid), MEMBERS_SCOPE_KEY];
  return {
    uid,
    ownerUid: uid,
    authorUid: uid,
    assigneeUids: [uid],
    principalType: "user",
    principalId: uid,
    level: "full",
    isShared: false,
    replicationId: OWN_REPLICATION,
    laboratoryId: OWN_LABORATORY,
    scopeKeys: keys,
    levelKeys: { comment: keys, edit: keys, full: keys },
  };
}

/** Every request of the attack on one entry by one caller. All of them are refused. */
function attacksOn(entry: CollectionEntry, caller: SignedIn): Expectations {
  const uid = uidOfCaller(caller);
  const path = storedPathOf(entry);
  const container = collectionPathOf(entry);
  const siblingIds = [...placeholderIds(entry).slice(0, -1), `record-of-${caller}`];
  const attacks: Record<string, Expectations[string]> = {
    "reads the stored document": ["denied", get(caller, path)],
    "changes the stored document": ["denied", update(caller, path, { ownerUid: uid, scopeKeys: [userScopeKey(uid)] })],
    "removes the stored document": ["denied", remove(caller, path)],
    "lists every document of the name across parents": [
      "denied",
      listAcrossParents(caller, entry.collectionId, limit(5)),
    ],
    "lists across parents by its own login": [
      "denied",
      listAcrossParents(caller, entry.collectionId, where("ownerUid", "==", uid), limit(5)),
    ],
    "lists across parents by a scope it holds": [
      "denied",
      listAcrossParents(caller, entry.collectionId, where("scopeKeys", "array-contains", MEMBERS_SCOPE_KEY), limit(5)),
    ],
    "counts across parents": [
      "denied",
      () => getCountFromServer(query(collectionGroup(dbOf(caller), entry.collectionId), limit(5))),
    ],
    "lists the collection": ["denied", list(caller, container, limit(5))],
    "lists the collection by its own login": ["denied", list(caller, container, where("uid", "==", uid), limit(5))],
    "lists the collection by a scope it holds": [
      "denied",
      list(
        caller,
        container,
        where("scopeKeys", "array-contains-any", [MEMBERS_SCOPE_KEY, userScopeKey(uid)]),
        limit(5),
      ),
    ],
    "counts the collection": ["denied", () => getCountFromServer(query(collection(dbOf(caller), container), limit(5)))],
  };
  if (!isFixedName(entry) && parametersOf(entry).length > 0) {
    attacks["creates a document that names it as owner"] = [
      "denied",
      create(caller, pathOf(entry, siblingIds), selfServing(caller)),
    ];
    attacks["reads a document under another identifier"] = ["denied", get(caller, pathOf(entry, siblingIds))];
  }
  return Object.fromEntries(Object.entries(attacks).map(([label, row]) => [`${caller}: ${label}`, row]));
}

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-unbuilt");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

describe("a collection whose rules are not written yet", () => {
  it("is one of many: the registry names them, and the world stores a document in each", () => {
    expect(unbuilt.length).toBeGreaterThan(40);
    // The stored document carries every scope and names an owner, so content is never the reason for a refusal.
    expect(placeholderDocument()).toMatchObject({ ownerUid: OWNER_UID, isShared: true });
  });

  it.each(unbuilt.map((entry) => [entry.key, entry] as const))(
    "%s is closed to every caller and every query",
    async (_key, entry) => {
      for (const caller of EVERYONE) await expectOutcomes(attacksOn(entry, caller));
    },
  );
});

describe("a page", () => {
  const PAGE = "pages/record-1";

  it("gives nobody full access through its permissions, the listed holders of full access included", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "grants itself full access", (caller) =>
        create(caller, `${PAGE}/permissions/${pagePermissionId("user", uidOfCaller(caller))}`, {
          pageId: "record-1",
          principalType: "user",
          principalId: uidOfCaller(caller),
          level: "full",
        }),
      ),
      ...forEach(EVERYONE, "denied", "grants every member full access", (caller) =>
        create(caller, `${PAGE}/permissions/${pagePermissionId("role", "lab_member")}`, {
          pageId: "record-1",
          principalType: "role",
          principalId: "lab_member",
          level: "full",
        }),
      ),
      ...forEach(EVERYONE, "denied", "raises the level of a stored permission", (caller) =>
        update(caller, `${PAGE}/permissions/record-1`, { level: "full", principalId: uidOfCaller(caller) }),
      ),
      ...forEach(EVERYONE, "denied", "adds its key to the resolved levels of the page", (caller) =>
        update(caller, PAGE, { accessMode: "inherit", "levelKeys.full": [userScopeKey(uidOfCaller(caller))] }),
      ),
    });
  });

  it("gives nobody its content: not the snapshot, not the updates, not a version and not its chunks", async () => {
    const PARTS = [
      `${PAGE}/content/record-1`,
      `${PAGE}/updates/record-1`,
      `${PAGE}/versions/record-1`,
      `${PAGE}/versions/record-1/chunks/record-1`,
    ];
    for (const part of PARTS) {
      await expectOutcomes(forEach(EVERYONE, "denied", `reads ${part}`, (caller) => get(caller, part)));
    }
    await expectOutcomes({
      ...Object.fromEntries(
        ["content", "updates", "versions", "chunks"].flatMap((name) =>
          Object.entries(
            forEach(EVERYONE, "denied", `lists every document named ${name} of the page`, (caller) =>
              listAcrossParents(caller, name, where("pageId", "==", "record-1"), limit(5)),
            ),
          ),
        ),
      ),
      ...forEach(EVERYONE, "denied", "appends an update to the page", (caller) =>
        create(
          caller,
          `${PAGE}/updates/update-of-${caller}`,
          {
            pageId: "record-1",
            updateId: `update-of-${caller}`,
            index: 0,
            count: 1,
            uid: uidOfCaller(caller),
            clientId: 1,
          },
          true,
        ),
      ),
    });
  });
});

describe("a personal view and a personal dashboard", () => {
  it("store nothing for anyone and show nothing to anyone, across scopes or within one", async () => {
    const view = (caller: SignedIn) => ({
      collectionKey: "core:persons",
      name: "A synthetic view",
      type: "table",
      config: {
        filter: { field: "laboratoryIds", operator: "contains", value: OWN_LABORATORY },
        copied: [OWNER_PERSON],
      },
      scope: { replicationId: OWN_REPLICATION },
      ownerUid: uidOfCaller(caller),
      isShared: false,
      pageId: null,
      order: "a0",
    });
    const dashboard = (caller: SignedIn) => ({
      scopeType: "user",
      scopeId: uidOfCaller(caller),
      ownerUid: uidOfCaller(caller),
      name: "A synthetic dashboard",
      widgets: {
        note: { type: "note", config: { text: "Synthetic notes copied from another scope." }, x: 0, y: 0, w: 4, h: 2 },
      },
      replicationId: null,
      laboratoryId: null,
      scopeKeys: [userScopeKey(uidOfCaller(caller))],
    });
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "stores a personal view", (caller) =>
        create(caller, `views/view-of-${caller}`, view(caller)),
      ),
      ...forEach(EVERYONE, "denied", "shares a view with every member", (caller) =>
        create(caller, `views/shared-view-of-${caller}`, { ...view(caller), isShared: true }),
      ),
      ...forEach(EVERYONE, "denied", "lists its own views", (caller) =>
        list(caller, "views", where("ownerUid", "==", uidOfCaller(caller)), limit(5)),
      ),
      ...forEach(EVERYONE, "denied", "lists the shared views", (caller) =>
        list(caller, "views", where("isShared", "==", true), limit(5)),
      ),
      ...forEach(EVERYONE, "denied", "takes over the stored view", (caller) =>
        update(caller, "views/record-1", { ownerUid: uidOfCaller(caller), isShared: false }),
      ),
      ...forEach(EVERYONE, "denied", "stores a personal dashboard", (caller) =>
        create(caller, `dashboards/dashboard-of-${caller}`, dashboard(caller)),
      ),
      ...forEach(EVERYONE, "denied", "stores a dashboard in the scope of the owning replication", (caller) =>
        create(caller, `dashboards/replication-dashboard-of-${caller}`, {
          ...dashboard(caller),
          scopeType: "replication",
          scopeId: OWN_REPLICATION,
          replicationId: OWN_REPLICATION,
          scopeKeys: [`rep:${OWN_REPLICATION}`, MEMBERS_SCOPE_KEY],
        }),
      ),
      ...forEach(EVERYONE, "denied", "lists its own dashboards", (caller) =>
        list(caller, "dashboards", where("ownerUid", "==", uidOfCaller(caller)), limit(5)),
      ),
    });
  });
});

describe("a path that the registry does not know", () => {
  it("is closed to every caller for reading and for writing", async () => {
    const unknownPaths = (uid: string) => [
      "secrets/integration",
      "config/application",
      "admins/list",
      `users/${uid}/private/token`,
      `users/${uid}/settings/other`,
      `access/${uid}/history/entry-1`,
      `persons/${OWNER_PERSON}/private/other`,
      `persons/${OWNER_PERSON}/special/other`,
      `persons/${OWNER_PERSON}/private/contact/copies/copy-1`,
      `laboratories/${OWN_LABORATORY}/private/other`,
      `replications/${OWN_REPLICATION}/private/other`,
      `replications/${OWN_REPLICATION}/unknown/record-1`,
    ];
    for (const caller of EVERYONE) {
      const uid = uidOfCaller(caller);
      for (const path of unknownPaths(uid)) {
        await expectOutcomes({
          [`${caller}: reads ${path}`]: ["denied", get(caller, path)],
          [`${caller}: writes ${path}`]: [
            "denied",
            create(caller, path, { ownerUid: uid, uid, scopeKeys: [userScopeKey(uid)] }),
          ],
        });
      }
    }
  });

  it("is never opened by a rule that matches a collection name beneath every parent", () => {
    // A rule of the form `match /{path=**}/name/{id}` applies to every collection of that name.
    // The data model uses a collection name beneath one kind of parent only, and this holds the
    // rules to it: each such name belongs to exactly one entry of the registry, whose rules are written.
    const names = [...readRulesFile("firestore.rules").matchAll(/match \/\{path=\*\*\}\/([A-Za-z]+)\/\{/g)].map(
      (match) => match[1] ?? "",
    );
    expect(names.length).toBeGreaterThan(10);
    const opened = names.map((name) => ({
      name,
      entries: COLLECTION_ENTRIES.filter((entry) => entry.collectionId === name).map(
        (entry) => `${entry.key} (${entry.enforcement})`,
      ),
    }));
    for (const { name, entries } of opened) {
      expect(entries, `the collection name "${name}"`).toHaveLength(1);
      expect(entries[0], `the collection name "${name}"`).toMatch(/\(enforced\)$/);
    }
  });
});
