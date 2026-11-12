import { X } from "lucide-react";
import { Dialog as RadixDialog, VisuallyHidden } from "radix-ui";
import type { ReactNode } from "react";
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
   * The control that focus returns to when the dialog closes, for a dialog opened from state
   * rather than from a trigger, which Radix cannot find by itself. Null leaves focus to Radix.
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
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
      <RadixDialog.Content
        // Without a description Radix expects this attribute to be cleared explicitly.
        {...(description ? {} : { "aria-describedby": undefined })}
        {...(returnFocus === undefined
          ? {}
          : {
              onCloseAutoFocus: (event: Event) => {
                const target = returnFocus();
                if (target === null || !target.isConnected) return;
                event.preventDefault();
                target.focus();
              },
            })}
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
