import {
  COLLECTIONS,
  datasetStorageRefLocationDocSchema,
  normaliseStoragePath,
  parseStoredDocument,
  type StorageScanStatus,
  scanStorageRefContract,
} from "@eegml/shared";
import { isOutage, readForHealth, recordHealth } from "../datasets/endpoints";
import { applyListing, applyScanFailure, readForListing } from "../datasets/listing";
import {
  isCurrent,
  REFERENCE_NOT_FOUND_MESSAGE,
  readDataset,
  readEndpoint,
  readRefs,
  requireActive,
  requireForDataset,
  targetOf,
} from "../datasets/model";
import { qcParticipants } from "../datasets/qc-task";
import { AppError, callerStamp, defineCallable, readAccessDocument, writeAudit } from "../framework";
import { SCANS_NOT_ENABLED_MESSAGE, storageRuntime } from "../integrations/storage/adapters";
import { scanTarget } from "../integrations/storage/scan";

/** What a person reads about each outcome of a scan. */
const SCAN_MESSAGES: Readonly<Record<Exclude<StorageScanStatus, "never">, string>> = {
  ok: "The copy was listed and compared with the expected files.",
  unreachable:
    "The server did not answer. The last listing stays, with the time the copy was last seen. Try again later.",
  permissionDenied:
    "The server refused the portal's account for this copy. Ask the institution to restore the read-only access.",
  timeout: "The server answered too slowly. The last listing stays. Try again later.",
  notFound: "The path of this copy does not exist on the server. Check the path, or relocate the copy.",
  failed: "The scan could not be completed. The last listing stays.",
};

/**
 * Scans a copy of a dataset (docs/INTEGRATIONS.md, section 7), for a holder of `datasets.manage`
 * for the dataset's replication or laboratory. The scan lists the files of the copy with their
 * sizes and modification times and joins the checksums the server holds; it never reads a
 * recording and moves nothing. A listing that succeeds is compared with the expected manifest and
 * stored, marks the copy available and seen, and verified where it matches; the first that finds
 * files opens the quality-control task. A scan that fails writes no listing: the copy is marked
 * unavailable with the reason and keeps its last listing and the time it was last seen, and a
 * server that is down or too slow becomes unreachable, which its owner and the administrators are
 * told once. Every scan is audited with its outcome and counts, never with a path.
 */
export const scanStorageRef = defineCallable(scanStorageRefContract, {
  handler: async (input, context) => {
    const { db } = context;
    const access = await readAccessDocument(db, context.uid);
    const before = await db.runTransaction(async (transaction) => {
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      const refs = await readRefs(db, transaction, input.datasetKey);
      const ref = refs.find((candidate) => candidate.id === input.storageRefId);
      if (ref === undefined) throw new AppError("not-found", REFERENCE_NOT_FOUND_MESSAGE);
      if (!isCurrent(ref.data))
        throw new AppError("failed-precondition", "This copy has been closed and is not scanned.");
      const endpoint = await readEndpoint(db, transaction, ref.data.endpointKey);
      const location = parseStoredDocument(
        datasetStorageRefLocationDocSchema,
        (await transaction.get(db.doc(COLLECTIONS.datasetStorageRefLocation.docPath(input.datasetKey, ref.id)))).data(),
      );
      if (!location.success) throw new AppError("failed-precondition", "This copy has no recorded location.");
      // A path recorded before paths were checked may name the whole server or leave its folder.
      const uri = normaliseStoragePath(location.data.uri);
      if (uri === null) {
        throw new AppError(
          "failed-precondition",
          "The recorded path of this copy is not a folder below the server's base path. Relocate the copy.",
        );
      }
      return { dataset, endpoint, uri };
    });
    if (before.endpoint.data.scanMode === "uploadedManifest") {
      throw new AppError(
        "failed-precondition",
        "This server is described by manifests made inside the institution. Upload a listing of the copy instead.",
      );
    }
    const runtime = storageRuntime();
    if (runtime === null) throw new AppError("failed-precondition", SCANS_NOT_ENABLED_MESSAGE);
    const adapter = runtime.adapterFor(before.endpoint.data.protocol);
    const target = targetOf(before.endpoint.data, before.endpoint.connection, before.uri);
    if (adapter === null || target === null) {
      throw new AppError(
        "failed-precondition",
        "The portal has no way to reach a server of this protocol. Upload a listing instead.",
      );
    }
    const participants = await qcParticipants(db, before.dataset.data);
    const outcome = await scanTarget(adapter, target, runtime.requestTimeoutMs);
    const at = context.clock.now();

    return db.runTransaction(async (transaction) => {
      const dataset = await readDataset(db, transaction, input.datasetKey);
      const refs = await readRefs(db, transaction, input.datasetKey);
      const ref = refs.find((candidate) => candidate.id === input.storageRefId);
      if (ref === undefined || !isCurrent(ref.data)) {
        throw new AppError("failed-precondition", "This copy changed while it was scanned. Scan it again.");
      }
      const endpoint = await readEndpoint(db, transaction, ref.data.endpointKey);
      const health = await readForHealth(db, transaction, ref.data.endpointKey, endpoint.reference, endpoint.data);
      const listing = outcome.ok ? await readForListing(db, transaction, dataset) : null;
      const status: Exclude<StorageScanStatus, "never"> = outcome.ok ? "ok" : outcome.kind;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "storageRef.scanned",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "storageRefId", after: ref.id },
            { field: "outcome", after: status },
            ...(outcome.ok ? [{ field: "fileCount", after: outcome.files.length }] : []),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      if (outcome.ok && listing !== null) {
        recordHealth(db, transaction, health, { reached: true }, auditEventId, stamp);
        const result = applyListing(db, transaction, {
          dataset,
          ref,
          reads: listing,
          files: outcome.files,
          origin: "scan",
          participants,
          auditEventId,
          stamp,
        });
        return { status, manifestId: result.manifestId, counts: result.counts, message: SCAN_MESSAGES.ok };
      }
      if (!outcome.ok) {
        recordHealth(
          db,
          transaction,
          health,
          { reached: false, kind: outcome.kind, message: outcome.message },
          auditEventId,
          stamp,
        );
        applyScanFailure(transaction, { dataset, ref, refs, status: outcome.kind, stamp });
        context.logger.warn("A scan of a storage reference failed.", {
          datasetKey: input.datasetKey,
          storageRefId: ref.id,
          kind: outcome.kind,
          outage: isOutage(outcome.kind),
        });
      }
      return { status, manifestId: null, counts: {}, message: SCAN_MESSAGES[status] };
    });
  },
});
