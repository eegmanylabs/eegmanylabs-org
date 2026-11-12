import { countStatuses, recordManifestContract, validateManifest } from "@eegml/shared";
import { applyListing, readForListing } from "../datasets/listing";
import {
  isCurrent,
  REFERENCE_NOT_FOUND_MESSAGE,
  readDataset,
  readRefs,
  requireActive,
  requireForDataset,
  writeManifest,
} from "../datasets/model";
import { qcParticipants } from "../datasets/qc-task";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";

/**
 * Records a manifest of a dataset by hand or from an uploaded file (docs/INTEGRATIONS.md,
 * section 7), for a holder of `datasets.manage` for the dataset's replication or laboratory.
 *
 * | Kind       | What it records                                                                  |
 * |------------|----------------------------------------------------------------------------------|
 * | `expected` | The files the dataset should hold, with their sizes and checksums where known. It becomes the dataset's expected manifest, with which every later listing is compared, and sets the number of expected files |
 * | `listing`  | What one current copy held, listed inside the institution, for a server the portal cannot reach. It is compared with the expected manifest and does what a scan does |
 *
 * Every path is checked: none may be empty or leave the folder of the dataset, a size is a whole
 * number and a checksum is a digest of its algorithm. The audit entry records the kind and the
 * counts, never a path.
 */
export const recordManifest = defineCallable(recordManifestContract, {
  handler: async (input, context) => {
    const { db } = context;
    const problems = validateManifest(input.files);
    if (problems.length > 0) {
      const first = problems[0];
      throw new AppError(
        "invalid-argument",
        `${problems.length === 1 ? "One file" : `${problems.length} files`} of the manifest cannot be recorded. The first is file ${first?.position ?? 1}: ${first?.message ?? ""}`,
      );
    }
    if (input.kind === "listing" && input.storageRefId === null) {
      throw new AppError("invalid-argument", "Say which copy of the dataset the listing describes.");
    }
    const access = await readAccessDocument(db, context.uid);
    const dataset = await db.runTransaction((transaction) => readDataset(db, transaction, input.datasetKey));
    requireForDataset(context, access, "datasets.manage", dataset.data);
    const participants =
      input.kind === "listing" ? await qcParticipants(db, dataset.data) : { assignees: [], collaborators: [] };
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const current = await readDataset(db, transaction, input.datasetKey);
      requireActive(current);
      const refs = input.kind === "listing" ? await readRefs(db, transaction, input.datasetKey) : [];
      const ref = refs.find((candidate) => candidate.id === input.storageRefId);
      if (input.kind === "listing" && (ref === undefined || !isCurrent(ref.data))) {
        throw new AppError("not-found", REFERENCE_NOT_FOUND_MESSAGE);
      }
      const listing = input.kind === "listing" ? await readForListing(db, transaction, current) : null;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "manifest.recorded",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "kind", after: input.kind },
            { field: "origin", after: input.origin },
            { field: "fileCount", after: input.files.length },
            ...(ref === undefined ? [] : [{ field: "storageRefId", after: ref.id }]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      if (input.kind === "listing" && ref !== undefined && listing !== null) {
        const result = applyListing(db, transaction, {
          dataset: current,
          ref,
          reads: listing,
          files: input.files,
          origin: input.origin,
          participants,
          auditEventId,
          stamp,
        });
        return { manifestId: result.manifestId, counts: result.counts };
      }
      const files = input.files.map((file) => ({ ...file, status: "expected" as const }));
      const counts = countStatuses(files);
      const manifestId = writeManifest(
        db,
        transaction,
        current,
        { kind: "expected", storageRefId: null, origin: input.origin, expectedManifestId: null, files, counts },
        stamp,
      );
      transaction.update(current.reference, {
        expectedManifestId: manifestId,
        expectedFileCount: files.length,
        ...touchedFields(stamp),
      });
      return { manifestId, counts };
    });
  },
});
