// Which implementation serves the OSF functions. In the emulator it is always the fake, over a
// state file of the run, so no request can leave the machine. Elsewhere the real adapter is used
// only where the parameter `OSF_CHECKS_ENABLED` is "true", which an administrator sets once the
// adapter has been checked against OSF's documentation (docs/INTEGRATIONS.md, section 5). The
// real adapter is written and unverified: it has never been executed.
import { defineString } from "firebase-functions/params";
import { runningInEmulator } from "../../framework";
import { emulatorOsfFake } from "./fake";
import { realOsfAdapter } from "./real";
import type { OsfAdapter } from "./types";

export const OSF_CHECKS_PARAMETER = "OSF_CHECKS_ENABLED";

export const OSF_NOT_ENABLED_MESSAGE =
  "Checks of OSF links are not switched on yet. The link is kept as it was entered, unchecked.";

/** How long one request to OSF may take, in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000;

let checksParameter: ReturnType<typeof defineString> | undefined;

function checksEnabled(): boolean {
  checksParameter ??= defineString(OSF_CHECKS_PARAMETER, {
    default: "false",
    description: "Whether the portal reads the metadata of public OSF resources. False until the adapter is checked.",
  });
  return checksParameter.value().trim() === "true";
}

/** The adapter of OSF, or null where checks are not switched on. */
export function osfAdapter(): OsfAdapter | null {
  if (runningInEmulator()) return emulatorOsfFake().adapter();
  if (!checksEnabled()) return null;
  return realOsfAdapter(REQUEST_TIMEOUT_MS);
}
