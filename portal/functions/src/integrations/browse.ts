// Reading inside a linked Drive folder. A link opens its own item and what Drive places inside
// it, never anything beside it, so a folder or file below the linked one is opened only after
// its parents have been followed up to the linked item.
import type { DocumentLinkDoc } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { AppError } from "../framework";
import { RESERVED_MESSAGE, reservedDriveItems } from "./drive-guard";
import { DRIVE_SILENT_MESSAGE, shareMessage } from "./drive-links";
import type { DriveAdapter, DriveFile } from "./google/types";
import { ExternalServiceError } from "./google/types";
import { recordHealth } from "./jobs/health";

/** The deepest a folder below a linked one is looked for. */
const MAX_DEPTH = 20;

/**
 * Records what a call a person waited for learnt about Drive on the connection: a success, or an
 * outage or quota that leaves it degraded. A refusal of one item says nothing about Drive.
 */
export async function recordDriveOutcome(db: Firestore, error: unknown, at: Date): Promise<void> {
  if (error === null) {
    await recordHealth(db, "googleDrive", { kind: "success" }, at);
    return;
  }
  if (error instanceof ExternalServiceError && (error.status >= 500 || error.status === 429)) {
    await recordHealth(db, "googleDrive", { kind: "degraded", message: `Drive did not answer (${error.status}).` }, at);
  }
}

/** Turns a refusal of Drive into a message for the person waiting. */
export function driveFailure(error: unknown, identity: string): AppError {
  if (error instanceof ExternalServiceError && (error.status === 404 || error.status === 403)) {
    return new AppError("failed-precondition", shareMessage(identity));
  }
  return new AppError("failed-precondition", DRIVE_SILENT_MESSAGE);
}

/**
 * The Drive item of a link that may be opened: one checked as shared with the portal by someone
 * who controls it. A link kept as restricted opens nothing, even once Drive would answer.
 */
export function requireOpenLink(link: DocumentLinkDoc): string {
  if (link.externalId === undefined) throw new AppError("failed-precondition", "This link is not to a Drive item.");
  if (link.accessStatus !== "shared") {
    throw new AppError(
      "failed-precondition",
      "This item has not been checked as shared with the portal. Someone who manages the record can check it again.",
    );
  }
  return link.externalId;
}

/**
 * The item and the path to it from the linked item, or a refusal in the words of an item that
 * does not exist where the item lies outside the linked one. An item that is, or lies in, what
 * the portal keeps for synchronisation or generated documents is refused, and the reserved items
 * are given so that a listing can leave them out.
 */
export async function itemWithin(
  db: Firestore,
  drive: DriveAdapter,
  linkedId: string,
  itemId: string,
): Promise<{ readonly item: DriveFile; readonly path: readonly DriveFile[]; readonly reserved: ReadonlySet<string> }> {
  const item = await drive.getFile(itemId);
  const path: DriveFile[] = [item];
  let current = item;
  for (let depth = 0; current.id !== linkedId; depth += 1) {
    const parentId = current.parents[0];
    if (parentId === undefined || depth >= MAX_DEPTH)
      throw new AppError("not-found", "This item is not inside the linked folder.");
    current = await drive.getFile(parentId);
    path.unshift(current);
  }
  const reserved = await reservedDriveItems(db);
  if (path.some((folder) => reserved.has(folder.id))) throw new AppError("failed-precondition", RESERVED_MESSAGE);
  return { item, path, reserved };
}
