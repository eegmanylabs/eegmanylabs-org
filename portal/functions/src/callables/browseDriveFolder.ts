import { browseDriveFolderContract } from "@eegml/shared";
import { AppError, defineCallable } from "../framework";
import { driveFailure, itemWithin, recordDriveOutcome, requireOpenLink } from "../integrations/browse";
import { DRIVE_FOLDER_MIME_TYPE } from "../integrations/google/types";
import { driveItemOf, interactiveAdapters, readableLink } from "../integrations/support";

/**
 * Lists a folder of a linked Drive folder as the portal's account sees it: direct children,
 * folders first, one page of up to 100 items, leaving out what the portal keeps for
 * synchronisation or generated documents. For whoever reads the link (its scope, or every member
 * where the link is not restricted), and only while the link is shared with the portal. Sharing a folder with the portal therefore shows the
 * names of its files to whoever reads the link, which the linking dialog says. Nothing is kept.
 */
export const browseDriveFolder = defineCallable(browseDriveFolderContract, {
  handler: async (input, context) => {
    const { link } = await readableLink(context.db, context, input.linkId);
    const linkedId = requireOpenLink(link);
    if (link.kind !== "driveFolder") throw new AppError("failed-precondition", "This link is not to a Drive folder.");
    const { adapters, identity } = interactiveAdapters();
    try {
      const { item, path, reserved } = await itemWithin(
        context.db,
        adapters.drive,
        linkedId,
        input.folderId ?? linkedId,
      );
      if (item.mimeType !== DRIVE_FOLDER_MIME_TYPE)
        throw new AppError("failed-precondition", "This item is not a folder.");
      const page = await adapters.drive.listChildren(item.id, input.pageToken, 100);
      await recordDriveOutcome(context.db, null, context.clock.now());
      return {
        folder: { id: item.id, name: item.name.slice(0, 300) },
        path: path.map((folder) => ({ id: folder.id, name: folder.name.slice(0, 300) })),
        // What the portal keeps for synchronisation or generated documents is never listed.
        items: page.files.filter((file) => !reserved.has(file.id)).map(driveItemOf),
        nextPageToken: page.nextPageToken ?? null,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      await recordDriveOutcome(context.db, error, context.clock.now());
      throw driveFailure(error, identity);
    }
  },
});
