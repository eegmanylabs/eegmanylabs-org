// A saved version of a page, shown as it was and read only (D-010). The version is a full Yjs
// state, which a detached document holds for as long as it is shown, so the live page beside it
// keeps receiving the changes of others.
import "@blocknote/mantine/style.css";
import "./editor.css";
import { syntaxHighlighter } from "@blocknote/code-block";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { PAGE_FRAGMENT_NAME } from "@eegml/shared";
import { useMemo } from "react";
import * as Y from "yjs";
import { pageFileUrl } from "@/data";
import { pageSchema } from "./schema";

export function VersionPreview({ state }: { readonly state: Uint8Array }) {
  const doc = useMemo(() => {
    const saved = new Y.Doc();
    Y.applyUpdate(saved, state);
    return saved;
  }, [state]);
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: pageSchema,
      collaboration: { fragment: doc.getXmlFragment(PAGE_FRAGMENT_NAME), user: { name: "", color: "var(--accent)" } },
      resolveFileUrl: pageFileUrl,
      domAttributes: { editor: { "aria-label": "Content of the saved version, read only" } },
      extensions: [syntaxHighlighter],
    }),
    [doc],
  );
  return (
    <BlockNoteView
      editor={editor}
      editable={false}
      theme="light"
      slashMenu={false}
      formattingToolbar={false}
      sideMenu={false}
      className="portal-editor"
      data-testid="version-preview"
    />
  );
}
