// Who edited a page and when (R3.23): one entry for each spell of editing of a member, which the
// trigger of an editor's update records from the update documents, and who last changed each
// block, which the same trigger resolves in the stored document. Neither holds content: the text
// of a block shown beside its attribution is read from the page in this browser.
import { type RefObject, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import type { PageEditorApi } from "@/editor/PageEditor";
import type { Viewer } from "@/registry/viewer";
import type { Members } from "./members";
import { activityOfPage, blockEditsOfPage } from "./queries";

/** The most blocks listed under Blocks, latest first. */
const BLOCKS_SHOWN = 20;
/** The longest excerpt of a block's text that names it in the list. */
const EXCERPT = 80;

function excerpt(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed === "") return "A block without text";
  return trimmed.length > EXCERPT ? `“${trimmed.slice(0, EXCERPT - 1)}…”` : `“${trimmed}”`;
}

function When({ at }: { readonly at: Date }) {
  return (
    <span className="block text-xs text-fg-secondary">
      <time dateTime={at.toISOString()}>{formatDateTime(at)}</time>
    </span>
  );
}

/** The latest change of each block that the page still holds, and the block at the cursor. */
function BlockEdits({
  pageId,
  members,
  editor,
}: {
  readonly pageId: string;
  readonly members: Members;
  readonly editor: RefObject<PageEditorApi | null>;
}) {
  const edits = useLiveQuery(blockEditsOfPage(pageId));
  const [atCursor, setAtCursor] = useState<string | null | undefined>(undefined);
  const nameOf = (edit: RecordOf<"pageBlockEdits">) => members.nameOf(edit.editorUid) ?? "A member";
  return (
    <section aria-labelledby="block-edits-heading" className="grid gap-2">
      <h3 id="block-edits-heading" className="text-base text-fg">
        Blocks
      </h3>
      <LiveView
        live={edits}
        loadingLabel="Loading who changed each block"
        errorTitle="Who changed each block could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) => {
          const shown = list.flatMap((edit) => {
            const text = editor.current?.blockText(edit.blockId) ?? null;
            return text === null ? [] : [{ edit, text }];
          });
          const cursorEdit =
            atCursor === undefined || atCursor === null ? null : list.find((edit) => edit.blockId === atCursor);
          return (
            <>
              <div className="grid gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-self-start"
                  onClick={() => setAtCursor(editor.current?.cursorBlockId() ?? null)}
                >
                  Who changed the block at the cursor
                </Button>
                {atCursor === undefined ? null : (
                  <p role="status" className="text-sm text-fg-secondary" data-testid="block-at-cursor">
                    {cursorEdit === null || cursorEdit === undefined
                      ? "No change to this block has been recorded."
                      : `${nameOf(cursorEdit)} last changed this block, ${formatDateTime(cursorEdit.editedAt.toDate())}.`}
                  </p>
                )}
              </div>
              {shown.length === 0 ? (
                <p className="text-sm text-fg-muted">No change to a block has been recorded yet.</p>
              ) : (
                <ol className="grid gap-2" aria-label="Blocks, latest change first">
                  {shown.slice(0, BLOCKS_SHOWN).map(({ edit, text }) => (
                    <li
                      key={edit.id}
                      className="rounded-tile border border-border bg-surface px-3 py-2"
                      data-testid="block-edit"
                    >
                      <span className="block break-words text-fg-secondary">{excerpt(text)}</span>
                      <span className="font-medium text-fg">{nameOf(edit)}</span>
                      <When at={edit.editedAt.toDate()} />
                    </li>
                  ))}
                </ol>
              )}
            </>
          );
        }}
      </LiveView>
    </section>
  );
}

export function ActivityPanel({
  pageId,
  viewer,
  members,
  editor,
}: {
  readonly pageId: string;
  readonly viewer: Viewer;
  readonly members: Members;
  readonly editor: RefObject<PageEditorApi | null>;
}) {
  const activity = useLiveQuery(activityOfPage(viewer, pageId));
  return (
    <section aria-labelledby="activity-heading" className="grid gap-3">
      <h2 id="activity-heading" className="text-lg text-fg">
        Activity
      </h2>
      <LiveView
        live={activity}
        loadingLabel="Loading the activity"
        errorTitle="The activity could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(entries) => {
          const edits = entries.filter((entry) => entry.entityType === "page");
          return edits.length === 0 ? (
            <EmptyState
              title="No edits yet"
              description="Each spell of editing appears here, with who edited and when."
            />
          ) : (
            <ol className="grid gap-2" aria-label="Edits, newest first">
              {edits.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-tile border border-border bg-surface px-3 py-2"
                  data-testid="activity"
                >
                  <span className="font-medium text-fg">
                    {(entry.actorUid === null ? null : members.nameOf(entry.actorUid)) ?? "A member"}
                  </span>{" "}
                  edited the page
                  <When at={entry.createdAt.toDate()} />
                </li>
              ))}
            </ol>
          );
        }}
      </LiveView>
      <BlockEdits pageId={pageId} members={members} editor={editor} />
    </section>
  );
}
