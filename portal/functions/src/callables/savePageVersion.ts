import {
  atLeast,
  COLLECTIONS,
  type FirestoreBytes,
  PAGE_CHUNKS_PER_COMMIT,
  pageVersionChunkDocSchema,
  pageVersionDocSchema,
  savePageVersionContract,
  sequenceId,
} from "@eegml/shared";
import * as Y from "yjs";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  writeAudit,
} from "../framework";
import { bytesOf, chunksOf, concatenate, loadPageDocument } from "../pages/content";
import { levelOn, PAGE_NOT_FOUND_MESSAGE, readPage } from "../pages/pages";

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * Saves the content of a page, as it is stored now, as a version (D-010). Capability: the level
 * `edit` on the page. The version is a full Yjs state, independent of the updates and of their
 * compaction, in chunks that are written before the version that names them, so a version that
 * can be listed is complete. A version of the kind `auto` is saved only when the content has
 * changed since the latest version, and `versionId` is then null. A version of the kind `restore`
 * names the version that the editor has just restored as a new change. The audit entry is written
 * with the version.
 */
export const savePageVersion = defineCallable(savePageVersionContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
    const { page, state, stateVector, latest } = await db.runTransaction(
      async (transaction) => {
        const stored = await readPage(db, transaction, input.pageId);
        if (stored === null || !atLeast(levelOn(access, context.secondFactorVerified, stored.data), "view")) {
          throw new AppError("not-found", PAGE_NOT_FOUND_MESSAGE);
        }
        const doc = await loadPageDocument(db, stored.id, stored.data, transaction);
        const versions = db.collection(COLLECTIONS.pageVersions.collectionPath(stored.id));
        const newest = (await transaction.get(versions.orderBy("createdAt", "desc").limit(1))).docs[0];
        let latestVector: Uint8Array | null = null;
        if (newest !== undefined) {
          const chunks = await transaction.get(versions.doc(newest.id).collection("chunks"));
          const parts = chunks.docs
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((chunk) => bytesOf(chunk.get("snapshot") as FirestoreBytes));
          latestVector = Y.encodeStateVectorFromUpdate(concatenate(parts));
        }
        return {
          page: stored,
          state: Y.encodeStateAsUpdate(doc),
          stateVector: Y.encodeStateVector(doc),
          latest: latestVector,
        };
      },
      { readOnly: true },
    );
    if (!atLeast(levelOn(access, context.secondFactorVerified, page.data), "edit")) {
      throw new AppError("permission-denied", "You may not save versions of this page.");
    }
    if (input.kind === "auto" && (latest === null ? state.length <= 2 : sameBytes(latest, stateVector))) {
      return { versionId: null };
    }
    if (input.kind === "restore") {
      const restored = input.restoredFromVersionId;
      if (restored === undefined || !(await db.doc(COLLECTIONS.pageVersions.docPath(page.id, restored)).get()).exists) {
        throw new AppError("invalid-argument", "The version that was restored does not exist.");
      }
    }

    const version = db.collection(COLLECTIONS.pageVersions.collectionPath(page.id)).doc();
    const chunks = chunksOf(state);
    // The chunks first, a commit at a time, and the version that names them last.
    for (let start = 0; start < chunks.length; start += PAGE_CHUNKS_PER_COMMIT) {
      const batch = db.batch();
      chunks.slice(start, start + PAGE_CHUNKS_PER_COMMIT).forEach((snapshot, offset) => {
        const index = start + offset;
        const standard = createdFields("pageVersionChunks", callerStamp(uid, at, null));
        batch.set(
          db.doc(COLLECTIONS.pageVersionChunks.docPath(page.id, version.id, sequenceId(index))),
          pageVersionChunkDocSchema.parse({
            schemaVersion: standard.schemaVersion,
            createdAt: standard.createdAt,
            createdBy: standard.createdBy,
            writeContext: standard.writeContext,
            pageId: page.id,
            versionId: version.id,
            index,
            snapshot,
          }),
        );
      });
      await batch.commit();
    }
    const batch = db.batch();
    const auditEventId = writeAudit(
      batch,
      {
        action: "page.versionSaved",
        actor: { kind: "user", uid },
        entityType: "page",
        entityId: page.id,
        changes: [
          { field: "kind", after: input.kind },
          { field: "versionId", after: version.id },
          ...(input.restoredFromVersionId === undefined
            ? []
            : [{ field: "restoredFromVersionId", after: input.restoredFromVersionId }]),
        ],
        at,
      },
      db,
    );
    const standard = createdFields("pageVersions", callerStamp(uid, at, auditEventId));
    batch.set(
      version,
      pageVersionDocSchema.parse({
        schemaVersion: standard.schemaVersion,
        createdAt: standard.createdAt,
        createdBy: standard.createdBy,
        writeContext: standard.writeContext,
        pageId: page.id,
        ...(input.label === undefined ? {} : { label: input.label }),
        kind: input.kind,
        ...(input.restoredFromVersionId === undefined ? {} : { restoredFromVersionId: input.restoredFromVersionId }),
        chunkCount: chunks.length,
        byteLength: state.length,
      }),
    );
    await batch.commit();
    return { versionId: version.id };
  },
});
