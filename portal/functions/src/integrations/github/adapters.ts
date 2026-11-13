// Which implementation serves the website repository. In the emulator it is always the fake,
// over a state file of the run, so no request can leave the machine. Elsewhere the real adapter
// is used only where the parameter `PUBLISHING_REPOSITORY` names the repository and the secret
// `PUBLISHING_GITHUB_TOKEN` holds a credential; until an organisation owner supplies both,
// publishing stops before the live write, with a message that says so. The real adapter is
// written and unverified: it has never been executed.
import { defineSecret, defineString } from "firebase-functions/params";
import { runningInEmulator } from "../../framework";
import { emulatorGitHubFake } from "./fake";
import { realWebsiteRepository } from "./real";
import type { WebsiteRepository } from "./types";

export const PUBLISHING_REPOSITORY_PARAMETER = "PUBLISHING_REPOSITORY";
export const PUBLISHING_TOKEN_SECRET = "PUBLISHING_GITHUB_TOKEN";

export const PUBLISHING_NOT_CONFIGURED_MESSAGE =
  "Publishing to the website is not connected yet: no repository credential has been supplied. The export is kept, and nothing has left the portal.";

/** How long one request to GitHub may take, in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000;

let repositoryParameter: ReturnType<typeof defineString> | undefined;
let tokenSecret: ReturnType<typeof defineSecret> | undefined;

/** The repository adapter, or null where publishing is not connected. */
export function websiteRepository(): WebsiteRepository | null {
  if (runningInEmulator()) return emulatorGitHubFake().repository();
  repositoryParameter ??= defineString(PUBLISHING_REPOSITORY_PARAMETER, {
    default: "",
    description: "The repository of the public website, as owner/name. Empty until publishing is approved.",
  });
  tokenSecret ??= defineSecret(PUBLISHING_TOKEN_SECRET);
  const repository = repositoryParameter.value().trim();
  if (repository === "") return null;
  let token: string;
  try {
    token = tokenSecret.value();
  } catch {
    return null;
  }
  return token === "" ? null : realWebsiteRepository(repository, token, REQUEST_TIMEOUT_MS);
}
