import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
import { Button, type ButtonProps } from "./button";
import { Tooltip, type TooltipProps } from "./tooltip";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label" | "size" | "asChild"> {
  /** The accessible name, also shown as a tooltip. */
  label: string;
  /** The icon. It is hidden from assistive technology: the label names the button. */
  children: ReactNode;
  tooltipSide?: TooltipProps["side"];
}

/** A square button that shows only an icon. It always has an accessible name and a tooltip. */
export function IconButton({ label, children, className, variant = "ghost", tooltipSide, ...props }: IconButtonProps) {
  return (
    <Tooltip content={label} {...(tooltipSide ? { side: tooltipSide } : {})}>
      <Button
        aria-label={label}
        variant={variant}
        size="sm"
        className={cn("w-8.5 px-0 pointer-coarse:w-11", className)}
        {...props}
      >
        {children}
      </Button>
    </Tooltip>
  );
}
