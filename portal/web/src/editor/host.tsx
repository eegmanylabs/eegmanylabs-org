// The editor of a page with the synchronisation of its Yjs document, loaded on demand: the
// editor and its dependencies are the largest part of the application, and only a page needs them.
import { PAGE_FRAGMENT_NAME } from "@eegml/shared";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { config } from "@/app/config";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { namesOfOthers, PageSync, PresenceSync, type SaveState } from "@/data/collaboration";
import { Isolated } from "./isolated";
import { PageEditor, type PageEditorProps } from "./PageEditor";

export interface PageEditorHostProps extends Omit<PageEditorProps, "sync"> {
  /** Told whenever the state of saving may have changed. */
  readonly onSaveState: (state: SaveState) => void;
  /** Called after a quiet spell in which this editor changed the page, for an automatic version. */
  readonly onIdleAfterEdit: () => void;
  /** Told the names of the others who have the page open, whenever they change. */
  readonly onPresence: (names: readonly string[]) => void;
}

export default function PageEditorHost(props: PageEditorHostProps) {
  const { pageId, uid, editable } = props;
  const [sync, setSync] = useState<PageSync | null>(null);
  const [failed, setFailed] = useState(false);
  const [empty, setEmpty] = useState(false);
  // The latest callbacks, for a synchronisation that outlives a render.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const doc = new Y.Doc();
    const created = new PageSync({
      pageId,
      uid,
      doc,
      canWrite: editable,
      onIdleAfterEdit: () => latest.current.onIdleAfterEdit(),
    });
    let current = true;
    const stop = created.onSaveState((state) => {
      latest.current.onSaveState(state);
      if (created.status === "error" && current) setFailed(true);
    });
    // Whether nothing has been written yet, which a reader is told rather than shown a blank box.
    const fragment = doc.getXmlFragment(PAGE_FRAGMENT_NAME);
    const observeEmpty = () => {
      if (current) setEmpty(fragment.length === 0);
    };
    doc.on("update", observeEmpty);
    // Who else has the page open: names for everyone, and carets in the mode "cursor".
    const presence =
      config.presence === "off"
        ? null
        : new PresenceSync({ pageId, uid, awareness: created.awareness, mode: config.presence });
    // Told only when the names change: a caret that moves changes the awareness too, and the page
    // around the editor must not draw itself again for that.
    let announced = "";
    const announcePresence = () => {
      const names = namesOfOthers(created.awareness);
      if (!current || names.join("\n") === announced) return;
      announced = names.join("\n");
      latest.current.onPresence(names);
    };
    created.awareness.on("change", announcePresence);
    void created.whenSynced.then(() => {
      if (!current) return;
      observeEmpty();
      setSync(created);
    });
    return () => {
      current = false;
      created.awareness.off("change", announcePresence);
      presence?.destroy();
      latest.current.onPresence([]);
      doc.off("update", observeEmpty);
      stop();
      setSync(null);
      setFailed(false);
      void created.destroy().then(() => doc.destroy());
    };
  }, [pageId, uid, editable]);

  if (sync === null) {
    return failed ? (
      <ErrorState
        title="The page could not be loaded."
        description="Your account may no longer read it, or the portal could not reach its server. Reload to try again."
      />
    ) : (
      <LoadingState label="Loading the page" />
    );
  }
  if (!editable && empty) {
    return (
      <p className="rounded-card border border-border p-4 text-fg-secondary">
        Nothing has been written here yet. Those who may edit this page can write here.
      </p>
    );
  }
  const editorProps: PageEditorProps = {
    pageId,
    uid,
    userName: props.userName,
    editable,
    sync,
    members: props.members,
    anchors: props.anchors,
    onComment: props.onComment,
    onFileError: props.onFileError,
    onReady: props.onReady,
    viewHost: props.viewHost,
    ...(props.onActionItem === undefined ? {} : { onActionItem: props.onActionItem }),
  };
  return <Isolated component={PageEditor} props={editorProps} />;
}
