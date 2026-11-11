// Renders the editor in a React root of its own, outside the StrictMode of the application.
// Under StrictMode, development builds mount every effect twice, and y-prosemirror's undo
// manager does not survive the first unmount: undo and redo would do nothing (the editor spike,
// section 12). Production builds do not mount twice, and the separate root changes nothing there.
import { type ComponentType, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

export function Isolated<Props extends object>({
  component: Component,
  props,
  className,
}: {
  readonly component: ComponentType<Props>;
  readonly props: Props;
  readonly className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<Root | null>(null);
  useEffect(() => {
    if (host.current === null) return;
    const created = createRoot(host.current);
    root.current = created;
    return () => {
      root.current = null;
      // React does not allow a root to unmount while it renders, so wait for the current render.
      queueMicrotask(() => created.unmount());
    };
  }, []);
  useEffect(() => {
    root.current?.render(<Component {...props} />);
  });
  return <div ref={host} className={className} />;
}
