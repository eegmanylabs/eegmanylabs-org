import { COLLECTIONS, documentLinkDocSchema, driveLinkTargetSchema, linkDriveResourceContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, createdFields, defineCallable, readAccessDocument, writeAudit } from "../framework";
import { recordDriveOutcome } from "../integrations/browse";
import { requireControl, requireOneUnit, requireUnreserved } from "../integrations/drive-guard";
import { authoriseLinkTarget, DRIVE_SILENT_MESSAGE, linkScopeKeys } from "../integrations/drive-links";
import { ExternalServiceError } from "../integrations/google/types";
import { driveIdOf, interactiveAdapters, linkKindOf, linkKindOfAddress } from "../integrations/support";

/**
 * Links a Drive file or folder to a replication, a laboratory, a manuscript or a dataset
 * (docs/INTEGRATIONS.md, section 3.2).
 *
 * | Caller                                               | May link to                                  |
 * |------------------------------------------------------|----------------------------------------------|
 * | A holder of `replications.manage` for a replication  | The replication and its manuscripts          |
 * | A holder of `labs.manage` for a laboratory           | The laboratory                               |
 * | A holder of `datasets.manage` for a dataset's replication or laboratory | The dataset, as the registry holds it |
 *
 * The portal's account reaches more than any one person, so the item must be one the caller
 * controls in Drive, must not be kept for synchronisation or generated documents, and must not be
 * linked to another unit's record already (`drive-guard.ts`); a holder of `integrations.manage`
 * is spared the first and the last. The function asks Drive for the item as the portal's account sees it and stores the link with
 * its name, owner, time of change and access status. An item the account cannot open is stored
 * as `restricted`, and the answer names the account to share it with. Linking the same item to
 * the same record again answers the link that exists.
 */
export const linkDriveResource = defineCallable(linkDriveResourceContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const fileId = driveIdOf(input.address);
    if (fileId === null)
      throw new AppError("invalid-argument", "This is not the address of a Google Drive file or folder.");
    const entityType = driveLinkTargetSchema.parse(input.entityType);
    const access = await readAccessDocument(db, uid);
    const target = await authoriseLinkTarget(db, context, access, { entityType, entityId: input.entityId });

    const existing = await db
      .collection(COLLECTIONS.documentLinks.collectionPath())
      .where("externalId", "==", fileId)
      .get();
    const same = existing.docs.find(
      (document) =>
        document.get("entityType") === entityType &&
        document.get("entityId") === input.entityId &&
        document.get("archivedAt") === null,
    );
    if (same !== undefined) {
      const status: unknown = same.get("accessStatus");
      return {
        linkId: same.id,
        accessStatus:
          status === "shared"
            ? ("shared" as const)
            : status === "unreachable"
              ? ("unreachable" as const)
              : ("restricted" as const),
        title: typeof same.get("title") === "string" ? String(same.get("title")) : null,
        shareWith: null,
      };
    }

    await requireOneUnit(db, access, fileId, target);
    const { adapters, identity } = interactiveAdapters();
    let file = null;
    try {
      file = await adapters.drive.getFile(fileId);
    } catch (error) {
      // Drive answers 404 alike for an item that does not exist and one that is not shared.
      if (!(error instanceof ExternalServiceError) || (error.status !== 404 && error.status !== 403)) {
        await recordDriveOutcome(db, error, context.clock.now());
        throw new AppError("failed-precondition", DRIVE_SILENT_MESSAGE);
      }
    }
    if (file !== null) await recordDriveOutcome(db, null, context.clock.now());
    try {
      await requireUnreserved(db, adapters.drive, fileId, file);
      // An item the portal cannot open yet is kept as restricted, and opens to the link's readers
      // only once someone who controls it checks it again (`checkDriveLink`).
      if (file !== null) await requireControl(adapters.drive, access, context.verifiedEmail, fileId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("failed-precondition", DRIVE_SILENT_MESSAGE);
    }
    const at = context.clock.now();
    const reference = db.collection(COLLECTIONS.documentLinks.collectionPath()).doc();
    const accessStatus: "shared" | "restricted" = file === null ? "restricted" : "shared";
    await db.runTransaction(async (transaction) => {
      const auditEventId = writeAudit(
        transaction,
        {
          action: "driveLink.created",
          actor: { kind: "user", uid },
          entityType: "documentLink",
          entityId: reference.id,
          changes: [
            { field: "entityType", after: entityType },
            { field: "entityId", after: input.entityId },
            { field: "accessStatus", after: accessStatus },
          ],
          at,
        },
        db,
      );
      transaction.create(
        reference,
        documentLinkDocSchema.parse({
          ...createdFields("documentLinks", callerStamp(uid, at, auditEventId)),
          entityType,
          entityId: input.entityId,
          kind: file === null ? linkKindOfAddress(input.address) : linkKindOf(file),
          url: file?.webViewLink ?? input.address,
          externalId: fileId,
          ...(file === null ? {} : { title: file.name.slice(0, 300) }),
          accessStatus,
          lastCheckedAt: Timestamp.fromDate(at),
          ...(file?.owners[0] === undefined ? {} : { ownerName: file.owners[0].displayName.slice(0, 300) }),
          ...(file === null ? {} : { modifiedAt: Timestamp.fromDate(new Date(file.modifiedTime)) }),
          restricted: input.restricted,
          replicationId: target.replicationId,
          laboratoryId: target.laboratoryId,
          scopeKeys: linkScopeKeys(target, input.restricted),
        }),
      );
    });
    return {
      linkId: reference.id,
      accessStatus,
      title: file?.name.slice(0, 300) ?? null,
      shareWith: file === null ? identity : null,
    };
  },
});
