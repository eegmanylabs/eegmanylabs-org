// The second door of the data layer, for the collaborative editor of pages only (D-010): the
// provider that keeps a page's Yjs document in Firestore, the presence of the tabs that have the
// page open, and the files of pages in Cloud Storage. It is apart from "@/data" so that Yjs and the
// Storage SDK load with the editor, which is itself loaded on demand, and not with the first page.
// portal/tests/architecture/boundaries.test.ts lets web/src/editor/ alone import it.
export { namesOfOthers } from "./awareness-wire";
export { PageFileError, pageFileUrl, uploadPageFile } from "./page-files";
export { PresenceSync, type PresenceSyncMode } from "./page-presence";
export { type CompactionResult, PageSync, type PageSyncOptions, type SaveState } from "./page-sync";
