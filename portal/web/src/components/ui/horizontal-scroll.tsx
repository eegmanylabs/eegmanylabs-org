import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

/** Which edges of a region that scrolls sideways have more beyond them. */
export interface ScrollEdges {
  readonly before: boolean;
  readonly after: boolean;
}

/**
 * Watches a region that scrolls sideways and says on which side more is hidden, as it scrolls
 * and as its size or content changes, so that the region can show it.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): { edges: ScrollEdges; update: () => void } {
  const [edges, setEdges] = useState<ScrollEdges>({ before: false, after: false });
  const update = useCallback(() => {
    const element = ref.current;
    if (element === null) return;
    const before = element.scrollLeft > 1;
    const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setEdges((current) => (current.before === before && current.after === after ? current : { before, after }));
  }, [ref]);
  useEffect(() => {
    const element = ref.current;
    update();
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, update]);
  return { edges, update };
}

/** The marks on the edges of a region that scrolls sideways, where more is hidden beyond them. */
export function ScrollEdgeMarks({ edges }: { edges: ScrollEdges }) {
  const mark = "pointer-events-none absolute inset-y-0 flex items-center border-border bg-surface px-0.5 text-fg-muted";
  return (
    <>
      {edges.before ? (
        <span aria-hidden="true" data-testid="scroll-more-before" className={cn(mark, "left-0 border-r")}>
          <ChevronLeft className="size-3.5" strokeWidth={1.8} />
        </span>
      ) : null}
      {edges.after ? (
        <span aria-hidden="true" data-testid="scroll-more-after" className={cn(mark, "right-0 border-l")}>
          <ChevronRight className="size-3.5" strokeWidth={1.8} />
        </span>
      ) : null}
    </>
  );
}

/**
 * A region that scrolls sideways on a narrow screen, such as a strip of tabs, with a mark on each
 * edge beyond which more is hidden.
 */
export function HorizontalScroll({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { edges, update } = useScrollEdges(ref);
  return (
    <div className="relative min-w-0">
      <div ref={ref} onScroll={update} className={cn("overflow-x-auto", className)}>
        {children}
      </div>
      <ScrollEdgeMarks edges={edges} />
    </div>
  );
}
