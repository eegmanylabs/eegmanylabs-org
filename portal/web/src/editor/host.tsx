// The editor of a page with the synchronisation of its Yjs document, loaded on demand: the
// editor and its dependencies are the largest part of the application, and only a page needs them.
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageSync, type SaveState } from "@/data";
import { Isolated } from "./isolated";
import { PageEditor, type PageEditorProps } from "./PageEditor";

export interface PageEditorHostProps extends Omit<PageEditorProps, "sync"> {
  /** Told whenever the state of saving may have changed. */
  readonly onSaveState: (state: SaveState) => void;
  /** Called after a quiet spell in which this editor changed the page, for an automatic version. */
  readonly onIdleAfterEdit: () => void;
}

export default function PageEditorHost(props: PageEditorHostProps) {
  const { pageId, uid, editable } = props;
  const [sync, setSync] = useState<PageSync | null>(null);
  const [failed, setFailed] = useState(false);
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
    void created.whenSynced.then(() => {
      if (current) setSync(created);
    });
    return () => {
      current = false;
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
  };
  return <Isolated component={PageEditor} props={editorProps} />;
}
