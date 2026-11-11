import { ExternalLink, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export interface SidePanelProps {
  /** The heading of the panel: the name of the record it shows. */
  title: string;
  /** The address of the full page of the record. */
  fullPage: string;
  /** Closes the panel. Focus goes back to the list, which the caller decides. */
  onClose: () => void;
  children: ReactNode;
}

/** The width from which the panel sits beside the list, the `lg` breakpoint of tokens.css. */
const BESIDE_THE_LIST = "(min-width: 63.75rem)";

/** The query of the wide layout, or null where the browser cannot answer it. */
const wideLayout = (): MediaQueryList | null =>
  typeof window === "undefined" || typeof window.matchMedia !== "function" ? null : window.matchMedia(BESIDE_THE_LIST);

/** Whether the screen is narrow enough for the panel to lie over the list. */
function useOverlaid(): boolean {
  const [overlaid, setOverlaid] = useState(() => {
    const query = wideLayout();
    return query !== null && !query.matches;
  });
  useEffect(() => {
    const query = wideLayout();
    if (query === null) return;
    const change = () => setOverlaid(!query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return overlaid;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside a container: from its last control to its first and back, so
 * that focus never reaches what the container covers.
 */
export function keepFocusInside(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = controls[0];
  const last = controls.at(-1);
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  const outsideControls = !controls.some((control) => control === active);
  if (event.shiftKey && (active === first || outsideControls)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outsideControls)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * The preview of a record beside a list, without leaving the list. It takes focus when it opens,
 * closes with Escape or its close button, and links to the full page of the record. On a narrow
 * screen it lies over the list, as a modal dialog that keeps focus inside it until it closes.
 */
export function SidePanel({ title, fullPage, onClose, children }: SidePanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const overlaid = useOverlaid();
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus moves to the panel each time it shows another record
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  return (
    <aside
      aria-label={`Preview of ${title}`}
      {...(overlaid ? { role: "dialog", "aria-modal": true } : {})}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (overlaid) keepFocusInside(event);
      }}
      className="fixed inset-x-0 top-(--shell-topbar) bottom-0 z-20 overflow-y-auto border-t border-border bg-surface p-4 lg:sticky lg:inset-auto lg:top-20 lg:z-auto lg:max-h-[calc(100dvh-6rem)] lg:w-96 lg:shrink-0 lg:rounded-tile lg:border"
      data-testid="side-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          ref={heading}
          tabIndex={-1}
          className="min-w-0 break-words text-lg font-medium tracking-title text-fg-strong"
        >
          {title}
        </h2>
        <Button variant="ghost" size="sm" aria-label="Close the preview" className="w-8.5 px-0" onClick={onClose}>
          <X aria-hidden="true" strokeWidth={1.8} />
        </Button>
      </div>
      <div className="mt-3 grid gap-3">{children}</div>
      <div className="mt-4 border-t border-border pt-3">
        <Button asChild size="sm" variant="outline">
          <Link to={fullPage}>
            <ExternalLink aria-hidden="true" strokeWidth={1.8} />
            Open the full page
          </Link>
        </Button>
      </div>
    </aside>
  );
}
