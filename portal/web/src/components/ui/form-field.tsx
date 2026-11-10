import { CircleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "@/utils/cn";
import { Label } from "./label";

/** Attributes the field hands to its control so that label, hint and error are announced with it. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

export interface FormFieldProps {
  label: string;
  /** Help shown under the control. */
  hint?: string;
  /** The problem with the current value. When present the control is marked invalid. */
  error?: string | null;
  className?: string;
  /** Render the control and spread the given attributes onto it. */
  children: (control: FieldControlProps) => ReactNode;
}

/** A labelled control with optional help and error text. */
export function FormField({ label, hint, error, className, children }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {/*
       * Always in the document and never hidden with display: none, which would take the live
       * region out of the accessibility tree: a message that appears later is then announced.
       * While it is empty it has no height, and the negative margin takes back the grid gap.
       */}
      <p
        id={errorId}
        aria-live="polite"
        className={cn("text-xs text-fg-accent", error ? "flex items-start gap-1.5" : "-mt-1.5")}
      >
        {error ? (
          <>
            <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={1.8} />
            <span>{error}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
