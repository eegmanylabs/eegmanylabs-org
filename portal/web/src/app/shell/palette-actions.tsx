// The actions that the current page offers in the command palette. A page registers what it can
// do for the account that is looking at it, and nothing else: an action the account may not
// take is never registered, and the rules and functions refuse it in any case.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface PageAction {
  /** Unique on the page. */
  readonly id: string;
  /** Sentence case, as a command: "Star this replication". */
  readonly label: string;
  readonly run: () => void;
}

interface PaletteActionsApi {
  readonly actions: readonly PageAction[];
  register(owner: symbol, actions: readonly PageAction[]): void;
  unregister(owner: symbol): void;
}

const PaletteActionsContext = createContext<PaletteActionsApi | null>(null);

export function PaletteActionsProvider({ children }: { children: ReactNode }) {
  const [byOwner, setByOwner] = useState<ReadonlyMap<symbol, readonly PageAction[]>>(new Map());
  const register = useCallback(
    (owner: symbol, actions: readonly PageAction[]) => setByOwner((current) => new Map(current).set(owner, actions)),
    [],
  );
  const unregister = useCallback(
    (owner: symbol) =>
      setByOwner((current) => {
        const next = new Map(current);
        next.delete(owner);
        return next;
      }),
    [],
  );
  const api = useMemo<PaletteActionsApi>(
    () => ({ actions: [...byOwner.values()].flat(), register, unregister }),
    [byOwner, register, unregister],
  );
  return <PaletteActionsContext.Provider value={api}>{children}</PaletteActionsContext.Provider>;
}

/** The actions every page has registered, for the palette. */
export function useRegisteredActions(): readonly PageAction[] {
  return useContext(PaletteActionsContext)?.actions ?? [];
}

/**
 * Offers actions in the palette while the calling component is shown. `key` describes the
 * actions, so that they are registered again only when they change.
 */
export function usePaletteActions(actions: readonly PageAction[], key: string): void {
  const context = useContext(PaletteActionsContext);
  const register = context?.register;
  const unregister = context?.unregister;
  const [owner] = useState(() => Symbol("page actions"));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the actions, which are new objects on each render
  useEffect(() => {
    if (register === undefined || unregister === undefined) return;
    register(owner, actions);
    return () => unregister(owner);
  }, [key, owner, register, unregister]);
}
