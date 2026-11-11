// The signed-in account as a view needs it: what it may read and change, and whether the session
// presented the second factor. A view inside the page editor, which renders in a React root of
// its own, receives this from the page around it.
import { createContext, useContext } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useViewer, type Viewer } from "@/registry/viewer";

export interface ViewHost {
  readonly viewer: Viewer;
  readonly secondFactor: boolean;
}

/** The host of the views of the current page, or null while the account is not known. */
export function useViewHost(): ViewHost | null {
  const viewer = useViewer();
  const { session } = useAuth();
  if (viewer === null || session.status !== "signed-in") return null;
  return { viewer, secondFactor: session.user.secondFactor };
}

/** Carries the host into the editor's own React root, for the linked views of a page. */
export const ViewHostContext = createContext<ViewHost | null>(null);

export function useProvidedViewHost(): ViewHost | null {
  return useContext(ViewHostContext);
}
