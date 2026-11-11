// The pages of the workspace as a tree: the pages at its top and, beneath each, the pages inside
// it, in their order. Which branches are folded is remembered in this browser. Where the tree
// offers reordering, an editor of a page moves it before or after its neighbour, which writes one
// order key (see order.ts of the shared package).
import { orderBetween } from "@eegml/shared";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { NavLink } from "react-router";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { type RecordOf, updatePageFields } from "@/data";
import { pagePath } from "@/registry/paths";
import { cn } from "@/utils/cn";
import { readStored, writeStored } from "@/utils/storage";
import { holds, usePageLevel } from "./page-level";

type Page = RecordOf<"pages">;

const FOLDED_KEY = "portal.workspace.folded";

/** The branches of the tree that are folded, remembered in this browser. */
export function useFoldedPages(): readonly [ReadonlySet<string>, (pageId: string) => void] {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => {
    try {
      const stored: unknown = JSON.parse(readStored(FOLDED_KEY) ?? "[]");
      return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback((pageId: string) => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      writeStored(FOLDED_KEY, JSON.stringify([...next].slice(-500)));
      return next;
    });
  }, []);
  return [folded, toggle];
}

/** The pages at the top of the workspace and inside each page, in order, without the archived ones. */
export function treeOf(pages: readonly Page[]): ReadonlyMap<string | null, readonly Page[]> {
  const live = pages.filter((page) => page.archivedAt === null);
  const known = new Set(live.map((page) => page.id));
  const children = new Map<string | null, Page[]>();
  for (const page of live) {
    // A page inside the body of a record, or inside a page the reader cannot read, is reached from
    // there and not from the top of the workspace.
    if (page.parentPageId !== null && !known.has(page.parentPageId)) continue;
    const list = children.get(page.parentPageId) ?? [];
    list.push(page);
    children.set(page.parentPageId, list);
  }
  for (const list of children.values()) list.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return children;
}

function Reorder({
  page,
  siblings,
  uid,
}: {
  readonly page: Page;
  readonly siblings: readonly Page[];
  readonly uid: string;
}) {
  const level = usePageLevel(page);
  const toast = useToast();
  if (!holds(level, "edit")) return null;
  const at = siblings.findIndex((sibling) => sibling.id === page.id);
  const moveTo = async (before: string | null, after: string | null) => {
    try {
      await updatePageFields(uid, page.id, { order: orderBetween(before, after) });
    } catch {
      toast.show({ tone: "error", title: "The page was not moved.", description: "Try again." });
    }
  };
  const previous = siblings[at - 1];
  const next = siblings[at + 1];
  return (
    <span className="flex">
      <IconButton
        label={`Move ${page.title} up`}
        disabled={previous === undefined}
        onClick={() => void moveTo(siblings[at - 2]?.order ?? null, previous?.order ?? null)}
      >
        <ArrowUp aria-hidden="true" strokeWidth={1.8} />
      </IconButton>
      <IconButton
        label={`Move ${page.title} down`}
        disabled={next === undefined}
        onClick={() => void moveTo(next?.order ?? null, siblings[at + 2]?.order ?? null)}
      >
        <ArrowDown aria-hidden="true" strokeWidth={1.8} />
      </IconButton>
    </span>
  );
}

function Branch({
  parentId,
  tree,
  folded,
  onToggle,
  depth,
  reorderAs,
  onNavigate,
}: {
  readonly parentId: string | null;
  readonly tree: ReadonlyMap<string | null, readonly Page[]>;
  readonly folded: ReadonlySet<string>;
  readonly onToggle: (pageId: string) => void;
  readonly depth: number;
  readonly reorderAs: string | null;
  readonly onNavigate: (() => void) | undefined;
}) {
  const pages = tree.get(parentId) ?? [];
  return (
    <ul className="grid gap-0.5">
      {pages.map((page) => {
        const inside = tree.get(page.id) ?? [];
        const open = !folded.has(page.id);
        return (
          <li key={page.id}>
            <div className="flex min-w-0 items-center gap-0.5" style={{ paddingLeft: `${depth * 0.75}rem` }}>
              {inside.length > 0 ? (
                <IconButton
                  label={`${open ? "Fold" : "Unfold"} the pages inside ${page.title}`}
                  aria-expanded={open}
                  onClick={() => onToggle(page.id)}
                  tooltipSide="right"
                >
                  {open ? (
                    <ChevronDown aria-hidden="true" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight aria-hidden="true" strokeWidth={1.8} />
                  )}
                </IconButton>
              ) : (
                <span className="w-8.5 shrink-0 pointer-coarse:w-11" aria-hidden="true" />
              )}
              <NavLink
                to={pagePath(page.id)}
                {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
                className={cn(
                  "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-fg-secondary hover:bg-surface hover:text-fg pointer-coarse:h-11",
                  "aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:text-fg",
                )}
              >
                <span aria-hidden="true">{page.icon ?? "📄"}</span>
                <span className="truncate">{page.title}</span>
              </NavLink>
              {reorderAs === null ? null : <Reorder page={page} siblings={pages} uid={reorderAs} />}
            </div>
            {inside.length > 0 && open ? (
              <Branch
                parentId={page.id}
                tree={tree}
                folded={folded}
                onToggle={onToggle}
                depth={depth + 1}
                reorderAs={reorderAs}
                onNavigate={onNavigate}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export interface PageTreeProps {
  readonly pages: readonly Page[];
  /** The uid of the reader, where the tree offers moving pages up and down among their siblings. */
  readonly reorderAs?: string;
  readonly onNavigate?: () => void;
}

export function PageTree({ pages, reorderAs, onNavigate }: PageTreeProps) {
  const [folded, toggle] = useFoldedPages();
  const tree = treeOf(pages);
  return (
    <Branch
      parentId={null}
      tree={tree}
      folded={folded}
      onToggle={toggle}
      depth={0}
      reorderAs={reorderAs ?? null}
      onNavigate={onNavigate}
    />
  );
}
