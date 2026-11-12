// What a Drive link may open (docs/INTEGRATIONS.md, section 3.2). The portal's account reads
// every item that owners shared with it, each for a purpose of its own: a synchronised source,
// the templates and the folder of generated documents, another unit's folder. A link is created
// by whoever manages a record and is then browsed by whoever reads the link, so the account must
// never open to a link's readers what it was given for another purpose. Three rules follow:
//
// | Rule                    | A link is refused, and a listing leaves the item out, where                         |
// |-------------------------|--------------------------------------------------------------------------------------|
// | Reserved items          | The item is, or lies in, or contains a registered source, a template, the folder that receives generated documents, or a generated document |
// | The caller's own item   | The caller does not hold `integrations.manage` and Drive does not name the caller's verified address as an owner or editor of the item |
// | One unit for each item  | The item is linked to a record of another replication or laboratory already, and the caller does not hold `integrations.manage` |
import {
  COLLECTIONS,
  can,
  documentLinkDocSchema,
  documentTemplateDocSchema,
  generatedDocumentDocSchema,
  parseStoredDocument,
  type ResolvedAccess,
  sourceLocationDocSchema,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { AppError } from "../framework";
import type { LinkTarget } from "./drive-links";
import type { DriveAdapter, DriveFile } from "./google/types";

/** The deepest a chain of folders is followed. */
const MAX_DEPTH = 20;

/** The most records of each kind that are read to find the reserved items. */
const RESERVED_SCAN_LIMIT = 2_000;

/** The roles in which a person controls a Drive item. */
const CONTROLLING_ROLES = new Set(["owner", "organizer", "fileOrganizer", "writer"]);

export const RESERVED_MESSAGE =
  "This item is kept for a synchronised sheet or for generated documents, or holds one, so it cannot be linked to a record.";

/**
 * The Drive items that the portal's account holds for a purpose of its own: the files of the
 * registered sources, the templates and the folders that receive their copies, and every
 * generated document.
 */
export async function reservedDriveItems(db: Firestore): Promise<ReadonlySet<string>> {
  const reserved = new Set<string>();
  const [sources, templates, generated] = await Promise.all([
    db.collection(COLLECTIONS.sources.collectionPath()).select().limit(RESERVED_SCAN_LIMIT).get(),
    db.collection(COLLECTIONS.documentTemplates.collectionPath()).limit(RESERVED_SCAN_LIMIT).get(),
    db.collection(COLLECTIONS.generatedDocuments.collectionPath()).limit(RESERVED_SCAN_LIMIT).get(),
  ]);
  if (!sources.empty) {
    const locations = await db.getAll(
      ...sources.docs.map((source) => db.doc(COLLECTIONS.sourceLocation.docPath(source.id))),
    );
    for (const location of locations) {
      const parsed = parseStoredDocument(sourceLocationDocSchema, location.data());
      if (parsed.success && parsed.data.externalId !== undefined) reserved.add(parsed.data.externalId);
    }
  }
  for (const template of templates.docs) {
    const parsed = parseStoredDocument(documentTemplateDocSchema, template.data());
    if (!parsed.success) continue;
    for (const id of [parsed.data.externalDocumentId, parsed.data.targetFolderId])
      if (id !== undefined) reserved.add(id);
  }
  for (const document of generated.docs) {
    const parsed = parseStoredDocument(generatedDocumentDocSchema, document.data());
    if (parsed.success && parsed.data.externalDocumentId !== undefined) reserved.add(parsed.data.externalDocumentId);
  }
  return reserved;
}

/** The folders above an item, nearest first, as far as the portal's account can follow them. */
async function ancestorsOf(drive: DriveAdapter, file: DriveFile): Promise<string[]> {
  const ancestors: string[] = [];
  let current = file;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parentId = current.parents[0];
    if (parentId === undefined || ancestors.includes(parentId)) break;
    ancestors.push(parentId);
    try {
      current = await drive.getFile(parentId);
    } catch {
      break;
    }
  }
  return ancestors;
}

/** Refuses an item that is, lies in or holds a reserved item. */
export async function requireUnreserved(
  db: Firestore,
  drive: DriveAdapter,
  fileId: string,
  file: DriveFile | null,
): Promise<void> {
  const reserved = await reservedDriveItems(db);
  if (reserved.has(fileId)) throw new AppError("failed-precondition", RESERVED_MESSAGE);
  if (file === null) return;
  if ((await ancestorsOf(drive, file)).some((id) => reserved.has(id))) {
    throw new AppError("failed-precondition", RESERVED_MESSAGE);
  }
  for (const id of reserved) {
    let item: DriveFile;
    try {
      item = await drive.getFile(id);
    } catch {
      continue;
    }
    if ((await ancestorsOf(drive, item)).includes(fileId)) throw new AppError("failed-precondition", RESERVED_MESSAGE);
  }
}

/**
 * Refuses a caller who does not control the item in Drive: unless the caller holds
 * `integrations.manage`, Drive must name the caller's verified address as an owner or editor.
 * The portal's account reaches more than any one person, so its reach is never lent to someone
 * who could not share the item themselves.
 */
export async function requireControl(
  drive: DriveAdapter,
  access: ResolvedAccess,
  verifiedEmail: string | null,
  fileId: string,
): Promise<void> {
  if (can(access, "integrations.manage", "programme")) return;
  const refusal = new AppError(
    "permission-denied",
    "Only an owner or editor of this item in Google Drive may link it. Ask its owner, or an administrator of the integrations, to link it.",
  );
  if (verifiedEmail === null) throw refusal;
  const address = verifiedEmail.toLowerCase();
  const permissions = await drive.listPermissions(fileId);
  const controls = permissions.some(
    (permission) =>
      permission.type === "user" &&
      permission.emailAddress?.toLowerCase() === address &&
      CONTROLLING_ROLES.has(permission.role),
  );
  if (!controls) throw refusal;
}

/** Refuses an item linked to a record of another replication or laboratory, for a caller without `integrations.manage`. */
export async function requireOneUnit(
  db: Firestore,
  access: ResolvedAccess,
  fileId: string,
  target: LinkTarget,
): Promise<void> {
  if (can(access, "integrations.manage", "programme")) return;
  const existing = await db
    .collection(COLLECTIONS.documentLinks.collectionPath())
    .where("externalId", "==", fileId)
    .limit(RESERVED_SCAN_LIMIT)
    .get();
  const elsewhere = existing.docs.some((document) => {
    const parsed = parseStoredDocument(documentLinkDocSchema, document.data());
    return (
      parsed.success &&
      parsed.data.archivedAt === null &&
      ((parsed.data.replicationId ?? null) !== target.replicationId ||
        (parsed.data.laboratoryId ?? null) !== target.laboratoryId)
    );
  });
  if (elsewhere) {
    throw new AppError(
      "failed-precondition",
      "This item is linked to a record of another replication or laboratory already. An administrator of the integrations may link it here too.",
    );
  }
}
