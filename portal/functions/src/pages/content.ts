// The body of a page as trusted code reads it (D-010): the chunks of the generation that the
// page names and every complete update after it, built into one Yjs document. The plain text and
// the mentions come from a walk of that document with `yjs` alone, without the editor or a DOM,
// which is the converter the editor spike recommends for triggers: y-prosemirror stores every
// node of the editor as a `Y.XmlElement` named after its type, with its attributes, and text as
// `Y.XmlText`, so a mention is a `mention` element with `userId` and `label`.
import {
  COLLECTIONS,
  type FirestoreBytes,
  PAGE_CHUNK_BYTES,
  PAGE_FRAGMENT_NAME,
  type PageDoc,
  pageContentChunkId,
} from "@eegml/shared";
import type { DocumentData, Firestore, Query, Transaction } from "firebase-admin/firestore";
import * as Y from "yjs";

/** The bytes of a stored byte string, as the Admin SDK reads it. */
export const bytesOf = (value: FirestoreBytes): Uint8Array =>
  value instanceof Uint8Array ? value : value.toUint8Array();

/** Byte strings joined in order. */
export function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A byte string in parts of at most the size of one stored chunk, and at least one part. */
export function chunksOf(bytes: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += PAGE_CHUNK_BYTES) {
    parts.push(bytes.subarray(offset, Math.min(bytes.length, offset + PAGE_CHUNK_BYTES)));
  }
  return parts.length === 0 ? [bytes] : parts;
}

type Reader = Pick<Transaction, "get">;

/**
 * The Yjs document of a page as it is stored now: the snapshot that `contentHead` names and every
 * update whose parts have all arrived. Pass a transaction to read one consistent state; a read
 * outside one may meet a compaction halfway, which leaves an update applied twice and nothing
 * missing, because Yjs updates are idempotent.
 */
export async function loadPageDocument(
  db: Firestore,
  pageId: string,
  page: Pick<PageDoc, "contentHead">,
  reader?: Reader,
): Promise<Y.Doc> {
  const read = async (query: Query) => (reader === undefined ? query.get() : reader.get(query));
  const doc = new Y.Doc();
  if (page.contentHead !== null) {
    const chunks = await read(
      db
        .collection(COLLECTIONS.pageContent.collectionPath(pageId))
        .where("generation", "==", page.contentHead.generation),
    );
    const parts = chunks.docs
      .map((chunk) => chunk.data())
      .sort((a, b) => (a.index as number) - (b.index as number))
      .map((chunk) => bytesOf(chunk.snapshot as FirestoreBytes));
    if (parts.length === page.contentHead.chunkCount) Y.applyUpdate(doc, concatenate(parts));
  }
  const updates = await read(db.collection(COLLECTIONS.pageUpdates.collectionPath(pageId)));
  const groups = new Map<string, DocumentData[]>();
  for (const update of updates.docs) {
    const data = update.data();
    const group = groups.get(data.updateId as string) ?? [];
    group.push(data);
    groups.set(data.updateId as string, group);
  }
  for (const parts of groups.values()) {
    // A large update arrives in parts, and is applied only once every part is there.
    if (parts.length !== parts[0]?.count) continue;
    const ordered = [...parts].sort((a, b) => (a.index as number) - (b.index as number));
    Y.applyUpdate(doc, concatenate(ordered.map((part) => bytesOf(part.update as FirestoreBytes))));
  }
  return doc;
}

export interface PageMention {
  readonly uid: string;
  readonly label: string;
  /** The block that holds the mention. */
  readonly blockId: string | null;
}

export interface PageText {
  /** One line for each block that holds text, in the order of the page. */
  readonly lines: readonly string[];
  readonly mentions: readonly PageMention[];
}

/** The nodes of the editor that only group blocks or cells, whose text belongs to what they hold. */
const CONTAINERS = new Set(["blockGroup", "blockContainer", "tableRow", "tableCell", "tableHeader", "tableParagraph"]);

/** The plain text and the mentions of a page, from its Yjs document alone. */
export function extractPageText(doc: Y.Doc): PageText {
  const lines: string[] = [];
  const mentions: PageMention[] = [];
  interface Context {
    readonly blockId: string | null;
    readonly text: string[];
  }
  const walk = (node: unknown, context: Context): void => {
    if (node instanceof Y.XmlText) {
      context.text.push(
        node
          .toDelta()
          .map((part: { insert?: unknown }) => (typeof part.insert === "string" ? part.insert : ""))
          .join(""),
      );
      return;
    }
    if (!(node instanceof Y.XmlElement)) return;
    const name = node.nodeName;
    if (name === "mention") {
      const uid = node.getAttribute("userId");
      const label = node.getAttribute("label") ?? "";
      if (typeof uid === "string" && uid !== "") mentions.push({ uid, label, blockId: context.blockId });
      context.text.push(`@${label}`);
      return;
    }
    if (name === "blockContainer") {
      const id = node.getAttribute("id");
      const inner: Context = { blockId: typeof id === "string" ? id : null, text: [] };
      for (const child of node.toArray()) walk(child, inner);
      return;
    }
    if (CONTAINERS.has(name)) {
      for (const child of node.toArray()) walk(child, context);
      if (name === "tableCell" || name === "tableHeader") context.text.push(" ");
      return;
    }
    // A block of content: its text is one line.
    const own: Context = { blockId: context.blockId, text: [] };
    for (const child of node.toArray()) walk(child, own);
    const caption = node.getAttribute("caption");
    const fileName = node.getAttribute("name");
    const line = [
      own.text.join(""),
      typeof fileName === "string" ? fileName : "",
      typeof caption === "string" ? caption : "",
    ]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" ");
    if (line !== "") lines.push(line.replace(/\s+/g, " "));
  };
  for (const node of doc.getXmlFragment(PAGE_FRAGMENT_NAME).toArray()) walk(node, { blockId: null, text: [] });
  return { lines, mentions };
}

/** The uids that a page mentions, each once, sorted. */
export function mentionedUids(text: PageText): string[] {
  return [...new Set(text.mentions.map((mention) => mention.uid))].sort();
}

/** The identifier and the fields of each chunk of a snapshot of a generation, without the standard fields. */
export function contentChunks(
  pageId: string,
  generation: number,
  state: Uint8Array,
): { readonly id: string; readonly fields: Record<string, unknown> }[] {
  return chunksOf(state).map((snapshot, index) => ({
    id: pageContentChunkId(generation, index),
    fields: { pageId, generation, index, snapshot },
  }));
}
