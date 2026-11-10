// What a route says about itself. Breadcrumbs and the browser tab title are built from it.
import { useEffect } from "react";
import { type UIMatch, useMatches } from "react-router";
import { PORTAL_NAME } from "./config";

export interface RouteHandle {
  /** Sentence case. Shown as the breadcrumb and in the browser tab. */
  readonly title: string;
}

export interface Crumb {
  readonly title: string;
  readonly path: string;
}

const hasTitle = (match: UIMatch): match is UIMatch<unknown, RouteHandle> =>
  typeof (match.handle as Partial<RouteHandle> | undefined)?.title === "string";

/** The titled routes that lead to the current page, outermost first. */
export function useCrumbs(): readonly Crumb[] {
  return useMatches()
    .filter(hasTitle)
    .map((match) => ({ title: match.handle.title, path: match.pathname }));
}

/** Keeps the browser tab title in step with the current page. */
export function useDocumentTitle(): void {
  const title = useCrumbs().at(-1)?.title;
  useEffect(() => {
    document.title = title ? `${title} | ${PORTAL_NAME}` : PORTAL_NAME;
  }, [title]);
}
