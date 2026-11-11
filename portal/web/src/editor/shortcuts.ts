// The keyboard shortcuts of the page editor, as the dialog of shortcuts lists them. Kept apart
// from the editor itself, so that the dialog does not load the editor.
export const KEYBOARD_SHORTCUTS: readonly { readonly keys: string; readonly does: string }[] = [
  { keys: "/", does: "Open the menu of blocks to insert" },
  { keys: "@", does: "Mention a member, who is notified" },
  { keys: "Alt F10", does: "Move to the formatting toolbar of the selection, or of the current block" },
  { keys: "Left and Right arrows", does: "Move between the buttons of the formatting toolbar" },
  { keys: "Escape", does: "Leave the toolbar and return to the text" },
  { keys: "Control Alt M", does: "Comment on the selected text" },
  { keys: "Control Shift Up arrow", does: "Move the current block up" },
  { keys: "Control Shift Down arrow", does: "Move the current block down" },
  { keys: "Tab and Shift Tab", does: "Indent and outdent a list item, or move between table cells" },
  { keys: "Control Z and Control Shift Z", does: "Undo and redo your own changes" },
  { keys: "Control B, I and U", does: "Bold, italic and underline" },
  { keys: "Control Alt 1, 2 and 3", does: "Turn the block into a heading of that level" },
  { keys: "Control Shift 7, 8 and 9", does: "Turn the block into a numbered, bulleted or check list" },
];
