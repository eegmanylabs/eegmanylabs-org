// The collaborative editor of a page (D-010): BlockNote, under the Mozilla Public Licence only,
// bound to the page's Yjs document that `PageSync` keeps in Firestore. Ported from the editor
// spike: the slash menu with the linked view of a collection (D-011); mentions of
// members; files and images in Cloud Storage; the two guards for defects of BlockNote 0.57;
// comment anchors kept in Firestore; and the keyboard access that the spike found missing.
import "@blocknote/mantine/style.css";
import "./editor.css";
import { codeBlockOptions, syntaxHighlighter } from "@blocknote/code-block";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import {
  type DefaultReactSuggestionItem,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  SuggestionMenuController,
  useComponentsContext,
  useCreateBlockNote,
} from "@blocknote/react";
import { PAGE_FRAGMENT_NAME } from "@eegml/shared";
import { MessageSquarePlus, StickyNote, Table2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import { type PageSync, pageFileUrl, uploadPageFile } from "@/data";
import { type ViewHost, ViewHostContext } from "@/views/host";
import { type Anchor, type AnchorStore, anchorOfSelection, CommentAnchors } from "./comment-anchors";
import { CodeLanguageGuard, PositionMappingGuard } from "./guards";
import { KeyboardAccess } from "./keyboard";
import { type PageEditorInstance, pageSchema } from "./schema";

/** A member who may be mentioned: the account and the name the directory shows. */
export interface MentionCandidate {
  readonly uid: string;
  readonly name: string;
}

/** What the page around the editor may ask of it. */
export interface PageEditorApi {
  /** The anchor of the selected text, or null where nothing is selected. */
  selectionAnchor(): Anchor | null;
  /**
   * Makes the page equal to a saved state as a new change, which every collaborator receives and
   * which can itself be undone. Unchanged blocks keep their identity, so comments stay in place.
   */
  restore(state: Uint8Array): void;
}

export interface PageEditorProps {
  readonly pageId: string;
  readonly uid: string;
  readonly userName: string;
  /** Whether the account may edit the page. Readers and commenters see it as it is. */
  readonly editable: boolean;
  readonly sync: PageSync;
  readonly members: readonly MentionCandidate[];
  readonly anchors: AnchorStore;
  /** The caller asks to comment on the selected text, with the anchor of the selection or null. */
  readonly onComment: (anchor: Anchor | null) => void;
  readonly onFileError: (message: string) => void;
  readonly onReady: (api: PageEditorApi) => void;
  /** The signed-in account, for the linked views of the page, which render in the editor's own root. */
  readonly viewHost: ViewHost | null;
}

/** The button that the formatting toolbar adds to the default ones: a comment on the selected text. */
function CommentButton({ onClick }: { readonly onClick: () => void }) {
  const components = useComponentsContext();
  if (components === undefined) return null;
  return (
    <components.FormattingToolbar.Button
      mainTooltip="Comment on the selection"
      secondaryTooltip="Control Alt M"
      label="Comment"
      icon={<MessageSquarePlus aria-hidden="true" size={16} strokeWidth={1.8} />}
      onClick={onClick}
    />
  );
}

/** The items of the slash menu: those of BlockNote, the callout and the linked view. */
function slashItems(editor: PageEditorInstance): DefaultReactSuggestionItem[] {
  return [
    ...getDefaultReactSlashMenuItems(editor),
    {
      title: "Callout",
      subtext: "A highlighted note: information, a note, a warning or a danger",
      aliases: ["callout", "note", "info", "warning", "danger"],
      group: "Basic blocks",
      icon: <StickyNote aria-hidden="true" size={18} strokeWidth={1.8} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { variant: "info" } }),
    },
    {
      title: "Linked view",
      subtext: "A live table, board, calendar or other view of records",
      aliases: ["linked", "view", "database", "table", "board"],
      group: "Portal",
      icon: <Table2 aria-hidden="true" size={18} strokeWidth={1.8} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "linkedView", props: {} }),
    },
  ];
}

export function PageEditor(props: PageEditorProps) {
  const { pageId, uid, sync, anchors, onComment, onFileError } = props;
  // The shortcut and the toolbar button reach the latest editor and callback through this.
  const commentOnSelection = useRef<() => void>(() => undefined);
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: pageSchema,
      collaboration: {
        fragment: sync.doc.getXmlFragment(PAGE_FRAGMENT_NAME),
        user: { name: props.userName, color: "var(--accent)" },
        provider: { awareness: sync.awareness },
        showCursorLabels: "activity",
      },
      tables: { headers: true, splitCells: true },
      domAttributes: { editor: { "aria-label": "Content of the page", "aria-multiline": "true" } },
      uploadFile: async (file: File) => {
        try {
          return await uploadPageFile(pageId, uid, file);
        } catch (error) {
          onFileError(error instanceof Error ? error.message : "The file could not be stored.");
          throw error;
        }
      },
      resolveFileUrl: pageFileUrl,
      extensions: [
        syntaxHighlighter,
        CodeLanguageGuard({ supported: codeBlockOptions.supportedLanguages }),
        PositionMappingGuard(),
        CommentAnchors({ store: anchors }),
        KeyboardAccess({ onComment: () => commentOnSelection.current() }),
      ],
    }),
    [sync, anchors],
  );

  commentOnSelection.current = () => onComment(anchorOfSelection(editor.prosemirrorState));

  const { onReady } = props;
  useEffect(() => {
    onReady({
      selectionAnchor: () => anchorOfSelection(editor.prosemirrorState),
      restore(state) {
        const saved = new Y.Doc();
        Y.applyUpdate(saved, state);
        const target = yXmlFragmentToProseMirrorRootNode(saved.getXmlFragment(PAGE_FRAGMENT_NAME), editor.pmSchema);
        saved.destroy();
        editor.transact((transaction) => {
          transaction.replaceWith(0, transaction.doc.content.size, target.content);
        });
      },
    });
  }, [editor, onReady]);

  const members = props.members;
  return (
    <ViewHostContext.Provider value={props.viewHost}>
      <BlockNoteView
        editor={editor}
        editable={props.editable}
        theme="light"
        slashMenu={false}
        formattingToolbar={false}
        className="portal-editor"
        data-testid="page-editor"
      >
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              {...getFormattingToolbarItems()}
              <CommentButton key="comment" onClick={() => commentOnSelection.current()} />
            </FormattingToolbar>
          )}
        />
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => filterSuggestionItems(slashItems(editor), query)}
        />
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={async (query) => {
            const typed = query.trim().toLowerCase();
            return members
              .filter((member) =>
                member.name
                  .toLowerCase()
                  .split(/\s+/)
                  .some((part) => part.startsWith(typed)),
              )
              .slice(0, 8)
              .map((member) => ({
                title: member.name,
                onItemClick: () =>
                  editor.insertInlineContent([
                    { type: "mention", props: { userId: member.uid, label: member.name } },
                    " ",
                  ]),
              }));
          }}
        />
      </BlockNoteView>
    </ViewHostContext.Provider>
  );
}
