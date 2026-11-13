// The progress log of a replication, a laboratory or a member: a dated feed of updates, newest
// first, of which the latest pinned one stands at the top. Its team, its members or the member
// post updates, which never change, and those who follow the record are told of each.
import {
  commentSegments,
  PROGRESS_UPDATE_MENTIONS_MAX,
  type ProgressUpdateEntityType,
  postProgressUpdateContract,
} from "@eegml/shared";
import { Pin } from "lucide-react";
import { useState } from "react";
import { LiveView } from "@/components/feedback/live-view";
import { FollowButton } from "@/components/registry/follow-button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { callFunction, type LiveQuery, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { CommentComposer } from "@/pages/workspace/CommentComposer";
import { useMembers } from "@/pages/workspace/members";
import type { Viewer } from "@/registry/viewer";
import { messageOf } from "./task-writes";

export interface UpdatesTabProps {
  readonly viewer: Viewer;
  readonly entityType: ProgressUpdateEntityType;
  readonly entityId: string;
  /** Whether the viewer may post, which the function decides again. */
  readonly canPost: boolean;
}

/** The updates of a record, newest first. Every member reads them. */
export function updatesOf(entityType: ProgressUpdateEntityType, entityId: string): LiveQuery<"progressUpdates"> {
  return {
    collection: "progressUpdates",
    within: [],
    where: [
      ["entityType", "==", entityType],
      ["entityId", "==", entityId],
    ],
    orderBy: [["createdAt", "desc"]],
    limit: 100,
  };
}

function UpdateBody({ body }: { readonly body: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm">
      {commentSegments(body).map((segment, index) =>
        segment.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the segments of a text that never changes
          <span key={index}>{segment.text}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the segments of a text that never changes
          <span key={index} className="font-medium text-fg-accent">
            @{segment.label}
          </span>
        ),
      )}
    </p>
  );
}

function Entry({
  update,
  nameOf,
  pinnedAtTop,
}: {
  readonly update: RecordOf<"progressUpdates">;
  readonly nameOf: (uid: string) => string;
  readonly pinnedAtTop?: boolean;
}) {
  return (
    <article className="grid gap-1 rounded-tile border border-border bg-surface p-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {pinnedAtTop === true ? (
          <Badge tone="accent">
            <Pin aria-hidden="true" size={12} /> Pinned
          </Badge>
        ) : update.pinned ? (
          <Badge tone="outline">Pinned when posted</Badge>
        ) : null}
        <span>
          {nameOf(update.authorUid)},{" "}
          <time dateTime={update.createdAt.toDate().toISOString()}>
            {update.createdAt.toDate().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </time>
        </span>
      </p>
      <UpdateBody body={update.body} />
    </article>
  );
}

export function UpdatesTab({ viewer, entityType, entityId, canPost }: UpdatesTabProps) {
  const updates = useLiveQuery(updatesOf(entityType, entityId));
  const members = useMembers(true);
  const [pinned, setPinned] = useState(false);
  const [posted, setPosted] = useState(false);
  const nameOf = (uid: string) => members.nameOf(uid) ?? "A member";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary">
          A dated log of progress. Those who follow it are told of each update.
        </p>
        <FollowButton uid={viewer.uid} entityType={entityType} entityId={entityId} />
      </div>
      {canPost ? (
        <div className="grid gap-2 rounded-tile border border-border bg-surface p-3">
          <CommentComposer
            label="New progress update"
            submitLabel="Post the update"
            members={members.candidates}
            mentionsMax={PROGRESS_UPDATE_MENTIONS_MAX}
            beforeSubmit={
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-accent-strong"
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                />
                Pin this update at the top
              </label>
            }
            onSubmit={async (body, mentionUids) => {
              setPosted(false);
              try {
                await callFunction(postProgressUpdateContract, {
                  entityType,
                  entityId,
                  body,
                  mentionUids: [...mentionUids],
                  pinned,
                });
              } catch (failure) {
                throw new Error(messageOf(failure, "The update was not posted."));
              }
              setPinned(false);
              setPosted(true);
            }}
          />
          {posted ? (
            <p role="status" className="text-xs text-fg-muted">
              The update was posted.
            </p>
          ) : null}
        </div>
      ) : null}
      <LiveView
        live={updates}
        loadingLabel="Loading the updates"
        errorTitle="The updates could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) => {
          const top = list.find((update) => update.pinned);
          return list.length === 0 ? (
            <EmptyState
              title="No updates yet"
              description={canPost ? "Post the first update above." : "Updates appear here when they are posted."}
            />
          ) : (
            <div className="grid gap-3">
              {top === undefined ? null : <Entry update={top} nameOf={nameOf} pinnedAtTop />}
              <ol className="grid gap-2" aria-label="Updates, newest first">
                {list
                  .filter((update) => update.id !== top?.id)
                  .map((update) => (
                    <li key={update.id}>
                      <Entry update={update} nameOf={nameOf} />
                    </li>
                  ))}
              </ol>
            </div>
          );
        }}
      </LiveView>
    </div>
  );
}
