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
  AddBlockButton,
  type DefaultReactSuggestionItem,
  DragHandleButton,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  type SideMenuProps,
  SuggestionMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useComponentsContext,
  useCreateBlockNote,
} from "@blocknote/react";
import { PAGE_FRAGMENT_NAME } from "@eegml/shared";
import { ListTodo, MessageSquarePlus, MousePointerClick, StickyNote, Table2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import { type PageSync, pageFileUrl, uploadPageFile } from "@/data/collaboration";
import { type ViewHost, ViewHostContext } from "@/views/host";
import { type Anchor, type AnchorStore, anchorOfSelection, CommentAnchors } from "./comment-anchors";
import { TextboxAttributes } from "./control-labels";
import { portalDictionary, shortcutText } from "./dictionary";
import { CodeLanguageGuard, PositionMappingGuard } from "./guards";
import { KeyboardAccess } from "./keyboard";
import { type PageEditorInstance, pageSchema } from "./schema";
import { EditorPageContext } from "./workflow-button";

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
  /** The block the cursor is in, with its text, or null where it holds no text to turn into a task. */
  currentLine(): { readonly blockId: string; readonly text: string } | null;
  /** Turns a block into the action item of a task, which then shows the task live. */
  makeActionItem(blockId: string, taskId: string, title: string): void;
  /** Whether the page holds nothing yet. */
  isEmpty(): boolean;
  /** The text of a block, empty for a block without text, or null where the page no longer holds it. */
  blockText(blockId: string): string | null;
  /** The identifier of the block the cursor is in. */
  cursorBlockId(): string | null;
  /** Writes the sections of a meeting into an empty page: its date, attendees, agenda, notes, decisions and action items. */
  insertMeetingSections(meeting: { readonly date: string; readonly attendees: readonly MentionCandidate[] }): void;
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
  /** The caller asks to turn the line of the cursor into an action item: a task linked to the page. */
  readonly onActionItem?: (line: { readonly blockId: string; readonly text: string }) => void;
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

/**
 * The items of the slash menu: those of BlockNote, with their shortcuts in words, then the
 * blocks of the portal, the callout and the linked view, in a group of their own.
 */
function slashItems(editor: PageEditorInstance, onActionItem: (() => void) | null): DefaultReactSuggestionItem[] {
  return [
    ...getDefaultReactSlashMenuItems(editor).map((item) =>
      item.badge === undefined ? item : { ...item, badge: shortcutText(item.badge) },
    ),
    {
      title: "Callout",
      subtext: "A highlighted note: information, a note, a warning or a danger",
      aliases: ["callout", "note", "info", "warning", "danger"],
      group: "Portal",
      icon: <StickyNote aria-hidden="true" size={18} strokeWidth={1.8} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { variant: "info" } }),
    },
    {
      title: "Button",
      subtext: "A button that adds a row, creates a task or creates a page when pressed",
      aliases: ["button", "workflow", "action", "automate"],
      group: "Portal",
      icon: <MousePointerClick aria-hidden="true" size={18} strokeWidth={1.8} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "workflowButton", props: {} }),
    },
    {
      title: "Linked view",
      subtext: "A live table, board, calendar or other view of records",
      aliases: ["linked", "view", "database", "table", "board"],
      group: "Portal",
      icon: <Table2 aria-hidden="true" size={18} strokeWidth={1.8} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "linkedView", props: {} }),
    },
    ...(onActionItem === null
      ? []
      : [
          {
            title: "Action item",
            subtext: "Turn this line into a task, with an assignee and a due date",
            aliases: ["action", "task", "todo", "assign"],
            group: "Portal",
            icon: <ListTodo aria-hidden="true" size={18} strokeWidth={1.8} />,
            onItemClick: onActionItem,
          },
        ]),
  ];
}

/** The text of a block, with each mention as the name it shows. */
function plainTextOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: unknown; props?: { label?: unknown } }) =>
      part.type === "text" && typeof part.text === "string"
        ? part.text
        : part.type === "mention" && typeof part.props?.label === "string"
          ? `@${part.props.label}`
          : "",
    )
    .join("")
    .trim();
}

/** The menu of a block's drag handle, without colours, which the portal does not offer. */
function PortalDragHandleMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{portalDictionary.drag_handle.delete_menuitem}</RemoveBlockItem>
      <TableRowHeaderItem>{portalDictionary.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{portalDictionary.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  );
}

/** The side menu of a block: add a block, and the drag handle with its menu. */
function PortalSideMenu(props: SideMenuProps) {
  return (
    <SideMenu {...props} dragHandleMenu={PortalDragHandleMenu}>
      <AddBlockButton />
      <DragHandleButton {...props} dragHandleMenu={PortalDragHandleMenu} />
    </SideMenu>
  );
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
      dictionary: portalDictionary,
      // Colours are not offered: the portal's palette has no colours for text (D-018).
      tables: { headers: true, splitCells: true, cellBackgroundColor: false, cellTextColor: false },
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
        TextboxAttributes(),
        CommentAnchors({ store: anchors }),
        KeyboardAccess({ onComment: () => commentOnSelection.current() }),
      ],
    }),
    [sync, anchors],
  );

  commentOnSelection.current = () => onComment(anchorOfSelection(editor.prosemirrorState));
  // The same component on every render, so that a render of the page around the editor, such as
  // another member joining, does not replace the toolbar and take the focus out of it.
  const formattingToolbar = useCallback(
    () => (
      <FormattingToolbar>
        {...getFormattingToolbarItems().filter((item) => item.key !== "colorStyleButton")}
        <CommentButton key="comment" onClick={() => commentOnSelection.current()} />
      </FormattingToolbar>
    ),
    [],
  );

  const { onReady, onActionItem } = props;
  const currentLine = useCallback(() => {
    const block = editor.getTextCursorPosition().block;
    const text = plainTextOf(block.content);
    return text === "" ? null : { blockId: block.id, text };
  }, [editor]);
  useEffect(() => {
    onReady({
      currentLine,
      makeActionItem(blockId, taskId, title) {
        editor.replaceBlocks([blockId], [{ type: "actionItem", props: { taskId, title } }]);
      },
      blockText(blockId) {
        const block = editor.getBlock(blockId);
        return block === undefined ? null : plainTextOf(block.content);
      },
      cursorBlockId() {
        return editor.getTextCursorPosition().block.id;
      },
      isEmpty() {
        const blocks = editor.document;
        return blocks.length === 0 || (blocks.length === 1 && plainTextOf(blocks[0]?.content) === "");
      },
      insertMeetingSections({ date, attendees }) {
        const heading = (text: string) => ({ type: "heading" as const, props: { level: 2 as const }, content: text });
        const blocks = [
          { type: "paragraph" as const, content: `Date: ${date}` },
          heading("Attendees"),
          ...(attendees.length === 0
            ? [{ type: "bulletListItem" as const, content: "" }]
            : attendees.map((attendee) => ({
                type: "bulletListItem" as const,
                content: [{ type: "mention" as const, props: { userId: attendee.uid, label: attendee.name } }],
              }))),
          heading("Agenda"),
          { type: "numberedListItem" as const, content: "" },
          heading("Notes"),
          { type: "paragraph" as const, content: "" },
          heading("Decisions"),
          { type: "bulletListItem" as const, content: "" },
          heading("Action items"),
          // An empty line: how to make it a task is said beside the page, never written into it.
          { type: "bulletListItem" as const, content: "" },
        ];
        editor.replaceBlocks(editor.document, blocks);
      },
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
  }, [editor, onReady, currentLine]);

  const members = props.members;
  return (
    <ViewHostContext.Provider value={props.viewHost}>
      <EditorPageContext.Provider value={props.pageId}>
        <BlockNoteView
          editor={editor}
          editable={props.editable}
          theme="light"
          slashMenu={false}
          formattingToolbar={false}
          sideMenu={false}
          className="portal-editor"
          data-testid="page-editor"
        >
          <FormattingToolbarController formattingToolbar={formattingToolbar} />
          <SideMenuController sideMenu={PortalSideMenu} />
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                slashItems(
                  editor,
                  onActionItem === undefined
                    ? null
                    : () => {
                        const line = currentLine();
                        if (line !== null) onActionItem(line);
                      },
                ),
                query,
              )
            }
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
      </EditorPageContext.Provider>
    </ViewHostContext.Provider>
  );
}
