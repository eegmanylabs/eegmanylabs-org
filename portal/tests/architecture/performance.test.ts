// Performance and pagination (R18.13), read from the source: the routes that load on demand,
// and the bound of every list query of the catalogue (tests/rules/queries.ts). A query states its
// limit, never above what one listener may read, and a query above the page size of the
// catalogue is named here with what keeps the page that reads it from drawing every document at
// once. The size of the first load is held to its budget in production-build.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_QUERY_MAX_LIMIT } from "../../web/src/data/query-spec";
import { CATALOGUE_PAGE_SIZE, QUERY_CATALOGUE } from "../rules/queries";
import { PORTAL_ROOT } from "./support";

/**
 * The queries that read more than a page of the catalogue, by purpose, with what bounds what the
 * page draws: a paged list, a tree drawn a branch or a window at a time, a virtualised table, or
 * documents that are merged or counted and never drawn one by one.
 */
const ABOVE_PAGE_SIZE: Readonly<Record<string, string>> = {
  "the pages of the workspace that a member reads":
    "The tree of pages draws fifty pages to a branch with Show more, and the lists of the workspace are paged.",
  "every page of the workspace, for the programme":
    "The tree of pages draws fifty pages to a branch with Show more, and the lists of the workspace are paged.",
  "every page that a member reads": "Read for the titles of pages in the activity widget, never drawn as a list.",
  "every page, for the programme": "Read for the titles of pages in the activity widget, never drawn as a list.",
  "the updates of a page that other editors wrote": "Merged into the document of the editor, never drawn.",
  "every database that a member reads": "Offered as the choices of one select, and drawn as no list.",
  "the meetings of the workspace a member reads": "The meetings of the workspace are a paged list.",
  "the task lists a caller reads by scope": "Offered as the choices of one select, and drawn as no list.",
  "the personal task lists of a caller": "Offered as the choices of one select, and drawn as no list.",
  "the tasks a caller reads by scope":
    "The task tree draws 200 rows with Show more, the table is virtualised, and the list, gallery and board are paged.",
  "the tasks of the personal lists of a caller":
    "The task tree draws 200 rows with Show more, the table is virtualised, and the list, gallery and board are paged.",
  "the tasks a caller is assigned to, whatever their list":
    "The task tree draws 200 rows with Show more, the table is virtualised, and the list, gallery and board are paged.",
  "the tasks a caller collaborates on, whatever their list":
    "The task tree draws 200 rows with Show more, the table is virtualised, and the list, gallery and board are paged.",
  "the tasks a caller follows, whatever their list":
    "The task tree draws 200 rows with Show more, the table is virtualised, and the list, gallery and board are paged.",
  "the recruitment reports of every scope a caller holds":
    "Rolled up into figures by the resolver; the reports of a participation are listed one participation at a time.",
  "the recruitment reports of a replication, for its leads":
    "Rolled up into figures by the resolver; the reports of a participation are listed one participation at a time.",
  "the recruitment reports of a laboratory, for its coordinators":
    "Rolled up into figures by the resolver; the reports of a participation are listed one participation at a time.",
  "the planned pauses of every scope a caller holds": "Counted into the forecast and listed per participation.",
  "the tasks of a list beneath one parent, where a task is placed": "Read by a function to place a task, never drawn.",
  "the accounts that follow a record, across users": "Read by a trigger to notify followers, never drawn.",
  "the copies held on one storage server, across datasets": "Read by a scan of a server, never drawn.",
  "a person's entries on every authorship list, for listMyAuthorshipEntries":
    "Read by a function for one person's own entries, which the panel on Home lists: one entry for each output the person is an author of.",
};

describe("the queries of the catalogue", () => {
  it("each state a limit, and a browser's within what one listener may read", () => {
    const unbounded = QUERY_CATALOGUE.filter(
      (query) =>
        !Number.isInteger(query.shape.limit) ||
        query.shape.limit < 1 ||
        (query.caller !== null && query.shape.limit > LIVE_QUERY_MAX_LIMIT),
    ).map((query) => query.purpose);
    expect(unbounded).toEqual([]);
  });

  it("read more than a page only where the page that reads them draws a page at a time", () => {
    const above = QUERY_CATALOGUE.filter((query) => query.shape.limit > CATALOGUE_PAGE_SIZE).map(
      (query) => query.purpose,
    );
    expect(above.filter((purpose) => ABOVE_PAGE_SIZE[purpose] === undefined)).toEqual([]);
    expect(Object.keys(ABOVE_PAGE_SIZE).filter((purpose) => !above.includes(purpose))).toEqual([]);
  });
});

describe("the routes", () => {
  it("load every page on demand but the sign-in page, Home, the claim page and the page for unknown addresses", () => {
    const router = readFileSync(path.join(PORTAL_ROOT, "web/src/app/router.tsx"), "utf8");
    const eager = [...router.matchAll(/^import [^;]*from "@\/pages\/([^"]+)";$/gm)].map((match) => match[1]);
    expect(eager.sort()).toEqual(["NotFoundPage", "claim/ClaimPage", "home/HomePage", "login/LoginPage"]);
    expect([...router.matchAll(/await import\("@\/pages\//g)].length).toBeGreaterThan(30);
  });
});
