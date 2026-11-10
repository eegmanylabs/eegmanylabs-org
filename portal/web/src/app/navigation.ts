// The navigation registry: the single place where the sidebar's destinations are declared.
//
// To add a destination, add its route in router.tsx and one entry here. An entry appears only
// for accounts that hold its capability. That is a convenience for the reader: the page's data
// is protected by security rules and functions whether or not the entry is shown.
import type { Capability } from "@eegml/shared";
import { House, type LucideIcon } from "lucide-react";

export interface NavigationEntry {
  /** Stable identifier, unique in the registry. */
  readonly id: string;
  /** Sentence case, as it appears in the sidebar. */
  readonly label: string;
  /** Route path, as declared in router.tsx. */
  readonly to: string;
  readonly icon: LucideIcon;
  /** The capability an account needs for the entry to be shown. */
  readonly requires: Capability;
  /** Entries are listed in ascending order. Leave gaps so later entries can be placed between. */
  readonly order: number;
}

export const NAVIGATION: readonly NavigationEntry[] = [
  { id: "home", label: "Home", to: "/", icon: House, requires: "portal.use", order: 100 },
];

/** The entries an account may see, in display order. */
export function visibleNavigation(
  capabilities: ReadonlySet<Capability>,
  entries: readonly NavigationEntry[] = NAVIGATION,
): readonly NavigationEntry[] {
  return entries.filter((entry) => capabilities.has(entry.requires)).sort((a, b) => a.order - b.order);
}
