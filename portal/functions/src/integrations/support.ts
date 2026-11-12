// What the callable functions of the integrations share: who may manage them, who reads a
// linked item, and the adapters for a call a person waits for.
import {
  COLLECTIONS,
  type DocumentLinkDoc,
  documentLinkDocSchema,
  parseStoredDocument,
  programmePowersInEffect,
  REQUEST_BACKOFF,
  type ResolvedAccess,
  sessionScopeKeys,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { AppError, type AuthenticatedContext, readAccessDocument, requireCapability } from "../framework";
import { NOT_CONFIGURED_MESSAGE, type WorkspaceRuntime, workspaceRuntime } from "./google/adapters";
import { retrying } from "./google/retry";
import {
  DOCS_MIME_TYPE,
  DRIVE_FOLDER_MIME_TYPE,
  type DriveFile,
  SHEETS_MIME_TYPE,
  type WorkspaceAdapters,
} from "./google/types";

/** Reads the caller's access document and refuses a caller without `integrations.manage` for the programme. */
export async function requireIntegrationsManager(
  db: Firestore,
  context: AuthenticatedContext,
  transaction?: Transaction,
): Promise<ResolvedAccess> {
  const access = await readAccessDocument(db, context.uid, transaction);
  requireCapability(context, access, "integrations.manage", "programme");
  return access;
}

/**
 * Whether the caller reads a document with these scope keys, as the security rules decide it:
 * one of the keys is the caller's, or the caller is programme staff in a session with its powers.
 */
export function readsAudience(
  access: ResolvedAccess,
  context: AuthenticatedContext,
  scopeKeys: readonly string[],
): boolean {
  const session = { secondFactorVerified: context.secondFactorVerified };
  if (!access.member || access.suspended) return false;
  const held = new Set(sessionScopeKeys(access, session));
  if (scopeKeys.some((key) => held.has(key))) return true;
  return (
    programmePowersInEffect(access, session) &&
    access.programmeRoles.some((role) => role === "programme_admin" || role === "core_team")
  );
}

/** A link the caller reads. A link the caller may not read is refused in the words of one that does not exist. */
export async function readableLink(
  db: Firestore,
  context: AuthenticatedContext,
  linkId: string,
): Promise<{ readonly link: DocumentLinkDoc; readonly access: ResolvedAccess }> {
  const access = await readAccessDocument(db, context.uid);
  const parsed = parseStoredDocument(
    documentLinkDocSchema,
    (await db.doc(COLLECTIONS.documentLinks.docPath(linkId)).get()).data(),
  );
  if (!parsed.success || parsed.data.archivedAt !== null || !readsAudience(access, context, parsed.data.scopeKeys)) {
    throw new AppError("not-found", "This linked item does not exist.");
  }
  return { link: parsed.data, access };
}

/**
 * The adapters for a call a person waits for: a request is retried a few times with a short
 * backoff, and anything longer is left to a queued job.
 */
export function interactiveAdapters(runtime: WorkspaceRuntime = workspaceRuntime()): {
  readonly adapters: WorkspaceAdapters;
  readonly identity: string;
} {
  if (runtime.kind === "none") throw new AppError("failed-precondition", NOT_CONFIGURED_MESSAGE);
  const dependencies = {
    sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(milliseconds, 2_000))),
    random: Math.random,
    policy: { ...REQUEST_BACKOFF, maxAttempts: 3 },
  };
  const { drive, sheets, docs, kind } = runtime.adapters;
  return {
    adapters: {
      drive: retrying(drive, dependencies),
      sheets: retrying(sheets, dependencies),
      docs: retrying(docs, dependencies),
      kind,
    },
    identity: runtime.identity,
  };
}

const DRIVE_ID = "[A-Za-z0-9_-]+";

/** The Drive identifier in an address of a file or folder, or null for an address that names none. */
export function driveIdOf(address: string): string | null {
  const patterns = [
    new RegExp(`^https://drive\\.google\\.com/drive/(?:u/\\d+/)?folders/(${DRIVE_ID})`),
    new RegExp(`^https://docs\\.google\\.com/(?:document|spreadsheets|presentation)/d/(${DRIVE_ID})`),
    new RegExp(`^https://drive\\.google\\.com/file/d/(${DRIVE_ID})`),
    new RegExp(`^https://drive\\.google\\.com/open\\?id=(${DRIVE_ID})`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(address.trim());
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** The kind of document link a Drive item makes. */
export function linkKindOf(file: Pick<DriveFile, "mimeType">): DocumentLinkDoc["kind"] {
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) return "driveFolder";
  if (file.mimeType === DOCS_MIME_TYPE) return "googleDoc";
  if (file.mimeType === SHEETS_MIME_TYPE) return "googleSheet";
  if (file.mimeType === "application/pdf") return "pdf";
  return "url";
}

/** The kind of link an address makes by its shape, for an item that Drive has not described. */
export function linkKindOfAddress(address: string): DocumentLinkDoc["kind"] {
  const trimmed = address.trim();
  if (/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//.test(trimmed)) return "driveFolder";
  if (/^https:\/\/docs\.google\.com\/document\/d\//.test(trimmed)) return "googleDoc";
  if (/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(trimmed)) return "googleSheet";
  return "url";
}

/** The kind of a Drive item as the browser shows it. */
export function itemKindOf(file: Pick<DriveFile, "mimeType">): "folder" | "document" | "spreadsheet" | "file" {
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) return "folder";
  if (file.mimeType === DOCS_MIME_TYPE) return "document";
  if (file.mimeType === SHEETS_MIME_TYPE) return "spreadsheet";
  return "file";
}

/** A Drive item as the callable functions answer it. */
export function driveItemOf(file: DriveFile) {
  return {
    id: file.id,
    name: file.name.slice(0, 300),
    kind: itemKindOf(file),
    mimeType: file.mimeType.slice(0, 200),
    modifiedAt: file.modifiedTime === "" ? null : new Date(file.modifiedTime).toISOString(),
    ownerName: file.owners[0]?.displayName.slice(0, 300) ?? null,
    lastModifiedBy: file.lastModifyingUser?.displayName.slice(0, 300) ?? null,
    url: file.webViewLink === "" ? null : file.webViewLink,
  };
}
