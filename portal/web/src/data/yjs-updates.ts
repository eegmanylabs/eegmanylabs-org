// Applying a Yjs update that arrived from Firestore. The rules accept any bytes as an update from
// an editor, so one that does not decode must not stop the updates after it: it is skipped, and
// the page goes on with everything else. Decoding first leaves the document untouched by an
// update that is cut short halfway.
import * as Y from "yjs";

/** Applies an update to a document unless it does not decode. Returns whether it was applied. */
export function applyUpdateSafely(doc: Y.Doc, update: Uint8Array, origin: unknown): boolean {
  try {
    Y.decodeUpdate(update);
    Y.applyUpdate(doc, update, origin);
    return true;
  } catch {
    return false;
  }
}
