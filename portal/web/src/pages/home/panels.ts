// The panels of the Home page, in one registry.
//
// EXTENSION POINT. A feature that belongs on Home adds its panel here and nowhere else: the
// page renders whatever this list contains, in order, for accounts that hold the panel's
// capability. The claim flow, for example, adds the panel that lets an unlinked account claim
// its member profile.
import type { Capability } from "@eegml/shared";
import type { ComponentType } from "react";
import { AccountPanel } from "./AccountPanel";

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
  { id: "account", order: 100, requires: "portal.use", Component: AccountPanel },
];
