import { X } from "lucide-react";
import { Dialog as RadixDialog, VisuallyHidden } from "radix-ui";
import { type ReactNode, useRef } from "react";
import { cn } from "@/utils/cn";
import { Button } from "./button";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export interface DialogContentProps {
  /** Names the dialog for assistive technology. Shown as its heading unless `hideTitle` is set. */
  title: string;
  hideTitle?: boolean;
  description?: string;
  /** `center` is a modal panel. `left` is a panel that slides over the page from the left edge. */
  placement?: "center" | "left";
  className?: string;
  /**
   * The control that focus returns to when the dialog closes, where it is not the control that
   * had focus when the dialog opened, which is the default. Null leaves focus to that default.
   */
  returnFocus?: () => HTMLElement | null;
  children: ReactNode;
}

/**
 * The panel of a dialog. Focus moves into it when it opens, stays inside it while it is open,
 * and returns to the control that opened it when it closes. Escape and the scrim close it.
 */
export function DialogContent({
  title,
  hideTitle = false,
  description,
  placement = "center",
  className,
  returnFocus,
  children,
}: DialogContentProps) {
  const heading = <RadixDialog.Title className="text-xl tracking-title text-fg">{title}</RadixDialog.Title>;
  // The control that had focus when the dialog opened, read as the panel mounts and before focus
  // moves into it. Radix returns focus to a trigger only, so a dialog opened from state would
  // otherwise leave focus on the page itself when it closes.
  const opener = useRef<Element | null>(null);
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
      <RadixDialog.Content
        // Without a description Radix expects this attribute to be cleared explicitly.
        {...(description ? {} : { "aria-describedby": undefined })}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement;
        }}
        onCloseAutoFocus={(event: Event) => {
          const named = returnFocus?.() ?? null;
          const target =
            named?.isConnected === true
              ? named
              : opener.current instanceof HTMLElement && opener.current.isConnected && opener.current !== document.body
                ? opener.current
                : null;
          if (target === null) return;
          event.preventDefault();
          target.focus();
        }}
        className={cn(
          "fixed z-50 border-border bg-surface text-fg",
          placement === "center" &&
            "top-1/2 left-1/2 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-form -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border p-7",
          placement === "left" && "inset-y-0 left-0 w-80 max-w-[calc(100%-3rem)] overflow-y-auto border-r p-4",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          {hideTitle ? <VisuallyHidden.Root asChild>{heading}</VisuallyHidden.Root> : heading}
          {/* No tooltip here: an open tooltip would take the first press of Escape for itself. */}
          <RadixDialog.Close asChild>
            <Button aria-label="Close" variant="ghost" size="sm" className="ml-auto w-8.5 px-0 pointer-coarse:w-11">
              <X aria-hidden="true" strokeWidth={1.8} />
            </Button>
          </RadixDialog.Close>
        </div>
        {description ? (
          <RadixDialog.Description className="mt-2 text-sm text-fg-secondary">{description}</RadixDialog.Description>
        ) : null}
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
