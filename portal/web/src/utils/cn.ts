import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and resolves conflicting Tailwind utilities in favour of the later one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
