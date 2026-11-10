import { Spinner } from "@/components/ui/spinner";
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
    <div className={cn("flex items-center gap-2.5 text-fg-muted", size === "page" && "min-h-dvh justify-center")}>
      <Spinner label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  );
}
