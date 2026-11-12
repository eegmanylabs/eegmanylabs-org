import { previewDriveFileContract } from "@eegml/shared";
import { AppError, defineCallable } from "../framework";
import { driveFailure, itemWithin, recordDriveOutcome, requireOpenLink } from "../integrations/browse";
import { driveItemOf, interactiveAdapters, readableLink } from "../integrations/support";

/**
 * Describes a linked file, or a file inside a linked folder: its metadata and Google's own address
 * for it, for whoever reads the link, as `browseDriveFolder` decides it. The portal never relays
 * the content of a file (docs/INTEGRATIONS.md, section 3.2): the reader opens it at Google's
 * address, where Google applies the reader's own permissions. Nothing is kept.
 */
export const previewDriveFile = defineCallable(previewDriveFileContract, {
  handler: async (input, context) => {
    const { link } = await readableLink(context.db, context, input.linkId);
    const linkedId = requireOpenLink(link);
    const { adapters, identity } = interactiveAdapters();
    try {
      const { item } = await itemWithin(context.db, adapters.drive, linkedId, input.fileId ?? linkedId);
      await recordDriveOutcome(context.db, null, context.clock.now());
      return { file: driveItemOf(item) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      await recordDriveOutcome(context.db, error, context.clock.now());
      throw driveFailure(error, identity);
    }
  },
});
