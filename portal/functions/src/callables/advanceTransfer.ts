import {
  advanceTransferContract,
  COLLECTIONS,
  compareManifest,
  datasetManifestDocSchema,
  datasetTransferDocSchema,
  manifestMatches,
  parseStoredDocument,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { readDataset, readManifestFiles, readRefs, requireForDataset } from "../datasets/model";
import { sameFolder } from "../datasets/refs";
import { AppError, callerStamp, defineCallable, readAccessDocument, touchedFields, writeAudit } from "../framework";

const NOT_FOUND = "This transfer does not exist.";

/**
 * Moves a transfer through its statuses (docs/DATA_MODEL.md, section 10), for a holder of
 * `datasets.manage` for the dataset's replication or laboratory. The portal moves no data: each
 * step records what people did, with the person and the time in the audit trail.
 *
 * | Action     | From                         | To                                                     |
 * |------------|------------------------------|--------------------------------------------------------|
 * | `approve`  | Initiated, awaiting approval | Approved, by someone other than the requester          |
 * | `refuse`   | Initiated, awaiting approval | Refused, which ends it                                 |
 * | `start`    | Initiated and approved       | In progress                                            |
 * | `complete` | In progress                  | Completed, with the bytes transferred where known      |
 * | `fail`     | Approved and not completed   | Failed, with the note as the error                     |
 * | `verify`   | Completed                    | Verified, when the two copies are in different places and the latest listing of the destination, made from that copy after completion, matches the latest listing of the source exactly |
 */
export const advanceTransfer = defineCallable(advanceTransferContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      const reference = db.doc(COLLECTIONS.datasetTransfers.docPath(input.datasetKey, input.transferId));
      const parsed = parseStoredDocument(datasetTransferDocSchema, (await transaction.get(reference)).data());
      if (!parsed.success) throw new AppError("not-found", NOT_FOUND);
      const transfer = parsed.data;
      const now = Timestamp.fromDate(at);
      const refuse = (message: string): never => {
        throw new AppError("failed-precondition", message);
      };
      const awaiting = transfer.status === "initiated" && transfer.approval === "pending";
      const approved = transfer.approval === "approved";
      let changes: Record<string, unknown>;
      switch (input.action) {
        case "approve":
        case "refuse": {
          if (!awaiting) refuse("This transfer is not waiting for approval.");
          if (transfer.initiatedBy === context.uid) {
            refuse("Someone other than the person who requested a transfer approves or refuses it.");
          }
          changes = {
            approval: input.action === "approve" ? "approved" : "rejected",
            decidedBy: context.uid,
            decidedAt: now,
            ...(input.note === "" ? {} : { decisionNote: input.note }),
          };
          break;
        }
        case "start":
          if (!(approved && transfer.status === "initiated"))
            refuse("Only an approved transfer that has not started can start.");
          changes = { status: "inProgress", startedAt: now };
          break;
        case "complete":
          if (!(approved && transfer.status === "inProgress")) refuse("Only a transfer in progress can be completed.");
          changes = {
            status: "completed",
            completedAt: now,
            ...(input.bytesTransferred === null ? {} : { bytesTransferred: input.bytesTransferred }),
          };
          break;
        case "fail":
          if (!(approved && (transfer.status === "initiated" || transfer.status === "inProgress"))) {
            refuse("Only an approved transfer that has not finished can fail.");
          }
          if (input.note === "") refuse("Say what went wrong.");
          changes = { status: "failed", error: input.note };
          break;
        case "verify": {
          if (transfer.status !== "completed" || transfer.completedAt === undefined) {
            refuse("Only a completed transfer can be verified.");
          }
          const refs = await readRefs(db, transaction, input.datasetKey);
          const source = refs.find((ref) => ref.id === transfer.fromRefId);
          const destination = refs.find((ref) => ref.id === transfer.toRefId);
          const destinationManifest = destination?.data.latestManifestId ?? null;
          const sourceManifest = source?.data.latestManifestId ?? null;
          if (
            destination === undefined ||
            destinationManifest === null ||
            destination.data.lastScanAt === null ||
            transfer.completedAt === undefined ||
            destination.data.lastScanAt.toMillis() < transfer.completedAt.toMillis()
          ) {
            refuse("List the destination copy after the transfer was completed, then verify it.");
          }
          if (sourceManifest === null || source === undefined)
            refuse("The source copy has never been listed, so there is nothing to compare with.");
          if (
            source !== undefined &&
            destination !== undefined &&
            (await sameFolder(db, transaction, input.datasetKey, source, destination))
          ) {
            refuse("The two copies name the same folder of the same server, so no listing can show that data moved.");
          }
          // The listing compared must be one of the destination itself, made after completion.
          const listing = parseStoredDocument(
            datasetManifestDocSchema,
            (
              await transaction.get(
                db.doc(COLLECTIONS.datasetManifests.docPath(input.datasetKey, destinationManifest as string)),
              )
            ).data(),
          );
          if (
            !listing.success ||
            listing.data.kind !== "listing" ||
            listing.data.storageRefId !== transfer.toRefId ||
            transfer.completedAt === undefined ||
            listing.data.listedAt.toMillis() < transfer.completedAt.toMillis()
          ) {
            refuse("List the destination copy after the transfer was completed, then verify it.");
          }
          const comparison = compareManifest(
            await readManifestFiles(db, transaction, input.datasetKey, destinationManifest as string),
            await readManifestFiles(db, transaction, input.datasetKey, sourceManifest as string),
          );
          if (!manifestMatches(comparison.counts)) {
            const counts = comparison.counts;
            refuse(
              `The destination does not match the source: ${counts.missing ?? 0} missing, ${counts.unexpected ?? 0} unexpected, ${counts.duplicate ?? 0} duplicated and ${counts.mismatch ?? 0} different files.`,
            );
          }
          changes = { status: "verified", verifiedAt: now, verificationManifestId: destinationManifest };
          break;
        }
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "transfer.advanced",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "transferId", after: input.transferId },
            { field: "action", after: input.action },
            {
              field: "status",
              before: transfer.status,
              after: (changes.status as string | undefined) ?? transfer.status,
            },
            ...(input.note === "" ? [] : [{ field: "note", after: input.note }]),
          ],
          at,
        },
        db,
      );
      const next = { ...transfer, ...changes };
      datasetTransferDocSchema.parse(next);
      transaction.update(reference, { ...changes, ...touchedFields(callerStamp(context.uid, at, auditEventId)) });
      return { status: next.status, approval: next.approval };
    });
  },
});
