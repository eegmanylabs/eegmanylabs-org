// What the browser editor and the functions agree on about the body of a page (D-010): the
// name of the Yjs fragment, the size of a stored chunk, the configurations of the custom blocks
// and inline content, the form of a comment body and the place of uploaded files.
//
// Only a configuration (its type name, its properties and its kind of content) decides how the
// Yjs document maps to blocks, so the browser schema and every reader on the server use exactly
// these objects. The renderers are the browser's own.

/** The `Y.XmlFragment` of a page's Yjs document that holds its blocks. */
export const PAGE_FRAGMENT_NAME = "document-store";

/**
 * The most bytes of a Yjs update or snapshot that one document holds. Firestore allows 1,048,487
 * bytes in one field value, and this leaves room for the other fields. A larger update or
 * snapshot is split into parts of this size.
 */
export const PAGE_CHUNK_BYTES = 900_000;

/** The most documents of one update or snapshot that one commit carries, so that it stays below 10 MiB. */
export const PAGE_CHUNKS_PER_COMMIT = 9;

/**
 * A linked view (D-011): a live view of a collection inside a page, either a saved view
 * (`viewId`) or a configuration of its own (`collectionKey`, `viewType` and `config`, the
 * configuration of a view as JSON text). The records are the documents of the collection
 * itself, so the block holds no copy of them.
 */
export const linkedViewBlockConfig = {
  type: "linkedView",
  propSchema: {
    viewId: { default: "" },
    title: { default: "" },
    collectionKey: { default: "" },
    viewType: { default: "table" },
    config: { default: "{}" },
  },
  content: "none",
} as const;

/** The kinds of callout. None of them is shown in green, which the visual system of the portal does not use. */
export const CALLOUT_VARIANTS = ["info", "note", "warning", "danger"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

/** A highlighted note with a kind of its own. */
export const calloutBlockConfig = {
  type: "callout",
  propSchema: {
    variant: { default: "info", values: CALLOUT_VARIANTS },
  },
  content: "inline",
} as const;

/** A mention of a member: their uid, and their name as it was when the mention was made. */
export const mentionInlineConfig = {
  type: "mention",
  propSchema: {
    userId: { default: "" },
    label: { default: "" },
  },
  content: "none",
} as const;

/** The most mentions one comment holds, which is the cap of `mentionUids`. */
export const COMMENT_MENTIONS_MAX = 50;

/** A piece of a comment body: plain text, or a mention of a member. */
export type CommentSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "mention"; readonly uid: string; readonly label: string };

// A mention in a comment body is written `@[Name](uid)`. A uid holds letters, digits, hyphens
// and underscores, and a name holds no square bracket.
const MENTION = /@\[([^[\]\n]{1,200})\]\(([A-Za-z0-9_-]{1,128})\)/g;

/** The text of a mention of a member in a comment body. */
export function commentMention(uid: string, label: string): string {
  const name = label.replace(/[[\]\n]/g, " ").trim() || "member";
  return `@[${name.slice(0, 200)}](${uid})`;
}

/** A comment body as text and mentions, in order. */
export function commentSegments(body: string): readonly CommentSegment[] {
  const segments: CommentSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: body.slice(last, index) });
    segments.push({ kind: "mention", label: match[1] ?? "", uid: match[2] ?? "" });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

/** The uids that a comment body mentions, each once, in the order of their first mention. */
export function commentMentionUids(body: string): string[] {
  const uids = commentSegments(body).flatMap((segment) => (segment.kind === "mention" ? [segment.uid] : []));
  return [...new Set(uids)].slice(0, COMMENT_MENTIONS_MAX);
}

/** A comment body as plain text, with each mention as the name it shows. */
export function commentPlainText(body: string): string {
  return commentSegments(body)
    .map((segment) => (segment.kind === "text" ? segment.text : `@${segment.label}`))
    .join("");
}

/** The largest file that a page accepts, in bytes. */
export const PAGE_FILE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Where an uploaded file of a page lives in Cloud Storage. The storage rules allow a file there
 * to those who may edit the page and serve it to those who may read it, so the place decides who
 * reads the file and the page body holds this path, never a download address.
 */
export function pageFilePath(pageId: string, fileId: string, fileName: string): string {
  const name =
    fileName
      .normalize("NFC")
      .replace(/[/\\\p{Cc}]+/gu, "-")
      .trim()
      .slice(-120) || "file";
  if (!/^[A-Za-z0-9]{20}$/.test(fileId))
    throw new RangeError("A file of a page has an identifier of twenty letters and digits.");
  if (pageId === "" || pageId.includes("/")) throw new RangeError("A page identifier holds no slash.");
  return `pages/${pageId}/files/${fileId}/${name}`;
}

/** What marks a file address in a page body as a path in Cloud Storage. */
export const PAGE_FILE_SCHEME = "portal-file:";
