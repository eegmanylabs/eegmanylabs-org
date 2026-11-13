// The live reads of the workspace, described once so that every view that needs the same
// documents shares one listener. The rules do not filter a list, so every query of a reader who
// is not programme staff names the scope keys of the session (docs/DATA_MODEL.md, section 1).
// Programme administrators and the core team read every page and ask without them.
import type { LiveQuery } from "@/data";
import type { Viewer } from "@/registry/viewer";

/** The most pages the workspace reads at once, which is the most a list may ask for. */
export const WORKSPACE_LIMIT = 1_000;

const scoped = (viewer: Viewer) =>
  viewer.staff ? [] : ([["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]] as const);

/** Every page of the workspace the viewer reads: the pages members make, at any depth. Archived ones included. */
export function workspacePages(viewer: Viewer): LiveQuery<"pages"> {
  return {
    collection: "pages",
    within: [],
    where: [["kind", "==", "custom"], ...scoped(viewer)],
    limit: WORKSPACE_LIMIT,
  };
}

/** The meetings of the workspace the viewer reads: pages of the kind `meeting`, newest first. */
export function meetingPages(viewer: Viewer): LiveQuery<"pages"> {
  return {
    collection: "pages",
    within: [],
    where: [["kind", "==", "meeting"], ...scoped(viewer)],
    limit: WORKSPACE_LIMIT,
  };
}

/** The threads of a page. */
export function threadsOfPage(viewer: Viewer, pageId: string): LiveQuery<"threads"> {
  return { collection: "threads", within: [], where: [["targetId", "==", pageId], ...scoped(viewer)], limit: 200 };
}

/** The comments of a thread, which are read as the thread: its page decides, so no scope is named. */
export function commentsOfThread(threadId: string): LiveQuery<"threadComments"> {
  return { collection: "threadComments", within: [threadId], limit: 200 };
}

/** The saved versions of a page, newest first. The page decides who reads them. */
export function versionsOfPage(pageId: string): LiveQuery<"pageVersions"> {
  return { collection: "pageVersions", within: [pageId], orderBy: [["createdAt", "desc"]], limit: 50 };
}

/** The spells of editing of a page, newest first. */
export function activityOfPage(viewer: Viewer, pageId: string): LiveQuery<"activity"> {
  return {
    collection: "activity",
    within: [],
    where: [["entityId", "==", pageId], ...scoped(viewer)],
    orderBy: [["createdAt", "desc"]],
    limit: 50,
  };
}

/** Who last changed each block of a page, latest first. The page decides who reads them. */
export function blockEditsOfPage(pageId: string): LiveQuery<"pageBlockEdits"> {
  return { collection: "pageBlockEdits", within: [pageId], orderBy: [["editedAt", "desc"]], limit: 200 };
}
