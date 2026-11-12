import {
  COLLECTIONS,
  checkDriveLinkContract,
  documentLinkDocSchema,
  driveLinkTargetSchema,
  parseStoredDocument,
} from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";
import { recordDriveOutcome } from "../integrations/browse";
import { requireControl, requireUnreserved } from "../integrations/drive-guard";
import { authoriseLinkTarget, DRIVE_SILENT_MESSAGE } from "../integrations/drive-links";
import { ExternalServiceError } from "../integrations/google/types";
import { interactiveAdapters, linkKindOf } from "../integrations/support";

/**
 * Asks Drive again for a linked item: its name, owner, time of change and whether the portal's
 * account can still open it. For those who may link to the item's record, as
 * `linkDriveResource` decides it. An item that has gone or is no longer shared is marked
 * `restricted`, and the answer names the account to share it with.
 */
export const checkDriveLink = defineCallable(checkDriveLinkContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const reference = db.doc(COLLECTIONS.documentLinks.docPath(input.linkId));
    const link = parseStoredDocument(documentLinkDocSchema, (await reference.get()).data());
    if (!link.success || link.data.externalId === undefined)
      throw new AppError("not-found", "This linked item does not exist.");
    const entityType = driveLinkTargetSchema.safeParse(link.data.entityType);
    if (!entityType.success)
      throw new AppError("failed-precondition", "This link is checked by the import that created it.");
    const access = await readAccessDocument(db, uid);
    await authoriseLinkTarget(db, context, access, { entityType: entityType.data, entityId: link.data.entityId });
    const { adapters, identity } = interactiveAdapters();
    let file = null;
    try {
      file = await adapters.drive.getFile(link.data.externalId);
    } catch (error) {
      if (!(error instanceof ExternalServiceError) || (error.status !== 404 && error.status !== 403)) {
        await recordDriveOutcome(db, error, context.clock.now());
        throw new AppError("failed-precondition", DRIVE_SILENT_MESSAGE);
      }
    }
    if (file !== null) await recordDriveOutcome(db, null, context.clock.now());
    if (file !== null) {
      // A link opens to its readers only while the item is one its checker controls and the
      // portal keeps for no other purpose.
      try {
        await requireUnreserved(db, adapters.drive, link.data.externalId, file);
        await requireControl(adapters.drive, access, context.verifiedEmail, link.data.externalId);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("failed-precondition", DRIVE_SILENT_MESSAGE);
      }
    }
    const at = context.clock.now();
    const accessStatus: "shared" | "restricted" = file === null ? "restricted" : "shared";
    await db.runTransaction(async (transaction) => {
      const auditEventId = writeAudit(
        transaction,
        {
          action: "driveLink.checked",
          actor: { kind: "user", uid },
          entityType: "documentLink",
          entityId: input.linkId,
          changes: [{ field: "accessStatus", before: link.data.accessStatus, after: accessStatus }],
          at,
        },
        db,
      );
      transaction.update(reference, {
        accessStatus,
        lastCheckedAt: Timestamp.fromDate(at),
        ...(file === null
          ? {}
          : {
              kind: linkKindOf(file),
              title: file.name.slice(0, 300),
              modifiedAt: Timestamp.fromDate(new Date(file.modifiedTime)),
              ownerName: file.owners[0] === undefined ? FieldValue.delete() : file.owners[0].displayName.slice(0, 300),
            }),
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
    });
    return { accessStatus, shareWith: file === null ? identity : null };
  },
});
