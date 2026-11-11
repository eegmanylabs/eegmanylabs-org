// The panels of the Home page, in one registry.
//
// EXTENSION POINT. A feature that belongs on Home adds its panel here and nowhere else: the
// page renders whatever this list contains, in order, for accounts that hold the panel's
// capability. A panel that has nothing to show for an account renders nothing.
import type { Capability } from "@eegml/shared";
import type { ComponentType } from "react";
import { AccountPanel } from "./AccountPanel";
import { AdminQueuesPanel } from "./AdminQueuesPanel";
import { LaboratoriesPanel } from "./LaboratoriesPanel";
import { PendingItemsPanel } from "./PendingItemsPanel";
import { PendingRolesPanel } from "./PendingRolesPanel";
import { ProfilePanel } from "./ProfilePanel";
import { ProgrammeSnapshotPanel } from "./ProgrammeSnapshotPanel";

export interface HomePanel {
  /** Stable identifier, unique in the registry. */
  readonly id: string;
  /** Panels are shown in ascending order. Leave gaps so later panels can be placed between. */
  readonly order: number;
  /** The capability an account needs for the panel to be shown. */
  readonly requires: Capability;
  /** Takes no props: a panel reads what it needs through `useAuth` and the data hooks. */
  readonly Component: ComponentType;
}

export const HOME_PANELS: readonly HomePanel[] = [
  { id: "queues", order: 40, requires: "portal.use", Component: AdminQueuesPanel },
  { id: "profile", order: 50, requires: "portal.use", Component: ProfilePanel },
  { id: "laboratories", order: 55, requires: "portal.use", Component: LaboratoriesPanel },
  { id: "pending-items", order: 45, requires: "portal.use", Component: PendingItemsPanel },
  { id: "pending-roles", order: 60, requires: "portal.use", Component: PendingRolesPanel },
  { id: "snapshot", order: 70, requires: "portal.use", Component: ProgrammeSnapshotPanel },
  { id: "account", order: 100, requires: "portal.use", Component: AccountPanel },
];
