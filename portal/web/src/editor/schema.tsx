// The schema of the page editor (D-010): the blocks of BlockNote, a callout, a linked view and
// the mention of a member. The configurations come from the shared package, which the functions
// read pages with, so a page means the same in the browser and on the server.

import { codeBlockOptions } from "@blocknote/code-block";
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import {
  actionItemBlockConfig,
  CALLOUT_VARIANTS,
  type CalloutVariant,
  calloutBlockConfig,
  linkedViewBlockConfig,
  mentionInlineConfig,
} from "@eegml/shared";
import { CircleAlert, Info, NotebookPen, OctagonAlert } from "lucide-react";
import { ActionItemBlock } from "./action-item";
import { withControlLabels } from "./control-labels";
import { LinkedViewBlock } from "./linked-view";

const CALLOUT_LABELS: Readonly<Record<CalloutVariant, string>> = {
  info: "Information",
  note: "Note",
  warning: "Warning",
  danger: "Danger",
};

const CALLOUT_ICONS = { info: Info, note: NotebookPen, warning: CircleAlert, danger: OctagonAlert } as const;

/** A highlighted note. An editor changes its kind with the button at its start. */
const callout = createReactBlockSpec(calloutBlockConfig, {
  render: ({ block, editor, contentRef }) => {
    const Icon = CALLOUT_ICONS[block.props.variant];
    const next = CALLOUT_VARIANTS[(CALLOUT_VARIANTS.indexOf(block.props.variant) + 1) % CALLOUT_VARIANTS.length];
    return (
      <div className="portal-callout" data-variant={block.props.variant}>
        <button
          type="button"
          contentEditable={false}
          className="portal-callout-kind"
          aria-label={`${CALLOUT_LABELS[block.props.variant]} callout. Change to ${CALLOUT_LABELS[next ?? "info"].toLowerCase()}`}
          disabled={!editor.isEditable}
          onClick={() => editor.updateBlock(block, { props: { variant: next ?? "info" } })}
        >
          <Icon aria-hidden="true" strokeWidth={1.8} />
        </button>
        <div className="portal-callout-text" ref={contentRef} />
      </div>
    );
  },
  toExternalHTML: ({ block, contentRef }) => (
    <blockquote data-callout={block.props.variant}>
      <p ref={contentRef} />
    </blockquote>
  ),
});

/**
 * A linked view (D-011): a live view of a collection inside the page. An editor chooses its
 * records and its view, and a change of the view is written back into the block, so that
 * everyone who opens the page sees the same view.
 */
const linkedView = createReactBlockSpec(linkedViewBlockConfig, {
  render: ({ block, editor }) => (
    <div contentEditable={false} className="w-full">
      <LinkedViewBlock
        props={block.props}
        editable={editor.isEditable}
        onChange={(next) => editor.updateBlock(block, { props: next })}
      />
    </div>
  ),
  toExternalHTML: ({ block }) => <p data-linked-view={block.props.viewId}>{block.props.title}</p>,
});

/** An action item of a meeting: a line turned into a task, shown live from the task. */
const actionItem = createReactBlockSpec(actionItemBlockConfig, {
  render: ({ block }) => (
    <div contentEditable={false} className="w-full">
      <ActionItemBlock taskId={block.props.taskId} title={block.props.title} />
    </div>
  ),
  toExternalHTML: ({ block }) => <p data-action-item={block.props.taskId}>{block.props.title}</p>,
});

/** A mention of a member. The uid is what counts. The name is the one the member had when mentioned. */
const mention = createReactInlineContentSpec(mentionInlineConfig, {
  render: ({ inlineContent }) => (
    <span className="portal-mention" data-user-id={inlineContent.props.userId}>
      @{inlineContent.props.label}
    </span>
  ),
  toExternalHTML: ({ inlineContent }) => (
    <span data-mention={inlineContent.props.userId}>@{inlineContent.props.label}</span>
  ),
});

export const pageSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    // The controls these blocks draw are named, and their headings stepped down, as they are drawn.
    codeBlock: withControlLabels(createCodeBlockSpec(codeBlockOptions)),
    checkListItem: withControlLabels(defaultBlockSpecs.checkListItem),
    heading: withControlLabels(defaultBlockSpecs.heading),
    callout: callout(),
    linkedView: linkedView(),
    actionItem: actionItem(),
  },
  inlineContentSpecs: { mention },
});

export type PageEditorInstance = typeof pageSchema.BlockNoteEditor;
