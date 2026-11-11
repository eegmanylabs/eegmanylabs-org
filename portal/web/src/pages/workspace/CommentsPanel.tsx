// The threads of a page (D-010): those anchored to a selection of its text and those about the
// page as a whole, with their comments, replies, mentions, and resolution. Those who may comment
// write here and nowhere in the page body, so the rules let them comment without editing.
import { commentSegments, type PageAccessLevel } from "@eegml/shared";
import { Check, MessageSquare, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import {
  addComment,
  createThread,
  editComment,
  REMOVED_COMMENT_TEXT,
  type RecordOf,
  removeComment,
  retryFailedLiveData,
  setThreadResolved,
  type ThreadAnchor,
  useLiveQuery,
} from "@/data";
import type { AnchoredThread, AnchorStore } from "@/editor/comment-anchors";
import type { Viewer } from "@/registry/viewer";
import { cn } from "@/utils/cn";
import { CommentComposer } from "./CommentComposer";
import type { Members } from "./members";
import { holds } from "./page-level";
import { commentsOfThread } from "./queries";

type Thread = RecordOf<"threads">;

/** The anchor of a thread, where it has a whole one. */
function anchorOf(thread: Thread): ThreadAnchor | null {
  const anchor = thread.anchor;
  if (anchor?.from === undefined || anchor.to === undefined || anchor.quote === undefined) return null;
  return { blockId: anchor.blockId ?? "", from: anchor.from, to: anchor.to, quote: anchor.quote };
}

/**
 * The store that the editor draws anchors from: the anchored threads of the page and the one
 * that is selected. It stays the same object for the life of the page, so the editor is created
 * once, and tells the editor whenever either changes.
 */
export function useAnchorStore(
  threads: readonly Thread[],
  selected: string | null,
  onSelect: (threadId: string) => void,
): AnchorStore {
  const state = useRef({
    threads: [] as AnchoredThread[],
    selected: null as string | null,
    onSelect,
    listeners: new Set<() => void>(),
  });
  state.current.onSelect = onSelect;
  const store = useMemo<AnchorStore>(
    () => ({
      threads: () => state.current.threads,
      selectedThreadId: () => state.current.selected,
      subscribe(listener) {
        state.current.listeners.add(listener);
        return () => state.current.listeners.delete(listener);
      },
      select: (threadId) => state.current.onSelect(threadId),
    }),
    [],
  );
  useEffect(() => {
    state.current.threads = threads.flatMap((thread) => {
      const anchor = anchorOf(thread);
      return anchor === null ? [] : [{ id: thread.id, anchor, resolved: thread.resolvedAt !== null }];
    });
    state.current.selected = selected;
    for (const listener of state.current.listeners) listener();
  }, [threads, selected]);
  return store;
}

/** One comment, with the actions its author may take on it. */
function CommentItem({
  comment,
  uid,
  members,
  canEdit,
}: {
  readonly comment: RecordOf<"threadComments">;
  readonly uid: string;
  readonly members: Members;
  readonly canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const removed = comment.deletedAt !== null;
  const author = comment.authorUid === undefined ? null : members.nameOf(comment.authorUid);
  const own = comment.authorUid === uid && !removed && canEdit;
  return (
    <li className="grid gap-1" data-testid="comment">
      <p className="text-xs text-fg-muted">
        <span className="font-medium text-fg-strong">{author ?? "A member"}</span>
        {" · "}
        <time dateTime={comment.createdAt.toDate().toISOString()}>{formatDateTime(comment.createdAt.toDate())}</time>
        {comment.editedAt !== null && !removed ? " · edited" : null}
      </p>
      {editing ? (
        <CommentComposer
          label="Edit your comment"
          submitLabel="Save"
          members={members.candidates}
          initialBody={comment.body}
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body, mentionUids) => {
            await editComment(uid, comment.threadId, comment.id, body, mentionUids);
            setEditing(false);
          }}
        />
      ) : (
        <p className={cn("break-words whitespace-pre-wrap", removed && "text-fg-muted italic")}>
          {removed
            ? REMOVED_COMMENT_TEXT
            : commentSegments(comment.body).map((segment, index) =>
                segment.kind === "text" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the segments of one body keep their order
                  <span key={index}>{segment.text}</span>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the segments of one body keep their order
                  <span key={index} className="portal-mention font-medium text-fg-accent">
                    @{segment.label}
                  </span>
                ),
              )}
        </p>
      )}
      {own && !editing ? (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              removeComment(uid, comment.threadId, comment.id).catch(() =>
                toast.show({ tone: "error", title: "The comment was not removed.", description: "Try again." }),
              )
            }
          >
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ThreadItem({
  thread,
  viewer,
  members,
  canComment,
  selected,
  onSelect,
}: {
  readonly thread: Thread;
  readonly viewer: Viewer;
  readonly members: Members;
  readonly canComment: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const comments = useLiveQuery(commentsOfThread(viewer, thread.id));
  const [replying, setReplying] = useState(false);
  const toast = useToast();
  const resolved = thread.resolvedAt !== null;
  const anchor = anchorOf(thread);
  const item = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) item.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const toggleResolved = () =>
    setThreadResolved(viewer.uid, thread.id, !resolved).catch(() =>
      toast.show({ tone: "error", title: "The thread was not changed.", description: "Try again." }),
    );
  return (
    <article
      ref={item}
      aria-label={anchor === null ? "Comment on the page" : `Comment on “${anchor.quote}”`}
      data-testid="thread"
      data-thread-id={thread.id}
      className={cn(
        "grid gap-2 rounded-tile border bg-surface p-3",
        selected ? "border-accent" : "border-border",
        resolved && "opacity-80",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 cursor-pointer rounded-control text-left text-fg-secondary hover:text-fg"
          aria-pressed={selected}
        >
          {anchor === null ? (
            <span className="text-xs">On the page as a whole</span>
          ) : (
            <q className="line-clamp-2 border-l-2 border-accent pl-2 text-xs not-italic">{anchor.quote}</q>
          )}
        </button>
        {resolved ? <Badge tone="outline">Resolved</Badge> : null}
      </div>
      <LiveView
        live={comments}
        loadingLabel="Loading the comments"
        errorTitle="The comments could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) => (
          <ol className="grid gap-3">
            {[...list]
              .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())
              .map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  uid={viewer.uid}
                  members={members}
                  canEdit={canComment}
                />
              ))}
          </ol>
        )}
      </LiveView>
      {canComment ? (
        <div className="flex flex-wrap gap-2">
          {replying || resolved ? null : (
            <Button size="sm" variant="outline" onClick={() => setReplying(true)}>
              <MessageSquare aria-hidden="true" strokeWidth={1.8} />
              Reply
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={toggleResolved}>
            {resolved ? (
              <RotateCcw aria-hidden="true" strokeWidth={1.8} />
            ) : (
              <Check aria-hidden="true" strokeWidth={1.8} />
            )}
            {resolved ? "Reopen" : "Resolve"}
          </Button>
        </div>
      ) : null}
      {replying ? (
        <CommentComposer
          label="Your reply"
          submitLabel="Reply"
          members={members.candidates}
          autoFocus
          onCancel={() => setReplying(false)}
          onSubmit={async (body, mentionUids) => {
            await addComment(viewer.uid, thread, body, mentionUids);
            setReplying(false);
          }}
        />
      ) : null}
    </article>
  );
}

export interface CommentsPanelProps {
  readonly page: RecordOf<"pages">;
  readonly viewer: Viewer;
  readonly level: PageAccessLevel;
  readonly threads: readonly Thread[];
  readonly members: Members;
  readonly selectedThreadId: string | null;
  readonly onSelectThread: (threadId: string | null) => void;
  /** A new thread being written: on a selection of the text, or on the page as a whole. */
  readonly draft: { readonly anchor: ThreadAnchor | null } | null;
  readonly onDraft: (draft: { readonly anchor: ThreadAnchor | null } | null) => void;
}

export function CommentsPanel({
  page,
  viewer,
  level,
  threads,
  members,
  selectedThreadId,
  onSelectThread,
  draft,
  onDraft,
}: CommentsPanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const canComment = holds(level, "comment") && page.archivedAt === null;
  const open = threads.filter((thread) => thread.resolvedAt === null);
  const shown = (showResolved ? threads : open).slice().sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  const resolvedCount = threads.length - open.length;
  return (
    <section aria-labelledby="comments-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="comments-heading" className="text-lg text-fg">
          Comments
        </h2>
        {canComment && draft === null ? (
          <Button size="sm" variant="outline" onClick={() => onDraft({ anchor: null })}>
            Comment on the page
          </Button>
        ) : null}
      </div>
      {draft === null ? null : (
        <div className="grid gap-2 rounded-tile border border-accent bg-surface p-3" data-testid="new-thread">
          {draft.anchor === null ? null : (
            <q className="line-clamp-3 border-l-2 border-accent pl-2 text-xs not-italic text-fg-secondary">
              {draft.anchor.quote}
            </q>
          )}
          <CommentComposer
            label={draft.anchor === null ? "Your comment on the page" : "Your comment on the selected text"}
            submitLabel="Comment"
            members={members.candidates}
            autoFocus
            onCancel={() => onDraft(null)}
            onSubmit={async (body, mentionUids) => {
              const threadId = await createThread(viewer.uid, page, draft.anchor, body, mentionUids);
              onDraft(null);
              onSelectThread(threadId);
            }}
          />
        </div>
      )}
      {resolvedCount > 0 ? (
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          Show {resolvedCount === 1 ? "the resolved thread" : `${resolvedCount} resolved threads`}
        </label>
      ) : null}
      {shown.length === 0 && draft === null ? (
        <EmptyState
          title="No comments yet"
          description={
            canComment
              ? "Select some text and choose Comment, or comment on the page as a whole."
              : "Comments on this page will appear here."
          }
        />
      ) : (
        <div className="grid gap-3">
          {shown.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              viewer={viewer}
              members={members}
              canComment={canComment}
              selected={thread.id === selectedThreadId}
              onSelect={() => onSelectThread(thread.id === selectedThreadId ? null : thread.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
