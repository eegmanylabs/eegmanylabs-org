import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactNode } from "react";

/** Wrap the application once. Tooltips inside share its timing. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}

export interface TooltipProps {
  /** Short text. A tooltip supplements a control's accessible name and never replaces it. */
  content: string;
  side?: "top" | "right" | "bottom" | "left";
  /** One element that can take focus. */
  children: ReactNode;
}

export function Tooltip({ content, side = "bottom", children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-60 rounded-control bg-surface-inverse px-2.5 py-1.5 text-xs text-fg-inverse"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
