import { X } from "lucide-react";
import { Toast as RadixToast } from "radix-ui";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";

export interface ToastOptions {
  title: string;
  description?: string;
  /** `error` is announced at once and stays longer. */
  tone?: "neutral" | "error";
}

interface ToastEntry extends ToastOptions {
  readonly id: number;
}

interface ToastApi {
  /** Shows a short message that goes away by itself. Use it to confirm, never for something the person must act on. */
  show(options: ToastOptions): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Wrap the application once. `useToast` works anywhere inside it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const nextId = useRef(1);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { ...options, id }]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider label="Notification" duration={6_000}>
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            type={toast.tone === "error" ? "foreground" : "background"}
            {...(toast.tone === "error" ? { duration: 12_000 } : {})}
            onOpenChange={(open) => {
              if (!open) dismiss(toast.id);
            }}
            className={cn(
              "flex items-start gap-3 rounded-tile border bg-surface p-3.5 text-sm text-fg",
              toast.tone === "error" ? "border-accent-strong" : "border-border-strong",
            )}
          >
            <div className="grid flex-1 gap-0.5">
              <RadixToast.Title className="font-medium">{toast.title}</RadixToast.Title>
              {toast.description ? (
                <RadixToast.Description className="text-fg-secondary">{toast.description}</RadixToast.Description>
              ) : null}
            </div>
            <RadixToast.Close
              aria-label="Dismiss"
              // On a touch screen the target grows to 44px. The negative margin keeps the toast's layout.
              className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-fg-secondary hover:bg-surface-muted hover:text-fg pointer-coarse:-m-2.5 pointer-coarse:size-11"
            >
              <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport
          label="Notifications ({hotkey})"
          // Page margin on both sides on a narrow screen, a fixed width in the corner from `sm` up.
          className="fixed inset-x-4 bottom-4 z-50 grid gap-2 outline-none sm:left-auto sm:w-96"
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}
