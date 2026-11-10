import { LoaderCircle } from "lucide-react";
import { cn } from "@/utils/cn";

export interface SpinnerProps {
  /** What is happening, for people who cannot see the animation. */
  label: string;
  className?: string;
}

export function Spinner({ label, className }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={1.8} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
