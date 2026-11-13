// The navigation registry: the single place where the sidebar's destinations are declared.
//
// To add a destination, add its route in router.tsx and one entry here. An entry appears only
// for accounts that hold its capability. That is a convenience for the reader: the page's data
// is protected by security rules and functions whether or not the entry is shown.
import type { Capability } from "@eegml/shared";
import {
  Cable,
  ChartColumn,
  Contact,
  Database,
  FilePenLine,
  FlaskConical,
  Gauge,
  Globe,
  House,
  Import,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Microscope,
  Repeat2,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  TrendingUp,
  Unlink,
  UserRoundCheck,
  UserRoundSearch,
  Users,
  Workflow,
} from "lucide-react";

/** The groups of the sidebar, in the order they are shown. The first has no heading. */
export const NAVIGATION_GROUPS = ["main", "administration"] as const;
export type NavigationGroup = (typeof NAVIGATION_GROUPS)[number];

export const NAVIGATION_GROUP_LABELS: Readonly<Record<NavigationGroup, string>> = {
  main: "Main",
  administration: "Administration",
};

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
  readonly group: NavigationGroup;
  /**
   * `unlinked`: listed only while the account is not linked to a member profile. `linked`:
   * listed only once it is, because the page has nothing for an account that is not linked.
   */
  readonly audience?: "unlinked" | "linked";
}

export const NAVIGATION: readonly NavigationEntry[] = [
  {
    id: "home",
    label: "Home",
    to: "/",
    icon: House,
    requires: "portal.use",
    order: 100,
    group: "main",
    audience: "linked",
  },
  {
    id: "search",
    label: "Search",
    to: "/search",
    icon: Search,
    requires: "portal.use",
    order: 120,
    group: "main",
    audience: "linked",
  },
  {
    id: "replications",
    label: "Replications",
    to: "/replications",
    icon: Repeat2,
    // Every member reads the directory, whatever roles the account holds.
    requires: "portal.use",
    order: 150,
    group: "main",
    audience: "linked",
  },
  {
    id: "laboratories",
    label: "Laboratories",
    to: "/labs",
    icon: Microscope,
    requires: "portal.use",
    order: 155,
    group: "main",
    audience: "linked",
  },
  {
    id: "members",
    label: "Members",
    to: "/members",
    icon: Contact,
    requires: "portal.use",
    order: 160,
    group: "main",
    audience: "linked",
  },
  {
    id: "readiness",
    label: "Readiness",
    to: "/readiness",
    icon: LayoutGrid,
    requires: "portal.use",
    order: 170,
    group: "main",
    audience: "linked",
  },
  {
    id: "recruitment",
    label: "Recruitment",
    to: "/recruitment",
    icon: TrendingUp,
    requires: "portal.use",
    order: 171,
    group: "main",
    audience: "linked",
  },
  {
    id: "datasets",
    label: "Datasets",
    to: "/datasets",
    icon: Database,
    requires: "portal.use",
    order: 173,
    group: "main",
    audience: "linked",
  },
  {
    id: "tasks",
    label: "Tasks",
    to: "/tasks",
    icon: ListTodo,
    requires: "portal.use",
    order: 172,
    group: "main",
    audience: "linked",
  },
  {
    id: "overview",
    label: "Programme overview",
    to: "/overview",
    icon: Gauge,
    requires: "portal.use",
    order: 174,
    group: "main",
    audience: "linked",
  },
  {
    id: "analysis",
    label: "Analysis",
    to: "/analysis",
    icon: ChartColumn,
    requires: "portal.use",
    order: 176,
    group: "main",
    audience: "linked",
  },
  {
    id: "dashboards",
    label: "Dashboards",
    to: "/dashboards",
    icon: LayoutDashboard,
    requires: "portal.use",
    order: 175,
    group: "main",
    audience: "linked",
  },
  {
    id: "claim",
    label: "Your member profile",
    to: "/claim",
    icon: UserRoundCheck,
    requires: "portal.use",
    order: 200,
    group: "main",
    audience: "unlinked",
  },
  {
    id: "account",
    label: "Account and security",
    to: "/account",
    icon: ShieldCheck,
    requires: "portal.use",
    order: 900,
    group: "main",
  },
  {
    id: "admin-claims",
    label: "Account claims",
    to: "/admin/claims",
    icon: UserRoundSearch,
    requires: "claims.review",
    order: 1_000,
    group: "administration",
  },
  {
    id: "admin-lab-claims",
    label: "Laboratory claims",
    to: "/admin/lab-claims",
    icon: FlaskConical,
    requires: "labs.claims.review",
    order: 1_010,
    group: "administration",
  },
  {
    id: "admin-corrections",
    label: "Correction requests",
    to: "/admin/corrections",
    icon: FilePenLine,
    requires: "reconciliation.resolve",
    order: 1_020,
    group: "administration",
  },
  {
    id: "admin-memberships",
    label: "Memberships to review",
    to: "/admin/memberships",
    icon: ListChecks,
    requires: "reconciliation.resolve",
    order: 1_025,
    group: "administration",
  },
  {
    id: "admin-users",
    label: "Users",
    to: "/admin/users",
    icon: Users,
    requires: "users.suspend",
    order: 1_030,
    group: "administration",
  },
  {
    id: "admin-roles",
    label: "Roles and capabilities",
    to: "/admin/roles",
    icon: KeyRound,
    requires: "roles.manage",
    order: 1_040,
    group: "administration",
  },
  {
    id: "admin-audit",
    label: "Audit log",
    to: "/admin/audit",
    icon: ScrollText,
    requires: "audit.read",
    order: 1_050,
    group: "administration",
  },
  {
    id: "admin-imports",
    label: "Imports",
    to: "/admin/imports",
    icon: Import,
    requires: "imports.run",
    order: 1_060,
    group: "administration",
  },
  {
    id: "admin-review-queue",
    label: "Review queue",
    to: "/admin/review-queue",
    icon: Scale,
    requires: "reconciliation.resolve",
    order: 1_065,
    group: "administration",
  },
  {
    id: "admin-integrations",
    label: "Integrations",
    to: "/admin/integrations",
    icon: Cable,
    requires: "integrations.manage",
    order: 1_068,
    group: "administration",
  },
  {
    id: "admin-publishing",
    label: "Publishing",
    to: "/admin/publishing",
    icon: Globe,
    requires: "publishing.prepare",
    order: 1_066,
    group: "administration",
  },
  {
    id: "admin-automations",
    label: "Automations",
    to: "/admin/automations",
    icon: Workflow,
    requires: "automations.manage",
    order: 1_067,
    group: "administration",
  },
  {
    id: "admin-integrity",
    label: "Integrity",
    to: "/admin/integrity",
    icon: Unlink,
    requires: "audit.read",
    order: 1_070,
    group: "administration",
  },
];

/** The entry of a destination, for its route to state the capability it needs in one place. */
export function navigationEntry(id: string): NavigationEntry {
  const entry = NAVIGATION.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`The navigation registry has no entry ${id}.`);
  return entry;
}

/** The entries an account may see, in display order. `linked` says whether it is linked to a member profile. */
export function visibleNavigation(
  capabilities: ReadonlySet<Capability>,
  entries: readonly NavigationEntry[] = NAVIGATION,
  linked = true,
): readonly NavigationEntry[] {
  return entries
    .filter(
      (entry) =>
        capabilities.has(entry.requires) &&
        (entry.audience === undefined || entry.audience === (linked ? "linked" : "unlinked")),
    )
    .sort((a, b) => a.order - b.order);
}
