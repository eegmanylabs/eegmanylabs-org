import { LoaderCircle } from "lucide-react";
import { cn } from "@/utils/cn";

export interface LoadingStateProps {
  /** What is loading, for example "Loading your account". */
  label: string;
  /** `page` fills the viewport, for use before any layout exists. */
  size?: "inline" | "page";
}

/** The one way the portal says that something is loading. */
export function LoadingState({ label, size = "inline" }: LoadingStateProps) {
  return (
    // One status region that reads its label once, beside an animation that says nothing.
    <div
      role="status"
      className={cn("flex items-center gap-2.5 text-fg-muted", size === "page" && "min-h-dvh justify-center")}
    >
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={1.8} />
      <span>{label}</span>
    </div>
  );
}
