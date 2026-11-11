// The scroll position of a long list, kept for its address for the session, so that Back from a
// record returns to the same place in the list. The address is read from the fragment of the
// page, where the hash router keeps it, without the record that the preview has open.
import { useEffect, useRef } from "react";

/** Where the scroll position of each list address is kept for the session. */
const SCROLL_KEY_PREFIX = "eegml:scroll:";

/** The key of the current list address: its path and its filters, without the open preview. */
export function scrollKeyOf(hash: string): string {
  const address = hash.replace(/^#/, "");
  const [path = "", query = ""] = address.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("open");
  params.sort();
  const rest = params.toString();
  return `${SCROLL_KEY_PREFIX}${path}${rest === "" ? "" : `?${rest}`}`;
}

function readStored(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Blocked storage keeps nothing, and the list opens at its top.
  }
}

/**
 * Keeps the scroll position of a scrolling list for its address, and puts it back once the
 * rows are there. `ready` says that the rows have rendered. Pass null to keep nothing.
 */
export function useRememberedScroll(element: HTMLElement | null, ready: boolean): void {
  const restored = useRef(false);
  useEffect(() => {
    if (element === null || !ready || restored.current) return;
    restored.current = true;
    const stored = Number(readStored(scrollKeyOf(window.location.hash)));
    if (Number.isFinite(stored) && stored > 0) element.scrollTop = stored;
  }, [element, ready]);
  useEffect(() => {
    if (element === null) return;
    let frame = 0;
    const remember = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => writeStored(scrollKeyOf(window.location.hash), String(element.scrollTop)));
    };
    element.addEventListener("scroll", remember, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", remember);
    };
  }, [element]);
}
