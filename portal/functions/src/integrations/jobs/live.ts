// The dependencies of jobs as the deployed functions and the emulator run them.

import { logger } from "firebase-functions";
import { defineString } from "firebase-functions/params";
import { firestore, runningInEmulator, systemClock } from "../../framework";
import { type WorkspaceRuntime, workspaceRuntime } from "../google/adapters";
import type { JobDependencies } from "./context";

/** The address of the portal, which generated documents link back to (decision D-002). */
export const PORTAL_URL_PARAMETER = "PORTAL_URL";
/** The public address of `driveNotifications`, once the project allows a function open to the internet. */
export const DRIVE_RECEIVER_PARAMETER = "DRIVE_NOTIFICATION_URL";

/**
 * In the emulator a backoff never waits more than a fifth of a second, so a test of retries
 * does not wait for real minutes. The number and the order of attempts are unchanged.
 */
const EMULATOR_LONGEST_WAIT_MS = 200;

let portalUrlParameter: ReturnType<typeof defineString> | undefined;
let receiverParameter: ReturnType<typeof defineString> | undefined;

function portalUrl(): string {
  portalUrlParameter ??= defineString(PORTAL_URL_PARAMETER, {
    default: "https://portal.eegmanylabs.org/",
    description: "The address of the portal, from which generated documents link back to records.",
  });
  return portalUrlParameter.value();
}

/** The address of the portal, which messages and pull requests link back to. */
export function portalAddress(): string {
  return runningInEmulator() ? "https://portal.eegmanylabs.org/" : portalUrl();
}

/** The address Drive sends notifications to, or null where none is configured. The emulator has none. */
export function receiverUrl(): string | null {
  if (runningInEmulator()) return null;
  receiverParameter ??= defineString(DRIVE_RECEIVER_PARAMETER, {
    default: "",
    description: "The public HTTPS address of driveNotifications. Empty while polling is the only route.",
  });
  const value = receiverParameter.value().trim();
  return value === "" ? null : value;
}

export function liveDependencies(runtime: WorkspaceRuntime = workspaceRuntime()): JobDependencies {
  const emulated = runningInEmulator();
  return {
    db: firestore(),
    adapters: runtime.kind === "none" ? null : runtime.adapters,
    clock: systemClock,
    logger,
    sleep: (milliseconds) =>
      new Promise((resolve) =>
        setTimeout(resolve, emulated ? Math.min(milliseconds, EMULATOR_LONGEST_WAIT_MS) : milliseconds),
      ),
    random: Math.random,
    portalUrl: portalAddress(),
  };
}
