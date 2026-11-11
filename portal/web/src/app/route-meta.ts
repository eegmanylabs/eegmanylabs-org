// What a route says about itself. Breadcrumbs and the browser tab title are built from it.
import { type ComponentType, useEffect } from "react";
import { type Params, type UIMatch, useMatches } from "react-router";
import { PORTAL_NAME } from "./config";

export interface RouteHandle {
  /**
   * Sentence case. Shown as the breadcrumb and in the browser tab. A route with parameters may
   * build it from them, as a record page shows its identifier.
   */
  readonly title: string | ((params: Readonly<Params>) => string);
  /**
   * Renders the breadcrumb in place of the title, for a record whose name has to be read first.
   * The title remains the text of the browser tab.
   */
  readonly crumb?: ComponentType<{ readonly params: Readonly<Params> }>;
}

export interface Crumb {
  readonly title: string;
  readonly path: string;
  readonly params: Readonly<Params>;
  readonly Label: RouteHandle["crumb"];
}

const hasTitle = (match: UIMatch): match is UIMatch<unknown, RouteHandle> => {
  const title = (match.handle as Partial<RouteHandle> | undefined)?.title;
  return typeof title === "string" || typeof title === "function";
};

/** The titled routes that lead to the current page, outermost first. */
export function useCrumbs(): readonly Crumb[] {
  return useMatches()
    .filter(hasTitle)
    .map((match) => ({
      title: typeof match.handle.title === "string" ? match.handle.title : match.handle.title(match.params),
      path: match.pathname,
      params: match.params,
      Label: match.handle.crumb,
    }));
}

/** Keeps the browser tab title in step with the current page. */
export function useDocumentTitle(): void {
  const title = useCrumbs().at(-1)?.title;
  useEffect(() => {
    document.title = title ? `${title} | ${PORTAL_NAME}` : PORTAL_NAME;
  }, [title]);
}
