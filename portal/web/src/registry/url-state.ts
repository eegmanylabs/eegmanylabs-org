// The state of a list kept in the query of the address, so that a filtered view can be shared
// and survives a reload. A change replaces the entry of the history instead of adding one, so
// the Back button leaves the list instead of undoing each keystroke of a search.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";

/** Where the last address of each list is kept for the session, so that a link back to the list keeps its filters. */
const LIST_KEY_PREFIX = "eegml:list:";

/** Reads a stored value, or null where the browser keeps nothing or refuses. */
function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // A private window or blocked storage keeps nothing, and the list starts unfiltered.
  }
}

/** The last address of a list in this session, with its search and filters, or the bare path. */
export function rememberedListPath(path: string): string {
  const search = readSession(`${LIST_KEY_PREFIX}${path}`);
  return search === null || search === "" ? path : `${path}?${search}`;
}

export function useUrlState<S>(
  parse: (params: URLSearchParams) => S,
  serialise: (state: S) => URLSearchParams,
): [S, (change: Partial<S>) => void] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const state = useMemo(() => parse(params), [params, parse]);
  // The list remembers its address, which the breadcrumb of a record page links back to.
  useEffect(() => {
    writeSession(`${LIST_KEY_PREFIX}${pathname}`, params.toString());
  }, [pathname, params]);
  // The parameters as the latest change left them. Two changes made before the page renders
  // again, such as clearing the filters and choosing one at once, build on each other instead
  // of the second undoing the first.
  const latest = useRef(params);
  const seen = useRef(params);
  if (seen.current !== params) {
    seen.current = params;
    latest.current = params;
  }
  const update = useCallback(
    (change: Partial<S>) => {
      const next = serialise({ ...parse(latest.current), ...change });
      latest.current = next;
      setParams(next, { replace: true });
    },
    [setParams, parse, serialise],
  );
  return [state, update];
}

/** How long the search box waits after the last keystroke before it writes the address. */
export const SEARCH_COMMIT_DELAY_MS = 150;

/**
 * The text of a search box whose query lives in the address. The box keeps what is typed in
 * its own state, so no keystroke is lost while the address catches up, and writes the address
 * once typing pauses, or at once when the box is cleared. A change of the address that the box did not make, such as a link or the
 * Back button, shows in the box.
 */
export function useSearchText(
  stored: string,
  commit: (value: string) => void,
  delay: number = SEARCH_COMMIT_DELAY_MS,
): [string, (value: string) => void] {
  const [text, setText] = useState(stored);
  const committed = useRef(stored);
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  useEffect(() => {
    if (stored === committed.current) return;
    committed.current = stored;
    setText(stored);
  }, [stored]);
  useEffect(() => {
    if (text === committed.current) return;
    const commitNow = () => {
      committed.current = text;
      latestCommit.current(text);
    };
    // A cleared box clears the search at once, so that nothing typed before outlives it.
    if (text.trim() === "") {
      commitNow();
      return;
    }
    const timer = window.setTimeout(commitNow, delay);
    return () => window.clearTimeout(timer);
  }, [text, delay]);
  return [text, setText];
}
