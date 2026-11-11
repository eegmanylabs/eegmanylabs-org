// The programme's workspace in the sidebar: its pages as a tree, under a heading that folds the
// whole section. Whether the section and each branch are folded is remembered in this browser.
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { IconButton } from "@/components/ui/icon-button";
import { useLiveQuery } from "@/data";
import { NewPageDialog } from "@/pages/workspace/PageDialogs";
import { PageTree } from "@/pages/workspace/PageTree";
import { workspacePages } from "@/pages/workspace/queries";
import { useViewer } from "@/registry/viewer";
import { readStored, writeStored } from "@/utils/storage";

const FOLDED_KEY = "portal.sidebar.workspace.folded";

export function SidebarWorkspace({ onNavigate }: { readonly onNavigate?: () => void }) {
  const viewer = useViewer();
  const member = viewer?.access.member === true;
  const [folded, setFolded] = useState(() => readStored(FOLDED_KEY) === "true");
  const [creating, setCreating] = useState(false);
  const pages = useLiveQuery(member && viewer !== null ? workspacePages(viewer) : null);
  if (!member) return null;
  const list = pages.status === "ready" ? pages.data.filter((page) => page.archivedAt === null) : [];
  const toggle = () => {
    setFolded((current) => {
      writeStored(FOLDED_KEY, String(!current));
      return !current;
    });
  };
  return (
    <nav aria-labelledby="sidebar-workspace" className="mt-5 grid gap-1" data-testid="sidebar-workspace">
      <div className="flex items-center gap-0.5 px-1">
        <IconButton
          label={folded ? "Unfold the workspace" : "Fold the workspace"}
          aria-expanded={!folded}
          onClick={toggle}
        >
          {folded ? (
            <ChevronRight aria-hidden="true" strokeWidth={1.8} />
          ) : (
            <ChevronDown aria-hidden="true" strokeWidth={1.8} />
          )}
        </IconButton>
        <h2 id="sidebar-workspace" className="flex-1 text-micro font-medium tracking-label text-fg-muted">
          <Link
            to="/pages"
            className="rounded-control hover:text-fg"
            {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
          >
            Workspace
          </Link>
        </h2>
        <IconButton label="New page in the workspace" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" strokeWidth={1.8} />
        </IconButton>
      </div>
      {folded ? null : pages.status === "loading" ? (
        <p className="px-3 text-xs text-fg-muted">Loading the pages</p>
      ) : pages.status === "error" ? (
        <p className="px-3 text-xs text-fg-accent">The pages could not be loaded.</p>
      ) : list.length === 0 ? (
        <p className="px-3 text-xs text-fg-muted">No pages yet.</p>
      ) : (
        <PageTree pages={list} {...(onNavigate === undefined ? {} : { onNavigate })} />
      )}
      <NewPageDialog
        open={creating}
        onOpenChange={setCreating}
        parent={null}
        templates={list.filter((page) => page.isTemplate)}
      />
    </nav>
  );
}
