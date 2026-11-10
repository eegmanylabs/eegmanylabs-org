// Loading the application afresh, and saying something once it has started again.
import { readStored, writeStored } from "@/utils/storage";

const NOTICE_KEY = "portal.notice";

/**
 * | Notice                  | Shown after the restart as                          |
 * |-------------------------|-----------------------------------------------------|
 * | `signed-out`            | The confirmation "You have signed out."             |
 * | `signed-out-everywhere` | The confirmation that every session has been ended  |
 * | `suspended`             | The sign-in page says that the account is suspended  |
 */
export const RESTART_NOTICES = ["signed-out", "signed-out-everywhere", "suspended"] as const;
export type RestartNotice = (typeof RESTART_NOTICES)[number];

/** Leaves a notice for the application to show after it has started again, in this tab only. */
export function leaveNotice(notice: RestartNotice | null): void {
  writeStored(NOTICE_KEY, notice, "session");
}

/** The notice left before the restart, if any. It is handed out once. */
export function takeNotice(): RestartNotice | null {
  const notice = readStored(NOTICE_KEY, "session");
  if (notice !== null) writeStored(NOTICE_KEY, null, "session");
  return RESTART_NOTICES.find((known) => known === notice) ?? null;
}

/**
 * Loads the page afresh, which is the one sure way to leave nothing of an account in memory.
 * `route` is where the fresh application starts. Without it, it starts where it is.
 */
export function restartApplication(route: string | null = null): void {
  if (route !== null) window.history.replaceState(null, "", `#${route}`);
  window.location.reload();
}
